import { Router } from "express";
import { z } from "zod";
import { formatGeminiError } from "../ai/geminiClient.js";
import { assertWorkspaceAccess, type AuthenticatedRequest } from "../middleware/auth.js";
import {
  executeComposioTool,
  isComposioConfigured,
  listComposioConnections,
} from "../services/composio.js";
import { stateStore } from "../services/stateStore.js";
import { isVercelRuntime } from "../utils/paths.js";
import { executeBusinessIntelligenceAnalysis, executeSeoAuditAnalysis } from "./intelligence.js";
import { executeAutomationWorkflow } from "./pipeline.js";

const router = Router();

function getContext(req: AuthenticatedRequest) {
  const workspaceId =
    (req.headers["x-workspace-id"] as string) ||
    (typeof req.query.workspaceId === "string" ? req.query.workspaceId : "") ||
    (typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "") ||
    "default";
  return {
    workspaceId: workspaceId.replace(/[^a-zA-Z0-9_-]/g, "") || "default",
    actorUid: req.user?.uid || "anonymous",
  };
}

function mapPlatformToToolkit(platform: string): string {
  const p = platform.toLowerCase();
  if (p.includes("instagram")) return "instagram";
  if (p.includes("facebook")) return "facebook";
  if (p.includes("tiktok")) return "tiktok";
  if (p.includes("youtube")) return "youtube";
  if (p.includes("linkedin")) return "linkedin";
  if (p === "x" || p.includes("twitter")) return "twitter";
  return p;
}

const ScheduleJobSchema = z.object({
  title: z.string().min(1).max(200),
  platform: z.string().min(1).max(80),
  caption: z.string().max(5000).default(""),
  mediaUrl: z.string().max(1000).optional(),
  scheduledForIso: z.string().min(4).max(64),
  approvedForAutoPublish: z.boolean().default(false),
  idempotencyKey: z.string().max(160).optional(),
  workspaceId: z.string().max(128).optional(),
});

router.get("/notifications", (req: AuthenticatedRequest, res) => {
  const { workspaceId } = getContext(req);
  const items = stateStore.getNotifications(workspaceId);
  res.json({
    unreadCount: items.filter((n) => !n.read).length,
    notifications: items.slice(0, 40),
  });
});

router.post("/notifications/:id/read", (req: AuthenticatedRequest, res) => {
  const updated = stateStore.markNotificationRead(String(req.params.id));
  res.json({ ok: Boolean(updated), notification: updated });
});

router.post("/notifications/read-all", (req: AuthenticatedRequest, res) => {
  const { workspaceId } = getContext(req);
  const changed = stateStore.markAllNotificationsRead(workspaceId);
  res.json({ ok: true, marked: changed });
});

router.get("/audit/logs", (req: AuthenticatedRequest, res) => {
  const { workspaceId } = getContext(req);
  res.json({
    logs: stateStore.getAuditLogs(workspaceId).slice(0, 60),
    integrationLogs: stateStore.getIntegrationLogs(workspaceId).slice(0, 40),
  });
});

router.get("/audit/ai-runs", (req: AuthenticatedRequest, res) => {
  const { workspaceId } = getContext(req);
  res.json({
    runs: stateStore.getAiRuns(workspaceId).slice(0, 60),
  });
});

router.get("/video/jobs", (req: AuthenticatedRequest, res) => {
  const { workspaceId } = getContext(req);
  res.json({
    jobs: stateStore.getVideoJobs(workspaceId).slice(0, 30),
  });
});

router.get("/video/jobs/:id", (req: AuthenticatedRequest, res) => {
  const job = stateStore.getVideoJobById(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "Video render job not found." });
    return;
  }
  res.json({ job });
});

router.get("/scheduler/jobs", (req: AuthenticatedRequest, res) => {
  const { workspaceId } = getContext(req);
  res.json({
    jobs: stateStore.getScheduledJobs(workspaceId),
  });
});

