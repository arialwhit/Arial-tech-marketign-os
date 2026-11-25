import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { AuthModal } from "./components/AuthModal";
import { GoogleWorkspaceModal } from "./components/GoogleWorkspaceModal";
import { LiveVoiceModal } from "./components/LiveVoiceModal";
import { ModelSelector } from "./components/ModelSelector";
import { useMarketingOS } from "./hooks/useMarketingOS";
import { apiGet, apiPost, uploadMediaFile } from "./lib/api";
import { reloadCurrentUser, sendVerificationEmail } from "./lib/firebase";
import type {
  BackgroundJob,
  CompetitorItem,
  ContentProject,
  MediaAsset,
  ModelOption,
  Page,
  SeoKeywordItem,
  TrendFormatItem,
} from "./types/marketing";
import {
  AudienceLabView,
  AvatarsView,
  ContentStudioView,
  PipelineView,
  VoiceStudioView,
} from "./views/CreativeViews";
import {
  AdsManagerView,
  AnalyticsView,
  AutomationsView,
  CalendarView,
  IntegrationsView,
  PublishingQueueView,
  SettingsView,
  SocialAccountsView,
} from "./views/GrowthAndOpsViews";
import {
  CommandCenterView,
  CompetitorsView,
  InfluencersView,
  MarketingStrategyView,
  NotebookView,
  OverviewView,
  SeoView,
  TrendsView,
} from "./views/IntelligenceViews";
import { GrowthIntelligenceView } from "./views/GrowthIntelligenceView";
import { MediaLibraryView } from "./views/MediaLibraryView";
import { VideoEditorView } from "./views/VideoEditorView";

const nav: { group: string; items: Page[] }[] = [
  { group: "Workspace", items: ["Overview", "AI Command Center", "Business Notebook"] },
  {
    group: "Intelligence",
    items: [
      "Marketing Strategy",
      "Market Research",
      "Competitors",
      "Influencer Discovery",
      "Trending Content",
      "SEO & ASO",
    ],
  },
  {
    group: "Create",
    items: [
      "Content Studio",
      "AI Avatar Studio",
      "Voice Studio",
      "Video Editor",
      "Media Library",
      "Content Pipeline",
      "Audience Simulation",
    ],
  },
  { group: "Distribute", items: ["Content Calendar", "Social Accounts", "Publishing Queue"] },
  { group: "Grow", items: ["Ads Manager", "Analytics", "Growth Intelligence"] },
  {
    group: "System",
    items: ["Integrations", "Automation Workflows", "Team & Members", "Settings"],
  },
];

const PAGE_PATH_MAP: Record<Page, string> = {
  Overview: "/dashboard",
  "AI Command Center": "/command-center",
  "Business Notebook": "/business-notebook",
  "Marketing Strategy": "/strategy",
  "Market Research": "/research",
  Competitors: "/competitors",
  "Influencer Discovery": "/influencers",
  "Trending Content": "/trends",
  "SEO & ASO": "/seo",
  "Content Studio": "/content-studio",
  "AI Avatar Studio": "/avatar-studio",
  "Voice Studio": "/voice-studio",
  "Video Editor": "/video-editor",
  "Media Library": "/media-library",
  "Content Pipeline": "/pipeline",
  "Audience Simulation": "/audience-simulation",
  "Content Calendar": "/calendar",
  "Social Accounts": "/social-accounts",
  "Publishing Queue": "/publishing-queue",
  "Ads Manager": "/ads-manager",
  Analytics: "/analytics",
  "Growth Intelligence": "/growth-intelligence",
  Integrations: "/integrations",
  "Automation Workflows": "/automation",
  "Team & Members": "/team",
  Settings: "/settings",
};

function resolvePageFromPath(pathname: string): Page | null {
  const clean = (pathname || "/").replace(/\/+$/, "") || "/";
  if (clean === "/" || clean === "/dashboard") return "Overview";
  for (const [pageName, routePath] of Object.entries(PAGE_PATH_MAP)) {
    if (routePath === clean) return pageName as Page;
  }
  return null;
}

function getPathForPage(p: Page): string {
  return PAGE_PATH_MAP[p] || "/dashboard";
}

