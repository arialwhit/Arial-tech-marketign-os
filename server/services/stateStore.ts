import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDataDir } from "../utils/paths.js";

export interface AiRunLogRecord {
  id: string;
  workspaceId: string;
  actorUid: string;
  endpoint: string;
  agent: string;
  provider: string;
  model: string;
  status: "completed" | "failed";
  latencyMs: number;
  creditsEstimated: number;
  error?: string;
  createdAt: string;
}

export interface IntegrationLogRecord {
  id: string;
  workspaceId: string;
  provider: string;
  toolkit: string;
  action: string;
  accountId?: string;
  status: "success" | "error" | "initiated";
  detail: string;
  latencyMs?: number;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  title: string;
  message: string;
  category: "integration" | "publishing" | "video" | "ads" | "billing" | "automation" | "security" | "seo";
  severity: "info" | "success" | "warning" | "error";
  read: boolean;
  actionPage?: string;
  createdAt: string;
}

export interface ScheduledJobRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  title: string;
  platform: string;
  caption: string;
  mediaUrl?: string;
  scheduledForIso: string;
  approvedForAutoPublish: boolean;
  idempotencyKey: string;
  status: "scheduled" | "awaiting_confirmation" | "processing" | "published" | "failed" | "cancelled";
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  providerPostId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoRenderJobRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  title: string;
  aspectRatio: string;
  status: "queued" | "processing" | "completed" | "failed";
  progressPct: number;
  renderUrl?: string;
  filename?: string;
  sizeBytes?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogRecord {
  id: string;
  workspaceId: string;
  actorUid: string;
  action: string;
  target: string;
  status: "allowed" | "denied" | "error";
  detail: string;
  createdAt: string;
}

export interface BillingCheckoutRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  provider: "stripe" | "paystack";
  planOrPack: string;
  amountUsd: number;
  creditsToGrant: number;
  status: "pending" | "completed" | "failed";
  checkoutUrl?: string;
  providerSessionId?: string;
  createdAt: string;
}

export type BackgroundJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "partially_completed"
  | "failed"
  | "cancelled";

export interface BackgroundJobRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  kind:
    | "business_intelligence"
    | "seo_weekly_audit"
    | "channel_analysis"
    | "video_analysis"
    | "media_analysis"
    | "ai_workflow";
  status: BackgroundJobStatus;
  stage: string;
  completedStages: string[];
  pendingStages: string[];
  progressPct: number;
  input: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  failedStage?: string;
  retryCount: number;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiMemoryRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  scope: "user" | "business" | "project" | "conversation";
  source: "verified_business" | "user_provided" | "external_research" | "ai_assumption";
  approved: boolean;
  title: string;
  content: string;
  projectId?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MediaAssetRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  url: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "video" | "image" | "audio" | "document";
  category: string;
  tags: string[];
  description: string;
  aiAnalysis?: {
    summary: string;
    extractedText?: string;
    productFeatures?: string[];
    transcript?: string;
    scenes?: Array<{ timeRange: string; description: string }>;
    visualStyle?: string;
    analyzedAt: string;
    model: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SeoAuditReportRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  websiteUrl: string;
  triggeredBy: "weekly_cron" | "seo_agent" | "manual";
  healthScore: number;
  headline: string;
  summary: string;
  technicalChecks: Array<{
    title: string;
    severity: "High" | "Medium" | "Low";
    passed: boolean;
    why: string;
    fix: string;
  }>;
  issues: Array<{ title: string; severity: "High" | "Medium" | "Low"; why: string; fix: string }>;
  keywords: Array<{ keyword: string; intent: string; difficulty: string; priority: string }>;
  crawled?: Record<string, unknown> | null;
  createdAt: string;
}

export interface WorkspaceSnapshotRecord {
  workspaceId: string;
  ownerUid: string;
  websiteUrl?: string;
  businessName?: string;
  lastPage?: string;
  openProjectId?: string;
  activeScriptTitle?: string;
  activeScriptText?: string;
  videoEditorState?: Record<string, unknown>;
  commandConversations?: Array<Record<string, unknown>>;
  drafts?: Record<string, unknown>;
  savedAt: string;
}

export interface VideoBreakdownRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  title: string;
  sourceUrl?: string;
  mediaAssetId?: string;
  platform: string;
  creatorHandle?: string;
  durationSec?: number;
  hookBreakdown: string;
  pacingSummary: string;
  visualCues: string[];
  audioCues: string[];
  timeline: Array<{
    timestamp: string;
    visualAction: string;
    editingEffect: string;
    audioCue: string;
    transcriptOrText: string;
    confidence: "observed" | "estimated";
  }>;
  repeatableTemplate: {
    hookFormula: string;
    sceneStructure: string[];
    captionStyle: string;
    musicAndAudioFormula: string;
  };
  createdAt: string;
}

export type ContentProjectState =
  | "PLANNED"
  | "SCRIPT_PENDING"
  | "SCRIPT_GENERATING"
  | "SCRIPT_READY"
  | "AWAITING_SCRIPT_APPROVAL"
  | "SCRIPT_APPROVED"
  | "STORYBOARD_READY"
  | "AWAITING_STORYBOARD_APPROVAL"
  | "STORYBOARD_APPROVED"
  | "VIDEO_PENDING"
  | "VIDEO_GENERATING"
  | "VIDEO_READY"
  | "VIDEO_EDITING"
  | "AWAITING_FINAL_APPROVAL"
  | "APPROVED_FOR_PUBLISHING"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "PUBLISH_FAILED"
  | "CANCELLED";

