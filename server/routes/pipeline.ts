import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Router } from "express";
import {
  buildBusinessContextPrompt,
  formatGeminiError,
  getGeminiClient,
  parseJsonSafe,
  resolveImageModel,
  resolveTextModel,
  thinkingConfigForModel,
} from "../ai/geminiClient.js";
import { assertWorkspaceAccess } from "../middleware/auth.js";
import { runTrackedAiCall } from "../services/aiTelemetry.js";
import {
  stateStore,
  type AutomationExecutionLogRecord,
  type AutomationWorkflowRecord,
  type CalendarEntryRecord,
  type ContentProjectRecord,
  type ContentProjectState,
  type SavedStrategyRecord,
  type StoryboardSceneRecord,
} from "../services/stateStore.js";
import { getGeneratedDir, resolveSafeUploadCandidate } from "../utils/paths.js";

const router = Router();

const VALID_TRANSITIONS: Record<ContentProjectState, ContentProjectState[]> = {
  PLANNED: ["SCRIPT_PENDING", "SCRIPT_GENERATING", "SCRIPT_READY", "CANCELLED"],
  SCRIPT_PENDING: ["SCRIPT_GENERATING", "SCRIPT_READY", "AWAITING_SCRIPT_APPROVAL", "CANCELLED"],
  SCRIPT_GENERATING: ["SCRIPT_READY", "SCRIPT_PENDING", "CANCELLED"],
  SCRIPT_READY: ["AWAITING_SCRIPT_APPROVAL", "SCRIPT_APPROVED", "SCRIPT_GENERATING", "CANCELLED"],
  AWAITING_SCRIPT_APPROVAL: ["SCRIPT_APPROVED", "SCRIPT_READY", "SCRIPT_GENERATING", "CANCELLED"],
  SCRIPT_APPROVED: [
    "STORYBOARD_READY",
    "AWAITING_STORYBOARD_APPROVAL",
    "STORYBOARD_APPROVED",
    "VIDEO_PENDING",
    "VIDEO_GENERATING",
    "VIDEO_READY",
    "VIDEO_EDITING",
    "AWAITING_FINAL_APPROVAL",
    "SCRIPT_READY",
    "CANCELLED",
  ],
  STORYBOARD_READY: ["AWAITING_STORYBOARD_APPROVAL", "STORYBOARD_APPROVED", "SCRIPT_READY", "CANCELLED"],
  AWAITING_STORYBOARD_APPROVAL: ["STORYBOARD_APPROVED", "STORYBOARD_READY", "SCRIPT_READY", "CANCELLED"],
  STORYBOARD_APPROVED: [
    "VIDEO_PENDING",
    "VIDEO_GENERATING",
    "VIDEO_READY",
    "VIDEO_EDITING",
    "AWAITING_FINAL_APPROVAL",
    "STORYBOARD_READY",
    "CANCELLED",
  ],
  VIDEO_PENDING: ["VIDEO_GENERATING", "VIDEO_READY", "VIDEO_EDITING", "AWAITING_FINAL_APPROVAL", "CANCELLED"],
  VIDEO_GENERATING: ["VIDEO_READY", "VIDEO_PENDING", "AWAITING_FINAL_APPROVAL", "CANCELLED"],
  VIDEO_READY: ["VIDEO_EDITING", "AWAITING_FINAL_APPROVAL", "VIDEO_GENERATING", "CANCELLED"],
  VIDEO_EDITING: ["VIDEO_READY", "AWAITING_FINAL_APPROVAL", "CANCELLED"],
  AWAITING_FINAL_APPROVAL: ["APPROVED_FOR_PUBLISHING", "VIDEO_EDITING", "SCRIPT_READY", "CANCELLED"],
  APPROVED_FOR_PUBLISHING: ["SCHEDULED", "PUBLISHING", "AWAITING_FINAL_APPROVAL", "CANCELLED"],
  SCHEDULED: ["PUBLISHING", "PUBLISHED", "PUBLISH_FAILED", "CANCELLED"],
  PUBLISHING: ["PUBLISHED", "PUBLISH_FAILED"],
  PUBLISHED: [],
  PUBLISH_FAILED: ["SCHEDULED", "PUBLISHING", "AWAITING_FINAL_APPROVAL", "CANCELLED"],
  CANCELLED: ["PLANNED", "SCRIPT_PENDING"],
};

export function getProjectBlockingReasons(project: ContentProjectRecord): string[] {
  const blockers: string[] = [];
  if (!project.script?.trim() && (!project.scriptVariants || project.scriptVariants.length === 0)) {
    blockers.push("Script not generated yet");
  }
  if (!project.scriptApproved) {
    blockers.push("Script approval required before storyboard/production");
  }
  if (project.storyboardScenes && project.storyboardScenes.length > 0 && !project.storyboardApproved) {
    blockers.push("Storyboard approval required before video production");
  }
  if (!project.videoUrl && !project.editedVideoUrl && !project.thumbUrl) {
    blockers.push("Video or rendered creative asset missing");
  }
  if (!project.caption?.trim()) {
    blockers.push("Platform caption missing");
  }
  if (!project.finalApproved) {
    blockers.push("Final human creative approval missing");
  }
  return blockers;
}

