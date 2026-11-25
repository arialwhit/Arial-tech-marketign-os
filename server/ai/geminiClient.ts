import { GoogleGenAI, ThinkingLevel } from "@google/genai";

export const MODEL_CATALOG = {
  text: [
    {
      id: "gemini-4-hydrogen",
      label: "Gemini 4 Hydrogen (Flash)",
      tier: "standard",
      description: "Fast reasoning, strategy, grounded research & daily marketing agents",
      contextWindow: "1M tokens",
      recommendedFor: "Daily content planning, scripts, web research & analytics Q&A",
      capabilities: {
        text: true,
        multimodalInput: true,
        searchGrounding: true,
      },
    },
    {
      id: "gemini-4-neon",
      label: "Gemini 4 Neon (Pro)",
      tier: "paid",
      description: "Deep complex reasoning, campaign architecture, multi-modal analysis",
      contextWindow: "2M tokens",
      recommendedFor: "Deep campaign strategy, creative audits & multimodal video breakdown",
      capabilities: {
        text: true,
        multimodalInput: true,
        searchGrounding: true,
      },
    },
    {
      id: "gemini-4-carbon",
      label: "Gemini 4 Carbon",
      tier: "paid",
      description: "Maximum analytical depth for competitive & growth audits",
      contextWindow: "2M tokens",
      recommendedFor: "Executive growth diagnostics, multi-source KPI analysis & deep positioning",
      capabilities: {
        text: true,
        multimodalInput: true,
        searchGrounding: true,
      },
    },
    {
      id: "gemini-3.1-flash-lite",
      label: "Gemini 3.1 Flash Lite",
      tier: "standard",
      description: "Ultra-low-latency quick edits, summaries, and classifications",
      contextWindow: "1M tokens",
      recommendedFor: "Quick rewrites, caption variations, tagging & fast UI assists",
      capabilities: {
        text: true,
        multimodalInput: true,
        searchGrounding: true,
      },
    },
  ],
  image: [
    {
      id: "gemini-3.1-flash-lite-image",
      label: "Nano Banana 2 Lite",
      tier: "paid",
      description: "Fast general image generation and creative editing",
      contextWindow: "Multi-turn image edit",
      recommendedFor: "Rapid storyboard frames, social thumbnails & product concept drafts",
      capabilities: {
        imageGeneration: true,
        multimodalInput: true,
      },
    },
    {
      id: "gemini-nano-banana-2.1",
      label: "Nano Banana 2.1 (1K–4K)",
      tier: "paid",
      description: "High-res 1K/2K/4K studio visuals + Google Image Search grounding",
      contextWindow: "Multi-reference + Search",
      recommendedFor: "1K–4K hero creatives, reference-matched product scenes & grounded visuals",
      capabilities: {
        imageGeneration: true,
        multimodalInput: true,
        searchGrounding: true,
        imageSearchGrounding: true,
      },
    },
    {
      id: "gemini-3-pro-image",
      label: "Nano Banana Pro",
      tier: "paid",
      description: "Studio-grade typography, product scenes, and art direction",
      contextWindow: "Multi-reference studio",
      recommendedFor: "Ad creatives with crisp typography, studio packaging & poster layouts",
      capabilities: {
        imageGeneration: true,
        multimodalInput: true,
        searchGrounding: true,
      },
    },
  ],
  video: [
    {
      id: "gemini-omni-1.2-flash",
      label: "Gemini Omni 1.2 Flash (Veo)",
      tier: "paid",
      description: "Text-to-video, image-to-video animation, editing & extension",
      contextWindow: "Multi-modal video interaction",
      recommendedFor: "AI-assisted short-form visual clips & animated storyboard scenes",
      capabilities: {
        videoGeneration: true,
        multimodalInput: true,
      },
    },
  ],
  voice: [
    {
      id: "gemini-3.8-flash-lite-tts",
      label: "Gemini 3.8 Flash Lite TTS",
      tier: "standard",
      description: "Fast, natural single-speaker marketing voiceovers",
      contextWindow: "Speech synthesis",
      recommendedFor: "Fast narration tracks for Reels, Shorts & explainer storyboards",
      capabilities: {
        audioGeneration: true,
      },
    },
    {
      id: "gemini-3.8-flash-tts",
      label: "Gemini 3.8 Flash TTS (Voice Design)",
      tier: "standard",
      description: "Dual-speaker dialogue, vocal bursts & custom voice direction",
      contextWindow: "Multi-speaker TTS",
      recommendedFor: "Conversational UGC scripts, dialogue ads & styled voiceovers",
      capabilities: {
        audioGeneration: true,
      },
    },
  ],
  music: [
    {
      id: "lyria-3-clip-preview",
      label: "Lyria 3 Clip (30s)",
      tier: "paid",
      description: "30-second background music beds & jingles",
      contextWindow: "30s audio clip",
      recommendedFor: "Short-form video background beds & branded sonic hooks",
      capabilities: {
        audioGeneration: true,
      },
    },
    {
      id: "lyria-3-pro-preview",
      label: "Lyria 3 Pro (Full Track)",
      tier: "paid",
      description: "Full-length custom soundtrack generation",
      contextWindow: "Full-length track",
      recommendedFor: "Long-form YouTube demos, launch trailers & podcast beds",
      capabilities: {
        audioGeneration: true,
      },
    },
  ],
  transcription: [
    {
      id: "gemini-3.5-transcribe",
      label: "Gemini 3.5 Transcribe",
      tier: "standard",
      description: "Pre-recorded speech-to-text transcription",
      contextWindow: "Audio-to-text",
      recommendedFor: "Captions, interview transcripts & spoken script extraction",
      capabilities: {
        text: true,
        multimodalInput: true,
      },
    },
  ],
  live: [
    {
      id: "gemini-3.8-live",
      label: "Gemini 3.8 Live Voice",
      tier: "standard",
      description: "Real-time bidirectional voice strategy session",
      contextWindow: "Low-latency audio stream",
      recommendedFor: "Live brainstorming & hands-free creative direction",
      capabilities: {
        text: true,
        audioGeneration: true,
        multimodalInput: true,
      },
    },
  ],
  decision: [
    {
      id: "gemini-decision-1",
      label: "Gemini Decision 1",
      tier: "standard",
      description: "Calibrated yes/no gates & rubric scoring",
      contextWindow: "Calibrated evaluation",
      recommendedFor: "Audience readiness scoring & automated QA approval thresholds",
      capabilities: {
        text: true,
      },
    },
  ],
} as const;

