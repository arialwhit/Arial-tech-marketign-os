import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Router, type Request } from "express";
import multer from "multer";
import {
  buildBusinessContextPrompt,
  formatGeminiError,
  getDecisionsClient,
  getGeminiClient,
  parseJsonSafe,
  resolveImageModel,
  resolveMusicModel,
  resolveTextModel,
  resolveVoiceModel,
  thinkingConfigForModel,
} from "../ai/geminiClient.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { runTrackedAiCall } from "../services/aiTelemetry.js";
import { stateStore } from "../services/stateStore.js";
import { getGeneratedDir, resolveSafeUploadCandidate } from "../utils/paths.js";
import { safePublicFetch } from "../utils/ssrf.js";

const router = Router();

function wsCtx(req: Request) {
  const areq = req as AuthenticatedRequest;
  const workspaceId = String(req.headers["x-workspace-id"] || req.body?.workspaceId || "default");
  return { workspaceId, actorUid: areq.user?.uid || "anonymous" };
}

function buildApprovedMemoryBlock(workspaceId: string): string {
  const memories = stateStore
    .listMemories(workspaceId)
    .filter((m) => m.approved)
    .slice(0, 12);
  if (!memories.length) return "";
  return `\nPersistent Workspace AI Memory (approved context):\n${memories
    .map((m) => `- [${m.scope.toUpperCase()} | ${m.source}] ${m.title}: ${m.content}`)
    .join("\n")}\n`;
}
const GENERATED_DIR = getGeneratedDir();

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function toDataUrlIfSmall(buffer: Buffer, mimeType: string, maxBytes = 2_500_000): string | undefined {
  if (!buffer || buffer.byteLength === 0 || buffer.byteLength > maxBytes) return undefined;
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function readInteractionVideo(interaction: {
  output_video?: { data?: string; mime_type?: string };
  steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string; mime_type?: string }> }>;
}): { data?: string; mime_type?: string } | undefined {
  if (interaction.output_video?.data) return interaction.output_video;
  for (const step of interaction.steps || []) {
    if (step.type !== "model_output") continue;
    const video = (step.content || []).find((item) => item.type === "video" && item.data);
    if (video?.data) return video;
  }
  return interaction.output_video;
}

function saveGeneratedFile(buffer: Buffer, ext: string): string {
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
  const fullPath = path.join(GENERATED_DIR, filename);
  fs.writeFileSync(fullPath, buffer);
  return `/uploads/generated/${filename}`;
}

function readLocalOrBase64Asset(input: { imageUrl?: string; imageBase64?: string; mimeType?: string }) {
  if (input.imageBase64) {
    const match = input.imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { data: match[2], mimeType: input.mimeType || match[1] || "image/png" };
    }
    const clean = input.imageBase64.replace(/^data:[^;]+;base64,/, "");
    return { data: clean, mimeType: input.mimeType || "image/png" };
  }
  if (input.imageUrl) {
    const dataMatch = input.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (dataMatch) {
      return { data: dataMatch[2], mimeType: input.mimeType || dataMatch[1] || "image/png" };
    }
    const candidate = resolveSafeUploadCandidate(input.imageUrl);
    if (candidate) {
      const ext = path.extname(candidate).toLowerCase();
      const mimeType =
        ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : "image/jpeg";
      return {
        data: fs.readFileSync(candidate).toString("base64"),
        mimeType,
      };
    }
  }
  return null;
}

async function readImageAsset(input: { imageUrl?: string; imageBase64?: string; mimeType?: string }) {
  const local = readLocalOrBase64Asset(input);
  if (local) return local;
  const imageUrl = input.imageUrl || "";
  if (!/^https:\/\//i.test(imageUrl)) return null;
  if (imageUrl.includes("/src/assets/") || /avatar_\d/i.test(imageUrl)) return null;
  const { response } = await safePublicFetch(imageUrl, { timeoutMs: 15000 });
  if (!response.ok) return null;
  const mimeType = (response.headers.get("content-type") || input.mimeType || "image/jpeg").split(";")[0];
  if (!mimeType.startsWith("image/")) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < 32 || buffer.byteLength > 12 * 1024 * 1024) return null;
  return { data: buffer.toString("base64"), mimeType };
}

