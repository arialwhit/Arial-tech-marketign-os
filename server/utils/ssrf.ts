import dns from "dns/promises";
import net from "net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
]);

export function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^::ffff:/, "");
  if (!net.isIP(normalized)) return false;

  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 192 && b === 0 && parts[2] === 2) return true;
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  // IPv6 checks
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe80:") || normalized.startsWith("fec0:")) return true; // link-local / site-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local address
  if (normalized.startsWith("ff")) return true; // multicast
  return false;
}

export async function normalizeAndAssertPublicUrl(raw: string): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Website URL is required.");
  if (trimmed.length > 500) throw new Error("URL exceeds maximum allowed length (500 chars).");

  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProto);
  } catch {
    throw new Error("Invalid URL format.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs containing embedded credentials are not allowed.");
  }

  const host = parsed.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("Private or internal network hostnames cannot be crawled.");
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw new Error("Private or loopback IP addresses cannot be crawled.");
    }
    return parsed.toString();
  }

  // Resolve DNS records and reject any internal/private resolution
  try {
    const records = await dns.lookup(host, { all: true });
    if (!records.length) {
      throw new Error(`Could not resolve DNS for ${host}.`);
    }
    for (const rec of records) {
      if (isPrivateIp(rec.address)) {
        throw new Error("Resolved IP belongs to a private or internal network and cannot be crawled.");
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("private")) throw err;
    // Allow DNS lookup soft-fail only if explicit DNS outage? No — reject unreachable hosts cleanly.
    throw new Error(`Unable to resolve public hostname "${host}".`);
  }

  return parsed.toString();
}

export async function safePublicFetch(
  targetUrl: string,
  options: { timeoutMs?: number; method?: "GET" | "HEAD"; headers?: Record<string, string> } = {},
): Promise<{ response: Response; finalUrl: string; ttfbMs: number }> {
  let currentUrl = await normalizeAndAssertPublicUrl(targetUrl);
  const timeoutMs = options.timeoutMs ?? 12000;
  const maxRedirects = 4;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(currentUrl, {
        method: options.method || "GET",
        signal: controller.signal,
        redirect: "manual",
        headers: options.headers,
      });
      const ttfbMs = Date.now() - started;

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          throw new Error(`Redirect response (${res.status}) missing Location header.`);
        }
        const resolvedNext = new URL(location, currentUrl).toString();
        currentUrl = await normalizeAndAssertPublicUrl(resolvedNext);
        continue;
      }

      return { response: res, finalUrl: currentUrl, ttfbMs };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Too many HTTP redirects while fetching URL.");
}
