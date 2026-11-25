import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { getDataDir } from "../utils/paths.js";
import {
  stateStore,
  type AnalyticsConnectionRecord,
  type GrowthSnapshotRecord,
} from "./stateStore.js";
import { executeComposioTool, isComposioConfigured, listComposioConnections } from "./composio.js";

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

export interface DetectedSdkFinding {
  provider: AnalyticsProviderId;
  label: string;
  detected: boolean;
  evidence: string;
}

export interface TrackingDetectionResult {
  sdks: DetectedSdkFinding[];
  storeLinks: Array<{ store: "google_play" | "app_store"; url: string }>;
  eventTaxonomyGaps: string[];
}

export interface IntegrationRecommendationItem {
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

export interface DateRangeSpec {
  range: string;
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
  periodKey: string;
}

const PROVIDER_LABELS: Record<AnalyticsProviderId, string> = {
  posthog: "PostHog Product Analytics",
  firebase: "Direct Firebase (Auth & Firestore)",
  supabase: "Direct Supabase Database",
  ga4: "Google Analytics 4",
  gsc: "Google Search Console",
  google_play: "Google Play Console",
  app_store: "Apple App Store Connect",
  meta_social: "Meta / Instagram Insights",
  tiktok: "TikTok Analytics",
  youtube: "YouTube Studio Analytics",
  linkedin: "LinkedIn Page Analytics",
  ads: "Paid Ad Platforms",
};

export function getProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider as AnalyticsProviderId] || provider;
}

// ---------- AES-256-GCM SERVER-ONLY CREDENTIAL VAULT ----------

let ephemeralVaultKey: Buffer | null = null;

function getVaultKey(): Buffer {
  const envSecret = process.env.MOS_CREDENTIAL_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return crypto.createHash("sha256").update(envSecret).digest();
  }
  if (ephemeralVaultKey) return ephemeralVaultKey;
  try {
    const keyFile = path.join(getDataDir(), ".mos-vault.key");
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    if (fs.existsSync(keyFile)) {
      const hex = fs.readFileSync(keyFile, "utf8").trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        ephemeralVaultKey = Buffer.from(hex, "hex");
        return ephemeralVaultKey;
      }
    }
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, generated.toString("hex"), { mode: 0o600 });
    ephemeralVaultKey = generated;
    return generated;
  } catch {
    ephemeralVaultKey = crypto.randomBytes(32);
    return ephemeralVaultKey;
  }
}