router.post("/scheduler/jobs", (req: AuthenticatedRequest, res) => {
  const parsed = ScheduleJobSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid schedule payload" });
    return;
  }

  const { workspaceId, actorUid } = getContext(req);
  const { title, platform, caption, mediaUrl, scheduledForIso, approvedForAutoPublish } = parsed.data;
  const job = stateStore.addScheduledJob({
    workspaceId,
    ownerUid: actorUid,
    title,
    platform,
    caption,
    mediaUrl,
    scheduledForIso,
    approvedForAutoPublish,
    idempotencyKey: parsed.data.idempotencyKey || stateStore.newId("pub"),
    status: approvedForAutoPublish ? "scheduled" : "awaiting_confirmation",
  });

  stateStore.addNotification({
    workspaceId,
    ownerUid: actorUid,
    title: "Post Scheduled",
    message: `"${title}" scheduled for ${platform} (${scheduledForIso.slice(0, 16).replace("T", " ")}).`,
    category: "publishing",
    severity: "info",
    actionPage: "Publishing Queue",
  });

  res.json({ job });
});

router.post("/scheduler/jobs/:id/confirm", (req: AuthenticatedRequest, res) => {
  const { workspaceId, actorUid } = getContext(req);
  const updated = stateStore.updateScheduledJob(String(req.params.id), {
    approvedForAutoPublish: true,
    status: "scheduled",
  });
  if (!updated) {
    res.status(404).json({ error: "Scheduled job not found." });
    return;
  }
  stateStore.addAuditLog({
    workspaceId,
    actorUid,
    action: "scheduler.job.approved",
    target: updated.id,
    status: "allowed",
    detail: `Approved scheduled post "${updated.title}" for automated execution`,
  });
  res.json({ job: updated });
});

router.delete("/scheduler/jobs/:id", (req: AuthenticatedRequest, res) => {
  const updated = stateStore.updateScheduledJob(String(req.params.id), {
    status: "cancelled",
  });
  res.json({ cancelled: Boolean(updated), job: updated });
});

async function handleSearchConsoleRequest(req: AuthenticatedRequest, res: import("express").Response) {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const { workspaceId, actorUid } = ctx;
  const siteUrl =
    typeof req.body?.siteUrl === "string"
      ? req.body.siteUrl.trim()
      : typeof req.query.siteUrl === "string"
        ? req.query.siteUrl.trim()
        : "";

  if (!isComposioConfigured()) {
    res.json({
      connected: false,
      status: "Awaiting Credentials",
      sites: [],
      rows: [],
      topPages: [],
      lastSyncedAt: new Date().toISOString(),
    });
    return;
  }

  try {
    const { statuses } = await listComposioConnections(["google_search_console"], workspaceId);
    const active = statuses.google_search_console?.accounts.find((a) => a.status === "active");
    if (!active) {
      res.json({
        connected: false,
        status: "Setup Required",
        sites: [],
        rows: [],
        topPages: [],
        lastSyncedAt: new Date().toISOString(),
        message: "Connect Google Search Console via Composio OAuth to pull live search queries & top-performing pages.",
      });
      return;
    }

    const sitesRes = await executeComposioTool<{ siteEntry?: Array<{ siteUrl?: string }> }>({
      toolkit: "google_search_console",
      toolSlug: "GOOGLE_SEARCH_CONSOLE_LIST_SITES",
      arguments: {},
      accountId: active.id,
      workspaceId,
      userId: actorUid,
    });

    const targetSite = siteUrl || sitesRes.data?.siteEntry?.[0]?.siteUrl || "";
    let rows: Array<Record<string, unknown>> = [];
    let topPages: Array<Record<string, unknown>> = [];
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);

    if (targetSite) {
      const [queryRes, pageRes] = await Promise.all([
        executeComposioTool<{ rows?: Array<Record<string, unknown>> }>({
          toolkit: "google_search_console",
          toolSlug: "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
          arguments: {
            siteUrl: targetSite,
            startDate: start,
            endDate: end,
            dimensions: ["query"],
            rowLimit: 20,
          },
          accountId: active.id,
          workspaceId,
          userId: actorUid,
        }).catch(() => ({ data: { rows: [] } })),
        executeComposioTool<{ rows?: Array<Record<string, unknown>> }>({
          toolkit: "google_search_console",
          toolSlug: "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
          arguments: {
            siteUrl: targetSite,
            startDate: start,
            endDate: end,
            dimensions: ["page"],
            rowLimit: 20,
          },
          accountId: active.id,
          workspaceId,
          userId: actorUid,
        }).catch(() => ({ data: { rows: [] } })),
      ]);

      rows = queryRes.data?.rows || [];
      topPages = pageRes.data?.rows || [];
    }

    res.json({
      connected: true,
      status: "connected",
      sourceType: "live_api",
      sites: sitesRes.data?.siteEntry || [],
      activeSite: targetSite,
      reportingPeriod: { startDate: start, endDate: end },
      lastSyncedAt: new Date().toISOString(),
      rows,
      topPages,
    });
  } catch (err) {
    res.status(502).json({
      connected: false,
      status: "Error",
      sites: [],
      rows: [],
      topPages: [],
      error: err instanceof Error ? err.message : "Failed to query Google Search Console",
    });
  }
}

