import { Router, type Request } from "express";
import {
  MODEL_CATALOG,
  buildBusinessContextPrompt,
  formatGeminiError,
  getGeminiClient,
  parseJsonSafe,
  resolveTextModel,
  thinkingConfigForModel,
} from "../ai/geminiClient.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { runTrackedAiCall } from "../services/aiTelemetry.js";
import {
  getComposioMcpUrl,
  getComposioMode,
  isComposioConfigured,
  listComposioConnections,
} from "../services/composio.js";
import { stateStore, type StoryboardSceneRecord } from "../services/stateStore.js";
import { getFirebaseServerConfig } from "../utils/firebaseConfig.js";
import { resolvePublicBaseUrl } from "../utils/paths.js";

const firebaseConfig = getFirebaseServerConfig();
const router = Router();

function wsCtx(req: Request) {
  const areq = req as AuthenticatedRequest;
  const workspaceId = String(req.headers["x-workspace-id"] || req.body?.workspaceId || "default");
  return { workspaceId, actorUid: areq.user?.uid || "anonymous" };
}

router.get("/models", (_req, res) => {
  const key = process.env.GEMINI_API_KEY?.trim();
  res.json({
    geminiConfigured: Boolean(key && key !== "MY_GEMINI_API_KEY"),
    catalog: MODEL_CATALOG,
  });
});

router.get("/models/verify", async (_req, res) => {
  const key = process.env.GEMINI_API_KEY?.trim();
  const checkedAt = new Date().toISOString();
  const allEntries = Object.entries(MODEL_CATALOG).flatMap(([category, list]) =>
    list.map((m) => ({ category, ...m })),
  );

  if (!key || key === "MY_GEMINI_API_KEY") {
    res.json({
      geminiConfigured: false,
      checkedAt,
      liveCheckPerformed: false,
      error: "GEMINI_API_KEY is not configured.",
      models: allEntries.map((m) => ({
        ...m,
        availableOnKey: false,
        verificationStatus: "api_key_missing",
      })),
    });
    return;
  }

  try {
    const ai = getGeminiClient();
    const listedNames = new Set<string>();
    const pager = await ai.models.list();
    for await (const item of pager) {
      const rawName = String((item as { name?: string }).name || "").replace(/^models\//, "");
      if (rawName) listedNames.add(rawName);
    }

    res.json({
      geminiConfigured: true,
      checkedAt,
      liveCheckPerformed: true,
      listedModelCount: listedNames.size,
      models: allEntries.map((m) => {
        const directMatch = listedNames.has(m.id);
        return {
          ...m,
          availableOnKey: directMatch,
          verificationStatus: directMatch ? "verified_available" : "not_in_models_list",
        };
      }),
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.json({
      geminiConfigured: true,
      checkedAt,
      liveCheckPerformed: false,
      error: formatted.message,
      models: allEntries.map((m) => ({
        ...m,
        availableOnKey: false,
        verificationStatus: "verification_failed",
      })),
    });
  }
});

router.get("/integrations/status", async (req, res) => {
  const appUrl = resolvePublicBaseUrl(req);
  const composioConfigured = isComposioConfigured();
  let composioActiveCount = 0;
  let activeToolkits: string[] = [];

  if (composioConfigured) {
    try {
      const conn = await listComposioConnections();
      composioActiveCount = conn.accounts.filter((a) => a.status === "active").length;
      activeToolkits = Object.values(conn.statuses)
        .filter((s) => s.accounts.some((a) => a.status === "active"))
        .map((s) => s.toolkit);
    } catch {
      // Keep status endpoint resilient even if remote MCP times out
    }
  }

  res.json({
    appUrl,
    callbackUrl: `${appUrl.replace(/\/$/, "")}/auth/callback`,
    providers: {
      gemini: {
        configured: Boolean(
          process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY",
        ),
      },
      composio: {
        configured: composioConfigured,
        mode: getComposioMode(),
        mcpUrl: getComposioMcpUrl(),
        activeAccounts: composioActiveCount,
        activeToolkits,
      },
      googleWorkspace: {
        configured: Boolean(firebaseConfig.oAuthClientId),
        clientIdConfigured: Boolean(firebaseConfig.oAuthClientId),
      },
      metaAds: {
        configured:
          Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET) ||
          activeToolkits.includes("metaads") ||
          activeToolkits.includes("instagram"),
      },
      stripe: {
        configured:
          Boolean(process.env.STRIPE_SECRET_KEY) || activeToolkits.includes("stripe"),
      },
      paystack: {
        configured: Boolean(process.env.PAYSTACK_SECRET_KEY),
      },
    },
  });
});

router.get("/oauth/meta/url", (req, res) => {
  const appId = process.env.META_APP_ID?.trim();
  const appUrl = resolvePublicBaseUrl(req);
  const redirectUri = `${appUrl}/auth/callback`;
  if (!appId) {
    res.json({
      configured: false,
      redirectUri,
      message:
        "Direct META_APP_ID is optional because Meta/Instagram OAuth is managed through Composio Connect.",
    });
    return;
  }
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: "ads_management,ads_read,pages_show_list,instagram_basic,instagram_content_publish",
    response_type: "code",
    state: "meta_oauth",
  });
  res.json({
    configured: true,
    redirectUri,
    authUrl: `https://www.facebook.com/v20.0/dialog/oauth?${params.toString()}`,
  });
});

