import { useEffect, useRef, useState } from "react";
import { ModelSelector } from "../components/ModelSelector";
import { PageHeader, CardTitle, SourceBadge } from "./IntelligenceViews";
import { apiDelete, apiPost, keepGeneratedFile, uploadMediaFileWithProgress } from "../lib/api";
import { LOCAL_PHOTOS } from "../data/defaults";
import type {
  AudienceEvalResult,
  BriefConfig,
  CompetitorItem,
  ContentProject,
  MediaAsset,
  ModelCatalog,
  ModelPreferences,
  Page,
  PlatformAdaptation,
  PresenterPreset,
  ScriptVariation,
  StoryboardScene,
  TrendFormatItem,
  VideoProductionPlan,
  WorkspaceProfile,
} from "../types/marketing";

const IMAGE_STYLE_PRESETS = [
  "Editorial Studio",
  "SaaS Product Hero",
  "UGC Authentic Lifestyle",
  "Minimalist Luxury",
  "High-Contrast Paid Ad",
  "3D Isometric Tech",
];

export function ContentStudioView({
  workspace,
  activeBlueprint,
  projects = [],
  activeProjectId = "",
  initialStage = null,
  onConsumeInitialStage,
  onSelectProjectId,
  mediaAssets = [],
  competitors = [],
  models,
  modelCatalog,
  onSelectTextModel,
  onSelectImageModel,
  onAddMediaAsset,
  onUpsertProject,
  onPatchProject,
  onAddProject,
  onSetActiveScript,
  onConsumeCredits,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  activeBlueprint: TrendFormatItem | null;
  projects?: ContentProject[];
  activeProjectId?: string;
  initialStage?: "brief" | "scripts" | "storyboard" | null;
  onConsumeInitialStage?: () => void;
  onSelectProjectId?: (id: string) => void;
  mediaAssets?: MediaAsset[];
  competitors?: CompetitorItem[];
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  onSelectTextModel: (id: string) => void;
  onSelectImageModel: (id: string) => void;
  onAddMediaAsset: (asset: MediaAsset) => void;
  onUpsertProject?: (proj: Partial<ContentProject> & { title: string }) => Promise<ContentProject>;
  onPatchProject?: (id: string, patch: Partial<ContentProject>) => Promise<ContentProject>;
  onAddProject: (project: ContentProject) => void;
  onSetActiveScript: (title: string, script: string) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [studioMode, setStudioMode] = useState<"video" | "image">("video");
  const [stage, setStage] = useState<"brief" | "scripts" | "storyboard">("brief");

  // Structured Creative Brief state
  const [formatType, setFormatType] = useState<NonNullable<BriefConfig["format"]>>("short_form");
  const [topic, setTopic] = useState(
    activeBlueprint
      ? `Adapt "${activeBlueprint.title}" (${activeBlueprint.patternName}) for ${workspace.name || "our brand"}.`
      : "",
  );
  const [platform, setPlatform] = useState("Instagram Reels + TikTok");
  const [duration, setDuration] = useState("30 seconds");
  const [audience, setAudience] = useState("");
  const [objective, setObjective] = useState("App consideration");
  const [tone, setTone] = useState("");
  const [cta, setCta] = useState("");
  const [keyMessage, setKeyMessage] = useState("");
  const [desiredOutcome, setDesiredOutcome] = useState("");
  const [featuresText, setFeaturesText] = useState("");
  const [referenceMaterials, setReferenceMaterials] = useState("");
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [selectedCompetitorRefs, setSelectedCompetitorRefs] = useState<string[]>([]);

  // Scripts & Storyboard state
  const [generating, setGenerating] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [variations, setVariations] = useState<ScriptVariation[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    () => activeProjectId || projects[0]?.id || "",
  );
  const [rewriteMode, setRewriteMode] = useState<"hook" | "tone" | "length" | "cta" | "full_alternative">("hook");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [approvingScript, setApprovingScript] = useState(false);
  const [savingStoryboard, setSavingStoryboard] = useState(false);
  const [approvingStoryboard, setApprovingStoryboard] = useState(false);
  const [sequencePreview, setSequencePreview] = useState(false);
  const [sceneImageBusyIdx, setSceneImageBusyIdx] = useState<number | null>(null);

  // Image Studio (Nano Banana) State
  const [imgPrompt, setImgPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [imageSize, setImageSize] = useState("1K");
  const [useImageSearch, setUseImageSearch] = useState(false);
  const [stylePreset, setStylePreset] = useState("Editorial Studio");
  const [brandColors, setBrandColors] = useState("#2dd4bf, #0f172a, #ffffff");
  const [composition, setComposition] = useState("Rule of thirds hero framing");
  const [subjectPosition, setSubjectPosition] = useState("Centered with clear depth separation");
  const [textPlacement, setTextPlacement] = useState("Clean negative space in upper third");
  const [backgroundInstruction, setBackgroundInstruction] = useState("Clean studio light gradient");
  const [imgRefUrls, setImgRefUrls] = useState<string[]>([]);
  const [imgGenerating, setImgGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<
    Array<{ url: string; model: string; prompt: string }>
  >([]);
  const [editInstruction, setEditInstruction] = useState("");
  const [selectedImageUrl, setSelectedImageUrl] = useState("");
  const [critiqueText, setCritiqueText] = useState("");
  const [studioError, setStudioError] = useState("");

  const activeProject = projects.find((p) => p.id === selectedProjectId) || null;
  const activeVar = variations[selectedIdx] || variations[0] || null;
  const activeImageModelInfo = modelCatalog.image.find((m) => m.id === models.imageModel);

  const durationOptions =
    formatType === "long_form"
      ? ["2 minutes", "3 minutes", "5 minutes", "10 minutes"]
      : formatType === "ad_creative"
        ? ["15 seconds", "30 seconds", "45 seconds"]
        : ["15 seconds", "30 seconds", "45 seconds", "60 seconds"];

  const hydrateVariationsFromProject = (p: ContentProject): ScriptVariation[] => {
    if (p.scriptVariants?.length) return p.scriptVariants;
    const rawScript = (p.script || "").trim();
    const rawHook = (p.hook || "").trim();
    if (!rawScript && !rawHook && !p.storyboardScenes?.length) return [];
    const fallbackScenes: StoryboardScene[] = p.storyboardScenes?.length
      ? p.storyboardScenes
      : [
          {
            number: "01",
            timeRange: "0:00-0:05",
            durationSec: 5,
            beat: "Hook",
            visual: `Opening hook frame for ${p.title}`,
            dialogue: rawHook || rawScript.split("\n")[0] || p.title,
            onScreenText: (rawHook || p.title).slice(0, 48),
          },
          {
            number: "02",
            timeRange: "0:05-0:22",
            durationSec: 17,
            beat: "Core Proof",
            visual: "Main product workflow demonstration & proof",
            dialogue: rawScript || "Core value demonstration.",
            onScreenText: p.brief?.slice(0, 48) || "Key Proof",
          },
          {
            number: "03",
            timeRange: "0:22-0:30",
            durationSec: 8,
            beat: "CTA",
            visual: "Branded end card with call to action",
            dialogue: p.cta || "Get started today.",
            onScreenText: p.cta || "Get started",
          },
        ];
    return [
      {
        title: p.title,
        hook: rawHook || p.title,
        angle: p.brief || "Project Script Draft",
        score: p.qaScore || 88,
        recommended: true,
        body: rawScript || fallbackScenes.map((sc) => sc.dialogue).join("\n"),
        cta: p.cta || "",
        scenes: fallbackScenes,
      },
    ];
  };

  const syncProjectSelection = (p: ContentProject | undefined) => {
    if (!p) return;
    setSelectedProjectId(p.id);
    onSelectProjectId?.(p.id);
    setSelectedIdx(0);
    setVariations(hydrateVariationsFromProject(p));
    if (p.brief) setTopic(p.brief);
    if (p.platform) setPlatform(p.platform);
    if (p.cta) setCta(p.cta);
    if (p.briefConfig?.format) setFormatType(p.briefConfig.format);
    if (p.briefConfig?.keyMessage) setKeyMessage(p.briefConfig.keyMessage);
    if (p.briefConfig?.desiredOutcome) setDesiredOutcome(p.briefConfig.desiredOutcome);
    if (p.briefConfig?.features?.length) setFeaturesText(p.briefConfig.features.join(", "));
  };

  useEffect(() => {
    if (activeProjectId && activeProjectId !== selectedProjectId) {
      const target = projects.find((p) => p.id === activeProjectId);
      if (target) {
        syncProjectSelection(target);
      } else {
        setSelectedProjectId(activeProjectId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (initialStage) {
      setStudioMode("video");
      setStage(initialStage);
      onConsumeInitialStage?.();
    }
  }, [initialStage, onConsumeInitialStage]);

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      syncProjectSelection(projects[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (activeProject && variations.length === 0) {
      const hydrated = hydrateVariationsFromProject(activeProject);
      if (hydrated.length > 0) setVariations(hydrated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject, variations.length]);

  const ensureProjectForOperation = async (fallbackTitle: string): Promise<string | null> => {
    if (activeProject) return activeProject.id;
    if (!onUpsertProject) return null;
    const created = await onUpsertProject({
      title: fallbackTitle || topic.slice(0, 48) || "Untitled Content Project",
      platform: platform.split("+")[0].trim() || "Instagram Reels",
      formatType: formatType === "long_form" ? "long_form" : "short_form",
      status: "SCRIPT_PENDING",
      brief: topic,
      briefConfig: {
        format: formatType,
        platform,
        duration,
        audience,
        objective,
        tone,
        keyMessage,
        desiredOutcome,
        features: featuresText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        referenceMaterials,
        selectedMediaIds,
        competitorRefs: selectedCompetitorRefs,
        cta,
      },
      sourceType: "ai_grounded",
    });
    setSelectedProjectId(created.id);
    return created.id;
  };

  const generateScripts = async () => {
    setStudioError("");
    setGenerating(true);
    const features = featuresText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const briefConfig: BriefConfig = {
      format: formatType,
      platform,
      duration,
      audience,
      objective,
      tone,
      keyMessage,
      desiredOutcome,
      features,
      referenceMaterials,
      selectedMediaIds,
      competitorRefs: selectedCompetitorRefs,
      cta,
    };
    try {
      const projectId = await ensureProjectForOperation(topic.slice(0, 48));
      if (projectId && onPatchProject) {
        const res = await apiPost<{ project: ContentProject; variations: ScriptVariation[] }>(
          `/api/projects/${projectId}/script-variants`,
          {
            brief: topic,
            briefConfig,
            platform,
            duration,
            audience,
            objective,
            tone,
            cta,
            keyMessage,
            desiredOutcome,
            features,
            referenceMaterials,
            selectedMediaIds,
            competitorRefs: selectedCompetitorRefs,
            business: workspace,
            model: models.textModel,
          },
        );
        if (res.project) {
          await onPatchProject(projectId, res.project);
        }
        if (res.variations?.length) {
          setVariations(res.variations);
          setSelectedIdx(0);
          setStage("scripts");
          onConsumeCredits(55, `Script Variants (${models.textModel})`);
          notify(`Generated ${res.variations.length} 10-element project script variants`);
        }
      } else {
        const res = await apiPost<{ variations: ScriptVariation[] }>("/api/content/scripts", {
          topic,
          platform,
          duration,
          audience,
          objective,
          tone,
          cta,
          blueprint: activeBlueprint?.patternName || "",
          business: workspace,
          model: models.textModel,
        });
        if (res.variations?.length) {
          setVariations(res.variations);
          setSelectedIdx(0);
          setStage("scripts");
          onConsumeCredits(55, `Script Generation (${models.textModel})`);
          notify(`Generated ${res.variations.length} script variations`);
        }
      }
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "Failed to generate scripts");
    } finally {
      setGenerating(false);
    }
  };

  const rewriteActiveScript = async () => {
    if (!activeVar) return;
    setStudioError("");
    setRewriting(true);
    try {
      const projectId = await ensureProjectForOperation(activeVar.title);
      if (!projectId) throw new Error("Project persistence unavailable");
      const currentBody = activeVar.body || activeVar.scenes.map((s) => s.dialogue).join("\n");
      const res = await apiPost<{
        project: ContentProject;
        version: {
          scenes: StoryboardScene[];
          title: string;
          hook: string;
          angle: string;
          body?: string;
          cta?: string;
        };
      }>(`/api/projects/${projectId}/rewrite-script`, {
        currentScript: currentBody,
        currentHook: activeVar.hook,
        mode: rewriteMode,
        instruction: rewriteInstruction,
        tone: tone || "Sharper & punchier",
        business: workspace,
        model: models.textModel,
      });
      if (res.project && onPatchProject) {
        await onPatchProject(projectId, res.project);
      }
      if (res.version) {
        setVariations((prev) =>
          prev.map((v, idx) =>
            idx === selectedIdx
              ? {
                  ...v,
                  title: res.version.title || v.title,
                  hook: res.version.hook || v.hook,
                  angle: res.version.angle || v.angle,
                  body: res.version.body || v.body,
                  cta: res.version.cta || v.cta,
                  scenes: res.version.scenes?.length ? res.version.scenes : v.scenes,
                }
              : v,
          ),
        );
      }
      setRewriteInstruction("");
      notify(`Saved new script version (${rewriteMode} rewrite)`);
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "Script rewrite failed");
    } finally {
      setRewriting(false);
    }
  };

  const adaptForPlatforms = async () => {
    if (!activeVar) return;
    setStudioError("");
    setAdapting(true);
    try {
      const projectId = await ensureProjectForOperation(activeVar.title);
      if (!projectId) throw new Error("Project persistence unavailable");
      const fullBody = activeVar.body || activeVar.scenes.map((s) => s.dialogue).join("\n");
      if (onPatchProject) {
        await onPatchProject(projectId, {
          script: fullBody,
          hook: activeVar.hook,
        });
      }
      const res = await apiPost<{ project: ContentProject; adaptations: Record<string, PlatformAdaptation> }>(
        `/api/projects/${projectId}/adapt-platform`,
        {
          platforms: ["TikTok", "Instagram Reels", "YouTube Shorts", "LinkedIn", "X"],
          business: workspace,
          model: models.textModel,
        },
      );
      if (res.project && onPatchProject) {
        await onPatchProject(projectId, res.project);
      }
      notify(`Adapted script across ${Object.keys(res.adaptations || {}).length} platforms`);
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "Platform adaptation failed");
    } finally {
      setAdapting(false);
    }
  };

  const handleApproveScript = async (nextAction: boolean | "storyboard" | "video" | "avatar" = false) => {
    if (!activeVar) return;
    setStudioError("");
    setApprovingScript(true);
    try {
      const projectId = await ensureProjectForOperation(activeVar.title);
      if (!projectId) throw new Error("Project persistence unavailable");
      const fullText = activeVar.body || activeVar.scenes.map((s) => s.dialogue).join("\n");
      const res = await apiPost<{ project: ContentProject }>(`/api/projects/${projectId}/approve-script`, {
        script: fullText,
        hook: activeVar.hook,
        cta: activeVar.cta || cta || "",
      });
      if (res.project && onPatchProject) {
        await onPatchProject(projectId, res.project);
      }
      onSelectProjectId?.(projectId);
      onSetActiveScript(activeVar.title, fullText);
      notify(`Script approved for "${res.project.title}"`);
      if (nextAction === true || nextAction === "storyboard") {
        setStage("storyboard");
      } else if (nextAction === "video") {
        if ((res.project?.storyboardScenes?.length || 0) > 0 && !res.project?.storyboardApproved) {
          await apiPost(`/api/projects/${projectId}/approve-storyboard`, {
            scenes: res.project.storyboardScenes,
          }).then(async (sb) => {
            if ((sb as { project?: ContentProject }).project && onPatchProject) {
              await onPatchProject(projectId, (sb as { project: ContentProject }).project);
            }
          });
        }
        go("Video Editor");
      } else if (nextAction === "avatar") {
        if ((res.project?.storyboardScenes?.length || 0) > 0 && !res.project?.storyboardApproved) {
          await apiPost(`/api/projects/${projectId}/approve-storyboard`, {
            scenes: res.project.storyboardScenes,
          }).then(async (sb) => {
            if ((sb as { project?: ContentProject }).project && onPatchProject) {
              await onPatchProject(projectId, (sb as { project: ContentProject }).project);
            }
          });
        }
        go("AI Avatar Studio");
      }
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "Script approval failed");
    } finally {
      setApprovingScript(false);
    }
  };

  const updateActiveScene = (sceneIdx: number, patch: Partial<StoryboardScene>) => {
    setVariations((prev) =>
      prev.map((v, vi) =>
        vi === selectedIdx
          ? {
              ...v,
              scenes: v.scenes.map((sc, si) => (si === sceneIdx ? { ...sc, ...patch } : sc)),
            }
          : v,
      ),
    );
  };

  const moveScene = (fromIdx: number, dir: -1 | 1) => {
    if (!activeVar) return;
    const toIdx = fromIdx + dir;
    if (toIdx < 0 || toIdx >= activeVar.scenes.length) return;
    setVariations((prev) =>
      prev.map((v, vi) => {
        if (vi !== selectedIdx) return v;
        const copy = [...v.scenes];
        const [item] = copy.splice(fromIdx, 1);
        copy.splice(toIdx, 0, item);
        return {
          ...v,
          scenes: copy.map((sc, idx) => ({ ...sc, number: String(idx + 1).padStart(2, "0") })),
        };
      }),
    );
  };

  const addBlankScene = () => {
    if (!activeVar) return;
    setVariations((prev) =>
      prev.map((v, vi) => {
        if (vi !== selectedIdx) return v;
        const nextNum = String(v.scenes.length + 1).padStart(2, "0");
        return {
          ...v,
          scenes: [
            ...v.scenes,
            {
              number: nextNum,
              timeRange: "0:00-0:04",
              timestamp: "0:00",
              durationSec: 4,
              beat: "Proof / Beat",
              scriptSection: "Scene",
              visual: "Describe primary camera visual",
              dialogue: "Spoken narration line",
              onScreenText: "",
              cameraDirection: "Medium framing",
              transition: "Clean cut",
            },
          ],
        };
      }),
    );
  };

  const saveStoryboardVersion = async () => {
    if (!activeVar) return;
    setStudioError("");
    setSavingStoryboard(true);
    try {
      const projectId = await ensureProjectForOperation(activeVar.title);
      if (!projectId) throw new Error("Project persistence unavailable");
      const res = await apiPost<{ project: ContentProject }>(`/api/projects/${projectId}/storyboard`, {
        scenes: activeVar.scenes,
        note: `Updated storyboard (${activeVar.scenes.length} scenes)`,
      });
      if (res.project && onPatchProject) {
        await onPatchProject(projectId, res.project);
      }
      notify(`Saved Storyboard (${activeVar.scenes.length} scenes)`);
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "Failed to save storyboard");
    } finally {
      setSavingStoryboard(false);
    }
  };

  const handleApproveStoryboard = async () => {
    if (!activeVar) return;
    setStudioError("");
    setApprovingStoryboard(true);
    try {
      const projectId = await ensureProjectForOperation(activeVar.title);
      if (!projectId) throw new Error("Project persistence unavailable");
      if (!activeProject?.scriptApproved) {
        const fullText = activeVar.body || activeVar.scenes.map((s) => s.dialogue).join("\n");
        await apiPost(`/api/projects/${projectId}/approve-script`, {
          script: fullText,
          hook: activeVar.hook,
          cta: activeVar.cta || cta || "",
        });
      }
      const res = await apiPost<{ project: ContentProject }>(`/api/projects/${projectId}/approve-storyboard`, {
        scenes: activeVar.scenes,
      });
      if (res.project && onPatchProject) {
        await onPatchProject(projectId, res.project);
      }
      notify("Storyboard approved — Video Production & Editor unlocked!");
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "Storyboard approval failed");
    } finally {
      setApprovingStoryboard(false);
    }
  };

  const generateSceneVisual = async (sceneIdx: number) => {
    if (!activeVar) return;
    const sc = activeVar.scenes[sceneIdx];
    setSceneImageBusyIdx(sceneIdx);
    setStudioError("");
    try {
      const projectId = await ensureProjectForOperation(activeVar.title);
      if (!projectId) throw new Error("Project persistence unavailable");
      // Ensure storyboard scenes are saved first so backend scene index matches
      await apiPost(`/api/projects/${projectId}/storyboard`, {
        scenes: activeVar.scenes,
        note: "Auto-saved before scene visual generation",
      });
      const selectedRefs = mediaAssets
        .filter((m) => selectedMediaIds.includes(m.id) && m.kind === "image")
        .map((m) => m.url);
      const res = await apiPost<{
        imageUrl: string;
        dataUrl?: string;
        mediaAsset?: MediaAsset;
        project?: ContentProject;
      }>(`/api/projects/${projectId}/scenes/${sceneIdx}/generate-image`, {
        prompt: sc.imagePrompt || sc.visual,
        model: models.imageModel,
        aspectRatio: formatType === "long_form" ? "16:9" : "9:16",
        imageSize,
        referenceImageUrls: selectedRefs,
        business: workspace,
      });
      const resolvedUrl = res.dataUrl || res.imageUrl;
      if (resolvedUrl) {
        updateActiveScene(sceneIdx, { generatedImageUrl: resolvedUrl });
        setSelectedImageUrl(resolvedUrl);
        if (res.mediaAsset) onAddMediaAsset(res.mediaAsset);
        if (res.project && onPatchProject) await onPatchProject(projectId, res.project);
        onConsumeCredits(65, `Storyboard Scene ${sc.number} Frame`);
        notify(`Generated Nano Banana frame for Scene ${sc.number}`);
      }
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "Scene visual generation failed");
    } finally {
      setSceneImageBusyIdx(null);
    }
  };

  const regenerateScene = async (sceneIdx: number) => {
    if (!activeVar) return;
    const sc = activeVar.scenes[sceneIdx];
    try {
      const res = await apiPost<{ dialogue: string; visual: string }>(
        "/api/content/regenerate-section",
        {
          beat: sc.beat,
          currentDialogue: sc.dialogue,
          currentVisual: sc.visual,
          business: workspace,
          model: models.textModel,
        },
      );
      updateActiveScene(sceneIdx, {
        dialogue: res.dialogue || sc.dialogue,
        visual: res.visual || sc.visual,
      });
      onConsumeCredits(15, "Scene Regenerate");
      notify(`Regenerated Scene ${sc.number}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Scene regeneration failed");
    }
  };

  const generateImage = async () => {
    setStudioError("");
    setImgGenerating(true);
    try {
      const res = await apiPost<{
        imageUrl: string;
        dataUrl?: string;
        model: string;
        mediaAsset?: MediaAsset;
      }>(
        "/api/image/generate",
        {
          prompt: imgPrompt,
          model: models.imageModel,
          aspectRatio,
          imageSize,
          useGoogleSearch: useImageSearch,
          stylePreset,
          brandColors,
          composition,
          subjectPosition,
          textPlacement,
          backgroundInstruction,
          referenceImageUrls: imgRefUrls,
          saveToMediaLibrary: true,
          business: workspace,
        },
      );
      const displayUrl = res.dataUrl || res.imageUrl;
      setGeneratedImages((prev) => [{ url: displayUrl, model: res.model, prompt: imgPrompt }, ...prev]);
      setSelectedImageUrl(displayUrl);
      onAddMediaAsset(
        res.mediaAsset || {
          id: `img-${Date.now()}`,
          name: `${imgPrompt.slice(0, 20)}.png`,
          kind: "image",
          url: displayUrl,
          durationOrSize: `${aspectRatio} · ${res.model}`,
          sourceType: "ai_grounded",
        },
      );
      onConsumeCredits(85, `Image Studio (${res.model})`);
      notify("Studio image generated and saved to Media Library");
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "Image generation failed");
    } finally {
      setImgGenerating(false);
    }
  };

  const editImage = async () => {
    if (!selectedImageUrl || !editInstruction.trim()) return;
    setStudioError("");
    setImgGenerating(true);
    try {
      const res = await apiPost<{ imageUrl: string; dataUrl?: string; model: string }>("/api/image/edit", {
        ...(selectedImageUrl.startsWith("data:")
          ? { imageBase64: selectedImageUrl }
          : { imageUrl: selectedImageUrl }),
        instruction: editInstruction,
        model: models.imageModel,
        aspectRatio,
      });
      const displayUrl = res.dataUrl || res.imageUrl;
      setGeneratedImages((prev) => [
        { url: displayUrl, model: res.model, prompt: editInstruction },
        ...prev,
      ]);
      setSelectedImageUrl(displayUrl);
      onAddMediaAsset({
        id: `img-edit-${Date.now()}`,
        name: `Edited-${Date.now()}.png`,
        kind: "image",
        url: displayUrl,
        durationOrSize: `Edited · ${res.model}`,
        sourceType: "ai_grounded",
      });
      onConsumeCredits(70, `Image Edit (${res.model})`);
      notify("Edited image saved");
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "Image edit failed");
    } finally {
      setImgGenerating(false);
    }
  };

  const analyzeCreative = async () => {
    if (!selectedImageUrl) {
      setStudioError("Generate and select an image first before running visual critique.");
      return;
    }
    setStudioError("");
    setImgGenerating(true);
    try {
      const res = await apiPost<{ analysis: string }>("/api/image/analyze", {
        ...(selectedImageUrl.startsWith("data:")
          ? { imageBase64: selectedImageUrl }
          : { imageUrl: selectedImageUrl }),
        model: models.textModel,
      });
      setCritiqueText(res.analysis);
      onConsumeCredits(25, "Visual Creative Critique");
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "Visual analysis failed");
    } finally {
      setImgGenerating(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Creative production"
        title="Content Studio"
        copy="Generate brand-aligned briefs, 10-element scripts, rich editable storyboards, and high-resolution Nano Banana visuals."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ModelSelector
              label={studioMode === "video" ? "Text Model" : "Image Model"}
              value={studioMode === "video" ? models.textModel : models.imageModel}
              options={studioMode === "video" ? modelCatalog.text : modelCatalog.image}
              onChange={studioMode === "video" ? onSelectTextModel : onSelectImageModel}
              compact
            />
          </div>
        }
      />

      {projects.length > 0 && (
        <div
          className="card"
          style={{
            padding: 12,
            marginBottom: 12,
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <b style={{ fontSize: 12 }}>Active Content Project:</b>
          <select
            className="filter"
            style={{ minWidth: 240 }}
            value={selectedProjectId}
            onChange={(e) => syncProjectSelection(projects.find((item) => item.id === e.target.value))}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.status || p.stage})
              </option>
            ))}
          </select>
          {activeProject && (
            <>
              <span className={`badge ${activeProject.scriptApproved ? "mint" : "review"}`}>
                <i />
                {activeProject.scriptApproved ? "SCRIPT APPROVED" : "SCRIPT DRAFT"}
              </span>
              <span className={`badge ${activeProject.storyboardApproved ? "mint" : "blue"}`}>
                <i />
                {activeProject.storyboardApproved ? "STORYBOARD APPROVED" : "STORYBOARD PENDING"}
              </span>
            </>
          )}
        </div>
      )}

      <div className="large-tabs">
        <button className={studioMode === "video" ? "active" : ""} onClick={() => setStudioMode("video")}>
          Script &amp; Storyboard
        </button>
        <button className={studioMode === "image" ? "active" : ""} onClick={() => setStudioMode("image")}>
          Image Studio (Nano Banana)
        </button>
      </div>

      {studioError && <div className="mos-error-box">{studioError}</div>}

      {studioMode === "video" ? (
        <>
          <div className="studio-steps">
            <span className={stage === "brief" ? "active" : "done"} onClick={() => setStage("brief")}>
              1 <b>Brief</b>
            </span>
            <i />
            <span
              className={stage === "scripts" ? "active" : stage === "storyboard" ? "done" : ""}
              onClick={() => setStage("scripts")}
            >
              2 <b>Scripts</b>
            </span>
            <i />
            <span className={stage === "storyboard" ? "active" : ""} onClick={() => setStage("storyboard")}>
              3 <b>Storyboard</b>
            </span>
            <i />
            <span
              onClick={() => {
                if (activeProject && !activeProject.storyboardApproved && (activeVar?.scenes?.length || 0) > 0) {
                  notify("Approve Storyboard in Step 3 before moving into Production.");
                  setStage("storyboard");
                  return;
                }
                go("Video Editor");
              }}
            >
              4 <b>Produce</b>
            </span>
          </div>

          {stage === "brief" && (
            <div className="brief-layout">
              <section className="card brief-form">
                <h2>Creative Production Brief</h2>
                <p>
                  {activeBlueprint
                    ? `Starting from "${activeBlueprint.title}" (${activeBlueprint.patternName}).`
                    : `Grounded in ${workspace.name || "your"}'s Business Notebook & Media Library.`}
                </p>
                <div className="form-grid">
                  <label>
                    <span>Content format</span>
                    <select
                      value={formatType}
                      onChange={(e) => {
                        const next = e.target.value as NonNullable<BriefConfig["format"]>;
                        setFormatType(next);
                        setDuration(next === "long_form" ? "3 minutes" : "30 seconds");
                      }}
                    >
                      <option value="short_form">Short-form Vertical Video (9:16)</option>
                      <option value="long_form">Long-form YouTube / Explainer (16:9)</option>
                      <option value="ad_creative">Paid Social Ad Creative</option>
                      <option value="ugc_style">UGC Testimonial / Creator Style</option>
                      <option value="product_demo">Product Walkthrough / Demo</option>
                    </select>
                  </label>
                  <label>
                    <span>Platform</span>
                    <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                      <option>Instagram Reels + TikTok</option>
                      <option>YouTube Shorts</option>
                      <option>YouTube Long-Form</option>
                      <option>LinkedIn Video</option>
                      <option>Meta Paid Ads</option>
                    </select>
                  </label>
                  <label>
                    <span>Target duration</span>
                    <select value={duration} onChange={(e) => setDuration(e.target.value)}>
                      {durationOptions.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Objective</span>
                    <select value={objective} onChange={(e) => setObjective(e.target.value)}>
                      <option>App consideration</option>
                      <option>Lead generation</option>
                      <option>Free trial signups</option>
                      <option>Product education</option>
                      <option>Brand awareness</option>
                    </select>
                  </label>
                  <label className="wide">
                    <span>Topic &amp; creative angle</span>
                    <textarea
                      placeholder="Describe the core angle, product problem, or insight to turn into video…"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Key message</span>
                    <input
                      placeholder="Single core takeaway viewer must remember"
                      value={keyMessage}
                      onChange={(e) => setKeyMessage(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Desired outcome</span>
                    <input
                      placeholder="e.g., Visit pricing page or install app"
                      value={desiredOutcome}
                      onChange={(e) => setDesiredOutcome(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Target audience</span>
                    <input
                      placeholder="e.g., SaaS founders, fitness beginners, B2B buyers"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Tone &amp; voice</span>
                    <input
                      placeholder="e.g., Direct, credible, proof-led"
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Key features to highlight (comma separated)</span>
                    <input
                      placeholder="e.g., One-click sync, Automated weekly SEO report"
                      value={featuresText}
                      onChange={(e) => setFeaturesText(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Call to action</span>
                    <input
                      placeholder="e.g., Start your free trial today"
                      value={cta}
                      onChange={(e) => setCta(e.target.value)}
                    />
                  </label>
                  <label className="wide">
                    <span>Reference materials / proof links / notes</span>
                    <input
                      placeholder="Optional customer quote, product metric, or campaign note"
                      value={referenceMaterials}
                      onChange={(e) => setReferenceMaterials(e.target.value)}
                    />
                  </label>
                </div>

                {mediaAssets.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <b style={{ fontSize: 12 }}>Ground Scripts &amp; Storyboard in Media Library Assets ({selectedMediaIds.length} selected)</b>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      {mediaAssets.slice(0, 12).map((m) => {
                        const checked = selectedMediaIds.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            className={`btn ${checked ? "primary" : "ghost"}`}
                            style={{ height: 28, fontSize: 11, padding: "0 10px" }}
                            onClick={() =>
                              setSelectedMediaIds((prev) =>
                                checked ? prev.filter((x) => x !== m.id) : [...prev, m.id],
                              )
                            }
                          >
                            {checked ? "✓ " : "+ "}
                            {m.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {competitors.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <b style={{ fontSize: 12 }}>Competitor Benchmarks to Contrast ({selectedCompetitorRefs.length} selected)</b>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      {competitors.slice(0, 8).map((c) => {
                        const label = `${c.name}: ${c.weakness}`;
                        const checked = selectedCompetitorRefs.includes(label);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className={`btn ${checked ? "secondary" : "ghost"}`}
                            style={{ height: 26, fontSize: 11, padding: "0 10px" }}
                            onClick={() =>
                              setSelectedCompetitorRefs((prev) =>
                                checked ? prev.filter((x) => x !== label) : [...prev, label],
                              )
                            }
                          >
                            {checked ? "✓ " : "+ "}
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  className="btn primary"
                  style={{ marginTop: 16 }}
                  onClick={() => void generateScripts()}
                  disabled={generating || !topic.trim()}
                >
                  {generating ? "Generating 3 10-element scripts…" : "Generate 3 script variations →"}
                </button>
              </section>
              <aside className="card creative-context">
                <CardTitle title="Creative context" copy="From your Business Notebook" />
                {[
                  ["Brand positioning", workspace.positioning || "Not specified yet"],
                  ["Value proposition", workspace.valueProposition || "Not specified yet"],
                  ["Words to use", workspace.wordsToUse || "Not specified yet"],
                  ["Words to avoid", workspace.wordsToAvoid || "Not specified yet"],
                ].map((x) => (
                  <div key={x[0]}>
                    <span>{x[0]}</span>
                    <p>{x[1]}</p>
                  </div>
                ))}
              </aside>
            </div>
          )}

          {stage === "scripts" &&
            (!activeVar ? (
              <section className="card" style={{ padding: 28, textAlign: "center" }}>
                <h3>No scripts generated yet</h3>
                <p style={{ color: "var(--muted)", margin: "8px 0 16px" }}>
                  Fill out your creative brief to generate 3 brand-aligned 10-element script variations.
                </p>
                <button className="btn primary" onClick={() => setStage("brief")}>
                  ← Go to Brief
                </button>
              </section>
            ) : (
              <div>
                <div className="variation-head">
                  <div>
                    <h2>Choose a creative direction</h2>
                    <p>
                      Three distinct 10-element scripts tailored to {workspace.name || "your"}&apos;s brand voice.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={`btn ${compareMode ? "primary" : "secondary"}`}
                      onClick={() => setCompareMode((m) => !m)}
                    >
                      {compareMode ? "Card View" : "Side-by-Side Comparison"}
                    </button>
                    <button
                      className="btn secondary"
                      disabled={generating || !topic.trim()}
                      onClick={() => void generateScripts()}
                    >
                      {generating ? "Regenerating…" : "Regenerate 3 Variants"}
                    </button>
                  </div>
                </div>

                <div className="card" style={{ padding: 14, marginBottom: 14, borderColor: activeProject?.scriptApproved ? "var(--mint)" : "var(--gold)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <b style={{ fontSize: 13 }}>
                        {activeProject?.scriptApproved
                          ? `✓ Script Approved (${activeProject.title})`
                          : `Action Required: Approve Script to Unlock Storyboard & Video Production`}
                      </b>
                      <small style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>
                        {activeProject?.scriptApproved
                          ? "Editing or rewriting an approved script creates a new revision and re-opens approval."
                          : "Review or edit the generated hook & script below, then approve to continue to Storyboard, Avatar Studio, or Video Editor."}
                      </small>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {!activeProject?.scriptApproved ? (
                        <>
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={approvingScript}
                            onClick={() => void handleApproveScript(false)}
                          >
                            {approvingScript ? "Approving…" : "✓ Approve Script Only"}
                          </button>
                          <button
                            type="button"
                            className="btn primary"
                            disabled={approvingScript}
                            onClick={() => void handleApproveScript("storyboard")}
                          >
                            {approvingScript ? "Approving…" : "✓ Approve Script & Open Storyboard →"}
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={approvingScript}
                            onClick={() => void handleApproveScript("video")}
                          >
                            ✓ Approve &amp; Create Video →
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => setStage("storyboard")}
                          >
                            Review Storyboard →
                          </button>
                          <button
                            type="button"
                            className="btn primary"
                            onClick={() => {
                              const fullText = activeVar.body || activeVar.scenes.map((s) => s.dialogue).join("\n");
                              if (activeProject) onSelectProjectId?.(activeProject.id);
                              onSetActiveScript(activeVar.title, fullText);
                              go("Video Editor");
                            }}
                          >
                            Create Video in Editor →
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => {
                              const fullText = activeVar.body || activeVar.scenes.map((s) => s.dialogue).join("\n");
                              if (activeProject) onSelectProjectId?.(activeProject.id);
                              onSetActiveScript(activeVar.title, fullText);
                              go("AI Avatar Studio");
                            }}
                          >
                            Avatar Studio →
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {compareMode ? (
                  <div className="card" style={{ padding: 16, overflowX: "auto", marginBottom: 14 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                          <th style={{ padding: 8 }}>Element</th>
                          {variations.map((v, idx) => (
                            <th key={idx} style={{ padding: 8 }}>
                              <button
                                type="button"
                                className={`btn ${selectedIdx === idx ? "primary" : "ghost"}`}
                                style={{ height: 26, fontSize: 11 }}
                                onClick={() => setSelectedIdx(idx)}
                              >
                                {selectedIdx === idx ? "✓ Selected: " : "Select "}
                                {v.title}
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            ["Hook", (v: ScriptVariation) => v.hook],
                            ["Opening Pattern", (v: ScriptVariation) => v.openingPattern || "Direct Hook"],
                            ["Angle", (v: ScriptVariation) => v.angle],
                            ["Concept", (v: ScriptVariation) => v.concept || "—"],
                            ["Structure", (v: ScriptVariation) => v.structureSummary || `${v.scenes.length} scenes`],
                            ["Full Body", (v: ScriptVariation) => v.body || v.scenes.map((s) => s.dialogue).join(" ")],
                            ["CTA", (v: ScriptVariation) => v.cta || cta || "—"],
                            ["Pacing", (v: ScriptVariation) => v.pacingNotes || "—"],
                            ["Visual Direction", (v: ScriptVariation) => v.visualDirectionNotes || "—"],
                            ["Score", (v: ScriptVariation) => `${v.score}/100`],
                          ] as Array<[string, (v: ScriptVariation) => string]>
                        ).map(([label, getter]) => (
                          <tr key={label} style={{ borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                            <td style={{ padding: 8, fontWeight: 600, whiteSpace: "nowrap" }}>{label}</td>
                            {variations.map((v, idx) => (
                              <td key={idx} style={{ padding: 8, color: "var(--muted)", minWidth: 220 }}>
                                {getter(v)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="script-grid">
                    {variations.map((v, i) => (
                      <button
                        className={`script-card card ${selectedIdx === i ? "selected" : ""}`}
                        onClick={() => setSelectedIdx(i)}
                        key={v.title + i}
                      >
                        <div>
                          <span className={`badge ${v.recommended || i === 0 ? "mint" : "blue"}`}>
                            <i />
                            {v.recommended ? "Recommended" : `Variation ${i + 1}`}
                          </span>
                          <span className="score">
                            {v.score}
                            <small>/100</small>
                          </span>
                        </div>
                        <h3>{v.title}</h3>
                        <blockquote>{v.hook}</blockquote>
                        <p>{v.angle}</p>
                        <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "left", display: "grid", gap: 3, marginTop: 6 }}>
                          {v.openingPattern && <span><b>Pattern:</b> {v.openingPattern}</span>}
                          {v.concept && <span><b>Concept:</b> {v.concept}</span>}
                          {v.structureSummary && <span><b>Structure:</b> {v.structureSummary}</span>}
                          {v.cta && <span><b>CTA:</b> {v.cta}</span>}
                          {v.pacingNotes && <span><b>Pacing:</b> {v.pacingNotes}</span>}
                        </div>
                        <div className="script-scenes">
                          {v.scenes.slice(0, 4).map((sc) => (
                            <span key={sc.number}>
                              <b>{sc.number}</b>
                              {sc.beat} · {sc.timeRange}
                            </span>
                          ))}
                        </div>
                        <span className="radio">{selectedIdx === i ? "✓" : ""}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="card" style={{ padding: 14, marginBottom: 12 }}>
                  <b style={{ fontSize: 12 }}>Selected Script Full Readout ({activeVar.title}) — Editable Draft</b>
                  <textarea
                    rows={5}
                    style={{
                      width: "100%",
                      marginTop: 8,
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: 10,
                      color: "var(--text)",
                      fontSize: 12,
                    }}
                    value={activeVar.body || activeVar.scenes.map((s) => s.dialogue).join("\n")}
                    onChange={(e) => {
                      const nextBody = e.target.value;
                      setVariations((prev) =>
                        prev.map((v, idx) => (idx === selectedIdx ? { ...v, body: nextBody } : v)),
                      );
                    }}
                  />
                </div>

                <div className="bottom-action">
                  <span>
                    <b>{activeVar.title} selected</b>
                    <small>
                      {activeProject?.scriptApproved
                        ? "Script approved — inspect storyboard scenes or jump directly to video production."
                        : "Approve this script to unlock Storyboard & Video Production."}
                    </small>
                  </span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => setStage("storyboard")}
                    >
                      Open Storyboard →
                    </button>
                    {activeProject?.scriptApproved ? (
                      <button
                        className="btn primary"
                        type="button"
                        onClick={() => {
                          const fullText = activeVar.body || activeVar.scenes.map((s) => s.dialogue).join("\n");
                          onSelectProjectId?.(activeProject.id);
                          onSetActiveScript(activeVar.title, fullText);
                          go("Video Editor");
                        }}
                      >
                        Create Video in Editor →
                      </button>
                    ) : (
                      <button
                        className="btn primary"
                        type="button"
                        disabled={approvingScript}
                        onClick={() => void handleApproveScript("storyboard")}
                      >
                        {approvingScript ? "Approving…" : "Approve script & build storyboard →"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

          {stage === "storyboard" &&
            (!activeVar ? (
              <section className="card" style={{ padding: 28, textAlign: "center" }}>
                <h3>No storyboard ready yet</h3>
                <p style={{ color: "var(--muted)", margin: "8px 0 16px" }}>
                  Generate and select a script variation first to edit its scene-by-scene storyboard.
                </p>
                <button className="btn primary" onClick={() => setStage("brief")}>
                  ← Start in Brief
                </button>
              </section>
            ) : (
              <div className="storyboard">
                <div className="storyboard-toolbar">
                  <span>
                    <h2>{activeVar.title}</h2>
                    <p>
                      {duration} · {activeVar.scenes.length} scenes · {platform}
                    </p>
                  </span>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setSequencePreview((p) => !p)}
                  >
                    {sequencePreview ? "Edit Cards" : "Sequence Preview"}
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={savingStoryboard}
                    onClick={() => void saveStoryboardVersion()}
                  >
                    {savingStoryboard ? "Saving…" : "Save Storyboard Version"}
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={approvingStoryboard}
                    onClick={() => void handleApproveStoryboard()}
                  >
                    {approvingStoryboard
                      ? "Approving…"
                      : activeProject?.storyboardApproved
                        ? "✓ Storyboard Approved"
                        : "Approve Storyboard (Unlock Produce)"}
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => {
                      if (activeProject && !activeProject.storyboardApproved) {
                        notify("Please click 'Approve Storyboard' first before launching Production.");
                        return;
                      }
                      const fullText = activeVar.scenes.map((s) => s.dialogue).join(" ");
                      onSetActiveScript(activeVar.title, fullText);
                      go("AI Avatar Studio");
                    }}
                  >
                    Produce in Avatar / Editor →
                  </button>
                </div>

                {sequencePreview ? (
                  <div
                    className="card"
                    style={{
                      padding: 16,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                      gap: 12,
                      marginBottom: 14,
                    }}
                  >
                    {activeVar.scenes.map((sc, i) => (
                      <div key={sc.number + i} className="mos-subcard" style={{ padding: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                          <b>#{sc.number} · {sc.beat}</b>
                          <small>{sc.timeRange}</small>
                        </div>
                        {sc.generatedImageUrl ? (
                          <img
                            src={sc.generatedImageUrl}
                            alt={`Scene ${sc.number}`}
                            style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 6, marginTop: 8 }}
                          />
                        ) : (
                          <div
                            style={{
                              height: 90,
                              borderRadius: 6,
                              marginTop: 8,
                              background: "rgba(255,255,255,0.03)",
                              display: "grid",
                              placeItems: "center",
                              fontSize: 11,
                              color: "var(--muted)",
                            }}
                          >
                            No frame generated yet
                          </div>
                        )}
                        <p style={{ fontSize: 11, marginTop: 8 }}>{sc.dialogue}</p>
                        {sc.onScreenText && (
                          <small style={{ color: "var(--mint)", display: "block", marginTop: 4 }}>
                            Text: “{sc.onScreenText}”
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  activeVar.scenes.map((s, i) => (
                    <div className="scene-card card" key={s.number + i}>
                      <div className="drag">⠿</div>
                      <div className={`scene-thumb st${i % 4}`} style={{ overflow: "hidden" }}>
                        {s.generatedImageUrl ? (
                          <img
                            src={s.generatedImageUrl}
                            alt={`Scene ${s.number}`}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : (
                          <span>{s.number}</span>
                        )}
                      </div>
                      <div className="scene-copy">
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span className="badge blue">
                            <i />
                            {s.beat}
                          </span>
                          <small>{s.timeRange}{s.durationSec ? ` (${s.durationSec}s)` : ""}</small>
                          {s.transition && <small style={{ color: "var(--muted)" }}>· Transition: {s.transition}</small>}
                        </div>
                        <textarea
                          value={s.dialogue}
                          onChange={(e) => updateActiveScene(i, { dialogue: e.target.value })}
                        />
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6, fontSize: 11 }}>
                          <label>
                            <small style={{ color: "var(--muted)" }}>Visual Action</small>
                            <input
                              className="filter"
                              style={{ width: "100%", marginTop: 2 }}
                              value={s.visual}
                              onChange={(e) => updateActiveScene(i, { visual: e.target.value })}
                            />
                          </label>
                          <label>
                            <small style={{ color: "var(--muted)" }}>On-Screen Text Overlay</small>
                            <input
                              className="filter"
                              style={{ width: "100%", marginTop: 2 }}
                              value={s.onScreenText || ""}
                              placeholder="Caption / kinetic text"
                              onChange={(e) => updateActiveScene(i, { onScreenText: e.target.value })}
                            />
                          </label>
                          <label>
                            <small style={{ color: "var(--muted)" }}>Camera &amp; Composition</small>
                            <input
                              className="filter"
                              style={{ width: "100%", marginTop: 2 }}
                              value={s.cameraDirection || ""}
                              placeholder="Close-up, B-roll cut, studio background"
                              onChange={(e) => updateActiveScene(i, { cameraDirection: e.target.value })}
                            />
                          </label>
                          <label>
                            <small style={{ color: "var(--muted)" }}>Presenter / Background / SFX / Music</small>
                            <input
                              className="filter"
                              style={{ width: "100%", marginTop: 2 }}
                              value={[s.presenterRequirement, s.background, s.soundEffects, s.musicDirection].filter(Boolean).join(" · ")}
                              placeholder="Presenter, SFX or music cues"
                              onChange={(e) => updateActiveScene(i, { soundEffects: e.target.value })}
                            />
                          </label>
                        </div>
                      </div>
                      <div className="scene-controls" style={{ gap: 4 }}>
                        <button title="Move scene up" onClick={() => moveScene(i, -1)} disabled={i === 0}>
                          ↑
                        </button>
                        <button
                          title="Move scene down"
                          onClick={() => moveScene(i, 1)}
                          disabled={i === activeVar.scenes.length - 1}
                        >
                          ↓
                        </button>
                        <button title="Regenerate scene copy with AI" onClick={() => void regenerateScene(i)}>
                          ↻
                        </button>
                        <button
                          title="Generate Nano Banana visual frame for this scene"
                          disabled={sceneImageBusyIdx === i}
                          onClick={() => void generateSceneVisual(i)}
                        >
                          {sceneImageBusyIdx === i ? "…" : "✦"}
                        </button>
                        <span>{s.number}</span>
                      </div>
                    </div>
                  ))
                )}

                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button type="button" className="btn secondary" onClick={addBlankScene}>
                    ＋ Add Storyboard Scene
                  </button>
                </div>

                {activeProject?.storyboardVersions && activeProject.storyboardVersions.length > 0 && (
                  <div className="card" style={{ padding: 14, marginBottom: 12 }}>
                    <b style={{ fontSize: 12 }}>Storyboard Versions ({activeProject.storyboardVersions.length})</b>
                    <div className="mos-stack" style={{ marginTop: 6 }}>
                      {activeProject.storyboardVersions.slice(0, 4).map((sbv) => (
                        <div key={sbv.id} className="mos-list-row">
                          <span>
                            <b>v{sbv.version} · {sbv.scenes.length} scenes</b>
                            <small>{sbv.note} · {new Date(sbv.createdAt).toLocaleString()}</small>
                          </span>
                          <button
                            type="button"
                            className="btn ghost"
                            style={{ height: 24, fontSize: 11 }}
                            onClick={() => {
                              setVariations((prev) =>
                                prev.map((v, vi) => (vi === selectedIdx ? { ...v, scenes: sbv.scenes } : v)),
                              );
                              notify(`Restored Storyboard v${sbv.version}`);
                            }}
                          >
                            Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="card" style={{ padding: 16, marginTop: 14 }}>
                  <CardTitle
                    title="Script Rewrite, Versioning & Platform Adaptations"
                    copy="Refine hooks/tone/CTA, inspect saved versions, and lock Script Approval before Video Production."
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    <select
                      className="filter"
                      value={rewriteMode}
                      onChange={(e) => setRewriteMode(e.target.value as typeof rewriteMode)}
                    >
                      <option value="hook">Rewrite Hook</option>
                      <option value="tone">Change Tone</option>
                      <option value="length">Adjust Length</option>
                      <option value="cta">Sharpen CTA</option>
                      <option value="full_alternative">Generate Full Alternative</option>
                    </select>
                    <input
                      style={{
                        flex: 1,
                        minWidth: 200,
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "7px 10px",
                        color: "var(--text)",
                      }}
                      placeholder="Optional rewrite note (e.g. shorter 20s pacing, stronger proof hook)…"
                      value={rewriteInstruction}
                      onChange={(e) => setRewriteInstruction(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={rewriting}
                      onClick={() => void rewriteActiveScript()}
                    >
                      {rewriting ? "Rewriting…" : "✦ Rewrite & Save Version"}
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={adapting}
                      onClick={() => void adaptForPlatforms()}
                    >
                      {adapting ? "Adapting…" : "✦ Adapt for 5 Platforms"}
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={approvingScript}
                      onClick={() => void handleApproveScript(false)}
                    >
                      {approvingScript
                        ? "Approving…"
                        : activeProject?.scriptApproved
                          ? "✓ Script Approved (Re-Approve)"
                          : "Approve Script ✓"}
                    </button>
                  </div>

                  {activeProject?.scriptVersions && activeProject.scriptVersions.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <b style={{ fontSize: 12 }}>
                        Script Version History ({activeProject.scriptVersions.length})
                      </b>
                      <div className="mos-stack" style={{ marginTop: 6 }}>
                        {activeProject.scriptVersions.slice(0, 5).map((ver) => (
                          <div key={ver.id} className="mos-list-row">
                            <span>
                              <b>
                                v{ver.version} · {ver.title}
                              </b>
                              <small>
                                {ver.note || ver.angle} · {new Date(ver.createdAt).toLocaleString()}
                              </small>
                            </span>
                            <button
                              type="button"
                              className="btn ghost"
                              style={{ height: 26, fontSize: 11 }}
                              onClick={() => {
                                if (ver.scenes?.length) {
                                  setVariations((prev) =>
                                    prev.map((v, vi) =>
                                      vi === selectedIdx
                                        ? {
                                            ...v,
                                            title: ver.title,
                                            hook: ver.hook,
                                            body: ver.body,
                                            cta: ver.cta,
                                            scenes: ver.scenes,
                                          }
                                        : v,
                                    ),
                                  );
                                  notify(`Restored script v${ver.version} into storyboard`);
                                }
                              }}
                            >
                              Restore
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeProject?.platformAdaptations &&
                    Object.keys(activeProject.platformAdaptations).length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <b style={{ fontSize: 12 }}>Platform-Adapted Scripts, Captions &amp; Thumbnails</b>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                            gap: 8,
                            marginTop: 8,
                          }}
                        >
                          {Object.values(activeProject.platformAdaptations).map((ad) => (
                            <div key={ad.platform} className="mos-subcard" style={{ padding: 10 }}>
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                }}
                              >
                                <b>{ad.platform}</b>
                                <span className="badge blue">
                                  <i />
                                  {ad.format}
                                </span>
                              </div>
                              <p style={{ fontSize: 11, marginTop: 4 }}>
                                <b>Hook:</b> {ad.hook}
                              </p>
                              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{ad.caption}</p>
                              <small style={{ color: "var(--mint)", display: "block", marginTop: 4 }}>
                                {ad.hashtags.join(" ")}
                              </small>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              </div>
            ))}
        </>
      ) : (
        <div className="brief-layout">
          <section className="card brief-form">
            <h2>Generate &amp; Edit Marketing Visuals</h2>
            <p>
              Powered by Gemini Nano Banana image models ({activeImageModelInfo?.label || models.imageModel}). Generated visuals automatically sync to Media Library.
            </p>
            {activeImageModelInfo?.recommendedFor && (
              <div className="mos-subcard" style={{ marginBottom: 12, fontSize: 11 }}>
                <b>Model Capability:</b> {activeImageModelInfo.recommendedFor}
              </div>
            )}
            <div className="form-grid">
              <label className="wide">
                <span>Creative prompt</span>
                <textarea
                  rows={3}
                  placeholder="Describe the studio campaign visual, lighting, subject, and framing…"
                  value={imgPrompt}
                  onChange={(e) => setImgPrompt(e.target.value)}
                />
              </label>
              <label>
                <span>Style preset</span>
                <select value={stylePreset} onChange={(e) => setStylePreset(e.target.value)}>
                  {IMAGE_STYLE_PRESETS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Aspect ratio</span>
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                  {["1:1", "9:16", "16:9", "4:3", "3:4"].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Resolution (2.1 / Pro)</span>
                <select value={imageSize} onChange={(e) => setImageSize(e.target.value)}>
                  <option value="1K">1K</option>
                  <option value="2K">2K</option>
                  <option value="4K">4K</option>
                </select>
              </label>
              <label>
                <span>Brand colors palette</span>
                <input value={brandColors} onChange={(e) => setBrandColors(e.target.value)} />
              </label>
              <label>
                <span>Composition &amp; framing</span>
                <input value={composition} onChange={(e) => setComposition(e.target.value)} />
              </label>
              <label>
                <span>Subject positioning</span>
                <input value={subjectPosition} onChange={(e) => setSubjectPosition(e.target.value)} />
              </label>
              <label>
                <span>Text overlay placement</span>
                <input value={textPlacement} onChange={(e) => setTextPlacement(e.target.value)} />
              </label>
              <label>
                <span>Background direction</span>
                <input
                  value={backgroundInstruction}
                  onChange={(e) => setBackgroundInstruction(e.target.value)}
                />
              </label>
              <label className="wide" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={useImageSearch}
                  onChange={(e) => setUseImageSearch(e.target.checked)}
                />
                <span>Use Google Search / Image Search grounding (Nano Banana 2.1 / Pro)</span>
              </label>
            </div>

            {mediaAssets.filter((m) => m.kind === "image").length > 0 && (
              <div style={{ marginTop: 12 }}>
                <b style={{ fontSize: 12 }}>
                  Multi-Reference Images from Media Library ({imgRefUrls.length}/3 selected)
                </b>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {mediaAssets
                    .filter((m) => m.kind === "image")
                    .slice(0, 10)
                    .map((m) => {
                      const active = imgRefUrls.includes(m.url);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`btn ${active ? "primary" : "ghost"}`}
                          style={{ height: 28, fontSize: 11, padding: "0 10px" }}
                          onClick={() =>
                            setImgRefUrls((prev) =>
                              active
                                ? prev.filter((u) => u !== m.url)
                                : prev.length < 3
                                  ? [...prev, m.url]
                                  : prev,
                            )
                          }
                        >
                          {active ? "✓ " : "+ "}
                          {m.name}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <button
                className="btn primary"
                disabled={imgGenerating || !imgPrompt.trim()}
                onClick={() => void generateImage()}
              >
                {imgGenerating ? "Generating image…" : "✦ Generate image"}
              </button>
              <button
                className="btn secondary"
                disabled={imgGenerating || !selectedImageUrl}
                onClick={() => void analyzeCreative()}
              >
                Analyze selected visual
              </button>
            </div>

            {selectedImageUrl && (
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                <b style={{ display: "block", marginBottom: 8 }}>Edit Selected Image</b>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    style={{
                      flex: 1,
                      minWidth: 200,
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      color: "var(--text)",
                    }}
                    placeholder="e.g., Add subtle mint neon rim light and warm background…"
                    value={editInstruction}
                    onChange={(e) => setEditInstruction(e.target.value)}
                  />
                  <button
                    className="btn secondary"
                    disabled={imgGenerating || !editInstruction.trim()}
                    onClick={() => void editImage()}
                  >
                    Apply AI Edit
                  </button>
                </div>
              </div>
            )}

            {critiqueText && (
              <div className="mos-subcard" style={{ marginTop: 14 }}>
                <b>Gemini Multimodal Visual Critique</b>
                <p style={{ marginTop: 6, whiteSpace: "pre-wrap", fontSize: 12 }}>{critiqueText}</p>
              </div>
            )}
          </section>

          <aside className="card creative-context">
            <CardTitle title="Generated gallery" copy="Click to select for editing or video" />
            {generatedImages.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 12, padding: "12px 0" }}>
                Generated campaign images will appear here and in your Media Library.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {generatedImages.map((g, i) => (
                  <div
                    key={g.url + i}
                    onClick={() => setSelectedImageUrl(g.url)}
                    style={{
                      border:
                        selectedImageUrl === g.url
                          ? "2px solid var(--mint)"
                          : "1px solid var(--border)",
                      borderRadius: 8,
                      overflow: "hidden",
                      cursor: "pointer",
                    }}
                  >
                    <img src={g.url} alt={g.prompt} style={{ width: "100%", display: "block" }} />
                    <div style={{ padding: 8, fontSize: 11, color: "var(--muted)" }}>{g.model}</div>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

export function AvatarsView({
  workspace,
  activeScriptText,
  projects = [],
  mediaAssets = [],
  activeProjectId = "",
  onSelectProjectId,
  onOpenProject,
  presenters = [],
  models,
  onUpdatePresenters,
  onPatchProject,
  onAddMediaAsset,
  onConsumeCredits,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  activeScriptText: string;
  projects?: ContentProject[];
  mediaAssets?: MediaAsset[];
  activeProjectId?: string;
  onSelectProjectId?: (id: string) => void;
  onOpenProject?: (
    p: ContentProject,
    dest?: "auto" | "brief" | "scripts" | "storyboard" | "video" | "avatar" | "queue",
  ) => void;
  presenters?: PresenterPreset[];
  models?: ModelPreferences;
  onUpdatePresenters?: (items: PresenterPreset[] | ((prev: PresenterPreset[]) => PresenterPreset[])) => void;
  onPatchProject?: (id: string, patch: Partial<ContentProject>) => Promise<ContentProject>;
  onAddMediaAsset: (asset: MediaAsset) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [videoMode, setVideoMode] = useState<"image-to-video" | "text-to-video">("image-to-video");
  const [formatType, setFormatType] = useState<"short_form" | "long_form">("short_form");
  const [productionMethod, setProductionMethod] = useState<"ai_assisted" | "traditional" | "hybrid">("hybrid");
  const [targetProjectId, setTargetProjectId] = useState<string>(
    () => activeProjectId || projects[0]?.id || "",
  );
  const [approvingGate, setApprovingGate] = useState(false);
  const [selectedPresenterId, setSelectedPresenterId] = useState<string>("");
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [planningShotList, setPlanningShotList] = useState(false);
  const [shotPlan, setShotPlan] = useState<VideoProductionPlan | null>(null);
  const [selected, setSelected] = useState(0);
  const [customAvatarUrl, setCustomAvatarUrl] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [motionPrompt, setMotionPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9">("9:16");
  const [generating, setGenerating] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const productVideoRef = useRef<HTMLInputElement | null>(null);
  const [productImageUrl, setProductImageUrl] = useState("");

  const avatars = [
    ["Maya", "Warm coach", LOCAL_PHOTOS.ava1],
    ["Theo", "Confident guide", LOCAL_PHOTOS.ava2],
    ["Eli", "Calm expert", LOCAL_PHOTOS.ava3],
    ["Nina", "Energetic mentor", LOCAL_PHOTOS.ava4],
    ["Sasha", "Wellness host", LOCAL_PHOTOS.ava5],
  ];

  useEffect(() => {
    if (activeProjectId) {
      setTargetProjectId(activeProjectId);
    } else if (!targetProjectId && projects.length > 0) {
      setTargetProjectId(projects[0].id);
    }
  }, [activeProjectId, projects, targetProjectId]);

  const activePresenter = presenters.find((p) => p.id === selectedPresenterId) || null;
  const activeProject = projects.find((p) => p.id === targetProjectId) || null;
  const productImages = mediaAssets.filter(
    (m) => m.kind === "image" && m.url && !m.url.includes("/src/assets/"),
  );
  const productVideos = mediaAssets.filter((m) => m.kind === "video" && m.url);
  const activeImage = activePresenter?.mediaUrl || customAvatarUrl || productImageUrl || "";
  const usingStockFace = !activeImage || activeImage.includes("/src/assets/") || /avatar_\d/i.test(activeImage);

  const approveProjectGateInline = async () => {
    if (!activeProject) return;
    setApprovingGate(true);
    setErrorMsg("");
    try {
      let current = activeProject;
      if (!current.scriptApproved) {
        const res = await apiPost<{ project: ContentProject }>(`/api/projects/${current.id}/approve-script`, {
          script: current.script || current.scriptVariants?.[0]?.body || current.title,
          hook: current.hook || current.scriptVariants?.[0]?.hook || "",
          cta: current.cta || current.scriptVariants?.[0]?.cta || "",
        });
        if (res.project) {
          current = res.project;
          if (onPatchProject) await onPatchProject(current.id, current);
        }
      }
      if ((current.storyboardScenes?.length || 0) > 0 && !current.storyboardApproved) {
        const sbRes = await apiPost<{ project: ContentProject }>(`/api/projects/${current.id}/approve-storyboard`, {
          scenes: current.storyboardScenes,
        });
        if (sbRes.project) {
          current = sbRes.project;
          if (onPatchProject) await onPatchProject(current.id, current);
        }
      }
      notify(`"${current.title}" approved and ready for video production!`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setApprovingGate(false);
    }
  };

  const handleUploadCustom = async (file: File) => {
    if (!consentConfirmed && file.type.startsWith("image/")) {
      notify("Confirm image authorization checkbox first");
      return;
    }
    try {
      const category = file.type.startsWith("video/") ? "product_demo_video" : "product_demo_image";
      const up = await uploadMediaFileWithProgress(file, { category });
      onAddMediaAsset({
        id: up.id || `up-${Date.now()}`,
        name: up.originalName,
        kind: up.kind,
        url: up.url,
        durationOrSize: `${Math.max(1, Math.round((up.size || file.size) / 1024))} KB`,
        sourceType: "imported",
        category,
      });
      if (file.type.startsWith("video/")) {
        notify("Product demo saved. Open Video Editor to cut it with a reference style.");
        go("Video Editor");
        return;
      }
      setCustomAvatarUrl(up.url);
      setProductImageUrl(up.url);
      setSelectedPresenterId("");
      setVideoMode("image-to-video");
      notify("Your product photo is the video reference. Stock faces are not used.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const handleSavePresenterPreset = async () => {
    if (!presetName.trim()) {
      setErrorMsg("Enter a presenter preset name first.");
      return;
    }
    if (!consentConfirmed) {
      setErrorMsg("Confirm likeness ownership/permission before saving a presenter preset.");
      return;
    }
    setSavingPreset(true);
    setErrorMsg("");
    try {
      const res = await apiPost<{ presenter: PresenterPreset }>("/api/presenters", {
        name: presetName.trim(),
        role: "Authorized Brand Presenter",
        avatarKind: customAvatarUrl ? "uploaded_photo" : "ai_generated_avatar",
        mediaUrl: activeImage,
        voiceName: "Kore",
        styleNotes: motionPrompt.trim() || "Natural direct-to-camera delivery",
        consentConfirmed: true,
      });
      if (res.presenter) {
        onUpdatePresenters?.((prev) => [res.presenter, ...prev.filter((x) => x.id !== res.presenter.id)]);
        setSelectedPresenterId(res.presenter.id);
        setPresetName("");
        notify(`Saved presenter preset "${res.presenter.name}"`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save presenter preset");
    } finally {
      setSavingPreset(false);
    }
  };

  const handleGenerateProductionPlan = async () => {
    if (!activeProject) {
      setErrorMsg("Select a Content Project first to build a persisted production plan.");
      return;
    }
    setPlanningShotList(true);
    setErrorMsg("");
    try {
      const res = await apiPost<{ project: ContentProject; plan: VideoProductionPlan }>(
        `/api/projects/${activeProject.id}/production-plan`,
        {
          formatType,
          method: productionMethod,
          aspectRatio: formatType === "long_form" ? "16:9" : aspectRatio,
          presenterId: activePresenter?.id,
          presenterName: activePresenter?.name || avatars[selected][0],
          generateWithAi: true,
          business: workspace,
          model: models?.textModel,
        },
      );
      if (res.plan) setShotPlan(res.plan);
      if (res.project && onPatchProject) await onPatchProject(activeProject.id, res.project);
      notify(`Saved ${formatType === "long_form" ? "Long-Form" : "Short-Form"} (${productionMethod}) shot list`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to generate production plan");
    } finally {
      setPlanningShotList(false);
    }
  };

  const generatePresenterVideo = async () => {
    if (!motionPrompt.trim()) {
      setErrorMsg("Describe the scene action or presenter direction before generating.");
      return;
    }
    if (videoMode === "image-to-video" && usingStockFace) {
      setErrorMsg("Upload your product photo or a photo you have rights to. Preset stock faces are not sent to the video model.");
      return;
    }
    setErrorMsg("");
    setGenerating(true);
    try {
      const res = await apiPost<{ videoUrl: string; interactionId: string }>("/api/video/generate", {
        prompt: `${motionPrompt.trim()}${workspace.name ? `. Brand: ${workspace.name}` : ""}${activeScriptText ? `. Script context: ${activeScriptText.slice(0, 220)}` : ""}. Keep the real product and person from the reference. Natural camera, real lighting, no stock influencer, no plastic skin.`,
        imageUrl: videoMode === "image-to-video" ? activeImage : undefined,
        aspectRatio: formatType === "long_form" ? "16:9" : aspectRatio,
        duration: formatType === "long_form" ? "8s" : "6s",
        resolution: "720p",
      });
      const assetName =
        videoMode === "text-to-video"
          ? `omni-scene-${Date.now().toString(36)}.mp4`
          : customAvatarUrl
            ? `custom-presenter-${Date.now().toString(36)}.mp4`
            : `${avatars[selected][0]}-presenter.mp4`;
      const durableUrl = await keepGeneratedFile(res.videoUrl, assetName);
      setGeneratedVideoUrl(durableUrl);
      onAddMediaAsset({
        id: `omni-${Date.now()}`,
        name: assetName,
        kind: "video",
        url: durableUrl,
        durationOrSize: `${formatType === "long_form" ? "16:9" : "9:16"} · Omni Flash`,
        sourceType: "ai_grounded",
      });
      if (activeProject && activeProject.scriptApproved && onPatchProject) {
        await onPatchProject(activeProject.id, {
          videoUrl: durableUrl,
          formatType,
          productionMethod,
          status: "VIDEO_READY",
        });
      }
      onConsumeCredits(
        240,
        videoMode === "text-to-video"
          ? "Text-to-Video (gemini-omni-1.2-flash)"
          : "AI Presenter Video (gemini-omni-1.2-flash)",
      );
      notify("MP4 video generated with Gemini Omni Flash");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Video generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="AI video & presenter · Gemini Omni Flash"
        title="Avatar & Video Studio"
        copy="Upload your product photo or demo. Motion is generated from that real asset. Preset stock faces are not sent to the model. For a cut that matches a reference video, use Video Editor."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUploadCustom(f);
              }}
            />
            <input
              ref={productVideoRef}
              type="file"
              accept="video/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUploadCustom(f);
              }}
            />
            <button className="btn primary" type="button" onClick={() => productVideoRef.current?.click()}>
              ＋ Upload product demo
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                if (!consentConfirmed) {
                  notify("Please confirm image ownership/consent below before uploading");
                  return;
                }
                fileRef.current?.click();
              }}
            >
              ＋ Upload product photo
            </button>
          </>
        }
      />

      {errorMsg && <div className="mos-error-box">{errorMsg}</div>}

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <b>Your product footage</b>
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
          {productVideos.length} demo video{productVideos.length === 1 ? "" : "s"} and {productImages.length} photo
          {productImages.length === 1 ? "" : "s"} saved. Video generation uses a photo you upload. The editor cuts the demo.
        </p>
        {productImages.length > 0 && (
          <label style={{ display: "block", marginTop: 8 }}>
            <span>Product photo for this clip</span>
            <select
              value={productImageUrl}
              onChange={(e) => {
                setProductImageUrl(e.target.value);
                setCustomAvatarUrl(e.target.value);
                setVideoMode("image-to-video");
              }}
            >
              <option value="">Choose a saved product photo</option>
              {productImages.map((m) => (
                <option key={m.id} value={m.url}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="form-grid" style={{ marginTop: 0 }}>
          {projects.length > 0 && (
            <label>
              <span>Target Content Project</span>
              <select
                value={targetProjectId}
                onChange={(e) => {
                  setTargetProjectId(e.target.value);
                  onSelectProjectId?.(e.target.value);
                }}
              >
                <option value="">Standalone Studio Clip</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.scriptApproved ? "Script Approved" : "Needs Script Approval"})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>Video Format</span>
            <select
              value={formatType}
              onChange={(e) => {
                const next = e.target.value as "short_form" | "long_form";
                setFormatType(next);
                setAspectRatio(next === "long_form" ? "16:9" : "9:16");
              }}
            >
              <option value="short_form">Short-Form Video (Reels / TikTok / Shorts · 9:16)</option>
              <option value="long_form">Long-Form Video (YouTube / Walkthrough · 16:9)</option>
            </select>
          </label>
          <label>
            <span>Production Method</span>
            <select
              value={productionMethod}
              onChange={(e) => setProductionMethod(e.target.value as "ai_assisted" | "traditional" | "hybrid")}
            >
              <option value="ai_assisted">AI-Assisted (Omni + TTS + FFmpeg)</option>
              <option value="hybrid">Hybrid (Screen Capture + AI VO + Edits)</option>
              <option value="traditional">Traditional (Uploaded Footage + Timeline Edit)</option>
            </select>
          </label>
          {activeProject && (
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                type="button"
                className="btn secondary"
                disabled={planningShotList}
                onClick={() => void handleGenerateProductionPlan()}
              >
                {planningShotList ? "Planning Shot List…" : "✦ Build Shot List Plan"}
              </button>
            </div>
          )}
        </div>
        {activeProject &&
          (!activeProject.scriptApproved ||
            ((activeProject.storyboardScenes?.length || 0) > 0 && !activeProject.storyboardApproved)) && (
            <div
              className="mos-subcard"
              style={{
                marginTop: 8,
                borderColor: "var(--gold)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <small style={{ color: "var(--gold)" }}>
                {!activeProject.scriptApproved
                  ? `"${activeProject.title}" is currently awaiting Script Approval before its production plan can advance.`
                  : `"${activeProject.title}" requires Storyboard Approval before advancing to video production.`}
              </small>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn primary"
                  style={{ height: 28, fontSize: 11 }}
                  disabled={approvingGate}
                  onClick={() => void approveProjectGateInline()}
                >
                  {approvingGate
                    ? "Approving…"
                    : !activeProject.scriptApproved
                      ? "✓ Approve Script Now"
                      : "✓ Approve Storyboard Now"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ height: 28, fontSize: 11 }}
                  onClick={() =>
                    onOpenProject
                      ? onOpenProject(activeProject, !activeProject.scriptApproved ? "scripts" : "storyboard")
                      : go("Content Studio")
                  }
                >
                  Review in Content Studio →
                </button>
              </div>
            </div>
          )}
        <small style={{ color: "var(--muted)", display: "block", marginTop: 6 }}>
          Capability disclosure: Gemini Omni generates visual presenter/scene motion MP4 clips without claiming frame-accurate neural lip-sync. Pair with Voice Studio narration in Video Editor.
        </small>
        {(shotPlan || activeProject?.videoProductionPlan) && (
          <div className="mos-subcard" style={{ marginTop: 10 }}>
            <b>Shot List ({(shotPlan || activeProject?.videoProductionPlan)?.formatType} · {(shotPlan || activeProject?.videoProductionPlan)?.method})</b>
            <div className="mos-stack" style={{ marginTop: 6 }}>
              {(shotPlan || activeProject?.videoProductionPlan)?.shotList.map((sc) => (
                <div key={sc.sceneNumber} style={{ fontSize: 11 }}>
                  <b>Scene {sc.sceneNumber} ({sc.durationSec}s):</b> {sc.visualDirection} — <i>{sc.audioLine}</i>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="large-tabs" style={{ marginBottom: 14 }}>
        <button
          className={videoMode === "image-to-video" ? "active" : ""}
          onClick={() => setVideoMode("image-to-video")}
        >
          Presenter Image-to-Video
        </button>
        <button
          className={videoMode === "text-to-video" ? "active" : ""}
          onClick={() => setVideoMode("text-to-video")}
        >
          Text-to-Video (No Image)
        </button>
      </div>

      <div className="avatar-layout">
        <section>
          {videoMode === "image-to-video" && (
            <>
              <div className="avatar-grid">
                {avatars.map((a, i) => (
                  <button
                    className={!customAvatarUrl && !selectedPresenterId && selected === i ? "selected" : ""}
                    onClick={() => {
                      setCustomAvatarUrl("");
                      setSelectedPresenterId("");
                      setSelected(i);
                    }}
                    key={a[0]}
                  >
                    <img src={a[2]} alt={a[0]} />
                    <span>
                      <b>{a[0]}</b>
                      <small>{a[1]}</small>
                    </span>
                    <i>{!customAvatarUrl && !selectedPresenterId && selected === i ? "✓" : ""}</i>
                  </button>
                ))}
              </div>

              {presenters.length > 0 && (
                <div className="card" style={{ padding: 12, marginTop: 12 }}>
                  <b style={{ fontSize: 12 }}>Saved Workspace Presenter Presets ({presenters.length})</b>
                  <div className="mos-stack" style={{ marginTop: 8 }}>
                    {presenters.map((pr) => (
                      <div key={pr.id} className="mos-list-row">
                        <span
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            setSelectedPresenterId(pr.id);
                            setCustomAvatarUrl(pr.mediaUrl);
                          }}
                        >
                          <b>{pr.name}</b>
                          <small>{pr.role} · Voice: {pr.voiceName} · Consent confirmed</small>
                        </span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className={`btn ${selectedPresenterId === pr.id ? "primary" : "secondary"}`}
                            style={{ height: 26, fontSize: 11 }}
                            onClick={() => {
                              setSelectedPresenterId(pr.id);
                              setCustomAvatarUrl(pr.mediaUrl);
                            }}
                          >
                            {selectedPresenterId === pr.id ? "✓ Selected" : "Use"}
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            style={{ height: 26, fontSize: 11, color: "#ff9c9c" }}
                            onClick={() => {
                              void apiDelete(`/api/presenters/${pr.id}`).then(() => {
                                onUpdatePresenters?.((prev) => prev.filter((x) => x.id !== pr.id));
                                if (selectedPresenterId === pr.id) setSelectedPresenterId("");
                                notify(`Removed presenter "${pr.name}"`);
                              });
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="consent-banner">
                <span>✓</span>
                <div style={{ flex: 1 }}>
                  <b>Consent-first custom avatars &amp; presets</b>
                  <p>
                    Reference uploads and saved presenter presets require confirmation that you own the image or have explicit permission from the depicted person.
                  </p>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={consentConfirmed}
                      onChange={(e) => setConsentConfirmed(e.target.checked)}
                    />
                    I confirm I hold rights &amp; permission for any uploaded reference image.
                  </label>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <input
                      style={{ flex: 1, minWidth: 160, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", color: "var(--text)" }}
                      placeholder="Presenter preset name…"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={savingPreset}
                      onClick={() => void handleSavePresenterPreset()}
                    >
                      {savingPreset ? "Saving…" : "Save Presenter Preset"}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="card" style={{ padding: 16, marginTop: videoMode === "image-to-video" ? 14 : 0 }}>
            <div className="form-grid">
              <label className="wide">
                <span>{videoMode === "text-to-video" ? "Scene & camera direction" : "Motion & scene direction"}</span>
                <textarea
                  rows={3}
                  placeholder={
                    videoMode === "text-to-video"
                      ? "Describe the scene, lighting, camera movement, and visual pacing…"
                      : "Describe how the presenter should move, gesture, and look on camera…"
                  }
                  value={motionPrompt}
                  onChange={(e) => setMotionPrompt(e.target.value)}
                />
              </label>
              <label>
                <span>Aspect ratio</span>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as "9:16" | "16:9")}
                >
                  <option value="9:16">9:16 (Vertical Reels/TikTok)</option>
                  <option value="16:9">16:9 (Widescreen / Long-Form)</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <aside className="avatar-preview card">
          <div className="preview-stage">
            {generatedVideoUrl ? (
              <video
                src={generatedVideoUrl}
                controls
                autoPlay
                loop
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : videoMode === "text-to-video" ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                <b style={{ display: "block", color: "var(--text)", marginBottom: 6 }}>
                  Text-to-Video Stage ({aspectRatio})
                </b>
                Enter your scene direction and generate an MP4 directly with Gemini Omni Flash.
              </div>
            ) : (
              <img src={activeImage} alt="Selected AI avatar" />
            )}
          </div>
          <h3>
            {videoMode === "text-to-video"
              ? "Text-to-Video Scene"
              : customAvatarUrl
                ? "Custom Authorized Avatar"
                : `${avatars[selected][0]} · Studio`}
          </h3>
          {activeScriptText.trim() && (
            <div className="script-preview">
              <small>SCRIPT CONTEXT</small>
              <p>“{activeScriptText.slice(0, 140)}”</p>
            </div>
          )}
          <button
            className="btn primary"
            disabled={generating || !motionPrompt.trim()}
            onClick={() => void generatePresenterVideo()}
          >
            {generating
              ? "Rendering with Omni Flash…"
              : videoMode === "text-to-video"
                ? "Generate Scene Video (MP4) →"
                : "Generate Presenter Video (MP4) →"}
          </button>
          {generatedVideoUrl && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <a className="btn secondary" href={generatedVideoUrl} download>
                ↓ Download MP4
              </a>
              <button className="btn secondary" type="button" onClick={() => go("Video Editor")}>
                Open in Video Editor →
              </button>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

export function VoiceStudioView({
  workspace,
  activeScriptText,
  models,
  modelCatalog,
  onSelectVoiceModel,
  onAddMediaAsset,
  onConsumeCredits,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  activeScriptText: string;
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  onSelectVoiceModel: (id: string) => void;
  onAddMediaAsset: (asset: MediaAsset) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const voices = [
    { id: "Kore", label: "Kore · Warm & clear", gender: "Female" },
    { id: "Puck", label: "Puck · Bright & upbeat", gender: "Male" },
    { id: "Charon", label: "Charon · Grounded authority", gender: "Male" },
    { id: "Zephyr", label: "Zephyr · Calm strategist", gender: "Neutral" },
    { id: "Fenrir", label: "Fenrir · Bold & energetic", gender: "Male" },
  ];
  const [selectedVoice, setSelectedVoice] = useState("Kore");
  const [dualSpeaker, setDualSpeaker] = useState(false);
  const [style, setStyle] = useState("");
  const [text, setText] = useState(activeScriptText || "");
  const [ttsUrl, setTtsUrl] = useState("");
  const [ttsBusy, setTtsBusy] = useState(false);

  const [musicModel, setMusicModel] = useState(models.musicModel || "lyria-3-clip-preview");
  const [musicPrompt, setMusicPrompt] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
  const [musicLyrics, setMusicLyrics] = useState("");
  const [musicBusy, setMusicBusy] = useState(false);

  const [transcript, setTranscript] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const generateVoice = async () => {
    if (!text.trim()) return;
    setErrorMsg("");
    setTtsBusy(true);
    try {
      const res = await apiPost<{ audioUrl: string; dataUrl?: string; model: string }>("/api/audio/tts", {
        text,
        voiceName: selectedVoice,
        style,
        model: models.voiceModel,
        dualSpeaker,
      });
      const playableUrl = res.dataUrl || res.audioUrl;
      setTtsUrl(playableUrl);
      onAddMediaAsset({
        id: `vo-${Date.now()}`,
        name: `${selectedVoice}-VO.wav`,
        kind: "audio",
        url: playableUrl,
        durationOrSize: `WAV · ${res.model}`,
        sourceType: "ai_grounded",
      });
      onConsumeCredits(35, `Voiceover TTS (${res.model})`);
      notify("Voiceover generated and added to Video Editor audio");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Voice generation failed");
    } finally {
      setTtsBusy(false);
    }
  };

  const generateMusic = async () => {
    if (!musicPrompt.trim()) return;
    setErrorMsg("");
    setMusicBusy(true);
    try {
      const res = await apiPost<{ audioUrl: string; dataUrl?: string; lyrics?: string; model: string }>(
        "/api/audio/music",
        {
          prompt: musicPrompt,
          model: musicModel,
        },
      );
      const playableUrl = res.dataUrl || res.audioUrl;
      setMusicUrl(playableUrl);
      setMusicLyrics(res.lyrics || "");
      onAddMediaAsset({
        id: `mus-${Date.now()}`,
        name: `Lyria-Track.mp3`,
        kind: "audio",
        url: playableUrl,
        durationOrSize: `MP3 · ${res.model}`,
        sourceType: "ai_grounded",
      });
      onConsumeCredits(75, `Lyria Music (${res.model})`);
      notify("Music bed generated and added to Video Editor audio");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Music generation failed");
    } finally {
      setMusicBusy(false);
    }
  };

  const transcribeBlob = (blob: Blob, mimeType: string) => {
    setTranscribing(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const b64 = String(reader.result || "");
        const res = await apiPost<{ transcript: string }>("/api/audio/transcribe", {
          audioBase64: b64,
          mimeType: mimeType || "audio/webm",
        });
        setTranscript(res.transcript);
        onConsumeCredits(20, "Audio Transcription");
        notify("Audio transcribed with Gemini 3.5 Transcribe");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Transcription failed");
      } finally {
        setTranscribing(false);
      }
    };
    reader.onerror = () => {
      setTranscribing(false);
      setErrorMsg("Failed to read recorded audio.");
    };
    reader.readAsDataURL(blob);
  };

  const handleTranscribeFile = (file: File) => {
    setErrorMsg("");
    transcribeBlob(file, file.type || "audio/mp3");
  };

  const startMicRecording = async () => {
    setErrorMsg("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setErrorMsg("Microphone recording is not supported in this browser.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        micStreamRef.current?.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
        if (blob.size > 0) {
          transcribeBlob(blob, mimeType);
        }
      };

      recorder.start();
      setRecording(true);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? `Microphone access error: ${err.message}` : "Could not access microphone",
      );
    }
  };

  const stopMicRecording = () => {
    setRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Speech, Music & Transcription"
        title="Voice & Audio Studio"
        copy="Generate natural TTS narration, custom Lyria soundtracks, or transcribe uploaded & recorded audio."
        actions={
          <ModelSelector
            label="Voice Model"
            value={models.voiceModel}
            options={modelCatalog.voice}
            onChange={onSelectVoiceModel}
            compact
          />
        }
      />

      {errorMsg && <div className="mos-error-box">{errorMsg}</div>}

      <div className="voice-layout">
        <section className="card voice-library">
          <CardTitle title="Voice library" copy="Gemini 3.8 TTS studio voices" />
          {voices.map((v) => (
            <button
              className={selectedVoice === v.id ? "playing" : ""}
              onClick={() => setSelectedVoice(v.id)}
              key={v.id}
            >
              <span className="play-round">{selectedVoice === v.id ? "✓" : "▶"}</span>
              <span>
                <b>{v.id}</b>
                <small>{v.label}</small>
              </span>
              <span className="badge blue">
                <i />
                {v.gender}
              </span>
            </button>
          ))}

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <CardTitle title="Lyria Music Generator" copy="Custom royalty-free soundtracks" />
            <ModelSelector
              label="Lyria Model"
              value={musicModel}
              options={modelCatalog.music}
              onChange={setMusicModel}
            />
            <textarea
              style={{
                width: "100%",
                marginTop: 10,
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 10,
                color: "var(--text)",
              }}
              rows={3}
              placeholder="e.g., Modern ambient synth pulse, 110 BPM clean percussive background bed…"
              value={musicPrompt}
              onChange={(e) => setMusicPrompt(e.target.value)}
            />
            <button
              className="btn secondary"
              style={{ marginTop: 10, width: "100%" }}
              disabled={musicBusy || !musicPrompt.trim()}
              onClick={() => void generateMusic()}
            >
              {musicBusy ? "Composing Lyria track…" : "♫ Generate Lyria Music Bed"}
            </button>
            {musicUrl && (
              <div style={{ marginTop: 10 }}>
                <audio
                  controls
                  src={musicUrl}
                  style={{ width: "100%" }}
                  onError={() => setErrorMsg("Music audio playback failed to decode.")}
                />
                <a className="text-button" href={musicUrl} download style={{ fontSize: 11, display: "inline-block", marginTop: 4 }}>
                  ↓ Download Lyria Track
                </a>
                {musicLyrics && (
                  <small style={{ color: "var(--muted)", display: "block", marginTop: 6 }}>
                    {musicLyrics}
                  </small>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="card voice-editor">
          <h3>Generate narration ({selectedVoice})</h3>
          <textarea
            placeholder={`Paste or write your ${workspace.name || "brand"} narration script here…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="form-grid" style={{ marginTop: 10 }}>
            <label className="wide">
              <span>Voice direction / style</span>
              <input
                placeholder="e.g., Clear, confident marketing narrator"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
              />
            </label>
            <label className="wide" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={dualSpeaker}
                onChange={(e) => setDualSpeaker(e.target.checked)}
              />
              <span>Enable dual-speaker podcast screenplay mode (Host: ... Guest: ...)</span>
            </label>
          </div>
          {ttsUrl && (
            <div style={{ margin: "12px 0" }}>
              <audio
                controls
                src={ttsUrl}
                style={{ width: "100%" }}
                onError={() => setErrorMsg("Generated voiceover failed browser WAV playback — try regenerating.")}
              />
              <a className="text-button" href={ttsUrl} download style={{ fontSize: 11, display: "inline-block", marginTop: 4 }}>
                ↓ Download Narration WAV
              </a>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn primary"
              disabled={ttsBusy || !text.trim()}
              onClick={() => void generateVoice()}
            >
              {ttsBusy ? "Synthesizing audio…" : "Generate voiceover (WAV)"}
            </button>
            {ttsUrl && (
              <button className="btn secondary" onClick={() => go("Video Editor")}>
                Mix in Video Editor →
              </button>
            )}
          </div>

          <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <b style={{ display: "block", marginBottom: 8 }}>Audio Transcription (Gemini 3.5 Transcribe)</b>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {recording ? (
                <button className="btn danger" onClick={stopMicRecording}>
                  ■ Stop & Transcribe Mic
                </button>
              ) : (
                <button
                  className="btn secondary"
                  disabled={transcribing}
                  onClick={() => void startMicRecording()}
                >
                  🎙 Record from Microphone
                </button>
              )}
              <input
                type="file"
                accept="audio/*"
                disabled={transcribing || recording}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleTranscribeFile(f);
                }}
              />
            </div>
            {recording && (
              <small style={{ display: "block", marginTop: 8, color: "var(--mint)" }}>
                ● Recording microphone audio… Click “Stop & Transcribe Mic” when done.
              </small>
            )}
            {transcribing && <small style={{ display: "block", marginTop: 6 }}>Transcribing audio…</small>}
            {transcript && (
              <textarea
                readOnly
                value={transcript}
                rows={4}
                style={{ width: "100%", marginTop: 10 }}
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export function AudienceLabView({
  workspace,
  activeTitle,
  activeScriptText,
  evalData,
  models,
  modelCatalog,
  onSelectTextModel,
  onUpdateEval,
  onConsumeCredits,
  onApprove,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  activeTitle: string;
  activeScriptText: string;
  evalData: AudienceEvalResult | null;
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  onSelectTextModel: (id: string) => void;
  onUpdateEval: (res: AudienceEvalResult) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  onApprove: () => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [title, setTitle] = useState(activeTitle || "");
  const [script, setScript] = useState(activeScriptText || "");
  const [useDecisions, setUseDecisions] = useState(true);
  const [running, setRunning] = useState(false);
  const [improving, setImproving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const runEvaluation = async () => {
    if (!script.trim()) return;
    setErrorMsg("");
    setRunning(true);
    try {
      const res = await apiPost<AudienceEvalResult>("/api/evaluate/audience", {
        title: title || "Campaign Creative",
        script,
        business: workspace,
        model: models.textModel,
        useDecisionCalibration: useDecisions,
      });
      onUpdateEval({ ...res, sourceType: "ai_simulation" });
      onConsumeCredits(45, `Audience Simulation (${models.textModel})`);
      notify("Audience Simulation evaluation complete");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setRunning(false);
    }
  };

  const improveContent = async () => {
    if (!evalData || !script.trim()) return;
    setErrorMsg("");
    setImproving(true);
    try {
      const feedbackSummary = evalData.evaluators
        .map((e) => `${e.role} (${e.score}/100): ${e.quote} ${e.recommendation || ""}`)
        .join("\n");
      const res = await apiPost<{
        improvedScript: string;
        changesMade: string[];
        projectedScore: number;
        headline: string;
      }>("/api/evaluate/improve", {
        title: title || "Campaign Creative",
        script,
        feedbackSummary,
        business: workspace,
        model: models.textModel,
      });

      setScript(res.improvedScript);
      onUpdateEval({
        ...evalData,
        overallScore: res.projectedScore || Math.min(97, evalData.overallScore + 6),
        headline: res.headline || "Improved script addresses simulation feedback.",
        summary: (res.changesMade || []).join(" · "),
        improved: true,
        improvedScript: res.improvedScript,
      });
      onConsumeCredits(40, "AI Script Improvement");
      notify("Script rewritten based on 6-persona feedback");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Improvement failed");
    } finally {
      setImproving(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="AI quality evaluation"
        title="Audience Simulation Lab"
        copy="Six simulated perspectives + Decisions API rubric calibration review creative clarity—not real audience telemetry."
        actions={
          <>
            <ModelSelector
              label="Evaluator"
              value={models.textModel}
              options={modelCatalog.text}
              onChange={onSelectTextModel}
              compact
            />
            <span className="badge review">
              <i />
              AI simulation · Not predictive
            </span>
          </>
        }
      />

      {errorMsg && <div className="mos-error-box">{errorMsg}</div>}

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="form-grid">
          <label>
            <span>Creative title</span>
            <input
              placeholder="e.g., Launch Hook Variation 1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label style={{ justifyContent: "flex-end" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={useDecisions}
                onChange={(e) => setUseDecisions(e.target.checked)}
              />
              Calibrate readiness with Gemini Decision 1
            </span>
          </label>
          <label className="wide">
            <span>Script / Creative Copy to Evaluate</span>
            <textarea
              rows={3}
              placeholder="Paste or load your script / ad copy from Content Studio to simulate 6 persona critiques…"
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
          </label>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <button
            className="btn primary"
            disabled={running || !script.trim()}
            onClick={() => void runEvaluation()}
          >
            {running ? "Evaluating with 6 personas…" : "Run AI Simulation Evaluation"}
          </button>
        </div>
      </div>

      {!evalData ? (
        <section className="card" style={{ padding: 28, textAlign: "center" }}>
          <h3>No evaluation run yet</h3>
          <p style={{ color: "var(--muted)", marginTop: 6 }}>
            Enter your script or creative copy above and click “Run AI Simulation Evaluation” to score
            hook strength, clarity, and publish readiness.
          </p>
        </section>
      ) : (
        <>
          <div className="lab-summary card">
            <div className="score-ring mint">
              <strong>{evalData.overallScore}</strong>
              <span>overall score</span>
            </div>
            <div>
              <SourceBadge sourceType={evalData.sourceType} />
              <h2 style={{ marginTop: 6 }}>{evalData.headline}</h2>
              <p>{evalData.summary}</p>
              {evalData.calibration && (
                <small style={{ color: "var(--mint)", display: "block", marginTop: 6 }}>
                  Gemini Decision 1 Calibration: {evalData.calibration.readyToPublishProb ?? "—"}%
                  publish-readiness · {evalData.calibration.rubricScore ?? "—"}% rubric score
                </small>
              )}
            </div>
            <div className="summary-bars">
              {evalData.dimensions.map((x) => (
                <div key={x.label}>
                  <span>
                    {x.label}
                    <b>{x.score}</b>
                  </span>
                  <i>
                    <em style={{ width: `${x.score}%` }} />
                  </i>
                </div>
              ))}
            </div>
          </div>

          <div className="evaluator-grid">
            {evalData.evaluators.map((p, i) => (
              <article className="card evaluator" key={p.role}>
                <div>
                  <span className={`eval-avatar e${i % 6}`}>{p.role[0]}</span>
                  <span>
                    <h3>{p.role}</h3>
                    <small>Simulated evaluator</small>
                  </span>
                  <strong>{p.score}</strong>
                </div>
                <span className="badge blue">
                  <i />
                  {p.focus}
                </span>
                <p>{p.quote}</p>
                {p.recommendation && (
                  <small style={{ color: "var(--muted)" }}>Tip: {p.recommendation}</small>
                )}
              </article>
            ))}
          </div>

          <div className="lab-actions">
            <div>
              <b>Important</b>
              <p>
                AI simulations cannot predict virality or guarantee engagement. Validate recommendations
                with real campaign results.
              </p>
            </div>
            <button className="btn secondary" disabled={improving} onClick={() => void improveContent()}>
              {improving ? "Rewriting script…" : "Improve Content Based on Feedback"}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                onApprove();
                notify("Content approved and ready to schedule");
                go("Content Calendar");
              }}
            >
              Approve & schedule →
            </button>
          </div>
        </>
      )}
    </>
  );
}

export function PipelineView({
  projects,
  onPatchProject,
  onRefreshPipeline,
  onAdvanceProject,
  onOpenProject,
  go,
}: {
  projects: ContentProject[];
  onPatchProject?: (id: string, patch: Partial<ContentProject>) => Promise<ContentProject>;
  onRefreshPipeline?: () => Promise<void>;
  onAdvanceProject: (id: string) => void;
  onOpenProject: (p: ContentProject) => void;
  go: (p: Page) => void;
}) {
  const stages: ContentProject["stage"][] = [
    "Research",
    "Script",
    "Video editing",
    "Quality assurance",
    "Awaiting approval",
    "Scheduled",
  ];

  return (
    <>
      <PageHeader
        eyebrow="Production operations · 17-State Machine"
        title="Content Pipeline"
        copy="Every creative artifact, script approval gate, QA check, and final publishing sign-off in one traceable flow."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {onRefreshPipeline && (
              <button className="btn secondary" onClick={() => void onRefreshPipeline()}>
                ↻ Sync Pipeline
              </button>
            )}
            <button className="btn primary" onClick={() => go("Content Studio")}>
              ＋ New content project
            </button>
          </div>
        }
      />

      <div className="pipeline-stats">
        {[
          [String(projects.length), "Active projects"],
          [String(projects.filter((p) => p.stage !== "Scheduled").length), "In production"],
          [String(projects.filter((p) => p.stage === "Awaiting approval" || p.status === "AWAITING_FINAL_APPROVAL").length), "Awaiting approval"],
          [String(projects.filter((p) => p.stage === "Scheduled" || p.status === "PUBLISHED").length), "Scheduled / Published"],
        ].map((x) => (
          <span key={x[1]}>
            <b>{x[0]}</b>
            <small>{x[1]}</small>
          </span>
        ))}
      </div>

      <div className="kanban">
        {stages.map((stage, i) => {
          const colItems = projects.filter((p) => p.stage === stage);
          return (
            <div className="kanban-col" key={stage}>
              <div className="kanban-head">
                <span className={`dot d${i}`} />
                <b>{stage}</b>
                <small>{colItems.length}</small>
              </div>
              {colItems.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--muted)", padding: "12px 6px", textAlign: "center" }}>
                  No items
                </div>
              ) : (
                colItems.map((proj, n) => {
                  const statusLabel = proj.status || stage;
                  const canPublishJump = proj.scriptApproved && (proj.videoUrl || proj.editedVideoUrl || proj.thumbUrl);
                  return (
                    <div className="project-card card" key={proj.id}>
                      <div
                        className={`project-cover pc${i}${n % 2}`}
                        onClick={() => onOpenProject(proj)}
                        style={{ cursor: "pointer" }}
                      >
                        {proj.thumbUrl && <img src={proj.thumbUrl} alt={proj.title} />}
                        <span className="badge dark">
                          <i />
                          {proj.platform}
                        </span>
                      </div>
                      <h3 onClick={() => onOpenProject(proj)} style={{ cursor: "pointer" }}>
                        {proj.title}
                      </h3>
                      <p>
                        {statusLabel} · {proj.owner}
                      </p>
                      <div className="project-meta">
                        <span>{proj.progress}%</span>
                        <i>
                          <em style={{ width: `${proj.progress}%` }} />
                        </i>
                        <small>{proj.finalApproved ? "Final OK" : proj.scriptApproved ? "Script OK" : "Draft"}</small>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn ghost"
                          style={{ flex: 1, height: 26, fontSize: 10 }}
                          onClick={() => onOpenProject(proj)}
                        >
                          {!proj.scriptApproved
                            ? "Review Script →"
                            : (proj.storyboardScenes?.length || 0) > 0 && !proj.storyboardApproved
                              ? "Storyboard →"
                              : "Edit Video →"}
                        </button>
                        {canPublishJump && onPatchProject && proj.status === "AWAITING_FINAL_APPROVAL" ? (
                          <button
                            type="button"
                            className="btn primary"
                            style={{ flex: 1, height: 26, fontSize: 10 }}
                            onClick={() => go("Publishing Queue")}
                          >
                            Review Queue →
                          </button>
                        ) : (
                          stage !== "Scheduled" && (
                            <button
                              type="button"
                              className="btn secondary"
                              style={{ flex: 1, height: 26, fontSize: 10 }}
                              onClick={() => onAdvanceProject(proj.id)}
                            >
                              {!proj.scriptApproved
                                ? "Approve Script ✓"
                                : (proj.storyboardScenes?.length || 0) > 0 && !proj.storyboardApproved
                                  ? "Approve Storyboard ✓"
                                  : !proj.videoUrl && !proj.editedVideoUrl
                                    ? "Create Video →"
                                    : !proj.finalApproved
                                      ? "Approve Final ✓"
                                      : "Queue →"}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