router.post("/seo/search-console", handleSearchConsoleRequest);
router.get("/seo/search-console", handleSearchConsoleRequest);

router.get("/seo/reports", (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({
    reports: stateStore.getSeoAuditReports(ctx.workspaceId),
  });
});

router.post("/seo/weekly-audit/run", async (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const { websiteUrl, business, triggeredBy = "seo_agent", model } = req.body as {
      websiteUrl?: string;
      business?: Record<string, unknown>;
      triggeredBy?: "weekly_cron" | "seo_agent" | "manual";
      model?: string;
    };
    const snap = stateStore.getWorkspaceSnapshot(ctx.workspaceId);
    const resolvedUrl = String(websiteUrl || business?.websiteUrl || snap?.websiteUrl || "").trim();
    if (!resolvedUrl) {
      res.status(400).json({ error: "A website URL is required to run a technical SEO audit." });
      return;
    }

    const result = await executeSeoAuditAnalysis({
      websiteUrl: resolvedUrl,
      business,
      model,
      workspaceId: ctx.workspaceId,
      actorUid: ctx.actorUid,
      triggeredBy,
    });

    const reports = stateStore.getSeoAuditReports(ctx.workspaceId);
    const latestReport = reports[0];

    stateStore.addNotification({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      title: "Weekly Technical SEO Report Ready",
      message: `${latestReport?.headline || resolvedUrl} (Score: ${latestReport?.healthScore ?? "—"}/100) pushed to Analytics.`,
      category: "seo",
      severity: "success",
      actionPage: "Analytics",
    });

    res.json({ report: latestReport, audit: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to run technical SEO audit." });
  }
});

// Durable Background Jobs for Business Intelligence & async operations
async function runBusinessIntelligenceJobAsync(jobId: string): Promise<void> {
  const job = stateStore.getBackgroundJobById(jobId);
  if (!job || job.status === "cancelled") return;

  let partialResult: Record<string, unknown> = { ...(job.result || {}) };
  let activeStage = "validate_url";

  try {
    stateStore.updateBackgroundJob(jobId, {
      status: "processing",
      stage: "Validating & normalizing website URL",
      progressPct: 12,
    });

    const out = await executeBusinessIntelligenceAnalysis({
      input: job.input,
      workspaceId: job.workspaceId,
      actorUid: job.ownerUid,
      onStageProgress: (stageLabel, pct, partial) => {
        activeStage = stageLabel;
        if (partial) {
          partialResult = { ...partialResult, ...partial };
        }
        const current = stateStore.getBackgroundJobById(jobId);
        if (current?.status === "cancelled") return;

        const completed: string[] = [];
        if (pct >= 35) completed.push("validate_url");
        if (pct >= 65) completed.push("crawl_website");
        if (pct >= 90) completed.push("extract_intelligence");

        stateStore.updateBackgroundJob(jobId, {
          stage: stageLabel,
          progressPct: pct,
          completedStages: completed,
          pendingStages: ["validate_url", "crawl_website", "extract_intelligence", "finalize_workspace"].filter(
            (s) => !completed.includes(s),
          ),
          result: partialResult,
        });
      },
    });

    const latest = stateStore.getBackgroundJobById(jobId);
    if (latest?.status === "cancelled") return;

    stateStore.updateBackgroundJob(jobId, {
      status: "completed",
      stage: "Completed",
      completedStages: ["validate_url", "crawl_website", "extract_intelligence", "finalize_workspace"],
      pendingStages: [],
      progressPct: 100,
      result: out as unknown as Record<string, unknown>,
      error: undefined,
      failedStage: undefined,
    });
  } catch (err) {
    const current = stateStore.getBackgroundJobById(jobId);
    if (current?.status === "cancelled") return;
    const formatted = formatGeminiError(err);
    const hasPartial = Boolean(partialResult.crawled);
    stateStore.updateBackgroundJob(jobId, {
      status: hasPartial ? "partially_completed" : "failed",
      failedStage: activeStage,
      error: formatted.message,
      result: partialResult,
    });
  }
}

router.post("/jobs/business-intelligence", async (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const input = (req.body || {}) as Record<string, unknown>;
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined;

  if (idempotencyKey) {
    const existing = stateStore
      .getBackgroundJobs(ctx.workspaceId)
      .find((j) => j.idempotencyKey === idempotencyKey && ["queued", "processing", "completed"].includes(j.status));
    if (existing) {
      res.status(202).json({ job: existing });
      return;
    }
  }

  const job = stateStore.createBackgroundJob({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    kind: "business_intelligence",
    status: "queued",
    stage: "Queued",
    completedStages: [],
    pendingStages: ["validate_url", "crawl_website", "extract_intelligence", "finalize_workspace"],
    progressPct: 5,
    input,
    retryCount: 0,
    idempotencyKey,
  });

  // In Vercel serverless, background promises freeze after res.end() and /tmp is per-container,
  // so run the bounded BI workflow inline inside the 60s function budget and return the finished job.
  if (isVercelRuntime() || input.synchronous === true) {
    await runBusinessIntelligenceJobAsync(job.id);
    const finished = stateStore.getBackgroundJobById(job.id) || job;
    res.status(200).json({ job: finished, executionMode: "inline" });
    return;
  }

  void runBusinessIntelligenceJobAsync(job.id);
  res.status(202).json({ job, executionMode: "background" });
});

router.get("/jobs", (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({
    jobs: stateStore.getBackgroundJobs(ctx.workspaceId).slice(0, 40),
  });
});

router.get("/jobs/:id", (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const job = stateStore.getBackgroundJobById(String(req.params.id));
  if (!job || (job.workspaceId !== ctx.workspaceId && ctx.workspaceId !== "default")) {
    res.status(404).json({ error: "Background job not found." });
    return;
  }
  res.json({ job });
});

router.post("/jobs/:id/retry", async (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const job = stateStore.getBackgroundJobById(String(req.params.id));
  if (!job || job.workspaceId !== ctx.workspaceId) {
    res.status(404).json({ error: "Background job not found." });
    return;
  }
  const updated = stateStore.updateBackgroundJob(job.id, {
    status: "queued",
    stage: "Retrying analysis",
    retryCount: (job.retryCount || 0) + 1,
    error: undefined,
    failedStage: undefined,
  });

  if (isVercelRuntime() || req.body?.synchronous === true) {
    await runBusinessIntelligenceJobAsync(job.id);
    const finished = stateStore.getBackgroundJobById(job.id) || updated;
    res.status(200).json({ job: finished, executionMode: "inline" });
    return;
  }

  void runBusinessIntelligenceJobAsync(job.id);
  res.status(202).json({ job: updated, executionMode: "background" });
});

router.post("/jobs/:id/cancel", (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const job = stateStore.getBackgroundJobById(String(req.params.id));
  if (!job || job.workspaceId !== ctx.workspaceId) {
    res.status(404).json({ error: "Background job not found." });
    return;
  }
  const updated = stateStore.updateBackgroundJob(job.id, {
    status: "cancelled",
    stage: "Cancelled by user",
  });
  res.json({ job: updated });
});

// Workspace Auto-Save & Continuity
router.get("/workspace-state", (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({
    snapshot: stateStore.getWorkspaceSnapshot(ctx.workspaceId),
  });
});

router.put("/workspace-state", (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = (req.body || {}) as Record<string, unknown>;
  const snapshot = stateStore.upsertWorkspaceSnapshot(ctx.workspaceId, ctx.actorUid, {
    websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : undefined,
    businessName: typeof body.businessName === "string" ? body.businessName : undefined,
    lastPage: typeof body.lastPage === "string" ? body.lastPage : undefined,
    openProjectId: typeof body.openProjectId === "string" ? body.openProjectId : undefined,
    activeScriptTitle: typeof body.activeScriptTitle === "string" ? body.activeScriptTitle : undefined,
    activeScriptText: typeof body.activeScriptText === "string" ? body.activeScriptText : undefined,
    videoEditorState:
      body.videoEditorState && typeof body.videoEditorState === "object"
        ? (body.videoEditorState as Record<string, unknown>)
        : undefined,
    commandConversations: Array.isArray(body.commandConversations)
      ? (body.commandConversations as Array<Record<string, unknown>>)
      : undefined,
    drafts:
      body.drafts && typeof body.drafts === "object"
        ? (body.drafts as Record<string, unknown>)
        : undefined,
  });
  res.json({ snapshot });
});

// Structured Persistent AI Memory
router.get("/memory", (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
  res.json({
    memories: stateStore.listMemories(ctx.workspaceId, scope),
  });
});

router.post("/memory", (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const { scope = "business", source = "user_provided", approved = true, title, content, projectId, tags = [] } =
    req.body as {
      scope?: "user" | "business" | "project" | "conversation";
      source?: "verified_business" | "user_provided" | "external_research" | "ai_assumption";
      approved?: boolean;
      title?: string;
      content?: string;
      projectId?: string;
      tags?: string[];
    };
  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ error: "Memory title and content are required." });
    return;
  }
  const memory = stateStore.addMemory({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    scope,
    source,
    approved: Boolean(approved),
    title: title.trim().slice(0, 140),
    content: content.trim().slice(0, 2000),
    projectId: projectId || undefined,
    tags: Array.isArray(tags) ? tags.map(String).slice(0, 10) : [],
  });
  res.json({ memory });
});