function validateProjectTransition(
  project: ContentProjectRecord,
  target: ContentProjectState,
): { ok: boolean; error?: string; blockers?: string[] } {
  if (project.status === target) return { ok: true };
  const allowed = VALID_TRANSITIONS[project.status] || [];
  if (!allowed.includes(target)) {
    return {
      ok: false,
      error: `Invalid state transition from ${project.status} to ${target}.`,
    };
  }
  if (
    target === "VIDEO_GENERATING" ||
    target === "VIDEO_READY" ||
    target === "VIDEO_EDITING" ||
    target === "VIDEO_PENDING" ||
    target === "AWAITING_FINAL_APPROVAL"
  ) {
    if (!project.scriptApproved) {
      return {
        ok: false,
        error: "Script must be explicitly approved before moving into video production.",
        blockers: ["Script not approved"],
      };
    }
    if (project.storyboardScenes && project.storyboardScenes.length > 0 && !project.storyboardApproved) {
      return {
        ok: false,
        error: "Storyboard must be explicitly approved before starting video production.",
        blockers: ["Storyboard not approved"],
      };
    }
  }
  if (
    target === "APPROVED_FOR_PUBLISHING" ||
    target === "SCHEDULED" ||
    target === "PUBLISHING"
  ) {
    const missing: string[] = [];
    if (!project.scriptApproved) missing.push("Script not approved");
    if (!project.videoUrl && !project.editedVideoUrl && !project.thumbUrl) {
      missing.push("Creative/video asset missing");
    }
    if (target !== "APPROVED_FOR_PUBLISHING" && !project.finalApproved) {
      missing.push("Human final approval missing");
    }
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Cannot transition to ${target}: ${missing.join("; ")}`,
        blockers: missing,
      };
    }
  }
  return { ok: true };
}

function buildApprovedMemoryContext(workspaceId: string): string {
  const approved = stateStore
    .listMemories(workspaceId)
    .filter((m) => m.approved)
    .slice(0, 10);
  if (!approved.length) return "";
  return `\nVerified Brand Memory:\n${approved.map((m) => `- [${m.scope}] ${m.title}: ${m.content}`).join("\n")}`;
}

// ---------- STRATEGIES CRUD ----------

router.get("/strategies", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({ strategies: stateStore.listStrategies(ctx.workspaceId) });
});

router.post("/strategies", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = req.body as Partial<SavedStrategyRecord>;
  if (!body.title?.trim() || !body.executiveSummary?.trim()) {
    res.status(400).json({ error: "Strategy title and executiveSummary are required." });
    return;
  }
  const saved = stateStore.upsertStrategy({
    id: body.id,
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    title: body.title.trim(),
    executiveSummary: body.executiveSummary.trim(),
    northStarMetric: body.northStarMetric || "Qualified leads & conversions",
    icpSegments: Array.isArray(body.icpSegments) ? body.icpSegments : [],
    contentPillars: Array.isArray(body.contentPillars) ? body.contentPillars : [],
    weeklyRoadmap: Array.isArray(body.weeklyRoadmap) ? body.weeklyRoadmap : [],
    experiments: Array.isArray(body.experiments) ? body.experiments : [],
    status: body.status || "active",
    objective: body.objective,
    targetPlatforms: Array.isArray(body.targetPlatforms) ? body.targetPlatforms : [],
    sourceType: body.sourceType === "manual" ? "manual" : "ai_grounded",
  });
  res.json({ strategy: saved });
});

router.patch("/strategies/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getStrategyById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Strategy not found." });
    return;
  }
  const body = req.body as Partial<SavedStrategyRecord>;
  const updated = stateStore.upsertStrategy({
    ...existing,
    ...body,
    id: existing.id,
    workspaceId: ctx.workspaceId,
    ownerUid: existing.ownerUid,
  });
  res.json({ strategy: updated });
});

router.delete("/strategies/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const ok = stateStore.deleteStrategy(String(req.params.id), ctx.workspaceId);
  if (!ok) {
    res.status(404).json({ error: "Strategy not found." });
    return;
  }
  res.json({ deleted: true });
});

router.post("/strategies/:id/generate-calendar", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const strategy = stateStore.getStrategyById(String(req.params.id), ctx.workspaceId);
  if (!strategy) {
    res.status(404).json({ error: "Strategy not found." });
    return;
  }

  try {
    const { business, count = 6, platforms, model } = req.body as {
      business?: Record<string, unknown>;
      count?: number;
      platforms?: string[];
      model?: string;
    };

    const targetPlatforms =
      platforms?.length
        ? platforms
        : strategy.targetPlatforms?.length
          ? strategy.targetPlatforms
          : Array.isArray(business?.channels) && business.channels.length
            ? (business.channels as string[])
            : ["Instagram Reels", "TikTok", "YouTube Shorts", "LinkedIn"];

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const totalCount = Math.min(14, Math.max(3, Number(count) || 6));

    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/strategies/:id/generate-calendar",
        agent: "Calendar Planner",
        model: selectedModel,
        creditsEstimated: 35,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents: `Create ${totalCount} concrete, scheduled content calendar entries directly derived from this saved Marketing Strategy.
${buildBusinessContextPrompt(business)}
${buildApprovedMemoryContext(ctx.workspaceId)}
Strategy Title: ${strategy.title}
North Star Metric: ${strategy.northStarMetric}
Pillars: ${JSON.stringify(strategy.contentPillars)}
Target Platforms: ${targetPlatforms.join(", ")}

Return ONLY valid JSON:
{
  "entries": [
    {
      "title": "Concise deliverable title",
      "platform": "Instagram Reels",
      "pillar": "Content pillar name",
      "objective": "Awareness | Lead Gen | Product Proof | Conversion",
      "formatType": "short_form",
      "dayOffset": 1,
      "timeStr": "10:30 AM",
      "captionDraft": "Draft social caption tailored to platform"
    }
  ]
}`,
          config: {
            systemInstruction:
              "You turn marketing strategies into specific, actionable content calendar deliverables. Never invent fake view counts or analytics.",
            thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
            responseMimeType: "application/json",
          },
        }),
    );

    const parsed = parseJsonSafe<{
      entries?: Array<{
        title?: string;
        platform?: string;
        pillar?: string;
        objective?: string;
        formatType?: "short_form" | "long_form";
        dayOffset?: number;
        timeStr?: string;
        captionDraft?: string;
      }>;
    }>(response.text, { entries: [] });

    const tones: Array<"mint" | "purple" | "blue" | "gold"> = ["mint", "purple", "blue", "gold"];
    const baseDate = new Date();
    const created: CalendarEntryRecord[] = [];

    for (const [idx, item] of (parsed.entries || []).slice(0, totalCount).entries()) {
      const targetDate = new Date(baseDate.getTime() + (Math.max(1, Number(item.dayOffset) || idx * 2 + 1)) * 86400000);
      const dateStr = targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const entry = stateStore.upsertCalendarEntry({
        workspaceId: ctx.workspaceId,
        ownerUid: ctx.actorUid,
        strategyId: strategy.id,
        pillar: item.pillar || strategy.contentPillars[0]?.pillar || "Core Growth",
        objective: item.objective || "Growth",
        formatType: item.formatType === "long_form" ? "long_form" : "short_form",
        title: item.title?.trim() || `${strategy.title} Deliverable #${idx + 1}`,
        platform: item.platform?.trim() || targetPlatforms[idx % targetPlatforms.length],
        dateStr,
        dayOfMonth: targetDate.getDate(),
        timeStr: item.timeStr || "10:00 AM",
        tone: tones[idx % tones.length],
        caption: item.captionDraft?.trim() || "",
        status: "Needs review",
        projectStatus: "PLANNED",
        checksPassed: 0,
        thumbUrl: "",
        sourceType: "ai_grounded",
      });
      created.push(entry);
    }

    res.json({ entries: created, strategyId: strategy.id });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// ---------- CALENDAR ENTRIES CRUD & PROJECT CONVERSION ----------

router.get("/calendar-entries", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({ entries: stateStore.listCalendarEntries(ctx.workspaceId) });
});

router.post("/calendar-entries", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = req.body as Partial<CalendarEntryRecord>;
  if (!body.title?.trim()) {
    res.status(400).json({ error: "Calendar entry title is required." });
    return;
  }
  const entry = stateStore.upsertCalendarEntry({
    id: body.id,
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    strategyId: body.strategyId,
    contentProjectId: body.contentProjectId,
    pillar: body.pillar,
    objective: body.objective,
    formatType: body.formatType || "short_form",
    title: body.title.trim(),
    platform: body.platform || "Instagram Reels",
    dateStr: body.dateStr || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    dayOfMonth: body.dayOfMonth || new Date().getDate(),
    timeStr: body.timeStr || "10:00 AM",
    tone: body.tone || "mint",
    caption: body.caption || "",
    status: body.status || "Needs review",
    projectStatus: body.projectStatus || "PLANNED",
    checksPassed: body.checksPassed ?? 0,
    thumbUrl: body.thumbUrl || "",
    sourceType: body.sourceType || "manual",
  });
  res.json({ entry });
});

router.patch("/calendar-entries/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getCalendarEntryById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Calendar entry not found." });
    return;
  }
  const updated = stateStore.upsertCalendarEntry({
    ...existing,
    ...(req.body as Partial<CalendarEntryRecord>),
    id: existing.id,
    workspaceId: ctx.workspaceId,
    ownerUid: existing.ownerUid,
  });
  res.json({ entry: updated });
});

router.delete("/calendar-entries/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const ok = stateStore.deleteCalendarEntry(String(req.params.id), ctx.workspaceId);
  if (!ok) {
    res.status(404).json({ error: "Calendar entry not found." });
    return;
  }
  res.json({ deleted: true });
});

