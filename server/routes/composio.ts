import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  MARKETING_TOOLKITS,
  disconnectComposioAccount,
  executeComposioTool,
  getComposioMcpUrl,
  getComposioMode,
  initiateComposioConnection,
  isComposioConfigured,
  listComposioConnections,
  probeComposioHealth,
  searchComposioTools,
} from "../services/composio.js";
import {
  SOCIAL_PLATFORM_DEFINITIONS,
  buildSocialCoverageReport,
} from "../services/socialCapabilityMatrix.js";
import { stateStore } from "../services/stateStore.js";
import { resolvePublicBaseUrl } from "../utils/paths.js";

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

function getCallbackUrl(req: AuthenticatedRequest): string {
  return `${resolvePublicBaseUrl(req)}/auth/callback`;
}

function resolvePublicMediaUrl(mediaUrl: string | undefined, req: AuthenticatedRequest): string | undefined {
  if (!mediaUrl?.trim()) return undefined;
  const trimmed = mediaUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) {
    return `${resolvePublicBaseUrl(req)}${trimmed}`;
  }
  return undefined;
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

const ConnectSchema = z.object({
  toolkit: z.string().min(2).max(64),
  alias: z.string().max(120).optional(),
  workspaceId: z.string().max(128).optional(),
});

const DisconnectSchema = z.object({
  toolkit: z.string().min(2).max(64),
  accountId: z.string().min(1).max(160),
  workspaceId: z.string().max(128).optional(),
});

const ExecuteSchema = z.object({
  toolkit: z.string().min(2).max(64),
  toolSlug: z.string().min(3).max(120),
  arguments: z.record(z.string(), z.unknown()).default({}),
  accountId: z.string().max(160).optional(),
  confirmed: z.literal(true),
  workspaceId: z.string().max(128).optional(),
});

const PublishSchema = z.object({
  platform: z.string().min(1).max(80),
  caption: z.string().min(1).max(5000),
  title: z.string().max(240).optional(),
  mediaUrl: z.string().max(1000).optional(),
  mediaType: z.enum(["image", "video", "reels"]).optional(),
  pageId: z.string().max(120).optional(),
  confirmed: z.literal(true),
  idempotencyKey: z.string().min(4).max(160),
  workspaceId: z.string().max(128).optional(),
});

const MetaCampaignCreateSchema = z.object({
  adAccountId: z.string().min(2).max(80).optional(),
  name: z.string().min(2).max(200),
  objective: z.string().min(2).max(80).default("OUTCOME_TRAFFIC"),
  dailyBudgetUsd: z.number().min(1).max(50000),
  confirmed: z.literal(true),
  budgetAuthorized: z.literal(true),
  idempotencyKey: z.string().min(4).max(160),
  workspaceId: z.string().max(128).optional(),
});

router.get("/composio/status", async (_req, res) => {
  const health = await probeComposioHealth();
  res.json({
    ...health,
    toolkits: MARKETING_TOOLKITS,
  });
});

router.get("/composio/connections", async (req: AuthenticatedRequest, res) => {
  const { workspaceId } = getContext(req);
  if (!isComposioConfigured()) {
    res.json({
      configured: false,
      mode: "unconfigured",
      mcpUrl: getComposioMcpUrl(),
      statuses: {},
      accounts: [],
      socialCoverage: buildSocialCoverageReport({}),
      logs: stateStore.getIntegrationLogs(workspaceId).slice(0, 25),
    });
    return;
  }

  try {
    const { statuses, accounts, mode } = await listComposioConnections(
      [...MARKETING_TOOLKITS],
      workspaceId,
    );
    const socialCoverage = buildSocialCoverageReport(statuses);
    res.json({
      configured: true,
      mode,
      mcpUrl: getComposioMcpUrl(),
      statuses,
      accounts,
      socialCoverage,
      logs: stateStore.getIntegrationLogs(workspaceId).slice(0, 25),
    });
  } catch (err) {
    res.status(502).json({
      configured: true,
      mode: getComposioMode(),
      error: err instanceof Error ? err.message : "Failed to load Composio connections",
      socialCoverage: buildSocialCoverageReport({}),
      logs: stateStore.getIntegrationLogs(workspaceId).slice(0, 25),
    });
  }
});

