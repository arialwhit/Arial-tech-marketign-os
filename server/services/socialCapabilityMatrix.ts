import type { ComposioToolkitStatus } from "./composio.js";

export type SocialPlatformName =
  | "Instagram"
  | "Facebook"
  | "TikTok"
  | "YouTube"
  | "LinkedIn"
  | "X";

export type CapabilityStatus = "Supported" | "Setup Required" | "Unsupported";

export interface PlatformCapabilityDefinition {
  platform: SocialPlatformName;
  badge: string;
  toolkit: string;
  handlePlaceholder: string;
  capabilities: {
    publishText: { supported: boolean; toolSlug?: string; note: string };
    publishMedia: { supported: boolean; toolSlug?: string; note: string };
    scheduleNative: { supported: boolean; note: string };
    profileRead: { supported: boolean; toolSlug?: string; note: string };
    analyticsInsights: { supported: boolean; toolSlug?: string; note: string };
    adCampaigns: { supported: boolean; toolSlug?: string; note: string };
  };
}

export const SOCIAL_PLATFORM_DEFINITIONS: PlatformCapabilityDefinition[] = [
  {
    platform: "Instagram",
    badge: "IG",
    toolkit: "instagram",
    handlePlaceholder: "@yourbrand",
    capabilities: {
      publishText: { supported: false, note: "Instagram Graph API requires an image or video URL (text-only posts unsupported)." },
      publishMedia: { supported: true, toolSlug: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", note: "Publishes image/Reels via container + publish flow (public media URL required)." },
      scheduleNative: { supported: true, note: "Scheduled via Marketing OS scheduler + human confirmation." },
      profileRead: { supported: true, toolSlug: "INSTAGRAM_GET_USER_INFO", note: "Fetches IG Business profile, follower count, and recent media." },
      analyticsInsights: { supported: true, toolSlug: "INSTAGRAM_GET_IG_MEDIA_INSIGHTS", note: "Fetches real views, reach, likes, comments, saves, and shares." },
      adCampaigns: { supported: true, toolSlug: "METAADS_CREATE_CAMPAIGN", note: "Managed via connected Meta Ads toolkit (metaads)." },
    },
  },
  {
    platform: "Facebook",
    badge: "FB",
    toolkit: "facebook",
    handlePlaceholder: "Your Facebook Page",
    capabilities: {
      publishText: { supported: true, toolSlug: "FACEBOOK_CREATE_POST", note: "Publishes text/link posts to a managed Facebook Page." },
      publishMedia: { supported: true, toolSlug: "FACEBOOK_CREATE_PHOTO_POST", note: "Publishes photo posts to a managed Facebook Page." },
      scheduleNative: { supported: true, note: "Supported via Page scheduled posts or Marketing OS scheduler." },
      profileRead: { supported: true, toolSlug: "FACEBOOK_LIST_MANAGED_PAGES", note: "Lists managed Pages and recent posts." },
      analyticsInsights: { supported: true, toolSlug: "FACEBOOK_GET_PAGE_INSIGHTS", note: "Fetches real Page & post insights." },
      adCampaigns: { supported: true, toolSlug: "METAADS_CREATE_CAMPAIGN", note: "Managed via Meta Ads toolkit (metaads)." },
    },
  },
  {
    platform: "TikTok",
    badge: "TT",
    toolkit: "tiktok",
    handlePlaceholder: "@yourbrand",
    capabilities: {
      publishText: { supported: false, note: "TikTok requires video or photo carousel media; text-only posts unsupported." },
      publishMedia: { supported: true, toolSlug: "TIKTOK_PUBLISH_VIDEO", note: "Publishes video/photo via TikTok Content Posting API." },
      scheduleNative: { supported: true, note: "Queued in Marketing OS scheduler for explicit publish trigger." },
      profileRead: { supported: true, toolSlug: "TIKTOK_QUERY_CREATOR_INFO", note: "Reads creator privacy & posting eligibility." },
      analyticsInsights: { supported: false, note: "Unsupported on standard TikTok OAuth posting scope (requires TikTok Research/Business insights approval)." },
      adCampaigns: { supported: false, note: "TikTok Ads API requires separate Business Center credentials." },
    },
  },
  {
    platform: "YouTube",
    badge: "YT",
    toolkit: "youtube",
    handlePlaceholder: "Your Channel Name",
    capabilities: {
      publishText: { supported: false, note: "Community text posts are unsupported in YouTube Data API v3." },
      publishMedia: { supported: true, toolSlug: "YOUTUBE_UPLOAD_VIDEO", note: "Uploads MP4 video + title/description + thumbnail." },
      scheduleNative: { supported: true, note: "Supports scheduled publication via Marketing OS queue." },
      profileRead: { supported: true, toolSlug: "YOUTUBE_LIST_CHANNELS", note: "Fetches channel info & uploaded videos." },
      analyticsInsights: { supported: true, toolSlug: "YOUTUBE_QUERY_ANALYTICS", note: "Queries YouTube Analytics API views, watch time & subscribers." },
      adCampaigns: { supported: false, note: "Google Ads account integration required separately." },
    },
  },
  {
    platform: "LinkedIn",
    badge: "LI",
    toolkit: "linkedin",
    handlePlaceholder: "Your Name or Company Page",
    capabilities: {
      publishText: { supported: true, toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST", note: "Creates native LinkedIn text or article share posts." },
      publishMedia: { supported: true, toolSlug: "LINKEDIN_REGISTER_IMAGE_UPLOAD", note: "Supports image registration + article/URL share." },
      scheduleNative: { supported: true, note: "Scheduled via Marketing OS queue with confirmation gate." },
      profileRead: { supported: true, toolSlug: "LINKEDIN_GET_MY_INFO", note: "Fetches authenticated LinkedIn member or company profile." },
      analyticsInsights: { supported: false, note: "Organic post analytics require LinkedIn Marketing Developer Platform Community Management approval." },
      adCampaigns: { supported: false, note: "LinkedIn Campaign Manager API not enabled on default OAuth scope." },
    },
  },
  {
    platform: "X",
    badge: "X",
    toolkit: "twitter",
    handlePlaceholder: "@yourhandle",
    capabilities: {
      publishText: { supported: true, toolSlug: "TWITTER_CREATION_OF_A_POST", note: "Publishes posts (tweets) via X API v2." },
      publishMedia: { supported: true, toolSlug: "TWITTER_UPLOAD_MEDIA", note: "Uploads media + attaches to X post." },
      scheduleNative: { supported: true, note: "Scheduled via Marketing OS queue with confirmation gate." },
      profileRead: { supported: true, toolSlug: "TWITTER_USER_LOOKUP_ME", note: "Fetches authenticated X user & recent posts." },
      analyticsInsights: { supported: true, toolSlug: "TWITTER_GET_USER_POSTS", note: "Public metrics available per post lookup depending on X API tier." },
      adCampaigns: { supported: false, note: "X Ads API requires separate whitelisted Ads account access." },
    },
  },
];

export function buildSocialCoverageReport(
  statuses: Record<string, ComposioToolkitStatus>,
) {
  return SOCIAL_PLATFORM_DEFINITIONS.map((def) => {
    const tkStatus = statuses[def.toolkit];
    const activeAccounts = (tkStatus?.accounts || []).filter((a) => a.status === "active");
    const connected = activeAccounts.length > 0;

    const evalCap = (cap: { supported: boolean; toolSlug?: string; note: string }): {
      status: CapabilityStatus;
      toolSlug?: string;
      note: string;
    } => {
      if (!cap.supported) return { status: "Unsupported", note: cap.note };
      if (!connected) return { status: "Setup Required", toolSlug: cap.toolSlug, note: cap.note };
      return { status: "Supported", toolSlug: cap.toolSlug, note: cap.note };
    };

    return {
      platform: def.platform,
      badge: def.badge,
      toolkit: def.toolkit,
      handlePlaceholder: def.handlePlaceholder,
      connectionStatus: connected ? ("Connected" as const) : ("Setup Required" as const),
      accounts: activeAccounts,
      primaryAccount: activeAccounts.find((a) => a.isDefault) || activeAccounts[0] || null,
      capabilities: {
        publishText: evalCap(def.capabilities.publishText),
        publishMedia: evalCap(def.capabilities.publishMedia),
        scheduleNative: evalCap(def.capabilities.scheduleNative),
        profileRead: evalCap(def.capabilities.profileRead),
        analyticsInsights: evalCap(def.capabilities.analyticsInsights),
        adCampaigns: def.capabilities.adCampaigns.supported
          ? statuses.metaads?.accounts?.some((a) => a.status === "active")
            ? { status: "Supported" as CapabilityStatus, toolSlug: def.capabilities.adCampaigns.toolSlug, note: def.capabilities.adCampaigns.note }
            : { status: "Setup Required" as CapabilityStatus, toolSlug: def.capabilities.adCampaigns.toolSlug, note: def.capabilities.adCampaigns.note }
          : { status: "Unsupported" as CapabilityStatus, note: def.capabilities.adCampaigns.note },
      },
    };
  });
}
