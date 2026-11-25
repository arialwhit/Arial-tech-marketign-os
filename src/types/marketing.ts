export type Page =
  | "Overview"
  | "AI Command Center"
  | "Business Notebook"
  | "Marketing Strategy"
  | "Market Research"
  | "Competitors"
  | "Influencer Discovery"
  | "Trending Content"
  | "SEO & ASO"
  | "Content Studio"
  | "AI Avatar Studio"
  | "Voice Studio"
  | "Video Editor"
  | "Media Library"
  | "Content Pipeline"
  | "Audience Simulation"
  | "Content Calendar"
  | "Social Accounts"
  | "Publishing Queue"
  | "Ads Manager"
  | "Analytics"
  | "Growth Intelligence"
  | "Integrations"
  | "Automation Workflows"
  | "Team & Members"
  | "Settings";

export type BrandAssetCategory =
  | "logo"
  | "product_screenshot"
  | "app_screenshot"
  | "product_demo_video"
  | "product_demo_image"
  | "product_clips"
  | "product_clip_ref_image"
  | "founder_clips"
  | "talking_head_clips"
  | "presenter_photograph"
  | "testimonials"
  | "tutorials"
  | "brand_assets"
  | "voiceovers"
  | "background_music"
  | "social_templates"
  | "reference_viral_videos"
  | "reference_image"
  | "thumbnails"
  | "campaign_creatives"
  | "raw_screen_recordings"
  | "other";

export const BRAND_ASSET_CATEGORIES: Array<{ id: BrandAssetCategory; label: string }> = [
  { id: "logo", label: "Logos & brand marks" },
  { id: "product_screenshot", label: "Product screenshots" },
  { id: "app_screenshot", label: "App screenshots" },
  { id: "product_demo_video", label: "Product demonstration videos" },
  { id: "product_demo_image", label: "Product demonstration images" },
  { id: "product_clips", label: "Product clips and footage" },
  { id: "product_clip_ref_image", label: "Product clip reference images" },
  { id: "founder_clips", label: "Founder / team clips" },
  { id: "talking_head_clips", label: "Talking head / presenter clips" },
  { id: "presenter_photograph", label: "Presenter photographs (avatar refs)" },
  { id: "testimonials", label: "Testimonials & UGC clips" },
  { id: "tutorials", label: "Tutorials & explainer assets" },
  { id: "brand_assets", label: "Brand kit (colors, fonts, guidelines)" },
  { id: "voiceovers", label: "Voiceovers & narration" },
  { id: "background_music", label: "Background music & soundscapes" },
  { id: "social_templates", label: "Social media templates" },
  { id: "reference_viral_videos", label: "Reference viral videos" },
  { id: "reference_image", label: "Reference images & style boards" },
  { id: "thumbnails", label: "Thumbnails & cover frames" },
  { id: "campaign_creatives", label: "Campaign creatives" },
  { id: "raw_screen_recordings", label: "Raw screen recordings" },
  { id: "other", label: "Other marketing assets" },
];

export type SourceType =
  | "live_api"
  | "live_crawl"
  | "ai_grounded"
  | "ai_simulation"
  | "imported"
  | "manual";

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

export const CONTENT_PROJECT_STATES: ContentProjectState[] = [
  "PLANNED",
  "SCRIPT_PENDING",
  "SCRIPT_GENERATING",
  "SCRIPT_READY",
  "AWAITING_SCRIPT_APPROVAL",
  "SCRIPT_APPROVED",
  "STORYBOARD_READY",
  "AWAITING_STORYBOARD_APPROVAL",
  "STORYBOARD_APPROVED",
  "VIDEO_PENDING",
  "VIDEO_GENERATING",
  "VIDEO_READY",
  "VIDEO_EDITING",
  "AWAITING_FINAL_APPROVAL",
  "APPROVED_FOR_PUBLISHING",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "PUBLISH_FAILED",
  "CANCELLED",
];