export function encryptCredentialPayload(payload: Record<string, unknown>): string {
  const key = getVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptCredentialPayload(encoded: string): Record<string, unknown> {
  if (!encoded || !encoded.includes(".")) return {};
  try {
    const [ivB64, tagB64, dataB64] = encoded.split(".");
    const key = getVaultKey();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function maskSecret(secret?: string): string {
  const clean = (secret || "").trim();
  if (!clean) return "Configured";
  if (clean.length <= 6) return "••••••";
  return `••••${clean.slice(-4)}`;
}

export function sanitizeConnectionSummary(conn: AnalyticsConnectionRecord) {
  const { encryptedCredentials: _stripped, ...safe } = conn;
  return safe;
}

// ---------- SAFE GROWTH & RATIO MATH ----------

export function safeGrowthPct(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null;
  }
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) {
    return null;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function safeRatioPct(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (numerator === null || numerator === undefined || denominator === null || denominator === undefined) {
    return null;
  }
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function resolveDateRange(
  range = "30d",
  customStart?: string,
  customEnd?: string,
): DateRangeSpec {
  const now = new Date();
  const toIsoDay = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (d: Date, delta: number) => {
    const copy = new Date(d);
    copy.setUTCDate(copy.getUTCDate() + delta);
    return copy;
  };

  let start: Date;
  let end: Date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (range === "today") {
    start = end;
  } else if (range === "yesterday") {
    end = addDays(end, -1);
    start = end;
  } else if (range === "7d") {
    start = addDays(end, -6);
  } else if (range === "90d") {
    start = addDays(end, -89);
  } else if (range === "this_month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else if (range === "last_month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  } else if (range === "custom" && customStart && customEnd) {
    const s = new Date(`${customStart.slice(0, 10)}T00:00:00Z`);
    const e = new Date(`${customEnd.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s <= e) {
      start = s;
      end = e;
    } else {
      start = addDays(end, -29);
    }
  } else {
    range = "30d";
    start = addDays(end, -29);
  }

  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(spanDays - 1));

  const startDate = toIsoDay(start);
  const endDate = toIsoDay(end);
  return {
    range,
    startDate,
    endDate,
    prevStartDate: toIsoDay(prevStart),
    prevEndDate: toIsoDay(prevEnd),
    periodKey: `${startDate}_${endDate}`,
  };
}

// ---------- WEBSITE TRACKING SDK & FOOTPRINT DETECTION ----------

export function detectTrackingTechnologies(html: string): TrackingDetectionResult {
  const $ = cheerio.load(html || "");
  const scriptSrcs = $("script[src]")
    .map((_, el) => $(el).attr("src") || "")
    .get();
  const inlineScripts = $("script:not([src])")
    .map((_, el) => $(el).html() || "")
    .get()
    .join("\n");
  const allScriptsText = `${scriptSrcs.join("\n")}\n${inlineScripts}`;

  const storeLinks: Array<{ store: "google_play" | "app_store"; url: string }> = [];
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (/play\.google\.com\/store\/apps/i.test(href) && !storeLinks.some((s) => s.url === href)) {
      storeLinks.push({ store: "google_play", url: href });
    }
    if (/apps\.apple\.com\//i.test(href) && !storeLinks.some((s) => s.url === href)) {
      storeLinks.push({ store: "app_store", url: href });
    }
  });

  const phMatch = allScriptsText.match(/posthog\.init|us\.i\.posthog\.com|eu\.i\.posthog\.com|app\.posthog\.com/i);
  const ga4Match = allScriptsText.match(/G-[A-Z0-9]{6,}|gtag\/js\?id=G-/i);
  const gtmMatch = allScriptsText.match(/GTM-[A-Z0-9]{4,}|googletagmanager\.com\/gtm\.js/i);
  const fbMatch = allScriptsText.match(/firebaseapp\.com|firebaseConfig|initializeApp|gstatic\.com\/firebasejs/i);
  const supaMatch = allScriptsText.match(/[a-z0-9-]+\.supabase\.co/i);
  const metaPixelMatch = allScriptsText.match(/connect\.facebook\.net|fbq\(['"]init['"]/i);
  const tiktokPixelMatch = allScriptsText.match(/analytics\.tiktok\.com|ttq\.load/i);

  const sdks: DetectedSdkFinding[] = [
    {
      provider: "posthog",
      label: "PostHog",
      detected: Boolean(phMatch),
      evidence: phMatch ? `Matched "${phMatch[0]}" in page scripts` : "No PostHog snippet detected in homepage HTML",
    },
    {
      provider: "ga4",
      label: "Google Analytics 4",
      detected: Boolean(ga4Match || gtmMatch),
      evidence: ga4Match
        ? `Matched GA4 measurement token (${ga4Match[0]})`
        : gtmMatch
          ? `Matched Google Tag Manager (${gtmMatch[0]})`
          : "No GA4 / GTM tag detected in homepage HTML",
    },
    {
      provider: "firebase",
      label: "Firebase Web SDK",
      detected: Boolean(fbMatch),
      evidence: fbMatch ? `Matched Firebase config/SDK (${fbMatch[0]})` : "No Firebase snippet detected in homepage HTML",
    },
    {
      provider: "supabase",
      label: "Supabase Project",
      detected: Boolean(supaMatch),
      evidence: supaMatch ? `Matched Supabase URL (${supaMatch[0]})` : "No Supabase endpoint found in homepage HTML",
    },
    {
      provider: "meta_social",
      label: "Meta Pixel",
      detected: Boolean(metaPixelMatch),
      evidence: metaPixelMatch ? `Matched Meta Pixel (${metaPixelMatch[0]})` : "No Meta Pixel detected",
    },
    {
      provider: "tiktok",
      label: "TikTok Pixel",
      detected: Boolean(tiktokPixelMatch),
      evidence: tiktokPixelMatch ? `Matched TikTok Pixel (${tiktokPixelMatch[0]})` : "No TikTok Pixel detected",
    },
  ];

  const eventTaxonomyGaps: string[] = [];
  if (!phMatch && !ga4Match && !gtmMatch) {
    eventTaxonomyGaps.push(
      "No client-side product or web analytics tag (PostHog / GA4 / GTM) detected on the public landing page.",
    );
  }
  if (!phMatch) {
    eventTaxonomyGaps.push(
      "Recommend instrumenting custom conversion events (`signup_started`, `signup_completed`, `activation_action`) in PostHog or server telemetry.",
    );
  }
  if (!metaPixelMatch && !tiktokPixelMatch) {
    eventTaxonomyGaps.push(
      "No paid social attribution pixel detected; attribution for Meta/TikTok campaigns will rely on UTM parameters until pixel/CAPI is added.",
    );
  }

  return { sdks, storeLinks, eventTaxonomyGaps };
}

export function buildIntegrationRecommendations(params: {
  products?: string[];
  channels?: string[];
  websiteUrl?: string;
  tracking?: TrackingDetectionResult | null;
  connectedProviders?: string[];
}): IntegrationRecommendationItem[] {
  const products = (params.products || []).map((p) => p.toLowerCase());
  const channels = (params.channels || []).map((c) => c.toLowerCase());
  const connected = new Set(params.connectedProviders || []);
  const sdks = new Map((params.tracking?.sdks || []).map((s) => [s.provider, s]));
  const storeLinks = params.tracking?.storeLinks || [];

  const isWebOrSaas =
    Boolean(params.websiteUrl) ||
    products.some((p) => /web|saas|site|landing|desktop|api|commerce/.test(p));
  const hasAndroid =
    products.some((p) => /android|mobile app/.test(p)) ||
    storeLinks.some((s) => s.store === "google_play");
  const hasIos =
    products.some((p) => /ios|iphone|ipad|mobile app/.test(p)) ||
    storeLinks.some((s) => s.store === "app_store");
  const hasSocial =
    channels.some((c) => /instagram|tiktok|youtube|linkedin|social|facebook/.test(c));

  const recs: IntegrationRecommendationItem[] = [];

  if (isWebOrSaas || sdks.get("posthog")?.detected) {
    const ph = sdks.get("posthog");
    recs.push({
      provider: "posthog",
      providerLabel: "PostHog Product Analytics",
      priority: ph?.detected ? "High" : "Medium",
      whyRecommended: ph?.detected
        ? "PostHog SDK detected on your site — connect your Personal API Key to stream real DAU/WAU/MAU, funnels, and events."
        : "Track SaaS & web user journeys, retention, UTM traffic, and product activation milestones.",
      metricsUnlocked: ["DAU / WAU / MAU", "Pageviews", "Custom funnel events", "UTM & referrer attribution"],
      permissionsRequired: "PostHog Personal API Key with Project Read / Query permissions.",
      sdkDetected: Boolean(ph?.detected),
      detectedEvidence: ph?.evidence,
      historicalDataNote: "Full historical query window available back to project event inception.",
      connected: connected.has("posthog"),
    });
  }

  if (isWebOrSaas || sdks.get("ga4")?.detected) {
    const ga = sdks.get("ga4");
    recs.push({
      provider: "ga4",
      providerLabel: "Google Analytics 4",
      priority: ga?.detected ? "High" : "Medium",
      whyRecommended: ga?.detected
        ? "GA4 / GTM tag detected on your website — authorize read access to pull sessions, engagement, and conversions."
        : "Measure acquisition channels, landing page conversion rates, and mobile/web attribution.",
      metricsUnlocked: ["Active users", "Sessions & engaged sessions", "Top landing pages", "Channel conversions"],
      permissionsRequired: "Google OAuth (`analytics.readonly`) or GA4 Service Account Viewer role.",
      sdkDetected: Boolean(ga?.detected),
      detectedEvidence: ga?.evidence,
      historicalDataNote: "Supports full GA4 property reporting history via Analytics Data API.",
      connected: connected.has("ga4"),
    });
  }

  if (params.websiteUrl) {
    recs.push({
      provider: "gsc",
      providerLabel: "Google Search Console",
      priority: "High",
      whyRecommended:
        "Monitor organic impressions, search clicks, CTR, and average keyword positions for your website.",
      metricsUnlocked: ["Organic clicks", "Search impressions", "Average SERP position", "Top ranking pages"],
      permissionsRequired: "Composio Search Console connection (Google verified property owner/user).",
      sdkDetected: false,
      detectedEvidence: `Target domain: ${params.websiteUrl}`,
      historicalDataNote: "Up to 16 months of search performance history from Google.",
      connected: connected.has("gsc"),
    });
  }

  if (sdks.get("firebase")?.detected || products.some((p) => /firebase|mobile|app|saas/.test(p))) {
    const fb = sdks.get("firebase");
    recs.push({
      provider: "firebase",
      providerLabel: "Direct Firebase (Auth & Firestore)",
      priority: fb?.detected ? "High" : "Low",
      whyRecommended: fb?.detected
        ? "Firebase Web SDK detected on site — inspect verified accounts and Firestore collection metrics safely."
        : "Directly query Firebase Authentication signups & Firestore business records without duplicating databases.",
      metricsUnlocked: ["Registered Auth accounts", "Email-verified accounts", "Firestore collection inspection"],
      permissionsRequired: "Firebase Project ID + Service Account JSON or Google Cloud OAuth token.",
      sdkDetected: Boolean(fb?.detected),
      detectedEvidence: fb?.evidence,
      historicalDataNote: "Account creation timestamps support historical signup trend bucketing.",
      connected: connected.has("firebase"),
    });
  }

  if (sdks.get("supabase")?.detected || products.some((p) => /supabase|saas|web/.test(p))) {
    const sup = sdks.get("supabase");
    recs.push({
      provider: "supabase",
      providerLabel: "Direct Supabase Database",
      priority: sup?.detected ? "High" : "Low",
      whyRecommended: sup?.detected
        ? "Supabase project endpoint detected on your site — map your user/conversion tables for verified signup analytics."
        : "Read real signup, subscription, or event tables directly from Supabase via schema inspection.",
      metricsUnlocked: ["Table row counts", "User signups over time", "Mapped custom conversion events"],
      permissionsRequired: "Supabase Project URL + Read-Only / Service Role Key (encrypted server-side only).",
      sdkDetected: Boolean(sup?.detected),
      detectedEvidence: sup?.evidence,
      historicalDataNote: "Uses mapped `created_at` column for historical cohort/signup ranges.",
      connected: connected.has("supabase"),
    });
  }

  if (hasAndroid) {
    recs.push({
      provider: "google_play",
      providerLabel: "Google Play Console",
      priority: "High",
      whyRecommended: "Android app presence detected — connect Play Console for reviews, vitals, and install reporting.",
      metricsUnlocked: ["Recent user reviews & ratings", "Crash/ANR vitals status", "Store listing diagnostics"],
      permissionsRequired: "Play Console Service Account linked to Google Cloud + Play Reporting API enabled.",
      sdkDetected: storeLinks.some((s) => s.store === "google_play"),
      detectedEvidence: storeLinks.find((s) => s.store === "google_play")?.url,
      historicalDataNote: "Direct Play API gives recent vitals/reviews; bulk historical store installs require Play GCS export.",
      connected: connected.has("google_play"),
    });
  }

  if (hasIos) {
    recs.push({
      provider: "app_store",
      providerLabel: "Apple App Store Connect",
      priority: "Medium",
      whyRecommended: "iOS app presence detected — connect App Store Connect Analytics API for iOS install & retention data.",
      metricsUnlocked: ["App Store impressions", "Product page views", "App units & proceeds"],
      permissionsRequired: "App Store Connect API Key (.p8), Issuer ID, and Key ID.",
      sdkDetected: storeLinks.some((s) => s.store === "app_store"),
      detectedEvidence: storeLinks.find((s) => s.store === "app_store")?.url,
      historicalDataNote: "Requires Apple App Store Connect Analytics Reports API provisioning.",
      connected: connected.has("app_store"),
    });
  }

  if (hasSocial) {
    recs.push({
      provider: "meta_social",
      providerLabel: "Meta / Social Accounts (Composio)",
      priority: "Medium",
      whyRecommended: "Connect Instagram, TikTok, YouTube, or LinkedIn via Composio for direct post & audience metrics.",
      metricsUnlocked: ["Follower growth", "Post reach & impressions", "Engagement actions"],
      permissionsRequired: "OAuth connection via Composio Connect in Social Accounts / Integrations.",
      sdkDetected: Boolean(sdks.get("meta_social")?.detected || sdks.get("tiktok")?.detected),
      detectedEvidence: sdks.get("meta_social")?.evidence,
      historicalDataNote: "Social platform APIs typically limit organic insights lookback windows (30–90 days).",
      connected: connected.has("meta_social"),
    });
  }

  return recs;
}

// ---------- GOOGLE SERVICE ACCOUNT JWT ACCESS TOKEN MINTING ----------

async function getGoogleAccessTokenFromServiceAccount(
  saJsonRaw: string,
  scopes: string[],
): Promise<string> {
  const sa = JSON.parse(saJsonRaw) as {
    client_email?: string;
    private_key?: string;
    token_uri?: string;
  };
  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account JSON must contain client_email and private_key.");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: scopes.join(" "),
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(sa.private_key).toString("base64url");
  const jwt = `${signingInput}.${signature}`;

  const resp = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  const data = (await resp.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!resp.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google OAuth token exchange failed (${resp.status})`);
  }
  return data.access_token;
}

// ---------- REAL PROVIDER ADAPTERS ----------

function normalizeHost(rawHost?: string, fallback = "https://us.posthog.com"): string {
  const clean = (rawHost || fallback).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(clean)) return `https://${clean}`;
  return clean;
}

async function syncPostHog(
  conn: AnalyticsConnectionRecord,
  creds: Record<string, unknown>,
  rangeSpec: DateRangeSpec,
): Promise<{
  connPatch: Partial<AnalyticsConnectionRecord>;
  snapshot: Omit<GrowthSnapshotRecord, "id">;
}> {
  const apiKey = String(creds.apiKey || "").trim();
  const host = normalizeHost(conn.hostUrl || String(creds.hostUrl || "https://us.posthog.com"));
  if (!apiKey) {
    throw new Error("PostHog Personal API Key is missing.");
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // 1. Discover projects accessible by this API key
  const projResp = await fetch(`${host}/api/projects/`, { headers, signal: AbortSignal.timeout(12000) });
  if (projResp.status === 401 || projResp.status === 403) {
    const snapshot: Omit<GrowthSnapshotRecord, "id"> = {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "posthog",
      providerLabel: getProviderLabel("posthog"),
      projectOrProperty: conn.selectedProjectName || "PostHog",
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: "permission_restricted",
      statusDetail: `PostHog returned HTTP ${projResp.status}. Verify Personal API Key permissions (project:read & query:read).`,
      metrics: [],
      timeSeries: [],
      topPagesOrEvents: [],
      channels: [],
      retrievedAt: new Date().toISOString(),
    };
    return {
      connPatch: {
        status: "error",
        completenessStatus: "permission_restricted",
        statusDetail: snapshot.statusDetail,
        lastError: snapshot.statusDetail,
      },
      snapshot,
    };
  }
  if (!projResp.ok) {
    throw new Error(`PostHog projects lookup failed (HTTP ${projResp.status}).`);
  }

  const projData = (await projResp.json()) as {
    results?: Array<{ id: number; name: string }>;
  };
  const projects = (projData.results || []).map((p) => ({
    id: String(p.id),
    name: p.name || `Project ${p.id}`,
  }));
  if (projects.length === 0) {
    const snapshot: Omit<GrowthSnapshotRecord, "id"> = {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "posthog",
      providerLabel: getProviderLabel("posthog"),
      projectOrProperty: "No accessible projects",
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: "connected_no_events",
      statusDetail: "Connected to PostHog, but this API key has access to zero projects.",
      metrics: [],
      timeSeries: [],
      topPagesOrEvents: [],
      channels: [],
      retrievedAt: new Date().toISOString(),
    };
    return {
      connPatch: {
        status: "connected",
        discoveredProjects: [],
        completenessStatus: "connected_no_events",
        statusDetail: snapshot.statusDetail,
        lastSyncedAt: snapshot.retrievedAt,
      },
      snapshot,
    };
  }

  const activeProj =
    projects.find((p) => p.id === conn.selectedProjectId) || projects[0];

  const runHogQL = async (query: string) => {
    const r = await fetch(`${host}/api/projects/${activeProj.id}/query/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      signal: AbortSignal.timeout(15000),
    });
    const j = (await r.json().catch(() => ({}))) as {
      results?: unknown[][];
      detail?: string;
      error?: string;
    };
    if (!r.ok) {
      const msg = j.detail || j.error || `HTTP ${r.status}`;
      const e = new Error(msg) as Error & { status?: number };
      e.status = r.status;
      throw e;
    }
    return j.results || [];
  };

  try {
    const s = rangeSpec.startDate;
    const e = rangeSpec.endDate;
    const ps = rangeSpec.prevStartDate;
    const pe = rangeSpec.prevEndDate;

    const [currSummary, prevSummary, dailyRows, topPagesRows, utmRows] = await Promise.all([
      runHogQL(
        `SELECT count() AS events, uniq(distinct_id) AS unique_users, countIf(event = '$pageview') AS pageviews FROM events WHERE timestamp >= toDateTime('${s} 00:00:00') AND timestamp <= toDateTime('${e} 23:59:59')`,
      ),
      runHogQL(
        `SELECT count() AS events, uniq(distinct_id) AS unique_users, countIf(event = '$pageview') AS pageviews FROM events WHERE timestamp >= toDateTime('${ps} 00:00:00') AND timestamp <= toDateTime('${pe} 23:59:59')`,
      ),
      runHogQL(
        `SELECT toString(toDate(timestamp)) AS day, uniq(distinct_id) AS unique_users, count() AS events, countIf(event = '$pageview') AS pageviews FROM events WHERE timestamp >= toDateTime('${s} 00:00:00') AND timestamp <= toDateTime('${e} 23:59:59') GROUP BY day ORDER BY day ASC`,
      ),
      runHogQL(
        `SELECT properties.$pathname AS pathname, count() AS views FROM events WHERE event = '$pageview' AND timestamp >= toDateTime('${s} 00:00:00') AND timestamp <= toDateTime('${e} 23:59:59') AND properties.$pathname IS NOT NULL GROUP BY pathname ORDER BY views DESC LIMIT 10`,
      ),
      runHogQL(
        `SELECT coalesce(nullIf(properties.utm_source, ''), nullIf(properties.$referring_domain, ''), 'Direct / None') AS source, uniq(distinct_id) AS users, countIf(event = '$pageview') AS pageviews FROM events WHERE timestamp >= toDateTime('${s} 00:00:00') AND timestamp <= toDateTime('${e} 23:59:59') GROUP BY source ORDER BY users DESC LIMIT 8`,
      ),
    ]);

    const totalEvents = Number(currSummary[0]?.[0] ?? 0);
    const uniqueUsers = Number(currSummary[0]?.[1] ?? 0);
    const pageviews = Number(currSummary[0]?.[2] ?? 0);
    const prevEvents = prevSummary[0] ? Number(prevSummary[0][0] ?? 0) : null;
    const prevUsers = prevSummary[0] ? Number(prevSummary[0][1] ?? 0) : null;
    const prevPageviews = prevSummary[0] ? Number(prevSummary[0][2] ?? 0) : null;

    const nowIso = new Date().toISOString();
    const completenessStatus: DataCompletenessStatus =
      totalEvents === 0 ? "connected_no_events" : "connected_and_reporting";
    const statusDetail =
      totalEvents === 0
        ? `Connected to PostHog project "${activeProj.name}", but zero events were recorded between ${s} and ${e}.`
        : `Reporting ${totalEvents.toLocaleString()} events across ${uniqueUsers.toLocaleString()} unique distinct users in "${activeProj.name}".`;

    const mkProv = (definition: string) => ({
      provider: "posthog" as const,
      providerLabel: getProviderLabel("posthog"),
      projectOrProperty: activeProj.name,
      reportingPeriod: { startDate: s, endDate: e },
      retrievedAt: nowIso,
      definition,
      attributionMethod: "Direct" as const,
      completenessStatus,
    });

    const snapshot: Omit<GrowthSnapshotRecord, "id"> = {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "posthog",
      providerLabel: getProviderLabel("posthog"),
      projectOrProperty: activeProj.name,
      periodKey: rangeSpec.periodKey,
      startDate: s,
      endDate: e,
      completenessStatus,
      statusDetail,
      metrics: [
        {
          key: "unique_users",
          label: "PostHog Unique Users",
          value: uniqueUsers,
          previousValue: prevUsers,
          growthPct: safeGrowthPct(uniqueUsers, prevUsers),
          unit: "count",
          provenance: mkProv("Distinct `distinct_id` count across all captured PostHog events."),
        },
        {
          key: "pageviews",
          label: "Pageviews ($pageview)",
          value: pageviews,
          previousValue: prevPageviews,
          growthPct: safeGrowthPct(pageviews, prevPageviews),
          unit: "count",
          provenance: mkProv("Count of `$pageview` events ingested by PostHog."),
        },
        {
          key: "total_events",
          label: "Total Product Events",
          value: totalEvents,
          previousValue: prevEvents,
          growthPct: safeGrowthPct(totalEvents, prevEvents),
          unit: "count",
          provenance: mkProv("All captured PostHog events in selected window."),
        },
      ],
      timeSeries: dailyRows.map((row) => ({
        date: String(row[0] || ""),
        unique_users: Number(row[1] ?? 0),
        total_events: Number(row[2] ?? 0),
        pageviews: Number(row[3] ?? 0),
      })),
      topPagesOrEvents: topPagesRows.map((row) => ({
        name: String(row[0] || "/"),
        count: Number(row[1] ?? 0),
        detail: "PostHog $pathname",
      })),
      channels: utmRows.map((row) => ({
        channel: String(row[0] || "Direct / None"),
        users: Number(row[1] ?? 0),
        sessionsOrVisits: Number(row[2] ?? 0),
        conversions: null,
        attributionMethod: "Direct",
      })),
      retrievedAt: nowIso,
    };

    return {
      connPatch: {
        status: "connected",
        hostUrl: host,
        discoveredProjects: projects,
        selectedProjectId: activeProj.id,
        selectedProjectName: activeProj.name,
        completenessStatus,
        statusDetail,
        lastSyncedAt: nowIso,
        lastError: undefined,
      },
      snapshot,
    };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const msg = err instanceof Error ? err.message : String(err);
    const comp: DataCompletenessStatus =
      status === 401 || status === 403 ? "permission_restricted" : "sync_failed";
    const snapshot: Omit<GrowthSnapshotRecord, "id"> = {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "posthog",
      providerLabel: getProviderLabel("posthog"),
      projectOrProperty: activeProj.name,
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: comp,
      statusDetail: msg,
      metrics: [],
      timeSeries: [],
      topPagesOrEvents: [],
      channels: [],
      retrievedAt: new Date().toISOString(),
    };
    return {
      connPatch: {
        status: "error",
        hostUrl: host,
        discoveredProjects: projects,
        selectedProjectId: activeProj.id,
        selectedProjectName: activeProj.name,
        completenessStatus: comp,
        statusDetail: msg,
        lastError: msg,
      },
      snapshot,
    };
  }
}

async function syncSupabase(
  conn: AnalyticsConnectionRecord,
  creds: Record<string, unknown>,
  rangeSpec: DateRangeSpec,
): Promise<{
  connPatch: Partial<AnalyticsConnectionRecord>;
  snapshot: Omit<GrowthSnapshotRecord, "id">;
}> {
  const projectUrl = normalizeHost(conn.hostUrl || String(creds.projectUrl || ""));
  const apiKey = String(creds.apiKey || "").trim();
  if (!projectUrl || !apiKey) {
    throw new Error("Supabase Project URL and API Key are required.");
  }

  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  // Inspect live PostgREST OpenAPI schema to discover real tables & columns without guessing
  const schemaResp = await fetch(`${projectUrl}/rest/v1/`, {
    headers,
    signal: AbortSignal.timeout(12000),
  });
  if (schemaResp.status === 401 || schemaResp.status === 403) {
    const detail = `Supabase REST API returned HTTP ${schemaResp.status}. Check your API key or PostgREST schema permissions.`;
    return {
      connPatch: {
        status: "error",
        completenessStatus: "permission_restricted",
        statusDetail: detail,
        lastError: detail,
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "supabase",
        providerLabel: getProviderLabel("supabase"),
        projectOrProperty: projectUrl,
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "permission_restricted",
        statusDetail: detail,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: new Date().toISOString(),
      },
    };
  }
  if (!schemaResp.ok) {
    throw new Error(`Supabase schema discovery failed (HTTP ${schemaResp.status}).`);
  }

  const swagger = (await schemaResp.json().catch(() => ({}))) as {
    definitions?: Record<string, { properties?: Record<string, unknown> }>;
  };
  const discoveredTables = Object.entries(swagger.definitions || {}).map(([name, def]) => ({
    name,
    columns: Object.keys(def.properties || {}),
  }));

  const mappings = conn.tableMappings || {};
  const nowIso = new Date().toISOString();

  if (!mappings.usersTable && !mappings.eventsTable) {
    const detail = `Connected to Supabase (${discoveredTables.length} exposed table${discoveredTables.length === 1 ? "" : "s"} discovered). Map your user/event tables to activate verified counts.`;
    return {
      connPatch: {
        status: "connected",
        hostUrl: projectUrl,
        selectedProjectName: new URL(projectUrl).hostname,
        discoveredTables,
        completenessStatus: "connected_no_events",
        statusDetail: detail,
        lastSyncedAt: nowIso,
        lastError: undefined,
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "supabase",
        providerLabel: getProviderLabel("supabase"),
        projectOrProperty: new URL(projectUrl).hostname,
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "connected_no_events",
        statusDetail: detail,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso,
      },
    };
  }

  const queryExactCount = async (table: string, filterQuery = ""): Promise<number | null> => {
    const sep = filterQuery ? `?${filterQuery}` : "";
    const r = await fetch(`${projectUrl}/rest/v1/${encodeURIComponent(table)}${sep}`, {
      method: "HEAD",
      headers: { ...headers, Prefer: "count=exact" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const rangeHdr = r.headers.get("content-range") || "";
    const totalPart = rangeHdr.split("/")[1];
    const num = Number(totalPart);
    return Number.isFinite(num) ? num : null;
  };

  const metrics: Array<Record<string, unknown>> = [];
  const timeSeriesMap = new Map<string, { date: string; signups: number }>();

  if (mappings.usersTable) {
    const totalUsers = await queryExactCount(mappings.usersTable);
    let rangeSignups: number | null = null;
    let prevSignups: number | null = null;

    if (mappings.createdAtCol) {
      const col = encodeURIComponent(mappings.createdAtCol);
      rangeSignups = await queryExactCount(
        mappings.usersTable,
        `and=(${col}.gte.${rangeSpec.startDate}T00:00:00Z,${col}.lte.${rangeSpec.endDate}T23:59:59Z)`,
      );
      prevSignups = await queryExactCount(
        mappings.usersTable,
        `and=(${col}.gte.${rangeSpec.prevStartDate}T00:00:00Z,${col}.lte.${rangeSpec.prevEndDate}T23:59:59Z)`,
      );

      // Fetch dated rows (capped at 1000) to render real signup time series
      const rowsResp = await fetch(
        `${projectUrl}/rest/v1/${encodeURIComponent(mappings.usersTable)}?select=${col}&and=(${col}.gte.${rangeSpec.startDate}T00:00:00Z,${col}.lte.${rangeSpec.endDate}T23:59:59Z)&limit=1000`,
        { headers, signal: AbortSignal.timeout(10000) },
      );
      if (rowsResp.ok) {
        const rows = (await rowsResp.json().catch(() => [])) as Array<Record<string, unknown>>;
        for (const r of rows) {
          const val = String(r[mappings.createdAtCol] || "").slice(0, 10);
          if (val) {
            const cur = timeSeriesMap.get(val) || { date: val, signups: 0 };
            cur.signups += 1;
            timeSeriesMap.set(val, cur);
          }
        }
      }
    }

    const baseProv = {
      provider: "supabase",
      providerLabel: getProviderLabel("supabase"),
      projectOrProperty: `${new URL(projectUrl).hostname} (${mappings.usersTable})`,
      reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
      retrievedAt: nowIso,
      attributionMethod: "Direct",
      completenessStatus: "connected_and_reporting",
    };

    if (totalUsers !== null) {
      metrics.push({
        key: "supabase_total_rows",
        label: `Total Rows (${mappings.usersTable})`,
        value: totalUsers,
        previousValue: null,
        growthPct: null,
        unit: "count",
        provenance: {
          ...baseProv,
          definition: `PostgREST exact count on table "${mappings.usersTable}".`,
        },
      });
    }
    if (rangeSignups !== null) {
      metrics.push({
        key: "supabase_period_signups",
        label: `New Records in Period`,
        value: rangeSignups,
        previousValue: prevSignups,
        growthPct: safeGrowthPct(rangeSignups, prevSignups),
        unit: "count",
        provenance: {
          ...baseProv,
          definition: `Records in "${mappings.usersTable}" where "${mappings.createdAtCol}" falls in reporting range.`,
        },
      });
    }
  }

  if (mappings.eventsTable) {
    const eventsCount = await queryExactCount(mappings.eventsTable);
    if (eventsCount !== null) {
      metrics.push({
        key: "supabase_events_total",
        label: `Events (${mappings.eventsTable})`,
        value: eventsCount,
        previousValue: null,
        growthPct: null,
        unit: "count",
        provenance: {
          provider: "supabase",
          providerLabel: getProviderLabel("supabase"),
          projectOrProperty: `${new URL(projectUrl).hostname} (${mappings.eventsTable})`,
          reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
          retrievedAt: nowIso,
          definition: `PostgREST exact count on mapped events table "${mappings.eventsTable}".`,
          attributionMethod: "Direct",
          completenessStatus: "connected_and_reporting",
        },
      });
    }
  }

  const timeSeries = Array.from(timeSeriesMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const completeness: DataCompletenessStatus =
    metrics.length > 0 ? "connected_and_reporting" : "permission_restricted";
  const detail =
    metrics.length > 0
      ? `Verified Supabase metrics retrieved from ${mappings.usersTable || mappings.eventsTable}.`
      : "Supabase connected, but mapped tables returned permission restriction (check RLS/API key).";

  return {
    connPatch: {
      status: "connected",
      hostUrl: projectUrl,
      selectedProjectName: new URL(projectUrl).hostname,
      discoveredTables,
      completenessStatus: completeness,
      statusDetail: detail,
      lastSyncedAt: nowIso,
      lastError: undefined,
    },
    snapshot: {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "supabase",
      providerLabel: getProviderLabel("supabase"),
      projectOrProperty: new URL(projectUrl).hostname,
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: completeness,
      statusDetail: detail,
      metrics,
      timeSeries,
      topPagesOrEvents: [],
      channels: [],
      retrievedAt: nowIso,
    },
  };
}

async function syncFirebaseDirect(
  conn: AnalyticsConnectionRecord,
  creds: Record<string, unknown>,
  rangeSpec: DateRangeSpec,
): Promise<{
  connPatch: Partial<AnalyticsConnectionRecord>;
  snapshot: Omit<GrowthSnapshotRecord, "id">;
}> {
  const projectId = String(conn.selectedProjectId || creds.projectId || "").trim();
  if (!projectId) {
    throw new Error("Firebase Project ID is required.");
  }

  let bearerToken = String(creds.oauthAccessToken || "").trim();
  if (!bearerToken && creds.serviceAccountJson) {
    bearerToken = await getGoogleAccessTokenFromServiceAccount(
      String(creds.serviceAccountJson),
      [
        "https://www.googleapis.com/auth/cloud-platform.read-only",
        "https://www.googleapis.com/auth/datastore",
        "https://www.googleapis.com/auth/identitytoolkit",
      ],
    );
  }
  if (!bearerToken) {
    throw new Error("Provide a Firebase Service Account JSON or authorize Google Cloud OAuth access.");
  }

  const nowIso = new Date().toISOString();
  const metrics: Array<Record<string, unknown>> = [];
  const timeSeriesMap = new Map<string, { date: string; auth_signups: number }>();
  const topPagesOrEvents: Array<{ name: string; count: number; detail?: string }> = [];
  let permissionNotes: string[] = [];

  // 1. Inspect Firebase Authentication users (separate from web traffic!)
  try {
    const authResp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ returnUserInfo: true, limit: "500" }),
        signal: AbortSignal.timeout(12000),
      },
    );
    if (authResp.ok) {
      const authData = (await authResp.json().catch(() => ({}))) as {
        recordsCount?: string;
        userInfo?: Array<{ createdAt?: string; emailVerified?: boolean }>;
      };
      const users = authData.userInfo || [];
      const totalAuthUsers = Number(authData.recordsCount ?? users.length);
      const verifiedUsers = users.filter((u) => u.emailVerified).length;

      const sMs = new Date(`${rangeSpec.startDate}T00:00:00Z`).getTime();
      const eMs = new Date(`${rangeSpec.endDate}T23:59:59Z`).getTime();
      const psMs = new Date(`${rangeSpec.prevStartDate}T00:00:00Z`).getTime();
      const peMs = new Date(`${rangeSpec.prevEndDate}T23:59:59Z`).getTime();

      let periodSignups = 0;
      let prevSignups = 0;
      for (const u of users) {
        const createdMs = Number(u.createdAt || 0);
        if (!createdMs) continue;
        if (createdMs >= sMs && createdMs <= eMs) {
          periodSignups++;
          const day = new Date(createdMs).toISOString().slice(0, 10);
          const cur = timeSeriesMap.get(day) || { date: day, auth_signups: 0 };
          cur.auth_signups += 1;
          timeSeriesMap.set(day, cur);
        } else if (createdMs >= psMs && createdMs <= peMs) {
          prevSignups++;
        }
      }

      const prov = {
        provider: "firebase",
        providerLabel: getProviderLabel("firebase"),
        projectOrProperty: projectId,
        reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
        retrievedAt: nowIso,
        attributionMethod: "Direct",
        completenessStatus: "connected_and_reporting",
        limitations:
          "Firebase Auth accounts represent registered accounts—never web visitors or GA4 analytics events.",
      };

      metrics.push(
        {
          key: "firebase_auth_accounts",
          label: "Firebase Registered Accounts",
          value: totalAuthUsers,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: { ...prov, definition: "Total Firebase Authentication accounts returned by Identity Toolkit." },
        },
        {
          key: "firebase_period_signups",
          label: "New Auth Signups (Period)",
          value: periodSignups,
          previousValue: prevSignups,
          growthPct: safeGrowthPct(periodSignups, prevSignups),
          unit: "count",
          provenance: { ...prov, definition: "Auth accounts created within reporting date range (up to first 500 queried)." },
        },
        {
          key: "firebase_verified_accounts",
          label: "Email-Verified Accounts",
          value: verifiedUsers,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: { ...prov, definition: "Accounts with `emailVerified === true`." },
        },
      );
    } else if (authResp.status === 401 || authResp.status === 403) {
      permissionNotes.push(`Identity Toolkit returned HTTP ${authResp.status} (missing firebaseauth.users.get permission).`);
    }
  } catch (e) {
    permissionNotes.push(e instanceof Error ? e.message : String(e));
  }

  // 2. Discover Firestore root collections
  try {
    const colResp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:listCollectionIds`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pageSize: 20 }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (colResp.ok) {
      const colData = (await colResp.json().catch(() => ({}))) as { collectionIds?: string[] };
      for (const col of colData.collectionIds || []) {
        topPagesOrEvents.push({ name: `firestore/${col}`, count: 1, detail: "Discovered Firestore collection" });
      }
    }
  } catch {
    // Non-fatal
  }

  const completeness: DataCompletenessStatus =
    metrics.length > 0
      ? "connected_and_reporting"
      : permissionNotes.length > 0
        ? "permission_restricted"
        : "connected_no_events";

  const statusDetail =
    metrics.length > 0
      ? `Connected to Firebase project "${projectId}". Firebase Analytics behavioral events come via GA4 Property connection.`
      : permissionNotes[0] || `Connected to Firebase project "${projectId}", no metrics returned.`;

  return {
    connPatch: {
      status: metrics.length > 0 ? "connected" : "error",
      selectedProjectId: projectId,
      selectedProjectName: projectId,
      completenessStatus: completeness,
      statusDetail,
      lastSyncedAt: nowIso,
      lastError: metrics.length > 0 ? undefined : statusDetail,
    },
    snapshot: {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "firebase",
      providerLabel: getProviderLabel("firebase"),
      projectOrProperty: projectId,
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: completeness,
      statusDetail,
      metrics,
      timeSeries: Array.from(timeSeriesMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      topPagesOrEvents,
      channels: [],
      retrievedAt: nowIso,
    },
  };
}

async function syncGa4(
  conn: AnalyticsConnectionRecord,
  creds: Record<string, unknown>,
  rangeSpec: DateRangeSpec,
): Promise<{
  connPatch: Partial<AnalyticsConnectionRecord>;
  snapshot: Omit<GrowthSnapshotRecord, "id">;
}> {
  let token = String(creds.oauthAccessToken || "").trim();
  if (!token && creds.serviceAccountJson) {
    token = await getGoogleAccessTokenFromServiceAccount(String(creds.serviceAccountJson), [
      "https://www.googleapis.com/auth/analytics.readonly",
    ]);
  }
  if (!token) {
    throw new Error("GA4 requires a Google OAuth token (analytics.readonly) or Service Account JSON.");
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const nowIso = new Date().toISOString();

  // Discover GA4 properties
  const sumResp = await fetch(
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=20",
    { headers, signal: AbortSignal.timeout(12000) },
  );
  const discoveredProjects: Array<{ id: string; name: string }> = [];
  if (sumResp.ok) {
    const sumJson = (await sumResp.json().catch(() => ({}))) as {
      accountSummaries?: Array<{
        propertySummaries?: Array<{ property?: string; displayName?: string }>;
      }>;
    };
    for (const acct of sumJson.accountSummaries || []) {
      for (const prop of acct.propertySummaries || []) {
        if (prop.property) {
          discoveredProjects.push({
            id: prop.property.replace(/^properties\//, ""),
            name: prop.displayName || prop.property,
          });
        }
      }
    }
  } else if (sumResp.status === 401 || sumResp.status === 403) {
    const detail = `GA4 Admin API returned HTTP ${sumResp.status}. Grant Google Analytics Read-Only permission.`;
    return {
      connPatch: {
        status: "error",
        completenessStatus: "permission_restricted",
        statusDetail: detail,
        lastError: detail,
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "ga4",
        providerLabel: getProviderLabel("ga4"),
        projectOrProperty: conn.selectedProjectName || "GA4 Property",
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "permission_restricted",
        statusDetail: detail,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso,
      },
    };
  }

  const activePropId = (conn.selectedProjectId || discoveredProjects[0]?.id || "").replace(/^properties\//, "");
  const activePropName =
    discoveredProjects.find((p) => p.id === activePropId)?.name ||
    conn.selectedProjectName ||
    (activePropId ? `GA4 Property ${activePropId}` : "No GA4 Property Selected");

  if (!activePropId) {
    const detail = "Connected Google account, but no GA4 property ID found.";
    return {
      connPatch: {
        status: "connected",
        discoveredProjects,
        completenessStatus: "connected_no_events",
        statusDetail: detail,
        lastSyncedAt: nowIso,
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "ga4",
        providerLabel: getProviderLabel("ga4"),
        projectOrProperty: activePropName,
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "connected_no_events",
        statusDetail: detail,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso,
      },
    };
  }

  const runReport = async (body: Record<string, unknown>) => {
    const r = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(activePropId)}:runReport`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      },
    );
    const j = (await r.json().catch(() => ({}))) as {
      rows?: Array<{
        dimensionValues?: Array<{ value?: string }>;
        metricValues?: Array<{ value?: string }>;
      }>;
      error?: { message?: string };
    };
    if (!r.ok) {
      throw new Error(j.error?.message || `GA4 Data API HTTP ${r.status}`);
    }
    return j.rows || [];
  };

  const [dailyRows, prevSummaryRows, channelRows, pageRows] = await Promise.all([
    runReport({
      dateRanges: [{ startDate: rangeSpec.startDate, endDate: rangeSpec.endDate }],
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "conversions" },
      ],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    }),
    runReport({
      dateRanges: [{ startDate: rangeSpec.prevStartDate, endDate: rangeSpec.prevEndDate }],
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "conversions" },
      ],
    }),
    runReport({
      dateRanges: [{ startDate: rangeSpec.startDate, endDate: rangeSpec.endDate }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "conversions" }],
      limit: 10,
    }),
    runReport({
      dateRanges: [{ startDate: rangeSpec.startDate, endDate: rangeSpec.endDate }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      limit: 10,
    }),
  ]);

  let activeUsers = 0;
  let sessions = 0;
  let pageViews = 0;
  let conversions = 0;
  const timeSeries = dailyRows.map((row) => {
    const rawDate = row.dimensionValues?.[0]?.value || "";
    const isoDate =
      rawDate.length === 8 ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : rawDate;
    const u = Number(row.metricValues?.[0]?.value || 0);
    const s = Number(row.metricValues?.[1]?.value || 0);
    const pv = Number(row.metricValues?.[2]?.value || 0);
    const c = Number(row.metricValues?.[3]?.value || 0);
    activeUsers += u;
    sessions += s;
    pageViews += pv;
    conversions += c;
    return { date: isoDate, active_users: u, sessions: s, pageviews: pv, conversions: c };
  });

  const prevRow = prevSummaryRows[0];
  const prevUsers = prevRow ? Number(prevRow.metricValues?.[0]?.value || 0) : null;
  const prevSessions = prevRow ? Number(prevRow.metricValues?.[1]?.value || 0) : null;
  const prevPageViews = prevRow ? Number(prevRow.metricValues?.[2]?.value || 0) : null;
  const prevConversions = prevRow ? Number(prevRow.metricValues?.[3]?.value || 0) : null;

  const completeness: DataCompletenessStatus =
    sessions === 0 && pageViews === 0 ? "connected_no_events" : "connected_and_reporting";
  const detail =
    completeness === "connected_no_events"
      ? `GA4 property "${activePropName}" connected, zero traffic recorded in period.`
      : `GA4 reporting ${sessions.toLocaleString()} sessions and ${pageViews.toLocaleString()} pageviews.`;

  const mkProv = (definition: string) => ({
    provider: "ga4" as const,
    providerLabel: getProviderLabel("ga4"),
    projectOrProperty: activePropName,
    reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
    retrievedAt: nowIso,
    definition,
    attributionMethod: "Provider-Attributed" as const,
    completenessStatus: completeness,
  });

  return {
    connPatch: {
      status: "connected",
      discoveredProjects,
      selectedProjectId: activePropId,
      selectedProjectName: activePropName,
      completenessStatus: completeness,
      statusDetail: detail,
      lastSyncedAt: nowIso,
      lastError: undefined,
    },
    snapshot: {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "ga4",
      providerLabel: getProviderLabel("ga4"),
      projectOrProperty: activePropName,
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: completeness,
      statusDetail: detail,
      metrics: [
        {
          key: "ga4_sessions",
          label: "GA4 Sessions",
          value: sessions,
          previousValue: prevSessions,
          growthPct: safeGrowthPct(sessions, prevSessions),
          unit: "count",
          provenance: mkProv("GA4 `sessions` metric over selected reporting period."),
        },
        {
          key: "ga4_active_users",
          label: "GA4 Active Users (Sum Daily)",
          value: activeUsers,
          previousValue: prevUsers,
          growthPct: safeGrowthPct(activeUsers, prevUsers),
          unit: "count",
          provenance: mkProv("GA4 `activeUsers` summed across selected days."),
        },
        {
          key: "ga4_pageviews",
          label: "GA4 Screen Page Views",
          value: pageViews,
          previousValue: prevPageViews,
          growthPct: safeGrowthPct(pageViews, prevPageViews),
          unit: "count",
          provenance: mkProv("GA4 `screenPageViews` metric."),
        },
        {
          key: "ga4_conversions",
          label: "GA4 Key Events / Conversions",
          value: conversions,
          previousValue: prevConversions,
          growthPct: safeGrowthPct(conversions, prevConversions),
          unit: "count",
          provenance: mkProv("GA4 `conversions` key events count."),
        },
      ],
      timeSeries,
      topPagesOrEvents: pageRows.map((r) => ({
        name: r.dimensionValues?.[0]?.value || "/",
        count: Number(r.metricValues?.[0]?.value || 0),
        detail: "GA4 pagePath",
      })),
      channels: channelRows.map((r) => ({
        channel: r.dimensionValues?.[0]?.value || "Unassigned",
        sessionsOrVisits: Number(r.metricValues?.[0]?.value || 0),
        users: Number(r.metricValues?.[1]?.value || 0),
        conversions: Number(r.metricValues?.[2]?.value || 0),
        attributionMethod: "Provider-Attributed",
      })),
      retrievedAt: nowIso,
    },
  };
}

async function syncGooglePlay(
  conn: AnalyticsConnectionRecord,
  creds: Record<string, unknown>,
  rangeSpec: DateRangeSpec,
): Promise<{
  connPatch: Partial<AnalyticsConnectionRecord>;
  snapshot: Omit<GrowthSnapshotRecord, "id">;
}> {
  const packageName = String(conn.selectedProjectId || creds.packageName || "").trim();
  if (!packageName) {
    throw new Error("Android Package Name (e.g. com.company.app) is required.");
  }
  let token = String(creds.oauthAccessToken || "").trim();
  if (!token && creds.serviceAccountJson) {
    token = await getGoogleAccessTokenFromServiceAccount(String(creds.serviceAccountJson), [
      "https://www.googleapis.com/auth/androidpublisher",
      "https://www.googleapis.com/auth/playdeveloperreporting",
    ]);
  }
  if (!token) {
    throw new Error("Google Play Console requires a Service Account JSON or Google OAuth token.");
  }

  const nowIso = new Date().toISOString();
  const revResp = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/reviews?maxResults=25`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12000),
    },
  );

  if (revResp.status === 401 || revResp.status === 403 || revResp.status === 404) {
    const detail = `Google Play API returned HTTP ${revResp.status} for "${packageName}". Confirm Play Console API access & service account permissions. Bulk install history requires Play GCS export or Play Developer Reporting API.`;
    return {
      connPatch: {
        status: "error",
        selectedProjectId: packageName,
        selectedProjectName: packageName,
        completenessStatus: "permission_restricted",
        statusDetail: detail,
        lastError: detail,
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "google_play",
        providerLabel: getProviderLabel("google_play"),
        projectOrProperty: packageName,
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "permission_restricted",
        statusDetail: detail,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso,
      },
    };
  }

  const revJson = (await revResp.json().catch(() => ({}))) as {
    reviews?: Array<{ comments?: Array<{ userComment?: { starRating?: number } }> }>;
  };
  const reviews = revJson.reviews || [];
  const ratings = reviews
    .map((r) => r.comments?.[0]?.userComment?.starRating)
    .filter((n): n is number => typeof n === "number");
  const avgRating =
    ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : null;

  const detail = `Connected to Play Console package "${packageName}". Showing live reviews (${reviews.length} recent). Store install/revenue exports require Play GCS bucket sync.`;
  return {
    connPatch: {
      status: "connected",
      selectedProjectId: packageName,
      selectedProjectName: packageName,
      completenessStatus: "connected_and_reporting",
      statusDetail: detail,
      lastSyncedAt: nowIso,
      lastError: undefined,
    },
    snapshot: {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "google_play",
      providerLabel: getProviderLabel("google_play"),
      projectOrProperty: packageName,
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: "connected_and_reporting",
      statusDetail: detail,
      metrics: [
        {
          key: "play_recent_reviews",
          label: "Recent Play Reviews",
          value: reviews.length,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: {
            provider: "google_play",
            providerLabel: getProviderLabel("google_play"),
            projectOrProperty: packageName,
            reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
            retrievedAt: nowIso,
            definition: "Recent reviews fetched via Android Publisher v3 API (last 7 days / max 25).",
            attributionMethod: "Direct",
            completenessStatus: "connected_and_reporting",
            limitations: "Historical install/revenue time-series require Google Play Cloud Storage export.",
          },
        },
        {
          key: "play_avg_recent_rating",
          label: "Avg Recent Rating",
          value: avgRating,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: {
            provider: "google_play",
            providerLabel: getProviderLabel("google_play"),
            projectOrProperty: packageName,
            reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
            retrievedAt: nowIso,
            definition: "Average star rating across retrieved recent Play reviews.",
            attributionMethod: "Direct",
            completenessStatus: "connected_and_reporting",
          },
        },
      ],
      timeSeries: [],
      topPagesOrEvents: [],
      channels: [],
      retrievedAt: nowIso,
    },
  };
}

async function syncGscViaComposio(
  conn: AnalyticsConnectionRecord,
  rangeSpec: DateRangeSpec,
): Promise<{
  connPatch: Partial<AnalyticsConnectionRecord>;
  snapshot: Omit<GrowthSnapshotRecord, "id">;
}> {
  const nowIso = new Date().toISOString();
  if (!isComposioConfigured()) {
    const detail = "Composio is not configured in environment.";
    return {
      connPatch: { status: "error", completenessStatus: "not_connected", statusDetail: detail },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "gsc",
        providerLabel: getProviderLabel("gsc"),
        projectOrProperty: "Search Console",
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "not_connected",
        statusDetail: detail,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso,
      },
    };
  }

  const { statuses } = await listComposioConnections(["google_search_console"], conn.workspaceId);
  const gscAccount = statuses.google_search_console?.accounts.find((a) => a.status === "active");
  if (!gscAccount) {
    const detail = "Google Search Console is not authorized in Composio Connect yet.";
    return {
      connPatch: { status: "disconnected", completenessStatus: "not_connected", statusDetail: detail },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "gsc",
        providerLabel: getProviderLabel("gsc"),
        projectOrProperty: "Search Console",
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "not_connected",
        statusDetail: detail,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso,
      },
    };
  }

  const sitesResult = await executeComposioTool<{ siteEntry?: Array<{ siteUrl?: string }> }>({
    toolkit: "google_search_console",
    toolSlug: "GOOGLE_SEARCH_CONSOLE_LIST_SITES",
    arguments: {},
    accountId: gscAccount.id,
    workspaceId: conn.workspaceId,
    userId: conn.ownerUid,
  });
  const sites = Array.isArray(sitesResult.data?.siteEntry) ? sitesResult.data.siteEntry : [];
  const siteUrl = conn.selectedProjectId || sites[0]?.siteUrl || "";
  if (!siteUrl) {
    const detail = "Authorized Search Console, but no verified site property was found.";
    return {
      connPatch: {
        status: "connected",
        completenessStatus: "connected_no_events",
        statusDetail: detail,
        lastSyncedAt: nowIso,
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "gsc",
        providerLabel: getProviderLabel("gsc"),
        projectOrProperty: "No verified site",
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "connected_no_events",
        statusDetail: detail,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso,
      },
    };
  }

  const analyticsRes = await executeComposioTool<{
    rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; position?: number }>;
  }>({
    toolkit: "google_search_console",
    toolSlug: "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
    arguments: {
      siteUrl,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      dimensions: ["date"],
      rowLimit: 90,
    },
    accountId: gscAccount.id,
    workspaceId: conn.workspaceId,
    userId: conn.ownerUid,
  });
  const rows = Array.isArray(analyticsRes.data?.rows) ? analyticsRes.data.rows : [];
  const totalClicks = rows.reduce((s, r) => s + Number(r.clicks || 0), 0);
  const totalImpressions = rows.reduce((s, r) => s + Number(r.impressions || 0), 0);
  const avgPos =
    rows.length > 0
      ? Math.round((rows.reduce((s, r) => s + Number(r.position || 0), 0) / rows.length) * 10) / 10
      : null;

  const completeness: DataCompletenessStatus =
    rows.length > 0 ? "connected_and_reporting" : "connected_no_events";
  const detail =
    rows.length > 0
      ? `Reporting ${totalClicks.toLocaleString()} organic clicks & ${totalImpressions.toLocaleString()} impressions for ${siteUrl}.`
      : `Connected to ${siteUrl}; zero Search Console impressions in range.`;

  return {
    connPatch: {
      status: "connected",
      selectedProjectId: siteUrl,
      selectedProjectName: siteUrl,
      discoveredProjects: sites.filter((s) => s.siteUrl).map((s) => ({ id: s.siteUrl!, name: s.siteUrl! })),
      completenessStatus: completeness,
      statusDetail: detail,
      lastSyncedAt: nowIso,
    },
    snapshot: {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "gsc",
      providerLabel: getProviderLabel("gsc"),
      projectOrProperty: siteUrl,
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: completeness,
      statusDetail: detail,
      metrics: [
        {
          key: "gsc_clicks",
          label: "Organic Clicks",
          value: totalClicks,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: {
            provider: "gsc",
            providerLabel: getProviderLabel("gsc"),
            projectOrProperty: siteUrl,
            reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
            retrievedAt: nowIso,
            definition: "Google Search Console total organic clicks.",
            attributionMethod: "Direct",
            completenessStatus: completeness,
          },
        },
        {
          key: "gsc_impressions",
          label: "Search Impressions",
          value: totalImpressions,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: {
            provider: "gsc",
            providerLabel: getProviderLabel("gsc"),
            projectOrProperty: siteUrl,
            reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
            retrievedAt: nowIso,
            definition: "Google Search Console total impressions.",
            attributionMethod: "Direct",
            completenessStatus: completeness,
          },
        },
        {
          key: "gsc_avg_position",
          label: "Average SERP Position",
          value: avgPos,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: {
            provider: "gsc",
            providerLabel: getProviderLabel("gsc"),
            projectOrProperty: siteUrl,
            reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
            retrievedAt: nowIso,
            definition: "Mean ranking position across reporting days.",
            attributionMethod: "Direct",
            completenessStatus: completeness,
          },
        },
      ],
      timeSeries: rows.map((r) => ({
        date: r.keys?.[0] || "",
        clicks: Number(r.clicks || 0),
        impressions: Number(r.impressions || 0),
      })),
      topPagesOrEvents: [],
      channels: [
        {
          channel: "Google Organic Search",
          sessionsOrVisits: totalClicks,
          users: null,
          conversions: null,
          attributionMethod: "Direct",
        },
      ],
      retrievedAt: nowIso,
    },
  };
}

export async function testAndSyncProviderConnection(
  conn: AnalyticsConnectionRecord,
  rangeSpec: DateRangeSpec,
): Promise<{
  connection: AnalyticsConnectionRecord;
  snapshot: GrowthSnapshotRecord;
}> {
  const creds = decryptCredentialPayload(conn.encryptedCredentials);
  let outcome: {
    connPatch: Partial<AnalyticsConnectionRecord>;
    snapshot: Omit<GrowthSnapshotRecord, "id">;
  };

  try {
    switch (conn.provider) {
      case "posthog":
        outcome = await syncPostHog(conn, creds, rangeSpec);
        break;
      case "supabase":
        outcome = await syncSupabase(conn, creds, rangeSpec);
        break;
      case "firebase":
        outcome = await syncFirebaseDirect(conn, creds, rangeSpec);
        break;
      case "ga4":
        outcome = await syncGa4(conn, creds, rangeSpec);
        break;
      case "google_play":
        outcome = await syncGooglePlay(conn, creds, rangeSpec);
        break;
      case "gsc":
        outcome = await syncGscViaComposio(conn, rangeSpec);
        break;
      case "app_store":
        outcome = {
          connPatch: {
            status: "connected",
            completenessStatus: "unsupported",
            statusDetail:
              "Apple App Store Connect Analytics Reports requires signed .p8 JWT async report generation in App Store Connect. Credentials metadata saved.",
            lastSyncedAt: new Date().toISOString(),
          },
          snapshot: {
            workspaceId: conn.workspaceId,
            ownerUid: conn.ownerUid,
            connectionId: conn.id,
            provider: "app_store",
            providerLabel: getProviderLabel("app_store"),
            projectOrProperty: conn.selectedProjectName || "App Store Connect",
            periodKey: rangeSpec.periodKey,
            startDate: rangeSpec.startDate,
            endDate: rangeSpec.endDate,
            completenessStatus: "unsupported",
            statusDetail:
              "App Store Connect Analytics API uses async Analytics Report Requests (.p8 private key JWT) rather than synchronous KPI reads.",
            metrics: [],
            timeSeries: [],
            topPagesOrEvents: [],
            channels: [],
            retrievedAt: new Date().toISOString(),
          },
        };
        break;
      default:
        outcome = {
          connPatch: {
            status: "error",
            completenessStatus: "unsupported",
            statusDetail: `Provider "${conn.provider}" requires Composio OAuth or direct read-only adapter setup.`,
          },
          snapshot: {
            workspaceId: conn.workspaceId,
            ownerUid: conn.ownerUid,
            connectionId: conn.id,
            provider: conn.provider,
            providerLabel: getProviderLabel(conn.provider),
            projectOrProperty: conn.selectedProjectName || conn.provider,
            periodKey: rangeSpec.periodKey,
            startDate: rangeSpec.startDate,
            endDate: rangeSpec.endDate,
            completenessStatus: "unsupported",
            statusDetail: `Direct pull not yet authorized for ${conn.provider}.`,
            metrics: [],
            timeSeries: [],
            topPagesOrEvents: [],
            channels: [],
            retrievedAt: new Date().toISOString(),
          },
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outcome = {
      connPatch: {
        status: "error",
        completenessStatus: "sync_failed",
        statusDetail: msg,
        lastError: msg,
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: conn.provider,
        providerLabel: getProviderLabel(conn.provider),
        projectOrProperty: conn.selectedProjectName || conn.provider,
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "sync_failed",
        statusDetail: msg,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: new Date().toISOString(),
      },
    };
  }

  const updatedConn = stateStore.upsertAnalyticsConnection({
    ...conn,
    ...outcome.connPatch,
    id: conn.id,
    workspaceId: conn.workspaceId,
    ownerUid: conn.ownerUid,
  });
  const savedSnapshot = stateStore.saveGrowthSnapshot(outcome.snapshot);
  return { connection: updatedConn, snapshot: savedSnapshot };
}

export function buildStrategyFeedbackComparison(workspaceId: string) {
  const strategies = stateStore.listStrategies(workspaceId);
  const activeStrategy = strategies.find((s) => s.status === "active") || strategies[0];
  if (!activeStrategy) return null;

  const snapshots = stateStore.listGrowthSnapshots(workspaceId);
  const comparisons: Array<{
    pillarOrGoal: string;
    linkedProvider?: string;
    observedMetric: string;
    observedValue: string;
    assessment: string;
  }> = [];

  for (const pillar of activeStrategy.contentPillars || []) {
    const posthogSnap = snapshots.find((s) => s.provider === "posthog");
    const ga4Snap = snapshots.find((s) => s.provider === "ga4");
    const gscSnap = snapshots.find((s) => s.provider === "gsc");
    const supaSnap = snapshots.find((s) => s.provider === "supabase");
    const fbSnap = snapshots.find((s) => s.provider === "firebase");

    const bestSnap = posthogSnap || ga4Snap || gscSnap || supaSnap || fbSnap;
    const firstMetric = bestSnap?.metrics?.[0] as { label?: string; value?: number | null } | undefined;

    comparisons.push({
      pillarOrGoal: pillar.pillar,
      linkedProvider: bestSnap?.providerLabel,
      observedMetric: firstMetric?.label || "No connected metric mapped",
      observedValue:
        firstMetric?.value !== undefined && firstMetric?.value !== null
          ? Number(firstMetric.value).toLocaleString()
          : "Unavailable",
      assessment: bestSnap
        ? `Grounded in live ${bestSnap.providerLabel} data (${bestSnap.completenessStatus.replace(/_/g, " ")}).`
        : "Connect PostHog, GA4, Search Console, or Supabase to track pillar outcome against real metrics.",
    });
  }

  const reportingCount = snapshots.filter((s) => s.completenessStatus === "connected_and_reporting").length;
  const goalAlignmentStatus =
    reportingCount === 0
      ? "no_connected_data"
      : reportingCount >= 2
        ? "aligned_data_available"
        : "partial_data";

  return {
    strategyId: activeStrategy.id,
    strategyTitle: activeStrategy.title,
    northStarMetric: activeStrategy.northStarMetric,
    goalAlignmentStatus,
    summary:
      reportingCount === 0
        ? `Strategy "${activeStrategy.title}" has no live analytics snapshots yet. Connect telemetry in Growth Intelligence to evaluate performance.`
        : `Evaluating "${activeStrategy.title}" (${activeStrategy.northStarMetric}) against ${reportingCount} live reporting source(s).`,
    comparisons,
  };
}
