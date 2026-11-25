import * as cheerio from "cheerio";
import { normalizeAndAssertPublicUrl, safePublicFetch } from "./ssrf.js";

/** Reads a public page's og:image or twitter:image. Returns nothing if the page has no real image. */
export async function fetchOpenGraphImage(pageUrl: string): Promise<string | null> {
  const page = String(pageUrl || "").trim();
  if (!/^https?:\/\//i.test(page)) return null;
  try {
    const { response } = await safePublicFetch(page, {
      timeoutMs: 8000,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "MarketingOS/1.0 (public page preview)",
      },
    });
    if (!response.ok) return null;
    const html = (await response.text()).slice(0, 250000);
    const $ = cheerio.load(html);
    const raw =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $('meta[property="og:image:url"]').attr("content") ||
      "";
    if (!raw.trim()) return null;
    const absolute = new URL(raw.trim(), page).toString();
    return await normalizeAndAssertPublicUrl(absolute);
  } catch {
    return null;
  }
}
