import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  limit,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  DEFAULT_MODEL_CATALOG,
  createDefaultWorkspace,
} from "../data/defaults";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, setActiveWorkspaceHeaderId } from "../lib/api";
import {
  OperationType,
  auth,
  consumeGoogleRedirectResult,
  db,
  deleteCurrentUserAccount,
  handleFirestoreError,
  isGoogleSignedInUser,
  signOutGoogle,
  testConnection,
} from "../lib/firebase";
import type {
  AdCampaignItem,
  AiMemoryItem,
  AudienceEvalResult,
  AutomationExecutionLog,
  AutomationRunLog,
  AutomationWorkflow,
  BrandAssetCategory,
  CalendarPost,
  CompetitorItem,
  ContentProject,
  CreditTransaction,
  InfluencerItem,
  MediaAsset,
  ModelCatalog,
  ModelPreferences,
  NotebookSectionInsight,
  NotebookVersion,
  Page,
  PresenterPreset,
  SavedStrategy,
  SeoIssueItem,
  SeoKeywordItem,
  SourceType,
  StrategyPlan,
  TrendFormatItem,
  VideoEditorPreferences,
  WorkspaceProfile,
} from "../types/marketing";

const LOCAL_STORAGE_KEY = "mos-workspace-state-v3";
const USER_ACTIVE_WS_PREFIX = "mos-user-active-ws:";
const ACCOUNT_WS_PREFIX = "mos-account-workspace:";
const WS_CACHE_PREFIX = "mos-ws-data:";

function workspaceIsEstablished(ws: Partial<WorkspaceProfile> | null | undefined): boolean {
  if (!ws) return false;
  const name = (ws.name || "").trim();
  const hasBusiness =
    (ws.websiteUrl || "").trim().length > 3 ||
    (ws.description || "").trim().length >= 12 ||
    (ws.positioning || "").trim().length >= 12 ||
    (ws.valueProposition || "").trim().length >= 12 ||
    (ws.brandVoiceNotes || "").trim().length >= 12 ||
    (ws.products || []).length > 0 ||
    (ws.objectives || []).length > 0 ||
    (ws.channels || []).length > 0;
  return Boolean(ws.onboarded) || (name.length > 1 && hasBusiness);
}

function readDraftWorkspace(uid: string): WorkspaceProfile | null {
  const keys = [`mos-onboarding-draft-v1:${uid}`, "mos-onboarding-draft-v1"];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const draft = JSON.parse(raw) as {
        name?: string;
        url?: string;
        industry?: string;
        companySize?: string;
        description?: string;
        location?: string;
        targetCountries?: string;
        selectedProducts?: string[];
        selectedObjectives?: string[];
        selectedChannels?: string[];
      };
      const name = (draft.name || "").trim();
      const websiteUrl = (draft.url || "").trim();
      const description = (draft.description || "").trim();
      const products = draft.selectedProducts || [];
      if (name.length < 2) continue;
      if (websiteUrl.length < 4 && description.length < 12 && products.length === 0) continue;
      const base = createDefaultWorkspace(uid);
      const stableId = `ws-${uid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 18) || "acct"}-primary`;
      return {
        ...base,
        id: stableId,
        ownerId: uid,
        name,
        websiteUrl,
        industry: draft.industry || base.industry,
        companySize: draft.companySize || base.companySize,
        description,
        location: draft.location || "",
        targetCountries: draft.targetCountries || "",
        products,
        objectives: draft.selectedObjectives || [],
        channels: draft.selectedChannels || [],
        onboarded: true,
        isDemo: false,
      };
    } catch {
      // Ignore a damaged draft and try the next key.
    }
  }
  return null;
}