export interface SavedStrategyRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  title: string;
  executiveSummary: string;
  northStarMetric: string;
  icpSegments: Array<{ name: string; painPoint: string; hookAngle: string; channels: string[] }>;
  contentPillars: Array<{ pillar: string; ratio: string; format: string; exampleHook: string }>;
  weeklyRoadmap: Array<{ week: string; focus: string; deliverables: string[] }>;
  experiments: Array<{ name: string; hypothesis: string; metric: string; effort: string }>;
  status: "draft" | "active" | "archived";
  objective?: string;
  targetPlatforms?: string[];
  sourceType: "ai_grounded" | "manual";
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEntryRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  strategyId?: string;
  contentProjectId?: string;
  pillar?: string;
  objective?: string;
  formatType?: "short_form" | "long_form";
  title: string;
  platform: string;
  dateStr: string;
  dayOfMonth: number;
  timeStr: string;
  tone: "mint" | "purple" | "blue" | "gold";
  caption: string;
  status: "Ready" | "Needs review" | "Scheduled" | "Published";
  projectStatus?: ContentProjectState;
  checksPassed: number;
  thumbUrl: string;
  sourceType: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptVersionRecord {
  id: string;
  version: number;
  title: string;
  hook: string;
  body: string;
  cta: string;
  angle: string;
  scenes: Array<{ number: string; timeRange: string; beat: string; visual: string; dialogue: string }>;
  createdAt: string;
  createdBy: string;
  note?: string;
}

export interface StoryboardSceneRecord {
  number: string;
  timeRange: string;
  timestamp?: string;
  durationSec?: number;
  beat: string;
  scriptSection?: string;
  visual: string;
  dialogue: string;
  onScreenText?: string;
  cameraDirection?: string;
  visualComposition?: string;
  presenterRequirement?: string;
  background?: string;
  brollRequirement?: string;
  animationDirection?: string;
  transition?: string;
  soundEffects?: string;
  musicDirection?: string;
  requiredAssets?: string[];
  imagePrompt?: string;
  generatedImageUrl?: string;
}

export interface StoryboardVersionRecord {
  id: string;
  version: number;
  scenes: StoryboardSceneRecord[];
  createdAt: string;
  createdBy: string;
  note?: string;
}

export interface ContentProjectRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  title: string;
  platform: string;
  stage: "Research" | "Script" | "Video editing" | "Quality assurance" | "Awaiting approval" | "Scheduled";
  status: ContentProjectState;
  owner: string;
  progress: number;
  creditsUsed: number;
  strategyId?: string;
  calendarEntryId?: string;
  brief?: string;
  briefConfig?: Record<string, unknown>;
  formatType: "short_form" | "long_form";
  productionMethod: "ai_assisted" | "traditional" | "hybrid";
  thumbUrl?: string;
  script?: string;
  hook?: string;
  cta?: string;
  scriptApproved: boolean;
  scriptApprovedAt?: string;
  scriptVersions: ScriptVersionRecord[];
  scriptVariants: Array<{
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
  storyboardApproved?: boolean;
  storyboardApprovedAt?: string;
  storyboardScenes?: StoryboardSceneRecord[];
  storyboardVersions?: StoryboardVersionRecord[];
  platformAdaptations: Record<string, Record<string, unknown>>;
  videoProductionPlan?: Record<string, unknown>;
  videoUrl?: string;
  editedVideoUrl?: string;
  caption?: string;
  hashtags?: string[];
  qaScore?: number;
  qaHeadline?: string;
  finalApproved: boolean;
  finalApprovedAt?: string;
  scheduledForIso?: string;
  publishError?: string;
  providerPostId?: string;
  sourceType: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsConnectionRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  provider: string;
  providerLabel: string;
  authMode: "api_key" | "service_account" | "google_oauth" | "composio";
  encryptedCredentials: string;
  maskedKeyHint?: string;
  selectedProjectId?: string;
  selectedProjectName?: string;
  hostUrl?: string;
  discoveredProjects?: Array<{ id: string; name: string }>;
  discoveredTables?: Array<{ name: string; columns: string[] }>;
  tableMappings?: Record<string, string | undefined>;
  status: "connected" | "error" | "disconnected";
  completenessStatus: string;
  statusDetail: string;
  lastSyncedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrowthSnapshotRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  connectionId: string;
  provider: string;
  providerLabel: string;
  projectOrProperty: string;
  periodKey: string;
  startDate: string;
  endDate: string;
  completenessStatus: string;
  statusDetail: string;
  metrics: Array<Record<string, unknown>>;
  timeSeries: Array<Record<string, unknown>>;
  topPagesOrEvents: Array<{ name: string; count: number; detail?: string }>;
  channels: Array<Record<string, unknown>>;
  retrievedAt: string;
}

export interface GrowthReportDbRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  cadence: "daily" | "weekly" | "monthly";
  title: string;
  reportingPeriod: { startDate: string; endDate: string };
  executiveSummary: string;
  providerHighlights: Array<{ provider: string; status: string; keyFindings: string[] }>;
  recommendations: string[];
  markdown: string;
  createdAt: string;
}

export interface PresenterPresetRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  name: string;
  role: string;
  avatarKind: "uploaded_photo" | "talking_head_clip" | "ai_generated_avatar";
  mediaUrl: string;
  voiceName: string;
  styleNotes: string;
  consentConfirmed: boolean;
  consentOwner?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationWorkflowRecord {
  id: string;
  workspaceId: string;
  ownerUid: string;
  name: string;
  description: string;
  triggerType: "manual" | "interval" | "event";
  intervalMinutes?: number;
  conditionMinQaScore?: number;
  requireHumanApproval: boolean;
  retryLimit: number;
  enabled: boolean;
  confirmedToActivate: boolean;
  nlPrompt?: string;
  nodes: Array<{ id: string; type: "trigger" | "condition" | "action" | "approval_gate"; label: string; config: Record<string, unknown> }>;
  lastRunAt?: string;
  lastStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationExecutionLogRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  workspaceId: string;
  ownerUid: string;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "awaiting_approval" | "skipped_condition" | "failed";
  attempts: number;
  stepLogs: Array<{ nodeId: string; label: string; status: "ok" | "skipped" | "paused" | "error"; detail: string }>;
  summary: string;
  projectId?: string;
  projectTitle?: string;
  projectStatus?: ContentProjectState;
}