router.post("/command-center/chat", async (req, res) => {
  try {
    const { message, history = [], business, model, systemRole } = req.body as {
      message?: string;
      history?: Array<{ role: "user" | "assistant"; text: string }>;
      business?: Record<string, unknown>;
      model?: string;
      systemRole?: string;
    };
    if (!message?.trim()) {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const conversationText = history
      .slice(-10)
      .map((m) => `${m.role === "user" ? "Founder" : "Marketing OS"}: ${m.text}`)
      .join("\n");

    const ctx = wsCtx(req);
    const memoryBlock = buildApprovedMemoryBlock(ctx.workspaceId);

    const prompt = `${buildBusinessContextPrompt(business)}${memoryBlock}

Recent Conversation:
${conversationText || "(New conversation)"}

Latest Founder Request:
${message}

Respond as Marketing OS Central Orchestrator. Provide:
1) A concise strategic reply grounded in the business context.
2) A structured 6-stage agent execution plan tailored to the request.

Return ONLY valid JSON:
{
  "reply": "string",
  "planTitle": "string",
  "estimatedCredits": 450,
  "expectedTime": "~4 minutes",
  "stages": [
    { "step": "string", "agent": "Research Agent" | "Strategy Agent" | "Script + Storyboard" | "Creative Agent" | "Quality Agents" | "Publishing Agent", "detail": "string" }
  ]
}`;

    const roleDirective = systemRole?.trim()
      ? `Adopt this specialist persona: ${systemRole.trim()}.`
      : "Act as an AI marketing department orchestrator.";

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: `You are Marketing OS. ${roleDirective} Never fabricate metrics or fake historical data. Draft-only permissions apply until human approval.`,
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json",
      },
    });

    const data = parseJsonSafe<Record<string, unknown>>(response.text);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/command-center/execute", async (req, res) => {
  try {
    const { goal, planTitle, business, model } = req.body as {
      goal?: string;
      planTitle?: string;
      business?: Record<string, unknown>;
      model?: string;
    };
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const prompt = `Execute the Marketing OS campaign workflow for:
Plan: ${planTitle || "Growth Campaign"}
Goal: ${goal || "Create high-converting short-form content and distribution drafts"}
${buildBusinessContextPrompt(business)}

Generate concrete draft deliverables ready for the Content Pipeline and Content Calendar (draft-only, awaiting approval).
Return ONLY valid JSON:
{
  "summary": "string",
  "researchInsights": ["string"],
  "projects": [
    {
      "title": "string",
      "platform": "Instagram" | "TikTok" | "YouTube" | "LinkedIn",
      "hook": "string",
      "script": "string",
      "stage": "Script" | "Awaiting approval"
    }
  ],
  "calendarDrafts": [
    {
      "title": "string",
      "platform": "Instagram" | "TikTok" | "LinkedIn" | "YouTube",
      "dayOffset": 2,
      "time": "18:00",
      "caption": "string"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction:
          "You are the Marketing OS execution coordinator. Produce concrete, brand-aligned draft deliverables in strict JSON.",
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json",
      },
    });

    const data = parseJsonSafe<Record<string, unknown>>(response.text);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/content/scripts", async (req, res) => {
  try {
    const {
      topic,
      platform = "Instagram Reels + TikTok",
      duration = "30 seconds",
      audience = "Target customers",
      objective = "App consideration",
      tone = "Direct, credible, encouraging",
      cta = "Start today",
      blueprint = "",
      business,
      model,
    } = req.body as {
      topic?: string;
      platform?: string;
      duration?: string;
      audience?: string;
      objective?: string;
      tone?: string;
      cta?: string;
      blueprint?: string;
      business?: Record<string, unknown>;
      model?: string;
    };

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const ctx = wsCtx(req);
    const memoryBlock = buildApprovedMemoryBlock(ctx.workspaceId);

    const prompt = `Generate 3 distinct, high-retention marketing script variations and scene-by-scene storyboards.
${buildBusinessContextPrompt(business)}${memoryBlock}

Creative Brief:
- Topic: ${topic || "Core value proposition"}
- Platform: ${platform}
- Duration: ${duration}
- Target Audience: ${audience}
- Objective: ${objective}
- Tone: ${tone}
- Call to Action: ${cta}
${blueprint ? `- Blueprint Format: ${blueprint}` : ""}

Return ONLY valid JSON:
{
  "variations": [
    {
      "title": "string",
      "hook": "string",
      "angle": "string",
      "score": 92,
      "recommended": true,
      "scenes": [
        {
          "number": "01",
          "timeRange": "0:00-0:03",
          "beat": "Hook",
          "visual": "string",
          "dialogue": "string"
        }
      ]
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction:
          "You are an expert short-form video scriptwriter and creative director. Respect the brand's words to use and words to avoid.",
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json",
      },
    });

    const data = parseJsonSafe<Record<string, unknown>>(response.text);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/content/regenerate-section", async (req, res) => {
  try {
    const { beat, currentDialogue, currentVisual, instruction, business, model } = req.body as {
      beat?: string;
      currentDialogue?: string;
      currentVisual?: string;
      instruction?: string;
      business?: Record<string, unknown>;
      model?: string;
    };
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: `${buildBusinessContextPrompt(business)}
Rewrite this single storyboard scene (${beat || "Scene"}).
Current Dialogue: ${currentDialogue || ""}
Current Visual: ${currentVisual || ""}
Instruction: ${instruction || "Make it sharper, clearer, and more visual."}

Return ONLY valid JSON: { "dialogue": "string", "visual": "string" }`,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
      },
    });

    const data = parseJsonSafe<{ dialogue: string; visual: string }>(response.text);
    res.json({ model: selectedModel, ...data });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/image/generate", async (req, res) => {
  try {
    const {
      prompt,
      model,
      aspectRatio = "1:1",
      imageSize = "1K",
      useGoogleSearch = false,
      stylePreset,
      brandColors,
      referenceImageUrls = [],
      composition,
      textPlacement,
      backgroundInstruction,
      subjectPosition,
      saveToMediaLibrary = false,
      business,
    } = req.body as {
      prompt?: string;
      model?: string;
      aspectRatio?: string;
      imageSize?: string;
      useGoogleSearch?: boolean;
      stylePreset?: string;
      brandColors?: string;
      referenceImageUrls?: string[];
      composition?: string;
      textPlacement?: string;
      backgroundInstruction?: string;
      subjectPosition?: string;
      saveToMediaLibrary?: boolean;
      business?: Record<string, unknown>;
    };
    if (!prompt?.trim()) {
      res.status(400).json({ error: "Image prompt is required." });
      return;
    }

    const ai = getGeminiClient();
    const selectedModel = resolveImageModel(model);
    const ctx = wsCtx(req);

    const directives = [
      prompt.trim(),
      stylePreset ? `Style Preset: ${stylePreset}` : "",
      brandColors ? `Brand Color Palette: ${brandColors}` : "",
      composition ? `Composition: ${composition}` : "",
      subjectPosition ? `Subject Positioning: ${subjectPosition}` : "",
      textPlacement ? `Text Overlay Placement: ${textPlacement}` : "",
      backgroundInstruction ? `Background Direction: ${backgroundInstruction}` : "",
      business?.name
        ? `Brand Context: ${String(business.name)} (${String(business.industry || "modern brand")}). Clean studio quality, high contrast.`
        : "",
    ].filter(Boolean);

    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
    for (const refUrl of referenceImageUrls.slice(0, 3)) {
      const refData = readLocalOrBase64Asset({ imageUrl: refUrl });
      if (refData) {
        parts.push({ inlineData: refData });
      }
    }
    parts.push({ text: directives.join("\n") });

    const imageConfig: Record<string, string> = { aspectRatio };
    if (selectedModel === "gemini-nano-banana-2.1" || selectedModel === "gemini-3-pro-image") {
      imageConfig.imageSize = ["1K", "2K", "4K"].includes(imageSize) ? imageSize : "1K";
    }

    const tools =
      useGoogleSearch &&
      (selectedModel === "gemini-nano-banana-2.1" || selectedModel === "gemini-3-pro-image")
        ? [
            {
              googleSearch: {
                searchTypes:
                  selectedModel === "gemini-nano-banana-2.1"
                    ? { webSearch: {}, imageSearch: {} }
                    : { webSearch: {} },
              },
            },
          ]
        : undefined;

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: { parts },
      config: {
        imageConfig,
        ...(tools ? { tools } : {}),
      },
    });

    let savedUrl = "";
    let mimeType = "image/png";
    let generatedBuffer: Buffer | null = null;
    let textNote = "";

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data && !savedUrl) {
        mimeType = part.inlineData.mimeType || "image/png";
        const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
        generatedBuffer = Buffer.from(part.inlineData.data, "base64");
        savedUrl = saveGeneratedFile(generatedBuffer, ext);
      } else if (part.text) {
        textNote += part.text;
      }
    }

    if (!savedUrl || !generatedBuffer) {
      res.status(502).json({ error: "Model did not return an image asset. Try refining your prompt." });
      return;
    }

    const dataUrl = toDataUrlIfSmall(generatedBuffer, mimeType);

    let mediaAsset = null;
    if (saveToMediaLibrary) {
      const fullPath = resolveSafeUploadCandidate(savedUrl);
      const sizeBytes = fullPath && fs.existsSync(fullPath) ? fs.statSync(fullPath).size : generatedBuffer.byteLength;
      mediaAsset = stateStore.addMediaAsset({
        workspaceId: ctx.workspaceId,
        ownerUid: ctx.actorUid,
        url: dataUrl || savedUrl,
        filename: path.basename(savedUrl),
        originalName: `nano-banana-${Date.now()}.png`,
        mimeType,
        sizeBytes,
        kind: "image",
        category: "campaign_creatives",
        tags: ["nano-banana", ...(stylePreset ? [stylePreset] : [])],
        description: prompt.trim().slice(0, 180),
      });
    }

    res.json({
      imageUrl: savedUrl,
      ...(dataUrl ? { dataUrl } : {}),
      mimeType,
      text: textNote,
      model: selectedModel,
      mediaAsset,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/image/edit", async (req, res) => {
  try {
    const { imageUrl, imageBase64, mimeType, instruction, model, aspectRatio = "1:1" } = req.body as {
      imageUrl?: string;
      imageBase64?: string;
      mimeType?: string;
      instruction?: string;
      model?: string;
      aspectRatio?: string;
    };
    if (!instruction?.trim()) {
      res.status(400).json({ error: "Edit instruction is required." });
      return;
    }
    const sourceImage = readLocalOrBase64Asset({ imageUrl, imageBase64, mimeType });
    if (!sourceImage) {
      res.status(400).json({ error: "A valid source image is required for image editing." });
      return;
    }

    const ai = getGeminiClient();
    const selectedModel = resolveImageModel(model);

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: {
        parts: [
          {
            inlineData: {
              data: sourceImage.data,
              mimeType: sourceImage.mimeType,
            },
          },
          { text: instruction.trim() },
        ],
      },
      config: {
        imageConfig: { aspectRatio },
      },
    });

    let savedUrl = "";
    let outMime = "image/png";
    let outBuffer: Buffer | null = null;
    let textNote = "";
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data && !savedUrl) {
        outMime = part.inlineData.mimeType || "image/png";
        const ext = outMime.includes("jpeg") ? "jpg" : "png";
        outBuffer = Buffer.from(part.inlineData.data, "base64");
        savedUrl = saveGeneratedFile(outBuffer, ext);
      } else if (part.text) {
        textNote += part.text;
      }
    }

    if (!savedUrl || !outBuffer) {
      res.status(502).json({ error: "Image edit did not return an updated image." });
      return;
    }

    const dataUrl = toDataUrlIfSmall(outBuffer, outMime);
    res.json({
      imageUrl: savedUrl,
      ...(dataUrl ? { dataUrl } : {}),
      mimeType: outMime,
      text: textNote,
      model: selectedModel,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/image/analyze", async (req, res) => {
  try {
    const { imageUrl, imageBase64, mimeType, question, model } = req.body as {
      imageUrl?: string;
      imageBase64?: string;
      mimeType?: string;
      question?: string;
      model?: string;
    };
    const sourceImage = readLocalOrBase64Asset({ imageUrl, imageBase64, mimeType });
    if (!sourceImage) {
      res.status(400).json({ error: "Valid image required for analysis." });
      return;
    }

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model || "gemini-4-neon");
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: {
        parts: [
          { inlineData: { data: sourceImage.data, mimeType: sourceImage.mimeType } },
          {
            text:
              question ||
              "Critique this marketing creative for visual hierarchy, scroll-stopping hook strength, clarity, and conversion potential.",
          },
        ],
      },
    });

    res.json({
      analysis: response.text || "",
      model: selectedModel,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/video/generate", async (req, res) => {
  try {
    const {
      prompt,
      aspectRatio = "9:16",
      duration = "6s",
      resolution = "720p",
      imageUrl,
      imageBase64,
      mimeType,
      previousInteractionId,
    } = req.body as {
      prompt?: string;
      aspectRatio?: "16:9" | "9:16";
      duration?: string;
      resolution?: string;
      imageUrl?: string;
      imageBase64?: string;
      mimeType?: string;
      previousInteractionId?: string;
    };

    if (!prompt?.trim()) {
      res.status(400).json({ error: "Video prompt is required." });
      return;
    }
    if (imageUrl && (imageUrl.includes("/src/assets/") || /avatar_\d/i.test(imageUrl))) {
      res.status(400).json({
        error: "Stock preset faces are not used. Upload your product photo or demo video first.",
      });
      return;
    }

    const ai = getGeminiClient();
    const sourceImage = await readImageAsset({ imageUrl, imageBase64, mimeType });

    const realism =
      "Use only the real product, packaging, person, and setting in the reference. Natural camera motion, real lighting, real skin and materials. Do not invent a stock influencer, plastic skin, extra logos, or a generic studio set.";
    const directedPrompt = sourceImage ? `${prompt.trim()}\n${realism}` : prompt.trim();
    const input = sourceImage
      ? [
          {
            type: "image" as const,
            mime_type: sourceImage.mimeType,
            data: sourceImage.data,
          },
          {
            type: "text" as const,
            text: directedPrompt,
          },
        ]
      : directedPrompt;

    const ctx = wsCtx(req);
    const job = stateStore.createVideoJob({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      title: prompt.trim().slice(0, 64),
      aspectRatio: aspectRatio === "16:9" ? "16:9" : "9:16",
      status: "processing",
      progressPct: 25,
    });

    const interaction = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/video/generate",
        agent: "Omni Video Generator",
        model: "gemini-omni-1.2-flash",
        creditsEstimated: 240,
      },
      () =>
        ai.interactions.create(
          {
            model: "gemini-omni-1.2-flash",
            api_version: "v1beta",
            ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
            input,
            background: false,
            store: true,
            stream: false,
            response_format: {
              type: "video",
              aspect_ratio: aspectRatio === "16:9" ? "16:9" : "9:16",
              duration: duration || "6s",
              resolution: resolution || "720p",
            },
          },
          { timeout: 300000 },
        ),
    );

    const videoPart = readInteractionVideo(interaction);
    if (!videoPart?.data) {
      stateStore.updateVideoJob(job.id, { status: "failed", progressPct: 100, error: "No video bytes returned" });
      res.status(502).json({
        error: "Video generation completed without video bytes. Try a simpler motion prompt.",
      });
      return;
    }

    const videoBuffer = Buffer.from(videoPart.data, "base64");
    const savedVideoUrl = saveGeneratedFile(videoBuffer, "mp4");
    stateStore.updateVideoJob(job.id, {
      status: "completed",
      progressPct: 100,
      renderUrl: savedVideoUrl,
      filename: path.basename(savedVideoUrl),
      sizeBytes: videoBuffer.byteLength,
    });

    res.json({
      jobId: job.id,
      videoUrl: savedVideoUrl,
      interactionId: interaction.id,
      model: "gemini-omni-1.2-flash",
      mimeType: videoPart.mime_type || "video/mp4",
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/audio/tts", async (req, res) => {
  try {
    const {
      text,
      voiceName = "Kore",
      style = "Warm, clear, confident marketing presenter",
      model,
      dualSpeaker = false,
      secondSpeakerVoice = "Puck",
    } = req.body as {
      text?: string;
      voiceName?: string;
      style?: string;
      model?: string;
      dualSpeaker?: boolean;
      secondSpeakerVoice?: string;
    };

    if (!text?.trim()) {
      res.status(400).json({ error: "Narration text is required." });
      return;
    }

    const ai = getGeminiClient();
    const selectedModel = resolveVoiceModel(dualSpeaker ? "gemini-3.8-flash-tts" : model);
    const validVoices = ["Puck", "Charon", "Kore", "Fenrir", "Zephyr"];
    const primaryVoice = validVoices.includes(voiceName) ? voiceName : "Kore";
    const secondaryVoice = validVoices.includes(secondSpeakerVoice) ? secondSpeakerVoice : "Puck";

    const response = dualSpeaker
      ? await ai.models.generateContent({
          model: "gemini-3.8-flash-tts",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: text.trim(),
                  speechMetadata: {
                    speaker: "Host",
                    style,
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  { speaker: "Host", voiceConfig: { prebuiltVoiceConfig: { voiceName: primaryVoice } } },
                  { speaker: "Guest", voiceConfig: { prebuiltVoiceConfig: { voiceName: secondaryVoice } } },
                ],
              },
            },
          },
        })
      : await ai.models.generateContent({
          model: selectedModel,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: text.trim(),
                  speechMetadata: {
                    style,
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: primaryVoice },
              },
            },
          },
        });

    const inlinePart = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    const base64Audio = inlinePart?.data;
    if (!base64Audio) {
      res.status(502).json({ error: "TTS model returned no audio data." });
      return;
    }

    const rawBytes = Buffer.from(base64Audio, "base64");
    if (rawBytes.length === 0) {
      res.status(502).json({ error: "TTS model returned an empty audio payload." });
      return;
    }

    const mimeStr = String(inlinePart?.mimeType || "audio/pcm;rate=24000");
    const hasRiffHeader =
      rawBytes.length >= 12 &&
      rawBytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      rawBytes.subarray(8, 12).toString("ascii") === "WAVE";

    let playableBuffer = rawBytes;
    if (!hasRiffHeader && !mimeStr.includes("mpeg") && !mimeStr.includes("ogg")) {
      const rateMatch = mimeStr.match(/rate=(\d+)/i);
      const sampleRate = rateMatch ? Number(rateMatch[1]) || 24000 : 24000;
      const numChannels = 1;
      const bitsPerSample = 16;
      const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
      const blockAlign = (numChannels * bitsPerSample) / 8;
      const header = Buffer.alloc(44);
      header.write("RIFF", 0, "ascii");
      header.writeUInt32LE(36 + rawBytes.length, 4);
      header.write("WAVE", 8, "ascii");
      header.write("fmt ", 12, "ascii");
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(numChannels, 22);
      header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(byteRate, 28);
      header.writeUInt16LE(blockAlign, 32);
      header.writeUInt16LE(bitsPerSample, 34);
      header.write("data", 36, "ascii");
      header.writeUInt32LE(rawBytes.length, 40);
      playableBuffer = Buffer.concat([header, rawBytes]);
    }

    if (playableBuffer.length <= 44) {
      res.status(502).json({ error: "Generated TTS audio stream was empty." });
      return;
    }

    const audioUrl = saveGeneratedFile(playableBuffer, "wav");
    const dataUrl = toDataUrlIfSmall(playableBuffer, "audio/wav");

    res.json({
      audioUrl,
      ...(dataUrl ? { dataUrl } : {}),
      mimeType: "audio/wav",
      sizeBytes: playableBuffer.length,
      model: selectedModel,
      voiceName: primaryVoice,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/audio/music", async (req, res) => {
  try {
    const { prompt, model } = req.body as { prompt?: string; model?: string };
    if (!prompt?.trim()) {
      res.status(400).json({ error: "Music prompt is required." });
      return;
    }

    const ai = getGeminiClient();
    const selectedModel = resolveMusicModel(model);

    const stream = await ai.models.generateContentStream({
      model: selectedModel,
      contents: prompt.trim(),
    });

    const audioChunks: Buffer[] = [];
    let lyrics = "";
    let mimeType = "audio/mpeg";

    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (!parts) continue;
      for (const part of parts) {
        if (part.inlineData?.data) {
          if (audioChunks.length === 0 && part.inlineData.mimeType) {
            mimeType = part.inlineData.mimeType;
          }
          audioChunks.push(Buffer.from(part.inlineData.data, "base64"));
        }
        if (part.text) {
          lyrics += part.text;
        }
      }
    }

    if (!audioChunks.length) {
      res.status(502).json({ error: "Lyria did not produce audio chunks." });
      return;
    }

    const fullBuffer = Buffer.concat(audioChunks);
    if (fullBuffer.length === 0) {
      res.status(502).json({ error: "Lyria returned an empty audio stream." });
      return;
    }
    const ext = mimeType.includes("wav") ? "wav" : "mp3";
    const audioUrl = saveGeneratedFile(fullBuffer, ext);
    const dataUrl = toDataUrlIfSmall(fullBuffer, mimeType);

    res.json({
      audioUrl,
      ...(dataUrl ? { dataUrl } : {}),
      lyrics,
      mimeType,
      sizeBytes: fullBuffer.length,
      model: selectedModel,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/audio/transcribe", uploadAudio.single("audio"), async (req, res) => {
  try {
    let base64 = "";
    let mimeType = "audio/webm";
    if (req.file) {
      base64 = req.file.buffer.toString("base64");
      mimeType = req.file.mimetype || "audio/webm";
    } else if (req.body?.audioBase64) {
      base64 = String(req.body.audioBase64).replace(/^data:[^;]+;base64,/, "");
      mimeType = req.body.mimeType || "audio/webm";
    }

    if (!base64) {
      res.status(400).json({ error: "Audio file or base64 audio payload is required." });
      return;
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3.5-transcribe",
      contents: {
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: "Transcribe this spoken audio cleanly with punctuation." },
        ],
      },
    });

    res.json({
      transcript: response.text || "",
      model: "gemini-3.5-transcribe",
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/evaluate/audience", async (req, res) => {
  try {
    const { title, script, platform = "Instagram Reels + TikTok", business, model, useDecisionCalibration = true } =
      req.body as {
        title?: string;
        script?: string;
        platform?: string;
        business?: Record<string, unknown>;
        model?: string;
        useDecisionCalibration?: boolean;
      };

    if (!script?.trim()) {
      res.status(400).json({ error: "Script or creative content is required for evaluation." });
      return;
    }

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const evalPromise = ai.models.generateContent({
      model: selectedModel,
      contents: `Evaluate this marketing creative across 6 simulated audience & reviewer perspectives.
${buildBusinessContextPrompt(business)}
Platform: ${platform}
Creative Title: ${title || "Untitled Creative"}
Script / Copy:
${script}

Return ONLY valid JSON:
{
  "overallScore": 87,
  "headline": "string",
  "summary": "string",
  "dimensions": [
    { "label": "Attention", "score": 90 },
    { "label": "Clarity", "score": 88 },
    { "label": "Relevance", "score": 91 },
    { "label": "Credibility", "score": 78 },
    { "label": "CTA", "score": 85 }
  ],
  "evaluators": [
    { "role": "Impatient viewer", "focus": "Hook retention", "score": 88, "quote": "string", "recommendation": "string" },
    { "role": "Target customer", "focus": "Relevance", "score": 92, "quote": "string", "recommendation": "string" },
    { "role": "Skeptical viewer", "focus": "Credibility", "score": 76, "quote": "string", "recommendation": "string" },
    { "role": "Potential buyer", "focus": "Value clarity", "score": 84, "quote": "string", "recommendation": "string" },
    { "role": "Casual viewer", "focus": "Clarity", "score": 90, "quote": "string", "recommendation": "string" },
    { "role": "Brand reviewer", "focus": "Brand fit", "score": 94, "quote": "string", "recommendation": "string" }
  ]
}`,
      config: {
        systemInstruction:
          "You are an objective AI Audience Simulation Lab. Critique rigorously—point out real weaknesses in hook, proof, or CTA. Clearly this is AI simulation, not real user testing.",
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json",
      },
    });

    let calibrationPromise: Promise<{ readyToPublishProb?: number; rubricScore?: number } | null> =
      Promise.resolve(null);

    if (useDecisionCalibration) {
      const decisionsAi = getDecisionsClient();
      calibrationPromise = decisionsAi.decisions
        .create({
          model: "gemini-decision-1",
          input: `Platform: ${platform}\nBusiness: ${String(business?.name || "Brand")}\nCreative Title: ${title || ""}\nScript:\n${script}`,
          questions: {
            publish_ready: {
              type: "noul",
              instructions: "Is the creative clear, credible, and compelling enough to move to scheduling without major rework?",
              criteria: {
                true_description: "Strong opening hook, clear product proof, concrete CTA, zero misleading claims.",
                false_description: "Weak hook, vague value proposition, or lacks credible proof.",
              },
            },
            quality_rubric: {
              type: "score",
              instructions: "Rate overall creative readiness for paid/organic distribution.",
              criteria: [
                "Needs full rewrite",
                "Weak hook or missing proof",
                "Solid draft with minor edits",
                "High-conviction ready to publish",
              ],
            },
          },
        })
        .then((result) => {
          const ready = result.answers?.publish_ready;
          const rubric = result.answers?.quality_rubric;
          return {
            readyToPublishProb: ready?.type === "noul" ? Math.round(ready.noul * 100) : undefined,
            rubricScore: rubric?.type === "score" ? Math.round((rubric.score / 3) * 100) : undefined,
          };
        })
        .catch(() => null);
    }

    const [evalResponse, calibration] = await Promise.all([evalPromise, calibrationPromise]);
    const parsed = parseJsonSafe<Record<string, unknown>>(evalResponse.text);

    res.json({
      sourceType: "ai_simulation",
      model: selectedModel,
      calibration,
      ...parsed,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/evaluate/improve", async (req, res) => {
  try {
    const { title, script, feedbackSummary, business, model } = req.body as {
      title?: string;
      script?: string;
      feedbackSummary?: string;
      business?: Record<string, unknown>;
      model?: string;
    };
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: `Improve this marketing script by directly resolving the evaluation feedback.
${buildBusinessContextPrompt(business)}
Title: ${title || "Creative"}
Original Script:
${script || ""}

Evaluation Feedback to Address:
${feedbackSummary || "Strengthen opening hook, add concrete product proof earlier, sharpen CTA."}

Return ONLY valid JSON:
{
  "improvedScript": "string",
  "changesMade": ["string"],
  "projectedScore": 94,
  "headline": "string"
}`,
      config: {
        systemInstruction: "You are a senior direct-response copywriter and creative editor.",
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json",
      },
    });

    const data = parseJsonSafe<Record<string, unknown>>(response.text);
    res.json({
      sourceType: "ai_simulation",
      model: selectedModel,
      ...data,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

export default router;