export interface ModelCapabilities {
  text?: boolean;
  imageGeneration?: boolean;
  videoGeneration?: boolean;
  audioGeneration?: boolean;
  multimodalInput?: boolean;
  searchGrounding?: boolean;
  imageSearchGrounding?: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
  tier: "standard" | "paid";
  description: string;
  capabilities?: ModelCapabilities;
  contextWindow?: string;
  recommendedFor?: string;
}

export interface ModelCatalog {
  text: ModelOption[];
  image: ModelOption[];
  video: ModelOption[];
  voice: ModelOption[];
  music: ModelOption[];
  transcription: ModelOption[];
  live: ModelOption[];
  decision: ModelOption[];
}

export interface ModelPreferences {
  textModel: string;
  imageModel: string;
  videoModel: string;
  voiceModel: string;
  musicModel: string;
}

export interface WorkspaceProfile {
  id: string;
  ownerId: string;
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
  positioning: string;
  valueProposition: string;
  brandVoiceNotes: string;
  wordsToUse: string;
  wordsToAvoid: string;
  voiceSliders: number[];
  preferredTextModel: string;
  preferredImageModel: string;
  preferredVideoModel: string;
  preferredVoiceModel: string;
  credits: number;
  plan: "starter" | "pro" | "agency";
  onboarded: boolean;
  isDemo?: boolean;
}

export interface NotebookSectionInsight {
  label: string;
  text: string;
}

export interface NotebookVersion {
  id: string;
  timestamp: string;
  summary: string;
  sourceType: SourceType;
}

export interface CompetitorItem {
  id: string;
  name: string;
  category: "Direct" | "Indirect";
  website?: string;
  positioning: string;
  estimatedAudience: string;
  strength: string;
  weakness: string;
  opportunityScore: number;
  contentPillars: { title: string; share: number }[];
  sourceType: SourceType;
}

export interface InfluencerItem {
  id: string;
  name: string;
  handle: string;
  platform: string;
  niche: string;
  followers: string;
  engagement: string;
  brandFit: number;
  avatarUrl: string;
  whyFit?: string;
  profileUrl?: string;
  saved?: boolean;
  sourceType: SourceType;
}

export interface TrendFormatItem {
  id: string;
  title: string;
  patternName: string;
  platform: string;
  duration: string;
  viewsLabel: string;
  engagementLabel: string;
  thumbUrl: string;
  whyItFits: string;
  timeline: { time: string; beat: string; text: string }[];
  productionNotes: string[];
  sourceType: SourceType;
}

export interface SeoIssueItem {
  title: string;
  severity: "High" | "Medium" | "Low";
  why: string;
  fix: string;
  taskCreated?: boolean;
}

export interface SeoKeywordItem {
  keyword: string;
  volumeOrIntent: string;
  difficulty: string;
  priority: string;
}

export interface StrategyPlan {
  id: string;
  title: string;
  executiveSummary: string;
  northStarMetric: string;
  icpSegments: { name: string; painPoint: string; hookAngle: string; channels: string[] }[];
  contentPillars: { pillar: string; ratio: string; format: string; exampleHook: string }[];
  weeklyRoadmap: { week: string; focus: string; deliverables: string[] }[];
  experiments: { name: string; hypothesis: string; metric: string; effort: string }[];
  sourceType: SourceType;
}