const ALLOWED_TEXT_IDS = new Set<string>(MODEL_CATALOG.text.map((m) => m.id));
const ALLOWED_IMAGE_IDS = new Set<string>(MODEL_CATALOG.image.map((m) => m.id));
const ALLOWED_VOICE_IDS = new Set<string>(MODEL_CATALOG.voice.map((m) => m.id));
const ALLOWED_MUSIC_IDS = new Set<string>(MODEL_CATALOG.music.map((m) => m.id));

export function resolveTextModel(model?: string): string {
  if (model && ALLOWED_TEXT_IDS.has(model)) return model;
  return "gemini-4-hydrogen";
}

export function resolveImageModel(model?: string): string {
  if (model === "gemini-3-pro-image-preview") return "gemini-3-pro-image";
  if (model && ALLOWED_IMAGE_IDS.has(model)) return model;
  return "gemini-3.1-flash-lite-image";
}

export function resolveVoiceModel(model?: string): string {
  if (model && ALLOWED_VOICE_IDS.has(model)) return model;
  return "gemini-3.8-flash-lite-tts";
}

export function resolveMusicModel(model?: string): string {
  if (model && ALLOWED_MUSIC_IDS.has(model)) return model;
  return "lyria-3-clip-preview";
}

export function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === "MY_GEMINI_API_KEY") {
    const isVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
    const err = new Error(
      isVercel
        ? "GEMINI_API_KEY is not configured in Vercel Environment Variables. Run `npm run vercel:env` (or set GEMINI_API_KEY in Vercel Project Settings -> Environment Variables) and redeploy."
        : "GEMINI_API_KEY is not configured. Please add your Gemini API key in AI Studio Settings > Secrets or .env.",
    ) as Error & { status?: number };
    err.status = 503;
    throw err;
  }
  return key;
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = requireApiKey();
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export function getDecisionsClient(): GoogleGenAI {
  const apiKey = requireApiKey();
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export function thinkingConfigForModel(model: string, depth: "low" | "medium" | "high" = "medium") {
  if (model === "gemini-3.1-flash-lite") {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  if (depth === "low") return { thinkingLevel: ThinkingLevel.LOW };
  if (depth === "high") return { thinkingLevel: ThinkingLevel.HIGH };
  return { thinkingLevel: ThinkingLevel.MEDIUM };
}

export function parseJsonSafe<T>(raw: string | undefined, fallback?: T): T {
  const text = (raw || "").trim();
  if (!text) {
    if (fallback !== undefined) return fallback;
    throw new Error("Empty model response");
  }
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i) || text.match(/```([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const braceMatch = candidate.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[1]) as T;
      } catch {
        // ignore
      }
    }
    if (fallback !== undefined) return fallback;
    throw new Error("Failed to parse structured JSON from Gemini response.");
  }
}

export function formatGeminiError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const explicitStatus = (err as { status?: number })?.status;
  if (msg.includes("GEMINI_API_KEY is not configured")) {
    return { status: 400, message: msg };
  }
  if (msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID") || explicitStatus === 403) {
    return {
      status: 403,
      message:
        "Gemini API access denied or invalid API key. Check your GEMINI_API_KEY in AI Studio Settings > Secrets.",
    };
  }
  if (msg.includes("RESOURCE_EXHAUSTED") || explicitStatus === 429) {
    return {
      status: 429,
      message:
        "Gemini API quota exceeded or paid-tier key required for this model. Verify your billing-enabled API key in AI Studio Settings > Secrets.",
    };
  }
  if (msg.includes("NOT_FOUND") || explicitStatus === 404) {
    return {
      status: 404,
      message: `Requested Gemini model was not found or is unsupported: ${msg}`,
    };
  }
  return {
    status: explicitStatus && explicitStatus >= 400 && explicitStatus < 600 ? explicitStatus : 500,
    message: msg || "Unexpected AI service error",
  };
}

export function buildBusinessContextPrompt(business: Record<string, unknown> | undefined): string {
  if (!business) return "Business: General SaaS/Brand.";
  const lines = [
    `Business Name: ${String(business.name || "Unknown")}`,
    business.websiteUrl ? `Website: ${String(business.websiteUrl)}` : "",
    business.industry ? `Industry: ${String(business.industry)}` : "",
    business.description ? `Description: ${String(business.description)}` : "",
    business.location ? `Location: ${String(business.location)}` : "",
    business.targetCountries ? `Target Markets: ${String(business.targetCountries)}` : "",
    business.positioning ? `Positioning: ${String(business.positioning)}` : "",
    business.valueProposition ? `Value Proposition: ${String(business.valueProposition)}` : "",
    business.brandVoiceNotes ? `Brand Voice: ${String(business.brandVoiceNotes)}` : "",
    business.wordsToUse ? `Preferred Terms: ${String(business.wordsToUse)}` : "",
    business.wordsToAvoid ? `Words to Avoid: ${String(business.wordsToAvoid)}` : "",
    Array.isArray(business.products) && business.products.length
      ? `Product Surfaces: ${business.products.join(", ")}`
      : "",
    Array.isArray(business.objectives) && business.objectives.length
      ? `Objectives: ${business.objectives.join(", ")}`
      : "",
    Array.isArray(business.channels) && business.channels.length
      ? `Priority Channels: ${business.channels.join(", ")}`
      : "",
  ].filter(Boolean);
  return lines.join("\n");
}
