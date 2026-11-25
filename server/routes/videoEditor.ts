import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { Router, type Request } from "express";
import multer from "multer";
import {
  buildBusinessContextPrompt,
  formatGeminiError,
  getGeminiClient,
  parseJsonSafe,
  resolveTextModel,
  thinkingConfigForModel,
} from "../ai/geminiClient.js";
import { assertWorkspaceAccess } from "../middleware/auth.js";
import { runTrackedAiCall } from "../services/aiTelemetry.js";
import { stateStore } from "../services/stateStore.js";
import {
  getMediaDir,
  getRendersDir,
  getTempDir,
  hasFfmpegBinary,
  resolveFfmpegBin,
  resolveFfprobeBin,
  resolveSafeUploadCandidate,
} from "../utils/paths.js";

const execFileAsync = promisify(execFile);
const router = Router();

const MEDIA_DIR = getMediaDir();
const RENDERS_DIR = getRendersDir();
const TEMP_DIR = getTempDir();
const FFMPEG_BIN = resolveFfmpegBin();
const FFPROBE_BIN = resolveFfprobeBin();

export const ALLOWED_MEDIA_CATEGORIES = new Set([
  "logo",
  "product_screenshot",
  "app_screenshot",
  "product_demo_video",
  "product_demo_image",
  "product_clips",
  "product_clip_ref_image",
  "founder_clips",
  "talking_head_clips",
  "presenter_photograph",
  "testimonials",
  "tutorials",
  "brand_assets",
  "voiceovers",
  "background_music",
  "social_templates",
  "reference_viral_videos",
  "reference_image",
  "thumbnails",
  "campaign_creatives",
  "raw_screen_recordings",
  "other",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
  filename: (_req, file, cb) => {
    const safeExt = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, "") || ".bin";
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 },
});

function resolveLocalAssetPath(assetUrl: string): string | null {
  return resolveSafeUploadCandidate(assetUrl);
}

function formatSrtTime(sec: number): string {
  const safe = Math.max(0, sec);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function writeCaptionsSrtFile(
  captions: Array<{ startSec: number; endSec: number; text: string }>,
): string | null {
  if (!captions.length) return null;
  const lines = captions
    .filter((c) => c.text?.trim())
    .map((c, idx) => {
      const start = Math.max(0, Number(c.startSec) || idx * 3);
      const end = Math.max(start + 0.8, Number(c.endSec) || start + 3);
      return `${idx + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${c.text.trim()}\n`;
    })
    .join("\n");
  if (!lines) return null;
  const srtPath = path.join(TEMP_DIR, `subs-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.srt`);
  fs.writeFileSync(srtPath, lines, "utf8");
  return srtPath;
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

router.get("/media", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({
    assets: stateStore.listMediaAssets(ctx.workspaceId),
  });
});

router.post("/media/upload", upload.single("file"), (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded." });
    return;
  }

  const mime = req.file.mimetype || "application/octet-stream";
  const kind: "video" | "image" | "audio" | "document" = mime.startsWith("video/")
    ? "video"
    : mime.startsWith("audio/")
      ? "audio"
      : mime.startsWith("image/")
        ? "image"
        : "document";

  const requestedCategory = String(req.body?.category || "").trim();
  const defaultCategory =
    kind === "video"
      ? "product_demo_video"
      : kind === "audio"
        ? "voiceovers"
        : kind === "image"
          ? "product_demo_image"
          : "brand_assets";
  const category = ALLOWED_MEDIA_CATEGORIES.has(requestedCategory) ? requestedCategory : defaultCategory;

  const rawTags = typeof req.body?.tags === "string" ? req.body.tags : "";
  const tags = rawTags
    .split(",")
    .map((t: string) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 600) : "";

  const url = `/uploads/media/${req.file.filename}`;
  const asset = stateStore.addMediaAsset({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    url,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: mime,
    sizeBytes: req.file.size,
    kind,
    category,
    tags,
    description,
  });

  res.json({
    id: asset.id,
    url: asset.url,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    size: asset.sizeBytes,
    sizeBytes: asset.sizeBytes,
    kind: asset.kind,
    category: asset.category,
    tags: asset.tags,
    description: asset.description,
    createdAt: asset.createdAt,
  });
});

function isDurableMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    return (
      url.hostname === "firebasestorage.googleapis.com" ||
      url.hostname === "storage.googleapis.com" ||
      url.hostname.endsWith(".firebasestorage.app")
    );
  } catch {
    return false;
  }
}

router.post("/media/register", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = req.body as {
    url?: string;
    originalName?: string;
    mimeType?: string;
    size?: number;
    category?: string;
    tags?: string;
    description?: string;
  };
  const url = String(body.url || "").trim();
  if (!isDurableMediaUrl(url)) {
    res.status(400).json({ error: "Only a Firebase Storage HTTPS URL can be registered." });
    return;
  }
  const mime = String(body.mimeType || "application/octet-stream");
  const kind: "video" | "image" | "audio" | "document" = mime.startsWith("video/")
    ? "video"
    : mime.startsWith("audio/")
      ? "audio"
      : mime.startsWith("image/")
        ? "image"
        : "document";
  const requestedCategory = String(body.category || "").trim();
  const defaultCategory =
    kind === "video" ? "product_demo_video" : kind === "audio" ? "voiceovers" : kind === "image" ? "product_demo_image" : "brand_assets";
  const category = ALLOWED_MEDIA_CATEGORIES.has(requestedCategory) ? requestedCategory : defaultCategory;
  const tags = String(body.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  const asset = stateStore.addMediaAsset({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    url,
    filename: url.split("/").pop()?.split("?")[0] || "cloud-asset",
    originalName: String(body.originalName || "Uploaded asset").slice(0, 180),
    mimeType: mime,
    sizeBytes: Math.max(0, Number(body.size) || 0),
    kind,
    category,
    tags,
    description: String(body.description || "").slice(0, 600),
  });
  res.json({
    id: asset.id,
    url: asset.url,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    size: asset.sizeBytes,
    sizeBytes: asset.sizeBytes,
    kind: asset.kind,
    category: asset.category,
    tags: asset.tags,
    description: asset.description,
    createdAt: asset.createdAt,
  });
});

router.patch("/media/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const id = String(req.params.id);
  const { category, tags, description, originalName } = req.body as {
    category?: string;
    tags?: string[] | string;
    description?: string;
    originalName?: string;
  };
  const patch: Record<string, unknown> = {};
  if (category && ALLOWED_MEDIA_CATEGORIES.has(category)) {
    patch.category = category;
  }
  if (Array.isArray(tags)) {
    patch.tags = tags.map(String).map((t) => t.trim()).filter(Boolean).slice(0, 15);
  } else if (typeof tags === "string") {
    patch.tags = tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 15);
  }
  if (typeof description === "string") {
    patch.description = description.trim().slice(0, 600);
  }
  if (typeof originalName === "string" && originalName.trim()) {
    patch.originalName = originalName.trim().slice(0, 180);
  }
  const updated = stateStore.updateMediaAsset(id, ctx.workspaceId, patch);
  if (!updated) {
    res.status(404).json({ error: "Media asset not found in this workspace." });
    return;
  }
  res.json({ asset: updated });
});