export function mapProjectStateToStage(
  state: ContentProjectState,
): ContentProjectRecord["stage"] {
  switch (state) {
    case "PLANNED":
      return "Research";
    case "SCRIPT_PENDING":
    case "SCRIPT_GENERATING":
    case "SCRIPT_READY":
    case "AWAITING_SCRIPT_APPROVAL":
    case "SCRIPT_APPROVED":
    case "STORYBOARD_READY":
    case "AWAITING_STORYBOARD_APPROVAL":
      return "Script";
    case "STORYBOARD_APPROVED":
    case "VIDEO_PENDING":
    case "VIDEO_GENERATING":
    case "VIDEO_READY":
    case "VIDEO_EDITING":
      return "Video editing";
    case "AWAITING_FINAL_APPROVAL":
      return "Awaiting approval";
    case "APPROVED_FOR_PUBLISHING":
    case "SCHEDULED":
    case "PUBLISHING":
    case "PUBLISHED":
    case "PUBLISH_FAILED":
    case "CANCELLED":
      return "Scheduled";
  }
}

export function mapProjectStateToProgress(state: ContentProjectState): number {
  const map: Record<ContentProjectState, number> = {
    PLANNED: 10,
    SCRIPT_PENDING: 18,
    SCRIPT_GENERATING: 24,
    SCRIPT_READY: 35,
    AWAITING_SCRIPT_APPROVAL: 40,
    SCRIPT_APPROVED: 45,
    STORYBOARD_READY: 48,
    AWAITING_STORYBOARD_APPROVAL: 51,
    STORYBOARD_APPROVED: 54,
    VIDEO_PENDING: 58,
    VIDEO_GENERATING: 65,
    VIDEO_READY: 72,
    VIDEO_EDITING: 78,
    AWAITING_FINAL_APPROVAL: 86,
    APPROVED_FOR_PUBLISHING: 92,
    SCHEDULED: 95,
    PUBLISHING: 97,
    PUBLISHED: 100,
    PUBLISH_FAILED: 90,
    CANCELLED: 0,
  };
  return map[state] ?? 10;
}

interface ServerStateSchema {
  workspaceOwners: Record<string, string>;
  workspaceSnapshots: Record<string, WorkspaceSnapshotRecord>;
  strategies: SavedStrategyRecord[];
  calendarEntries: CalendarEntryRecord[];
  contentProjects: ContentProjectRecord[];
  presenters: PresenterPresetRecord[];
  workflows: AutomationWorkflowRecord[];
  workflowExecutions: AutomationExecutionLogRecord[];
  backgroundJobs: BackgroundJobRecord[];
  aiMemories: AiMemoryRecord[];
  mediaLibrary: MediaAssetRecord[];
  seoAuditReports: SeoAuditReportRecord[];
  videoBreakdowns: VideoBreakdownRecord[];
  aiRuns: AiRunLogRecord[];
  integrationLogs: IntegrationLogRecord[];
  notifications: NotificationRecord[];
  scheduledJobs: ScheduledJobRecord[];
  videoJobs: VideoRenderJobRecord[];
  auditLogs: AuditLogRecord[];
  billingRecords: BillingCheckoutRecord[];
  analyticsConnections: AnalyticsConnectionRecord[];
  growthSnapshots: GrowthSnapshotRecord[];
  growthReports: GrowthReportDbRecord[];
  integrationRecommendationsByWs: Record<string, Array<Record<string, unknown>>>;
  idempotencyCache: Record<string, { status: "completed" | "processing"; result: unknown; createdAt: string }>;
}

const DATA_DIR = getDataDir();
const STATE_FILE = path.join(DATA_DIR, "marketing-os-state.json");

function defaultState(): ServerStateSchema {
  return {
    workspaceOwners: {},
    workspaceSnapshots: {},
    strategies: [],
    calendarEntries: [],
    contentProjects: [],
    presenters: [],
    workflows: [],
    workflowExecutions: [],
    backgroundJobs: [],
    aiMemories: [],
    mediaLibrary: [],
    seoAuditReports: [],
    videoBreakdowns: [],
    aiRuns: [],
    integrationLogs: [],
    notifications: [],
    scheduledJobs: [],
    videoJobs: [],
    auditLogs: [],
    billingRecords: [],
    analyticsConnections: [],
    growthSnapshots: [],
    growthReports: [],
    integrationRecommendationsByWs: {},
    idempotencyCache: {},
  };
}

class ServerStateStore {
  private state: ServerStateSchema;