const icons: Record<string, string> = {
  Overview: "M3 12h8V3H3v9Zm10 9h8v-7h-8v7Zm0-18v9h8V3h-8ZM3 21h8v-7H3v7Z",
  "AI Command Center":
    "M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5L12 2Zm7 13 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z",
  "Business Notebook": "M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V3Zm4 0v18M12 8h4M12 12h4",
  "Marketing Strategy": "M3 17l6-6 4 4 8-8M14 7h7v7",
  "Market Research": "M4 19V9m6 10V5m6 14v-7m5 7H2",
  Competitors: "M4 20v-9l4-3 4 3v9M2 20h20M14 20V5l4-2 4 2v15M7 13h2m-2 3h2m8-8h2m-2 4h2",
  "Influencer Discovery":
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10-3v6m3-3h-6",
  "Trending Content":
    "M13 2s1 4-2 7c-2 2-2 5 1 7 0-3 2-4 4-5 2 2 3 4 2 7-1 3-4 4-7 4-5 0-9-4-9-9 0-4 2-7 6-10 0 3 1 5 5 6",
  "SEO & ASO": "M11 19a8 8 0 1 1 5.7-2.3L22 22m-11-7v-4m0-4h.01",
  "Content Studio": "M4 20h16M6 16 17 5l2 2L8 18H6v-2Zm9-9 2 2",
  "AI Avatar Studio": "M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM3 21a9 9 0 0 1 18 0M18 8h4m-2-2v4",
  "Voice Studio":
    "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm-7 9v1a7 7 0 0 0 14 0v-1m-7 8v3m-4 0h8",
  "Video Editor": "M3 5h18v14H3V5Zm6 4 6 3-6 3V9Z",
  "Media Library":
    "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm12 6-5-5-4 4-3-3-4 4",
  "Content Pipeline": "M5 6h14M5 12h9m-9 6h14M3 6h.01M3 12h.01M3 18h.01",
  "Audience Simulation":
    "M7 20a5 5 0 0 1 10 0M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6-9 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z",
  "Content Calendar": "M4 5h16v16H4V5Zm0 5h16M8 3v4m8-4v4",
  "Social Accounts":
    "M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 8a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM8 12l4 3m0-6 4-3",
  "Publishing Queue": "M5 4h14v4H5V4Zm0 6h14v4H5v-4Zm0 6h9v4H5v-4Zm12 1 2 2 3-4",
  "Ads Manager": "M3 11v2l13 5V6L3 11Zm13-1 4-2v8l-4-2M6 14v6h4v-4",
  Analytics: "M4 19V9m5 10V5m5 14v-7m5 7V3",
  "Growth Intelligence": "M3 20 9 14l4 3 8-10m-5 0h5v5",
  Integrations: "M8 12h8M12 8v8M7 3v4H3m14-4v4h4M7 21v-4H3m14 4v-4h4",
  "Automation Workflows":
    "M5 5h6v6H5V5Zm8 8h6v6h-6v-6Zm-2-5h4a2 2 0 0 1 2 2v3M8 11v4a2 2 0 0 0 2 2h3",
  "Team & Members":
    "M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10.5 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  Settings:
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5 2-1-2-3-2 .5-1.5-1L16 5l-3-2-1 2h-2L9 3 6 5l.5 2.5-1.5 1L3 8l-2 3 2 1v2l-2 1 2 3 2-.5 1.5 1L6 21l3 2 1-2h2l1 2 3-2-.5-2.5 1.5-1 2 .5 2-3-2-1v-2Z",
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const path = icons[name] || "M12 2v20M2 12h20";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={path.includes("M3 12h8") ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

function Toast({ text }: { text: string }) {
  return (
    <div className="toast">
      <span className="check">✓</span>
      <div>
        <b>Action updated</b>
        <span>{text}</span>
      </div>
    </div>
  );
}

function ChoiceStep({
  eyebrow,
  title,
  text,
  options,
  selected,
  toggle,
}: {
  eyebrow: string;
  title: string;
  text: string;
  options: string[];
  selected: string[];
  toggle: (v: string) => void;
}) {
  return (
    <div className="form-panel">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{text}</p>
      <div className="choice-grid">
        {options.map((o, i) => (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            className={selected.includes(o) ? "selected" : ""}
          >
            <span className="choice-icon">
              <Icon
                name={
                  [
                    "Overview",
                    "Content Studio",
                    "AI Command Center",
                    "Analytics",
                    "SEO & ASO",
                    "Growth Intelligence",
                  ][i % 6]
                }
              />
            </span>
            <b>{o}</b>
            <i>{selected.includes(o) ? "✓" : "+"}</i>
          </button>
        ))}
      </div>
    </div>
  );
}

interface AnalyzeWebsiteResponse {
  crawled?: {
    url?: string;
    title?: string;
    metaDescription?: string;
    h1s?: string[];
    h2s?: string[];
    wordCount?: number;
    internalLinks?: number;
  } | null;
  intelligence?: {
    businessSummary?: string;
    industry?: string;
    positioning?: string;
    valueProposition?: string;
    brandVoiceNotes?: string;
    wordsToUse?: string;
    wordsToAvoid?: string;
    targetAudienceSummary?: string;
    customerNeed?: string;
    keyDifferentiator?: string;
    proofDirection?: string;
    pagesMappedSummary?: string;
    keywordOpportunities?: string[];
    competitorNames?: string[];
    contentFormats?: string[];
  };
  tracking?: {
    sdks?: Array<{ label: string; detected: boolean; evidence: string }>;
  } | null;
  integrationRecommendations?: Array<{
    provider: string;
    providerLabel: string;
    priority: string;
    whyRecommended: string;
    sdkDetected: boolean;
  }>;
  sourceType?: "ai_grounded" | "live_crawl";
}

const ACTIVE_BI_JOB_KEY = "mos-active-bi-job-id";

function readOnboardingDraft(): {
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
  step?: number;
} {
  try {
    const raw = localStorage.getItem("mos-onboarding-draft-v1");
    return raw ? (JSON.parse(raw) as ReturnType<typeof readOnboardingDraft>) : {};
  } catch {
    return {};
  }
}

function OnboardingFlow({
  authUser,
  onOpenAuth,
  onSignOut,
  textModel,
  textModels,
  onSelectModel,
  canCancel,
  onCancel,
  onSkipToEmpty,
  onUploadBrandFile,
  onFinish,
}: {
  authUser: User | null;
  onOpenAuth: (mode: "signup" | "signin") => void;
  onSignOut?: () => Promise<void>;
  textModel: string;
  textModels: ModelOption[];
  onSelectModel: (id: string) => void;
  canCancel: boolean;
  onCancel: () => void;
  onSkipToEmpty: () => void;
  onUploadBrandFile: (file: File) => Promise<void>;
  onFinish: (payload: {
    name: string;
    websiteUrl: string;
    industry: string;
    companySize: string;
    description: string;
    location: string;
    targetCountries: string;
    products: string[];
    objectives: string[];
    channels: string[];
    analysisResult: AnalyzeWebsiteResponse | null;
  }) => void;
}) {
  const [resumedJobId] = useState(() => localStorage.getItem(ACTIVE_BI_JOB_KEY) || "");
  const [draft] = useState(readOnboardingDraft);
  const [step, setStep] = useState(() => {
    if (resumedJobId && !canCancel) return authUser ? 7 : 6;
    if (canCancel) return 1;
    const saved = draft.step;
    return typeof saved === "number" && saved >= 0 && saved <= 6 ? saved : 0;
  });
  const [activeJobId, setActiveJobId] = useState(resumedJobId);
  const [jobStageLabel, setJobStageLabel] = useState("");
  const [analyzing, setAnalyzing] = useState(0);
  const [analysisDone, setAnalysisDone] = useState(false);
  const [analysisOutcome, setAnalysisOutcome] = useState<
    "idle" | "running" | "completed" | "partial" | "failed" | "cancelled"
  >("idle");
  const [analysisError, setAnalysisError] = useState("");
  const [analysisResult, setAnalysisResult] = useState<AnalyzeWebsiteResponse | null>(null);
  const [jobTriggerTick, setJobTriggerTick] = useState(0);

  const [name, setName] = useState(draft.name || "");
  const [url, setUrl] = useState(draft.url || "");
  const [industry, setIndustry] = useState(draft.industry || "SaaS & Developer Tools");
  const [companySize, setCompanySize] = useState(draft.companySize || "2–10 people");
  const [description, setDescription] = useState(draft.description || "");
  const [location, setLocation] = useState(draft.location || "");
  const [targetCountries, setTargetCountries] = useState(draft.targetCountries || "");

  const products = [
    "Website",
    "Web application",
    "Android application",
    "iOS application",
    "Physical products",
    "Services",
  ];
  const objectives = [
    "Increase website traffic",
    "Improve SEO",
    "Improve ASO",
    "Increase app downloads",
    "Grow social media",
    "Generate leads",
    "Create video content",
    "Build brand awareness",
  ];
  const channels = ["Instagram", "TikTok", "Facebook", "YouTube", "LinkedIn", "X"];
  const analysisStages = [
    "Analyzing website",
    "Understanding business",
    "Discovering competitors",
    "Researching keywords",
    "Analyzing social presence",
    "Discovering content opportunities",
    "Building business intelligence",
  ];

  const [selectedProducts, setSelectedProducts] = useState<string[]>(draft.selectedProducts || []);
  const [selectedObjectives, setSelectedObjectives] = useState<string[]>(draft.selectedObjectives || []);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(draft.selectedChannels || []);
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; size: string }[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const steps = [
    "Welcome",
    "Business",
    "Products",
    "Objectives",
    "Channels",
    "Brand assets",
    "Account",
    "Analysis",
  ];

  const toggle = (v: string, list: string[], setList: (next: string[]) => void) =>
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  useEffect(() => {
    if (canCancel) return;
    try {
      localStorage.setItem(
        "mos-onboarding-draft-v1",
        JSON.stringify({
          name,
          url,
          industry,
          companySize,
          description,
          location,
          targetCountries,
          selectedProducts,
          selectedObjectives,
          selectedChannels,
          step: Math.min(step, 6),
        }),
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [
    canCancel,
    name,
    url,
    industry,
    companySize,
    description,
    location,
    targetCountries,
    selectedProducts,
    selectedObjectives,
    selectedChannels,
    step,
  ]);

  const businessReady =
    name.trim().length > 1 &&
    url.trim().length > 3 &&
    description.trim().length >= 20 &&
    location.trim().length > 1 &&
    targetCountries.trim().length > 1;
  const stepReady =
    step === 1
      ? businessReady
      : step === 2
        ? selectedProducts.length > 0
        : step === 3
          ? selectedObjectives.length > 0
          : step === 4
            ? selectedChannels.length > 0
            : step === 6
              ? Boolean(authUser)
              : true;

  const biRunIdRef = useRef(0);

  // Durable async background job + polling for the analysis step (also supports Vercel inline completion)
  useEffect(() => {
    if (step !== 7 || !authUser) return;
    const runId = ++biRunIdRef.current;
    const controller = new AbortController();
    let unmounted = false;
    let pollTimer: number | null = null;
    let pollErrors = 0;

    const isStale = () => unmounted || runId !== biRunIdRef.current || controller.signal.aborted;

    setAnalysisError("");
    setAnalysisDone(false);
    setAnalysisOutcome("running");

    const applyJobSnapshot = (job: BackgroundJob): boolean => {
      if (isStale()) return true;
      setJobStageLabel(job.stage || "");
      const stageFromPct = Math.min(6, Math.max(0, Math.floor((job.progressPct || 10) / 15)));

      if (job.status === "completed") {
        setAnalysisError("");
        setAnalysisResult((job.result as AnalyzeWebsiteResponse) || null);
        setAnalyzing(7);
        setAnalysisOutcome("completed");
        setAnalysisDone(true);
        localStorage.removeItem(ACTIVE_BI_JOB_KEY);
        return true;
      }
      if (job.status === "partially_completed") {
        setAnalysisResult((job.result as AnalyzeWebsiteResponse) || null);
        setAnalysisError(
          job.error ||
            "Partial intelligence gathered from website crawl. You can retry full synthesis or continue into your workspace.",
        );
        setAnalyzing(Math.max(2, stageFromPct));
        setAnalysisOutcome("partial");
        setAnalysisDone(true);
        localStorage.removeItem(ACTIVE_BI_JOB_KEY);
        return true;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        const stoppedAt = Math.min(6, Math.max(0, stageFromPct));
        setAnalyzing(stoppedAt);
        setAnalysisError(
          job.error ||
            (job.status === "cancelled"
              ? "Analysis cancelled."
              : "Website intelligence scan hit an error. Retry or enter workspace manually."),
        );
        setAnalysisOutcome(job.status === "cancelled" ? "cancelled" : "failed");
        setAnalysisDone(false);
        localStorage.removeItem(ACTIVE_BI_JOB_KEY);
        return true;
      }

      setAnalyzing(Math.max(1, stageFromPct));
      return false;
    };

    const pollJob = async (jobId: string) => {
      if (isStale()) return;
      try {
        const res = await apiGet<{ job: BackgroundJob }>(`/api/jobs/${jobId}`, {
          signal: controller.signal,
        });
        if (isStale()) return;
        pollErrors = 0;
        const job = res.job;
        if (!job) return;
        if (applyJobSnapshot(job)) return;
        pollTimer = window.setTimeout(() => void pollJob(jobId), 1200);
      } catch (err) {
        if (isStale() || (err instanceof Error && err.name === "AbortError")) return;
        pollErrors += 1;
        if (pollErrors >= 4) {
          localStorage.removeItem(ACTIVE_BI_JOB_KEY);
          setAnalysisError(
            err instanceof Error
              ? err.message
              : "Lost connection while polling background job. Retry or continue manually.",
          );
          setAnalysisOutcome("failed");
          setAnalysisDone(false);
          return;
        }
        pollTimer = window.setTimeout(() => void pollJob(jobId), 1500);
      }
    };

    const startOrResume = async () => {
      const savedId = activeJobId || localStorage.getItem(ACTIVE_BI_JOB_KEY) || "";
      if (savedId) {
        setActiveJobId(savedId);
        void pollJob(savedId);
        return;
      }

      setAnalyzing(0);
      setJobStageLabel("Starting business intelligence analysis…");
      try {
        const res = await apiPost<{ job: BackgroundJob }>(
          "/api/jobs/business-intelligence",
          {
            name: name.trim() || "New Business",
            websiteUrl: url.trim(),
            industry,
            companySize,
            description,
            location,
            targetCountries,
            products: selectedProducts,
            objectives: selectedObjectives,
            channels: selectedChannels,
            model: textModel,
          },
          { signal: controller.signal },
        );
        if (isStale()) return;
        const job = res.job;
        setActiveJobId(job.id);
        if (applyJobSnapshot(job)) {
          return;
        }
        localStorage.setItem(ACTIVE_BI_JOB_KEY, job.id);
        void pollJob(job.id);
      } catch (err) {
        if (isStale() || (err instanceof Error && err.name === "AbortError")) return;
        setAnalyzing(0);
        setJobStageLabel("Analysis failed");
        setAnalysisError(
          err instanceof Error
            ? err.message
            : "Could not start website analysis job. You can retry or enter your workspace manually.",
        );
        setAnalysisOutcome("failed");
        setAnalysisDone(false);
      }
    };

    void startOrResume();

    return () => {
      unmounted = true;
      controller.abort();
      if (pollTimer) window.clearTimeout(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, jobTriggerTick]);

  const handleRetryBiJob = async () => {
    setAnalysisError("");
    setAnalysisDone(false);
    setAnalysisOutcome("running");
    setAnalyzing(0);
    localStorage.removeItem(ACTIVE_BI_JOB_KEY);
    setActiveJobId("");
    setJobTriggerTick((t) => t + 1);
  };

  const handleCancelBiJob = async () => {
    if (activeJobId) {
      await apiPost(`/api/jobs/${activeJobId}/cancel`, {}).catch(() => {});
    }
    localStorage.removeItem(ACTIVE_BI_JOB_KEY);
    setActiveJobId("");
    setAnalysisDone(false);
    setAnalysisOutcome("cancelled");
    setJobStageLabel("Cancelled by user");
    setAnalysisError("Analysis cancelled by user. You can retry or enter your workspace manually.");
  };

  return (
    <div className="onboard">
      <div className="onboard-brand">
        <div className="logo-mark">
          <span />
        </div>
        <b>Marketing OS</b>
        <span className="demo-label">Live AI Workspace</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {authUser ? (
            <>
              <span className="badge mint" title={authUser.email || "Signed in"}>
                <i />
                {authUser.email || authUser.displayName || "Signed in"}
              </span>
              {onSignOut && (
                <button className="btn ghost" type="button" onClick={() => void onSignOut()}>
                  Sign out
                </button>
              )}
            </>
          ) : (
            <button className="btn secondary" type="button" onClick={() => onOpenAuth("signin")}>
              Sign in
            </button>
          )}
          {canCancel ? (
            <button className="btn ghost" type="button" onClick={onCancel}>
              ← Back to workspace
            </button>
          ) : null}
        </div>
      </div>

      <div className="onboard-grid">
        <aside className="onboard-aside">
          <div>
            <span className="eyebrow">Workspace setup</span>
            <h2>Build your business intelligence.</h2>
            <p>
              Marketing OS crawls your website and uses Gemini to populate a persistent Business
              Notebook shared across every research, content, and growth studio.
            </p>
          </div>
          <div className="step-list">
            {steps.map((s, i) => (
              <div
                className={`step-row ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
                key={s}
              >
                <span>{i < step ? "✓" : i + 1}</span>
                {s}
              </div>
            ))}
          </div>
          <p className="legal">
            Live crawl + Gemini AI intelligence persisted to your local workspace and Firebase
            Firestore.
          </p>
        </aside>

        <main className="onboard-main">
          <div className="onboard-head">
            <span>Step {step + 1} of 8</span>
            <div className="progress">
              <i style={{ width: `${((step + 1) / 8) * 100}%` }} />
            </div>
          </div>

          {step === 0 && (
            <div className="welcome-panel">
              <div className="orb">
                <div className="logo-mark big">
                  <span />
                </div>
              </div>
              <span className="badge mint">
                <i />
                Intelligence first
              </span>
              <h1>
                Your marketing department,
                <br />
                <em>finally connected.</em>
              </h1>
              <p>
                First you record the business. Then you create the account that owns it. Only after
                that does Gemini analyze the website and open the workspace. Nothing else is
                available until that analysis finishes.
              </p>
              <div className="mini-agents">
                <span>Research</span>
                <i>→</i>
                <span>Strategy</span>
                <i>→</i>
                <span>Creative</span>
                <i>→</i>
                <span>Growth</span>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="form-panel">
              <span className="eyebrow">Tell us about your business</span>
              <h1>Start with the essentials.</h1>
              <p>Name, website, description, location, and markets are required before you can continue.</p>
              <div className="field-grid">
                <label>
                  <span>Business name</span>
                  <input
                    placeholder="e.g. Acme Studio"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  <span>Website URL</span>
                  <input
                    placeholder="https://yourcompany.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </label>
                <label>
                  <span>Industry</span>
                  <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                    <option>Health, fitness &amp; self-improvement</option>
                    <option>SaaS &amp; Developer Tools</option>
                    <option>E-commerce &amp; DTC Consumer</option>
                    <option>Fintech &amp; Financial Services</option>
                    <option>Agency &amp; Professional Services</option>
                    <option>Education &amp; Coaching</option>
                  </select>
                </label>
                <label>
                  <span>Company size</span>
                  <select value={companySize} onChange={(e) => setCompanySize(e.target.value)}>
                    <option>Solo founder</option>
                    <option>2–10 people</option>
                    <option>11–50 people</option>
                    <option>50+ team</option>
                  </select>
                </label>
                <label className="wide">
                  <span>Business description</span>
                  <textarea
                    placeholder="Describe what you sell, who it is for, and the result you help them get. At least a few sentences."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <label>
                  <span>Business location</span>
                  <input
                    placeholder="e.g. Austin, United States"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </label>
                <label>
                  <span>Target countries</span>
                  <input
                    placeholder="e.g. USA, UK, Canada"
                    value={targetCountries}
                    onChange={(e) => setTargetCountries(e.target.value)}
                  />
                </label>
              </div>
            </div>
          )}

          {step === 2 && (
            <ChoiceStep
              eyebrow="Product presence"
              title={`Where does ${name || "your product"} live?`}
              text="Select every product surface we should analyze."
              options={products}
              selected={selectedProducts}
              toggle={(v) => toggle(v, selectedProducts, setSelectedProducts)}
            />
          )}

          {step === 3 && (
            <ChoiceStep
              eyebrow="Marketing objectives"
              title="What are we growing?"
              text="Your objectives shape your strategy, SEO, and campaign pipeline."
              options={objectives}
              selected={selectedObjectives}
              toggle={(v) => toggle(v, selectedObjectives, setSelectedObjectives)}
            />
          )}

          {step === 4 && (
            <ChoiceStep
              eyebrow="Distribution"
              title="Choose your priority channels."
              text="Nothing will ever be connected or published without your explicit confirmation."
              options={channels}
              selected={selectedChannels}
              toggle={(v) => toggle(v, selectedChannels, setSelectedChannels)}
            />
          )}

          {step === 5 && (
            <div className="form-panel">
              <span className="eyebrow">Brand assets &amp; AI model</span>
              <h1>Bring your brand with you.</h1>
              <p>Upload visual references now or select the Gemini model for initial analysis.</p>

              <div style={{ marginBottom: 14 }}>
                <ModelSelector
                  label="Onboarding Analysis Model"
                  value={textModel}
                  options={textModels}
                  onChange={onSelectModel}
                />
              </div>

              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*,audio/*,.pdf"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  await onUploadBrandFile(file);
                  setUploadedFiles((prev) => [
                    ...prev,
                    { name: file.name, size: `${Math.max(1, Math.round(file.size / 1024))} KB` },
                  ]);
                }}
              />
              <div className="upload-zone" onClick={() => fileRef.current?.click()} style={{ cursor: "pointer" }}>
                <Icon name="Business Notebook" size={28} />
                <b>Click to upload brand assets</b>
                <span>Logo, screenshots, product clips, or reference images</span>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileRef.current?.click();
                  }}
                >
                  Browse files
                </button>
              </div>
              {uploadedFiles.length > 0 && (
                <div className="upload-list">
                  {uploadedFiles.map((f) => (
                    <div key={f.name}>
                      <div className="file-type mint">FILE</div>
                      <span>
                        <b>{f.name}</b>
                        <small>{f.size} · Uploaded</small>
                      </span>
                      <strong>✓</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 6 && (
            <div className="form-panel">
              <span className="eyebrow">Save this business to you</span>
              <h1>Create your account before analysis.</h1>
              <p>
                {name.trim() || "This business"}, its markets, and its channels stay on this account.
                Gemini does not start until the account exists.
              </p>
              <div className="mos-subcard" style={{ marginTop: 8, textAlign: "left" }}>
                <b style={{ fontSize: 13 }}>{name.trim() || "Business"}</b>
                <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                  {url.trim() || "Website not set"} · {industry} · {selectedProducts.length} products ·{" "}
                  {selectedObjectives.length} objectives · {selectedChannels.length} channels
                </small>
              </div>
              {authUser ? (
                <div className="mos-subcard" style={{ marginTop: 14, textAlign: "left" }}>
                  <b style={{ fontSize: 13 }}>Account ready: {authUser.email || authUser.displayName}</b>
                  <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                    {authUser.emailVerified
                      ? "Email is verified. The analysis will save into this account."
                      : "Check your inbox for the verification email. You can start the analysis now; cloud sync finishes after you verify."}
                  </small>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                  <button type="button" className="btn primary" onClick={() => onOpenAuth("signup")}>
                    Create account
                  </button>
                  <button type="button" className="btn secondary" onClick={() => onOpenAuth("signin")}>
                    I already have an account
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 7 && (
            <div className="analysis-panel">
              <span
                className={`badge ${
                  analysisOutcome === "completed"
                    ? "mint"
                    : analysisOutcome === "failed" || analysisOutcome === "cancelled"
                      ? "high"
                      : analysisOutcome === "partial"
                        ? "medium"
                        : "blue"
                }`}
              >
                <i />
                {analysisOutcome === "completed"
                  ? "Intelligence ready"
                  : analysisOutcome === "partial"
                    ? "Partial crawl saved"
                    : analysisOutcome === "failed"
                      ? "Analysis failed"
                      : analysisOutcome === "cancelled"
                        ? "Analysis cancelled"
                        : jobStageLabel || "Running business intelligence"}
              </span>
              <h1>
                {analysisOutcome === "completed"
                  ? `${name || "Your"} workspace is ready.`
                  : analysisOutcome === "partial"
                    ? `${name || "Your"} website crawl finished with partial intelligence.`
                    : analysisOutcome === "failed" || analysisOutcome === "cancelled"
                      ? `${name || "Your"} business intelligence scan paused.`
                      : `Building ${name || "business"} intelligence…`}
              </h1>
              <p>
                {analysisOutcome === "completed"
                  ? `Extracted positioning, ${(analysisResult?.intelligence?.competitorNames || []).length} competitors, and ${(analysisResult?.intelligence?.keywordOpportunities || []).length} keyword opportunities.`
                  : analysisOutcome === "failed" || analysisOutcome === "cancelled"
                    ? "Live AI extraction did not complete. Retry the analysis. The workspace stays closed until it finishes."
                    : "Crawling your site and synthesizing brand intelligence with Gemini."}
              </p>
              {analysisError && analysisOutcome !== "completed" && (
                <div className="mos-error-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{analysisError}</span>
                  <button type="button" className="btn secondary" onClick={() => void handleRetryBiJob()}>
                    ↻ Retry Analysis
                  </button>
                </div>
              )}
              <div className="analysis-list">
                {analysisStages.map((s, i) => {
                  const isFailedHere =
                    (analysisOutcome === "failed" || analysisOutcome === "cancelled") && i === analyzing;
                  const isDone = i < analyzing && analysisOutcome !== "failed";
                  const isRunning = analysisOutcome === "running" && i === analyzing;
                  return (
                    <div
                      className={`${isDone ? "done" : isRunning ? "running" : ""}`}
                      key={s}
                    >
                      <span>
                        {isDone ? "✓" : isFailedHere ? "✕" : isRunning ? <i className="spinner" /> : i + 1}
                      </span>
                      <b>{s}</b>
                      <small>
                        {isDone
                          ? "Completed"
                          : isFailedHere
                            ? analysisOutcome === "cancelled"
                              ? "Cancelled"
                              : "Failed"
                            : isRunning
                              ? jobStageLabel || "Processing…"
                              : analysisOutcome === "failed" || analysisOutcome === "cancelled"
                                ? "Not run"
                                : "Queued"}
                      </small>
                    </div>
                  );
                })}
              </div>
              {analysisResult?.crawled?.title && (
                <div className="demo-note">
                  Crawled source: <b>{analysisResult.crawled.title}</b> ({analysisResult.crawled.url})
                </div>
              )}

              {analysisResult?.integrationRecommendations && analysisResult.integrationRecommendations.length > 0 && (
                <div className="mos-subcard" style={{ marginTop: 12, textAlign: "left" }}>
                  <b style={{ fontSize: 12 }}>Recommended Analytics &amp; Growth Connections</b>
                  <small style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>
                    Optional — connect inside Integrations whenever ready to unlock verified funnels and metrics.
                  </small>
                  <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                    {analysisResult.integrationRecommendations.slice(0, 4).map((rec) => (
                      <div key={rec.provider} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, gap: 8 }}>
                        <span>
                          <b>{rec.providerLabel}</b> — {rec.whyRecommended}
                        </span>
                        <span className={`badge ${rec.sdkDetected ? "mint" : "blue"}`}>
                          <i />
                          {rec.sdkDetected ? "SDK Detected" : rec.priority}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mos-subcard" style={{ marginTop: 14, textAlign: "left" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <b style={{ fontSize: 12 }}>
                      {authUser
                        ? `Account Connected: ${authUser.email}`
                        : "Save & Sync Workspace to Your Account"}
                    </b>
                    <small style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>
                      {authUser
                        ? authUser.emailVerified
                          ? "Your Business Notebook, AI memory, and media library will sync automatically."
                          : "Account created! Verification email sent — check your inbox after entering your workspace."
                        : "Create the account above before analysis can start."}
                    </small>
                  </div>
                  {!authUser && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => onOpenAuth("signup")}
                      >
                        Create Account
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => onOpenAuth("signin")}
                      >
                        Sign In
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="onboard-actions">
            {step > 0 && step < 7 && (
              <button className="btn ghost" type="button" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            {step === 7 && analysisOutcome === "running" && (
              <button className="btn ghost" type="button" onClick={() => void handleCancelBiJob()}>
                Cancel scan
              </button>
            )}
            {step === 7 && (analysisOutcome === "failed" || analysisOutcome === "cancelled") && (
              <button className="btn ghost" type="button" onClick={() => setStep(1)}>
                ← Edit details
              </button>
            )}
            <div className="spacer" />
            {step < 7 && (
              <button
                className="btn primary"
                type="button"
                disabled={!stepReady}
                onClick={() => {
                  if (step === 6 && !authUser) return;
                  setStep((s) => s + 1);
                }}
              >
                {step === 6
                  ? "Start AI analysis"
                  : step === 0
                    ? "Enter business details"
                    : "Continue"}{" "}
                <span>→</span>
              </button>
            )}
            {step === 7 && analysisDone && (
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  localStorage.removeItem(ACTIVE_BI_JOB_KEY);
                  localStorage.removeItem("mos-onboarding-draft-v1");
                  onFinish({
                    name: name.trim() || "New Business",
                    websiteUrl: url.trim(),
                    industry,
                    companySize,
                    description,
                    location,
                    targetCountries,
                    products: selectedProducts,
                    objectives: selectedObjectives,
                    channels: selectedChannels,
                    analysisResult,
                  });
                }}
              >
                Enter workspace <span>→</span>
              </button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function CommandPalette({
  close,
  go,
  workspaceName,
}: {
  close: () => void;
  go: (p: Page) => void;
  workspaceName: string;
}) {
  const [query, setQuery] = useState("");
  const allPages = nav.flatMap((g) => g.items.map((item) => ({ group: g.group, page: item })));

  const quickActions: Array<{ label: string; subtitle: string; page: Page }> = [
    {
      label: "Create a 14-day content campaign",
      subtitle: `Uses ${workspaceName} Business Notebook`,
      page: "AI Command Center",
    },
    {
      label: "Run a live website SEO audit",
      subtitle: "Crawls target URL + scores technical fixes",
      page: "SEO & ASO",
    },
    {
      label: "Discover competitors with Google Search",
      subtitle: "Grounded market & positioning analysis",
      page: "Competitors",
    },
    {
      label: "Generate AI scripts, images & video clips",
      subtitle: "Content Studio & Nano Banana image models",
      page: "Content Studio",
    },
    {
      label: "Edit & render vertical MP4 in Video Editor",
      subtitle: "Real FFmpeg trimming, aspect ratio & audio mix",
      page: "Video Editor",
    },
  ];

  const matches = query.trim()
    ? allPages.filter(
        (x) =>
          x.page.toLowerCase().includes(query.toLowerCase()) ||
          x.group.toLowerCase().includes(query.toLowerCase()),
      )
    : [];

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="command-palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="command-input">
          <Icon name="AI Command Center" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, agents, or type a workflow…"
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "Enter" && matches[0]) {
                close();
                go(matches[0].page);
              }
            }}
          />
          <kbd onClick={close} style={{ cursor: "pointer" }}>
            ESC
          </kbd>
        </div>
        <div className="command-content">
          {query.trim() ? (
            <>
              <label>Matching workspaces &amp; studios ({matches.length})</label>
              {matches.map((m) => (
                <button
                  key={m.page}
                  onClick={() => {
                    close();
                    go(m.page);
                  }}
                >
                  <Icon name={m.page} />
                  <span>
                    <b>{m.page}</b>
                    <small>{m.group}</small>
                  </span>
                  <i>→</i>
                </button>
              ))}
              {matches.length === 0 && (
                <button
                  onClick={() => {
                    close();
                    go("AI Command Center");
                  }}
                >
                  <Icon name="AI Command Center" />
                  <span>
                    <b>Ask AI Command Center: “{query}”</b>
                    <small>Launch multi-agent workflow</small>
                  </span>
                  <i>→</i>
                </button>
              )}
            </>
          ) : (
            <>
              <label>Suggested actions</label>
              {quickActions.map((x) => (
                <button
                  key={x.label}
                  onClick={() => {
                    close();
                    go(x.page);
                  }}
                >
                  <Icon name={x.page} />
                  <span>
                    <b>{x.label}</b>
                    <small>{x.subtitle}</small>
                  </span>
                  <i>→</i>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const mos = useMarketingOS();

  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem("mos-onboarded") === "yes" || mos.workspace.onboarded,
  );
  const [creatingNewWorkspace, setCreatingNewWorkspace] = useState(false);

  const page = mos.activePage;
  const setPage = mos.setActivePage;
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("mos-theme") as "dark" | "light") || "dark",
  );
  const [toast, setToast] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const [workspaceHubOpen, setWorkspaceHubOpen] = useState(false);
  const [liveVoiceOpen, setLiveVoiceOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<"signup" | "signin" | "reset">("signup");
  const [, setAuthRefreshTick] = useState(0);
  const [pendingEditorClips, setPendingEditorClips] = useState<string[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<
    Array<{
      id: string;
      title: string;
      message: string;
      category: string;
      severity: "info" | "success" | "warning" | "error";
      read: boolean;
      createdAt: string;
      actionPage?: string;
    }>
  >([]);

  const [approved, setApproved] = useState(() => localStorage.getItem("mos-approved") === "yes");
  const [activeBlueprint, setActiveBlueprint] = useState<TrendFormatItem | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [contentStudioInitialStage, setContentStudioInitialStage] = useState<
    "brief" | "scripts" | "storyboard" | null
  >(null);
  const activeScriptTitle = mos.activeScriptTitle;
  const setActiveScriptTitle = mos.setActiveScriptTitle;
  const activeScriptText = mos.activeScriptText;
  const setActiveScriptText = mos.setActiveScriptText;

  const openAuthModal = (mode: "signup" | "signin" | "reset" = "signup") => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const loadNotifications = async () => {
    try {
      const data = await apiGet<{
        unreadCount: number;
        notifications: typeof notifications;
      }>("/api/notifications");
      setUnreadCount(data.unreadCount || 0);
      setNotifications(data.notifications || []);
    } catch {
      // Ignore transient offline errors
    }
  };

  useEffect(() => {
    void loadNotifications();
    const timer = setInterval(() => void loadNotifications(), 30000);
    return () => clearInterval(timer);
  }, [mos.workspace.id]);

  useEffect(() => {
    const ws = mos.workspace;
    const established =
      Boolean(ws.onboarded) ||
      ((ws.name || "").trim().length > 1 &&
        ((ws.websiteUrl || "").trim().length > 3 ||
          (ws.description || "").trim().length >= 20 ||
          (ws.products || []).length > 0));
    if (established && !onboarded && !creatingNewWorkspace) {
      setOnboarded(true);
      localStorage.setItem("mos-onboarded", "yes");
    }
  }, [creatingNewWorkspace, mos.workspace, onboarded]);

  useEffect(() => {
    const initialPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (initialPath === "/login") {
      setAuthModalMode("signin");
      setAuthModalOpen(true);
    } else {
      const matchedPage = resolvePageFromPath(initialPath);
      if (matchedPage && initialPath !== "/") {
        setPage(matchedPage);
      }
    }

    const onPopState = () => {
      const targetPath = window.location.pathname.replace(/\/+$/, "") || "/";
      if (targetPath === "/login") {
        setAuthModalMode("signin");
        setAuthModalOpen(true);
        return;
      }
      const nextPage = resolvePageFromPath(targetPath);
      if (nextPage) {
        setPage(nextPage);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (p: Page) => {
    setPage(p);
    setMobile(false);
    setWsDropdownOpen(false);
    const targetPath = getPathForPage(p);
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ page: p }, "", targetPath);
    }
    window.scrollTo(0, 0);
  };

  const notify = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 3200);
  };

  const openContentProject = (
    proj: ContentProject,
    destination: "auto" | "brief" | "scripts" | "storyboard" | "video" | "avatar" | "queue" = "auto",
  ) => {
    setActiveProjectId(proj.id);
    if (proj.title) setActiveScriptTitle(proj.title);
    if (proj.script || proj.hook) setActiveScriptText(proj.script || proj.hook || "");
    if (destination === "brief" || destination === "scripts" || destination === "storyboard") {
      setContentStudioInitialStage(destination);
      go("Content Studio");
      return;
    }
    if (destination === "video") {
      go("Video Editor");
      return;
    }
    if (destination === "avatar") {
      go("AI Avatar Studio");
      return;
    }
    if (destination === "queue") {
      go("Publishing Queue");
      return;
    }
    if (!proj.scriptApproved) {
      setContentStudioInitialStage("scripts");
      go("Content Studio");
    } else if ((proj.storyboardScenes?.length || 0) > 0 && !proj.storyboardApproved) {
      setContentStudioInitialStage("storyboard");
      go("Content Studio");
    } else if (!proj.videoUrl && !proj.editedVideoUrl) {
      go("Video Editor");
    } else {
      go("Publishing Queue");
    }
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mos-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleUploadBrandAsset = async (file: File) => {
    try {
      const up = await uploadMediaFile(file);
      const kind: MediaAsset["kind"] = file.type.startsWith("audio/")
        ? "audio"
        : file.type.startsWith("video/")
          ? "video"
          : "image";
      mos.setMediaAssets((prev) => [
        {
          id: `asset-${Date.now()}`,
          name: up.originalName || file.name,
          kind,
          url: up.url,
          durationOrSize: `${Math.max(1, Math.round((up.size || file.size) / 1024))} KB`,
          sourceType: "imported",
        },
        ...prev,
      ]);
      notify(`Uploaded brand asset: ${file.name}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const handleCompleteOnboarding = (payload: {
    name: string;
    websiteUrl: string;
    industry: string;
    companySize: string;
    description: string;
    location: string;
    targetCountries: string;
    products: string[];
    objectives: string[];
    channels: string[];
    analysisResult: AnalyzeWebsiteResponse | null;
  }) => {
    const ai = payload.analysisResult?.intelligence;

    mos.createNewWorkspace({
      name: payload.name,
      websiteUrl: payload.websiteUrl,
      industry: ai?.industry || payload.industry,
      companySize: payload.companySize,
      description:
        payload.description ||
        ai?.businessSummary ||
        payload.analysisResult?.crawled?.metaDescription ||
        "",
      location: payload.location,
      targetCountries: payload.targetCountries,
      products: payload.products,
      objectives: payload.objectives,
      channels: payload.channels,
      positioning: ai?.positioning || "",
      valueProposition: ai?.valueProposition || payload.description || "",
      brandVoiceNotes: ai?.brandVoiceNotes || "",
      wordsToUse: ai?.wordsToUse || "",
      wordsToAvoid: ai?.wordsToAvoid || "",
      preferredTextModel: mos.models.textModel,
      preferredImageModel: mos.models.imageModel,
      preferredVideoModel: mos.models.videoModel,
      preferredVoiceModel: mos.models.voiceModel,
    });

    if (ai) {
      const nextInsights = [
        ...(ai.customerNeed ? [{ label: "Customer need", text: ai.customerNeed }] : []),
        ...(ai.keyDifferentiator ? [{ label: "Key differentiator", text: ai.keyDifferentiator }] : []),
        ...(ai.proofDirection ? [{ label: "Proof direction", text: ai.proofDirection }] : []),
        ...(ai.targetAudienceSummary
          ? [{ label: "Target audience", text: ai.targetAudienceSummary }]
          : []),
      ];
      if (nextInsights.length > 0) mos.setInsights(nextInsights);

      if (ai.competitorNames?.length) {
        const mappedComps: CompetitorItem[] = ai.competitorNames.map((compName, idx) => ({
          id: `comp-ob-${Date.now()}-${idx}`,
          name: compName,
          category: idx < 2 ? "Direct" : "Indirect",
          positioning:
            idx === 0
              ? "Primary direct competitor candidate (enriching via live web scan…)"
              : idx < 2
                ? "Direct category alternative (enriching…)"
                : "Indirect or adjacent category alternative (enriching…)",
          estimatedAudience: "Pending per-competitor audience scan",
          strength: "Identified from initial market scan",
          weakness: "Run Competitor Research to complete full teardown",
          opportunityScore: 0,
          contentPillars: [],
          sourceType: "ai_grounded",
        }));
        mos.setCompetitors(mappedComps);
      }

      if (payload.websiteUrl.trim() || ai.competitorNames?.length) {
        void apiPost<{
          competitors?: Array<Omit<CompetitorItem, "id" | "sourceType">>;
        }>("/api/research/competitors", {
          business: {
            name: payload.name,
            websiteUrl: payload.websiteUrl,
            industry: ai.industry || payload.industry,
            description: payload.description || ai.businessSummary || "",
            targetCountries: payload.targetCountries,
          },
          focusQuery: (ai.competitorNames || []).join(", "),
          model: mos.models.textModel,
        })
          .then((res) => {
            if (res.competitors?.length) {
              mos.setCompetitors(
                res.competitors.map((c, idx) => ({
                  ...c,
                  id: `comp-ai-${Date.now()}-${idx}`,
                  sourceType: "ai_grounded",
                })),
              );
            }
          })
          .catch(() => {
            // Keep initial discovered competitor names silently if web lookup is offline
          });
      }

      if (ai.keywordOpportunities?.length) {
        const mappedKw: SeoKeywordItem[] = ai.keywordOpportunities.map((kw) => ({
          keyword: kw,
          volumeOrIntent: "Commercial / Informational",
          difficulty: "Medium",
          priority: "High",
        }));
        mos.setSeoKeywords(mappedKw);
      }
    }

    mos.addNotebookVersion(`Initial live onboarding analysis for ${payload.name}`, "live_crawl");
    localStorage.setItem("mos-onboarded", "yes");
    setOnboarded(true);
    setCreatingNewWorkspace(false);
    setPage("Overview");
    notify(`Workspace ready for ${payload.name}`);
  };

  const handleSignOut = async () => {
    try {
      await mos.signOutAccount();
      setActiveProjectId("");
      setWsDropdownOpen(false);
      setCreatingNewWorkspace(false);
      setOnboarded(false);
      notify("Signed out cleanly");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not sign out cleanly");
    }
  };

  if (!mos.authReady || (mos.authUser && !mos.workspacesResolved)) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <b>Opening your workspace</b>
          <p style={{ color: "var(--muted)", marginTop: 8 }}>Checking the account saved in your database.</p>
        </div>
      </div>
    );
  }

  const savedBusiness =
    Boolean(mos.workspace.onboarded) ||
    ((mos.workspace.name || "").trim().length > 1 &&
      ((mos.workspace.websiteUrl || "").trim().length > 3 ||
        (mos.workspace.description || "").trim().length >= 20 ||
        (mos.workspace.products || []).length > 0));

  if (creatingNewWorkspace || (!onboarded && !savedBusiness)) {
    return (
      <>
        <OnboardingFlow
          authUser={mos.authUser}
          onOpenAuth={(mode) => openAuthModal(mode)}
          onSignOut={handleSignOut}
          textModel={mos.models.textModel}
          textModels={mos.modelCatalog.text}
          onSelectModel={(id) => void mos.updateModels({ textModel: id })}
          canCancel={creatingNewWorkspace}
          onCancel={() => setCreatingNewWorkspace(false)}
          onSkipToEmpty={() => {
            localStorage.removeItem(ACTIVE_BI_JOB_KEY);
            localStorage.setItem("mos-onboarded", "yes");
            setOnboarded(true);
            setCreatingNewWorkspace(false);
            notify("Entered empty Marketing OS workspace");
          }}
          onUploadBrandFile={handleUploadBrandAsset}
          onFinish={handleCompleteOnboarding}
        />
        <AuthModal
          open={authModalOpen}
          initialMode={authModalMode}
          onClose={() => setAuthModalOpen(false)}
          onAuthenticated={() => {
            setAuthRefreshTick((t) => t + 1);
            notify("Account connected · workspace synced");
          }}
        />
      </>
    );
  }

  const queuePendingCount = mos.calendarPosts.filter((p) => p.status !== "Published").length;
  const wsInitials =
    (mos.workspace.name || "Marketing OS")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || "")
      .join("") || "MO";

  const userInitials = mos.authUser?.displayName
    ? mos.authUser.displayName
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join("")
    : "?";

  const renderPage = () => {
    if (page === "Overview") {
      return (
        <OverviewView
          workspace={mos.workspace}
          authUser={mos.authUser}
          projects={mos.projects}
          competitors={mos.competitors}
          seoKeywords={mos.seoKeywords}
          strategy={mos.strategy}
          calendarPosts={mos.calendarPosts}
          automationRuns={mos.automationRuns}
          go={go}
          onOpenVoice={() => setLiveVoiceOpen(true)}
        />
      );
    }
    if (page === "AI Command Center") {
      return (
        <CommandCenterView
          workspace={mos.workspace}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          onSelectTextModel={(id) => void mos.updateModels({ textModel: id })}
          onAddProjects={(items) => mos.setProjects((prev) => [...items, ...prev])}
          onAddCalendarDrafts={(posts) => mos.setCalendarPosts((prev) => [...posts, ...prev])}
          onConsumeCredits={(amt, label) => {
            mos.consumeCredits(amt, label);
            void mos.persistWorkspaceItem({
              kind: "campaign",
              title: label,
              status: "draft",
              sourceType: "ai_grounded",
              creditsUsed: amt,
            });
          }}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Business Notebook") {
      return (
        <NotebookView
          workspace={mos.workspace}
          insights={mos.insights}
          versions={mos.notebookVersions}
          models={mos.models}
          memories={mos.memories}
          onSaveMemory={mos.saveMemory}
          onUpdateMemory={mos.updateMemoryItem}
          onDeleteMemory={mos.deleteMemoryItem}
          go={go}
          onUpdateWorkspace={mos.updateWorkspace}
          onUpdateInsights={mos.setInsights}
          onAddVersion={mos.addNotebookVersion}
          onConsumeCredits={mos.consumeCredits}
          notify={notify}
        />
      );
    }
    if (page === "Marketing Strategy") {
      return (
        <MarketingStrategyView
          workspace={mos.workspace}
          strategy={mos.strategy}
          strategies={mos.strategies}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          onSelectTextModel={(id) => void mos.updateModels({ textModel: id })}
          onUpdateStrategy={(s) => {
            mos.setStrategy(s);
            void mos.persistWorkspaceItem({
              id: s.id,
              kind: "strategy",
              title: s.title,
              status: "active",
              sourceType: s.sourceType,
              payload: s as unknown as Record<string, unknown>,
            });
          }}
          onSaveStrategy={mos.saveStrategyRecord}
          onDeleteStrategy={mos.deleteStrategyRecord}
          onGenerateCalendar={mos.generateCalendarFromStrategy}
          onUpsertProject={mos.upsertContentProject}
          onAddProjects={(items) => mos.setProjects((prev) => [...items, ...prev])}
          onConsumeCredits={mos.consumeCredits}
          onOpenWorkspaceHub={() => setWorkspaceHubOpen(true)}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Competitors" || page === "Market Research") {
      return (
        <CompetitorsView
          workspace={mos.workspace}
          competitors={mos.competitors}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          onSelectTextModel={(id) => void mos.updateModels({ textModel: id })}
          onUpdateCompetitors={(items) => {
            mos.setCompetitors(items);
            void mos.persistWorkspaceItem({
              kind: "competitors",
              title: `Competitor Watch (${items.length})`,
              status: "active",
              sourceType: "ai_grounded",
            });
          }}
          onConsumeCredits={mos.consumeCredits}
          onOpenWorkspaceHub={() => setWorkspaceHubOpen(true)}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Influencer Discovery") {
      return (
        <InfluencersView
          workspace={mos.workspace}
          influencers={mos.influencers}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          onSelectTextModel={(id) => void mos.updateModels({ textModel: id })}
          onUpdateInfluencers={mos.setInfluencers}
          onConsumeCredits={mos.consumeCredits}
          onOpenWorkspaceHub={() => setWorkspaceHubOpen(true)}
          notify={notify}
        />
      );
    }
    if (page === "Trending Content") {
      return (
        <TrendsView
          workspace={mos.workspace}
          trends={mos.trends}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          mediaAssets={mos.mediaAssets}
          onCreateProject={mos.upsertContentProject}
          onSetActiveScript={(t, s) => {
            setActiveScriptTitle(t);
            setActiveScriptText(s);
          }}
          onLoadInVideoEditor={(bdId) => {
            mos.setVideoEditorPrefs((prev) => ({ ...prev, referenceBreakdownId: bdId }));
            go("Video Editor");
            notify("Loaded reference viral structure in Video Editor");
          }}
          onSelectTextModel={(id) => void mos.updateModels({ textModel: id })}
          onUpdateTrends={mos.setTrends}
          onConsumeCredits={mos.consumeCredits}
          onUseBlueprint={(bp) => {
            setActiveBlueprint(bp);
            go("Content Studio");
            notify(`Loaded "${bp.patternName}" blueprint into Content Studio`);
          }}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "SEO & ASO") {
      return (
        <SeoView
          workspace={mos.workspace}
          issues={mos.seoIssues}
          keywords={mos.seoKeywords}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          go={go}
          onSelectTextModel={(id) => void mos.updateModels({ textModel: id })}
          onUpdateIssues={mos.setSeoIssues}
          onUpdateKeywords={mos.setSeoKeywords}
          onConsumeCredits={mos.consumeCredits}
          onOpenWorkspaceHub={() => setWorkspaceHubOpen(true)}
          notify={notify}
        />
      );
    }
    if (page === "Content Studio") {
      return (
        <ContentStudioView
          workspace={mos.workspace}
          activeBlueprint={activeBlueprint}
          projects={mos.projects}
          activeProjectId={activeProjectId}
          initialStage={contentStudioInitialStage}
          onConsumeInitialStage={() => setContentStudioInitialStage(null)}
          onSelectProjectId={setActiveProjectId}
          mediaAssets={mos.mediaAssets}
          competitors={mos.competitors}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          onSelectTextModel={(id) => void mos.updateModels({ textModel: id })}
          onSelectImageModel={(id) => void mos.updateModels({ imageModel: id })}
          onAddMediaAsset={(asset) => mos.setMediaAssets((prev) => [asset, ...prev])}
          onUpsertProject={mos.upsertContentProject}
          onPatchProject={mos.patchContentProject}
          onAddProject={(proj) => {
            mos.setProjects((prev) => [proj, ...prev]);
            void mos.persistWorkspaceItem({
              id: proj.id,
              kind: "project",
              title: proj.title,
              status: proj.stage,
              sourceType: proj.sourceType,
              creditsUsed: proj.creditsUsed,
              payload: proj as unknown as Record<string, unknown>,
            });
          }}
          onSetActiveScript={(title, text) => {
            setActiveScriptTitle(title);
            setActiveScriptText(text);
          }}
          onConsumeCredits={mos.consumeCredits}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "AI Avatar Studio") {
      return (
        <AvatarsView
          workspace={mos.workspace}
          activeScriptText={activeScriptText}
          projects={mos.projects}
          mediaAssets={mos.mediaAssets}
          activeProjectId={activeProjectId}
          onSelectProjectId={setActiveProjectId}
          onOpenProject={openContentProject}
          presenters={mos.presenters}
          models={mos.models}
          onUpdatePresenters={mos.setPresenters}
          onPatchProject={mos.patchContentProject}
          onAddMediaAsset={(asset) => mos.setMediaAssets((prev) => [asset, ...prev])}
          onConsumeCredits={mos.consumeCredits}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Voice Studio") {
      return (
        <VoiceStudioView
          workspace={mos.workspace}
          activeScriptText={activeScriptText}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          onSelectVoiceModel={(id) => void mos.updateModels({ voiceModel: id })}
          onAddMediaAsset={(asset) => mos.setMediaAssets((prev) => [asset, ...prev])}
          onConsumeCredits={mos.consumeCredits}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Video Editor") {
      return (
        <VideoEditorView
          workspace={mos.workspace}
          mediaAssets={mos.mediaAssets}
          projects={mos.projects}
          activeProjectId={activeProjectId}
          onSelectProjectId={setActiveProjectId}
          onOpenProject={openContentProject}
          activeTitle={activeScriptTitle}
          activeScriptText={activeScriptText}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          editorPrefs={mos.videoEditorPrefs}
          initialClips={pendingEditorClips}
          onConsumeInitialClips={() => setPendingEditorClips([])}
          onChangeEditorPrefs={(patch) =>
            mos.setVideoEditorPrefs((prev) => ({ ...prev, ...patch }))
          }
          onSelectTextModel={(id) => void mos.updateModels({ textModel: id })}
          onAddMediaAsset={(asset) => mos.setMediaAssets((prev) => [asset, ...prev])}
          onPatchProject={mos.patchContentProject}
          onConsumeCredits={mos.consumeCredits}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Media Library") {
      return (
        <MediaLibraryView
          workspace={mos.workspace}
          mediaAssets={mos.mediaAssets}
          models={mos.models}
          onAddMediaAsset={(asset) => mos.setMediaAssets((prev) => [asset, ...prev])}
          onUpdateMediaAsset={(id, patch) =>
            mos.setMediaAssets((prev) =>
              prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
            )
          }
          onDeleteMediaAsset={(id) =>
            mos.setMediaAssets((prev) => prev.filter((m) => m.id !== id))
          }
          onSendToVideoEditor={(urls) => setPendingEditorClips(urls)}
          onConsumeCredits={mos.consumeCredits}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Content Pipeline") {
      return (
        <PipelineView
          projects={mos.projects}
          onPatchProject={mos.patchContentProject}
          onRefreshPipeline={mos.fetchPipelineEntities}
          onAdvanceProject={async (id) => {
            const target = mos.projects.find((p) => p.id === id);
            if (!target) return;
            try {
              if (!target.scriptApproved) {
                if (!target.script?.trim() && !(target.scriptVariants?.length)) {
                  openContentProject(target, "brief");
                  notify(`Generate a script first for "${target.title}"`);
                  return;
                }
                const res = await apiPost<{ project: ContentProject }>(`/api/projects/${id}/approve-script`, {
                  script: target.script || target.scriptVariants?.[0]?.body || target.title,
                  hook: target.hook || target.scriptVariants?.[0]?.hook || "",
                  cta: target.cta || target.scriptVariants?.[0]?.cta || "",
                });
                if (res.project) await mos.patchContentProject(id, res.project);
                notify(`Script approved for "${target.title}" — ready for Storyboard / Video`);
                return;
              }
              if ((target.storyboardScenes?.length || 0) > 0 && !target.storyboardApproved) {
                const res = await apiPost<{ project: ContentProject }>(`/api/projects/${id}/approve-storyboard`, {
                  scenes: target.storyboardScenes,
                });
                if (res.project) await mos.patchContentProject(id, res.project);
                notify(`Storyboard approved for "${target.title}" — Video Production unlocked`);
                return;
              }
              if (!target.videoUrl && !target.editedVideoUrl) {
                openContentProject(target, "video");
                notify(`Opened "${target.title}" in Video Editor`);
                return;
              }
              if (!target.finalApproved) {
                const res = await apiPost<{ project: ContentProject }>(`/api/projects/${id}/approve-final`, {
                  caption: target.caption || target.title,
                });
                if (res.project) await mos.patchContentProject(id, res.project);
                notify(`Final approval granted for "${target.title}"`);
                return;
              }
              openContentProject(target, "queue");
            } catch (err) {
              notify(err instanceof Error ? err.message : "Could not advance project gate");
            }
          }}
          onOpenProject={(proj) => openContentProject(proj, "auto")}
          go={go}
        />
      );
    }
    if (page === "Audience Simulation") {
      return (
        <AudienceLabView
          workspace={mos.workspace}
          activeTitle={activeScriptTitle}
          activeScriptText={activeScriptText}
          evalData={mos.audienceEval}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          onSelectTextModel={(id) => void mos.updateModels({ textModel: id })}
          onUpdateEval={mos.setAudienceEval}
          onConsumeCredits={mos.consumeCredits}
          onApprove={() => {
            setApproved(true);
            localStorage.setItem("mos-approved", "yes");
          }}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Content Calendar") {
      return (
        <CalendarView
          calendarPosts={mos.calendarPosts}
          approved={approved}
          onAddPost={(post) => {
            void mos.upsertCalendarEntry(post);
            void mos.persistWorkspaceItem({
              id: post.id,
              kind: "calendar_post",
              title: post.title,
              status: post.status,
              sourceType: post.sourceType,
              payload: post as unknown as Record<string, unknown>,
            });
          }}
          onCreateProjectFromEntry={mos.createProjectFromCalendarEntry}
          onOpenWorkspaceHub={() => setWorkspaceHubOpen(true)}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Social Accounts") {
      return (
        <SocialAccountsView
          workspace={mos.workspace}
          onUpdateWorkspace={mos.updateWorkspace}
          notify={notify}
        />
      );
    }
    if (page === "Publishing Queue") {
      return (
        <PublishingQueueView
          posts={mos.calendarPosts}
          projects={mos.projects}
          onPatchProject={mos.patchContentProject}
          onRefreshPipeline={mos.fetchPipelineEntities}
          onOpenProject={openContentProject}
          onPublishPost={(id) => {
            mos.setCalendarPosts((prev) =>
              prev.map((p) => (p.id === id ? { ...p, status: "Published" } : p)),
            );
          }}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Ads Manager") {
      return (
        <AdsManagerView
          workspace={mos.workspace}
          adCampaigns={mos.adCampaigns}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          onSelectTextModel={(id) => void mos.updateModels({ textModel: id })}
          onCreateCampaign={(camp) => {
            mos.setAdCampaigns((prev) => [camp, ...prev]);
            void mos.persistWorkspaceItem({
              id: camp.id,
              kind: "ad_campaign",
              title: camp.name,
              status: camp.status,
              sourceType: camp.sourceType,
              payload: camp as unknown as Record<string, unknown>,
            });
          }}
          onConsumeCredits={mos.consumeCredits}
          notify={notify}
        />
      );
    }
    if (page === "Analytics") {
      return (
        <AnalyticsView
          workspace={mos.workspace}
          posts={mos.calendarPosts}
          projects={mos.projects}
          competitors={mos.competitors}
          seoKeywords={mos.seoKeywords}
          adCampaigns={mos.adCampaigns}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          onSelectTextModel={(id) => void mos.updateModels({ textModel: id })}
          onConsumeCredits={mos.consumeCredits}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Growth Intelligence") {
      return (
        <GrowthIntelligenceView
          workspace={mos.workspace}
          models={mos.models}
          modelCatalog={mos.modelCatalog}
          onSelectTextModel={(id) => void mos.updateModels({ textModel: id })}
          onConsumeCredits={mos.consumeCredits}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Integrations") {
      return (
        <IntegrationsView
          onOpenWorkspaceHub={() => setWorkspaceHubOpen(true)}
          go={go}
          notify={notify}
        />
      );
    }
    if (page === "Automation Workflows") {
      return (
        <AutomationsView
          workspace={mos.workspace}
          projects={mos.projects}
          runs={mos.automationRuns}
          workflows={mos.workflows}
          workflowExecutions={mos.workflowExecutions}
          models={mos.models}
          onUpdateWorkflows={mos.setWorkflows}
          onUpdateExecutions={mos.setWorkflowExecutions}
          onAddRun={(run) => mos.setAutomationRuns((prev) => [run, ...prev])}
          onSyncProject={(proj) => {
            mos.setProjects((prev) => [proj, ...prev.filter((x) => x.id !== proj.id)]);
            void mos.persistWorkspaceItem({
              id: proj.id,
              kind: "project",
              title: proj.title,
              status: proj.stage,
              sourceType: proj.sourceType,
              creditsUsed: proj.creditsUsed,
              payload: proj as unknown as Record<string, unknown>,
            });
          }}
          onUpsertProject={mos.upsertContentProject}
          onPatchProject={mos.patchContentProject}
          onRefreshPipeline={mos.fetchPipelineEntities}
          onOpenProject={openContentProject}
          onAddProject={(proj) => {
            mos.setProjects((prev) => [proj, ...prev]);
            void mos.persistWorkspaceItem({
              id: proj.id,
              kind: "project",
              title: proj.title,
              status: proj.stage,
              sourceType: proj.sourceType,
              creditsUsed: proj.creditsUsed,
              payload: proj as unknown as Record<string, unknown>,
            });
          }}
          onConsumeCredits={mos.consumeCredits}
          go={go}
          notify={notify}
        />
      );
    }
    return (
      <SettingsView
        workspace={mos.workspace}
        authUser={mos.authUser}
        models={mos.models}
        modelCatalog={mos.modelCatalog}
        geminiConfigured={mos.geminiConfigured}
        creditTransactions={mos.creditTransactions}
        onOpenAuth={() => openAuthModal("signin")}
        onSignOut={handleSignOut}
        onDeleteAccount={mos.deleteAccountFully}
        onRefreshUser={async () => {
          setAuthRefreshTick((t) => t + 1);
        }}
        onUpdateWorkspace={mos.updateWorkspace}
        onUpdateModels={(patch) => void mos.updateModels(patch)}
        notify={notify}
      />
    );
  };

  return (
    <div className={`app ${collapsed ? "is-collapsed" : ""}`}>
      {mobile && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 25, background: "rgba(0,0,0,0.45)" }}
          onClick={() => setMobile(false)}
        />
      )}

      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <div className="brand-row">
          <button className="brand" onClick={() => go("Overview")}>
            <div className="logo-mark">
              <span />
            </div>
            {!collapsed && <b>Marketing OS</b>}
          </button>
          <button
            className="collapse"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? "›" : "‹"}
          </button>
        </div>

        {!collapsed && (
          <div style={{ position: "relative" }}>
            <button
              className="workspace-switch"
              onClick={() => setWsDropdownOpen((o) => !o)}
              type="button"
            >
              <div className="workspace-logo">{wsInitials}</div>
              <span>
                <b>{mos.workspace.name || "Untitled Workspace"}</b>
                <small>
                  {mos.workspace.name ? "Active workspace" : "Empty workspace"}
                </small>
              </span>
              <i>⌄</i>
            </button>

            {wsDropdownOpen && (
              <div className="workspace-dropdown card">
                <small className="ws-drop-label">Switch Business Workspace</small>
                {mos.workspace.name &&
                  !mos.savedWorkspaces.some((w) => w.id === mos.workspace.id) && (
                    <button
                      type="button"
                      className="active"
                      onClick={() => setWsDropdownOpen(false)}
                    >
                      <b>{mos.workspace.name}</b>
                      <small>{mos.workspace.industry || "Current local workspace"}</small>
                    </button>
                  )}
                {mos.savedWorkspaces.map((w) => (
                  <button
                    type="button"
                    key={w.id}
                    className={mos.workspace.id === w.id ? "active" : ""}
                    onClick={() => {
                      mos.switchWorkspace(w);
                      setWsDropdownOpen(false);
                      notify(`Switched to ${w.name}`);
                    }}
                  >
                    <b>{w.name}</b>
                    <small>{w.industry}</small>
                  </button>
                ))}
                <button
                  type="button"
                  className="ws-add-btn"
                  onClick={() => {
                    setWsDropdownOpen(false);
                    setCreatingNewWorkspace(true);
                  }}
                >
                  + Onboard new business
                </button>
              </div>
            )}
          </div>
        )}

        <nav>
          {nav.map((g) => (
            <div className="nav-group" key={g.group}>
              {!collapsed && <label>{g.group}</label>}
              {g.items.map((item) => (
                <button
                  title={item}
                  key={item}
                  className={page === item ? "active" : ""}
                  onClick={() => go(item)}
                >
                  <Icon name={item} />
                  {!collapsed && <span>{item}</span>}
                  {item === "Publishing Queue" && !collapsed && <em>{queuePendingCount}</em>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          {mos.authUser ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
              <button onClick={() => go("Settings")} style={{ flex: 1, minWidth: 0 }}>
                <div className="avatar">{userInitials}</div>
                {!collapsed && (
                  <span>
                    <b>{mos.authUser.displayName || "Signed-in Founder"}</b>
                    <small>
                      {mos.authUser.emailVerified
                        ? mos.authUser.email || "Cloud Sync Active"
                        : "Verify email in Settings"}
                    </small>
                  </span>
                )}
              </button>
              {!collapsed && (
                <button
                  type="button"
                  className="btn ghost"
                  title="Sign out"
                  style={{ height: 28, padding: "0 8px", fontSize: 11, flexShrink: 0 }}
                  onClick={() => void handleSignOut()}
                >
                  Sign out
                </button>
              )}
            </div>
          ) : (
            <button onClick={() => openAuthModal("signup")}>
              <div className="avatar">＋</div>
              {!collapsed && (
                <span>
                  <b>Sign in / Create Account</b>
                  <small>Sync workspaces to Firestore</small>
                </span>
              )}
            </button>
          )}
        </div>
      </aside>

      <div className="shell">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            ☰
          </button>
          <div className="crumb">
            <span>{mos.workspace.name || "Marketing OS"}</span>
            <i>/</i>
            <b>{page}</b>
          </div>

          <button className="global-search" onClick={() => setCommandOpen(true)}>
            <span>⌕</span> Search studios or workflows… <kbd>⌘ K</kbd>
          </button>

          <div className="top-actions">
            {mos.saveStatus !== "idle" && (
              <button
                type="button"
                className={`save-pill ${mos.saveStatus === "saved" ? "ok" : mos.saveStatus === "error" ? "err" : ""}`}
                onClick={() => {
                  if (mos.saveStatus === "error") void mos.retrySaveNow();
                }}
                title={
                  mos.saveStatus === "error"
                    ? "Auto-save failed — click to retry"
                    : "Workspace continuity saved to server"
                }
              >
                {mos.saveStatus === "saving"
                  ? "Saving…"
                  : mos.saveStatus === "saved"
                    ? `Saved${mos.lastSavedAt ? ` · ${mos.lastSavedAt}` : ""}`
                    : "Save failed — retry"}
              </button>
            )}
            <button
              className="btn ghost"
              style={{ height: 30, padding: "0 9px", fontSize: 11 }}
              onClick={() => setLiveVoiceOpen(true)}
              title="Real-time voice brainstorm with Gemini 3.8 Live"
            >
              🎙 Live AI
            </button>
            <button
              className="btn ghost"
              style={{ height: 30, padding: "0 9px", fontSize: 11 }}
              onClick={() => setWorkspaceHubOpen(true)}
              title="Google Workspace Hub (Drive, Docs, Sheets, Calendar, Gmail, Tasks, Chat)"
            >
              Workspace
            </button>
            <div style={{ position: "relative" }}>
              <button
                className="notification"
                type="button"
                aria-label="Notifications"
                title="Workspace notifications"
                style={{
                  border: 0,
                  background: notifOpen ? "var(--surface2)" : "transparent",
                  minWidth: 32,
                  height: 32,
                  borderRadius: 7,
                  display: "grid",
                  placeItems: "center",
                  position: "relative",
                }}
                onClick={() => {
                  const next = !notifOpen;
                  setNotifOpen(next);
                  if (next) void loadNotifications();
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {unreadCount > 0 && <i />}
              </button>
              {notifOpen && (
                <div
                  className="card"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 38,
                    width: 340,
                    maxWidth: "calc(100vw - 24px)",
                    maxHeight: 420,
                    overflowY: "auto",
                    padding: 12,
                    zIndex: 60,
                    boxShadow: "var(--shadow)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <b style={{ fontSize: 12 }}>
                      Notifications {unreadCount > 0 ? `(${unreadCount} unread)` : ""}
                    </b>
                    {notifications.length > 0 && (
                      <button
                        className="btn ghost"
                        style={{ height: 24, padding: "0 8px", fontSize: 10 }}
                        onClick={() => {
                          void apiPost("/api/notifications/read-all", {}).then(() =>
                            loadNotifications(),
                          );
                        }}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  {notifications.length === 0 ? (
                    <p style={{ fontSize: 11, color: "var(--muted)", padding: "8px 0" }}>
                      No workspace notifications yet. Scheduled jobs, video renders, weekly SEO audits, and OAuth events appear here.
                    </p>
                  ) : (
                    <div className="mos-list">
                      {notifications.slice(0, 12).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          className="mos-list-row"
                          style={{
                            textAlign: "left",
                            width: "100%",
                            opacity: n.read ? 0.72 : 1,
                            borderColor: n.read ? "var(--border)" : "var(--mint)",
                          }}
                          onClick={() => {
                            void apiPost(`/api/notifications/${n.id}/read`, {}).then(() =>
                              loadNotifications(),
                            );
                            setNotifOpen(false);
                            if (n.actionPage) {
                              go(n.actionPage as Page);
                            }
                          }}
                        >
                          <span>
                            <b>{n.title}</b>
                            <small>{n.message}</small>
                            <small>{new Date(n.createdAt).toLocaleString()}</small>
                          </span>
                          <span className={`badge ${n.severity === "error" ? "high" : n.severity === "warning" ? "medium" : n.severity === "success" ? "mint" : "blue"}`}>
                            <i />
                            {n.read ? "Read" : "New"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              title="Toggle dark/light theme"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "☼" : "◐"}
            </button>
            {mos.authUser ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  className="top-avatar"
                  title={`Signed in as ${mos.authUser.email || "User"} (open Account Settings)`}
                  onClick={() => go("Settings")}
                  style={
                    !mos.authUser.emailVerified
                      ? { outline: "2px solid var(--gold)", outlineOffset: 1 }
                      : undefined
                  }
                >
                  {userInitials}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ height: 30, padding: "0 8px", fontSize: 11 }}
                  onClick={() => void handleSignOut()}
                  title="Sign out of Marketing OS"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn primary"
                style={{ height: 30, padding: "0 11px", fontSize: 11 }}
                onClick={() => openAuthModal("signin")}
              >
                Sign in
              </button>
            )}
          </div>
        </header>

        <main className="content">
          {mos.authUser && !mos.authUser.emailVerified && (
            <div className="resume-banner" style={{ borderColor: "rgba(255, 198, 92, 0.4)" }}>
              <div>
                <b>Verify your email ({mos.authUser.email})</b>
                <small style={{ display: "block", color: "var(--muted)" }}>
                  Verify your address to unlock full Firestore multi-device workspace sync.
                </small>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    void sendVerificationEmail()
                      .then(() => notify("Verification email resent"))
                      .catch((err) =>
                        notify(err instanceof Error ? err.message : "Could not send verification email"),
                      );
                  }}
                >
                  Resend verification
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    void reloadCurrentUser().then((u) => {
                      setAuthRefreshTick((t) => t + 1);
                      if (u?.emailVerified) notify("Email verified! Cloud sync active.");
                      else notify("Verification not yet detected — check your inbox link.");
                    });
                  }}
                >
                  I&apos;ve verified — Refresh
                </button>
              </div>
            </div>
          )}

          {mos.resumeBanner && mos.resumeBanner.lastPage !== page && (
            <div className="resume-banner">
              <div>
                <b>Continue where you left off: {mos.resumeBanner.lastPage}</b>
                <small style={{ display: "block", color: "var(--muted)" }}>
                  {mos.resumeBanner.scriptTitle
                    ? `Active draft: "${mos.resumeBanner.scriptTitle}" · `
                    : ""}
                  Saved {mos.resumeBanner.savedAt ? new Date(mos.resumeBanner.savedAt).toLocaleString() : "recently"}
                </small>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    const target = mos.resumeBanner?.lastPage || "Overview";
                    mos.dismissResumeBanner();
                    go(target);
                  }}
                >
                  Resume {mos.resumeBanner.lastPage} →
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={mos.dismissResumeBanner}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {renderPage()}
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Mobile Core Studios Navigation">
        {(
          [
            ["Overview", "Overview", "Overview"],
            ["AI Command Center", "AI Hub", "AI Command Center"],
            ["Content Studio", "Studio", "Content Studio"],
            ["Video Editor", "Editor", "Video Editor"],
            ["Analytics", "Analytics", "Analytics"],
          ] as Array<[Page, string, string]>
        ).map(([target, label, iconName]) => (
          <button
            key={target}
            type="button"
            className={page === target ? "active" : ""}
            onClick={() => go(target)}
          >
            <Icon name={iconName} size={18} />
            <span>{label}</span>
          </button>
        ))}
        <button
          type="button"
          className={mobile ? "active" : ""}
          onClick={() => setMobile((m) => !m)}
        >
          <Icon name="Integrations" size={18} />
          <span>More</span>
        </button>
      </nav>

      {toast && <Toast text={toast} />}

      {commandOpen && (
        <CommandPalette
          close={() => setCommandOpen(false)}
          go={go}
          workspaceName={mos.workspace.name || "Marketing OS"}
        />
      )}

      <AuthModal
        open={authModalOpen}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={() => {
          setAuthRefreshTick((t) => t + 1);
          notify("Signed in · workspace sync enabled");
        }}
      />

      <LiveVoiceModal
        open={liveVoiceOpen}
        onClose={() => setLiveVoiceOpen(false)}
        businessName={mos.workspace.name || "Marketing OS"}
        workspaceId={mos.workspace.id}
      />

      <GoogleWorkspaceModal
        open={workspaceHubOpen}
        onClose={() => setWorkspaceHubOpen(false)}
        workspace={mos.workspace}
        competitors={mos.competitors}
        keywords={mos.seoKeywords}
        calendarPosts={mos.calendarPosts}
        notify={notify}
      />
    </div>
  );
}
