import { Router, type Request } from "express";
import {
  buildBusinessContextPrompt,
  formatGeminiError,
  getGeminiClient,
  parseJsonSafe,
  resolveTextModel,
  thinkingConfigForModel,
} from "../ai/geminiClient.js";
import { assertWorkspaceAccess } from "../middleware/auth.js";
import { runTrackedAiCall } from "../services/aiTelemetry.js";
import {
  buildIntegrationRecommendations,
  buildStrategyFeedbackComparison,
  detectTrackingTechnologies,
  encryptCredentialPayload,
  getProviderLabel,
  maskSecret,
  resolveDateRange,
  safeRatioPct,
  sanitizeConnectionSummary,
  testAndSyncProviderConnection,
  type AnalyticsProviderId,
} from "../services/analyticsAdapters.js";
import { stateStore } from "../services/stateStore.js";
import { normalizeAndAssertPublicUrl, safePublicFetch } from "../utils/ssrf.js";

const router = Router();

function getRangeSpecFromReq(req: Request) {
  const q = req.query as Record<string, string | undefined>;
  const range = q.range || (req.body?.range as string | undefined) || "30d";
  const startDate = q.startDate || (req.body?.startDate as string | undefined);
  const endDate = q.endDate || (req.body?.endDate as string | undefined);
  return resolveDateRange(range, startDate, endDate);
}

router.get("/growth/recommendations", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;

  const conns = stateStore.listAnalyticsConnections(ctx.workspaceId);
  const connectedIds = conns.filter((c) => c.status === "connected").map((c) => c.provider);
  const stored = stateStore.getIntegrationRecommendations(ctx.workspaceId);

  if (stored.length > 0) {
    res.json({
      recommendations: stored.map((item) => ({
        ...item,
        connected: connectedIds.includes(String(item.provider)),
      })),
    });
    return;
  }

  const snap = stateStore.getWorkspaceSnapshot(ctx.workspaceId);
  const fallback = buildIntegrationRecommendations({
    websiteUrl: snap?.websiteUrl,
    connectedProviders: connectedIds,
  });
  res.json({ recommendations: fallback });
});

