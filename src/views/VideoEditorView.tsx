import { useEffect, useRef, useState } from "react";
import { ModelSelector } from "../components/ModelSelector";
import { apiGet, apiPost, keepGeneratedFile, uploadMediaFileWithProgress } from "../lib/api";
import type {
  ContentProject,
  MediaAsset,
  ModelCatalog,
  ModelPreferences,
  Page,
  VideoBreakdownItem,
  VideoEditorPreferences,
  WorkspaceProfile,
} from "../types/marketing";

interface VideoJobSummary {
  id: string;
  title: string;
  aspectRatio: string;
  status: "queued" | "processing" | "completed" | "failed";
  progressPct: number;
  renderUrl?: string;
  filename?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  error?: string;
  createdAt: string;
}

export function VideoEditorView({
  workspace,
  mediaAssets,
  projects = [],
  activeProjectId = "",
  onSelectProjectId,
  onOpenProject,
  activeTitle,
  activeScriptText,
  models,
  modelCatalog,
  editorPrefs,
  initialClips,
  onConsumeInitialClips,
  onChangeEditorPrefs,
  onSelectTextModel,
  onAddMediaAsset,
  onPatchProject,
  onConsumeCredits,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  mediaAssets: MediaAsset[];
  projects?: ContentProject[];
  activeProjectId?: string;
  onSelectProjectId?: (id: string) => void;
  onOpenProject?: (
    p: ContentProject,
    dest?: "auto" | "brief" | "scripts" | "storyboard" | "video" | "avatar" | "queue",
  ) => void;
  activeTitle: string;
  activeScriptText: string;
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  editorPrefs?: VideoEditorPreferences;
  initialClips?: string[];
  onConsumeInitialClips?: () => void;
  onChangeEditorPrefs?: (patch: Partial<VideoEditorPreferences>) => void;
  onSelectTextModel: (id: string) => void;
  onAddMediaAsset: (asset: MediaAsset) => void;
  onPatchProject?: (id: string, patch: Partial<ContentProject>) => Promise<ContentProject>;
  onConsumeCredits: (amount: number, label: string) => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [mediaTab, setMediaTab] = useState<"media" | "audio" | "brand">("media");
  const [editTab, setEditTab] = useState<"ai" | "props">(
    editorPrefs?.mode === "traditional" ? "props" : "ai",
  );
  const [mobilePanel, setMobilePanel] = useState<"preview" | "media" | "ai">("preview");
  const [editorMode, setEditorMode] = useState<"ai" | "traditional" | "hybrid">(
    editorPrefs?.mode || "hybrid",
  );

  const visualAssets = mediaAssets.filter((m) => m.kind === "video" || m.kind === "image");
  const audioAssets = mediaAssets.filter((m) => m.kind === "audio");

  const [selectedSourceUrl, setSelectedSourceUrl] = useState<string>(visualAssets[0]?.url || "");
  const [selectedClips, setSelectedClips] = useState<string[]>(() =>
    visualAssets[0]?.url ? [visualAssets[0].url] : [],
  );
  const [selectedAudioUrl, setSelectedAudioUrl] = useState<string>(audioAssets[0]?.url || "");
  const [selectedMusicUrl, setSelectedMusicUrl] = useState<string>("");
  const [burnSubtitles, setBurnSubtitles] = useState<boolean>(editorPrefs?.burnSubtitles ?? true);
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9" | "1:1" | "4:5">(
    editorPrefs?.aspectRatio || "9:16",
  );
  const [speed, setSpeed] = useState<number>(editorPrefs?.speed ?? 1.0);
  const [zoomFactor, setZoomFactor] = useState<number>(editorPrefs?.zoomFactor ?? 1.0);
  const [fadeInOut, setFadeInOut] = useState<boolean>(editorPrefs?.fadeInOut ?? false);
  const [voVolume, setVoVolume] = useState<number>(editorPrefs?.voVolume ?? 1.0);
  const [musicVolume, setMusicVolume] = useState<number>(editorPrefs?.musicVolume ?? 0.22);
  const [referenceBreakdownId, setReferenceBreakdownId] = useState<string>(
    editorPrefs?.referenceBreakdownId || "",
  );

  const [trimStartSec, setTrimStartSec] = useState(0);
  const [trimDurationSec, setTrimDurationSec] = useState(8);
  const [captionOverlay, setCaptionOverlay] = useState("");
  const [zoomPct, setZoomPct] = useState(65);
  const [playing, setPlaying] = useState(false);

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [planActions, setPlanActions] = useState<string[]>([]);
  const [proposedPlan, setProposedPlan] = useState<{
    actions?: string[];
    trimStartSec?: number;
    trimDurationSec?: number;
    suggestedAspectRatio?: "9:16" | "16:9" | "1:1" | "4:5";
    captions?: Array<{ startSec: number; endSec: number; text: string }>;
    brollCues?: Array<{ startSec: number; durationSec: number; label: string }>;
  } | null>(null);
  const [undoStack, setUndoStack] = useState<
    Array<{
      trimStartSec: number;
      trimDurationSec: number;
      aspectRatio: "9:16" | "16:9" | "1:1" | "4:5";
      captionOverlay: string;
      captionsTrack: Array<{ startSec: number; endSec: number; text: string }>;
      brollCues: Array<{ startSec: number; durationSec: number; label: string }>;
      planActions: string[];
    }>
  >([]);
  const [logoUrl, setLogoUrl] = useState<string>(editorPrefs?.logoUrl || "");
  const [targetProjectId, setTargetProjectId] = useState<string>(
    () => activeProjectId || projects[0]?.id || "",
  );
  const [approvingGate, setApprovingGate] = useState(false);
  const [attachingProject, setAttachingProject] = useState(false);
  const [brollCues, setBrollCues] = useState<Array<{ startSec: number; durationSec: number; label: string }>>([]);
  const [captionsTrack, setCaptionsTrack] = useState<Array<{ startSec: number; endSec: number; text: string }>>([]);

  const activeTargetProject = projects.find((p) => p.id === targetProjectId) || null;

  const [breakdowns, setBreakdowns] = useState<VideoBreakdownItem[]>([]);
  const [rendering, setRendering] = useState(false);
  const [renderedUrl, setRenderedUrl] = useState("");
  const [renderJobs, setRenderJobs] = useState<VideoJobSummary[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  const logoAssets = mediaAssets.filter(
    (m) => m.kind === "image" && (m.category === "logo" || m.category === "brand_assets" || m.name.toLowerCase().includes("logo")),
  );
  const allImageAssets = mediaAssets.filter((m) => m.kind === "image");
  const logoCandidates = logoAssets.length > 0 ? logoAssets : allImageAssets;

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const appliedReferenceRef = useRef("");
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const persistPref = (patch: Partial<VideoEditorPreferences>) => {
    onChangeEditorPrefs?.(patch);
  };

  const refreshJobs = () => {
    apiGet<{ jobs: VideoJobSummary[] }>("/api/video/jobs")
      .then((res) => setRenderJobs(res.jobs || []))
      .catch(() => {});
  };

  const refreshBreakdowns = () => {
    apiGet<{ breakdowns: VideoBreakdownItem[] }>("/api/intelligence/video-breakdowns")
      .then((res) => setBreakdowns(res.breakdowns || []))
      .catch(() => {});
  };

  useEffect(() => {
    refreshJobs();
    refreshBreakdowns();
  }, []);

  useEffect(() => {
    if (activeProjectId) {
      setTargetProjectId(activeProjectId);
    } else if (!targetProjectId && projects.length > 0) {
      setTargetProjectId(projects[0].id);
    }
  }, [activeProjectId, projects, targetProjectId]);

  const approveProjectGateInline = async () => {
    if (!activeTargetProject) return;
    setApprovingGate(true);
    setErrorMsg("");
    try {
      let current = activeTargetProject;
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
      notify(`"${current.title}" approved for Video Editor & Publishing!`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to approve project gate");
    } finally {
      setApprovingGate(false);
    }
  };

  useEffect(() => {
    if (initialClips && initialClips.length > 0) {
      setSelectedClips((prev) => {
        const merged = [...initialClips];
        for (const u of prev) {
          if (!merged.includes(u)) merged.push(u);
        }
        return merged;
      });
      setSelectedSourceUrl(initialClips[0]);
      setRenderedUrl("");
      onConsumeInitialClips?.();
    }
  }, [initialClips, onConsumeInitialClips]);

  useEffect(() => {
    if (editorPrefs?.referenceBreakdownId && breakdowns.length > 0) {
      setReferenceBreakdownId(editorPrefs.referenceBreakdownId);
    }
  }, [editorPrefs?.referenceBreakdownId, breakdowns.length]);

  useEffect(() => {
    const referenceId = editorPrefs?.referenceBreakdownId || "";
    if (!referenceId || appliedReferenceRef.current === referenceId) return;
    const productClips = mediaAssets.filter((m) => m.kind === "video" && m.category === "product_demo_video" && m.url);
    if (productClips.length === 0) return;
    appliedReferenceRef.current = referenceId;
    setSelectedClips(productClips.map((m) => m.url));
    setSelectedSourceUrl(productClips[0].url);
    setRenderedUrl("");
    notify("Applied the reference edit onto your product demo clips.");
  }, [editorPrefs?.referenceBreakdownId, mediaAssets, notify]);

  const applyReferenceBreakdown = (bd: VideoBreakdownItem) => {
    setReferenceBreakdownId(bd.id);
    persistPref({ referenceBreakdownId: bd.id });
    if (bd.repeatableTemplate?.hookFormula) {
      setCaptionOverlay(bd.repeatableTemplate.hookFormula);
    }
    const derivedCaptions = (bd.timeline || []).slice(0, 6).map((t, i) => ({
      startSec: i * 2,
      endSec: i * 2 + 2,
      text: t.transcriptOrText || t.visualAction || bd.repeatableTemplate?.hookFormula || `Scene ${i + 1}`,
    }));
    if (derivedCaptions.length > 0) {
      setCaptionsTrack(derivedCaptions);
    }
    const derivedBroll = (bd.timeline || []).slice(0, 5).map((t, i) => ({
      startSec: i * 2,
      durationSec: 2,
      label: t.editingEffect || t.visualAction || `Beat ${i + 1}`,
    }));
    if (derivedBroll.length > 0) setBrollCues(derivedBroll);
    setPlanActions([
      `Hook Formula: ${bd.repeatableTemplate?.hookFormula || bd.hookBreakdown}`,
      ...(bd.repeatableTemplate?.sceneStructure || []).slice(0, 4),
    ]);
    if (bd.durationSec && bd.durationSec >= 2 && bd.durationSec <= 60) {
      setTrimDurationSec(bd.durationSec);
    }
    notify(`Loaded reference structure: "${bd.title}"`);
  };

  const isVideoSource =
    selectedSourceUrl.endsWith(".mp4") ||
    selectedSourceUrl.endsWith(".webm") ||
    selectedSourceUrl.endsWith(".mov");

  const toggleClipSelection = (url: string) => {
    setSelectedSourceUrl(url);
    setRenderedUrl("");
    setSelectedClips((prev) =>
      prev.includes(url) ? (prev.length > 1 ? prev.filter((x) => x !== url) : prev) : [...prev, url],
    );
  };

  const moveClip = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= selectedClips.length) return;
    const next = [...selectedClips];
    const [removed] = next.splice(idx, 1);
    next.splice(target, 0, removed);
    setSelectedClips(next);
  };

  const removeClipAt = (idx: number) => {
    const next = selectedClips.filter((_, i) => i !== idx);
    setSelectedClips(next);
    if (selectedSourceUrl === selectedClips[idx]) {
      setSelectedSourceUrl(next[0] || "");
    }
  };

  const handleUpload = async (file: File) => {
    setErrorMsg("");
    const category = file.type.startsWith("audio/")
      ? "voiceovers"
      : file.type.startsWith("image/")
        ? "product_demo_image"
        : "product_demo_video";
    try {
      const uploaded = await uploadMediaFileWithProgress(file, {
        category,
        description: category === "product_demo_video" ? "Product demonstration video" : "",
      });
      const asset: MediaAsset = {
        id: uploaded.id || `up-${Date.now()}`,
        name: uploaded.originalName,
        kind: uploaded.kind,
        url: uploaded.url,
        durationOrSize: `${Math.max(1, Math.round(uploaded.size / 1024))} KB`,
        sourceType: "imported",
        category: (uploaded.category as MediaAsset["category"]) || category,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes || uploaded.size,
      };
      onAddMediaAsset(asset);
      if (uploaded.kind === "audio") {
        setSelectedAudioUrl(uploaded.url);
        setMediaTab("audio");
      } else {
        setSelectedSourceUrl(uploaded.url);
        setSelectedClips((prev) => (prev.includes(uploaded.url) ? prev : [...prev, uploaded.url]));
        setRenderedUrl("");
      }
      notify(`Uploaded ${uploaded.originalName}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Media upload failed");
    }
  };

  const runAiPlan = async () => {
    if (!aiPrompt.trim()) return;
    setErrorMsg("");
    setAiBusy(true);
    try {
      const res = await apiPost<{
        plan: {
          actions?: string[];
          trimStartSec?: number;
          trimDurationSec?: number;
          suggestedAspectRatio?: "9:16" | "16:9" | "1:1" | "4:5";
          captions?: Array<{ startSec: number; endSec: number; text: string }>;
          brollCues?: Array<{ startSec: number; durationSec: number; label: string }>;
        };
      }>("/api/editor/ai-plan", {
        instruction: aiPrompt,
        projectTitle: activeTitle || workspace.name || "Untitled Clip",
        durationSec: trimDurationSec,
        aspectRatio,
        script: activeScriptText,
        business: workspace,
        model: models.textModel,
      });

      setProposedPlan(res.plan || {});
      notify("AI proposed an editing plan — review and click Apply Plan");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "AI edit plan failed");
    } finally {
      setAiBusy(false);
    }
  };

  const applyProposedPlan = () => {
    if (!proposedPlan) return;
    setUndoStack((prev) => [
      {
        trimStartSec,
        trimDurationSec,
        aspectRatio,
        captionOverlay,
        captionsTrack,
        brollCues,
        planActions,
      },
      ...prev.slice(0, 9),
    ]);
    if (proposedPlan.actions?.length) setPlanActions(proposedPlan.actions);
    if (typeof proposedPlan.trimStartSec === "number") setTrimStartSec(proposedPlan.trimStartSec);
    if (typeof proposedPlan.trimDurationSec === "number") {
      setTrimDurationSec(proposedPlan.trimDurationSec);
    }
    if (proposedPlan.suggestedAspectRatio) {
      setAspectRatio(proposedPlan.suggestedAspectRatio);
      persistPref({ aspectRatio: proposedPlan.suggestedAspectRatio });
    }
    if (proposedPlan.captions?.length) {
      setCaptionsTrack(proposedPlan.captions);
      setCaptionOverlay(proposedPlan.captions[0].text);
    }
    if (proposedPlan.brollCues?.length) setBrollCues(proposedPlan.brollCues);
    setProposedPlan(null);
    notify("AI editing plan applied (Undo available)");
  };

  const undoLastEditPlan = () => {
    const [last, ...rest] = undoStack;
    if (!last) return;
    setTrimStartSec(last.trimStartSec);
    setTrimDurationSec(last.trimDurationSec);
    setAspectRatio(last.aspectRatio);
    setCaptionOverlay(last.captionOverlay);
    setCaptionsTrack(last.captionsTrack);
    setBrollCues(last.brollCues);
    setPlanActions(last.planActions);
    setUndoStack(rest);
    notify("Reverted last AI edit plan");
  };

  const attachRenderedToProject = async () => {
    if (!renderedUrl || !targetProjectId || !onPatchProject) return;
    setAttachingProject(true);
    try {
      await onPatchProject(targetProjectId, {
        editedVideoUrl: renderedUrl,
        videoUrl: renderedUrl,
        caption:
          activeTargetProject?.caption?.trim() ||
          captionOverlay.trim() ||
          activeTargetProject?.hook ||
          activeTargetProject?.title ||
          "",
        status: "AWAITING_FINAL_APPROVAL",
      });
      notify("Attached rendered MP4 to Content Project (moved to Awaiting Final Approval)");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to attach render to project");
    } finally {
      setAttachingProject(false);
    }
  };

  const renderVideoFfmpeg = async () => {
    const clipsToRender =
      selectedClips.length > 0 ? selectedClips : selectedSourceUrl ? [selectedSourceUrl] : [];
    if (clipsToRender.length === 0) {
      setErrorMsg("Upload or select a video or image clip from Project Media before rendering.");
      return;
    }
    setErrorMsg("");
    setRendering(true);
    try {
      const effectiveCaptions =
        captionsTrack.length > 0
          ? captionsTrack
          : captionOverlay.trim()
            ? [{ startSec: 0, endSec: trimDurationSec, text: captionOverlay.trim() }]
            : [];

      const res = await apiPost<{
        jobId: string;
        renderUrl: string;
        filename: string;
        durationSec: number;
        width: number;
        height: number;
        clipsUsed: number;
        subtitlesBurned: boolean;
      }>("/api/editor/render", {
        sourceUrl: clipsToRender[0],
        clips: clipsToRender,
        audioUrl: selectedAudioUrl || undefined,
        musicUrl: selectedMusicUrl || undefined,
        logoUrl: logoUrl || undefined,
        burnSubtitles,
        captionsTrack: effectiveCaptions,
        aspectRatio,
        trimStartSec,
        trimDurationSec,
        speed,
        zoomFactor,
        fadeInOut,
        voVolume,
        musicVolume,
        title: activeTitle || workspace.name || "Untitled Clip",
      });
      const durableUrl = await keepGeneratedFile(res.renderUrl, res.filename);
      setRenderedUrl(durableUrl);
      onAddMediaAsset({
        id: `render-${Date.now()}`,
        name: res.filename,
        kind: "video",
        url: durableUrl,
        durationOrSize: `${res.durationSec}s · ${res.width}×${res.height}`,
        sourceType: "live_api",
        category: "campaign_creatives",
      });
      onConsumeCredits(110, "FFmpeg MP4 Render");
      refreshJobs();
      notify(
        `Rendered MP4 (${res.width}×${res.height}, ${res.clipsUsed} clip${res.clipsUsed > 1 ? "s" : ""})`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "FFmpeg render failed");
      refreshJobs();
    } finally {
      setRendering(false);
    }
  };

  const togglePlay = () => {
    if (videoElRef.current) {
      if (videoElRef.current.paused) {
        void videoElRef.current.play();
        setPlaying(true);
      } else {
        videoElRef.current.pause();
        setPlaying(false);
      }
    } else {
      setPlaying(!playing);
    }
  };

  const previewStyle =
    aspectRatio === "16:9"
      ? { width: "min(440px, 100%)", aspectRatio: "16 / 9" }
      : aspectRatio === "1:1"
        ? { width: "min(340px, 100%)", aspectRatio: "1 / 1" }
        : aspectRatio === "4:5"
          ? { width: "min(300px, 100%)", aspectRatio: "4 / 5" }
          : { width: "260px", aspectRatio: "9 / 16" };

  return (
    <div className="editor-page">
      <div className="editor-top">
        <span>
          <button onClick={() => go("Content Studio")}>←</button>
          <div>
            <b>{activeTitle || workspace.name || "Untitled Clip"}</b>
            <small>
              {editorMode === "ai" ? "AI-Assisted" : editorMode === "traditional" ? "Traditional" : "Hybrid"} studio ·{" "}
              {aspectRatio} · {speed}x · {selectedClips.length || (selectedSourceUrl ? 1 : 0)} clip(s)
            </small>
          </div>
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div className="tabs" style={{ margin: 0 }}>
            {(
              [
                ["ai", "AI-Assisted"],
                ["traditional", "Traditional"],
                ["hybrid", "Hybrid"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={editorMode === m ? "active" : ""}
                onClick={() => {
                  setEditorMode(m);
                  persistPref({ mode: m });
                  if (m === "traditional") setEditTab("props");
                  if (m === "ai") setEditTab("ai");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <ModelSelector
            label="AI"
            value={models.textModel}
            options={modelCatalog.text}
            onChange={onSelectTextModel}
            compact
          />
          {renderedUrl && (
            <a className="btn secondary" href={renderedUrl} download>
              ↓ Download MP4
            </a>
          )}
          <button
            className="btn primary"
            disabled={rendering || (!selectedSourceUrl && selectedClips.length === 0)}
            onClick={() => void renderVideoFfmpeg()}
          >
            {rendering ? "Rendering MP4…" : "Render MP4"}
          </button>
        </div>
      </div>

      {errorMsg && <div className="mos-error-box" style={{ margin: "8px 16px" }}>{errorMsg}</div>}

      {projects.length > 0 && (
        <div
          style={{
            margin: "8px 16px 0",
            padding: "8px 12px",
            background: "var(--surface)",
            border: `1px solid ${
              activeTargetProject &&
              (!activeTargetProject.scriptApproved ||
                ((activeTargetProject.storyboardScenes?.length || 0) > 0 && !activeTargetProject.storyboardApproved))
                ? "var(--gold)"
                : "var(--border)"
            }`,
            borderRadius: 8,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <b style={{ fontSize: 12 }}>Target Project:</b>
            <select
              className="filter"
              value={targetProjectId}
              onChange={(e) => {
                setTargetProjectId(e.target.value);
                onSelectProjectId?.(e.target.value);
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.status || p.stage})
                </option>
              ))}
            </select>
            {activeTargetProject && (
              <span
                className={`badge ${
                  activeTargetProject.scriptApproved &&
                  (!(activeTargetProject.storyboardScenes?.length || 0) || activeTargetProject.storyboardApproved)
                    ? "mint"
                    : "review"
                }`}
              >
                <i />
                {!activeTargetProject.scriptApproved
                  ? "Awaiting Script Approval"
                  : (activeTargetProject.storyboardScenes?.length || 0) > 0 && !activeTargetProject.storyboardApproved
                    ? "Awaiting Storyboard Approval"
                    : "Approved for Production"}
              </span>
            )}
          </div>
          {activeTargetProject &&
            (!activeTargetProject.scriptApproved ||
              ((activeTargetProject.storyboardScenes?.length || 0) > 0 && !activeTargetProject.storyboardApproved)) && (
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
                    : !activeTargetProject.scriptApproved
                      ? "✓ Approve Script Now"
                      : "✓ Approve Storyboard Now"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ height: 28, fontSize: 11 }}
                  onClick={() =>
                    onOpenProject
                      ? onOpenProject(
                          activeTargetProject,
                          !activeTargetProject.scriptApproved ? "scripts" : "storyboard",
                        )
                      : go("Content Studio")
                  }
                >
                  Review in Content Studio →
                </button>
              </div>
            )}
        </div>
      )}

      <div className="mos-editor-mobile-tabs">
        <button
          className={mobilePanel === "preview" ? "active" : ""}
          onClick={() => setMobilePanel("preview")}
        >
          Preview
        </button>
        <button
          className={mobilePanel === "media" ? "active" : ""}
          onClick={() => setMobilePanel("media")}
        >
          Media ({mediaAssets.length})
        </button>
        <button
          className={mobilePanel === "ai" ? "active" : ""}
          onClick={() => setMobilePanel("ai")}
        >
          AI Edit &amp; Trim
        </button>
      </div>

      <div className={`editor-workspace mob-${mobilePanel}`}>
        <aside className="media-panel">
          <div className="vertical-tabs">
            <button className={mediaTab === "media" ? "active" : ""} onClick={() => setMediaTab("media")}>
              <span>▤</span>
              <span>Media</span>
            </button>
            <button className={mediaTab === "audio" ? "active" : ""} onClick={() => setMediaTab("audio")}>
              <span>♫</span>
              <span>Audio</span>
            </button>
            <button className={mediaTab === "brand" ? "active" : ""} onClick={() => setMediaTab("brand")}>
              <span>◈</span>
              <span>Jobs</span>
            </button>
          </div>

          <div className="media-browser">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
              <h3>Project media</h3>
              <button
                type="button"
                className="text-button"
                style={{ fontSize: 10 }}
                onClick={() => go("Media Library")}
              >
                Library →
              </button>
            </div>
            <input
              ref={uploadInputRef}
              type="file"
              accept="video/*,image/*,audio/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <button className="upload-small" onClick={() => uploadInputRef.current?.click()}>
              ＋ Upload product demo video
            </button>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>
              Drop in your product demo, photos, or voiceover. The editor uses these files. It does not replace them with a stock face.
            </p>

            {mediaTab === "media" && (
              <>
                <label>VISUAL CLIPS &amp; FRAMES (CLICK TO ADD TO SEQUENCE)</label>
                <div className="media-grid">
                  {visualAssets.map((item) => {
                    const inSequence = selectedClips.includes(item.url);
                    const seqIdx = selectedClips.indexOf(item.url);
                    return (
                      <div
                        key={item.id}
                        className="media-item"
                        onClick={() => toggleClipSelection(item.url)}
                        style={{
                          border:
                            inSequence || selectedSourceUrl === item.url
                              ? "2px solid var(--mint)"
                              : "1px solid var(--border)",
                          cursor: "pointer",
                          position: "relative",
                        }}
                      >
                        {item.url.endsWith(".mp4") || item.kind === "video" ? (
                          <video src={item.url} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <img src={item.url} alt={item.name} />
                        )}
                        <small>
                          {seqIdx >= 0 ? `#${seqIdx + 1} · ` : ""}
                          {item.name}
                        </small>
                      </div>
                    );
                  })}
                </div>

                {selectedClips.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <label>ACTIVE TIMELINE SEQUENCE ({selectedClips.length})</label>
                    <div className="mos-stack" style={{ marginTop: 6 }}>
                      {selectedClips.map((clipUrl, idx) => {
                        const matched = mediaAssets.find((m) => m.url === clipUrl);
                        return (
                          <div
                            key={`${clipUrl}-${idx}`}
                            className="mos-list-row"
                            style={{ padding: "6px 8px" }}
                          >
                            <small style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                              <b>#{idx + 1}</b> {matched?.name || clipUrl.split("/").pop()}
                            </small>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                type="button"
                                className="btn ghost"
                                style={{ height: 22, padding: "0 5px", fontSize: 10 }}
                                disabled={idx === 0}
                                onClick={() => moveClip(idx, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="btn ghost"
                                style={{ height: 22, padding: "0 5px", fontSize: 10 }}
                                disabled={idx === selectedClips.length - 1}
                                onClick={() => moveClip(idx, 1)}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="btn ghost"
                                style={{ height: 22, padding: "0 5px", fontSize: 10, color: "#ff9c9c" }}
                                onClick={() => removeClipAt(idx)}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            {mediaTab === "audio" && (
              <>
                <label>VOICEOVER &amp; MUSIC TRACKS</label>
                {audioAssets.length === 0 ? (
                  <p style={{ fontSize: 11, color: "var(--muted)" }}>
                    Generate voiceover or Lyria music in Voice Studio, or upload an audio file.
                  </p>
                ) : (
                  audioAssets.map((aud) => (
                    <div
                      key={aud.id}
                      className="audio-asset"
                      onClick={() =>
                        setSelectedAudioUrl(selectedAudioUrl === aud.url ? "" : aud.url)
                      }
                      style={{
                        cursor: "pointer",
                        border:
                          selectedAudioUrl === aud.url
                            ? "1px solid var(--mint)"
                            : "1px solid var(--border)",
                        marginBottom: 8,
                      }}
                    >
                      ♫{" "}
                      <span>
                        <b>{aud.name}</b>
                        <small>{aud.durationOrSize}</small>
                      </span>
                    </div>
                  ))
                )}
              </>
            )}

            {mediaTab === "brand" && (
              <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
                <label>Logo Watermark Overlay (Brand Assets)</label>
                <select
                  value={logoUrl}
                  onChange={(e) => {
                    setLogoUrl(e.target.value);
                    persistPref({ logoUrl: e.target.value });
                  }}
                >
                  <option value="">No logo watermark</option>
                  {logoCandidates.map((l) => (
                    <option key={l.id} value={l.url}>
                      {l.name} ({l.category || l.kind})
                    </option>
                  ))}
                </select>
                <label>On-Screen Hook / Captions</label>
                <input
                  style={{
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    color: "var(--text)",
                  }}
                  placeholder="Enter caption text…"
                  value={captionOverlay}
                  onChange={(e) => setCaptionOverlay(e.target.value)}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={burnSubtitles}
                    onChange={(e) => {
                      setBurnSubtitles(e.target.checked);
                      persistPref({ burnSubtitles: e.target.checked });
                    }}
                  />
                  <span>Burn subtitles into MP4</span>
                </label>
                {renderedUrl && projects.length > 0 && onPatchProject && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 4 }}>
                    <label>Attach Render to Content Project</label>
                    <select
                      value={targetProjectId}
                      onChange={(e) => {
                        setTargetProjectId(e.target.value);
                        onSelectProjectId?.(e.target.value);
                      }}
                      style={{ marginTop: 4 }}
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} ({p.status || p.stage})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn primary"
                      style={{ width: "100%", marginTop: 6, height: 30, fontSize: 11 }}
                      disabled={attachingProject || !targetProjectId}
                      onClick={() => void attachRenderedToProject()}
                    >
                      {attachingProject ? "Attaching…" : "Attach MP4 & Request Final Approval →"}
                    </button>
                  </div>
                )}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <b>Render Job History ({renderJobs.length})</b>
                    <button className="text-button" onClick={refreshJobs}>Refresh</button>
                  </div>
                  {renderJobs.length === 0 ? (
                    <small style={{ color: "var(--muted)" }}>No render jobs yet.</small>
                  ) : (
                    renderJobs.slice(0, 5).map((job) => (
                      <div key={job.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                          <b>{job.title.slice(0, 18)}</b>
                          <small style={{ color: job.status === "completed" ? "var(--mint)" : job.status === "failed" ? "var(--red)" : "var(--gold)" }}>
                            {job.status}
                          </small>
                        </div>
                        {job.renderUrl && (
                          <a href={job.renderUrl} download style={{ color: "var(--mint)", fontSize: 11 }}>
                            ↓ Download MP4 ({job.width}×{job.height})
                          </a>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>

        <section className="preview-panel">
          <div className="preview-canvas">
            <div className="video-frame" style={previewStyle}>
              {renderedUrl ? (
                <video
                  ref={videoElRef}
                  src={renderedUrl}
                  controls
                  autoPlay
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : !selectedSourceUrl ? (
                <div
                  style={{
                    height: "100%",
                    display: "grid",
                    placeItems: "center",
                    padding: 20,
                    textAlign: "center",
                    color: "var(--muted)",
                    fontSize: 12,
                  }}
                >
                  <div>
                    <b style={{ display: "block", color: "var(--text)", marginBottom: 6 }}>
                      No clip loaded
                    </b>
                    Upload video/image assets or select clips from Media Library.
                  </div>
                </div>
              ) : isVideoSource ? (
                <video
                  ref={videoElRef}
                  src={selectedSourceUrl}
                  controls
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: `scale(${zoomFactor})`,
                  }}
                />
              ) : (
                <img
                  src={selectedSourceUrl}
                  alt="Video frame preview"
                  style={{ transform: `scale(${zoomFactor})`, width: "100%", height: "100%", objectFit: "cover" }}
                />
              )}

              {!renderedUrl && selectedSourceUrl && (
                <>
                  {captionOverlay && <div className="caption-overlay">{captionOverlay}</div>}
                  {workspace.name && (
                    <div className="video-brand">{workspace.name.toUpperCase()}</div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="playback">
            <button onClick={() => setTrimStartSec(Math.max(0, trimStartSec - 1))}>◀</button>
            <button onClick={togglePlay}>{playing ? "Ⅱ" : "▶"}</button>
            <button onClick={() => setTrimStartSec(0)}>▶|</button>
            <span>
              00:{String(trimStartSec).padStart(2, "0")} / 00:{String(trimDurationSec).padStart(2, "0")}
            </span>
            <div className="spacer" />
            <select
              className="filter"
              value={aspectRatio}
              onChange={(e) => {
                const ar = e.target.value as "9:16" | "16:9" | "1:1" | "4:5";
                setAspectRatio(ar);
                persistPref({ aspectRatio: ar });
              }}
            >
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
              <option value="1:1">1:1</option>
              <option value="4:5">4:5</option>
            </select>
          </div>
        </section>

        <aside className="edit-panel">
          <div className="edit-tabs">
            {editorMode !== "traditional" && (
              <button className={editTab === "ai" ? "active" : ""} onClick={() => setEditTab("ai")}>
                AI Assistant
              </button>
            )}
            {editorMode !== "ai" && (
              <button className={editTab === "props" ? "active" : ""} onClick={() => setEditTab("props")}>
                Trim, Speed &amp; Mix
              </button>
            )}
          </div>

          {editTab === "ai" && editorMode !== "traditional" ? (
            <div className="assistant-chat">
              <div className="assistant-logo">✦</div>
              <h3>Edit with AI</h3>
              <p>Describe the edit you want or load a analyzed Reference Viral Video structure.</p>

              {breakdowns.length > 0 && (
                <div className="mos-subcard" style={{ marginBottom: 10, width: "100%", textAlign: "left" }}>
                  <small style={{ color: "var(--mint)", fontWeight: 600 }}>Reference Viral Breakdown</small>
                  <select
                    style={{
                      width: "100%",
                      marginTop: 6,
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "6px 8px",
                      color: "var(--text)",
                      fontSize: 11,
                    }}
                    value={referenceBreakdownId}
                    onChange={(e) => setReferenceBreakdownId(e.target.value)}
                  >
                    <option value="">Select analyzed reference video…</option>
                    {breakdowns.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title} ({b.platform})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ width: "100%", marginTop: 6, height: 28, fontSize: 11 }}
                    disabled={!referenceBreakdownId}
                    onClick={() => {
                      const bd = breakdowns.find((b) => b.id === referenceBreakdownId);
                      if (bd) applyReferenceBreakdown(bd);
                    }}
                  >
                    Apply Reference Structure →
                  </button>
                </div>
              )}

              <div className="prompt-box">
                <textarea
                  placeholder="Describe the edit: trim pacing, remove pauses, generate captions, and plan B-roll cues…"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    className="btn primary"
                    disabled={aiBusy || !aiPrompt.trim()}
                    onClick={() => void runAiPlan()}
                  >
                    {aiBusy ? "Proposing plan…" : "Propose edit plan ↑"}
                  </button>
                  {undoStack.length > 0 && (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={undoLastEditPlan}
                    >
                      ↺ Undo ({undoStack.length})
                    </button>
                  )}
                </div>
              </div>
              {proposedPlan && (
                <div className="mos-confirm-box" style={{ marginTop: 10, width: "100%", textAlign: "left" }}>
                  <b>Proposed AI Edit Plan (Review Before Applying)</b>
                  {(proposedPlan.actions || []).map((a) => (
                    <p key={a} style={{ fontSize: 11, marginTop: 4 }}>• {a}</p>
                  ))}
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button type="button" className="btn primary" onClick={applyProposedPlan}>
                      Apply Plan to Timeline
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setProposedPlan(null)}>
                      Discard
                    </button>
                  </div>
                </div>
              )}
              {planActions.length > 0 && (
                <div className="edit-plan">
                  <div>
                    <span>✓</span>
                    <b>Editing plan active</b>
                  </div>
                  {planActions.map((x) => (
                    <p key={x}>✓ {x}</p>
                  ))}
                  {renderedUrl && projects.length > 0 && onPatchProject && (
                    <div style={{ marginTop: 8, marginBottom: 8 }}>
                      <button
                        type="button"
                        className="btn primary"
                        style={{ width: "100%" }}
                        disabled={attachingProject || !targetProjectId}
                        onClick={() => void attachRenderedToProject()}
                      >
                        {attachingProject ? "Attaching…" : "Attach Rendered MP4 to Project →"}
                      </button>
                    </div>
                  )}
                  <button
                    className="btn secondary"
                    onClick={() => go("Audience Simulation")}
                  >
                    Run quality evaluation →
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="assistant-chat" style={{ display: "grid", gap: 10, textAlign: "left" }}>
              <h3>Traditional Trim, FX &amp; Audio Mix</h3>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <span>Trim start (seconds)</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={trimStartSec}
                  onChange={(e) => setTrimStartSec(Number(e.target.value))}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <span>Output duration (seconds)</span>
                <input
                  type="number"
                  min={2}
                  max={60}
                  value={trimDurationSec}
                  onChange={(e) => setTrimDurationSec(Number(e.target.value))}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <span>Playback Speed ({speed.toFixed(2)}x)</span>
                <input
                  type="range"
                  min={0.75}
                  max={1.5}
                  step={0.05}
                  value={speed}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setSpeed(v);
                    persistPref({ speed: v });
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <span>Crop Zoom ({zoomFactor.toFixed(2)}x)</span>
                <input
                  type="range"
                  min={1.0}
                  max={1.3}
                  step={0.05}
                  value={zoomFactor}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setZoomFactor(v);
                    persistPref({ zoomFactor: v });
                  }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={fadeInOut}
                  onChange={(e) => {
                    setFadeInOut(e.target.checked);
                    persistPref({ fadeInOut: e.target.checked });
                  }}
                />
                <span>Fade in &amp; fade out transitions</span>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <span>Voiceover narration track (Vol {Math.round(voVolume * 100)}%)</span>
                <select
                  value={selectedAudioUrl}
                  onChange={(e) => setSelectedAudioUrl(e.target.value)}
                >
                  <option value="">None / Original video audio</option>
                  {audioAssets.map((a) => (
                    <option key={a.id} value={a.url}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <input
                  type="range"
                  min={0.2}
                  max={1.8}
                  step={0.1}
                  value={voVolume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVoVolume(v);
                    persistPref({ voVolume: v });
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <span>Background music bed (Vol {Math.round(musicVolume * 100)}%)</span>
                <select
                  value={selectedMusicUrl}
                  onChange={(e) => setSelectedMusicUrl(e.target.value)}
                >
                  <option value="">None</option>
                  {audioAssets.map((a) => (
                    <option key={a.id} value={a.url}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <input
                  type="range"
                  min={0}
                  max={1.0}
                  step={0.05}
                  value={musicVolume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setMusicVolume(v);
                    persistPref({ musicVolume: v });
                  }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={burnSubtitles}
                  onChange={(e) => {
                    setBurnSubtitles(e.target.checked);
                    persistPref({ burnSubtitles: e.target.checked });
                  }}
                />
                <span>Burn-in captions / hook overlay</span>
              </label>
              <button
                className="btn primary"
                disabled={rendering || (!selectedSourceUrl && selectedClips.length === 0)}
                onClick={() => void renderVideoFfmpeg()}
              >
                {rendering ? "Encoding MP4…" : "Render Final MP4"}
              </button>
            </div>
          )}
        </aside>
      </div>

      <div className="timeline">
        <div className="timeline-tools">
          <button onClick={() => setTrimDurationSec(Math.max(2, trimDurationSec - 1))}>✂ Trim -1s</button>
          <span />
          <small>
            00:{String(trimStartSec).padStart(2, "0")} → 00:{String(trimStartSec + trimDurationSec).padStart(2, "0")} ·{" "}
            {selectedClips.length || 1} visual clip(s) · {speed}x speed · {zoomFactor.toFixed(2)}x zoom
          </small>
          <div>
            −{" "}
            <input
              type="range"
              min={30}
              max={100}
              value={zoomPct}
              onChange={(e) => setZoomPct(Number(e.target.value))}
            />{" "}
            ＋
          </div>
        </div>

        <div className="tracks">
          <div className="track-labels">
            {["Video 1", "B-roll", "Captions", "Audio Mix"].map((x) => (
              <span key={x}>
                {x}
                <i>◉</i>
              </span>
            ))}
          </div>
          <div className="track-area" style={{ minWidth: `${zoomPct * 7}px` }}>
            <div className="ruler">00:00　　00:05　　00:10　　00:15　　00:20　　00:25　　00:30</div>
            <div className="track video">
              {(selectedClips.length > 0 ? selectedClips : ["Clip 1"]).map((clip, i) => (
                <i
                  key={clip + i}
                  style={{ width: `${Math.max(18, Math.floor(96 / Math.max(1, selectedClips.length || 1)))}%` }}
                >
                  <span>Clip {i + 1}</span>
                </i>
              ))}
            </div>
            <div className="track broll">
              {brollCues.length === 0 ? (
                <i style={{ left: "0%", width: "100%", opacity: 0.6 }}>No B-roll cues yet</i>
              ) : (
                brollCues.map((b, idx) => (
                  <i
                    key={b.label + idx}
                    style={{
                      left: `${Math.min(80, b.startSec * 4)}%`,
                      width: `${Math.max(10, b.durationSec * 4)}%`,
                    }}
                  >
                    {b.label}
                  </i>
                ))
              )}
            </div>
            <div className="track captions">
              {captionsTrack.length === 0 ? (
                <i style={{ opacity: 0.6 }}>
                  {captionOverlay ? `Overlay: ${captionOverlay}` : "No captions planned yet — run AI Edit Plan or load Reference Breakdown"}
                </i>
              ) : (
                captionsTrack.map((c, idx) => <i key={c.text + idx}>{c.text}</i>)
              )}
            </div>
            <div className="track audio">
              <i>
                {selectedAudioUrl && selectedMusicUrl
                  ? `♫ VO (${Math.round(voVolume * 100)}%) + Music (${Math.round(musicVolume * 100)}%)`
                  : selectedAudioUrl
                    ? `♫ Voiceover Track Active (${Math.round(voVolume * 100)}%)`
                    : selectedMusicUrl
                      ? `♫ Music Bed Active (${Math.round(musicVolume * 100)}%)`
                      : "No external audio selected"}
              </i>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
