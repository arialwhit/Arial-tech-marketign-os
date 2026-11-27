import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { Router, type Request } from "express";
import * as cheerio from "cheerio";
import { Type } from "@google/genai";
import {
  buildBusinessContextPrompt,
  formatGeminiError,
  getGeminiClient,
  parseJsonSafe,
  resolveTextModel,
  thinkingConfigForModel,
} from "../ai/geminiClient.js";
import { assertWorkspaceAccess, extractWorkspaceContext } from "../middleware/auth.js";
import { runTrackedAiCall } from "../services/aiTelemetry.js";
import {
  buildIntegrationRecommendations,
  detectTrackingTechnologies,
} from "../services/analyticsAdapters.js";
import { stateStore } from "../services/stateStore.js";
import { normalizeAndAssertPublicUrl, safePublicFetch } from "../utils/ssrf.js";
import { fetchOpenGraphImage } from "../utils/openGraph.js";
import { isVercelRuntime, resolveFfprobeBin, resolveSafeUploadCandidate } from "../utils/paths.js";

const execFileAsync = promisify(execFile);
const router = Router();

function wsCtx(req: Request) {
  return extractWorkspaceContext(req);
}

async function checkUrlExists(url: string): Promise<boolean> {
  try {
    const { response } = await safePublicFetch(url, {
      timeoutMs: 4000,
      method: "GET",
      headers: { "User-Agent": "MarketingOSBot/1.0" },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function readHtmlLimited(response: Response, maxChars: number, timeoutMs: number): Promise<string> {
  const body = response.body;
  if (!body) return (await response.text()).slice(0, maxChars);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  const started = Date.now();
  try {
    while (html.length < maxChars && Date.now() - started < timeoutMs) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) html += decoder.decode(value, { stream: true });
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The body is already closed.
    }
  }
  return html.slice(0, maxChars);
}

export async function crawlUrl(targetUrl: string, options?: { fast?: boolean }) {
  const fast = Boolean(options?.fast);
  const timeoutMs = fast ? 8000 : 12000;
  const safeTarget = await normalizeAndAssertPublicUrl(targetUrl);
  const { response: res, finalUrl, ttfbMs } = await safePublicFetch(safeTarget, {
    timeoutMs,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MarketingOSBot/1.0; +https://marketingos.app)",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${finalUrl}`);
  }
  const html = await readHtmlLimited(res, fast ? 500_000 : 1_200_000, timeoutMs);
  const tracking = detectTrackingTechnologies(html);
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();

  const title = $("title").first().text().trim();
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    "";
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || "";
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim() || "";
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || "";
  const viewport = $('meta[name="viewport"]').attr("content")?.trim() || "";
  const h1s = $("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 10);
  const h2s = $("h2")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 15);

  const jsonLdCount = html.includes("application/ld+json") ? 1 : 0;
  const images = $("img").toArray();
  const imagesMissingAlt = images.filter((el) => !$(el).attr("alt")?.trim()).length;
  const parsedFinal = new URL(finalUrl);
  const links = $("a[href]")
    .map((_, el) => $(el).attr("href") || "")
    .get()
    .filter(Boolean);
  const internalLinks = links.filter(
    (href) => href.startsWith("/") || href.includes(parsedFinal.hostname),
  ).length;

  const origin = parsedFinal.origin;
  let robotsTxtFound = false;
  let sitemapXmlFound = false;
  const brokenLinks: string[] = [];
  if (!fast) {
    [robotsTxtFound, sitemapXmlFound] = await Promise.all([
      checkUrlExists(`${origin}/robots.txt`),
      checkUrlExists(`${origin}/sitemap.xml`),
    ]);

    const candidateLinks: string[] = [];
    for (const href of links) {
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      try {
        const abs = new URL(href, origin).toString();
        if (/^https?:\/\//i.test(abs) && !candidateLinks.includes(abs)) {
          candidateLinks.push(abs);
        }
        if (candidateLinks.length >= 5) break;
      } catch {
        // skip malformed href
      }
    }
    await Promise.all(
      candidateLinks.map(async (linkUrl) => {
        try {
          const check = await safePublicFetch(linkUrl, { timeoutMs: 4000, method: "HEAD" });
          if (check.response.status >= 400 && check.response.status !== 405) {
            brokenLinks.push(`${linkUrl} (HTTP ${check.response.status})`);
          }
        } catch {
          // ignore network timeout on third-party link check
        }
      }),
    );
  }

  const bodyText = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);

  return {
    ok: true as const,
    url: finalUrl,
    ttfbMs,
    title,
    ogTitle,
    ogImage,
    metaDescription,
    canonical,
    viewport,
    h1s,
    h2s,
    jsonLdCount,
    robotsTxtFound,
    sitemapXmlFound,
    brokenLinks,
    totalImages: images.length,
    imagesMissingAlt,
    internalLinks,
    wordCount: bodyText ? bodyText.split(/\s+/).length : 0,
    bodyExcerpt: bodyText.slice(0, 4500),
    tracking,
  };
}

export function extractGroundingSources(response: unknown): Array<{ title: string; url: string }> {
  const candidates = (response as { candidates?: Array<{ groundingMetadata?: { groundingChunks?: Array<{ web?: { title?: string; uri?: string } }> } }> })?.candidates;
  const chunks = candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: Array<{ title: string; url: string }> = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ title: chunk.web?.title || uri, url: uri });
    }
  }
  return sources.slice(0, 8);
}

