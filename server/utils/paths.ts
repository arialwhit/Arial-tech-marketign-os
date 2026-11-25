import fs from "fs";
import os from "os";
import path from "path";

export function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

function writableBaseDir(): string {
  if (isVercelRuntime()) {
    return path.join(os.tmpdir(), "marketing-os");
  }
  return process.cwd();
}

export function getDataDir(): string {
  const dir = path.resolve(writableBaseDir(), ".data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getUploadsRootDir(): string {
  const dir = path.resolve(writableBaseDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getMediaDir(): string {
  const dir = path.join(getUploadsRootDir(), "media");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getRendersDir(): string {
  const dir = path.join(getUploadsRootDir(), "renders");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getGeneratedDir(): string {
  const dir = path.join(getUploadsRootDir(), "generated");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getTempDir(): string {
  const dir = path.join(getUploadsRootDir(), "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveSafeUploadCandidate(assetUrl: string): string | null {
  if (!assetUrl) return null;
  const cleanRel = assetUrl.split("?")[0].replace(/^\/+/, "");
  const writableRoot = writableBaseDir();
  const cwd = process.cwd();
  const roots = [
    { base: getUploadsRootDir(), rel: cleanRel.startsWith("uploads/") ? cleanRel.slice("uploads/".length) : cleanRel },
    { base: path.resolve(cwd, "public"), rel: cleanRel },
    { base: path.resolve(cwd, "dist"), rel: cleanRel },
    { base: path.resolve(cwd, "uploads"), rel: cleanRel.startsWith("uploads/") ? cleanRel.slice("uploads/".length) : cleanRel },
  ];

  for (const { base, rel } of roots) {
    if (!rel) continue;
    const candidate = path.resolve(base, rel);
    if (
      (candidate.startsWith(base + path.sep) ||
        candidate.startsWith(writableRoot + path.sep) ||
        candidate.startsWith(cwd + path.sep)) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      return candidate;
    }
  }
  return null;
}

export function resolveFfmpegBin(): string {
  const candidates = [process.env.FFMPEG_PATH, "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"].filter(
    Boolean,
  ) as string[];
  for (const c of candidates) {
    if (c === "ffmpeg" || fs.existsSync(c)) return c;
  }
  return "ffmpeg";
}

export function resolveFfprobeBin(): string {
  const candidates = [process.env.FFPROBE_PATH, "/usr/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"].filter(
    Boolean,
  ) as string[];
  for (const c of candidates) {
    if (c === "ffprobe" || fs.existsSync(c)) return c;
  }
  return "ffprobe";
}

function isExecutableBinaryAvailable(bin: string): boolean {
  if (!bin) return false;
  if (bin.includes("/") || bin.includes("\\")) {
    try {
      return fs.existsSync(bin) && fs.statSync(bin).isFile();
    } catch {
      return false;
    }
  }
  const pathEnv = process.env.PATH || "";
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    const full = path.join(dir, bin);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return true;
      if (process.platform === "win32" && fs.existsSync(`${full}.exe`)) return true;
    } catch {
      // ignore permission errors on unrelated PATH dirs
    }
  }
  return false;
}

export function hasFfmpegBinary(): boolean {
  return isExecutableBinaryAvailable(resolveFfmpegBin());
}

export function hasFfprobeBinary(): boolean {
  return isExecutableBinaryAvailable(resolveFfprobeBin());
}

export interface RequestUrlLike {
  protocol?: string;
  headers?: Record<string, string | string[] | undefined>;
  get?: (name: string) => string | undefined;
}

function firstHeaderVal(val: string | string[] | undefined): string {
  const raw = Array.isArray(val) ? val[0] : val;
  return String(raw || "").split(",")[0].trim();
}

export function resolvePublicBaseUrl(req?: RequestUrlLike): string {
  const explicitAppUrl = process.env.APP_URL?.trim();
  if (explicitAppUrl && explicitAppUrl !== "MY_APP_URL" && /^https?:\/\//i.test(explicitAppUrl)) {
    return explicitAppUrl.replace(/\/$/, "");
  }

  const forwardedHost = firstHeaderVal(req?.headers?.["x-forwarded-host"]);
  const forwardedProto = firstHeaderVal(req?.headers?.["x-forwarded-proto"]) || "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");
  }

  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prodHost) {
    return `https://${prodHost.replace(/^https?:\/\//i, "").replace(/\/$/, "")}`;
  }

  const vercelHost = process.env.VERCEL_URL?.trim();
  if (vercelHost) {
    return `https://${vercelHost.replace(/^https?:\/\//i, "").replace(/\/$/, "")}`;
  }

  const reqHost = req?.get?.("host")?.trim();
  if (reqHost) {
    const proto = req?.protocol || "http";
    return `${proto}://${reqHost}`.replace(/\/$/, "");
  }

  return "http://localhost:3000";
}