export interface SavedStrategy extends StrategyPlan {
  workspaceId: string;
  status: "draft" | "active" | "archived";
  objective?: string;
  targetPlatforms?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StoryboardScene {
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

export interface StoryboardVersion {
  id: string;
  version: number;
  scenes: StoryboardScene[];
  createdAt: string;
  createdBy: string;
  note?: string;
}

export interface ScriptVariation {
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
  scenes: StoryboardScene[];
}

export interface BriefConfig {
  format?: "short_form" | "long_form" | "ad_creative" | "ugc_style" | "product_demo";
  platform?: string;
  duration?: string;
  audience?: string;
  objective?: string;
  tone?: string;
  keyMessage?: string;
  desiredOutcome?: string;
  features?: string[];
  referenceMaterials?: string;
  selectedMediaIds?: string[];
  competitorRefs?: string[];
  cta?: string;
}

export interface ScriptVersion {
  id: string;
  version: number;
  title: string;
  hook: string;
  body: string;
  cta: string;
  angle: string;
  scenes: StoryboardScene[];
  createdAt: string;
  createdBy: string;
  note?: string;
}

export interface PlatformAdaptation {
  platform: string;
  format: "short_form" | "long_form" | "carousel" | "text_post";
  hook: string;
  script: string;
  caption: string;
  hashtags: string[];
  thumbnailPrompt: string;
  thumbnailUrl?: string;
  durationEstimateSec?: number;
  updatedAt: string;
}

export interface VideoProductionPlan {
  formatType: "short_form" | "long_form";
  method: "ai_assisted" | "traditional" | "hybrid";
  aspectRatio: "9:16" | "16:9" | "1:1" | "4:5";
  durationTargetSec: number;
  presenterId?: string;
  presenterName?: string;
  voiceName?: string;
  voiceoverUrl?: string;
  shotList: Array<{
    sceneNumber: string;
    visualDirection: string;
    audioLine: string;
    assetHint?: string;
    durationSec: number;
  }>;
  capabilityNote: string;
  updatedAt: string;
}

export interface PresenterPreset {
  id: string;
  workspaceId: string;
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

export interface ContentProject {
  id: string;
  workspaceId?: string;
  title: string;
  platform: string;
  stage: "Research" | "Script" | "Video editing" | "Quality assurance" | "Awaiting approval" | "Scheduled";
  status?: ContentProjectState;
  owner: string;
  progress: number;
  creditsUsed: number;
  strategyId?: string;
  calendarEntryId?: string;
  brief?: string;
  briefConfig?: BriefConfig;
  formatType?: "short_form" | "long_form";
  productionMethod?: "ai_assisted" | "traditional" | "hybrid";
  thumbUrl?: string;
  script?: string;
  hook?: string;
  cta?: string;
  scriptApproved?: boolean;
  scriptApprovedAt?: string;
  scriptVersions?: ScriptVersion[];
  scriptVariants?: ScriptVariation[];
  storyboardApproved?: boolean;
  storyboardApprovedAt?: string;
  storyboardScenes?: StoryboardScene[];
  storyboardVersions?: StoryboardVersion[];
  platformAdaptations?: Record<string, PlatformAdaptation>;
  videoProductionPlan?: VideoProductionPlan;
  videoUrl?: string;
  editedVideoUrl?: string;
  caption?: string;
  hashtags?: string[];
  qaScore?: number;
  qaHeadline?: string;
  finalApproved?: boolean;
  finalApprovedAt?: string;
  scheduledForIso?: string;
  publishError?: string;
  providerPostId?: string;
  createdAt?: string;
  updatedAt?: string;
  sourceType: SourceType;
}

export interface MediaAsset {
  id: string;
  name: string;
  kind: "video" | "image" | "audio" | "document";
  url: string;
  durationOrSize: string;
  sourceType: SourceType;
  category?: BrandAssetCategory;
  tags?: string[];
  description?: string;
  sizeBytes?: number;
  mimeType?: string;
  createdAt?: string;
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
}

export interface CalendarPost {
  id: string;
  workspaceId?: string;
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
  sourceType: SourceType;
}

export interface AudienceEvalResult {
  overallScore: number;
  headline: string;
  summary: string;
  dimensions: { label: string; score: number }[];
  evaluators: {
    role: string;
    focus: string;
    score: number;
    quote: string;
    recommendation?: string;
  }[];
  calibration?: { readyToPublishProb?: number; rubricScore?: number } | null;
  improved?: boolean;
  improvedScript?: string;
  sourceType: SourceType;
}

export interface AdCampaignItem {
  id: string;
  name: string;
  objective: string;
  audience: string;
  budgetUsd: number;
  creativeTitle: string;
  primaryText: string;
  status: "Draft" | "Authorized" | "Live Meta Ready";
  estimatedResults: string;
  estimatedCpa: string;
  estimatedReach: string;
  sourceType: SourceType;
}

export interface AutomationRunLog {
  id: string;
  runAt: string;
  status: "Completed" | "Recovered" | "Awaiting approval";
  duration: string;
  credits: string;
  summary: string;
  projectId?: string;
  projectTitle?: string;
  projectStatus?: ContentProjectState;
}

export interface WorkflowNode {
  id: string;
  type: "trigger" | "condition" | "action" | "approval_gate";
  label: string;
  config: Record<string, unknown>;
}

export interface AutomationWorkflow {
  id: string;
  workspaceId: string;
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
  nodes: WorkflowNode[];
  lastRunAt?: string;
  lastStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationExecutionLog {
  id: string;
  workflowId: string;
  workflowName: string;
  workspaceId: string;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "awaiting_approval" | "skipped_condition" | "failed";
  attempts: number;
  stepLogs: Array<{
    nodeId: string;
    label: string;
    status: "ok" | "skipped" | "paused" | "error";
    detail: string;
  }>;
  summary: string;
  projectId?: string;
  projectTitle?: string;
  projectStatus?: ContentProjectState;
}

export interface CreditTransaction {
  id: string;
  label: string;
  amount: number;
  timestamp: string;
}

export interface BackgroundJob {
  id: string;
  workspaceId: string;
  kind: string;
  status: "queued" | "processing" | "completed" | "partially_completed" | "failed" | "cancelled";
  stage: string;
  completedStages: string[];
  pendingStages: string[];
  progressPct: number;
  result?: Record<string, unknown>;
  error?: string;
  failedStage?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiMemoryItem {
  id: string;
  workspaceId: string;
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

export interface WeeklySeoReport {
  id: string;
  workspaceId: string;
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
  createdAt: string;
}

export interface SearchConsoleRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

export interface SearchConsoleResponse {
  connected: boolean;
  status?: string;
  sites?: Array<{ siteUrl?: string }>;
  activeSite?: string;
  reportingPeriod?: { startDate: string; endDate: string };
  lastSyncedAt?: string;
  rows: SearchConsoleRow[];
  topPages: SearchConsoleRow[];
  message?: string;
  error?: string;
}

export interface ChannelAnalysisResult {
  creatorName: string;
  handle: string;
  platform: string;
  niche: string;
  positioningSummary: string;
  targetAudienceClues: string;
  postingPatterns: string;
  contentFormats: string[];
  recurringHooks: string[];
  ctaStyle: string;
  observedFacts: string[];
  aiHypotheses: string[];
  brandAdaptationIdeas: string[];
  channelUrl?: string;
  sources?: Array<{ title: string; url: string }>;
}

export interface VideoBreakdownItem {
  id: string;
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

export interface VideoEditorPreferences {
  mode: "ai" | "traditional" | "hybrid";
  aspectRatio: "9:16" | "16:9" | "1:1" | "4:5";
  speed: number;
  zoomFactor: number;
  fadeInOut: boolean;
  voVolume: number;
  musicVolume: number;
  burnSubtitles: boolean;
  logoUrl?: string;
  referenceBreakdownId?: string;
}

export type AnalyticsProviderId =
  | "posthog"
  | "firebase"
  | "supabase"
  | "ga4"
  | "gsc"
  | "google_play"
  | "app_store"
  | "meta_social"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "ads";

export type DataCompletenessStatus =
  | "connected_and_reporting"
  | "connected_no_events"
  | "permission_restricted"
  | "not_connected"
  | "unsupported"
  | "insufficient_historical_data"
  | "sync_failed";

export type AttributionMethod = "Direct" | "Provider-Attributed" | "Correlated" | "Unknown";

export interface MetricProvenance {
  provider: AnalyticsProviderId;
  providerLabel: string;
  projectOrProperty: string;
  reportingPeriod: { startDate: string; endDate: string };
  retrievedAt: string;
  definition: string;
  attributionMethod: AttributionMethod;
  completenessStatus: DataCompletenessStatus;
  limitations?: string;
}

export interface SupabaseTableMappings {
  usersTable?: string;
  createdAtCol?: string;
  verifiedCol?: string;
  eventsTable?: string;
  eventNameCol?: string;
}

export interface AnalyticsConnectionSummary {
  id: string;
  workspaceId: string;
  provider: AnalyticsProviderId;
  providerLabel: string;
  authMode: "api_key" | "service_account" | "google_oauth" | "composio";
  maskedKeyHint?: string;
  selectedProjectId?: string;
  selectedProjectName?: string;
  hostUrl?: string;
  discoveredProjects?: Array<{ id: string; name: string }>;
  discoveredTables?: Array<{ name: string; columns: string[] }>;
  tableMappings?: SupabaseTableMappings;
  status: "connected" | "error" | "disconnected";
  completenessStatus: DataCompletenessStatus;
  statusDetail: string;
  lastSyncedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationRecommendation {
  provider: AnalyticsProviderId;
  providerLabel: string;
  priority: "High" | "Medium" | "Low";
  whyRecommended: string;
  metricsUnlocked: string[];
  permissionsRequired: string;
  sdkDetected: boolean;
  detectedEvidence?: string;
  historicalDataNote: string;
  connected?: boolean;
}

export interface TrackingAuditResult {
  auditedUrl: string;
  auditedAt: string;
  detectedSdks: Array<{
    provider: AnalyticsProviderId;
    label: string;
    detected: boolean;
    evidence: string;
    connectedInWorkspace: boolean;
  }>;
  detectedStoreLinks: Array<{ store: "google_play" | "app_store"; url: string }>;
  eventTaxonomyGaps: string[];
  recommendations: IntegrationRecommendation[];
}

export interface ProviderMetricItem {
  key: string;
  label: string;
  value: number | null;
  previousValue: number | null;
  growthPct: number | null;
  unit: "count" | "percent" | "seconds" | "currency";
  provenance: MetricProvenance;
}

export interface ProviderKpiCard {
  connectionId: string;
  provider: AnalyticsProviderId;
  providerLabel: string;
  projectOrProperty: string;
  completenessStatus: DataCompletenessStatus;
  statusDetail: string;
  retrievedAt: string;
  metrics: ProviderMetricItem[];
  timeSeries: Array<{ date: string; [metricKey: string]: string | number | null }>;
  topPagesOrEvents: Array<{ name: string; count: number; detail?: string }>;
  channels: Array<{
    channel: string;
    sessionsOrVisits: number | null;
    users: number | null;
    conversions: number | null;
    attributionMethod: AttributionMethod;
  }>;
}

export interface FunnelStageResult {
  stageName: string;
  provider: AnalyticsProviderId;
  sourceMapping: string;
  count: number | null;
  conversionFromPreviousPct: number | null;
  completenessStatus: DataCompletenessStatus;
  note?: string;
}

export interface StrategyFeedbackComparison {
  strategyId: string;
  strategyTitle: string;
  northStarMetric: string;
  goalAlignmentStatus: "aligned_data_available" | "partial_data" | "no_connected_data";
  summary: string;
  comparisons: Array<{
    pillarOrGoal: string;
    linkedProvider?: string;
    observedMetric: string;
    observedValue: string;
    assessment: string;
  }>;
}

export interface GrowthDashboardPayload {
  workspaceId: string;
  range: string;
  reportingPeriod: { startDate: string; endDate: string };
  previousPeriod: { startDate: string; endDate: string };
  compareEnabled: boolean;
  overlapWarning: string;
  connections: AnalyticsConnectionSummary[];
  providerCards: ProviderKpiCard[];
  recommendations: IntegrationRecommendation[];
  strategyFeedback: StrategyFeedbackComparison | null;
}

export interface GrowthReportRecord {
  id: string;
  workspaceId: string;
  cadence: "daily" | "weekly" | "monthly";
  title: string;
  reportingPeriod: { startDate: string; endDate: string };
  executiveSummary: string;
  providerHighlights: Array<{ provider: string; status: DataCompletenessStatus; keyFindings: string[] }>;
  recommendations: string[];
  markdown: string;
  createdAt: string;
}