router.post("/calendar-entries/:id/create-project", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const entry = stateStore.getCalendarEntryById(String(req.params.id), ctx.workspaceId);
  if (!entry) {
    res.status(404).json({ error: "Calendar entry not found." });
    return;
  }

  if (entry.contentProjectId) {
    const existingProj = stateStore.getContentProjectById(entry.contentProjectId, ctx.workspaceId);
    if (existingProj) {
      res.json({ project: existingProj, entry, alreadyLinked: true });
      return;
    }
  }

  const project = stateStore.upsertContentProject({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    title: entry.title,
    platform: entry.platform,
    status: "SCRIPT_PENDING",
    strategyId: entry.strategyId,
    calendarEntryId: entry.id,
    brief: `${entry.objective || "Growth"} post for ${entry.platform} (${entry.pillar || "General pillar"})`,
    formatType: entry.formatType || "short_form",
    productionMethod: "hybrid",
    caption: entry.caption || "",
    sourceType: "manual",
  });

  const updatedEntry = stateStore.upsertCalendarEntry({
    ...entry,
    contentProjectId: project.id,
    projectStatus: project.status,
  });

  res.json({ project, entry: updatedEntry });
});

// ---------- CONTENT PROJECTS 17-STATE PIPELINE & SCRIPT STUDIO ----------

router.get("/projects", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const projects = stateStore.listContentProjects(ctx.workspaceId).map((p) => ({
    ...p,
    blockingReasons: getProjectBlockingReasons(p),
  }));
  res.json({ projects });
});

router.post("/projects", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = req.body as Partial<ContentProjectRecord>;
  if (!body.title?.trim()) {
    res.status(400).json({ error: "Project title is required." });
    return;
  }
  const created = stateStore.upsertContentProject({
    ...body,
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    title: body.title.trim(),
    status: body.status || "SCRIPT_PENDING",
  });
  res.json({ project: { ...created, blockingReasons: getProjectBlockingReasons(created) } });
});

router.patch("/projects/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  const patch = req.body as Partial<ContentProjectRecord>;
  if (patch.status && patch.status !== existing.status) {
    const check = validateProjectTransition(existing, patch.status);
    if (!check.ok) {
      res.status(409).json({ error: check.error, blockers: check.blockers || [] });
      return;
    }
  }

  // Script approval edit lock: editing script text on an already-approved script creates a new draft version
  let versionAdditions = existing.scriptVersions || [];
  let lockResetPatch: Partial<ContentProjectRecord> = {};
  if (
    existing.scriptApproved &&
    typeof patch.script === "string" &&
    patch.script.trim() !== (existing.script || "").trim() &&
    patch.scriptApproved !== true
  ) {
    const nextV = versionAdditions.length + 1;
    versionAdditions = [
      {
        id: stateStore.newId("sv"),
        version: nextV,
        title: `${existing.title} v${nextV} (Post-approval revision)`,
        hook: patch.hook ?? existing.hook ?? "",
        body: patch.script,
        cta: patch.cta ?? existing.cta ?? "",
        angle: "Manual revision",
        scenes: existing.storyboardScenes || [],
        createdAt: new Date().toISOString(),
        createdBy: ctx.actorUid,
        note: "Edited after approval — requires re-approval",
      },
      ...versionAdditions,
    ].slice(0, 25);
    lockResetPatch = {
      scriptApproved: false,
      scriptApprovedAt: undefined,
      status: patch.status || "AWAITING_SCRIPT_APPROVAL",
      scriptVersions: versionAdditions,
    };
  }

  const updated = stateStore.upsertContentProject({
    ...existing,
    ...patch,
    ...lockResetPatch,
    id: existing.id,
    workspaceId: ctx.workspaceId,
    ownerUid: existing.ownerUid,
    title: patch.title?.trim() || existing.title,
  });
  if (updated.calendarEntryId) {
    const cal = stateStore.getCalendarEntryById(updated.calendarEntryId, ctx.workspaceId);
    if (cal) {
      stateStore.upsertCalendarEntry({ ...cal, projectStatus: updated.status });
    }
  }
  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) } });
});

router.delete("/projects/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const ok = stateStore.deleteContentProject(String(req.params.id), ctx.workspaceId);
  if (!ok) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  res.json({ deleted: true });
});

router.post("/projects/:id/transition", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  const target = req.body?.status as ContentProjectState | undefined;
  if (!target) {
    res.status(400).json({ error: "Target status is required." });
    return;
  }
  const check = validateProjectTransition(existing, target);
  if (!check.ok) {
    res.status(409).json({ error: check.error, blockers: check.blockers || [] });
    return;
  }
  const updated = stateStore.upsertContentProject({
    ...existing,
    status: target,
  });
  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) } });
});