router.patch("/memory/:id", (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const id = String(req.params.id);
  const patch = req.body as Record<string, unknown>;
  const safePatch: Record<string, unknown> = {};
  if (typeof patch.title === "string") safePatch.title = patch.title.trim().slice(0, 140);
  if (typeof patch.content === "string") safePatch.content = patch.content.trim().slice(0, 2000);
  if (typeof patch.approved === "boolean") safePatch.approved = patch.approved;
  if (typeof patch.scope === "string") safePatch.scope = patch.scope;
  if (typeof patch.source === "string") safePatch.source = patch.source;
  if (Array.isArray(patch.tags)) safePatch.tags = patch.tags.map(String).slice(0, 10);

  const memory = stateStore.updateMemory(id, ctx.workspaceId, safePatch);
  if (!memory) {
    res.status(404).json({ error: "Memory record not found." });
    return;
  }
  res.json({ memory });
});

router.delete("/memory/:id", (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const deleted = stateStore.deleteMemory(String(req.params.id), ctx.workspaceId);
  res.json({ deleted });
});

// Account Deletion Server Purge
router.post("/auth/account-cleanup", (req: AuthenticatedRequest, res) => {
  if (!req.user?.uid) {
    res.status(401).json({ error: "Authenticated session required for account deletion cleanup." });
    return;
  }
  const purgedWorkspaces = stateStore.purgeUserData(req.user.uid);
  res.json({ ok: true, purgedWorkspaces });
});