router.post("/growth/audit-tracking", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;

  const { websiteUrl, products, channels } = req.body as {
    websiteUrl?: string;
    products?: string[];
    channels?: string[];
  };
  const snap = stateStore.getWorkspaceSnapshot(ctx.workspaceId);
  const rawUrl = (websiteUrl || snap?.websiteUrl || "").trim();
  if (!rawUrl) {
    res.status(400).json({ error: "Provide a website URL to audit installed tracking SDKs." });
    return;
  }

  try {
    const safeUrl = await normalizeAndAssertPublicUrl(rawUrl);
    const { response, finalUrl } = await safePublicFetch(safeUrl, {
      timeoutMs: 12000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MarketingOSBot/1.0; +https://marketingos.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      res.status(422).json({ error: `Target site returned HTTP ${response.status}` });
      return;
    }
    const html = await response.text();
    const detected = detectTrackingTechnologies(html);
    const conns = stateStore.listAnalyticsConnections(ctx.workspaceId);
    const connectedProviders = conns.filter((c) => c.status === "connected").map((c) => c.provider);

    const recommendations = buildIntegrationRecommendations({
      websiteUrl: finalUrl,
      products,
      channels,
      tracking: detected,
      connectedProviders,
    });
    stateStore.setIntegrationRecommendations(
      ctx.workspaceId,
      recommendations as unknown as Array<Record<string, unknown>>,
    );

    res.json({
      auditedUrl: finalUrl,
      auditedAt: new Date().toISOString(),
      detectedSdks: detected.sdks.map((s) => ({
        ...s,
        connectedInWorkspace: connectedProviders.includes(s.provider),
      })),
      detectedStoreLinks: detected.storeLinks,
      eventTaxonomyGaps: detected.eventTaxonomyGaps,
      recommendations,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to audit website tracking" });
  }
});

router.get("/growth/connections", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const list = stateStore.listAnalyticsConnections(ctx.workspaceId).map(sanitizeConnectionSummary);
  res.json({ connections: list });
});

router.post("/growth/connections", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;

  const {
    provider,
    authMode = "api_key",
    apiKey,
    hostUrl,
    projectId,
    projectName,
    projectUrl,
    serviceAccountJson,
    oauthAccessToken,
    packageName,
    tableMappings,
    runSync = true,
  } = req.body as {
    provider?: AnalyticsProviderId;
    authMode?: "api_key" | "service_account" | "google_oauth" | "composio";
    apiKey?: string;
    hostUrl?: string;
    projectId?: string;
    projectName?: string;
    projectUrl?: string;
    serviceAccountJson?: string;
    oauthAccessToken?: string;
    packageName?: string;
    tableMappings?: Record<string, string | undefined>;
    runSync?: boolean;
  };

  if (!provider) {
    res.status(400).json({ error: "Analytics provider is required." });
    return;
  }

  if (provider === "posthog" && !apiKey?.trim()) {
    res.status(400).json({ error: "PostHog Personal API Key is required." });
    return;
  }
  if (provider === "supabase" && (!projectUrl?.trim() || !apiKey?.trim())) {
    res.status(400).json({ error: "Supabase Project URL and API Key are required." });
    return;
  }
  if (provider === "firebase" && !projectId?.trim()) {
    res.status(400).json({ error: "Firebase Project ID is required." });
    return;
  }
  if (provider === "google_play" && !packageName?.trim()) {
    res.status(400).json({ error: "Android package name (e.g. com.company.app) is required." });
    return;
  }

  const secretHintSource = apiKey || oauthAccessToken || serviceAccountJson || projectId || packageName || "";
  const encryptedCredentials = encryptCredentialPayload({
    apiKey: apiKey?.trim(),
    hostUrl: hostUrl?.trim(),
    projectUrl: projectUrl?.trim(),
    projectId: projectId?.trim(),
    serviceAccountJson: serviceAccountJson?.trim(),
    oauthAccessToken: oauthAccessToken?.trim(),
    packageName: packageName?.trim(),
  });

  const saved = stateStore.upsertAnalyticsConnection({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    provider,
    providerLabel: getProviderLabel(provider),
    authMode,
    encryptedCredentials,
    maskedKeyHint: maskSecret(secretHintSource),
    selectedProjectId: (projectId || packageName || "").trim() || undefined,
    selectedProjectName: (projectName || projectId || packageName || "").trim() || undefined,
    hostUrl: (hostUrl || projectUrl || "").trim() || undefined,
    tableMappings,
    status: "connected",
    completenessStatus: "connected_no_events",
    statusDetail: "Credentials encrypted and stored server-side. Ready to test/sync.",
  });

  stateStore.addAuditLog({
    workspaceId: ctx.workspaceId,
    actorUid: ctx.actorUid,
    action: "growth.connection.upsert",
    target: provider,
    status: "allowed",
    detail: `Encrypted credential stored for ${getProviderLabel(provider)}`,
  });

  if (runSync) {
    const rangeSpec = getRangeSpecFromReq(req);
    const { connection, snapshot } = await testAndSyncProviderConnection(saved, rangeSpec);
    res.json({
      connection: sanitizeConnectionSummary(connection),
      snapshot,
    });
    return;
  }

  res.json({ connection: sanitizeConnectionSummary(saved) });
});

router.patch("/growth/connections/:id/config", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;

  const existing = stateStore.getAnalyticsConnectionById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Analytics connection not found." });
    return;
  }

  const { selectedProjectId, selectedProjectName, tableMappings, resync = true } = req.body as {
    selectedProjectId?: string;
    selectedProjectName?: string;
    tableMappings?: Record<string, string | undefined>;
    resync?: boolean;
  };

  const updated = stateStore.upsertAnalyticsConnection({
    ...existing,
    selectedProjectId: selectedProjectId ?? existing.selectedProjectId,
    selectedProjectName: selectedProjectName ?? existing.selectedProjectName,
    tableMappings: tableMappings ?? existing.tableMappings,
  });

  if (resync) {
    const rangeSpec = getRangeSpecFromReq(req);
    const { connection, snapshot } = await testAndSyncProviderConnection(updated, rangeSpec);
    res.json({ connection: sanitizeConnectionSummary(connection), snapshot });
    return;
  }

  res.json({ connection: sanitizeConnectionSummary(updated) });
});