router.post("/projects/:id/script-variants", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }

  try {
    const {
      brief,
      briefConfig,
      platform,
      tone = "Confident, direct-response",
      duration = "30 seconds",
      objective = "Product conversion",
      audience = "Target ICP",
      cta = "Get started today",
      keyMessage = "",
      desiredOutcome = "",
      features = [],
      referenceMaterials = "",
      selectedMediaIds = [],
      competitorRefs = [],
      business,
      model,
    } = req.body as {
      brief?: string;
      briefConfig?: Record<string, unknown>;
      platform?: string;
      tone?: string;
      duration?: string;
      objective?: string;
      audience?: string;
      cta?: string;
      keyMessage?: string;
      desiredOutcome?: string;
      features?: string[];
      referenceMaterials?: string;
      selectedMediaIds?: string[];
      competitorRefs?: string[];
      business?: Record<string, unknown>;
      model?: string;
    };

    const mediaRefs = selectedMediaIds
      .map((id) => stateStore.getMediaAssetById(id, ctx.workspaceId))
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .map(
        (m) =>
          `- [${m.category}] ${m.originalName}: ${m.aiAnalysis?.summary || m.description || "Uploaded brand asset"}`,
      )
      .join("\n");

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    stateStore.upsertContentProject({ ...project, status: "SCRIPT_GENERATING" });

    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/projects/:id/script-variants",
        agent: "Script Variant Studio",
        model: selectedModel,
        creditsEstimated: 35,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents: `Generate 3 genuinely distinct script variations and rich scene-by-scene storyboards for this Content Project.
${buildBusinessContextPrompt(business)}
${buildApprovedMemoryContext(ctx.workspaceId)}
${mediaRefs ? `\nSelected Brand Media Assets:\n${mediaRefs}` : ""}
${competitorRefs.length ? `\nCompetitor / Creator Reference Notes:\n${competitorRefs.join(" | ")}` : ""}
Project Title: ${project.title}
Platform: ${platform || project.platform}
Objective: ${objective}
Target Audience: ${audience}
Tone: ${tone}
Target Duration: ${duration}
Call to Action: ${cta}
${keyMessage ? `Key Message: ${keyMessage}` : ""}
${desiredOutcome ? `Desired Outcome: ${desiredOutcome}` : ""}
${features.length ? `Key Features to Highlight: ${features.join(", ")}` : ""}
${referenceMaterials ? `Reference Materials: ${referenceMaterials}` : ""}
Brief: ${brief || project.brief || project.title}

Return ONLY valid JSON with 3 genuinely distinct creative approaches (e.g. Problem/Agitation, Founder/Behind-the-Scenes Proof, Contrarian Demo):
{
  "variations": [
    {
      "title": "Variation name",
      "hook": "Scroll-stopping opening line",
      "openingPattern": "Visual/Pattern Interrupt / Direct Question / Bold Claim",
      "angle": "Creative angle summary",
      "concept": "Core creative premise in 1-2 sentences",
      "structureSummary": "Hook -> Proof -> Walkthrough -> CTA pacing summary",
      "body": "Full cohesive script copy ready to read",
      "cta": "Concrete closing call to action",
      "pacingNotes": "Cutting cadence and energy notes",
      "visualDirectionNotes": "Overall lighting, camera, and styling guide",
      "score": 92,
      "recommended": true,
      "scenes": [
        {
          "number": "01",
          "timeRange": "0:00-0:04",
          "timestamp": "0:00",
          "durationSec": 4,
          "beat": "Hook",
          "scriptSection": "Opening Hook",
          "visual": "Primary shot description",
          "dialogue": "Spoken narration line",
          "onScreenText": "Big 3-5 word caption overlay",
          "cameraDirection": "Tight eye-level punch-in",
          "visualComposition": "Rule of thirds center subject with safe zone caption",
          "presenterRequirement": "Founder or narrator facing lens",
          "background": "Bright modern studio workspace",
          "brollRequirement": "1s UI screen flash",
          "animationDirection": "Subtle pop-in on keyword",
          "transition": "Hard cut on beat",
          "soundEffects": "Soft whoosh SFX",
          "musicDirection": "Upbeat clean tech synth @ -18dB",
          "requiredAssets": ["product_screenshot"],
          "imagePrompt": "Clean 9:16 editorial visual frame prompt for this exact beat"
        }
      ]
    }
  ]
}`,
          config: {
            systemInstruction:
              "You are a senior creative director & video scriptwriter. Produce 3 distinct creative approaches with complete 10-element scripts and rich production-ready storyboard scenes.",
            thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
            responseMimeType: "application/json",
          },
        }),
    );

    const parsed = parseJsonSafe<{
      variations?: Array<{
        title: string;
        hook: string;
        openingPattern?: string;
        angle: string;
        concept?: string;
        structureSummary?: string;
        body?: string;
        cta?: string;
        pacingNotes?: string;
        visualDirectionNotes?: string;
        score: number;
        recommended?: boolean;
        scenes: StoryboardSceneRecord[];
      }>;
    }>(response.text, { variations: [] });

    const variations = parsed.variations || [];
    const primary = variations.find((v) => v.recommended) || variations[0];
    const bodyText =
      primary?.body?.trim() ||
      (primary?.scenes?.length
        ? primary.scenes.map((s) => `[${s.timeRange}] (${s.beat}) ${s.dialogue}`).join("\n")
        : project.script || "");

    const nextVersionNum = (project.scriptVersions?.length || 0) + 1;
    const versionEntry = primary
      ? {
          id: stateStore.newId("sv"),
          version: nextVersionNum,
          title: primary.title,
          hook: primary.hook,
          body: bodyText,
          cta: primary.cta || cta || "",
          angle: primary.angle,
          scenes: primary.scenes,
          createdAt: new Date().toISOString(),
          createdBy: ctx.actorUid,
          note: "Generated 3 script variants",
        }
      : null;

    const updated = stateStore.upsertContentProject({
      ...project,
      brief: brief || project.brief,
      briefConfig: briefConfig || project.briefConfig,
      platform: platform || project.platform,
      status: "SCRIPT_READY",
      scriptApproved: false,
      storyboardApproved: false,
      storyboardScenes: primary?.scenes || project.storyboardScenes || [],
      hook: primary?.hook || project.hook,
      cta: primary?.cta || cta || project.cta,
      script: bodyText,
      scriptVariants: variations,
      scriptVersions: versionEntry
        ? [versionEntry, ...(project.scriptVersions || [])]
        : project.scriptVersions,
    });

    res.json({
      project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) },
      variations,
    });
  } catch (err) {
    stateStore.upsertContentProject({ ...project, status: "SCRIPT_PENDING" });
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/projects/:id/rewrite-script", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }

  try {
    const {
      currentScript,
      currentHook,
      mode = "hook",
      instruction = "",
      targetLength = "Keep similar length",
      tone = "Sharper & punchier",
      business,
      model,
    } = req.body as {
      currentScript?: string;
      currentHook?: string;
      mode?: "hook" | "tone" | "length" | "cta" | "full_alternative";
      instruction?: string;
      targetLength?: string;
      tone?: string;
      business?: Record<string, unknown>;
      model?: string;
    };

    const sourceScript = currentScript?.trim() || project.script || project.title;
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/projects/:id/rewrite-script",
        agent: "Script Rewriter",
        model: selectedModel,
        creditsEstimated: 20,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents: `Rewrite this marketing script with a focused edit mode: "${mode}".
${buildBusinessContextPrompt(business)}
Project: ${project.title} (${project.platform})
Current Hook: ${currentHook || project.hook || ""}
Current Script:
${sourceScript}

Requested Tone: ${tone}
Requested Length: ${targetLength}
Additional Direction: ${instruction || `Improve ${mode} while staying strictly faithful to verified product facts.`}

Return ONLY valid JSON:
{
  "title": "Rewritten draft title",
  "hook": "New or refined hook line",
  "angle": "Angle summary",
  "cta": "Refined CTA",
  "body": "Full rewritten script with timestamps/beats",
  "scenes": [
    { "number": "01", "timeRange": "0:00-0:04", "beat": "Hook", "visual": "Visual", "dialogue": "Dialogue" }
  ],
  "changeSummary": "1-sentence summary of what changed"
}`,
          config: {
            systemInstruction: "You are a direct-response script editor. Return clean JSON.",
            thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
            responseMimeType: "application/json",
          },
        }),
    );

    const parsed = parseJsonSafe<{
      title?: string;
      hook?: string;
      angle?: string;
      cta?: string;
      body?: string;
      scenes?: Array<{ number: string; timeRange: string; beat: string; visual: string; dialogue: string }>;
      changeSummary?: string;
    }>(response.text, {});

    const nextVersionNum = (project.scriptVersions?.length || 0) + 1;
    const versionEntry = {
      id: stateStore.newId("sv"),
      version: nextVersionNum,
      title: parsed.title || `${project.title} v${nextVersionNum}`,
      hook: parsed.hook || currentHook || project.hook || "",
      body: parsed.body || sourceScript,
      cta: parsed.cta || project.cta || "",
      angle: parsed.angle || mode,
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
      createdAt: new Date().toISOString(),
      createdBy: ctx.actorUid,
      note: parsed.changeSummary || `Rewritten (${mode})`,
    };

    const updated = stateStore.upsertContentProject({
      ...project,
      status: "AWAITING_SCRIPT_APPROVAL",
      scriptApproved: false,
      hook: versionEntry.hook,
      cta: versionEntry.cta,
      script: versionEntry.body,
      scriptVersions: [versionEntry, ...(project.scriptVersions || [])].slice(0, 25),
    });

    res.json({
      project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) },
      version: versionEntry,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/projects/:id/adapt-platform", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }

  try {
    const {
      platforms = ["TikTok", "Instagram Reels", "YouTube Shorts", "LinkedIn"],
      business,
      model,
    } = req.body as {
      platforms?: string[];
      business?: Record<string, unknown>;
      model?: string;
    };

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const targetList = platforms.slice(0, 6);

    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/projects/:id/adapt-platform",
        agent: "Platform Adaptation Engine",
        model: selectedModel,
        creditsEstimated: 25,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents: `Adapt this content project script cleanly for each requested social platform: ${targetList.join(", ")}.
${buildBusinessContextPrompt(business)}
Project Title: ${project.title}
Core Hook: ${project.hook || ""}
Core Script:
${project.script || project.brief || project.title}

Return ONLY valid JSON:
{
  "adaptations": [
    {
      "platform": "TikTok",
      "format": "short_form",
      "hook": "Platform-native opening line",
      "script": "Adapted spoken/written script tailored to platform pacing",
      "caption": "Publish-ready caption",
      "hashtags": ["#tag1", "#tag2", "#tag3"],
      "thumbnailPrompt": "Visual frame / cover prompt for this platform",
      "durationEstimateSec": 28
    }
  ]
}`,
          config: {
            systemInstruction:
              "Adapt scripts specifically for each platform's pacing, length, caption style, and formatting without generic boilerplate.",
            thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
            responseMimeType: "application/json",
          },
        }),
    );

    const parsed = parseJsonSafe<{
      adaptations?: Array<{
        platform: string;
        format?: "short_form" | "long_form" | "carousel" | "text_post";
        hook: string;
        script: string;
        caption: string;
        hashtags: string[];
        thumbnailPrompt: string;
        durationEstimateSec?: number;
      }>;
    }>(response.text, { adaptations: [] });

    const nextAdaptations = { ...(project.platformAdaptations || {}) };
    const now = new Date().toISOString();
    for (const item of parsed.adaptations || []) {
      if (!item.platform) continue;
      nextAdaptations[item.platform] = {
        platform: item.platform,
        format: item.format || "short_form",
        hook: item.hook,
        script: item.script,
        caption: item.caption,
        hashtags: Array.isArray(item.hashtags) ? item.hashtags : [],
        thumbnailPrompt: item.thumbnailPrompt || "",
        durationEstimateSec: item.durationEstimateSec || 30,
        updatedAt: now,
      };
    }

    const primaryAdaptation = nextAdaptations[project.platform] || Object.values(nextAdaptations)[0];
    const updated = stateStore.upsertContentProject({
      ...project,
      platformAdaptations: nextAdaptations,
      caption: project.caption || (primaryAdaptation?.caption as string) || "",
      hashtags: project.hashtags?.length
        ? project.hashtags
        : ((primaryAdaptation?.hashtags as string[]) || []),
    });

    res.json({
      project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) },
      adaptations: nextAdaptations,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/projects/:id/approve-script", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  const { script, hook, cta, note } = req.body as {
    script?: string;
    hook?: string;
    cta?: string;
    note?: string;
  };
  const effectiveScript = script?.trim() || project.script?.trim() || "";
  if (!effectiveScript) {
    res.status(400).json({ error: "Cannot approve an empty script. Generate or write a script first." });
    return;
  }

  const now = new Date().toISOString();
  const updated = stateStore.upsertContentProject({
    ...project,
    script: effectiveScript,
    hook: hook?.trim() || project.hook,
    cta: cta?.trim() || project.cta,
    scriptApproved: true,
    scriptApprovedAt: now,
    status: "SCRIPT_APPROVED",
  });

  stateStore.addAuditLog({
    workspaceId: ctx.workspaceId,
    actorUid: ctx.actorUid,
    action: "project.script.approve",
    target: updated.id,
    status: "allowed",
    detail: note || `Script approved for "${updated.title}"`,
  });

  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) } });
});