export async function executeBusinessIntelligenceAnalysis(params: {
  input: Record<string, unknown>;
  workspaceId: string;
  actorUid: string;
  onStageProgress?: (stage: string, pct: number, partial?: Record<string, unknown>) => void;
}) {
  const {
    name,
    websiteUrl,
    industry,
    description,
    location,
    targetCountries,
    products,
    objectives,
    channels,
    model,
  } = params.input;

  params.onStageProgress?.("Validating & normalizing website URL", 15);
  const target = await normalizeAndAssertPublicUrl(String(websiteUrl || ""));

  const hosted = isVercelRuntime();
  params.onStageProgress?.("Crawling public website & metadata", 35);
  let crawled: Awaited<ReturnType<typeof crawlUrl>> | null = null;
  let crawlError = "";
  try {
    crawled = await crawlUrl(target, { fast: hosted });
  } catch (err) {
    crawlError = err instanceof Error ? err.message : String(err);
  }

  const partialCrawl = crawled
    ? {
        url: crawled.url,
        title: crawled.title,
        metaDescription: crawled.metaDescription,
        h1s: crawled.h1s,
        h2s: crawled.h2s,
        wordCount: crawled.wordCount,
        internalLinks: crawled.internalLinks,
      }
    : null;

  params.onStageProgress?.("Running Gemini Business Intelligence extraction", 65, {
    crawled: partialCrawl,
    crawlError: crawlError || undefined,
  });

  const ai = getGeminiClient();
  const selectedModel = resolveTextModel(typeof model === "string" ? model : undefined);

  const prompt = `Analyze this business and produce a complete, structured Marketing OS Business Intelligence Profile.
User-provided info:
- Name: ${String(name || "Unknown")}
- Website: ${target}
- Industry: ${String(industry || "")}
- Description: ${String(description || "")}
- Location: ${String(location || "")}
- Target Markets: ${String(targetCountries || "")}
- Products: ${Array.isArray(products) ? products.join(", ") : ""}
- Objectives: ${Array.isArray(objectives) ? objectives.join(", ") : ""}
- Channels: ${Array.isArray(channels) ? channels.join(", ") : ""}

${
  crawled
    ? `Live Crawled Website Snapshot:
- Title: ${crawled.title}
- Meta Description: ${crawled.metaDescription}
- H1 Headings: ${crawled.h1s.join(" | ")}
- H2 Headings: ${crawled.h2s.join(" | ")}
- Word Count (excerpt): ${crawled.wordCount}
- Content Excerpt: ${crawled.bodyExcerpt}`
    : `Direct HTML crawl encountered (${crawlError}). Use Google Search grounding for ${target} and the user description.`
}

Return a strict JSON object matching the schema.`;

  const response = await runTrackedAiCall(
    {
      workspaceId: params.workspaceId,
      actorUid: params.actorUid,
      endpoint: "/api/analyze-website",
      agent: "Business Intelligence Analyzer",
      model: selectedModel,
      creditsEstimated: 80,
    },
    () => {
      const generation = ai.models.generateContent({
        model: selectedModel,
        contents: prompt,
        config: {
          systemInstruction:
            "You are a senior brand strategist and marketing intelligence analyst. Base claims on crawled facts and provided inputs; never invent fake metrics.",
          thinkingConfig: thinkingConfigForModel(selectedModel, hosted ? "low" : "medium"),
          ...(crawled ? {} : { tools: [{ googleSearch: {} }] }),
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              businessSummary: { type: Type.STRING },
              industry: { type: Type.STRING },
              positioning: { type: Type.STRING },
              valueProposition: { type: Type.STRING },
              brandVoiceNotes: { type: Type.STRING },
              wordsToUse: { type: Type.STRING },
              wordsToAvoid: { type: Type.STRING },
              targetAudienceSummary: { type: Type.STRING },
              customerNeed: { type: Type.STRING },
              keyDifferentiator: { type: Type.STRING },
              proofDirection: { type: Type.STRING },
              pagesMappedSummary: { type: Type.STRING },
              keywordOpportunities: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              competitorNames: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              contentFormats: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
          },
        },
      });
      if (!hosted) return generation;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timed = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Hosted analysis ran out of time before Gemini returned. Retry the scan."));
        }, 22000);
      });
      return Promise.race([generation, timed]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    },
  );

  const parsed = parseJsonSafe<Record<string, unknown>>(response.text);
  const sources = extractGroundingSources(response);

  params.onStageProgress?.("Saving verified brand memory", 90);
  if (params.workspaceId) {
    const existingMem = stateStore.listMemories(params.workspaceId, "business");
    if (existingMem.length === 0 && parsed?.positioning) {
      stateStore.addMemory({
        workspaceId: params.workspaceId,
        ownerUid: params.actorUid,
        scope: "business",
        source: "verified_business",
        approved: true,
        title: `${String(name || "Brand")} Core Positioning & Value Prop`,
        content: `${String(parsed.positioning || "")} — Value Prop: ${String(parsed.valueProposition || "")}`,
        tags: ["positioning", "onboarding"],
      });
    }
  }

  const connectedProviders = params.workspaceId
    ? stateStore
        .listAnalyticsConnections(params.workspaceId)
        .filter((c) => c.status === "connected")
        .map((c) => c.provider)
    : [];

  const integrationRecommendations = buildIntegrationRecommendations({
    products: Array.isArray(products) ? products.map(String) : [],
    channels: Array.isArray(channels) ? channels.map(String) : [],
    websiteUrl: target,
    tracking: crawled?.tracking || null,
    connectedProviders,
  });

  if (params.workspaceId) {
    stateStore.setIntegrationRecommendations(
      params.workspaceId,
      integrationRecommendations as unknown as Array<Record<string, unknown>>,
    );
  }

  return {
    sourceType: crawled ? "live_crawl" : "ai_grounded",
    model: selectedModel,
    crawled: partialCrawl,
    crawlError: crawlError || undefined,
    tracking: crawled?.tracking || null,
    integrationRecommendations,
    intelligence: parsed,
    sources,
  };
}