router.post("/growth/connections/:id/test", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getAnalyticsConnectionById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Analytics connection not found." });
    return;
  }
  const rangeSpec = getRangeSpecFromReq(req);
  const { connection, snapshot } = await testAndSyncProviderConnection(existing, rangeSpec);
  res.json({ connection: sanitizeConnectionSummary(connection), snapshot });
});

router.post("/growth/connections/:id/sync", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getAnalyticsConnectionById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Analytics connection not found." });
    return;
  }
  const rangeSpec = getRangeSpecFromReq(req);
  const { connection, snapshot } = await testAndSyncProviderConnection(existing, rangeSpec);
  res.json({ connection: sanitizeConnectionSummary(connection), snapshot });
});

router.delete("/growth/connections/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const deleted = stateStore.deleteAnalyticsConnection(String(req.params.id), ctx.workspaceId);
  if (!deleted) {
    res.status(404).json({ error: "Analytics connection not found." });
    return;
  }
  stateStore.addAuditLog({
    workspaceId: ctx.workspaceId,
    actorUid: ctx.actorUid,
    action: "growth.connection.delete",
    target: String(req.params.id),
    status: "allowed",
    detail: "Revoked analytics credentials and deleted cached provider snapshots.",
  });
  res.json({ deleted: true });
});

router.get("/growth/dashboard", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;

  const rangeSpec = getRangeSpecFromReq(req);
  const compareEnabled = req.query.compare !== "false";
  const forceRefresh = req.query.refresh === "true";

  const conns = stateStore.listAnalyticsConnections(ctx.workspaceId);
  if (forceRefresh && conns.length > 0) {
    await Promise.all(conns.map((c) => testAndSyncProviderConnection(c, rangeSpec)));
  }

  const latestConns = stateStore.listAnalyticsConnections(ctx.workspaceId);
  const allSnapshots = stateStore.listGrowthSnapshots(ctx.workspaceId);

  const providerCards = latestConns.map((conn) => {
    const snap =
      allSnapshots.find((s) => s.connectionId === conn.id && s.periodKey === rangeSpec.periodKey) ||
      allSnapshots.find((s) => s.connectionId === conn.id);

    return {
      connectionId: conn.id,
      provider: conn.provider,
      providerLabel: conn.providerLabel,
      projectOrProperty: snap?.projectOrProperty || conn.selectedProjectName || conn.providerLabel,
      completenessStatus: snap?.completenessStatus || conn.completenessStatus,
      statusDetail: snap?.statusDetail || conn.statusDetail,
      retrievedAt: snap?.retrievedAt || conn.lastSyncedAt || conn.updatedAt,
      metrics: snap?.metrics || [],
      timeSeries: snap?.timeSeries || [],
      topPagesOrEvents: snap?.topPagesOrEvents || [],
      channels: snap?.channels || [],
    };
  });

  const connectedProviders = latestConns.filter((c) => c.status === "connected").map((c) => c.provider);
  const storedRecs = stateStore.getIntegrationRecommendations(ctx.workspaceId);
  const wsSnap = stateStore.getWorkspaceSnapshot(ctx.workspaceId);
  const recommendations =
    storedRecs.length > 0
      ? storedRecs.map((r) => ({ ...r, connected: connectedProviders.includes(String(r.provider)) }))
      : buildIntegrationRecommendations({
          websiteUrl: wsSnap?.websiteUrl,
          connectedProviders,
        });

  res.json({
    workspaceId: ctx.workspaceId,
    range: rangeSpec.range,
    reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
    previousPeriod: { startDate: rangeSpec.prevStartDate, endDate: rangeSpec.prevEndDate },
    compareEnabled,
    overlapWarning:
      "Per-provider metrics are intentionally kept separate because PostHog distinct_ids, GA4 sessions/activeUsers, Firebase Auth accounts, and Supabase table counts use incompatible identity models.",
    connections: latestConns.map(sanitizeConnectionSummary),
    providerCards,
    recommendations,
    strategyFeedback: buildStrategyFeedbackComparison(ctx.workspaceId),
  });
});

