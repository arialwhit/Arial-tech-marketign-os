#!/usr/bin/env node
/**
 * Marketing OS — Automatic Vercel Environment Sync & Deploy Script
 *
 * Reads API keys and runtime config exclusively from `.env.local`, `.env`,
 * and `process.env` at runtime (never stores literal secrets in git), then
 * upserts configured variables to Vercel (`production`, `preview`, `development`)
 * via Vercel REST API (`VERCEL_TOKEN`) or linked Vercel CLI (`npx vercel`).
 *
 * Usage:
 *   npm run vercel:env                 # Sync configured env vars to Vercel
 *   npm run vercel:deploy              # Sync env vars, then deploy to Vercel production
 *   node scripts/vercel-env-sync.mjs --dry-run
 *   node scripts/vercel-env-sync.mjs --deploy --targets=production,preview
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";

export const KNOWN_SERVER_ENV_KEYS = [
  "GEMINI_API_KEY",
  "APP_URL",
  "MOS_CREDENTIAL_SECRET",
  "COMPOSIO_API_KEY",
  "COMPOSIO_MCP_URL",
  "META_APP_ID",
  "META_APP_SECRET",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "STRIPE_SECRET_KEY",
  "PAYSTACK_SECRET_KEY",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_DATABASE_ID",
  "CRON_SECRET",
];

const PLACEHOLDER_VALUES = new Set([
  "",
  "MY_GEMINI_API_KEY",
  "MY_APP_URL",
  "your-api-key",
  "changeme",
]);

export function parseDotEnv(content) {
  const out = {};
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eqIdx = withoutExport.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = withoutExport.slice(0, eqIdx).trim();
    let val = withoutExport.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

export function isPlaceholderOrEmpty(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_VALUES.has(trimmed)) return true;
  if (/^(MY_|YOUR_|REPLACE_|<.+>)/i.test(trimmed)) return true;
  return false;
}

export function maskSecretSummary(value) {
  const len = String(value || "").length;
  return `[configured, ${len} chars]`;
}

export function loadMergedEnv(cwd = process.cwd(), baseEnv = process.env) {
  const merged = {};
  for (const fileName of [".env", ".env.local"]) {
    const fullPath = path.resolve(cwd, fileName);
    if (fs.existsSync(fullPath)) {
      const parsed = parseDotEnv(fs.readFileSync(fullPath, "utf8"));
      Object.assign(merged, parsed);
    }
  }
  // Explicit runtime env overrides `.env` files
  for (const [k, v] of Object.entries(baseEnv)) {
    if (typeof v === "string" && v.length > 0) {
      merged[k] = v;
    }
  }
  return merged;
}

export function collectSyncEntries(mergedEnv) {
  const keys = new Set(KNOWN_SERVER_ENV_KEYS);
  for (const k of Object.keys(mergedEnv)) {
    if (k.startsWith("VITE_")) keys.add(k);
  }

  const configured = [];
  const missing = [];

  for (const key of keys) {
    const raw = mergedEnv[key];
    if (!isPlaceholderOrEmpty(raw)) {
      configured.push({
        key,
        value: String(raw).trim(),
        type: key.startsWith("VITE_") ? "plain" : "encrypted",
      });
    } else if (KNOWN_SERVER_ENV_KEYS.includes(key)) {
      missing.push(key);
    }
  }

  return { configured, missing };
}

function resolveVercelProjectLink(cwd, mergedEnv) {
  let projectId = (mergedEnv.VERCEL_PROJECT_ID || "").trim();
  let orgId = (mergedEnv.VERCEL_ORG_ID || "").trim();
  const projectJsonPath = path.resolve(cwd, ".vercel/project.json");
  if ((!projectId || !orgId) && fs.existsSync(projectJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(projectJsonPath, "utf8"));
      if (!projectId && typeof parsed.projectId === "string") projectId = parsed.projectId;
      if (!orgId && typeof parsed.orgId === "string") orgId = parsed.orgId;
    } catch {
      // ignore malformed .vercel/project.json
    }
  }
  return { projectId, orgId };
}

async function upsertViaVercelApi({ entries, targets, token, projectId, orgId }) {
  const teamQuery = orgId ? `&teamId=${encodeURIComponent(orgId)}` : "";
  const url = `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true${teamQuery}`;

  const payload = entries.map((entry) => ({
    key: entry.key,
    value: entry.value,
    type: entry.type,
    target: targets,
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Vercel Env API HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }
}

function upsertViaVercelCli({ entries, targets, cwd }) {
  for (const entry of entries) {
    for (const target of targets) {
      const res = spawnSync(
        "npx",
        ["--yes", "vercel", "env", "add", entry.key, target, "--force"],
        {
          cwd,
          input: entry.value,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      if (res.status !== 0) {
        const stderr = (res.stderr || res.stdout || "").trim();
        throw new Error(
          `Failed syncing ${entry.key} (${target}) via Vercel CLI. Run 'npx vercel login && npx vercel link' or set VERCEL_TOKEN + VERCEL_PROJECT_ID.\n${stderr}`,
        );
      }
    }
  }
}

function runVercelDeploy({ cwd, token }) {
  const args = ["--yes", "vercel", "deploy", "--prod", "--yes"];
  if (token) {
    args.push("--token", token);
  }
  const res = spawnSync("npx", args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`Vercel deployment exited with code ${res.status ?? 1}`);
  }
}

export async function runCli(argv = process.argv.slice(2), cwd = process.cwd()) {
  const dryRun = argv.includes("--dry-run");
  const shouldDeploy = argv.includes("--deploy");
  const strict = argv.includes("--strict");

  const targetsArg = argv.find((a) => a.startsWith("--targets="));
  const targets = targetsArg
    ? targetsArg
        .slice("--targets=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : ["production", "preview", "development"];

  const mergedEnv = loadMergedEnv(cwd, process.env);
  const { configured, missing } = collectSyncEntries(mergedEnv);

  console.log("Marketing OS -> Vercel Environment Sync");
  console.log(`Targets: ${targets.join(", ")}`);
  console.log(`Configured keys (${configured.length}):`);
  for (const item of configured) {
    console.log(`  ✓ ${item.key} (${item.type}) ${maskSecretSummary(item.value)}`);
  }
  if (missing.length > 0) {
    console.log(`Unset optional/skipped keys (${missing.length}): ${missing.join(", ")}`);
  }

  const hasGemini = configured.some((e) => e.key === "GEMINI_API_KEY");
  if (!hasGemini) {
    const warning =
      "Warning: GEMINI_API_KEY is not set in .env / process.env. Add GEMINI_API_KEY to enable live AI onboarding and studios on Vercel.";
    if (strict) {
      throw new Error(warning);
    }
    console.warn(warning);
  }

  if (dryRun) {
    console.log("Dry run complete — no changes sent to Vercel.");
    return { synced: 0, dryRun: true };
  }

  if (configured.length === 0) {
    console.log("No non-placeholder environment variables found to sync.");
    if (shouldDeploy) {
      runVercelDeploy({ cwd, token: (mergedEnv.VERCEL_TOKEN || "").trim() });
    }
    return { synced: 0, dryRun: false };
  }

  const token = (mergedEnv.VERCEL_TOKEN || "").trim();
  const { projectId, orgId } = resolveVercelProjectLink(cwd, mergedEnv);

  if (token && projectId) {
    console.log(`Syncing ${configured.length} env var(s) to Vercel project ${projectId} via REST API…`);
    await upsertViaVercelApi({ entries: configured, targets, token, projectId, orgId });
    console.log("✓ Vercel environment variables synced via API.");
  } else {
    console.log(`Syncing ${configured.length} env var(s) via linked Vercel CLI…`);
    upsertViaVercelCli({ entries: configured, targets, cwd });
    console.log("✓ Vercel environment variables synced via CLI.");
  }

  if (shouldDeploy) {
    console.log("Triggering Vercel production deployment…");
    runVercelDeploy({ cwd, token });
  }

  return { synced: configured.length, dryRun: false };
}

const isDirectEntry =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectEntry) {
  runCli().catch((err) => {
    console.error("Vercel sync error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