router.get("/billing/status", async (req: AuthenticatedRequest, res) => {
  const { workspaceId } = getContext(req);
  const stripeDirect = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  const paystackDirect = Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
  let stripeComposio = false;
  if (isComposioConfigured()) {
    try {
      const { statuses } = await listComposioConnections(["stripe"], workspaceId);
      stripeComposio = Boolean(statuses.stripe?.accounts.some((a) => a.status === "active"));
    } catch {
      stripeComposio = false;
    }
  }

  res.json({
    productBilling: "disabled",
    checkoutEnabled: false,
    note: "Marketing OS is owner-operated. Plans, credits, and checkout are disabled. AI and provider usage stays in /api/telemetry/usage. LevelUp revenue is measured through connected business analytics, not this checkout.",
    providers: {
      stripe: {
        configured: stripeDirect || stripeComposio,
        mode: stripeDirect ? "server_secret" : stripeComposio ? "composio_oauth" : "awaiting_credentials",
      },
      paystack: {
        configured: paystackDirect,
        mode: paystackDirect ? "server_secret" : "awaiting_credentials",
      },
    },
    records: stateStore.getBillingRecords(workspaceId),
  });
});

router.post("/billing/checkout", (_req: AuthenticatedRequest, res) => {
  res.status(410).json({
    productBilling: "disabled",
    error:
      "Marketing OS does not sell subscriptions, credit packs, or upgrades. This workspace is for the owner's operations. Provider cost tracking remains available in AI telemetry.",
  });
});