router.post("/analyze-website", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const result = await executeBusinessIntelligenceAnalysis({
      input: req.body as Record<string, unknown>,
      workspaceId: ctx.workspaceId,
      actorUid: ctx.actorUid,
    });
    res.json(result);
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/research/competitors", async (req, res) => {
  try {
    const { business, market = "Global", focusQuery = "", model } = req.body as {
      business?: Record<string, unknown>;
      market?: string;
      focusQuery?: string;
      model?: string;
    };
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const prompt = `Identify 4 to 6 real direct and indirect competitors for this business using live Google Search grounding.
${buildBusinessContextPrompt(business)}
Target Market Filter: ${market}
Focus Query: ${focusQuery || "General competitive landscape"}

Return ONLY valid JSON with this structure:
{
  "positioningOpportunity": {
    "headline": "string",
    "summary": "string",
    "score": 88
  },
  "competitors": [
    {
      "name": "string",
      "category": "Direct" | "Indirect",
      "website": "string",
      "positioning": "string",
      "estimatedAudience": "string (mark as qualitative range or public signal if exact unavailable)",
      "strength": "string",
      "weakness": "string",
      "opportunityScore": 85,
      "contentPillars": [
        { "title": "string", "share": 40 }
      ]
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction:
          "You are a competitive intelligence researcher. Use Google Search to find real competing products and companies. Output strictly valid JSON.",
        tools: [{ googleSearch: {} }],
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json",
      },
    });

    const data = parseJsonSafe<Record<string, unknown>>(response.text);
    const sources = extractGroundingSources(response);

    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data,
      sources,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/research/influencers", async (req, res) => {
  try {
    const { business, platform = "All", nicheQuery = "", country = "Global", model } = req.body as {
      business?: Record<string, unknown>;
      platform?: string;
      nicheQuery?: string;
      country?: string;
      model?: string;
    };
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const prompt = `Find 4 to 6 real, publicly active content creators / influencers who align with this business.
${buildBusinessContextPrompt(business)}
Platform focus: ${platform}
Country/Region: ${country}
Niche search: ${nicheQuery || "Core industry creators and educators"}

Important accuracy rules:
- Use Google Search to identify real creators and their public profile URLs.
- profileUrl must be a real https link from search results, or an empty string if you cannot verify one.
- Do not invent follower counts, engagement rates, or image URLs.
- For follower or engagement numbers, provide publicly reported figures when found in search, or clearly label as "Est." / "Public signal".

Return ONLY valid JSON:
{
  "creators": [
    {
      "name": "string",
      "handle": "@handle",
      "platform": "Instagram" | "TikTok" | "YouTube" | "LinkedIn",
      "niche": "string",
      "followers": "string",
      "engagement": "string",
      "brandFit": 92,
      "whyFit": "string",
      "profileUrl": "https://..."
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction:
          "You are a creator partnerships strategist. Use Google Search grounding to recommend real creators. Return strictly valid JSON.",
        tools: [{ googleSearch: {} }],
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json",
      },
    });

    const data = parseJsonSafe<{ creators?: Array<Record<string, unknown>> }>(response.text, { creators: [] });
    const creators = Array.isArray(data.creators) ? data.creators.slice(0, 6) : [];
    const withPhotos = await Promise.all(
      creators.map(async (creator) => {
        const profileUrl = typeof creator.profileUrl === "string" ? creator.profileUrl : "";
        const avatarUrl = profileUrl ? await fetchOpenGraphImage(profileUrl) : null;
        return { ...creator, profileUrl, avatarUrl: avatarUrl || "" };
      }),
    );
    const sources = extractGroundingSources(response);

    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      creators: withPhotos,
      sources,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/research/trends", async (req, res) => {
  try {
    const { business, topic = "", timeframe = "Last 30 days", model } = req.body as {
      business?: Record<string, unknown>;
      topic?: string;
      timeframe?: string;
      model?: string;
    };
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const prompt = `Discover 4 high-performing, current content formats and trending marketing topics relevant to this business.
${buildBusinessContextPrompt(business)}
Topic Filter: ${topic || "All brand topics"}
Timeframe: ${timeframe}

Return ONLY valid JSON:
{
  "trends": [
    {
      "title": "string",
      "patternName": "string (e.g. Problem -> Reset -> System)",
      "platform": "TikTok" | "Instagram" | "YouTube Shorts" | "LinkedIn",
      "duration": "28s",
      "whyItFits": "string",
      "signalSummary": "string (grounded trend signal, no fake view counts)",
      "sourceUrl": "https:// link to the real public post or article you found, or empty string",
      "timeline": [
        { "time": "0-3s", "beat": "HOOK", "text": "string" },
        { "time": "3-9s", "beat": "TENSION", "text": "string" },
        { "time": "9-21s", "beat": "SOLUTION", "text": "string" },
        { "time": "21-28s", "beat": "CTA", "text": "string" }
      ],
      "productionNotes": ["Fast jump cuts", "Center captions"]
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction:
          "You are a creative strategist analyzing real social video patterns and industry conversations. Output strictly valid JSON.",
        tools: [{ googleSearch: {} }],
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json",
      },
    });

    const data = parseJsonSafe<{ trends?: Array<Record<string, unknown>> }>(response.text, { trends: [] });
    const trends = Array.isArray(data.trends) ? data.trends.slice(0, 6) : [];
    const withThumbs = await Promise.all(
      trends.map(async (trend) => {
        const sourceUrl = typeof trend.sourceUrl === "string" ? trend.sourceUrl : "";
        const thumbUrl = sourceUrl ? await fetchOpenGraphImage(sourceUrl) : null;
        return { ...trend, sourceUrl, thumbUrl: thumbUrl || "" };
      }),
    );
    const sources = extractGroundingSources(response);

    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      trends: withThumbs,
      sources,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

export async function executeSeoAuditAnalysis(params: {
  websiteUrl: string;
  business?: Record<string, unknown>;
  model?: string;
  workspaceId: string;
  actorUid: string;
  triggeredBy?: "weekly_cron" | "seo_agent" | "manual";
}) {
  const target = await normalizeAndAssertPublicUrl(String(params.websiteUrl || params.business?.websiteUrl || ""));
  let crawled: Awaited<ReturnType<typeof crawlUrl>> | null = null;
  let crawlError = "";
  try {
    crawled = await crawlUrl(target);
  } catch (err) {
    crawlError = err instanceof Error ? err.message : String(err);
  }

  const technicalChecks: Array<{
    title: string;
    severity: "High" | "Medium" | "Low";
    passed: boolean;
    why: string;
    fix: string;
  }> = crawled
    ? [
        {
          title: "Title tag length & presence",
          severity: !crawled.title ? "High" : crawled.title.length < 25 || crawled.title.length > 65 ? "Medium" : "Low",
          passed: Boolean(crawled.title) && crawled.title.length >= 25 && crawled.title.length <= 65,
          why: crawled.title
            ? `Detected title (${crawled.title.length} chars): "${crawled.title}"`
            : "No <title> tag detected on homepage.",
          fix: "Keep <title> between 45–60 characters with primary commercial intent keywords.",
        },
        {
          title: "Meta description coverage",
          severity: !crawled.metaDescription ? "High" : "Low",
          passed: Boolean(crawled.metaDescription),
          why: crawled.metaDescription
            ? `Meta description found (${crawled.metaDescription.length} chars).`
            : "Missing <meta name='description'> reduces SERP click-through clarity.",
          fix: "Write a compelling 135–155 character summary explaining value proposition and CTA.",
        },
        {
          title: "Robots.txt & XML Sitemap discovery",
          severity: !crawled.robotsTxtFound || !crawled.sitemapXmlFound ? "Medium" : "Low",
          passed: crawled.robotsTxtFound && crawled.sitemapXmlFound,
          why: `robots.txt: ${crawled.robotsTxtFound ? "found" : "missing"}, sitemap.xml: ${crawled.sitemapXmlFound ? "found" : "missing"}, TTFB: ${crawled.ttfbMs}ms.`,
          fix: "Publish valid /robots.txt and /sitemap.xml and link the sitemap inside Search Console.",
        },
        {
          title: "Structured JSON-LD schema & Canonical tag",
          severity: crawled.jsonLdCount === 0 ? "High" : !crawled.canonical ? "Medium" : "Low",
          passed: crawled.jsonLdCount > 0 && Boolean(crawled.canonical),
          why: `JSON-LD: ${crawled.jsonLdCount > 0 ? "detected" : "missing"}, canonical: ${crawled.canonical ? crawled.canonical : "missing"}.`,
          fix: "Add Organization + Product JSON-LD schema and self-referencing <link rel='canonical'>.",
        },
        {
          title: "H1 hierarchy, image alt & sampled link health",
          severity:
            crawled.brokenLinks.length > 0 || crawled.h1s.length === 0 || crawled.imagesMissingAlt > 0
              ? "Medium"
              : "Low",
          passed:
            crawled.h1s.length === 1 &&
            crawled.imagesMissingAlt === 0 &&
            crawled.brokenLinks.length === 0,
          why: `Found ${crawled.h1s.length} H1 tags, ${crawled.imagesMissingAlt}/${crawled.totalImages} images missing alt, ${crawled.brokenLinks.length} broken sampled links.`,
          fix: "Ensure one clear H1, descriptive alt attributes, and fix any 4xx/5xx internal links.",
        },
      ]
    : [];

  const ai = getGeminiClient();
  const selectedModel = resolveTextModel(params.model);

  const prompt = `Perform an actionable SEO keyword & technical opportunity analysis for ${target}.
${buildBusinessContextPrompt(params.business)}
${
  crawled
    ? `Live Crawl Findings:
- Title: ${crawled.title}
- Meta Description: ${crawled.metaDescription}
- Canonical: ${crawled.canonical || "Missing"}
- robots.txt: ${crawled.robotsTxtFound}, sitemap.xml: ${crawled.sitemapXmlFound}, TTFB: ${crawled.ttfbMs}ms
- H1s: ${crawled.h1s.join(" | ")}
- H2s: ${crawled.h2s.join(" | ")}
- Images missing alt: ${crawled.imagesMissingAlt}/${crawled.totalImages}
- Broken sampled links: ${crawled.brokenLinks.join(", ") || "None"}
- JSON-LD present: ${crawled.jsonLdCount > 0}
- Word count: ${crawled.wordCount}`
    : `Crawl note: ${crawlError}`
}

Return ONLY valid JSON:
{
  "healthScore": 82,
  "headline": "string",
  "summary": "string",
  "issues": [
    { "title": "string", "severity": "High" | "Medium" | "Low", "why": "string", "fix": "string" }
  ],
  "keywords": [
    { "keyword": "string", "intent": "Commercial" | "Informational" | "Transactional", "difficulty": "Low" | "Medium" | "High", "priority": "High" | "Rising" | "Medium", "contentIdea": "string" }
  ]
}`;

  const response = await runTrackedAiCall(
    {
      workspaceId: params.workspaceId,
      actorUid: params.actorUid,
      endpoint: "/api/seo/audit",
      agent: "Technical SEO Auditor",
      model: selectedModel,
      creditsEstimated: 65,
    },
    () =>
      ai.models.generateContent({
        model: selectedModel,
        contents: prompt,
        config: {
          systemInstruction:
            "You are a technical SEO strategist. Base technical issues on real crawled evidence and avoid fabricating fake search volume numbers.",
          tools: [{ googleSearch: {} }],
          thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
          responseMimeType: "application/json",
        },
      }),
  );

  const aiAudit = parseJsonSafe<Record<string, unknown>>(response.text);
  const sources = extractGroundingSources(response);

  const savedReport = stateStore.addSeoAuditReport({
    workspaceId: params.workspaceId,
    ownerUid: params.actorUid,
    websiteUrl: target,
    triggeredBy: params.triggeredBy || "manual",
    healthScore: Number(aiAudit.healthScore) || 75,
    headline: String(aiAudit.headline || `Technical SEO Audit — ${target}`),
    summary: String(aiAudit.summary || ""),
    technicalChecks,
    issues: Array.isArray(aiAudit.issues) ? (aiAudit.issues as Array<{ title: string; severity: "High" | "Medium" | "Low"; why: string; fix: string }>) : [],
    keywords: Array.isArray(aiAudit.keywords) ? (aiAudit.keywords as Array<{ keyword: string; intent: string; difficulty: string; priority: string }>) : [],
    crawled: crawled ? { url: crawled.url, title: crawled.title, ttfbMs: crawled.ttfbMs, robotsTxtFound: crawled.robotsTxtFound, sitemapXmlFound: crawled.sitemapXmlFound } : null,
  });

  return {
    reportId: savedReport.id,
    createdAt: savedReport.createdAt,
    triggeredBy: savedReport.triggeredBy,
    sourceType: crawled ? "live_crawl" : "ai_grounded",
    model: selectedModel,
    crawled,
    technicalChecks,
    ...aiAudit,
    sources,
  };
}

router.post("/seo/audit", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const { websiteUrl, business, model, triggeredBy } = req.body as {
      websiteUrl?: string;
      business?: Record<string, unknown>;
      model?: string;
      triggeredBy?: "weekly_cron" | "seo_agent" | "manual";
    };
    const out = await executeSeoAuditAnalysis({
      websiteUrl: String(websiteUrl || business?.websiteUrl || ""),
      business,
      model,
      workspaceId: ctx.workspaceId,
      actorUid: ctx.actorUid,
      triggeredBy: triggeredBy || "seo_agent",
    });
    res.json(out);
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/aso/optimize", async (req, res) => {
  try {
    const { business, currentTitle, currentSubtitle, currentDescription, model } = req.body as {
      business?: Record<string, unknown>;
      currentTitle?: string;
      currentSubtitle?: string;
      currentDescription?: string;
      model?: string;
    };
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const prompt = `Optimize this App Store / Google Play listing based on the business intelligence profile.
${buildBusinessContextPrompt(business)}
Current Title: ${currentTitle || String(business?.name || "App")}
Current Subtitle: ${currentSubtitle || "AI Growth Coach"}
Current Description: ${currentDescription || String(business?.description || "")}

Return ONLY valid JSON:
{
  "currentScore": 72,
  "potentialScore": 91,
  "headline": "string",
  "rationale": "string",
  "optimizedSubtitle": "string (max 30 chars)",
  "optimizedHeadline": "string",
  "optimizedDescription": "string",
  "breakdown": [
    { "label": "Title keyword coverage", "score": 88 },
    { "label": "Screenshot clarity", "score": 84 },
    { "label": "Value proposition", "score": 92 },
    { "label": "Conversion hooks", "score": 89 }
  ],
  "keywordTags": ["string"]
}`;

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: "You are an App Store Optimization specialist. Output strictly valid JSON.",
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json",
      },
    });

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

router.post("/strategy/generate", async (req, res) => {
  try {
    const { business, goal = "30-day multi-channel growth", budget = "$500/mo", model } = req.body as {
      business?: Record<string, unknown>;
      goal?: string;
      budget?: string;
      model?: string;
    };
    const ctx = wsCtx(req);
    const snapshots = stateStore.listGrowthSnapshots(ctx.workspaceId);
    const telemetryBlock = snapshots.length
      ? `\nConnected Real Growth Metrics Snapshot:\n${snapshots
          .slice(0, 4)
          .map(
            (s) =>
              `- ${s.providerLabel} (${s.completenessStatus}): ${(s.metrics || [])
                .map((m) => `${String(m.label)}=${String(m.value ?? "N/A")}`)
                .join(", ")}`,
          )
          .join("\n")}\nUse these real baseline metrics in your strategy recommendations without inventing unseen numbers.`
      : "";

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const prompt = `Create an actionable Marketing Strategy & Campaign Blueprint for this business.
${buildBusinessContextPrompt(business)}${telemetryBlock}
Primary Campaign Goal: ${goal}
Monthly Media / Production Budget: ${budget}

Return ONLY valid JSON:
{
  "title": "string",
  "executiveSummary": "string",
  "northStarMetric": "string",
  "icpSegments": [
    { "name": "string", "painPoint": "string", "hookAngle": "string", "channels": ["Instagram", "TikTok"] }
  ],
  "contentPillars": [
    { "pillar": "string", "ratio": "40%", "format": "string", "exampleHook": "string" }
  ],
  "weeklyRoadmap": [
    { "week": "Week 1", "focus": "string", "deliverables": ["string"] }
  ],
  "experiments": [
    { "name": "string", "hypothesis": "string", "metric": "string", "effort": "Low" | "Medium" | "High" }
  ]
}`;

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: "You are a Chief Marketing Officer designing a sharp, testable growth strategy. Output strictly valid JSON.",
        thinkingConfig: thinkingConfigForModel(selectedModel, "high"),
        responseMimeType: "application/json",
      },
    });

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

function resolveSafeLocalMediaPath(assetUrl: string): string | null {
  return resolveSafeUploadCandidate(assetUrl);
}

router.post("/intelligence/channel", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const { channelUrl, handle, platform = "Instagram", business, model } = req.body as {
      channelUrl?: string;
      handle?: string;
      platform?: string;
      business?: Record<string, unknown>;
      model?: string;
    };

    if (!channelUrl?.trim() && !handle?.trim()) {
      res.status(400).json({ error: "Provide a public channel URL or creator handle." });
      return;
    }

    let crawled: Awaited<ReturnType<typeof crawlUrl>> | null = null;
    let safeChannelUrl = "";
    if (channelUrl?.trim()) {
      safeChannelUrl = await normalizeAndAssertPublicUrl(channelUrl.trim());
      try {
        crawled = await crawlUrl(safeChannelUrl);
      } catch {
        // Many social platforms restrict direct bot crawls; fall back to Search grounding cleanly
      }
    }

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const prompt = `Analyze this creator/brand social channel and separate verifiable public observations from strategic hypotheses.
${buildBusinessContextPrompt(business)}
Target Platform: ${platform}
Handle: ${handle || "Unknown"}
Channel URL: ${safeChannelUrl || "N/A"}
${crawled ? `Observed Public HTML Snapshot:\nTitle: ${crawled.title}\nMeta: ${crawled.metaDescription}\nExcerpt: ${crawled.bodyExcerpt.slice(0, 2000)}` : "Direct HTML crawl unavailable; rely on public Google Search results only. Never invent private analytics or exact view counts if unavailable."}

Return ONLY valid JSON:
{
  "creatorName": "string",
  "handle": "string",
  "platform": "string",
  "niche": "string",
  "positioningSummary": "string",
  "targetAudienceClues": "string",
  "postingPatterns": "string",
  "contentFormats": ["string"],
  "recurringHooks": ["string"],
  "ctaStyle": "string",
  "observedFacts": ["string (strictly verified from URL/search results)"],
  "aiHypotheses": ["string (strategic inference, labeled clearly as hypothesis)"],
  "brandAdaptationIdeas": ["string (how the user's business can adapt these patterns)"]
}`;

    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/intelligence/channel",
        agent: "Creator Channel Analyzer",
        model: selectedModel,
        creditsEstimated: 55,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents: prompt,
          config: {
            systemInstruction:
              "You are a senior creator economy strategist. Strictly separate verifiable public facts from AI hypotheses. Never fabricate engagement rates, revenue, or follower stats.",
            tools: [{ googleSearch: {} }],
            thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
            responseMimeType: "application/json",
          },
        }),
    );

    const parsed = parseJsonSafe<Record<string, unknown>>(response.text);
    const sources = extractGroundingSources(response);

    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      channelUrl: safeChannelUrl || undefined,
      ...parsed,
      sources,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.post("/intelligence/video", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const {
      videoUrl,
      mediaId,
      assetUrl,
      title,
      platform = "TikTok",
      creatorHandle = "",
      business,
      model,
    } = req.body as {
      videoUrl?: string;
      mediaId?: string;
      assetUrl?: string;
      title?: string;
      platform?: string;
      creatorHandle?: string;
      business?: Record<string, unknown>;
      model?: string;
    };

    const assetRecord = mediaId ? stateStore.getMediaAssetById(mediaId, ctx.workspaceId) : null;
    const localRel = assetRecord?.url || assetUrl || "";
    const localPath = localRel ? resolveSafeLocalMediaPath(localRel) : null;

    let safePublicVideoUrl = "";
    let crawled: Awaited<ReturnType<typeof crawlUrl>> | null = null;
    if (!localPath) {
      if (!videoUrl?.trim()) {
        res.status(400).json({ error: "Provide an uploaded video from Media Library or a public video URL." });
        return;
      }
      safePublicVideoUrl = await normalizeAndAssertPublicUrl(videoUrl.trim());
      try {
        crawled = await crawlUrl(safePublicVideoUrl);
      } catch {
        // non-fatal; search grounding still provides public context
      }
    }

    let durationSec: number | undefined;
    let videoMetadata: Record<string, unknown> | null = null;
    let inlineVideoPart: { inlineData: { data: string; mimeType: string } } | null = null;

    if (localPath) {
      try {
        const { stdout } = await execFileAsync(resolveFfprobeBin(), [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          localPath,
        ]);
        const probe = JSON.parse(stdout) as {
          format?: { duration?: string; size?: string };
          streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
        };
        const vStream = probe.streams?.find((s) => s.codec_type === "video");
        durationSec = probe.format?.duration ? Math.round(Number(probe.format.duration)) : undefined;
        videoMetadata = {
          durationSec,
          width: vStream?.width,
          height: vStream?.height,
        };
      } catch {
        // continue without ffprobe if unavailable
      }

      const stats = fs.statSync(localPath);
      if (stats.size <= 16 * 1024 * 1024) {
        inlineVideoPart = {
          inlineData: {
            data: fs.readFileSync(localPath).toString("base64"),
            mimeType: assetRecord?.mimeType || "video/mp4",
          },
        };
      }
    }

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const textPrompt = `Break down this short-form marketing video into a timestamped creative & editing blueprint so our Video Editor can recreate the winning pattern.
${buildBusinessContextPrompt(business)}
Title: ${title || assetRecord?.originalName || "Reference Video"}
Platform: ${platform}
Creator Handle: ${creatorHandle || "Unknown"}
Source: ${localPath ? `Uploaded workspace video (${durationSec ? `${durationSec}s` : "measured"})` : safePublicVideoUrl}
${crawled ? `Observed Page Snapshot:\nTitle: ${crawled.title}\nMeta: ${crawled.metaDescription}\nExcerpt: ${crawled.bodyExcerpt.slice(0, 1500)}` : ""}

Return ONLY valid JSON:
{
  "title": "string",
  "hookBreakdown": "string",
  "pacingSummary": "string",
  "visualCues": ["string"],
  "audioCues": ["string"],
  "timeline": [
    {
      "timestamp": "00:00–00:02",
      "visualAction": "string",
      "editingEffect": "string (e.g. Fast punch-in zoom + bold center captions)",
      "audioCue": "string",
      "transcriptOrText": "string",
      "confidence": "observed" | "estimated"
    }
  ],
  "repeatableTemplate": {
    "hookFormula": "string",
    "sceneStructure": ["string"],
    "captionStyle": "string",
    "musicAndAudioFormula": "string"
  }
}`;

    const contents = inlineVideoPart
      ? { parts: [inlineVideoPart, { text: textPrompt }] }
      : textPrompt;

    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/intelligence/video",
        agent: "Viral Video Pattern Analyzer",
        model: selectedModel,
        creditsEstimated: 75,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents,
          config: {
            systemInstruction:
              "You are a viral short-form creative director and video editor. If analyzing an uploaded video directly, mark timeline beats as 'observed'. If inferring from public URL metadata without direct frames, mark inferred beats honestly as 'estimated'.",
            ...(inlineVideoPart ? {} : { tools: [{ googleSearch: {} }] }),
            thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
            responseMimeType: "application/json",
          },
        }),
    );

    const parsed = parseJsonSafe<Record<string, unknown>>(response.text);
    const sources = extractGroundingSources(response);

    const saved = stateStore.addVideoBreakdown({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      title: String(parsed.title || title || assetRecord?.originalName || "Reference Breakdown"),
      sourceUrl: safePublicVideoUrl || undefined,
      mediaAssetId: assetRecord?.id,
      platform,
      creatorHandle: creatorHandle || undefined,
      durationSec,
      hookBreakdown: String(parsed.hookBreakdown || ""),
      pacingSummary: String(parsed.pacingSummary || ""),
      visualCues: Array.isArray(parsed.visualCues) ? parsed.visualCues.map(String) : [],
      audioCues: Array.isArray(parsed.audioCues) ? parsed.audioCues.map(String) : [],
      timeline: Array.isArray(parsed.timeline) ? (parsed.timeline as never) : [],
      repeatableTemplate: (parsed.repeatableTemplate as never) || {
        hookFormula: "",
        sceneStructure: [],
        captionStyle: "",
        musicAndAudioFormula: "",
      },
    });

    res.json({
      breakdown: saved,
      metadata: videoMetadata,
      directMultimodalUsed: Boolean(inlineVideoPart),
      sources,
      model: selectedModel,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

router.get("/intelligence/video-breakdowns", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({
    breakdowns: stateStore.listVideoBreakdowns(ctx.workspaceId),
  });
});

router.post("/intelligence/creator-report", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const { creatorName, channelData, breakdownIds = [], business, model } = req.body as {
      creatorName?: string;
      channelData?: Record<string, unknown>;
      breakdownIds?: string[];
      business?: Record<string, unknown>;
      model?: string;
    };

    const stored = stateStore
      .listVideoBreakdowns(ctx.workspaceId)
      .filter((b) => breakdownIds.length === 0 || breakdownIds.includes(b.id))
      .slice(0, 6);

    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);

    const prompt = `Synthesize a Repeatable Creator Method Playbook for this brand based on the analyzed creator channel and video breakdowns.
${buildBusinessContextPrompt(business)}
Creator Focus: ${creatorName || "Analyzed Creator Patterns"}
Channel Insights: ${JSON.stringify(channelData || {}).slice(0, 2500)}
Saved Video Breakdowns (${stored.length}): ${JSON.stringify(stored).slice(0, 3500)}

Return ONLY valid JSON:
{
  "reportTitle": "string",
  "coreThesis": "string",
  "repeatableHooks": ["string"],
  "structuralFormula": ["string"],
  "visualAndEditingChecklist": ["string"],
  "brandAdaptationAngles": ["string"],
  "recommendedNext3Scripts": [
    { "title": "string", "hook": "string", "format": "string" }
  ]
}`;

    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/intelligence/creator-report",
        agent: "Creator Method Synthesizer",
        model: selectedModel,
        creditsEstimated: 55,
      },
      () =>
        ai.models.generateContent({
          model: selectedModel,
          contents: prompt,
          config: {
            systemInstruction:
              "You are a growth & content systems director converting creator observations into repeatable video playbooks.",
            thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
            responseMimeType: "application/json",
          },
        }),
    );

    const report = parseJsonSafe<Record<string, unknown>>(response.text);
    res.json({
      model: selectedModel,
      breakdownsAnalyzed: stored.length,
      report,
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

export default router;