router.post("/media/:id/replace", upload.single("file"), (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  if (!req.file) {
    res.status(400).json({ error: "Replacement file is required." });
    return;
  }
  const id = String(req.params.id);
  const existing = stateStore.getMediaAssetById(id, ctx.workspaceId);
  if (!existing) {
    try {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    } catch {
      // ignore
    }
    res.status(404).json({ error: "Media asset not found in this workspace." });
    return;
  }

  const oldPath = resolveLocalAssetPath(existing.url);
  if (oldPath && oldPath.startsWith(MEDIA_DIR + path.sep)) {
    try {
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch {
      // ignore cleanup error
    }
  }

  const mime = req.file.mimetype || "application/octet-stream";
  const kind: "video" | "image" | "audio" | "document" = mime.startsWith("video/")
    ? "video"
    : mime.startsWith("audio/")
      ? "audio"
      : mime.startsWith("image/")
        ? "image"
        : "document";

  const updated = stateStore.updateMediaAsset(id, ctx.workspaceId, {
    url: `/uploads/media/${req.file.filename}`,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: mime,
    sizeBytes: req.file.size,
    kind,
  });

  res.json({ asset: updated });
});

router.delete("/media/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const id = String(req.params.id);
  const removed = stateStore.deleteMediaAsset(id, ctx.workspaceId);
  if (!removed) {
    res.status(404).json({ error: "Media asset not found." });
    return;
  }
  const resolved = resolveLocalAssetPath(removed.url);
  if (resolved && resolved.startsWith(MEDIA_DIR + path.sep)) {
    try {
      if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    } catch {
      // ignore disk cleanup failure after metadata delete
    }
  }
  res.json({ deleted: true, id: removed.id });
});