router.post("/composio/connect", async (req: AuthenticatedRequest, res) => {
  const parsed = ConnectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request payload" });
    return;
  }

  const { workspaceId, actorUid } = getContext(req);
  try {
    const result = await initiateComposioConnection({
      toolkit: parsed.data.toolkit,
      alias: parsed.data.alias,
      callbackUrl: getCallbackUrl(req),
      workspaceId,
      userId: actorUid,
    });

    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: "composio.connect.initiated",
      target: parsed.data.toolkit,
      status: "allowed",
      detail: `Generated OAuth Connect Link for ${parsed.data.toolkit}`,
    });

    res.json(result);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to initiate Composio connection",
    });
  }
});

router.delete("/composio/accounts", async (req: AuthenticatedRequest, res) => {
  const parsed = DisconnectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "toolkit and accountId are required" });
    return;
  }

  const { workspaceId, actorUid } = getContext(req);
  try {
    const result = await disconnectComposioAccount({
      toolkit: parsed.data.toolkit,
      accountId: parsed.data.accountId,
      workspaceId,
    });
    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: "composio.account.disconnected",
      target: `${parsed.data.toolkit}:${parsed.data.accountId}`,
      status: "allowed",
      detail: `Disconnected ${parsed.data.toolkit} account`,
    });
    stateStore.addNotification({
      workspaceId,
      ownerUid: actorUid,
      title: `${parsed.data.toolkit} disconnected`,
      message: `Removed connected account ${parsed.data.accountId}.`,
      category: "integration",
      severity: "info",
      actionPage: "Integrations",
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to disconnect Composio account",
    });
  }
});

router.post("/composio/execute", async (req: AuthenticatedRequest, res) => {
  const parsed = ExecuteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Explicit confirmation (confirmed: true) and valid toolSlug are required.",
    });
    return;
  }

  const { workspaceId, actorUid } = getContext(req);
  try {
    const out = await executeComposioTool({
      toolkit: parsed.data.toolkit,
      toolSlug: parsed.data.toolSlug,
      arguments: parsed.data.arguments,
      accountId: parsed.data.accountId,
      workspaceId,
      userId: actorUid,
    });
    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: `composio.execute.${parsed.data.toolSlug}`,
      target: parsed.data.toolkit,
      status: "allowed",
      detail: `Executed ${parsed.data.toolSlug} with explicit user confirmation`,
    });
    res.json(out);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Composio tool execution failed",
    });
  }
});