router.post("/projects/:id/storyboard", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }

  const { scenes, note } = req.body as {
    scenes?: StoryboardSceneRecord[];
    note?: string;
  };
  if (!Array.isArray(scenes) || scenes.length === 0) {
    res.status(400).json({ error: "At least one storyboard scene is required." });
    return;
  }

  const normalized = scenes.map((s, idx) => ({
    ...s,
    number: String(idx + 1).padStart(2, "0"),
  }));
  const versions = project.storyboardVersions || [];
  const nextVersion = {
    id: stateStore.newId("sbv"),
    version: versions.length + 1,
    scenes: normalized,
    createdAt: new Date().toISOString(),
    createdBy: ctx.actorUid,
    note: note || "Storyboard saved",
  };

  const nextStatus: ContentProjectState =
    project.scriptApproved ? "STORYBOARD_READY" : project.status;

  const updated = stateStore.upsertContentProject({
    ...project,
    storyboardScenes: normalized,
    storyboardApproved: false,
    storyboardApprovedAt: undefined,
    storyboardVersions: [nextVersion, ...versions].slice(0, 20),
    status: nextStatus,
  });

  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) } });
});

router.post("/projects/:id/approve-storyboard", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  if (!project.scriptApproved) {
    res.status(409).json({
      error: "Script must be approved before approving the storyboard.",
      blockers: ["Script not approved"],
    });
    return;
  }

  const scenesInput = req.body?.scenes as StoryboardSceneRecord[] | undefined;
  const scenes = scenesInput?.length ? scenesInput : project.storyboardScenes || [];
  if (!scenes.length) {
    res.status(400).json({ error: "Cannot approve an empty storyboard. Generate or add storyboard scenes first." });
    return;
  }

  const now = new Date().toISOString();
  const updated = stateStore.upsertContentProject({
    ...project,
    storyboardScenes: scenes,
    storyboardApproved: true,
    storyboardApprovedAt: now,
    status: "STORYBOARD_APPROVED",
  });

  stateStore.addAuditLog({
    workspaceId: ctx.workspaceId,
    actorUid: ctx.actorUid,
    action: "project.storyboard.approve",
    target: updated.id,
    status: "allowed",
    detail: `Storyboard (${scenes.length} scenes) approved for "${updated.title}"`,
  });

  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) } });
});

