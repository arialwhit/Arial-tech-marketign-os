import type { ModelCatalog, WorkspaceProfile } from "../types/marketing";

export const LOCAL_PHOTOS = {
  hero: "/src/assets/images/hero_fitness_workout_1795103015680.jpg",
  ava1: "/src/assets/images/avatar_maya_coach_1795103015230.jpg",
  ava2: "/src/assets/images/avatar_theo_guide_1795103015303.jpg",
  ava3: "/src/assets/images/avatar_eli_expert_1795103014390.jpg",
  ava4: "/src/assets/images/avatar_nina_mentor_1795103014748.jpg",
  ava5: "/src/assets/images/avatar_sasha_host_1795103014792.jpg",
};

export const DEFAULT_MODEL_CATALOG: ModelCatalog = {
  text: [
    {
      id: "gemini-4-hydrogen",
      label: "Gemini 4 Hydrogen (Flash)",
      tier: "standard",
      description: "Fast reasoning, strategy, grounded research & daily marketing agents",
    },
    {
      id: "gemini-4-neon",
      label: "Gemini 4 Neon (Pro)",
      tier: "paid",
      description: "Deep complex reasoning, campaign architecture, multi-modal analysis",
    },
    {
      id: "gemini-4-carbon",
      label: "Gemini 4 Carbon",
      tier: "paid",
      description: "Maximum analytical depth for competitive & growth audits",
    },
    {
      id: "gemini-3.1-flash-lite",
      label: "Gemini 3.1 Flash Lite",
      tier: "standard",
      description: "Ultra-low-latency quick edits, summaries, and classifications",
    },
  ],
  image: [
    {
      id: "gemini-nano-banana-2.1",
      label: "Nano Banana 2.1 (1K–4K)",
      tier: "paid",
      description: "High-res 1K/2K/4K studio visuals + Google Image Search grounding",
    },
    {
      id: "gemini-3.1-flash-lite-image",
      label: "Nano Banana 2 Lite",
      tier: "paid",
      description: "Fast general image generation and creative editing",
    },
    {
      id: "gemini-3-pro-image",
      label: "Nano Banana Pro",
      tier: "paid",
      description: "Studio-grade typography, product scenes, and art direction",
    },
  ],
  video: [
    {
      id: "gemini-omni-1.2-flash",
      label: "Gemini Omni 1.2 Flash (Veo)",
      tier: "paid",
      description: "Text-to-video, image-to-video animation, editing & extension",
    },
  ],
  voice: [
    {
      id: "gemini-3.8-flash-lite-tts",
      label: "Gemini 3.8 Flash Lite TTS",
      tier: "standard",
      description: "Fast, natural single-speaker marketing voiceovers",
    },
    {
      id: "gemini-3.8-flash-tts",
      label: "Gemini 3.8 Flash TTS (Voice Design)",
      tier: "standard",
      description: "Dual-speaker dialogue, vocal bursts & custom voice direction",
    },
  ],
  music: [
    {
      id: "lyria-3-clip-preview",
      label: "Lyria 3 Clip (30s)",
      tier: "paid",
      description: "30-second background music beds & jingles",
    },
    {
      id: "lyria-3-pro-preview",
      label: "Lyria 3 Pro (Full Track)",
      tier: "paid",
      description: "Full-length custom soundtrack generation",
    },
  ],
  transcription: [
    {
      id: "gemini-3.5-transcribe",
      label: "Gemini 3.5 Transcribe",
      tier: "standard",
      description: "Microphone & recorded audio speech-to-text transcription",
    },
  ],
  live: [
    {
      id: "gemini-3.8-live",
      label: "Gemini 3.8 Live Voice",
      tier: "standard",
      description: "Real-time bidirectional voice strategy session",
    },
  ],
  decision: [
    {
      id: "gemini-decision-1",
      label: "Gemini Decision 1",
      tier: "standard",
      description: "Calibrated yes/no gates & rubric scoring",
    },
  ],
};

export function createDefaultWorkspace(ownerId = ""): WorkspaceProfile {
  const id = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    ownerId,
    name: "",
    websiteUrl: "",
    industry: "SaaS & Developer Tools",
    companySize: "2–10 people",
    description: "",
    location: "",
    targetCountries: "",
    products: [],
    objectives: [],
    channels: [],
    positioning: "",
    valueProposition: "",
    brandVoiceNotes: "",
    wordsToUse: "",
    wordsToAvoid: "",
    voiceSliders: [50, 50, 50, 50],
    preferredTextModel: "gemini-4-hydrogen",
    preferredImageModel: "gemini-nano-banana-2.1",
    preferredVideoModel: "gemini-omni-1.2-flash",
    preferredVoiceModel: "gemini-3.8-flash-lite-tts",
    credits: 10000,
    plan: "pro",
    onboarded: false,
  };
}