  constructor() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (err) {
      console.warn("State dir init warning:", err);
    }
    this.state = this.loadFromDisk();
  }

  private loadFromDisk(): ServerStateSchema {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, "utf8");
        const parsed = JSON.parse(raw) as Partial<ServerStateSchema>;
        return { ...defaultState(), ...parsed };
      }
    } catch (err) {
      console.error("Failed to read server state file, starting fresh:", err);
    }
    return defaultState();
  }

  private save(): void {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${STATE_FILE}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, STATE_FILE);
    } catch (err) {
      console.error("Failed to persist server state:", err);
    }
  }

  public newId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  }

  // Workspace ownership isolation
  public getWorkspaceOwner(workspaceId: string): string | null {
    return this.state.workspaceOwners[workspaceId] || null;
  }

  public claimOrVerifyWorkspaceOwner(workspaceId: string, uid: string): boolean {
    if (!workspaceId || workspaceId === "default" || !uid || uid === "anonymous") return true;
    const current = this.state.workspaceOwners[workspaceId];
    if (!current) {
      this.state.workspaceOwners[workspaceId] = uid;
      this.save();
      return true;
    }
    return current === uid;
  }

  // Workspace snapshots & continuity
  public upsertWorkspaceSnapshot(
    workspaceId: string,
    ownerUid: string,
    patch: Partial<WorkspaceSnapshotRecord>,
  ): WorkspaceSnapshotRecord {
    const existing = this.state.workspaceSnapshots[workspaceId];
    const next: WorkspaceSnapshotRecord = {
      ...(existing || { workspaceId, ownerUid }),
      ...patch,
      workspaceId,
      ownerUid: ownerUid !== "anonymous" ? ownerUid : existing?.ownerUid || "anonymous",
      savedAt: new Date().toISOString(),
    };
    this.state.workspaceSnapshots[workspaceId] = next;
    this.save();
    return next;
  }

  public getWorkspaceSnapshot(workspaceId: string): WorkspaceSnapshotRecord | null {
    return this.state.workspaceSnapshots[workspaceId] || null;
  }

  public listWorkspaceSnapshotsWithWebsite(): WorkspaceSnapshotRecord[] {
    return Object.values(this.state.workspaceSnapshots).filter((s) => Boolean(s.websiteUrl?.trim()));
  }

  // Durable Background Jobs
  public createBackgroundJob(
    entry: Omit<BackgroundJobRecord, "id" | "createdAt" | "updatedAt">,
  ): BackgroundJobRecord {
    const now = new Date().toISOString();
    const rec: BackgroundJobRecord = {
      id: this.newId("bgjob"),
      createdAt: now,
      updatedAt: now,
      ...entry,
    };
    this.state.backgroundJobs.unshift(rec);
    this.state.backgroundJobs = this.state.backgroundJobs.slice(0, 200);
    this.save();
    return rec;
  }

  public getBackgroundJobById(id: string): BackgroundJobRecord | null {
    return this.state.backgroundJobs.find((j) => j.id === id) || null;
  }

  public getBackgroundJobs(workspaceId?: string): BackgroundJobRecord[] {
    return workspaceId
      ? this.state.backgroundJobs.filter((j) => j.workspaceId === workspaceId)
      : this.state.backgroundJobs;
  }

  public updateBackgroundJob(
    id: string,
    patch: Partial<BackgroundJobRecord>,
  ): BackgroundJobRecord | null {
    const found = this.state.backgroundJobs.find((j) => j.id === id);
    if (!found) return null;
    Object.assign(found, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return found;
  }

  // Structured Persistent AI Memory
  public listMemories(workspaceId: string, scope?: string): AiMemoryRecord[] {
    return this.state.aiMemories.filter(
      (m) => m.workspaceId === workspaceId && (!scope || m.scope === scope),
    );
  }

  public addMemory(
    entry: Omit<AiMemoryRecord, "id" | "createdAt" | "updatedAt">,
  ): AiMemoryRecord {
    const now = new Date().toISOString();
    const rec: AiMemoryRecord = {
      id: this.newId("mem"),
      createdAt: now,
      updatedAt: now,
      ...entry,
    };
    this.state.aiMemories.unshift(rec);
    this.state.aiMemories = this.state.aiMemories.slice(0, 500);
    this.save();
    return rec;
  }

  public updateMemory(id: string, workspaceId: string, patch: Partial<AiMemoryRecord>): AiMemoryRecord | null {
    const found = this.state.aiMemories.find((m) => m.id === id && m.workspaceId === workspaceId);
    if (!found) return null;
    Object.assign(found, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return found;
  }

  public deleteMemory(id: string, workspaceId: string): boolean {
    const before = this.state.aiMemories.length;
    this.state.aiMemories = this.state.aiMemories.filter(
      (m) => !(m.id === id && m.workspaceId === workspaceId),
    );
    if (this.state.aiMemories.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  // Media Library Metadata Registry
  public listMediaAssets(workspaceId: string): MediaAssetRecord[] {
    return this.state.mediaLibrary.filter((m) => m.workspaceId === workspaceId);
  }

  public getMediaAssetById(id: string, workspaceId?: string): MediaAssetRecord | null {
    return (
      this.state.mediaLibrary.find(
        (m) => m.id === id && (!workspaceId || m.workspaceId === workspaceId),
      ) || null
    );
  }

  public addMediaAsset(
    entry: Omit<MediaAssetRecord, "id" | "createdAt" | "updatedAt">,
  ): MediaAssetRecord {
    const now = new Date().toISOString();
    const rec: MediaAssetRecord = {
      id: this.newId("media"),
      createdAt: now,
      updatedAt: now,
      ...entry,
    };
    this.state.mediaLibrary.unshift(rec);
    this.state.mediaLibrary = this.state.mediaLibrary.slice(0, 600);
    this.save();
    return rec;
  }

  public updateMediaAsset(
    id: string,
    workspaceId: string,
    patch: Partial<MediaAssetRecord>,
  ): MediaAssetRecord | null {
    const found = this.state.mediaLibrary.find((m) => m.id === id && m.workspaceId === workspaceId);
    if (!found) return null;
    Object.assign(found, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return found;
  }

  public deleteMediaAsset(id: string, workspaceId: string): MediaAssetRecord | null {
    const idx = this.state.mediaLibrary.findIndex((m) => m.id === id && m.workspaceId === workspaceId);
    if (idx === -1) return null;
    const [removed] = this.state.mediaLibrary.splice(idx, 1);
    this.save();
    return removed;
  }

  // Weekly Technical SEO Audit Reports
  public addSeoAuditReport(entry: Omit<SeoAuditReportRecord, "id" | "createdAt">): SeoAuditReportRecord {
    const rec: SeoAuditReportRecord = {
      id: this.newId("seo"),
      createdAt: new Date().toISOString(),
      ...entry,
    };
    this.state.seoAuditReports.unshift(rec);
    this.state.seoAuditReports = this.state.seoAuditReports.slice(0, 120);
    this.save();
    return rec;
  }

  public getSeoAuditReports(workspaceId: string): SeoAuditReportRecord[] {
    return this.state.seoAuditReports.filter((r) => r.workspaceId === workspaceId);
  }

  // Video Breakdowns & Reference Intelligence
  public addVideoBreakdown(entry: Omit<VideoBreakdownRecord, "id" | "createdAt">): VideoBreakdownRecord {
    const rec: VideoBreakdownRecord = {
      id: this.newId("vb"),
      createdAt: new Date().toISOString(),
      ...entry,
    };
    this.state.videoBreakdowns.unshift(rec);
    this.state.videoBreakdowns = this.state.videoBreakdowns.slice(0, 150);
    this.save();
    return rec;
  }

  public listVideoBreakdowns(workspaceId: string): VideoBreakdownRecord[] {
    return this.state.videoBreakdowns.filter((b) => b.workspaceId === workspaceId);
  }

  // Strategies CRUD
  public listStrategies(workspaceId: string): SavedStrategyRecord[] {
    return this.state.strategies.filter((s) => s.workspaceId === workspaceId);
  }

  public getStrategyById(id: string, workspaceId?: string): SavedStrategyRecord | null {
    return (
      this.state.strategies.find(
        (s) => s.id === id && (!workspaceId || s.workspaceId === workspaceId),
      ) || null
    );
  }

  public upsertStrategy(
    record: Omit<SavedStrategyRecord, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): SavedStrategyRecord {
    const now = new Date().toISOString();
    if (record.id) {
      const idx = this.state.strategies.findIndex(
        (s) => s.id === record.id && s.workspaceId === record.workspaceId,
      );
      if (idx !== -1) {
        const next: SavedStrategyRecord = {
          ...this.state.strategies[idx],
          ...record,
          updatedAt: now,
        };
        this.state.strategies[idx] = next;
        this.save();
        return next;
      }
    }
    const created: SavedStrategyRecord = {
      ...record,
      id: record.id || this.newId("strat"),
      createdAt: now,
      updatedAt: now,
    };
    this.state.strategies.unshift(created);
    this.state.strategies = this.state.strategies.slice(0, 120);
    this.save();
    return created;
  }

  public deleteStrategy(id: string, workspaceId: string): boolean {
    const before = this.state.strategies.length;
    this.state.strategies = this.state.strategies.filter(
      (s) => !(s.id === id && s.workspaceId === workspaceId),
    );
    if (this.state.strategies.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  // Content Calendar Entries CRUD
  public listCalendarEntries(workspaceId: string): CalendarEntryRecord[] {
    return this.state.calendarEntries.filter((c) => c.workspaceId === workspaceId);
  }

  public getCalendarEntryById(id: string, workspaceId?: string): CalendarEntryRecord | null {
    return (
      this.state.calendarEntries.find(
        (c) => c.id === id && (!workspaceId || c.workspaceId === workspaceId),
      ) || null
    );
  }

  public upsertCalendarEntry(
    entry: Omit<CalendarEntryRecord, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): CalendarEntryRecord {
    const now = new Date().toISOString();
    if (entry.id) {
      const idx = this.state.calendarEntries.findIndex(
        (c) => c.id === entry.id && c.workspaceId === entry.workspaceId,
      );
      if (idx !== -1) {
        const next: CalendarEntryRecord = {
          ...this.state.calendarEntries[idx],
          ...entry,
          updatedAt: now,
        };
        this.state.calendarEntries[idx] = next;
        this.save();
        return next;
      }
    }
    const created: CalendarEntryRecord = {
      ...entry,
      id: entry.id || this.newId("cal"),
      createdAt: now,
      updatedAt: now,
    };
    this.state.calendarEntries.unshift(created);
    this.state.calendarEntries = this.state.calendarEntries.slice(0, 300);
    this.save();
    return created;
  }

  public deleteCalendarEntry(id: string, workspaceId: string): boolean {
    const before = this.state.calendarEntries.length;
    this.state.calendarEntries = this.state.calendarEntries.filter(
      (c) => !(c.id === id && c.workspaceId === workspaceId),
    );
    if (this.state.calendarEntries.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  // Content Projects & 17-State Pipeline
  public listContentProjects(workspaceId: string): ContentProjectRecord[] {
    return this.state.contentProjects.filter((p) => p.workspaceId === workspaceId);
  }

  public getContentProjectById(id: string, workspaceId?: string): ContentProjectRecord | null {
    return (
      this.state.contentProjects.find(
        (p) => p.id === id && (!workspaceId || p.workspaceId === workspaceId),
      ) || null
    );
  }

  public upsertContentProject(
    proj: Partial<ContentProjectRecord> & { workspaceId: string; ownerUid: string; title: string },
  ): ContentProjectRecord {
    const now = new Date().toISOString();
    if (proj.id) {
      const idx = this.state.contentProjects.findIndex(
        (p) => p.id === proj.id && p.workspaceId === proj.workspaceId,
      );
      if (idx !== -1) {
        const existing = this.state.contentProjects[idx];
        const status = proj.status || existing.status || "PLANNED";
        const next: ContentProjectRecord = {
          ...existing,
          ...proj,
          status,
          stage: proj.stage || mapProjectStateToStage(status),
          progress: proj.progress ?? mapProjectStateToProgress(status),
          updatedAt: now,
        };
        this.state.contentProjects[idx] = next;
        this.save();
        return next;
      }
    }
    const status: ContentProjectState = proj.status || "PLANNED";
    const created: ContentProjectRecord = {
      platform: "Instagram Reels",
      owner: "Workspace Owner",
      creditsUsed: 0,
      formatType: "short_form",
      productionMethod: "hybrid",
      scriptApproved: false,
      scriptVersions: [],
      scriptVariants: [],
      platformAdaptations: {},
      finalApproved: false,
      sourceType: "manual",
      ...proj,
      id: proj.id || this.newId("proj"),
      status,
      stage: proj.stage || mapProjectStateToStage(status),
      progress: proj.progress ?? mapProjectStateToProgress(status),
      createdAt: now,
      updatedAt: now,
    };
    this.state.contentProjects.unshift(created);
    this.state.contentProjects = this.state.contentProjects.slice(0, 300);
    this.save();
    return created;
  }

  public deleteContentProject(id: string, workspaceId: string): boolean {
    const before = this.state.contentProjects.length;
    this.state.contentProjects = this.state.contentProjects.filter(
      (p) => !(p.id === id && p.workspaceId === workspaceId),
    );
    if (this.state.contentProjects.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  // Presenter Presets CRUD
  public listPresenters(workspaceId: string): PresenterPresetRecord[] {
    return this.state.presenters.filter((p) => p.workspaceId === workspaceId);
  }

  public upsertPresenter(
    entry: Omit<PresenterPresetRecord, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): PresenterPresetRecord {
    const now = new Date().toISOString();
    if (entry.id) {
      const idx = this.state.presenters.findIndex(
        (p) => p.id === entry.id && p.workspaceId === entry.workspaceId,
      );
      if (idx !== -1) {
        const next: PresenterPresetRecord = {
          ...this.state.presenters[idx],
          ...entry,
          updatedAt: now,
        };
        this.state.presenters[idx] = next;
        this.save();
        return next;
      }
    }
    const created: PresenterPresetRecord = {
      ...entry,
      id: entry.id || this.newId("pres"),
      createdAt: now,
      updatedAt: now,
    };
    this.state.presenters.unshift(created);
    this.save();
    return created;
  }

  public deletePresenter(id: string, workspaceId: string): boolean {
    const before = this.state.presenters.length;
    this.state.presenters = this.state.presenters.filter(
      (p) => !(p.id === id && p.workspaceId === workspaceId),
    );
    if (this.state.presenters.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  // Automation Workflows & Execution Logs
  public listWorkflows(workspaceId?: string): AutomationWorkflowRecord[] {
    return workspaceId
      ? this.state.workflows.filter((w) => w.workspaceId === workspaceId)
      : this.state.workflows;
  }

  public getWorkflowById(id: string, workspaceId?: string): AutomationWorkflowRecord | null {
    return (
      this.state.workflows.find(
        (w) => w.id === id && (!workspaceId || w.workspaceId === workspaceId),
      ) || null
    );
  }

  public upsertWorkflow(
    entry: Omit<AutomationWorkflowRecord, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): AutomationWorkflowRecord {
    const now = new Date().toISOString();
    if (entry.id) {
      const idx = this.state.workflows.findIndex(
        (w) => w.id === entry.id && w.workspaceId === entry.workspaceId,
      );
      if (idx !== -1) {
        const next: AutomationWorkflowRecord = {
          ...this.state.workflows[idx],
          ...entry,
          updatedAt: now,
        };
        this.state.workflows[idx] = next;
        this.save();
        return next;
      }
    }
    const created: AutomationWorkflowRecord = {
      ...entry,
      id: entry.id || this.newId("wf"),
      createdAt: now,
      updatedAt: now,
    };
    this.state.workflows.unshift(created);
    this.state.workflows = this.state.workflows.slice(0, 120);
    this.save();
    return created;
  }

  public deleteWorkflow(id: string, workspaceId: string): boolean {
    const before = this.state.workflows.length;
    this.state.workflows = this.state.workflows.filter(
      (w) => !(w.id === id && w.workspaceId === workspaceId),
    );
    if (this.state.workflows.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  public addWorkflowExecution(
    entry: Omit<AutomationExecutionLogRecord, "id">,
  ): AutomationExecutionLogRecord {
    const rec: AutomationExecutionLogRecord = {
      id: this.newId("wfexec"),
      ...entry,
    };
    this.state.workflowExecutions.unshift(rec);
    this.state.workflowExecutions = this.state.workflowExecutions.slice(0, 300);
    this.save();
    return rec;
  }

  public listWorkflowExecutions(workspaceId: string, workflowId?: string): AutomationExecutionLogRecord[] {
    return this.state.workflowExecutions.filter(
      (e) => e.workspaceId === workspaceId && (!workflowId || e.workflowId === workflowId),
    );
  }

  // Account Deletion Server Data Purge
  public purgeUserData(ownerUid: string): number {
    if (!ownerUid || ownerUid === "anonymous") return 0;
    const ownedWorkspaces = Object.entries(this.state.workspaceOwners)
      .filter(([, uid]) => uid === ownerUid)
      .map(([wsId]) => wsId);

    for (const wsId of ownedWorkspaces) {
      delete this.state.workspaceOwners[wsId];
      delete this.state.workspaceSnapshots[wsId];
      delete this.state.integrationRecommendationsByWs[wsId];
    }
    this.state.strategies = this.state.strategies.filter((s) => s.ownerUid !== ownerUid);
    this.state.calendarEntries = this.state.calendarEntries.filter((c) => c.ownerUid !== ownerUid);
    this.state.contentProjects = this.state.contentProjects.filter((p) => p.ownerUid !== ownerUid);
    this.state.presenters = this.state.presenters.filter((p) => p.ownerUid !== ownerUid);
    this.state.workflows = this.state.workflows.filter((w) => w.ownerUid !== ownerUid);
    this.state.workflowExecutions = this.state.workflowExecutions.filter((e) => e.ownerUid !== ownerUid);
    this.state.backgroundJobs = this.state.backgroundJobs.filter((j) => j.ownerUid !== ownerUid);
    this.state.aiMemories = this.state.aiMemories.filter((m) => m.ownerUid !== ownerUid);
    this.state.mediaLibrary = this.state.mediaLibrary.filter((m) => m.ownerUid !== ownerUid);
    this.state.seoAuditReports = this.state.seoAuditReports.filter((r) => r.ownerUid !== ownerUid);
    this.state.videoBreakdowns = this.state.videoBreakdowns.filter((v) => v.ownerUid !== ownerUid);
    this.state.notifications = this.state.notifications.filter((n) => n.ownerUid !== ownerUid);
    this.state.scheduledJobs = this.state.scheduledJobs.filter((j) => j.ownerUid !== ownerUid);
    this.state.analyticsConnections = this.state.analyticsConnections.filter((c) => c.ownerUid !== ownerUid);
    this.state.growthSnapshots = this.state.growthSnapshots.filter((g) => g.ownerUid !== ownerUid);
    this.state.growthReports = this.state.growthReports.filter((r) => r.ownerUid !== ownerUid);
    this.save();
    return ownedWorkspaces.length;
  }

  // Encrypted Analytics Provider Connections & Growth Intelligence Storage
  public listAnalyticsConnections(workspaceId: string): AnalyticsConnectionRecord[] {
    return this.state.analyticsConnections.filter((c) => c.workspaceId === workspaceId);
  }

  public getAnalyticsConnectionById(id: string, workspaceId?: string): AnalyticsConnectionRecord | null {
    return (
      this.state.analyticsConnections.find(
        (c) => c.id === id && (!workspaceId || c.workspaceId === workspaceId),
      ) || null
    );
  }

  public upsertAnalyticsConnection(
    entry: Omit<AnalyticsConnectionRecord, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): AnalyticsConnectionRecord {
    const now = new Date().toISOString();
    if (entry.id) {
      const idx = this.state.analyticsConnections.findIndex(
        (c) => c.id === entry.id && c.workspaceId === entry.workspaceId,
      );
      if (idx !== -1) {
        const next: AnalyticsConnectionRecord = {
          ...this.state.analyticsConnections[idx],
          ...entry,
          updatedAt: now,
        };
        this.state.analyticsConnections[idx] = next;
        this.save();
        return next;
      }
    }
    const existingByProvider = this.state.analyticsConnections.findIndex(
      (c) => c.workspaceId === entry.workspaceId && c.provider === entry.provider,
    );
    if (existingByProvider !== -1) {
      const next: AnalyticsConnectionRecord = {
        ...this.state.analyticsConnections[existingByProvider],
        ...entry,
        updatedAt: now,
      };
      this.state.analyticsConnections[existingByProvider] = next;
      this.save();
      return next;
    }
    const created: AnalyticsConnectionRecord = {
      ...entry,
      id: entry.id || this.newId("aconn"),
      createdAt: now,
      updatedAt: now,
    };
    this.state.analyticsConnections.unshift(created);
    this.save();
    return created;
  }

  public deleteAnalyticsConnection(id: string, workspaceId: string): boolean {
    const before = this.state.analyticsConnections.length;
    this.state.analyticsConnections = this.state.analyticsConnections.filter(
      (c) => !(c.id === id && c.workspaceId === workspaceId),
    );
    this.state.growthSnapshots = this.state.growthSnapshots.filter(
      (s) => !(s.connectionId === id && s.workspaceId === workspaceId),
    );
    if (this.state.analyticsConnections.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  public saveGrowthSnapshot(
    entry: Omit<GrowthSnapshotRecord, "id">,
  ): GrowthSnapshotRecord {
    const idx = this.state.growthSnapshots.findIndex(
      (s) =>
        s.workspaceId === entry.workspaceId &&
        s.connectionId === entry.connectionId &&
        s.periodKey === entry.periodKey,
    );
    if (idx !== -1) {
      const next: GrowthSnapshotRecord = { ...entry, id: this.state.growthSnapshots[idx].id };
      this.state.growthSnapshots[idx] = next;
      this.save();
      return next;
    }
    const created: GrowthSnapshotRecord = { id: this.newId("gsnap"), ...entry };
    this.state.growthSnapshots.unshift(created);
    this.state.growthSnapshots = this.state.growthSnapshots.slice(0, 400);
    this.save();
    return created;
  }

  public listGrowthSnapshots(workspaceId: string, periodKey?: string): GrowthSnapshotRecord[] {
    return this.state.growthSnapshots.filter(
      (s) => s.workspaceId === workspaceId && (!periodKey || s.periodKey === periodKey),
    );
  }

  public addGrowthReport(entry: Omit<GrowthReportDbRecord, "id" | "createdAt">): GrowthReportDbRecord {
    const created: GrowthReportDbRecord = {
      id: this.newId("grep"),
      createdAt: new Date().toISOString(),
      ...entry,
    };
    this.state.growthReports.unshift(created);
    this.state.growthReports = this.state.growthReports.slice(0, 120);
    this.save();
    return created;
  }

  public listGrowthReports(workspaceId: string): GrowthReportDbRecord[] {
    return this.state.growthReports.filter((r) => r.workspaceId === workspaceId);
  }

  public setIntegrationRecommendations(
    workspaceId: string,
    items: Array<Record<string, unknown>>,
  ): void {
    this.state.integrationRecommendationsByWs[workspaceId] = items;
    this.save();
  }

  public getIntegrationRecommendations(workspaceId: string): Array<Record<string, unknown>> {
    return this.state.integrationRecommendationsByWs[workspaceId] || [];
  }

  public addAiRun(entry: Omit<AiRunLogRecord, "id" | "createdAt">): AiRunLogRecord {
    const rec: AiRunLogRecord = {
      id: this.newId("airun"),
      createdAt: new Date().toISOString(),
      ...entry,
    };
    this.state.aiRuns.unshift(rec);
    this.state.aiRuns = this.state.aiRuns.slice(0, 250);
    this.save();
    return rec;
  }

  public getAiRuns(workspaceId?: string): AiRunLogRecord[] {
    return workspaceId
      ? this.state.aiRuns.filter((r) => r.workspaceId === workspaceId || r.workspaceId === "default")
      : this.state.aiRuns;
  }

  public addIntegrationLog(entry: Omit<IntegrationLogRecord, "id" | "createdAt">): IntegrationLogRecord {
    const rec: IntegrationLogRecord = {
      id: this.newId("intlog"),
      createdAt: new Date().toISOString(),
      ...entry,
    };
    this.state.integrationLogs.unshift(rec);
    this.state.integrationLogs = this.state.integrationLogs.slice(0, 200);
    this.save();
    return rec;
  }

  public getIntegrationLogs(workspaceId?: string): IntegrationLogRecord[] {
    return workspaceId
      ? this.state.integrationLogs.filter((l) => l.workspaceId === workspaceId || l.workspaceId === "default")
      : this.state.integrationLogs;
  }

  public addNotification(entry: Omit<NotificationRecord, "id" | "createdAt" | "read">): NotificationRecord {
    const rec: NotificationRecord = {
      id: this.newId("notif"),
      read: false,
      createdAt: new Date().toISOString(),
      ...entry,
    };
    this.state.notifications.unshift(rec);
    this.state.notifications = this.state.notifications.slice(0, 150);
    this.save();
    return rec;
  }

  public getNotifications(workspaceId?: string): NotificationRecord[] {
    return workspaceId
      ? this.state.notifications.filter((n) => n.workspaceId === workspaceId || n.workspaceId === "default")
      : this.state.notifications;
  }

  public markNotificationRead(id: string): NotificationRecord | null {
    const found = this.state.notifications.find((n) => n.id === id);
    if (!found) return null;
    found.read = true;
    this.save();
    return found;
  }

  public markAllNotificationsRead(workspaceId?: string): number {
    let changed = 0;
    for (const n of this.state.notifications) {
      if ((!workspaceId || n.workspaceId === workspaceId || n.workspaceId === "default") && !n.read) {
        n.read = true;
        changed++;
      }
    }
    if (changed > 0) this.save();
    return changed;
  }

  public addScheduledJob(
    entry: Omit<ScheduledJobRecord, "id" | "createdAt" | "updatedAt" | "attempts" | "maxAttempts">,
  ): ScheduledJobRecord {
    const now = new Date().toISOString();
    const rec: ScheduledJobRecord = {
      id: this.newId("job"),
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
      ...entry,
    };
    this.state.scheduledJobs.unshift(rec);
    this.state.scheduledJobs = this.state.scheduledJobs.slice(0, 200);
    this.save();
    return rec;
  }

  public getScheduledJobs(workspaceId?: string): ScheduledJobRecord[] {
    return workspaceId
      ? this.state.scheduledJobs.filter((j) => j.workspaceId === workspaceId)
      : this.state.scheduledJobs;
  }

  public updateScheduledJob(id: string, patch: Partial<ScheduledJobRecord>): ScheduledJobRecord | null {
    const found = this.state.scheduledJobs.find((j) => j.id === id);
    if (!found) return null;
    Object.assign(found, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return found;
  }

  public createVideoJob(entry: Omit<VideoRenderJobRecord, "id" | "createdAt" | "updatedAt">): VideoRenderJobRecord {
    const now = new Date().toISOString();
    const rec: VideoRenderJobRecord = {
      id: this.newId("vidjob"),
      createdAt: now,
      updatedAt: now,
      ...entry,
    };
    this.state.videoJobs.unshift(rec);
    this.state.videoJobs = this.state.videoJobs.slice(0, 100);
    this.save();
    return rec;
  }

  public updateVideoJob(id: string, patch: Partial<VideoRenderJobRecord>): VideoRenderJobRecord | null {
    const found = this.state.videoJobs.find((j) => j.id === id);
    if (!found) return null;
    Object.assign(found, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return found;
  }

  public getVideoJobs(workspaceId?: string): VideoRenderJobRecord[] {
    return workspaceId
      ? this.state.videoJobs.filter((j) => j.workspaceId === workspaceId || j.workspaceId === "default")
      : this.state.videoJobs;
  }

  public getVideoJobById(id: string): VideoRenderJobRecord | null {
    return this.state.videoJobs.find((j) => j.id === id) || null;
  }

  public addAuditLog(entry: Omit<AuditLogRecord, "id" | "createdAt">): AuditLogRecord {
    const rec: AuditLogRecord = {
      id: this.newId("audit"),
      createdAt: new Date().toISOString(),
      ...entry,
    };
    this.state.auditLogs.unshift(rec);
    this.state.auditLogs = this.state.auditLogs.slice(0, 300);
    this.save();
    return rec;
  }

  public getAuditLogs(workspaceId?: string): AuditLogRecord[] {
    return workspaceId
      ? this.state.auditLogs.filter((a) => a.workspaceId === workspaceId || a.workspaceId === "default")
      : this.state.auditLogs;
  }

  public addBillingRecord(entry: Omit<BillingCheckoutRecord, "id" | "createdAt">): BillingCheckoutRecord {
    const rec: BillingCheckoutRecord = {
      id: this.newId("bill"),
      createdAt: new Date().toISOString(),
      ...entry,
    };
    this.state.billingRecords.unshift(rec);
    this.state.billingRecords = this.state.billingRecords.slice(0, 100);
    this.save();
    return rec;
  }

  public getBillingRecords(workspaceId?: string): BillingCheckoutRecord[] {
    return workspaceId
      ? this.state.billingRecords.filter((b) => b.workspaceId === workspaceId)
      : this.state.billingRecords;
  }

  public getIdempotentResult(key: string): { status: "completed" | "processing"; result: unknown } | null {
    if (!key) return null;
    return this.state.idempotencyCache[key] || null;
  }

  public setIdempotentResult(key: string, status: "completed" | "processing", result: unknown): void {
    if (!key) return;
    this.state.idempotencyCache[key] = { status, result, createdAt: new Date().toISOString() };
    const keys = Object.keys(this.state.idempotencyCache);
    if (keys.length > 500) {
      for (const oldKey of keys.slice(0, keys.length - 400)) {
        delete this.state.idempotencyCache[oldKey];
      }
    }
    this.save();
  }
}

export const stateStore = new ServerStateStore();