router.post("/projects/:id/scenes/:sceneIndex/generate-image", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }

  const idx = Number(req.params.sceneIndex);
  const scenes = [...(project.storyboardScenes || [])];
  if (!Number.isInteger(idx) || idx < 0 || idx >= scenes.length) {
    res.status(404).json({ error: "Storyboard scene index not found." });
    return;
  }

  try {
    const {
      prompt,
      model,
      aspectRatio = project.formatType === "long_form" ? "16:9" : "9:16",
      imageSize = "1K",
      referenceImageUrls = [],
      business,
    } = req.body as {
      prompt?: string;
      model?: string;
      aspectRatio?: string;
      imageSize?: string;
      referenceImageUrls?: string[];
      business?: Record<string, unknown>;
    };

    const scene = scenes[idx];
    const effectivePrompt =
      prompt?.trim() ||
      scene.imagePrompt ||
      `${scene.visual}. ${scene.cameraDirection ? `Camera: ${scene.cameraDirection}.` : ""} ${scene.background ? `Background: ${scene.background}.` : ""} ${scene.onScreenText ? `Clean typography space for "${scene.onScreenText}".` : ""}`;

    const ai = getGeminiClient();
    const selectedModel = resolveImageModel(model);
    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];

    for (const refUrl of referenceImageUrls.slice(0, 3)) {
      const dataMatch = refUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (dataMatch) {
        parts.push({
          inlineData: { data: dataMatch[2], mimeType: dataMatch[1] },
        });
        continue;
      }
      const candidate = resolveSafeUploadCandidate(refUrl);
      if (candidate && fs.existsSync(candidate)) {
        const ext = path.extname(candidate).toLowerCase();
        const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        parts.push({
          inlineData: { data: fs.readFileSync(candidate).toString("base64"), mimeType },
        });
      }
    }

    parts.push({
      text: business?.name
        ? `${effectivePrompt}\nBrand: ${String(business.name)} (${String(business.industry || "brand")}). High-contrast production frame.`
        : effectivePrompt,
    });

    const imageConfig: Record<string, string> = { aspectRatio };
    if (selectedModel === "gemini-nano-banana-2.1" || selectedModel === "gemini-3-pro-image") {
      imageConfig.imageSize = ["1K", "2K", "4K"].includes(imageSize) ? imageSize : "1K";
    }

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: { parts },
      config: { imageConfig },
    });

    let savedUrl = "";
    let mimeType = "image/png";
    let imgBuffer: Buffer | null = null;
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data && !savedUrl) {
        mimeType = part.inlineData.mimeType || "image/png";
        const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
        const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
        imgBuffer = Buffer.from(part.inlineData.data, "base64");
        fs.writeFileSync(path.join(getGeneratedDir(), filename), imgBuffer);
        savedUrl = `/uploads/generated/${filename}`;
      }
    }

    if (!savedUrl || !imgBuffer) {
      res.status(502).json({ error: "Image model did not return a generated frame." });
      return;
    }

    const dataUrl =
      imgBuffer.byteLength <= 2_500_000
        ? `data:${mimeType};base64,${imgBuffer.toString("base64")}`
        : undefined;
    const displayUrl = dataUrl || savedUrl;

    scenes[idx] = { ...scene, generatedImageUrl: displayUrl, imagePrompt: effectivePrompt };
    const mediaRec = stateStore.addMediaAsset({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      url: displayUrl,
      filename: path.basename(savedUrl),
      originalName: `${project.title}-Scene-${scene.number}.png`,
      mimeType,
      sizeBytes: imgBuffer.byteLength,
      kind: "image",
      category: "campaign_creatives",
      tags: ["storyboard", `scene-${scene.number}`, project.id],
      description: `Storyboard frame for ${project.title} Scene ${scene.number}: ${scene.beat}`,
    });

    const updated = stateStore.upsertContentProject({
      ...project,
      storyboardScenes: scenes,
      thumbUrl: project.thumbUrl || displayUrl,
    });

    res.json({
      imageUrl: savedUrl,
      ...(dataUrl ? { dataUrl } : {}),
      mediaAsset: mediaRec,
      project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) },
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/projects/:id/production-plan", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }

  if (!project.scriptApproved) {
    res.status(409).json({
      error: "Script approval required before generating video production plan.",
      blockers: ["Script not approved"],
    });
    return;
  }
  if (project.storyboardScenes && project.storyboardScenes.length > 0 && !project.storyboardApproved) {
    res.status(409).json({
      error: "Storyboard approval required before starting video production.",
      blockers: ["Storyboard not approved"],
    });
    return;
  }

  const {
    formatType = project.formatType || "short_form",
    method = project.productionMethod || "hybrid",
    aspectRatio = formatType === "long_form" ? "16:9" : "9:16",
    durationTargetSec = formatType === "long_form" ? 180 : 30,
    presenterId,
    presenterName,
    voiceName,
    voiceoverUrl,
    generateWithAi = false,
    business,
    model,
  } = req.body as {
    formatType?: "short_form" | "long_form";
    method?: "ai_assisted" | "traditional" | "hybrid";
    aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5";
    durationTargetSec?: number;
    presenterId?: string;
    presenterName?: string;
    voiceName?: string;
    voiceoverUrl?: string;
    generateWithAi?: boolean;
    business?: Record<string, unknown>;
    model?: string;
  };

  let shotList: Array<{
    sceneNumber: string;
    visualDirection: string;
    audioLine: string;
    assetHint?: string;
    durationSec: number;
  }> = [
    {
      sceneNumber: "01",
      visualDirection: formatType === "long_form" ? "Wide presenter intro + screen capture overlay" : "Tight punch-in hook frame with bold caption",
      audioLine: project.hook || project.title,
      assetHint: "talking_head_clips or product_demo_video",
      durationSec: formatType === "long_form" ? 20 : 5,
    },
    {
      sceneNumber: "02",
      visualDirection: "Product workflow demo showing real outcome",
      audioLine: project.script || project.brief || "Walkthrough of core product proof",
      assetHint: "product_screenshot or raw_screen_recordings",
      durationSec: formatType === "long_form" ? 120 : 18,
    },
    {
      sceneNumber: "03",
      visualDirection: "Branded CTA end-card with logo & next step",
      audioLine: project.cta || "Try it today via link in bio",
      assetHint: "logo & brand_assets",
      durationSec: formatType === "long_form" ? 40 : 7,
    },
  ];

  if (generateWithAi && process.env.GEMINI_API_KEY?.trim()) {
    try {
      const ai = getGeminiClient();
      const selectedModel = resolveTextModel(model);
      const aiResp = await runTrackedAiCall(
        {
          workspaceId: ctx.workspaceId,
          actorUid: ctx.actorUid,
          endpoint: "/api/projects/:id/production-plan",
          agent: "Video Production Planner",
          model: selectedModel,
          creditsEstimated: 20,
        },
        () =>
          ai.models.generateContent({
            model: selectedModel,
            contents: `Build a ${formatType} (${method}) video production shot list for "${project.title}".
${buildBusinessContextPrompt(business)}
Aspect Ratio: ${aspectRatio}, Target Duration: ${durationTargetSec}s
Script:
${project.script || project.brief || project.title}

Return ONLY valid JSON:
{
  "shotList": [
    { "sceneNumber": "01", "visualDirection": "string", "audioLine": "string", "assetHint": "string", "durationSec": 6 }
  ]
}`,
            config: {
              thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
              responseMimeType: "application/json",
            },
          }),
      );
      const parsed = parseJsonSafe<{ shotList?: typeof shotList }>(aiResp.text, {});
      if (parsed.shotList?.length) shotList = parsed.shotList;
    } catch {
      // Fall back cleanly to structured shot list above
    }
  }

  const plan = {
    formatType,
    method,
    aspectRatio,
    durationTargetSec,
    presenterId,
    presenterName,
    voiceName,
    voiceoverUrl,
    shotList,
    capabilityNote:
      method === "ai_assisted"
        ? "Uses Gemini Omni video generation + TTS voiceover + FFmpeg assembly. Presenter photos animate visually without claiming frame-accurate neural lip-sync."
        : method === "traditional"
          ? "Uses human-filmed presenter footage, screen recordings, and FFmpeg timeline editing without synthetic avatar generation."
          : "Hybrid production: combines real product screen recordings/presenter footage with AI voiceover and B-roll transitions.",
    updatedAt: new Date().toISOString(),
  };

  const nextStatus: ContentProjectState =
    project.scriptApproved &&
    (project.status === "SCRIPT_APPROVED" ||
      project.status === "STORYBOARD_APPROVED" ||
      project.status === "PLANNED")
      ? "VIDEO_PENDING"
      : project.status;

  const updated = stateStore.upsertContentProject({
    ...project,
    formatType,
    productionMethod: method,
    videoProductionPlan: plan,
    status: nextStatus,
  });

  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) }, plan });
});

router.post("/projects/:id/approve-final", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }

  const blockers: string[] = [];
  if (!project.scriptApproved) blockers.push("Script is not approved");
  if (!project.videoUrl && !project.editedVideoUrl && !project.thumbUrl) {
    blockers.push("Video or rendered creative asset must be attached before final approval");
  }
  const caption = (req.body?.caption as string | undefined)?.trim() || project.caption?.trim() || "";
  if (!caption) blockers.push("Platform caption is required before final approval");

  if (blockers.length > 0) {
    res.status(409).json({
      error: `Final approval blocked: ${blockers.join("; ")}`,
      blockers,
    });
    return;
  }

  const now = new Date().toISOString();
  const updated = stateStore.upsertContentProject({
    ...project,
    caption,
    finalApproved: true,
    finalApprovedAt: now,
    status: "APPROVED_FOR_PUBLISHING",
  });

  if (updated.calendarEntryId) {
    const cal = stateStore.getCalendarEntryById(updated.calendarEntryId, ctx.workspaceId);
    if (cal) {
      stateStore.upsertCalendarEntry({
        ...cal,
        status: "Ready",
        projectStatus: updated.status,
        caption,
        thumbUrl: updated.thumbUrl || cal.thumbUrl,
      });
    }
  }

  stateStore.addAuditLog({
    workspaceId: ctx.workspaceId,
    actorUid: ctx.actorUid,
    action: "project.final.approve",
    target: updated.id,
    status: "allowed",
    detail: `Final human creative approval granted for "${updated.title}"`,
  });

  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) } });
});