function readAccountWorkspace(uid: string): WorkspaceProfile | null {
  try {
    const raw = localStorage.getItem(`${ACCOUNT_WS_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceProfile;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

function safeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${rand}`.replace(/[^a-zA-Z0-9_-]/g, "");
}

function clampStr(v: string | undefined, max: number): string {
  return (v || "").slice(0, max);
}

interface WorkspaceDataCache {
  insights: NotebookSectionInsight[];
  competitors: CompetitorItem[];
  influencers: InfluencerItem[];
  trends: TrendFormatItem[];
  seoIssues: SeoIssueItem[];
  seoKeywords: SeoKeywordItem[];
  strategy: StrategyPlan | null;
  projects: ContentProject[];
  mediaAssets: MediaAsset[];
  calendarPosts: CalendarPost[];
  audienceEval: AudienceEvalResult | null;
  adCampaigns: AdCampaignItem[];
  automationRuns: AutomationRunLog[];
  activeScriptTitle: string;
  activeScriptText: string;
  activePage?: Page;
}

const DEFAULT_EDITOR_PREFS: VideoEditorPreferences = {
  mode: "hybrid",
  aspectRatio: "9:16",
  speed: 1.0,
  zoomFactor: 1.0,
  fadeInOut: false,
  voVolume: 1.0,
  musicVolume: 0.22,
  burnSubtitles: true,
};

interface PersistedLocalState {
  workspace: WorkspaceProfile;
  activePage?: Page;
  activeScriptTitle?: string;
  activeScriptText?: string;
  videoEditorPrefs?: VideoEditorPreferences;
  insights: NotebookSectionInsight[];
  competitors: CompetitorItem[];
  influencers: InfluencerItem[];
  trends: TrendFormatItem[];
  seoIssues: SeoIssueItem[];
  seoKeywords: SeoKeywordItem[];
  strategy: StrategyPlan | null;
  projects: ContentProject[];
  mediaAssets: MediaAsset[];
  calendarPosts: CalendarPost[];
  audienceEval: AudienceEvalResult | null;
  adCampaigns: AdCampaignItem[];
  automationRuns: AutomationRunLog[];
  creditTransactions: CreditTransaction[];
  notebookVersions: NotebookVersion[];
  models: ModelPreferences;
}

function createEmptyLocalState(): PersistedLocalState {
  return {
    workspace: createDefaultWorkspace(),
    activePage: "Overview",
    activeScriptTitle: "",
    activeScriptText: "",
    videoEditorPrefs: DEFAULT_EDITOR_PREFS,
    insights: [],
    competitors: [],
    influencers: [],
    trends: [],
    seoIssues: [],
    seoKeywords: [],
    strategy: null,
    projects: [],
    mediaAssets: [],
    calendarPosts: [],
    audienceEval: null,
    adCampaigns: [],
    automationRuns: [],
    creditTransactions: [],
    notebookVersions: [],
    models: {
      textModel: "gemini-4-hydrogen",
      imageModel: "gemini-nano-banana-2.1",
      videoModel: "gemini-omni-1.2-flash",
      voiceModel: "gemini-3.8-flash-lite-tts",
      musicModel: "lyria-3-clip-preview",
    },
  };
}

export function useMarketingOS() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [workspacesResolved, setWorkspacesResolved] = useState(false);
  const [firestoreOnline, setFirestoreOnline] = useState(false);

  const [modelCatalog, setModelCatalog] = useState<ModelCatalog>(DEFAULT_MODEL_CATALOG);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(true);
  const [savedWorkspaces, setSavedWorkspaces] = useState<WorkspaceProfile[]>([]);

  const loadLocal = (): PersistedLocalState => {
    const empty = createEmptyLocalState();
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedLocalState>;
        if (parsed.workspace) {
          return {
            workspace: { ...empty.workspace, ...parsed.workspace, isDemo: false },
            activePage: parsed.activePage || "Overview",
            activeScriptTitle: parsed.activeScriptTitle || "",
            activeScriptText: parsed.activeScriptText || "",
            videoEditorPrefs: { ...DEFAULT_EDITOR_PREFS, ...(parsed.videoEditorPrefs || {}) },
            insights: parsed.insights || [],
            competitors: parsed.competitors || [],
            influencers: parsed.influencers || [],
            trends: parsed.trends || [],
            seoIssues: parsed.seoIssues || [],
            seoKeywords: parsed.seoKeywords || [],
            strategy: parsed.strategy || null,
            projects: parsed.projects || [],
            mediaAssets: parsed.mediaAssets || [],
            calendarPosts: parsed.calendarPosts || [],
            audienceEval: parsed.audienceEval || null,
            adCampaigns: parsed.adCampaigns || [],
            automationRuns: parsed.automationRuns || [],
            creditTransactions: parsed.creditTransactions || [],
            notebookVersions: parsed.notebookVersions || [],
            models: parsed.models || {
              textModel: parsed.workspace.preferredTextModel || "gemini-4-hydrogen",
              imageModel: parsed.workspace.preferredImageModel || "gemini-nano-banana-2.1",
              videoModel: parsed.workspace.preferredVideoModel || "gemini-omni-1.2-flash",
              voiceModel: parsed.workspace.preferredVoiceModel || "gemini-3.8-flash-lite-tts",
              musicModel: "lyria-3-clip-preview",
            },
          };
        }
      }
    } catch {
      // Ignore corrupt local storage
    }
    return empty;
  };

  const initial = useState<PersistedLocalState>(loadLocal)[0];

  const [workspace, setWorkspace] = useState<WorkspaceProfile>(initial.workspace);
  const [activePage, setActivePage] = useState<Page>(initial.activePage || "Overview");
  const [activeScriptTitle, setActiveScriptTitle] = useState<string>(initial.activeScriptTitle || "");
  const [activeScriptText, setActiveScriptText] = useState<string>(initial.activeScriptText || "");
  const [videoEditorPrefs, setVideoEditorPrefs] = useState<VideoEditorPreferences>(
    initial.videoEditorPrefs || DEFAULT_EDITOR_PREFS,
  );
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string>("");
  const [resumeBanner, setResumeBanner] = useState<{
    lastPage: Page;
    savedAt: string;
    scriptTitle?: string;
  } | null>(null);
  const [memories, setMemories] = useState<AiMemoryItem[]>([]);

  const [insights, setInsights] = useState<NotebookSectionInsight[]>(initial.insights);
  const [competitors, setCompetitors] = useState<CompetitorItem[]>(initial.competitors);
  const [influencers, setInfluencers] = useState<InfluencerItem[]>(initial.influencers);
  const [trends, setTrends] = useState<TrendFormatItem[]>(initial.trends);
  const [seoIssues, setSeoIssues] = useState<SeoIssueItem[]>(initial.seoIssues);
  const [seoKeywords, setSeoKeywords] = useState<SeoKeywordItem[]>(initial.seoKeywords);
  const [strategy, setStrategy] = useState<StrategyPlan | null>(initial.strategy);
  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const [projects, setProjects] = useState<ContentProject[]>(initial.projects);
  const [presenters, setPresenters] = useState<PresenterPreset[]>([]);
  const [workflows, setWorkflows] = useState<AutomationWorkflow[]>([]);
  const [workflowExecutions, setWorkflowExecutions] = useState<AutomationExecutionLog[]>([]);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>(initial.mediaAssets);
  const [calendarPosts, setCalendarPosts] = useState<CalendarPost[]>(initial.calendarPosts);
  const [audienceEval, setAudienceEval] = useState<AudienceEvalResult | null>(initial.audienceEval);
  const [adCampaigns, setAdCampaigns] = useState<AdCampaignItem[]>(initial.adCampaigns);
  const [automationRuns, setAutomationRuns] = useState<AutomationRunLog[]>(initial.automationRuns);
  const [creditTransactions, setCreditTransactions] = useState<CreditTransaction[]>(
    initial.creditTransactions,
  );
  const [notebookVersions, setNotebookVersions] = useState<NotebookVersion[]>(
    initial.notebookVersions,
  );
  const [models, setModels] = useState<ModelPreferences>(initial.models);

  const latestWorkspaceRef = useRef(workspace);
  const sessionRestoredFor = useRef("");
  const cloudMirrorSignature = useRef("");
  latestWorkspaceRef.current = workspace;
  const savedActiveWorkspaceIdRef = useRef<string>("");
  const userSwitchedWorkspaceRef = useRef<boolean>(false);
  const prevAuthUidRef = useRef<string | null>(null);
  const autoProvisionedForUidRef = useRef<string | null>(null);

  // Sync workspace ID header immediately
  useEffect(() => {
    setActiveWorkspaceHeaderId(workspace.id || "default");
  }, [workspace.id]);

  useEffect(() => {
    if (!authUser || !workspaceIsEstablished(workspace)) return;
    try {
      localStorage.setItem(
        `${ACCOUNT_WS_PREFIX}${authUser.uid}`,
        JSON.stringify({ ...workspace, ownerId: authUser.uid, onboarded: true }),
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [authUser, workspace]);

  // Persist workspace state locally + per-workspace cache
  useEffect(() => {
    try {
      const snapshot: PersistedLocalState = {
        workspace,
        activePage,
        activeScriptTitle,
        activeScriptText,
        videoEditorPrefs,
        insights,
        competitors,
        influencers,
        trends,
        seoIssues,
        seoKeywords,
        strategy,
        projects,
        mediaAssets,
        calendarPosts,
        audienceEval,
        adCampaigns,
        automationRuns,
        creditTransactions,
        notebookVersions,
        models,
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(snapshot));
      if (workspace.id && workspace.onboarded) {
        const wsCache: WorkspaceDataCache = {
          insights,
          competitors,
          influencers,
          trends,
          seoIssues,
          seoKeywords,
          strategy,
          projects,
          mediaAssets,
          calendarPosts,
          audienceEval,
          adCampaigns,
          automationRuns,
          activeScriptTitle,
          activeScriptText,
          activePage,
        };
        localStorage.setItem(`${WS_CACHE_PREFIX}${workspace.id}`, JSON.stringify(wsCache));
      }
    } catch {
      // Ignore storage quota errors
    }
  }, [
    workspace,
    activePage,
    activeScriptTitle,
    activeScriptText,
    videoEditorPrefs,
    insights,
    competitors,
    influencers,
    trends,
    seoIssues,
    seoKeywords,
    strategy,
    projects,
    mediaAssets,
    calendarPosts,
    audienceEval,
    adCampaigns,
    automationRuns,
    creditTransactions,
    notebookVersions,
    models,
  ]);

  const flushWorkspaceSnapshotNow = useCallback(async () => {
    if (!workspace.onboarded || !workspace.id) return;
    setSaveStatus("saving");
    try {
      await apiPut("/api/workspace-state", {
        websiteUrl: workspace.websiteUrl,
        businessName: workspace.name,
        lastPage: activePage,
        activeScriptTitle,
        activeScriptText,
        videoEditorState: videoEditorPrefs as unknown as Record<string, unknown>,
      });
      setSaveStatus("saved");
      setLastSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch {
      setSaveStatus("error");
    }
  }, [
    workspace.onboarded,
    workspace.id,
    workspace.websiteUrl,
    workspace.name,
    activePage,
    activeScriptTitle,
    activeScriptText,
    videoEditorPrefs,
  ]);

  // Debounced server auto-save for continuity & weekly SEO monitoring
  const autoSaveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!workspace.onboarded || !workspace.id) return;
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      void flushWorkspaceSnapshotNow();
    }, 1500);
    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, [flushWorkspaceSnapshotNow, workspace.onboarded, workspace.id]);

  // Hydrate server snapshot, media assets, and structured AI memory on workspace load
  const fetchMemories = useCallback(async (scope?: string) => {
    try {
      const qs = scope ? `?scope=${encodeURIComponent(scope)}` : "";
      const res = await apiGet<{ memories: AiMemoryItem[] }>(`/api/memory${qs}`);
      setMemories(res.memories || []);
    } catch {
      // non-fatal on startup
    }
  }, []);

  const fetchServerMedia = useCallback(async () => {
    try {
      const res = await apiGet<{
        assets: Array<{
          id: string;
          url: string;
          originalName: string;
          mimeType: string;
          sizeBytes: number;
          kind: "video" | "image" | "audio" | "document";
          category: string;
          tags: string[];
          description: string;
          aiAnalysis?: MediaAsset["aiAnalysis"];
          createdAt: string;
        }>;
      }>("/api/media");
      if (Array.isArray(res.assets) && res.assets.length > 0) {
        const mapped: MediaAsset[] = res.assets.map((a) => ({
          id: a.id,
          name: a.originalName,
          kind: a.kind,
          url: a.url,
          durationOrSize: `${Math.max(1, Math.round((a.sizeBytes || 0) / 1024))} KB`,
          sourceType: "imported",
          category: a.category as BrandAssetCategory,
          tags: a.tags,
          description: a.description,
          sizeBytes: a.sizeBytes,
          mimeType: a.mimeType,
          createdAt: a.createdAt,
          aiAnalysis: a.aiAnalysis,
        }));
        setMediaAssets((prev) => {
          const existingUrls = new Set(mapped.map((m) => m.url));
          const extraLocal = prev.filter((p) => !existingUrls.has(p.url));
          return [...mapped, ...extraLocal];
        });
      }
    } catch {
      // keep local assets if backend unreachable
    }
  }, []);

  const fetchPipelineEntities = useCallback(async () => {
    try {
      const [stratRes, calRes, projRes, presRes, wfRes] = await Promise.all([
        apiGet<{ strategies: SavedStrategy[] }>("/api/strategies").catch(() => ({ strategies: [] })),
        apiGet<{ entries: CalendarPost[] }>("/api/calendar-entries").catch(() => ({ entries: [] })),
        apiGet<{ projects: ContentProject[] }>("/api/projects").catch(() => ({ projects: [] })),
        apiGet<{ presenters: PresenterPreset[] }>("/api/presenters").catch(() => ({ presenters: [] })),
        apiGet<{ workflows: AutomationWorkflow[]; executions: AutomationExecutionLog[] }>("/api/workflows").catch(() => ({
          workflows: [],
          executions: [],
        })),
      ]);
      if (stratRes.strategies?.length) {
        setStrategies(stratRes.strategies);
        setStrategy((prev) => prev || stratRes.strategies[0]);
      }
      if (calRes.entries?.length) {
        setCalendarPosts((prev) => {
          const map = new Map(prev.map((c) => [c.id, c]));
          for (const e of calRes.entries) map.set(e.id, e);
          return Array.from(map.values());
        });
      }
      if (projRes.projects?.length) {
        setProjects((prev) => {
          const map = new Map(prev.map((p) => [p.id, p]));
          for (const p of projRes.projects) map.set(p.id, p);
          return Array.from(map.values());
        });
      }
      if (presRes.presenters) setPresenters(presRes.presenters);
      if (wfRes.workflows) setWorkflows(wfRes.workflows);
      if (wfRes.executions) setWorkflowExecutions(wfRes.executions);
    } catch {
      // non-fatal startup hydration
    }
  }, []);

  useEffect(() => {
    if (!workspace.id) return;
    setActiveWorkspaceHeaderId(workspace.id);
    void fetchMemories();
    void fetchServerMedia();
    void fetchPipelineEntities();
    if (workspace.onboarded) {
      apiGet<{
        snapshot: {
          lastPage?: Page;
          savedAt?: string;
          activeScriptTitle?: string;
          activeScriptText?: string;
          videoEditorState?: Partial<VideoEditorPreferences>;
        } | null;
      }>("/api/workspace-state")
        .then((res) => {
          const snap = res.snapshot;
          if (!snap) return;
          if (snap.activeScriptText && !activeScriptText) {
            setActiveScriptText(snap.activeScriptText);
            if (snap.activeScriptTitle) setActiveScriptTitle(snap.activeScriptTitle);
          }
          if (snap.videoEditorState) {
            setVideoEditorPrefs((prev) => ({ ...prev, ...snap.videoEditorState }));
          }
          if (snap.lastPage && snap.lastPage !== "Overview") {
            setActivePage((current) => (current === "Overview" ? (snap.lastPage as Page) : current));
            setResumeBanner({
              lastPage: snap.lastPage,
              savedAt: snap.savedAt || "",
              scriptTitle: snap.activeScriptTitle,
            });
          }
        })
        .catch(() => {
          // ignore offline
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  // Startup connection validation & model catalog fetch
  useEffect(() => {
    testConnection().then(setFirestoreOnline).catch(() => setFirestoreOnline(false));
    apiGet<{ geminiConfigured: boolean; catalog: ModelCatalog }>("/api/models")
      .then((res) => {
        if (res.catalog) setModelCatalog(res.catalog);
        setGeminiConfigured(res.geminiConfigured);
      })
      .catch(() => {
        // Keep defaults
      });
  }, []);

  const syncUserActiveWorkspace = useCallback(async (uid: string, workspaceId: string) => {
    if (!uid || !workspaceId) return;
    savedActiveWorkspaceIdRef.current = workspaceId;
    try {
      localStorage.setItem(`${USER_ACTIVE_WS_PREFIX}${uid}`, workspaceId);
    } catch {
      // ignore storage quota errors
    }
    try {
      const userRef = doc(db, "users", uid);
      await updateDoc(userRef, {
        activeWorkspaceId: clampStr(workspaceId, 128),
        updatedAt: serverTimestamp(),
      });
    } catch {
      // ignore offline/unverified error
    }
  }, []);

  const restoreWorkspaceSession = useCallback((ws: WorkspaceProfile) => {
    setActiveWorkspaceHeaderId(ws.id);
    setWorkspace(ws);
    if (ws.onboarded) {
      try {
        localStorage.setItem("mos-onboarded", "yes");
      } catch {
        // ignore
      }
    }
    setModels({
      textModel: ws.preferredTextModel || "gemini-4-hydrogen",
      imageModel: ws.preferredImageModel || "gemini-nano-banana-2.1",
      videoModel: ws.preferredVideoModel || "gemini-omni-1.2-flash",
      voiceModel: ws.preferredVoiceModel || "gemini-3.8-flash-lite-tts",
      musicModel: "lyria-3-clip-preview",
    });

    let restoredCache: Partial<WorkspaceDataCache> | null = null;
    try {
      const raw = localStorage.getItem(`${WS_CACHE_PREFIX}${ws.id}`);
      if (raw) restoredCache = JSON.parse(raw) as Partial<WorkspaceDataCache>;
    } catch {
      restoredCache = null;
    }

    setInsights(restoredCache?.insights || []);
    setCompetitors(restoredCache?.competitors || []);
    setInfluencers(restoredCache?.influencers || []);
    setTrends(restoredCache?.trends || []);
    setSeoIssues(restoredCache?.seoIssues || []);
    setSeoKeywords(restoredCache?.seoKeywords || []);
    setStrategy(restoredCache?.strategy || null);
    setProjects(restoredCache?.projects || []);
    setMediaAssets(restoredCache?.mediaAssets || []);
    setCalendarPosts(restoredCache?.calendarPosts || []);
    setAudienceEval(restoredCache?.audienceEval || null);
    setAdCampaigns(restoredCache?.adCampaigns || []);
    setAutomationRuns(restoredCache?.automationRuns || []);
    setActiveScriptTitle(restoredCache?.activeScriptTitle || "");
    setActiveScriptText(restoredCache?.activeScriptText || "");
    if (restoredCache?.activePage) setActivePage(restoredCache.activePage);
  }, []);

  // Firebase Auth listener & user profile sync (does NOT overwrite saved activeWorkspaceId)
  useEffect(() => {
    void consumeGoogleRedirectResult().catch(() => {
      // Non-fatal if no redirect sign-in is pending
    });
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      setAuthReady(true);

      if (user) {
        prevAuthUidRef.current = user.uid;
        const userRef = doc(db, "users", user.uid);
        const userPath = `users/${user.uid}`;
        try {
          const snap = await getDoc(userRef);
          const localPreferred = (() => {
            try {
              return localStorage.getItem(`${USER_ACTIVE_WS_PREFIX}${user.uid}`) || "";
            } catch {
              return "";
            }
          })();

          if (!snap.exists()) {
            const curWs = latestWorkspaceRef.current;
            const initialActiveId = curWs.onboarded && curWs.name ? curWs.id : localPreferred;
            savedActiveWorkspaceIdRef.current = initialActiveId;
            await setDoc(userRef, {
              uid: user.uid,
              email: clampStr(user.email || `${user.uid}@users.local`, 320),
              displayName: clampStr(user.displayName || "Marketing Founder", 120),
              photoURL: clampStr(user.photoURL || "", 1000),
              activeWorkspaceId: clampStr(initialActiveId, 128),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            const existingData = snap.data() as { activeWorkspaceId?: string };
            savedActiveWorkspaceIdRef.current = existingData.activeWorkspaceId || localPreferred || "";
            if (savedActiveWorkspaceIdRef.current) {
              try {
                localStorage.setItem(
                  `${USER_ACTIVE_WS_PREFIX}${user.uid}`,
                  savedActiveWorkspaceIdRef.current,
                );
              } catch {
                // ignore
              }
            }
            await updateDoc(userRef, {
              displayName: clampStr(user.displayName || "Marketing Founder", 120),
              photoURL: clampStr(user.photoURL || "", 1000),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          console.warn("User profile sync note:", userPath, err);
        }
      } else if (prevAuthUidRef.current) {
        // Explicit sign-out detected: isolate away from previous signed-in account's workspace
        prevAuthUidRef.current = null;
        autoProvisionedForUidRef.current = null;
        savedActiveWorkspaceIdRef.current = "";
        setSavedWorkspaces([]);
      }
    });
    return () => unsub();
  }, []);

  const persistWorkspaceToCloud = useCallback(
    async (ws: WorkspaceProfile, changedKeys?: string[], overrideUser?: User | null) => {
      const targetUser = overrideUser || authUser;
      if (!targetUser) return;
      const cleanId = ws.id.replace(/[^a-zA-Z0-9_-]/g, "") || safeId("ws");
      const wsPath = `workspaces/${cleanId}`;
      const wsRef = doc(db, "workspaces", cleanId);
      try {
        const snap = await getDoc(wsRef);
        if (!snap.exists()) {
          await setDoc(wsRef, {
            id: cleanId,
            ownerId: targetUser.uid,
            name: clampStr(ws.name || "Untitled Business", 140),
            websiteUrl: clampStr(ws.websiteUrl, 500),
            industry: clampStr(ws.industry, 140),
            companySize: clampStr(ws.companySize, 80),
            description: clampStr(ws.description, 4000),
            location: clampStr(ws.location, 200),
            targetCountries: clampStr(ws.targetCountries, 400),
            products: (ws.products || []).slice(0, 20),
            objectives: (ws.objectives || []).slice(0, 20),
            channels: (ws.channels || []).slice(0, 20),
            positioning: clampStr(ws.positioning, 2000),
            valueProposition: clampStr(ws.valueProposition, 2000),
            brandVoiceNotes: clampStr(ws.brandVoiceNotes, 3000),
            wordsToUse: clampStr(ws.wordsToUse, 500),
            wordsToAvoid: clampStr(ws.wordsToAvoid, 500),
            voiceSliders: (ws.voiceSliders || [50, 50, 50, 50]).slice(0, 10),
            preferredTextModel: clampStr(ws.preferredTextModel, 80),
            preferredImageModel: clampStr(ws.preferredImageModel, 80),
            preferredVideoModel: clampStr(ws.preferredVideoModel, 80),
            preferredVoiceModel: clampStr(ws.preferredVoiceModel, 80),
            credits: Math.max(0, Math.min(10000000, ws.credits)),
            plan: ws.plan || "pro",
            onboarded: Boolean(ws.onboarded),
            isDemo: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else if (
          changedKeys &&
          changedKeys.every((k) => k === "credits" || k === "plan")
        ) {
          await updateDoc(wsRef, {
            credits: Math.max(0, Math.min(10000000, ws.credits)),
            plan: ws.plan || "pro",
            updatedAt: serverTimestamp(),
          });
        } else if (
          changedKeys &&
          changedKeys.every((k) =>
            [
              "preferredTextModel",
              "preferredImageModel",
              "preferredVideoModel",
              "preferredVoiceModel",
            ].includes(k),
          )
        ) {
          await updateDoc(wsRef, {
            preferredTextModel: clampStr(ws.preferredTextModel, 80),
            preferredImageModel: clampStr(ws.preferredImageModel, 80),
            preferredVideoModel: clampStr(ws.preferredVideoModel, 80),
            preferredVoiceModel: clampStr(ws.preferredVoiceModel, 80),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(wsRef, {
            name: clampStr(ws.name || "Untitled Business", 140),
            websiteUrl: clampStr(ws.websiteUrl, 500),
            industry: clampStr(ws.industry, 140),
            companySize: clampStr(ws.companySize, 80),
            description: clampStr(ws.description, 4000),
            location: clampStr(ws.location, 200),
            targetCountries: clampStr(ws.targetCountries, 400),
            products: (ws.products || []).slice(0, 20),
            objectives: (ws.objectives || []).slice(0, 20),
            channels: (ws.channels || []).slice(0, 20),
            positioning: clampStr(ws.positioning, 2000),
            valueProposition: clampStr(ws.valueProposition, 2000),
            brandVoiceNotes: clampStr(ws.brandVoiceNotes, 3000),
            wordsToUse: clampStr(ws.wordsToUse, 500),
            wordsToAvoid: clampStr(ws.wordsToAvoid, 500),
            voiceSliders: (ws.voiceSliders || [50, 50, 50, 50]).slice(0, 10),
            onboarded: Boolean(ws.onboarded),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.warn("Workspace cloud sync note:", wsPath, err);
      }
    },
    [authUser],
  );

  // Listen to owned workspaces in Firestore & auto-bind user's persistent workspace on sign-in
  useEffect(() => {
    if (!authReady || !authUser) {
      setSavedWorkspaces([]);
      setWorkspacesResolved(!authUser && authReady);
      return;
    }
    setWorkspacesResolved(false);
    const q = query(collection(db, "workspaces"), where("ownerId", "==", authUser.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as WorkspaceProfile);
        setSavedWorkspaces(list);

        const finish = () => setWorkspacesResolved(true);
        if (userSwitchedWorkspaceRef.current) {
          userSwitchedWorkspaceRef.current = false;
          finish();
          return;
        }

        const curWs = latestWorkspaceRef.current;
        let localPref = "";
        try {
          localPref = localStorage.getItem(`${USER_ACTIVE_WS_PREFIX}${authUser.uid}`) || "";
        } catch {
          localPref = "";
        }
        const preferredId = savedActiveWorkspaceIdRef.current || localPref;
        const established = list.filter((w) => workspaceIsEstablished(w));
        const cloudTarget =
          (preferredId && established.find((w) => w.id === preferredId)) ||
          established[0] ||
          (preferredId && list.find((w) => w.id === preferredId)) ||
          null;
        const savedLocal = readAccountWorkspace(authUser.uid);
        const localTarget = workspaceIsEstablished(curWs)
          ? curWs
          : savedLocal && workspaceIsEstablished(savedLocal)
            ? savedLocal
            : null;

        const openEstablished = (ws: WorkspaceProfile) => {
          const base = createDefaultWorkspace(authUser.uid);
          const ready: WorkspaceProfile = {
            ...base,
            ...ws,
            id: ws.id || base.id,
            ownerId: authUser.uid,
            name: (ws.name || "").trim() || base.name,
            websiteUrl: ws.websiteUrl || "",
            description: ws.description || "",
            products: ws.products || [],
            objectives: ws.objectives || [],
            channels: ws.channels || [],
            onboarded: true,
            isDemo: false,
          };
          restoreWorkspaceSession(ready);
          void persistWorkspaceToCloud(ready, undefined, authUser).then(() =>
            syncUserActiveWorkspace(authUser.uid, ready.id),
          );
        };

        if (cloudTarget && workspaceIsEstablished(cloudTarget)) {
          const alreadyHere = curWs.id === cloudTarget.id && curWs.onboarded;
          if (!alreadyHere) openEstablished(cloudTarget);
          finish();
          return;
        }

        if (localTarget) {
          openEstablished(localTarget);
          finish();
          return;
        }

        void (async () => {
          let opened = false;
          try {
            const activeId = (savedActiveWorkspaceIdRef.current || localPref).replace(/[^a-zA-Z0-9_-]/g, "");
            if (activeId && !list.some((w) => w.id === activeId && workspaceIsEstablished(w))) {
              const direct = await getDoc(doc(db, "workspaces", activeId));
              if (direct.exists()) {
                const ws = { ...(direct.data() as WorkspaceProfile), id: direct.id };
                if (ws.ownerId === authUser.uid && workspaceIsEstablished(ws)) {
                  openEstablished(ws);
                  opened = true;
                  return;
                }
              }
            }

            const drafted = readDraftWorkspace(authUser.uid);
            if (drafted) {
              openEstablished(drafted);
              opened = true;
              return;
            }

            for (const ws of list) {
              const cleanId = (ws.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
              if (!cleanId) continue;
              const items = await getDocs(
                query(
                  collection(db, "workspaces", cleanId, "items"),
                  where("ownerId", "==", authUser.uid),
                  limit(8),
                ),
              );
              const hasSavedWork = items.docs.some((item) => {
                const kind = String(item.data().kind || "");
                return ["strategy", "project", "session", "calendar_post", "media_asset", "notebook"].includes(kind);
              });
              if (hasSavedWork) {
                openEstablished(ws);
                opened = true;
                return;
              }
            }
          } catch (err) {
            console.warn("Saved workspace lookup note:", err);
          } finally {
            if (!opened) {
              const remembered = readDraftWorkspace(authUser.uid) || readAccountWorkspace(authUser.uid);
              if (remembered && workspaceIsEstablished(remembered)) {
                openEstablished(remembered);
                opened = true;
              }
            }
            if (
              !opened &&
              list.length === 0 &&
              !workspaceIsEstablished(latestWorkspaceRef.current) &&
              isGoogleSignedInUser(authUser) &&
              autoProvisionedForUidRef.current !== authUser.uid
            ) {
              autoProvisionedForUidRef.current = authUser.uid;
              const emailPrefix = authUser.email?.split("@")[0] || "";
              const derivedName =
                curWs.name.trim() ||
                (authUser.displayName ? `${authUser.displayName}'s Workspace` : "") ||
                (emailPrefix ? `${emailPrefix} Workspace` : "My Marketing Workspace");
              const base = createDefaultWorkspace(authUser.uid);
              const autoWs: WorkspaceProfile = {
                ...base,
                ...curWs,
                id: curWs.id || base.id,
                ownerId: authUser.uid,
                name: derivedName,
                onboarded: false,
                isDemo: false,
                credits: 10000,
              };
              restoreWorkspaceSession(autoWs);
              void persistWorkspaceToCloud(autoWs, undefined, authUser).then(() =>
                syncUserActiveWorkspace(authUser.uid, autoWs.id),
              );
            }
            finish();
          }
        })();
      },
      (error) => {
        const saved = readAccountWorkspace(authUser.uid) || readDraftWorkspace(authUser.uid);
        if (saved && workspaceIsEstablished(saved)) {
          restoreWorkspaceSession({
            ...saved,
            ownerId: authUser.uid,
            onboarded: true,
            isDemo: false,
          });
        }
        setWorkspacesResolved(true);
        console.error("Workspace list failed", error);
      },
    );
    return () => unsub();
  }, [authReady, authUser, persistWorkspaceToCloud, restoreWorkspaceSession, syncUserActiveWorkspace]);

  // Listen to workspace items in Firestore when active workspace exists in cloud
  useEffect(() => {
    if (!authReady || !authUser || !workspace.id) return;
    const isInCloud = savedWorkspaces.some((w) => w.id === workspace.id);
    if (!isInCloud) return;

    const cleanId = workspace.id.replace(/[^a-zA-Z0-9_-]/g, "");
    const q = query(
      collection(db, "workspaces", cleanId, "items"),
      where("ownerId", "==", authUser.uid),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) return;
        const docs = snap.docs.map((d) => d.data() as Record<string, unknown>);
        const strats = docs.filter((d) => d.kind === "strategy" && d.payload);
        if (strats.length > 0) {
          const latest = strats[strats.length - 1];
          setStrategy(latest.payload as StrategyPlan);
        }
        const projs = docs
          .filter((d) => d.kind === "project" && d.payload && (d.payload as ContentProject).title)
          .map((d) => d.payload as ContentProject);
        if (projs.length > 0) setProjects(projs);

        const cals = docs
          .filter((d) => d.kind === "calendar_post" && d.payload && (d.payload as CalendarPost).title)
          .map((d) => d.payload as CalendarPost);
        if (cals.length > 0) setCalendarPosts(cals);

        const ads = docs
          .filter((d) => d.kind === "ad_campaign" && d.payload && (d.payload as AdCampaignItem).name)
          .map((d) => d.payload as AdCampaignItem);
        if (ads.length > 0) setAdCampaigns(ads);

        const mediaDocs = docs.filter(
          (d) => d.kind === "media_asset" && d.payload && (d.payload as MediaAsset).url,
        );
        if (mediaDocs.length > 0) {
          setMediaAssets((prev) => {
            const map = new Map(prev.map((m) => [m.id, m]));
            for (const d of mediaDocs) {
              const item = d.payload as MediaAsset;
              map.set(item.id, { ...map.get(item.id), ...item });
            }
            return Array.from(map.values());
          });
        }

        const session = docs.find((d) => d.kind === "session" && d.payload);
        const sessionPage = (session?.payload as { lastPage?: Page } | undefined)?.lastPage;
        if (sessionPage && sessionRestoredFor.current !== cleanId) {
          sessionRestoredFor.current = cleanId;
          setActivePage((current) => (current === "Overview" ? sessionPage : current));
          setResumeBanner({ lastPage: sessionPage, savedAt: "", scriptTitle: "" });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `workspaces/${cleanId}/items`);
      },
    );
    return () => unsub();
  }, [authReady, authUser, workspace.id, savedWorkspaces]);

  const persistWorkspaceItem = useCallback(
    async (params: {
      id?: string;
      kind: string;
      title: string;
      status: string;
      sourceType?: SourceType;
      provider?: string;
      payload?: Record<string, unknown>;
      score?: number;
      creditsUsed?: number;
    }) => {
      if (!authUser) return;
      const wsId = workspace.id.replace(/[^a-zA-Z0-9_-]/g, "");
      const itemId = (params.id || safeId(params.kind)).replace(/[^a-zA-Z0-9_-]/g, "");
      const path = `workspaces/${wsId}/items/${itemId}`;
      const itemRef = doc(db, "workspaces", wsId, "items", itemId);
      try {
        await persistWorkspaceToCloud(workspace);
        const existingItem = await getDoc(itemRef);
        if (!existingItem.exists()) {
          await setDoc(itemRef, {
            id: itemId,
            workspaceId: wsId,
            ownerId: authUser.uid,
            kind: clampStr(params.kind, 64),
            title: clampStr(params.title || "Item", 240),
            status: clampStr(params.status || "active", 64),
            sourceType: params.sourceType || "manual",
            provider: clampStr(params.provider || "Marketing OS", 100),
            payload: params.payload || {},
            creditsUsed: Math.max(0, params.creditsUsed || 0),
            ...(typeof params.score === "number"
              ? { score: Math.max(0, Math.min(100, params.score)) }
              : {}),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(itemRef, {
            title: clampStr(params.title || "Item", 240),
            status: clampStr(params.status || "active", 64),
            sourceType: params.sourceType || "manual",
            provider: clampStr(params.provider || "Marketing OS", 100),
            payload: params.payload || {},
            creditsUsed: Math.max(0, params.creditsUsed || 0),
            ...(typeof params.score === "number"
              ? { score: Math.max(0, Math.min(100, params.score)) }
              : {}),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.warn("Workspace item sync note:", path, err);
      }
    },
    [authUser, persistWorkspaceToCloud, workspace],
  );

  useEffect(() => {
    if (!authUser || !workspace.onboarded || !workspace.id) return;
    const signature = JSON.stringify({
      page: activePage,
      script: activeScriptTitle,
      cal: calendarPosts.slice(0, 40).map((p) => `${p.id}:${p.status}:${p.title}`),
      proj: projects.slice(0, 40).map((p) => `${p.id}:${p.stage}:${p.title}`),
      media: mediaAssets.slice(0, 40).map((m) => `${m.id}:${m.url}`),
    });
    if (signature === cloudMirrorSignature.current) return;
    const timer = window.setTimeout(() => {
      cloudMirrorSignature.current = signature;
      void persistWorkspaceItem({
        id: "session-state",
        kind: "session",
        title: activePage || "Overview",
        status: "active",
        payload: {
          lastPage: activePage,
          activeScriptTitle,
          activeScriptText: activeScriptText.slice(0, 8000),
        },
      });
      for (const post of calendarPosts.slice(0, 40)) {
        void persistWorkspaceItem({
          id: post.id,
          kind: "calendar_post",
          title: post.title || "Post",
          status: post.status || "draft",
          sourceType: post.sourceType,
          payload: post as unknown as Record<string, unknown>,
        });
      }
      for (const proj of projects.slice(0, 40)) {
        void persistWorkspaceItem({
          id: proj.id,
          kind: "project",
          title: proj.title || "Project",
          status: proj.stage || proj.status || "active",
          sourceType: proj.sourceType,
          payload: proj as unknown as Record<string, unknown>,
        });
      }
      for (const asset of mediaAssets.slice(0, 40)) {
        if (!asset.url) continue;
        void persistWorkspaceItem({
          id: asset.id,
          kind: "media_asset",
          title: asset.name || "Asset",
          status: "stored",
          sourceType: asset.sourceType,
          payload: asset as unknown as Record<string, unknown>,
        });
      }
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [
    activePage,
    activeScriptText,
    activeScriptTitle,
    authUser,
    calendarPosts,
    mediaAssets,
    persistWorkspaceItem,
    projects,
    workspace.id,
    workspace.onboarded,
  ]);

  const updateWorkspace = useCallback(
    (patch: Partial<WorkspaceProfile>) => {
      const keys = Object.keys(patch);
      setWorkspace((prev) => {
        const next = { ...prev, ...patch };
        if (authUser) {
          void persistWorkspaceToCloud(next, keys);
        }
        return next;
      });
    },
    [authUser, persistWorkspaceToCloud],
  );

  const updateModels = useCallback(
    async (patch: Partial<ModelPreferences>) => {
      const next: ModelPreferences = { ...models, ...patch };
      const updatedWs: WorkspaceProfile = {
        ...workspace,
        preferredTextModel: next.textModel,
        preferredImageModel: next.imageModel,
        preferredVideoModel: next.videoModel,
        preferredVoiceModel: next.voiceModel,
      };
      setModels(next);
      setWorkspace(updatedWs);
      if (authUser) {
        await persistWorkspaceToCloud(updatedWs, ["preferredTextModel"]);
      }
    },
    [authUser, models, persistWorkspaceToCloud, workspace],
  );

  const consumeCredits = useCallback((amount: number, label: string) => {
    // Personal workspace telemetry only — never lock or deduct user credits
    setCreditTransactions((prev) => [
      {
        id: safeId("tx"),
        label,
        amount,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
      ...prev.slice(0, 50),
    ]);
  }, []);

  const addCredits = useCallback((_amount: number, _label: string) => {
    // No-op: personal workspaces operate without credit locks
  }, []);

  const saveStrategyRecord = useCallback(
    async (s: StrategyPlan, status: "draft" | "active" | "archived" = "active") => {
      setStrategy(s);
      const res = await apiPost<{ strategy: SavedStrategy }>("/api/strategies", {
        ...s,
        status,
      });
      if (res.strategy) {
        setStrategy(res.strategy);
        setStrategies((prev) => {
          const rest = prev.filter((x) => x.id !== res.strategy.id);
          return [res.strategy, ...rest];
        });
      }
      return res.strategy;
    },
    [],
  );

  const deleteStrategyRecord = useCallback(async (id: string) => {
    await apiDelete(`/api/strategies/${id}`);
    setStrategies((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const generateCalendarFromStrategy = useCallback(async (strategyId: string, count = 6) => {
    const res = await apiPost<{ entries: CalendarPost[] }>(`/api/strategies/${strategyId}/generate-calendar`, {
      business: workspace,
      count,
      model: models.textModel,
    });
    if (res.entries?.length) {
      setCalendarPosts((prev) => {
        const ids = new Set(res.entries.map((e) => e.id));
        return [...res.entries, ...prev.filter((p) => !ids.has(p.id))];
      });
    }
    return res.entries || [];
  }, [workspace, models.textModel]);

  const upsertCalendarEntry = useCallback(async (post: CalendarPost) => {
    setCalendarPosts((prev) => {
      const rest = prev.filter((p) => p.id !== post.id);
      return [post, ...rest];
    });
    const res = await apiPost<{ entry: CalendarPost }>("/api/calendar-entries", post as unknown as Record<string, unknown>);
    if (res.entry) {
      setCalendarPosts((prev) => prev.map((p) => (p.id === post.id || p.id === res.entry.id ? res.entry : p)));
    }
    return res.entry || post;
  }, []);

  const createProjectFromCalendarEntry = useCallback(async (calendarEntryId: string) => {
    const res = await apiPost<{ project: ContentProject; entry: CalendarPost }>(
      `/api/calendar-entries/${calendarEntryId}/create-project`,
      {},
    );
    if (res.project) {
      setProjects((prev) => [res.project, ...prev.filter((p) => p.id !== res.project.id)]);
    }
    if (res.entry) {
      setCalendarPosts((prev) => prev.map((c) => (c.id === res.entry.id ? res.entry : c)));
    }
    return res.project;
  }, []);

  const upsertContentProject = useCallback(async (proj: Partial<ContentProject> & { title: string }) => {
    const res = await apiPost<{ project: ContentProject }>("/api/projects", proj as Record<string, unknown>);
    if (res.project) {
      setProjects((prev) => [res.project, ...prev.filter((p) => p.id !== res.project.id)]);
      return res.project;
    }
    throw new Error("Failed to save content project");
  }, []);

  const patchContentProject = useCallback(async (id: string, patch: Partial<ContentProject>) => {
    const res = await apiPatch<{ project: ContentProject }>(`/api/projects/${id}`, patch as Record<string, unknown>);
    if (res.project) {
      setProjects((prev) => prev.map((p) => (p.id === id ? res.project : p)));
      return res.project;
    }
    throw new Error("Failed to update content project");
  }, []);

  const addNotebookVersion = useCallback((summary: string, sourceType: SourceType) => {
    setNotebookVersions((prev) => [
      {
        id: safeId("ver"),
        timestamp: new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        summary,
        sourceType,
      },
      ...prev.slice(0, 14),
    ]);
  }, []);

  const saveMemory = useCallback(
    async (payload: {
      scope: AiMemoryItem["scope"];
      source: AiMemoryItem["source"];
      approved?: boolean;
      title: string;
      content: string;
      tags?: string[];
    }) => {
      const res = await apiPost<{ memory: AiMemoryItem }>("/api/memory", payload);
      if (res.memory) {
        setMemories((prev) => [res.memory, ...prev]);
      }
      return res.memory;
    },
    [],
  );

  const updateMemoryItem = useCallback(
    async (id: string, patch: Partial<AiMemoryItem>) => {
      const res = await apiPatch<{ memory: AiMemoryItem }>(`/api/memory/${id}`, patch as Record<string, unknown>);
      if (res.memory) {
        setMemories((prev) => prev.map((m) => (m.id === id ? res.memory : m)));
      }
      return res.memory;
    },
    [],
  );

  const deleteMemoryItem = useCallback(async (id: string) => {
    await apiDelete(`/api/memory/${id}`);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const createNewWorkspace = useCallback(
    (newWs: Partial<WorkspaceProfile>) => {
      userSwitchedWorkspaceRef.current = true;
      const base = createDefaultWorkspace(authUser?.uid || "");
      const profile: WorkspaceProfile = {
        ...base,
        ...newWs,
        id: base.id,
        ownerId: authUser?.uid || "",
        isDemo: false,
        onboarded: true,
        credits: 10000,
      };
      restoreWorkspaceSession(profile);
      if (authUser) {
        void persistWorkspaceToCloud(profile).then(() =>
          syncUserActiveWorkspace(authUser.uid, profile.id),
        );
      }
    },
    [authUser, persistWorkspaceToCloud, restoreWorkspaceSession, syncUserActiveWorkspace],
  );

  const switchWorkspace = useCallback(
    (ws: WorkspaceProfile) => {
      userSwitchedWorkspaceRef.current = true;
      restoreWorkspaceSession(ws);
      if (authUser) {
        void syncUserActiveWorkspace(authUser.uid, ws.id);
      }
    },
    [authUser, restoreWorkspaceSession, syncUserActiveWorkspace],
  );

  const signOutAccount = useCallback(async () => {
    const uid = authUser?.uid || "";
    const current = latestWorkspaceRef.current;
    if (uid && workspaceIsEstablished(current)) {
      try {
        localStorage.setItem(
          `${ACCOUNT_WS_PREFIX}${uid}`,
          JSON.stringify({ ...current, ownerId: uid, onboarded: true }),
        );
      } catch {
        // Ignore storage quota errors
      }
    }
    await signOutGoogle();
    setActiveWorkspaceHeaderId("default");
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    localStorage.removeItem("mos-onboarded");
    localStorage.removeItem("mos-active-bi-job-id");
    localStorage.removeItem("mos-approved");
    savedActiveWorkspaceIdRef.current = "";
    autoProvisionedForUidRef.current = null;
    prevAuthUidRef.current = null;
    setWorkspace(createDefaultWorkspace());
    setActivePage("Overview");
    setSaveStatus("idle");
    setLastSavedAt("");
    setResumeBanner(null);
    setActiveScriptTitle("");
    setActiveScriptText("");
    setCreditTransactions([]);
    setNotebookVersions([]);
    setSavedWorkspaces([]);
    setInsights([]);
    setCompetitors([]);
    setInfluencers([]);
    setTrends([]);
    setSeoIssues([]);
    setSeoKeywords([]);
    setStrategy(null);
    setStrategies([]);
    setProjects([]);
    setMediaAssets([]);
    setCalendarPosts([]);
    setMemories([]);
    setAudienceEval(null);
    setAdCampaigns([]);
    setAutomationRuns([]);
    setPresenters([]);
    setWorkflows([]);
    setWorkflowExecutions([]);
  }, [authUser]);

  const deleteAccountFully = useCallback(async () => {
    if (!authUser) throw new Error("No authenticated user to delete.");
    await apiPost("/api/auth/account-cleanup", {});
    try {
      const wsQ = query(collection(db, "workspaces"), where("ownerId", "==", authUser.uid));
      const snap = await getDocs(wsQ);
      for (const d of snap.docs) {
        await deleteDoc(doc(db, "workspaces", d.id));
      }
      await deleteDoc(doc(db, "users", authUser.uid));
    } catch {
      // Proceed to delete Firebase Auth user cleanly even if Firestore offline
    }
    await deleteCurrentUserAccount();
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    localStorage.removeItem("mos-onboarded");
    localStorage.removeItem("mos-onboarding-draft-v1");
    localStorage.removeItem(`${ACCOUNT_WS_PREFIX}${authUser.uid}`);
    setWorkspace(createDefaultWorkspace());
    setSavedWorkspaces([]);
    setMemories([]);
    setMediaAssets([]);
  }, [authUser]);

  return {
    authUser,
    authReady,
    workspacesResolved,
    firestoreOnline,
    modelCatalog,
    geminiConfigured,
    savedWorkspaces,
    workspace,
    activePage,
    setActivePage,
    activeScriptTitle,
    setActiveScriptTitle,
    activeScriptText,
    setActiveScriptText,
    videoEditorPrefs,
    setVideoEditorPrefs,
    saveStatus,
    lastSavedAt,
    retrySaveNow: flushWorkspaceSnapshotNow,
    resumeBanner,
    dismissResumeBanner: () => setResumeBanner(null),
    memories,
    fetchMemories,
    saveMemory,
    updateMemoryItem,
    deleteMemoryItem,
    fetchServerMedia,
    signOutAccount,
    deleteAccountFully,
    updateWorkspace,
    createNewWorkspace,
    switchWorkspace,
    persistWorkspaceToCloud,
    persistWorkspaceItem,
    insights,
    setInsights,
    notebookVersions,
    addNotebookVersion,
    competitors,
    setCompetitors,
    influencers,
    setInfluencers,
    trends,
    setTrends,
    seoIssues,
    setSeoIssues,
    seoKeywords,
    setSeoKeywords,
    strategy,
    setStrategy,
    strategies,
    setStrategies,
    saveStrategyRecord,
    deleteStrategyRecord,
    generateCalendarFromStrategy,
    projects,
    setProjects,
    upsertContentProject,
    patchContentProject,
    presenters,
    setPresenters,
    workflows,
    setWorkflows,
    workflowExecutions,
    setWorkflowExecutions,
    fetchPipelineEntities,
    mediaAssets,
    setMediaAssets,
    calendarPosts,
    setCalendarPosts,
    upsertCalendarEntry,
    createProjectFromCalendarEntry,
    audienceEval,
    setAudienceEval,
    adCampaigns,
    setAdCampaigns,
    automationRuns,
    setAutomationRuns,
    creditTransactions,
    consumeCredits,
    addCredits,
    models,
    updateModels,
  };
}