router.post("/media/analyze", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const { mediaId, assetUrl, kind, mimeType, model } = req.body as {
      mediaId?: string;
      assetUrl?: string;
      kind?: string;
      mimeType?: string;
      model?: string;
    };

    const existing = mediaId ? stateStore.getMediaAssetById(mediaId, ctx.workspaceId) : null;
    const targetUrl = existing?.url || assetUrl || "";
    const resolved = resolveLocalAssetPath(targetUrl);
    if (!resolved) {
      res.status(400).json({ error: "Valid workspace media file is required for AI inspection." });
      return;
    }

    const effectiveKind = existing?.kind || kind || "image";
    const effectiveMime = existing?.mimeType || mimeType || "application/octet-stream";
    const stats = fs.statSync(resolved);

    let probeMeta: Record<string, unknown> | null = null;
    if (effectiveKind === "video" || effectiveKind === "audio") {
      try {
        const { stdout } = await execFileAsync(FFPROBE_BIN, [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          resolved,
        ]);
        const parsedProbe = JSON.parse(stdout) as {
          format?: { duration?: string; bit_rate?: string };
          streams?: Array<{ codec_type?: string; width?: number; height?: number; codec_name?: string }>;
        };
        const vStream = parsedProbe.streams?.find((s) => s.codec_type === "video");
        probeMeta = {
          durationSec: parsedProbe.format?.duration ? Math.round(Number(parsedProbe.format.duration)) : undefined,
          width: vStream?.width,
          height: vStream?.height,
          codec: vStream?.codec_name,
        };
      } catch {
        // optional metadata
      }
    }

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    let analysis: {
      summary: string;
      extractedText?: string;
      productFeatures?: string[];
      transcript?: string;
      scenes?: Array<{ timeRange: string; description: string }>;
      visualStyle?: string;
      analyzedAt: string;
      model: string;
    };

    if (stats.size > 16 * 1024 * 1024) {
      res.status(413).json({
        error: "File exceeds 16 MB inline multimodal analysis limit. Trim or compress under 16 MB to inspect.",
      });
      return;
    }

    const base64Data = fs.readFileSync(resolved).toString("base64");

    if (effectiveKind === "audio") {
      const txRes = await runTrackedAiCall(
        {
          workspaceId: ctx.workspaceId,
          actorUid: ctx.actorUid,
          endpoint: "/api/media/analyze",
          agent: "Audio Asset Analyzer",
          model: "gemini-3.5-transcribe",
          creditsEstimated: 20,
        },
        () =>
          ai.models.generateContent({
            model: "gemini-3.5-transcribe",
            contents: {
              parts: [
                { inlineData: { data: base64Data, mimeType: effectiveMime } },
                { text: "Transcribe this audio accurately with punctuation and speaker clarity." },
              ],
            },
          }),
      );
      analysis = {
        summary: (txRes.text || "").slice(0, 280) || "Transcribed audio asset.",
        transcript: txRes.text || "",
        visualStyle: "Audio recording",
        analyzedAt: new Date().toISOString(),
        model: "gemini-3.5-transcribe",
      };
    } else {
      const inspectRes = await runTrackedAiCall(
        {
          workspaceId: ctx.workspaceId,
          actorUid: ctx.actorUid,
          endpoint: "/api/media/analyze",
          agent: "Multimodal Asset Inspector",
          model: selectedModel,
          creditsEstimated: 35,
        },
        () =>
          ai.models.generateContent({
            model: selectedModel,
            contents: {
              parts: [
                { inlineData: { data: base64Data, mimeType: effectiveMime } },
                {
                  text: `Inspect this ${effectiveKind} marketing brand asset carefully.
Extract visible on-screen text (OCR), key product features shown, visual style, spoken transcript if any, and scene breakdown.
Return ONLY valid JSON:
{
  "summary": "string",
  "extractedText": "string",
  "productFeatures": ["string"],
  "transcript": "string",
  "visualStyle": "string",
  "scenes": [{ "timeRange": "00:00-00:03", "description": "string" }]
}`,
                },
              ],
            },
            config: {
              thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
              responseMimeType: "application/json",
            },
          }),
      );

      const parsed = parseJsonSafe<Record<string, unknown>>(inspectRes.text, {});
      analysis = {
        summary: String(parsed.summary || "Asset inspected"),
        extractedText: typeof parsed.extractedText === "string" ? parsed.extractedText : undefined,
        productFeatures: Array.isArray(parsed.productFeatures) ? parsed.productFeatures.map(String) : [],
        transcript: typeof parsed.transcript === "string" ? parsed.transcript : undefined,
        scenes: Array.isArray(parsed.scenes) ? (parsed.scenes as Array<{ timeRange: string; description: string }>) : [],
        visualStyle: typeof parsed.visualStyle === "string" ? parsed.visualStyle : undefined,
        analyzedAt: new Date().toISOString(),
        model: selectedModel,
      };
    }

    if (existing) {
      stateStore.updateMediaAsset(existing.id, ctx.workspaceId, { aiAnalysis: analysis });
    }

    res.json({ analysis, metadata: probeMeta });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/editor/ai-plan", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const {
      instruction,
      projectTitle = "Video Project",
      durationSec = 29,
      aspectRatio = "9:16",
      script = "",
      business,
      model,
    } = req.body as {
      instruction?: string;
      projectTitle?: string;
      durationSec?: number;
      aspectRatio?: string;
      script?: string;
      business?: Record<string, unknown>;
      model?: string;
    };

    if (!instruction?.trim()) {
      res.status(400).json({ error: "Editing instruction is required." });
      return;
    }

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const prompt = `Create a structured, reversible AI video editing plan for FFmpeg + multi-track timeline execution.
${buildBusinessContextPrompt(business)}
Project Title: ${projectTitle}
Current Duration: ${durationSec}s
Target Aspect Ratio: ${aspectRatio}
Script / Narration: ${script || "N/A"}
User Editing Instruction: ${instruction}

Return ONLY valid JSON:
{
  "summary": "string",
  "actions": ["Removed 1.8s pauses", "Added dynamic centered captions"],
  "trimStartSec": 0,
  "trimDurationSec": 12,
  "suggestedAspectRatio": "9:16" | "16:9" | "1:1" | "4:5",
  "captions": [
    { "startSec": 0, "endSec": 3, "text": "string" },
    { "startSec": 3, "endSec": 8, "text": "string" }
  ],
  "brollCues": [
    { "startSec": 4, "durationSec": 3, "label": "Product UI showcase" }
  ]
}`;

    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/editor/ai-plan",
        agent: "Video Edit Planner",
        model: selectedModel,
        creditsEstimated: 45,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents: prompt,
          config: {
            systemInstruction:
              "You are an expert short-form video editor. Return strictly valid JSON with realistic timestamps inside the project duration.",
            thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
            responseMimeType: "application/json",
          },
        }),
    );

    const plan = parseJsonSafe<Record<string, unknown>>(response.text);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      plan,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/editor/render", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const tempFilesToClean: string[] = [];

  const {
    sourceUrl,
    clips = [],
    audioUrl,
    musicUrl,
    logoUrl,
    burnSubtitles = false,
    captionsTrack = [],
    aspectRatio = "9:16",
    trimStartSec = 0,
    trimDurationSec = 8,
    speed = 1.0,
    zoomFactor = 1.0,
    fadeInOut = false,
    voVolume = 1.0,
    musicVolume = 0.22,
    title = "render",
  } = req.body as {
    sourceUrl?: string;
    clips?: string[];
    audioUrl?: string;
    musicUrl?: string;
    logoUrl?: string;
    burnSubtitles?: boolean;
    captionsTrack?: Array<{ startSec: number; endSec: number; text: string }>;
    aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5";
    trimStartSec?: number;
    trimDurationSec?: number;
    speed?: number;
    zoomFactor?: number;
    fadeInOut?: boolean;
    voVolume?: number;
    musicVolume?: number;
    title?: string;
  };

  const rawVisualUrls = Array.isArray(clips) && clips.length > 0 ? clips : sourceUrl ? [sourceUrl] : [];
  const resolvedVisuals = rawVisualUrls
    .map((u) => resolveLocalAssetPath(u))
    .filter((p): p is string => Boolean(p));

  if (resolvedVisuals.length === 0) {
    res.status(400).json({ error: "Please upload or select a video or image asset first." });
    return;
  }

  if (!hasFfmpegBinary()) {
    res.status(503).json({
      error:
        "FFmpeg video rendering requires a Node or Docker runtime with ffmpeg installed. Configure FFMPEG_PATH on a dedicated render worker or run locally.",
      capabilityRequired: "ffmpeg",
    });
    return;
  }

  const job = stateStore.createVideoJob({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    title: title || "Video Render",
    aspectRatio,
    status: "processing",
    progressPct: 15,
  });

  try {
    const resolvedVoice = audioUrl ? resolveLocalAssetPath(audioUrl) : null;
    const resolvedMusic = musicUrl ? resolveLocalAssetPath(musicUrl) : null;

    const dimensions: Record<string, { w: number; h: number }> = {
      "9:16": { w: 720, h: 1280 },
      "16:9": { w: 1280, h: 720 },
      "1:1": { w: 1080, h: 1080 },
      "4:5": { w: 864, h: 1080 },
    };
    const { w, h } = dimensions[aspectRatio] || dimensions["9:16"];
    const safeStart = Math.max(0, Number(trimStartSec) || 0);
    const safeDuration = Math.min(60, Math.max(2, Number(trimDurationSec) || 8));
    const safeSpeed = Math.min(1.5, Math.max(0.75, Number(speed) || 1.0));
    const safeZoom = Math.min(1.3, Math.max(1.0, Number(zoomFactor) || 1.0));
    const safeVoVol = Math.min(2.0, Math.max(0.1, Number(voVolume) || 1.0));
    const safeMusicVol = Math.min(1.0, Math.max(0.0, Number(musicVolume) ?? 0.22));

    const outFilename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)}-${Date.now()}.mp4`;
    const outPath = path.join(RENDERS_DIR, outFilename);

    let primaryVideoPath = "";
    const isSingleVisual = resolvedVisuals.length === 1;
    const perClipSec = Math.max(1.5, Number((safeDuration / resolvedVisuals.length).toFixed(2)));

    if (!isSingleVisual) {
      const normalizedClips: string[] = [];
      for (let i = 0; i < Math.min(6, resolvedVisuals.length); i++) {
        const src = resolvedVisuals[i];
        const ext = path.extname(src).toLowerCase();
        const isImg = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
        const clipOut = path.join(TEMP_DIR, `seg-${job.id}-${i}.mp4`);
        tempFilesToClean.push(clipOut);

        const segArgs = ["-y"];
        if (isImg) {
          segArgs.push("-loop", "1", "-t", String(perClipSec), "-i", src);
        } else {
          segArgs.push("-ss", i === 0 ? String(safeStart) : "0", "-t", String(perClipSec), "-i", src);
        }
        segArgs.push(
          "-vf",
          `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p`,
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "23",
          clipOut,
        );
        await execFileAsync(FFMPEG_BIN, segArgs, { timeout: 90000 });
        normalizedClips.push(clipOut);
      }

      const listFile = path.join(TEMP_DIR, `concat-${job.id}.txt`);
      tempFilesToClean.push(listFile);
      fs.writeFileSync(
        listFile,
        normalizedClips.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
        "utf8",
      );

      const mergedVisual = path.join(TEMP_DIR, `merged-${job.id}.mp4`);
      tempFilesToClean.push(mergedVisual);
      await execFileAsync(
        FFMPEG_BIN,
        ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", mergedVisual],
        { timeout: 90000 },
      );
      primaryVideoPath = mergedVisual;
    } else {
      primaryVideoPath = resolvedVisuals[0];
    }

    stateStore.updateVideoJob(job.id, { progressPct: 60 });

    const primaryExt = path.extname(primaryVideoPath).toLowerCase();
    const isPrimaryImage = isSingleVisual && [".jpg", ".jpeg", ".png", ".webp"].includes(primaryExt);

    const srtPath =
      burnSubtitles && Array.isArray(captionsTrack) && captionsTrack.length > 0
        ? writeCaptionsSrtFile(captionsTrack)
        : null;
    if (srtPath) tempFilesToClean.push(srtPath);

    const resolvedLogo = logoUrl ? resolveLocalAssetPath(logoUrl) : null;

    const args: string[] = ["-y"];
    if (isPrimaryImage) {
      args.push("-loop", "1", "-t", String(safeDuration), "-i", primaryVideoPath);
    } else if (isSingleVisual) {
      args.push("-ss", String(safeStart), "-t", String(safeDuration), "-i", primaryVideoPath);
    } else {
      args.push("-i", primaryVideoPath);
    }

    const baseVf = (() => {
      let base = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
      if (safeZoom > 1.01) {
        const zw = Math.round((w * safeZoom) / 2) * 2;
        const zh = Math.round((h * safeZoom) / 2) * 2;
        base += `,scale=${zw}:${zh},crop=${w}:${h}`;
      }
      if (!isPrimaryImage && Math.abs(safeSpeed - 1.0) > 0.04) {
        base += `,setpts=${(1 / safeSpeed).toFixed(3)}*PTS`;
      }
      if (fadeInOut && safeDuration >= 2) {
        const fadeOutStart = Math.max(0.6, safeDuration - 0.5).toFixed(2);
        base += `,fade=t=in:st=0:d=0.45,fade=t=out:st=${fadeOutStart}:d=0.45`;
      }
      base += `,format=yuv420p`;
      if (srtPath) {
        base += `,subtitles='${escapeFilterPath(srtPath)}':force_style='FontSize=18,PrimaryColour=&HFFFFFF&,OutlineColour=&H111415&,Outline=2,Alignment=2,MarginV=36'`;
      }
      return base;
    })();

    const filterParts: string[] = [];
    let audioMapTarget = "1:a:0";
    let nextInputIndex = 1;

    if (resolvedVoice && resolvedMusic) {
      const voIdx = nextInputIndex++;
      const muIdx = nextInputIndex++;
      args.push("-i", resolvedVoice, "-stream_loop", "-1", "-i", resolvedMusic);
      filterParts.push(
        `[${voIdx}:a]volume=${safeVoVol.toFixed(2)}[va];[${muIdx}:a]volume=${safeMusicVol.toFixed(2)}[ma];[va][ma]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      );
      audioMapTarget = "[aout]";
    } else if (resolvedVoice) {
      const voIdx = nextInputIndex++;
      args.push("-i", resolvedVoice);
      filterParts.push(`[${voIdx}:a]volume=${safeVoVol.toFixed(2)}[aout]`);
      audioMapTarget = "[aout]";
    } else if (resolvedMusic) {
      const muIdx = nextInputIndex++;
      args.push("-stream_loop", "-1", "-i", resolvedMusic);
      filterParts.push(`[${muIdx}:a]volume=${safeMusicVol.toFixed(2)}[aout]`);
      audioMapTarget = "[aout]";
    } else {
      const silIdx = nextInputIndex++;
      args.push("-f", "lavfi", "-t", String(safeDuration), "-i", "anullsrc=r=44100:cl=stereo");
      audioMapTarget = `${silIdx}:a:0`;
    }

    const validLogo =
      resolvedLogo &&
      [".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(resolvedLogo).toLowerCase())
        ? resolvedLogo
        : null;

    if (validLogo) {
      const logoIdx = nextInputIndex++;
      args.push("-i", validLogo);
      filterParts.push(`[0:v]${baseVf}[vbase]`);
      filterParts.push(`[${logoIdx}:v]scale=110:-1[wm]`);
      filterParts.push(`[vbase][wm]overlay=W-w-24:24[vout]`);
      args.push("-filter_complex", filterParts.join(";"), "-map", "[vout]", "-map", audioMapTarget);
    } else if (filterParts.length > 0) {
      args.push("-filter_complex", filterParts.join(";"), "-map", "0:v:0", "-map", audioMapTarget, "-vf", baseVf);
    } else {
      args.push("-map", "0:v:0", "-map", audioMapTarget, "-vf", baseVf);
    }

    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-t",
      String(safeDuration),
      "-movflags",
      "+faststart",
      outPath,
    );

    await execFileAsync(FFMPEG_BIN, args, { timeout: 120000 });

    if (!fs.existsSync(outPath)) {
      throw new Error("Render completed without creating an MP4 file.");
    }
    const stats = fs.statSync(outPath);
    if (stats.size <= 0) {
      throw new Error("Rendered MP4 file is empty.");
    }

    const renderUrl = `/uploads/renders/${outFilename}`;
    stateStore.updateVideoJob(job.id, {
      status: "completed",
      progressPct: 100,
      renderUrl,
      filename: outFilename,
      sizeBytes: stats.size,
      durationSec: safeDuration,
      width: w,
      height: h,
    });
    stateStore.addNotification({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      title: "Video Render Complete",
      message: `${outFilename} (${w}×${h}, ${(stats.size / 1024).toFixed(0)} KB) is ready.`,
      category: "video",
      severity: "success",
      actionPage: "Video Editor",
    });

    res.json({
      jobId: job.id,
      renderUrl,
      filename: outFilename,
      sizeBytes: stats.size,
      aspectRatio,
      durationSec: safeDuration,
      width: w,
      height: h,
      clipsUsed: resolvedVisuals.length,
      subtitlesBurned: Boolean(srtPath),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stateStore.updateVideoJob(job.id, {
      status: "failed",
      progressPct: 100,
      error: message,
    });
    res.status(500).json({ error: `FFmpeg render failed: ${message}`, jobId: job.id });
  } finally {
    for (const f of tempFilesToClean) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        // ignore temp cleanup errors
      }
    }
  }
});

export default router;