router.post("/social/profile", async (req: AuthenticatedRequest, res) => {
  const { workspaceId, actorUid } = getContext(req);
  const platform = String(req.body?.platform || "Instagram");
  const toolkit = mapPlatformToToolkit(platform);

  if (!isComposioConfigured()) {
    res.json({
      connected: false,
      platform,
      toolkit,
      status: "Awaiting Credentials",
      message: "COMPOSIO_API_KEY is not configured.",
    });
    return;
  }

  try {
    const { statuses } = await listComposioConnections([toolkit], workspaceId);
    const activeAccount = statuses[toolkit]?.accounts.find((a) => a.status === "active");

    if (!activeAccount) {
      res.json({
        connected: false,
        platform,
        toolkit,
        status: "Setup Required",
        message: `No active ${platform} account connected yet. Connect ${platform} via OAuth first.`,
      });
      return;
    }

    if (toolkit === "instagram") {
      const infoRes = await executeComposioTool<Record<string, unknown>>({
        toolkit: "instagram",
        toolSlug: "INSTAGRAM_GET_USER_INFO",
        arguments: { ig_user_id: "me" },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });

      const igId = String(infoRes.data?.id || activeAccount.externalUserId || "me");
      const mediaRes = await executeComposioTool<{ data?: Array<Record<string, unknown>> }>({
        toolkit: "instagram",
        toolSlug: "INSTAGRAM_GET_IG_USER_MEDIA",
        arguments: { ig_user_id: igId, limit: 8 },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      }).catch(() => ({ data: { data: [] } }));

      res.json({
        connected: true,
        sourceType: "live_api",
        platform: "Instagram",
        toolkit: "instagram",
        accountId: activeAccount.id,
        profile: infoRes.data,
        recentMedia: mediaRes.data?.data || [],
      });
      return;
    }

    if (toolkit === "facebook") {
      const pages = await executeComposioTool<Record<string, unknown>>({
        toolkit: "facebook",
        toolSlug: "FACEBOOK_LIST_MANAGED_PAGES",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      res.json({
        connected: true,
        sourceType: "live_api",
        platform: "Facebook",
        toolkit: "facebook",
        accountId: activeAccount.id,
        profile: pages.data,
      });
      return;
    }

    if (toolkit === "youtube") {
      const channels = await executeComposioTool<Record<string, unknown>>({
        toolkit: "youtube",
        toolSlug: "YOUTUBE_LIST_CHANNELS",
        arguments: { mine: true },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      res.json({
        connected: true,
        sourceType: "live_api",
        platform: "YouTube",
        toolkit: "youtube",
        accountId: activeAccount.id,
        profile: channels.data,
      });
      return;
    }

    if (toolkit === "linkedin") {
      const me = await executeComposioTool<Record<string, unknown>>({
        toolkit: "linkedin",
        toolSlug: "LINKEDIN_GET_MY_INFO",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      res.json({
        connected: true,
        sourceType: "live_api",
        platform: "LinkedIn",
        toolkit: "linkedin",
        accountId: activeAccount.id,
        profile: me.data,
      });
      return;
    }

    if (toolkit === "twitter") {
      const me = await executeComposioTool<Record<string, unknown>>({
        toolkit: "twitter",
        toolSlug: "TWITTER_USER_LOOKUP_ME",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      res.json({
        connected: true,
        sourceType: "live_api",
        platform: "X",
        toolkit: "twitter",
        accountId: activeAccount.id,
        profile: me.data,
      });
      return;
    }

    if (toolkit === "tiktok") {
      const info = await executeComposioTool<Record<string, unknown>>({
        toolkit: "tiktok",
        toolSlug: "TIKTOK_QUERY_CREATOR_INFO",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      res.json({
        connected: true,
        sourceType: "live_api",
        platform: "TikTok",
        toolkit: "tiktok",
        accountId: activeAccount.id,
        profile: info.data,
      });
      return;
    }

    res.status(400).json({ error: `Unsupported platform "${platform}"` });
  } catch (err) {
    res.status(502).json({
      connected: true,
      platform,
      toolkit,
      error: err instanceof Error ? err.message : "Failed to fetch live social profile",
    });
  }
});

router.post("/social/publish", async (req: AuthenticatedRequest, res) => {
  const parsed = PublishSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error:
        "Publishing requires explicit confirmation (confirmed: true), idempotencyKey, platform, and caption.",
    });
    return;
  }

  const { workspaceId, actorUid } = getContext(req);
  const { platform, caption, mediaUrl, mediaType, pageId, idempotencyKey, title } = parsed.data;

  const existing = stateStore.getIdempotentResult(idempotencyKey);
  if (existing?.status === "completed") {
    res.json({ deduplicated: true, ...(existing.result as Record<string, unknown>) });
    return;
  }

  const toolkit = mapPlatformToToolkit(platform);
  if (!isComposioConfigured()) {
    res.status(503).json({
      published: false,
      needsConnection: true,
      status: "Awaiting Credentials",
      error: "COMPOSIO_API_KEY is missing on the server.",
    });
    return;
  }

  try {
    const { statuses } = await listComposioConnections([toolkit], workspaceId);
    const activeAccount = statuses[toolkit]?.accounts.find((a) => a.status === "active");
    if (!activeAccount) {
      res.status(412).json({
        published: false,
        needsConnection: true,
        toolkit,
        status: "Setup Required",
        error: `${platform} is not connected via Composio OAuth. Connect ${platform} in Social Accounts first.`,
      });
      return;
    }

    const publicMedia = resolvePublicMediaUrl(mediaUrl, req);
    let providerPostId = "";
    let providerResponse: Record<string, unknown> = {};

    if (toolkit === "instagram") {
      if (!publicMedia) {
        res.status(400).json({
          published: false,
          error:
            "Instagram Graph API requires a public image or video URL (text-only posts are unsupported by Instagram).",
        });
        return;
      }

      const info = await executeComposioTool<{ id?: string }>({
        toolkit: "instagram",
        toolSlug: "INSTAGRAM_GET_USER_INFO",
        arguments: { ig_user_id: "me" },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      const igUserId = String(info.data?.id || activeAccount.externalUserId || "me");
      const isVideo =
        mediaType === "video" ||
        mediaType === "reels" ||
        /\.(mp4|mov|webm)(\?|$)/i.test(publicMedia);

      const container = await executeComposioTool<{ id?: string; creation_id?: string }>({
        toolkit: "instagram",
        toolSlug: "INSTAGRAM_POST_IG_USER_MEDIA",
        arguments: {
          ig_user_id: igUserId,
          caption,
          ...(isVideo
            ? { video_url: publicMedia, media_type: "REELS" }
            : { image_url: publicMedia }),
        },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });

      const creationId = String(container.data?.id || container.data?.creation_id || "");
      if (!creationId) {
        throw new Error("Instagram did not return a container creation_id.");
      }

      const published = await executeComposioTool<{ id?: string }>({
        toolkit: "instagram",
        toolSlug: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
        arguments: {
          ig_user_id: igUserId,
          creation_id: creationId,
        },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });

      providerPostId = String(published.data?.id || creationId);
      providerResponse = published.data;
    } else if (toolkit === "facebook") {
      let targetPageId = pageId;
      if (!targetPageId) {
        const pages = await executeComposioTool<{ data?: Array<{ id?: string }> }>({
          toolkit: "facebook",
          toolSlug: "FACEBOOK_LIST_MANAGED_PAGES",
          arguments: {},
          accountId: activeAccount.id,
          workspaceId,
          userId: actorUid,
        });
        targetPageId = pages.data?.data?.[0]?.id;
      }
      if (!targetPageId) {
        throw new Error("No managed Facebook Page found on connected account.");
      }

      const fbRes = publicMedia
        ? await executeComposioTool<{ id?: string; post_id?: string }>({
            toolkit: "facebook",
            toolSlug: "FACEBOOK_CREATE_PHOTO_POST",
            arguments: { page_id: targetPageId, url: publicMedia, caption },
            accountId: activeAccount.id,
            workspaceId,
            userId: actorUid,
          })
        : await executeComposioTool<{ id?: string; post_id?: string }>({
            toolkit: "facebook",
            toolSlug: "FACEBOOK_CREATE_POST",
            arguments: { page_id: targetPageId, message: caption },
            accountId: activeAccount.id,
            workspaceId,
            userId: actorUid,
          });
      providerPostId = String(fbRes.data?.id || fbRes.data?.post_id || "");
      providerResponse = fbRes.data;
    } else if (toolkit === "linkedin") {
      const me = await executeComposioTool<{ sub?: string; id?: string }>({
        toolkit: "linkedin",
        toolSlug: "LINKEDIN_GET_MY_INFO",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      const personId = String(me.data?.sub || me.data?.id || activeAccount.externalUserId || "");
      const authorUrn = personId.startsWith("urn:") ? personId : `urn:li:person:${personId}`;
      const liRes = await executeComposioTool<{ id?: string }>({
        toolkit: "linkedin",
        toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST",
        arguments: {
          author: authorUrn,
          commentary: caption,
          visibility: "PUBLIC",
        },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      providerPostId = String(liRes.data?.id || "");
      providerResponse = liRes.data;
    } else if (toolkit === "twitter") {
      const xRes = await executeComposioTool<{ data?: { id?: string }; id?: string }>({
        toolkit: "twitter",
        toolSlug: "TWITTER_CREATION_OF_A_POST",
        arguments: { text: caption.slice(0, 280) },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      providerPostId = String(xRes.data?.data?.id || xRes.data?.id || "");
      providerResponse = xRes.data;
    } else if (toolkit === "tiktok") {
      if (!publicMedia) {
        res.status(400).json({
          published: false,
          error: "TikTok requires a public video URL.",
        });
        return;
      }
      const ttRes = await executeComposioTool<Record<string, unknown>>({
        toolkit: "tiktok",
        toolSlug: "TIKTOK_PUBLISH_VIDEO",
        arguments: { video_url: publicMedia, title: (title || caption).slice(0, 150) },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      providerPostId = String(ttRes.data?.publish_id || ttRes.data?.id || "");
      providerResponse = ttRes.data;
    } else if (toolkit === "youtube") {
      if (!publicMedia) {
        res.status(400).json({
          published: false,
          error: "YouTube upload requires a video asset.",
        });
        return;
      }
      const ytRes = await executeComposioTool<Record<string, unknown>>({
        toolkit: "youtube",
        toolSlug: "YOUTUBE_UPLOAD_VIDEO",
        arguments: {
          videoFilePath: publicMedia,
          title: (title || "Marketing OS Video").slice(0, 100),
          description: caption,
          privacyStatus: "private",
        },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      providerPostId = String(ytRes.data?.id || "");
      providerResponse = ytRes.data;
    } else {
      throw new Error(`Unsupported platform "${platform}"`);
    }

    const payload = {
      published: true,
      sourceType: "live_api",
      platform,
      toolkit,
      accountId: activeAccount.id,
      providerPostId: providerPostId || "submitted",
      data: providerResponse,
    };

    stateStore.setIdempotentResult(idempotencyKey, "completed", payload);
    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: "social.publish",
      target: `${platform}:${activeAccount.id}`,
      status: "allowed",
      detail: `Published post "${(title || caption).slice(0, 60)}" (id: ${providerPostId || "submitted"})`,
    });
    stateStore.addNotification({
      workspaceId,
      ownerUid: actorUid,
      title: `Published to ${platform}`,
      message: `"${(title || caption).slice(0, 60)}" was delivered via Composio (${providerPostId || "confirmed"}).`,
      category: "publishing",
      severity: "success",
      actionPage: "Publishing Queue",
    });

    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Live social publishing failed";
    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: "social.publish",
      target: platform,
      status: "error",
      detail: message,
    });
    res.status(502).json({
      published: false,
      platform,
      toolkit,
      error: message,
    });
  }
});

router.get("/social/capabilities", async (req: AuthenticatedRequest, res) => {
  const { workspaceId } = getContext(req);
  if (!isComposioConfigured()) {
    res.json({
      definitions: SOCIAL_PLATFORM_DEFINITIONS,
      coverage: buildSocialCoverageReport({}),
    });
    return;
  }
  try {
    const { statuses } = await listComposioConnections([...MARKETING_TOOLKITS], workspaceId);
    res.json({
      definitions: SOCIAL_PLATFORM_DEFINITIONS,
      coverage: buildSocialCoverageReport(statuses),
    });
  } catch {
    res.json({
      definitions: SOCIAL_PLATFORM_DEFINITIONS,
      coverage: buildSocialCoverageReport({}),
    });
  }
});

router.get("/ads/meta/accounts", async (req: AuthenticatedRequest, res) => {
  const { workspaceId, actorUid } = getContext(req);
  if (!isComposioConfigured()) {
    res.json({
      connected: false,
      status: "Awaiting Credentials",
      accounts: [],
      message: "COMPOSIO_API_KEY is missing.",
    });
    return;
  }

  try {
    const { statuses } = await listComposioConnections(["metaads"], workspaceId);
    const activeAccount = statuses.metaads?.accounts.find((a) => a.status === "active");
    if (!activeAccount) {
      res.json({
        connected: false,
        status: "Setup Required",
        accounts: [],
        message: "Connect Meta Ads via Composio OAuth to load live Ad Accounts & Campaigns.",
      });
      return;
    }

    const adAccounts = await executeComposioTool<{ data?: Array<Record<string, unknown>> }>({
      toolkit: "metaads",
      toolSlug: "METAADS_GET_AD_ACCOUNTS",
      arguments: {},
      accountId: activeAccount.id,
      workspaceId,
      userId: actorUid,
    });

    res.json({
      connected: true,
      sourceType: "live_api",
      accountId: activeAccount.id,
      accounts: adAccounts.data?.data || [],
    });
  } catch (err) {
    res.status(502).json({
      connected: false,
      status: "Error",
      accounts: [],
      error: err instanceof Error ? err.message : "Failed to load Meta Ad Accounts",
    });
  }
});

router.get("/ads/meta/campaigns", async (req: AuthenticatedRequest, res) => {
  const { workspaceId, actorUid } = getContext(req);
  const requestedAdAccountId =
    typeof req.query.adAccountId === "string" ? req.query.adAccountId : "";

  if (!isComposioConfigured()) {
    res.json({ connected: false, campaigns: [], status: "Awaiting Credentials" });
    return;
  }

  try {
    const { statuses } = await listComposioConnections(["metaads"], workspaceId);
    const activeAccount = statuses.metaads?.accounts.find((a) => a.status === "active");
    if (!activeAccount) {
      res.json({ connected: false, campaigns: [], status: "Setup Required" });
      return;
    }

    let adAccountId = requestedAdAccountId;
    if (!adAccountId) {
      const adAccs = await executeComposioTool<{ data?: Array<{ id?: string }> }>({
        toolkit: "metaads",
        toolSlug: "METAADS_GET_AD_ACCOUNTS",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      adAccountId = String(adAccs.data?.data?.[0]?.id || "");
    }

    if (!adAccountId) {
      res.json({ connected: true, campaigns: [], message: "No Meta Ad Account found on user." });
      return;
    }

    const campaigns = await executeComposioTool<{ data?: Array<Record<string, unknown>> }>({
      toolkit: "metaads",
      toolSlug: "METAADS_LIST_CAMPAIGNS",
      arguments: { ad_account_id: adAccountId },
      accountId: activeAccount.id,
      workspaceId,
      userId: actorUid,
    });

    res.json({
      connected: true,
      sourceType: "live_api",
      adAccountId,
      campaigns: campaigns.data?.data || [],
    });
  } catch (err) {
    res.status(502).json({
      connected: false,
      campaigns: [],
      error: err instanceof Error ? err.message : "Failed to list Meta campaigns",
    });
  }
});

router.post("/ads/meta/campaigns", async (req: AuthenticatedRequest, res) => {
  const parsed = MetaCampaignCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error:
        "Meta campaign submission requires confirmed: true, budgetAuthorized: true, idempotencyKey, name, and dailyBudgetUsd.",
    });
    return;
  }

  const { workspaceId, actorUid } = getContext(req);
  const { idempotencyKey, name, objective, dailyBudgetUsd } = parsed.data;
  const cached = stateStore.getIdempotentResult(idempotencyKey);
  if (cached?.status === "completed") {
    res.json({ deduplicated: true, ...(cached.result as Record<string, unknown>) });
    return;
  }

  try {
    const { statuses } = await listComposioConnections(["metaads"], workspaceId);
    const activeAccount = statuses.metaads?.accounts.find((a) => a.status === "active");
    if (!activeAccount) {
      res.status(412).json({
        created: false,
        needsConnection: true,
        status: "Setup Required",
        error: "Meta Ads toolkit is not connected. Connect Meta Ads via Composio OAuth first.",
      });
      return;
    }

    let adAccountId = parsed.data.adAccountId || "";
    if (!adAccountId) {
      const adAccs = await executeComposioTool<{ data?: Array<{ id?: string }> }>({
        toolkit: "metaads",
        toolSlug: "METAADS_GET_AD_ACCOUNTS",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid,
      });
      adAccountId = String(adAccs.data?.data?.[0]?.id || "");
    }
    if (!adAccountId) {
      throw new Error("No Meta Ad Account ID available on the connected account.");
    }

    const created = await executeComposioTool<{ id?: string }>({
      toolkit: "metaads",
      toolSlug: "METAADS_CREATE_CAMPAIGN",
      arguments: {
        ad_account_id: adAccountId,
        name,
        objective,
        status: "PAUSED",
        daily_budget: Math.round(dailyBudgetUsd * 100),
      },
      accountId: activeAccount.id,
      workspaceId,
      userId: actorUid,
    });

    const resultPayload = {
      created: true,
      sourceType: "live_api",
      campaignId: String(created.data?.id || ""),
      adAccountId,
      status: "PAUSED",
      data: created.data,
    };
    stateStore.setIdempotentResult(idempotencyKey, "completed", resultPayload);
    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: "metaads.campaign.create",
      target: adAccountId,
      status: "allowed",
      detail: `Created PAUSED Meta Ads campaign "${name}" ($${dailyBudgetUsd}/day)`,
    });
    stateStore.addNotification({
      workspaceId,
      ownerUid: actorUid,
      title: "Meta Ads Campaign Created (PAUSED)",
      message: `Campaign "${name}" created safely in PAUSED state on ${adAccountId}.`,
      category: "ads",
      severity: "success",
      actionPage: "Ads Manager",
    });

    res.json(resultPayload);
  } catch (err) {
    res.status(502).json({
      created: false,
      error: err instanceof Error ? err.message : "Failed to create Meta Ads campaign",
    });
  }
});

router.post("/ads/meta/campaigns/:id/status", async (req: AuthenticatedRequest, res) => {
  const confirmed = req.body?.confirmed === true;
  const nextStatus = req.body?.status === "ACTIVE" ? "ACTIVE" : "PAUSED";
  if (!confirmed) {
    res.status(400).json({ error: "Explicit confirmation (confirmed: true) required." });
    return;
  }

  const { workspaceId, actorUid } = getContext(req);
  try {
    const { statuses } = await listComposioConnections(["metaads"], workspaceId);
    const activeAccount = statuses.metaads?.accounts.find((a) => a.status === "active");
    if (!activeAccount) {
      res.status(412).json({ error: "Meta Ads is not connected." });
      return;
    }

    const updated = await executeComposioTool({
      toolkit: "metaads",
      toolSlug: "METAADS_UPDATE_CAMPAIGN",
      arguments: {
        campaign_id: req.params.id,
        status: nextStatus,
      },
      accountId: activeAccount.id,
      workspaceId,
      userId: actorUid,
    });

    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: "metaads.campaign.status",
      target: String(req.params.id),
      status: "allowed",
      detail: `Updated Meta Ads campaign status to ${nextStatus}`,
    });
    res.json({ updated: true, status: nextStatus, data: updated.data });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to update Meta Ads campaign",
    });
  }
});

router.get("/composio/tools/discover", async (req: AuthenticatedRequest, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query) {
    res.status(400).json({ error: "Search query parameter q is required." });
    return;
  }
  try {
    const tools = await searchComposioTools(query);
    res.json({ query, count: tools.length, tools });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Composio tool discovery failed",
    });
  }
});

export default router;