router.post("/growth/funnel", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;

  const { stages = [] } = req.body as {
    stages?: Array<{ stageName: string; provider: AnalyticsProviderId; metricKey?: string }>;
  };

  const snapshots = stateStore.listGrowthSnapshots(ctx.workspaceId);
  const results = stages.map((st, idx) => {
    const snap = snapshots.find((s) => s.provider === st.provider);
    if (!snap) {
      return {
        stageName: st.stageName,
        provider: st.provider,
        sourceMapping: `${getProviderLabel(st.provider)} · Not connected`,
        count: null,
        conversionFromPreviousPct: null,
        completenessStatus: "not_connected",
        note: `Connect ${getProviderLabel(st.provider)} to evaluate this funnel step.`,
      };
    }
    const metricObj =
      (snap.metrics.find((m) => m.key === st.metricKey) as { key?: string; label?: string; value?: number | null } | undefined) ||
      (snap.metrics[0] as { key?: string; label?: string; value?: number | null } | undefined);

    const count = typeof metricObj?.value === "number" ? metricObj.value : null;
    return {
      stageName: st.stageName,
      provider: st.provider,
      sourceMapping: `${snap.providerLabel} · ${metricObj?.label || st.metricKey || "Primary metric"}`,
      count,
      conversionFromPreviousPct: idx === 0 ? 100 : null,
      completenessStatus: snap.completenessStatus,
      note: count === null ? snap.statusDetail : undefined,
    };
  });

  // Compute safe step-to-step conversion percentages only where both values exist & previous > 0
  for (let i = 1; i < results.length; i++) {
    results[i].conversionFromPreviousPct = safeRatioPct(results[i].count, results[i - 1].count);
  }

  res.json({ stages: results });
});

router.get("/growth/strategy-feedback", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({ feedback: buildStrategyFeedbackComparison(ctx.workspaceId) });
});

router.post("/growth/analyst/ask", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;

  const { question, business, model } = req.body as {
    question?: string;
    business?: Record<string, unknown>;
    model?: string;
  };
  if (!question?.trim()) {
    res.status(400).json({ error: "Ask a question for the Business Growth Analyst." });
    return;
  }

  try {
    const snapshots = stateStore.listGrowthSnapshots(ctx.workspaceId);
    const conns = stateStore.listAnalyticsConnections(ctx.workspaceId).map(sanitizeConnectionSummary);
    const strategies = stateStore.listStrategies(ctx.workspaceId);
    const seoReports = stateStore.getSeoAuditReports(ctx.workspaceId).slice(0, 2);

    const groundedEvidence = {
      connectedSources: conns.map((c) => ({
        provider: c.providerLabel,
        project: c.selectedProjectName,
        completenessStatus: c.completenessStatus,
        statusDetail: c.statusDetail,
        lastSyncedAt: c.lastSyncedAt,
      })),
      retrievedMetricsByProvider: snapshots.map((s) => ({
        provider: s.providerLabel,
        period: `${s.startDate} to ${s.endDate}`,
        completenessStatus: s.completenessStatus,
        metrics: s.metrics.map((m) => ({
          label: m.label,
          value: m.value,
          previousValue: m.previousValue,
          growthPct: m.growthPct,
        })),
        topPagesOrEvents: s.topPagesOrEvents.slice(0, 5),
        channels: s.channels.slice(0, 5),
      })),
      activeStrategy: strategies[0]
        ? {
            title: strategies[0].title,
            northStarMetric: strategies[0].northStarMetric,
            pillars: strategies[0].contentPillars,
          }
        : null,
      latestSeoScore: seoReports[0]?.healthScore ?? null,
    };

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/growth/analyst/ask",
        agent: "Business Growth Analyst",
        model: selectedModel,
        creditsEstimated: 30,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents: `Answer the founder's growth question strictly using the verified telemetry below.
${buildBusinessContextPrompt(business)}

Verified Telemetry & Context JSON:
${JSON.stringify(groundedEvidence, null, 2)}

Founder Question:
${question}

CRITICAL HONESTY RULES:
1. Cite ONLY numbers that exist in Verified Telemetry JSON above. Never invent traffic, conversion rates, or benchmarks.
2. If data needed to answer is missing or \`not_connected\` / \`permission_restricted\`, state clearly which provider/metric is missing and what connecting it unlocks.
3. Keep separate provider user definitions distinct (never add PostHog users + GA4 users + Firebase Auth users together).

Return ONLY valid JSON:
{
  "answer": "Clear, structured answer citing exact provenance and numbers",
  "dataGaps": ["Any missing source or permission limitation blocking full insight"],
  "recommendedActions": [
    { "title": "Action", "reason": "Grounded reason", "priority": "High" | "Medium" | "Low" }
  ]
}`,
          config: {
            systemInstruction:
              "You are an analytical Chief Growth Officer. Ground every metric claim in the retrieved JSON payload and disclose all telemetry gaps.",
            thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
            responseMimeType: "application/json",
          },
        }),
    );

    const parsed = parseJsonSafe<Record<string, unknown>>(response.text);
    res.json({ model: selectedModel, ...parsed });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.get("/growth/reports", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({ reports: stateStore.listGrowthReports(ctx.workspaceId) });
});