router.post("/ads/forecast", async (req, res) => {
  try {
    const { objective, audience, budgetUsd = 300, creativeTitle, business, model } = req.body as {
      objective?: string;
      audience?: string;
      budgetUsd?: number;
      creativeTitle?: string;
      business?: Record<string, unknown>;
      model?: string;
    };
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const ctx = wsCtx(req);

    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/ads/forecast",
        agent: "Ads Forecast Agent",
        model: selectedModel,
        creditsEstimated: 35,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents: `Generate a Meta Ads campaign plan, directional estimates, and primary ad copy variations.
${buildBusinessContextPrompt(business)}
Objective: ${objective || "App installs"}
Audience: ${audience || "Core ICP"}
Total Budget: $${budgetUsd} USD
Creative: ${creativeTitle || "Video Creative"}

Return ONLY valid JSON:
{
  "estimatedResultsRange": "string",
  "estimatedCpaRange": "string",
  "estimatedReachRange": "string",
  "budgetSplit": {
    "creativeTesting": 90,
    "winnerScaling": 180,
    "retargeting": 30
  },
  "primaryCopyVariants": ["string", "string"],
  "headline": "string",
  "caveat": "Directional AI estimate based on benchmark ranges; actual delivery depends on Meta auction."
}`,
          config: {
            thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
            responseMimeType: "application/json",
          },
        }),
    );

    const data = parseJsonSafe<Record<string, unknown>>(response.text);
    res.json({
      sourceType: "ai_simulation",
      model: selectedModel,
      ...data,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/automations/run", async (req, res) => {
  try {
    const { workflowName = "Weekly Content Engine", business, model } = req.body as {
      workflowName?: string;
      business?: Record<string, unknown>;
      model?: string;
    };

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const ctx = wsCtx(req);
    const startedAt = Date.now();

    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/automations/run",
        agent: "Automation Workflow Engine",
        model: selectedModel,
        creditsEstimated: 180,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents: `Execute a live dry-run of the "${workflowName}" automation workflow for this business.
${buildBusinessContextPrompt(business)}

Simulate each workflow stage with real, actionable marketing output (grounded trend angle + ready-to-review draft script + audience score check), stopping cleanly at the Human Approval gate.

Return ONLY valid JSON:
{
  "summary": "string",
  "trendTopic": "string",
  "generatedScriptTitle": "string",
  "generatedHook": "string",
  "generatedScript": "string",
  "qualityScore": 91,
  "passedThreshold": true,
  "stageLogs": [
    { "node": "Trigger", "status": "completed", "detail": "string" },
    { "node": "Research", "status": "completed", "detail": "string" },
    { "node": "Generate", "status": "completed", "detail": "string" },
    { "node": "Evaluate", "status": "completed", "detail": "string" },
    { "node": "Approval", "status": "awaiting_human", "detail": "Queued for owner review before publishing" }
  ]
}`,
          config: {
            thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
            responseMimeType: "application/json",
          },
        }),
    );

    const data = parseJsonSafe<Record<string, unknown>>(response.text);
    const elapsedMs = Date.now() - startedAt;

    const draftTitle = String(
      data.generatedScriptTitle || data.trendTopic || `${workflowName} Draft`,
    ).trim();
    const draftHook = String(data.generatedHook || "").trim();
    const draftScript = String(data.generatedScript || data.summary || "").trim();
    const draftSummary = String(data.summary || "").trim();
    const draftScore = typeof data.qualityScore === "number" ? data.qualityScore : 88;
    const channels = Array.isArray(business?.channels) ? business.channels : [];
    const primaryPlatform = String(channels[0] || "Instagram Reels");

    const scriptLines = draftScript
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const bodyMid =
      scriptLines.slice(0, Math.max(1, scriptLines.length - 1)).join(" ") ||
      draftScript ||
      "Core value walkthrough";
    const defaultScenes: StoryboardSceneRecord[] = [
      {
        number: "01",
        timeRange: "0:00-0:04",
        durationSec: 4,
        beat: "Hook",
        visual: `Direct-to-camera opening or high-contrast product frame for ${draftTitle}`,
        dialogue: draftHook || scriptLines[0] || draftTitle,
        onScreenText: (draftHook || draftTitle).slice(0, 48),
        cameraDirection: "Tight punch-in framing",
        transition: "Hard cut",
      },
      {
        number: "02",
        timeRange: "0:04-0:20",
        durationSec: 16,
        beat: "Value & Proof",
        visual: "Product workflow walkthrough + measurable outcome callouts",
        dialogue: bodyMid,
        onScreenText: String(data.trendTopic || "Real workflow proof").slice(0, 48),
        cameraDirection: "Screen recording + medium presenter",
        transition: "Smooth whip",
      },
      {
        number: "03",
        timeRange: "0:20-0:30",
        durationSec: 10,
        beat: "Call to Action",
        visual: "Branded end card with next step CTA",
        dialogue: scriptLines[scriptLines.length - 1] || "Start your free trial today via the link.",
        onScreenText: "Get started today",
        cameraDirection: "Clean brand card",
        transition: "Fade out",
      },
    ];

    const createdProject = stateStore.upsertContentProject({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      title: draftTitle,
      platform: primaryPlatform,
      status: "AWAITING_SCRIPT_APPROVAL",
      owner: "Automation Workflow",
      progress: 45,
      creditsUsed: 180,
      brief: String(data.trendTopic || workflowName),
      hook: draftHook,
      script: draftScript,
      cta: "Get started today",
      caption: draftHook ? `${draftHook}\n\n${draftSummary.slice(0, 140)}` : draftSummary,
      qaScore: draftScore,
      formatType: "short_form",
      productionMethod: "hybrid",
      scriptApproved: false,
      scriptVariants: [
        {
          title: draftTitle,
          hook: draftHook || draftTitle,
          angle: String(data.trendTopic || "Automated Workflow Draft"),
          score: draftScore,
          recommended: true,
          body: draftScript,
          cta: "Get started today",
          scenes: defaultScenes,
        },
      ],
      sourceType: "ai_grounded",
    });

    stateStore.addNotification({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      title: `Script draft ready for approval: ${createdProject.title}`,
      message: "Review and approve this automation-generated script to continue to Storyboard or Video Production.",
      category: "automation",
      severity: "info",
      actionPage: "Content Studio",
    });

    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      durationLabel: `${Math.max(1, Math.round(elapsedMs / 1000))}s`,
      creditsUsed: 180,
      project: createdProject,
      ...data,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/analytics/insights", async (req, res) => {
  try {
    const { business, metricsSummary, model } = req.body as {
      business?: Record<string, unknown>;
      metricsSummary?: string;
      model?: string;
    };
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const ctx = wsCtx(req);

    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/analytics/insights",
        agent: "Growth Intelligence Analyst",
        model: selectedModel,
        creditsEstimated: 35,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents: `Analyze these marketing performance signals and generate Growth Intelligence recommendations.
${buildBusinessContextPrompt(business)}
Current Workspace Signals:
${metricsSummary || "Evaluate strategic opportunities based on the Business Notebook and active workspace goals."}

Return ONLY valid JSON:
{
  "headline": "string",
  "insight": "string",
  "confidence": "High" | "Medium",
  "recommendations": [
    { "title": "string", "rationale": "string", "nextAction": "string", "targetPage": "Content Studio" | "SEO & ASO" | "Ads Manager" | "Content Calendar" }
  ]
}`,
          config: {
            thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
            responseMimeType: "application/json",
          },
        }),
    );

    const data = parseJsonSafe<Record<string, unknown>>(response.text);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

export default router;