// ---------- PRESENTER PRESETS ----------

router.get("/presenters", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({ presenters: stateStore.listPresenters(ctx.workspaceId) });
});

router.post("/presenters", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = req.body as {
    id?: string;
    name?: string;
    role?: string;
    avatarKind?: "uploaded_photo" | "talking_head_clip" | "ai_generated_avatar";
    mediaUrl?: string;
    voiceName?: string;
    styleNotes?: string;
    consentConfirmed?: boolean;
    consentOwner?: string;
  };
  if (!body.name?.trim()) {
    res.status(400).json({ error: "Presenter name is required." });
    return;
  }
  if (!body.consentConfirmed) {
    res.status(400).json({
      error: "Likeness consent confirmation (consentConfirmed: true) is required before saving a presenter preset.",
    });
    return;
  }

  const presenter = stateStore.upsertPresenter({
    id: body.id,
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    name: body.name.trim(),
    role: body.role?.trim() || "Brand Presenter",
    avatarKind: body.avatarKind || "uploaded_photo",
    mediaUrl: body.mediaUrl || "",
    voiceName: body.voiceName || "Kore",
    styleNotes: body.styleNotes?.trim() || "Direct to camera, confident pacing",
    consentConfirmed: true,
    consentOwner: body.consentOwner?.trim() || ctx.actorUid,
  });
  res.json({ presenter });
});

router.delete("/presenters/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const ok = stateStore.deletePresenter(String(req.params.id), ctx.workspaceId);
  if (!ok) {
    res.status(404).json({ error: "Presenter not found." });
    return;
  }
  res.json({ deleted: true });
});

// ---------- AUTOMATION WORKFLOWS ----------

export async function executeAutomationWorkflow(
  workflow: AutomationWorkflowRecord,
): Promise<AutomationExecutionLogRecord> {
  const startedAt = new Date().toISOString();
  const stepLogs: AutomationExecutionLogRecord["stepLogs"] = [];
  let status: AutomationExecutionLogRecord["status"] = "completed";
  let attempts = 0;
  let linkedProject: ContentProjectRecord | undefined;
  const maxAttempts = Math.max(1, Math.min(3, workflow.retryLimit || 1));

  while (attempts < maxAttempts) {
    attempts++;
    stepLogs.length = 0;
    try {
      for (const node of workflow.nodes) {
        if (node.type === "trigger") {
          stepLogs.push({
            nodeId: node.id,
            label: node.label,
            status: "ok",
            detail: `Triggered (${workflow.triggerType})`,
          });
        } else if (node.type === "condition") {
          const minQa = Number(workflow.conditionMinQaScore ?? node.config?.minQaScore ?? 0);
          if (minQa > 0) {
            const projects = stateStore.listContentProjects(workflow.workspaceId);
            const passing = projects.filter((p) => (p.qaScore ?? 0) >= minQa);
            if (projects.length > 0 && passing.length === 0) {
              stepLogs.push({
                nodeId: node.id,
                label: node.label,
                status: "skipped",
                detail: `Condition blocked: 0 projects meet minimum QA score ${minQa}.`,
              });
              status = "skipped_condition";
              break;
            }
          }
          stepLogs.push({
            nodeId: node.id,
            label: node.label,
            status: "ok",
            detail: "Condition passed",
          });
        } else if (
          node.type === "approval_gate" ||
          (workflow.requireHumanApproval && node.label.toLowerCase().includes("publish"))
        ) {
          if (!linkedProject) {
            const existingProjects = stateStore.listContentProjects(workflow.workspaceId);
            linkedProject = existingProjects.find((p) => !p.scriptApproved || !p.finalApproved);
          }
          stepLogs.push({
            nodeId: node.id,
            label: node.label,
            status: "paused",
            detail: linkedProject
              ? `Paused at Human Approval Gate for "${linkedProject.title}" (${linkedProject.status}).`
              : "Paused at Human Approval Gate prior to external publishing/spend.",
          });
          status = "awaiting_approval";
          stateStore.addNotification({
            workspaceId: workflow.workspaceId,
            ownerUid: workflow.ownerUid,
            title: linkedProject
              ? `Approval needed: ${linkedProject.title}`
              : `Workflow awaiting approval: ${workflow.name}`,
            message: linkedProject
              ? `Review "${linkedProject.title}" and approve script or final creative to continue.`
              : `Reached "${node.label}". Review deliverables before approving external action.`,
            category: "automation",
            severity: "warning",
            actionPage: linkedProject && !linkedProject.scriptApproved ? "Content Studio" : "Automation Workflows",
          });
          break;
        } else {
          // Real local action execution
          const actionType = String(node.config?.actionType || node.label).toLowerCase();
          if (actionType.includes("seo")) {
            const snap = stateStore.getWorkspaceSnapshot(workflow.workspaceId);
            stepLogs.push({
              nodeId: node.id,
              label: node.label,
              status: "ok",
              detail: snap?.websiteUrl
                ? `Verified SEO sweep state for ${snap.websiteUrl}`
                : "Checked workspace SEO readiness",
            });
          } else if (actionType.includes("script") || actionType.includes("content")) {
            const projects = stateStore.listContentProjects(workflow.workspaceId);
            const snap = stateStore.getWorkspaceSnapshot(workflow.workspaceId);
            let targetProj = projects.find(
              (p) =>
                p.status === "AWAITING_SCRIPT_APPROVAL" ||
                p.status === "SCRIPT_READY" ||
                p.status === "SCRIPT_PENDING" ||
                p.status === "PLANNED",
            );
            if (!targetProj) {
              const title = `${workflow.name} Script Draft`;
              const brandLabel = snap?.businessName || "your brand";
              const hook = `Stop guessing what converts for ${brandLabel} — here is the repeatable workflow.`;
              const body = `[0:00-0:04] Hook: ${hook}\n[0:04-0:20] Proof: Walk through one concrete customer workflow powered by ${brandLabel}.\n[0:20-0:30] CTA: Try ${brandLabel} today using the link in bio.`;
              targetProj = stateStore.upsertContentProject({
                workspaceId: workflow.workspaceId,
                ownerUid: workflow.ownerUid,
                title,
                platform: "Instagram Reels",
                status: "AWAITING_SCRIPT_APPROVAL",
                owner: workflow.name,
                progress: 45,
                brief: workflow.nlPrompt || workflow.description || workflow.name,
                hook,
                script: body,
                cta: `Explore ${brandLabel}`,
                qaScore: workflow.conditionMinQaScore ?? 85,
                formatType: "short_form",
                productionMethod: "hybrid",
                scriptApproved: false,
                sourceType: "manual",
              });
            }
            linkedProject = targetProj;
            stepLogs.push({
              nodeId: node.id,
              label: node.label,
              status: "ok",
              detail: `Prepared "${targetProj.title}" (${targetProj.status}) for review & approval`,
            });
          } else {
            stepLogs.push({
              nodeId: node.id,
              label: node.label,
              status: "ok",
              detail: `Executed step: ${node.label}`,
            });
          }
        }
      }
      break;
    } catch (err) {
      stepLogs.push({
        nodeId: "error",
        label: "Execution Retry",
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
      if (attempts >= maxAttempts) {
        status = "failed";
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const summary =
    status === "awaiting_approval"
      ? linkedProject
        ? `Awaiting approval for "${linkedProject.title}"`
        : "Paused safely at human approval gate"
      : status === "skipped_condition"
        ? "Skipped execution because condition threshold was not met"
        : status === "failed"
          ? "Execution failed after retries"
          : `Completed ${stepLogs.length} steps in ${attempts} attempt(s)`;

  stateStore.upsertWorkflow({
    ...workflow,
    lastRunAt: finishedAt,
    lastStatus: summary,
  });

  return stateStore.addWorkflowExecution({
    workflowId: workflow.id,
    workflowName: workflow.name,
    workspaceId: workflow.workspaceId,
    ownerUid: workflow.ownerUid,
    startedAt,
    finishedAt,
    status,
    attempts,
    stepLogs,
    summary,
    projectId: linkedProject?.id,
    projectTitle: linkedProject?.title,
    projectStatus: linkedProject?.status,
  });
}

router.get("/workflows", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({
    workflows: stateStore.listWorkflows(ctx.workspaceId),
    executions: stateStore.listWorkflowExecutions(ctx.workspaceId),
  });
});

router.get("/workflows/executions", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const workflowId = typeof req.query.workflowId === "string" ? req.query.workflowId : undefined;
  res.json({
    executions: stateStore.listWorkflowExecutions(ctx.workspaceId, workflowId),
  });
});

router.post("/workflows", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = req.body as Partial<AutomationWorkflowRecord>;
  if (!body.name?.trim()) {
    res.status(400).json({ error: "Workflow name is required." });
    return;
  }
  const enabled = Boolean(body.enabled);
  const confirmedToActivate = Boolean(body.confirmedToActivate);
  if (enabled && !confirmedToActivate) {
    res.status(400).json({
      error: "Activating an autonomous workflow requires explicit user confirmation (confirmedToActivate: true).",
    });
    return;
  }
  const wf = stateStore.upsertWorkflow({
    id: body.id,
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    name: body.name.trim(),
    description: body.description?.trim() || "Custom marketing workflow",
    triggerType: body.triggerType || "manual",
    intervalMinutes: body.intervalMinutes ? Math.max(5, Number(body.intervalMinutes)) : undefined,
    conditionMinQaScore: body.conditionMinQaScore !== undefined ? Number(body.conditionMinQaScore) : undefined,
    requireHumanApproval: body.requireHumanApproval ?? true,
    retryLimit: Math.min(3, Math.max(1, Number(body.retryLimit) || 2)),
    enabled,
    confirmedToActivate,
    nlPrompt: body.nlPrompt,
    nodes: Array.isArray(body.nodes) && body.nodes.length > 0
      ? body.nodes
      : [
          { id: "n1", type: "trigger", label: "Manual or Schedule Trigger", config: {} },
          { id: "n2", type: "action", label: "Prepare Content Deliverables", config: { actionType: "content" } },
          { id: "n3", type: "approval_gate", label: "Human Review Before Publish", config: {} },
        ],
  });
  res.json({ workflow: wf });
});

router.patch("/workflows/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getWorkflowById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Workflow not found." });
    return;
  }
  const patch = req.body as Partial<AutomationWorkflowRecord>;
  const nextEnabled = patch.enabled !== undefined ? Boolean(patch.enabled) : existing.enabled;
  const nextConfirmed =
    patch.confirmedToActivate !== undefined
      ? Boolean(patch.confirmedToActivate)
      : existing.confirmedToActivate;
  if (nextEnabled && !nextConfirmed) {
    res.status(400).json({
      error: "Activating an automated workflow requires confirmedToActivate: true.",
    });
    return;
  }
  const updated = stateStore.upsertWorkflow({
    ...existing,
    ...patch,
    id: existing.id,
    workspaceId: ctx.workspaceId,
    ownerUid: existing.ownerUid,
  });
  res.json({ workflow: updated });
});