router.post("/growth/reports/generate", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;

  const { cadence = "weekly", range = "7d", startDate, endDate, saveToMemory = false } = req.body as {
    cadence?: "daily" | "weekly" | "monthly";
    range?: string;
    startDate?: string;
    endDate?: string;
    saveToMemory?: boolean;
  };

  const rangeSpec = resolveDateRange(
    range || (cadence === "daily" ? "today" : cadence === "monthly" ? "30d" : "7d"),
    startDate,
    endDate,
  );
  const snapshots = stateStore.listGrowthSnapshots(ctx.workspaceId);
  const conns = stateStore.listAnalyticsConnections(ctx.workspaceId);
  const feedback = buildStrategyFeedbackComparison(ctx.workspaceId);

  const highlights = conns.map((c) => {
    const snap = snapshots.find((s) => s.connectionId === c.id);
    const keyFindings = (snap?.metrics || []).map((m) => {
      const val = m.value !== null && m.value !== undefined ? String(m.value) : "Unavailable";
      const growth = typeof m.growthPct === "number" ? ` (${m.growthPct >= 0 ? "+" : ""}${m.growthPct}% vs prev)` : "";
      return `${String(m.label)}: ${val}${growth}`;
    });
    return {
      provider: c.providerLabel,
      status: snap?.completenessStatus || c.completenessStatus,
      keyFindings: keyFindings.length > 0 ? keyFindings : [snap?.statusDetail || c.statusDetail],
    };
  });

  const recs: string[] = [];
  if (conns.length === 0) {
    recs.push("Connect PostHog, GA4, Search Console, or Supabase in Integrations to unlock verified performance reporting.");
  }
  const missingRecs = stateStore
    .getIntegrationRecommendations(ctx.workspaceId)
    .filter((r) => !conns.some((c) => c.provider === r.provider))
    .slice(0, 3);
  for (const r of missingRecs) {
    recs.push(`Connect ${String(r.providerLabel)}: ${String(r.whyRecommended)}`);
  }
  if (feedback) {
    recs.push(`Strategy Check (${feedback.strategyTitle}): ${feedback.summary}`);
  }

  const title = `${cadence[0].toUpperCase()}${cadence.slice(1)} Growth Intelligence Report (${rangeSpec.startDate} → ${rangeSpec.endDate})`;
  const executiveSummary =
    conns.length === 0
      ? "No external analytics sources are connected to this workspace yet. Connect telemetry providers to replace gap disclosures with live conversion & acquisition data."
      : `Compiled verified metrics from ${conns.length} connected source(s) across ${rangeSpec.startDate} to ${rangeSpec.endDate}.`;

  const mdLines = [
    `# ${title}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `## Executive Summary`,
    executiveSummary,
    "",
    `## Connected Data Sources`,
    ...(highlights.length
      ? highlights.flatMap((h) => [
          `### ${h.provider} (${h.status})`,
          ...h.keyFindings.map((f) => `- ${f}`),
          "",
        ])
      : ["- No analytics sources connected yet.", ""]),
    `## Recommendations & Next Steps`,
    ...recs.map((r) => `- ${r}`),
  ];

  const report = stateStore.addGrowthReport({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    cadence,
    title,
    reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
    executiveSummary,
    providerHighlights: highlights,
    recommendations: recs,
    markdown: mdLines.join("\n"),
  });

  if (saveToMemory) {
    stateStore.addMemory({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      scope: "business",
      source: "verified_business",
      approved: true,
      title,
      content: `${executiveSummary} ${highlights.map((h) => `${h.provider}: ${h.keyFindings.join(", ")}`).join(" | ")}`,
      tags: ["growth-report", cadence],
    });
  }

  res.json({ report });
});

export default router;