let schedulerInterval: NodeJS.Timeout | null = null;
let lastWeeklySeoSweepAt = 0;

export async function runSchedulerSweep(): Promise<{
  checkedScheduledJobs: number;
  triggeredWorkflows: number;
}> {
  let checkedScheduledJobs = 0;
  let triggeredWorkflows = 0;
  const now = Date.now();
  const jobs = stateStore.getScheduledJobs();
  for (const job of jobs) {
    if (job.status !== "scheduled") continue;
    const dueAt = new Date(job.scheduledForIso).getTime();
    if (Number.isNaN(dueAt) || dueAt > now) continue;
    checkedScheduledJobs += 1;

      if (!job.approvedForAutoPublish) {
        stateStore.updateScheduledJob(job.id, { status: "awaiting_confirmation" });
        stateStore.addNotification({
          workspaceId: job.workspaceId,
          ownerUid: job.ownerUid,
          title: `Approval needed: "${job.title}"`,
          message: `Scheduled post for ${job.platform} is due and awaiting human publish confirmation.`,
          category: "publishing",
          severity: "warning",
          actionPage: "Publishing Queue",
        });
        continue;
      }

      if (!isComposioConfigured()) {
        stateStore.updateScheduledJob(job.id, {
          status: "awaiting_confirmation",
          lastError: "Composio API key missing",
        });
        continue;
      }

      const toolkit = mapPlatformToToolkit(job.platform);
      try {
        const { statuses } = await listComposioConnections([toolkit], job.workspaceId);
        const activeAccount = statuses[toolkit]?.accounts.find((a) => a.status === "active");
        if (!activeAccount) {
          stateStore.updateScheduledJob(job.id, {
            status: "awaiting_confirmation",
            lastError: `${job.platform} is not connected in Composio.`,
          });
          continue;
        }

        stateStore.updateScheduledJob(job.id, {
          status: "processing",
          attempts: job.attempts + 1,
        });

        let postId = "";
        if (toolkit === "facebook") {
          const pages = await executeComposioTool<{ data?: Array<{ id?: string }> }>({
            toolkit: "facebook",
            toolSlug: "FACEBOOK_LIST_MANAGED_PAGES",
            arguments: {},
            accountId: activeAccount.id,
            workspaceId: job.workspaceId,
            userId: job.ownerUid,
          });
          const pageId = pages.data?.data?.[0]?.id;
          if (!pageId) throw new Error("No managed Facebook Page found");
          const out = await executeComposioTool<{ id?: string }>({
            toolkit: "facebook",
            toolSlug: "FACEBOOK_CREATE_POST",
            arguments: { page_id: pageId, message: job.caption || job.title },
            accountId: activeAccount.id,
            workspaceId: job.workspaceId,
            userId: job.ownerUid,
          });
          postId = String(out.data?.id || "published");
        } else if (toolkit === "linkedin") {
          const me = await executeComposioTool<{ sub?: string; id?: string }>({
            toolkit: "linkedin",
            toolSlug: "LINKEDIN_GET_MY_INFO",
            arguments: {},
            accountId: activeAccount.id,
            workspaceId: job.workspaceId,
            userId: job.ownerUid,
          });
          const personId = String(me.data?.sub || me.data?.id || "");
          const authorUrn = personId.startsWith("urn:") ? personId : `urn:li:person:${personId}`;
          const out = await executeComposioTool<{ id?: string }>({
            toolkit: "linkedin",
            toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST",
            arguments: { author: authorUrn, commentary: job.caption || job.title, visibility: "PUBLIC" },
            accountId: activeAccount.id,
            workspaceId: job.workspaceId,
            userId: job.ownerUid,
          });
          postId = String(out.data?.id || "published");
        } else if (toolkit === "twitter") {
          const out = await executeComposioTool<{ data?: { id?: string } }>({
            toolkit: "twitter",
            toolSlug: "TWITTER_CREATION_OF_A_POST",
            arguments: { text: (job.caption || job.title).slice(0, 280) },
            accountId: activeAccount.id,
            workspaceId: job.workspaceId,
            userId: job.ownerUid,
          });
          postId = String(out.data?.data?.id || "published");
        } else {
          if (!job.mediaUrl || !/^https?:\/\//i.test(job.mediaUrl)) {
            stateStore.updateScheduledJob(job.id, {
              status: "awaiting_confirmation",
              lastError: `${job.platform} requires verified public media URL before auto-publish.`,
            });
            continue;
          }
          stateStore.updateScheduledJob(job.id, {
            status: "awaiting_confirmation",
            lastError: "Click Publish in Publishing Queue to confirm final media dispatch.",
          });
          continue;
        }

        stateStore.updateScheduledJob(job.id, {
          status: "published",
          providerPostId: postId,
        });
        stateStore.addNotification({
          workspaceId: job.workspaceId,
          ownerUid: job.ownerUid,
          title: `Scheduled post published to ${job.platform}`,
          message: `"${job.title}" published via scheduler (${postId}).`,
          category: "publishing",
          severity: "success",
          actionPage: "Publishing Queue",
        });
      } catch (err) {
        const attempts = job.attempts + 1;
        stateStore.updateScheduledJob(job.id, {
          status: attempts >= job.maxAttempts ? "failed" : "scheduled",
          attempts,
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Weekly Technical SEO Audit scheduler sweep (checks every 15 mins; audits workspaces > 7 days overdue)
    if (now - lastWeeklySeoSweepAt >= 15 * 60 * 1000 && process.env.GEMINI_API_KEY?.trim()) {
      lastWeeklySeoSweepAt = now;
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      const snapshots = stateStore.listWorkspaceSnapshotsWithWebsite();
      for (const snap of snapshots) {
        if (!snap.websiteUrl) continue;
        const existingReports = stateStore.getSeoAuditReports(snap.workspaceId);
        const latestAt = existingReports[0] ? new Date(existingReports[0].createdAt).getTime() : 0;
        if (latestAt && now - latestAt < SEVEN_DAYS_MS) continue;
        try {
          const audit = (await executeSeoAuditAnalysis({
            websiteUrl: snap.websiteUrl,
            business: { name: snap.businessName || snap.workspaceId, websiteUrl: snap.websiteUrl },
            workspaceId: snap.workspaceId,
            actorUid: snap.ownerUid,
            triggeredBy: "weekly_cron",
          })) as Record<string, unknown>;
          stateStore.addNotification({
            workspaceId: snap.workspaceId,
            ownerUid: snap.ownerUid,
            title: "Weekly Technical SEO Report Pushed",
            message: `${String(audit.headline || snap.websiteUrl)} — Score ${String(audit.healthScore || "—")}/100 now in Analytics.`,
            category: "seo",
            severity: "info",
            actionPage: "Analytics",
          });
        } catch {
          // Non-fatal cron skip; next cycle will retry
        }
      }
    }

    // Confirmed interval Automation Workflows execution sweep
    const workflows = stateStore.listWorkflows();
    for (const wf of workflows) {
      if (!wf.enabled || !wf.confirmedToActivate || wf.triggerType !== "interval") continue;
      const intervalMs = Math.max(5, wf.intervalMinutes || 60) * 60 * 1000;
      const lastRunMs = wf.lastRunAt ? new Date(wf.lastRunAt).getTime() : 0;
      if (lastRunMs && now - lastRunMs < intervalMs) continue;
      try {
        await executeAutomationWorkflow(wf);
        triggeredWorkflows += 1;
      } catch {
        // Execution failures logged cleanly inside stateStore.workflowExecutions
      }
    }

  return { checkedScheduledJobs, triggeredWorkflows };
}

export function startBackgroundScheduler(): void {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(() => {
    void runSchedulerSweep();
  }, 30000);

  schedulerInterval.unref();
}

const handleCronTick = async (req: AuthenticatedRequest, res: import("express").Response) => {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = String(req.headers.authorization || "").trim();
  if (cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: "Unauthorized cron trigger." });
      return;
    }
  } else if (isVercelRuntime()) {
    res.status(503).json({
      error: "CRON_SECRET is not configured on Vercel; configure CRON_SECRET to authorize scheduled cron ticks.",
    });
    return;
  }

  const summary = await runSchedulerSweep();
  res.json({ ok: true, ...summary, executedAt: new Date().toISOString() });
};

router.get("/cron/tick", handleCronTick);
router.post("/cron/tick", handleCronTick);

router.get("/telemetry/usage", (req: AuthenticatedRequest, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const runs = stateStore.getAiRuns(ctx.workspaceId);
  const byModel: Record<string, { runs: number; completed: number; failed: number; avgLatencyMs: number }> = {};
  for (const r of runs) {
    if (!byModel[r.model]) {
      byModel[r.model] = { runs: 0, completed: 0, failed: 0, avgLatencyMs: 0 };
    }
    const entry = byModel[r.model];
    entry.runs += 1;
    if (r.status === "completed") entry.completed += 1;
    else entry.failed += 1;
    entry.avgLatencyMs += r.latencyMs;
  }
  for (const key of Object.keys(byModel)) {
    byModel[key].avgLatencyMs = Math.round(byModel[key].avgLatencyMs / Math.max(1, byModel[key].runs));
  }
  const avgLatencyMs = runs.length
    ? Math.round(runs.reduce((sum, r) => sum + r.latencyMs, 0) / runs.length)
    : 0;
  res.json({
    totalRuns: runs.length,
    avgLatencyMs,
    recentModels: Object.keys(byModel),
    byModel,
    recentRuns: runs.slice(0, 40),
  });
});

export default router;