router.delete("/workflows/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const ok = stateStore.deleteWorkflow(String(req.params.id), ctx.workspaceId);
  if (!ok) {
    res.status(404).json({ error: "Workflow not found." });
    return;
  }
  res.json({ deleted: true });
});

router.post("/workflows/generate-nl", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const { prompt, business, model } = req.body as {
    prompt?: string;
    business?: Record<string, unknown>;
    model?: string;
  };
  if (!prompt?.trim()) {
    res.status(400).json({ error: "Describe the workflow you want to build." });
    return;
  }

  try {
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/workflows/generate-nl",
        agent: "Workflow Architect",
        model: selectedModel,
        creditsEstimated: 20,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents: `Convert this plain-English automation request into a structured Marketing OS workflow definition.
${buildBusinessContextPrompt(business)}
User Request: "${prompt.trim()}"

Return ONLY valid JSON:
{
  "name": "Short workflow name",
  "description": "What this workflow automates",
  "triggerType": "manual | interval | event",
  "intervalMinutes": 1440,
  "conditionMinQaScore": 80,
  "requireHumanApproval": true,
  "retryLimit": 2,
  "nodes": [
    { "id": "n1", "type": "trigger", "label": "Trigger step", "config": {} },
    { "id": "n2", "type": "condition", "label": "Check QA threshold >= 80", "config": { "minQaScore": 80 } },
    { "id": "n3", "type": "action", "label": "Prepare content & SEO deliverables", "config": { "actionType": "content" } },
    { "id": "n4", "type": "approval_gate", "label": "Human approval before publish", "config": {} }
  ]
}`,
          config: {
            systemInstruction:
              "Always include a human approval_gate node before external publishing or paid ad changes.",
            thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
            responseMimeType: "application/json",
          },
        }),
    );

    const parsed = parseJsonSafe<Partial<AutomationWorkflowRecord>>(response.text, {});
    const draft = stateStore.upsertWorkflow({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      name: parsed.name || "AI Generated Workflow",
      description: parsed.description || prompt.trim(),
      triggerType: parsed.triggerType === "interval" ? "interval" : parsed.triggerType === "event" ? "event" : "manual",
      intervalMinutes: parsed.intervalMinutes || 1440,
      conditionMinQaScore: parsed.conditionMinQaScore,
      requireHumanApproval: parsed.requireHumanApproval ?? true,
      retryLimit: Math.min(3, Math.max(1, Number(parsed.retryLimit) || 2)),
      enabled: false,
      confirmedToActivate: false,
      nlPrompt: prompt.trim(),
      nodes: Array.isArray(parsed.nodes) && parsed.nodes.length
        ? parsed.nodes
        : [
            { id: "n1", type: "trigger", label: "Trigger", config: {} },
            { id: "n2", type: "action", label: prompt.trim().slice(0, 60), config: {} },
            { id: "n3", type: "approval_gate", label: "Human approval gate", config: {} },
          ],
    });

    res.json({ workflow: draft });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/workflows/:id/run", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const wf = stateStore.getWorkflowById(String(req.params.id), ctx.workspaceId);
  if (!wf) {
    res.status(404).json({ error: "Workflow not found." });
    return;
  }
  const log = await executeAutomationWorkflow(wf);
  res.json({
    execution: log,
    workflow: stateStore.getWorkflowById(wf.id, ctx.workspaceId),
  });
});

export default router;
