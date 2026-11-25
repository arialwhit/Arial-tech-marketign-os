import "./server/loadEnv.js";
import http from "http";
import path from "path";
import fs from "fs";
import express, { type NextFunction, type Request, type Response } from "express";
import { apiRateLimiter, attachFirebaseUser } from "./server/middleware/auth.js";
import intelligenceRouter from "./server/routes/intelligence.js";
import aiStudioRouter from "./server/routes/aiStudio.js";
import videoEditorRouter from "./server/routes/videoEditor.js";
import integrationsRouter from "./server/routes/integrations.js";
import composioRouter from "./server/routes/composio.js";
import pipelineRouter from "./server/routes/pipeline.js";
import growthAnalyticsRouter from "./server/routes/growthAnalytics.js";
import operationsRouter, { startBackgroundScheduler } from "./server/routes/operations.js";
import { attachLiveVoiceBridge } from "./server/live/liveBridge.js";
import {
  getUploadsRootDir,
  hasFfmpegBinary,
  hasFfprobeBinary,
  isVercelRuntime,
  resolvePublicBaseUrl,
} from "./server/utils/paths.js";

function isAllowedCorsOrigin(origin: string, req: Request): boolean {
  try {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;

    if (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]"
    ) {
      return true;
    }

    const expectedBase = resolvePublicBaseUrl(req);
    if (expectedBase && origin === new URL(expectedBase).origin) {
      return true;
    }

    const allowedHosts = [
      process.env.APP_URL?.trim(),
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : "",
      process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
        : "",
      process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL.trim()}` : "",
    ]
      .filter((v): v is string => Boolean(v && v !== "MY_APP_URL" && /^https?:\/\//i.test(v)))
      .map((v) => new URL(v).origin);

    return allowedHosts.includes(origin);
  } catch {
    return false;
  }
}

function renderOAuthCallbackHtml(req: Request): string {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const error = typeof req.query.error === "string" ? req.query.error : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const payload = JSON.stringify({ type: "MOS_OAUTH_CALLBACK", code, state, error, status });

  return `<!doctype html>
<html>
  <head><title>Authorization Complete</title></head>
  <body style="font-family:sans-serif;background:#0b0d0e;color:#f3f6f4;display:grid;place-items:center;height:100vh;margin:0">
    <div style="text-align:center;padding:24px;border:1px solid #252b2c;border-radius:12px;background:#111415">
      <h2 style="margin:0 0 8px">${error ? "Authorization Cancelled" : "Connected to Marketing OS"}</h2>
      <p style="color:#8c9894;margin:0 0 16px">${error ? "You can close this window and retry." : "Connection verified. Returning to Marketing OS…"}</p>
      <script>
        try {
          if (window.opener) {
            window.opener.postMessage(${payload}, window.location.origin);
          }
        } catch (e) {}
        setTimeout(function() { window.close(); }, 600);
      </script>
    </div>
  </body>
</html>`;
}

export async function createMarketingOsApp(httpServer?: http.Server) {
  const app = express();
  const isProd = process.env.NODE_ENV === "production";
  const isVercel = isVercelRuntime();

  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";
    if (origin) {
      res.setHeader("Vary", "Origin");
      if (isAllowedCorsOrigin(origin, req)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, x-workspace-id");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      } else if (req.method === "OPTIONS") {
        res.status(403).json({ error: "Origin not permitted by CORS policy." });
        return;
      }
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: "35mb" }));
  app.use(express.urlencoded({ extended: true, limit: "35mb" }));

  const uploadsDir = getUploadsRootDir();
  app.use("/uploads", express.static(uploadsDir));

  app.get("/api/health", (_req, res) => {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const ffmpegAvailable = hasFfmpegBinary();
    const ffprobeAvailable = hasFfprobeBinary();
    res.json({
      ok: true,
      service: "Marketing OS",
      runtime: isVercel ? "vercel-serverless" : "node-server",
      capabilities: {
        vercel: isVercel,
        persistentScheduler: !isVercel,
        nativeWebSocketLiveVoice: !isVercel,
        ffmpegAvailable,
        ffprobeAvailable,
        geminiConfigured: Boolean(geminiKey && geminiKey !== "MY_GEMINI_API_KEY"),
        composioConfigured: Boolean(process.env.COMPOSIO_API_KEY?.trim()),
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/api", attachFirebaseUser);
  app.use("/api", apiRateLimiter());
  app.use("/api", intelligenceRouter);
  app.use("/api", aiStudioRouter);
  app.use("/api", videoEditorRouter);
  app.use("/api", integrationsRouter);
  app.use("/api", composioRouter);
  app.use("/api", pipelineRouter);
  app.use("/api", growthAnalyticsRouter);
  app.use("/api", operationsRouter);

  app.get(["/auth/callback", "/auth/callback/"], (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderOAuthCallbackHtml(req));
  });

  if (!isProd && !isVercel && process.env.VITEST !== "true") {
    let viteMiddleware: ((req: Request, res: Response, next: NextFunction) => void) | null = null;
    const viteReady = (async () => {
      const vitePkg = "vite";
      const { createServer: createViteServer } = await import(/* @vite-ignore */ vitePkg);
      const disableHmr = process.env.DISABLE_HMR === "true";
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          allowedHosts: true,
          ...(disableHmr ? { hmr: false } : {}),
          ...(httpServer ? { ws: { server: httpServer } } : {}),
        },
        appType: "spa",
      });
      viteMiddleware = vite.middlewares;
    })();
    viteReady.catch((err) => {
      console.error("Failed to initialize Vite dev middleware:", err);
    });
    app.use(async (req, res, next) => {
      try {
        if (!viteMiddleware) await viteReady;
        if (viteMiddleware) {
          viteMiddleware(req, res, next);
          return;
        }
        next();
      } catch (err) {
        next(err);
      }
    });
  } else if (isProd && !isVercel) {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  // Safe error handler stripping internal stack traces from client responses
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    const status = (err as { status?: number })?.status;
    res.status(status && status >= 400 && status < 600 ? status : 500).json({
      error: message,
    });
  });

  return app;
}

function parseServerCliArgs(argv: string[]): { port?: number; host?: string } {
  let port: number | undefined;
  let host: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "--port" || arg === "-p") && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) port = parsed;
      i += 1;
    } else if (arg.startsWith("--port=")) {
      const parsed = Number(arg.slice("--port=".length));
      if (Number.isFinite(parsed) && parsed > 0) port = parsed;
    } else if ((arg === "--host" || arg === "-H") && argv[i + 1]) {
      host = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
    }
  }
  return { port, host };
}

function resolveListenTarget(): { port: number; host: string } {
  const cli = parseServerCliArgs(process.argv.slice(2));
  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  const defaultAppPort = Number(process.env.DEFAULT_APP_PORT) || 3000;

  // Prefer explicit CLI --port; avoid colliding with reverse-proxy NGINX_PORT when PORT is inherited from container env
  const port =
    cli.port ??
    (Number.isFinite(envPort) && envPort > 0 && envPort !== nginxPort ? envPort : defaultAppPort);
  const host = cli.host || process.env.HOST || "0.0.0.0";
  return { port, host };
}

async function startServer() {
  const { port, host } = resolveListenTarget();
  const server = http.createServer();
  const app = await createMarketingOsApp(server);
  server.on("request", app);
  attachLiveVoiceBridge(server);
  startBackgroundScheduler();

  server.on("error", (err) => {
    console.error(`Marketing OS server failed on ${host}:${port}:`, err);
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`Marketing OS server listening on http://${host}:${port}`);
  });
}

if (process.env.VITEST !== "true" && !isVercelRuntime()) {
  startServer().catch((err) => {
    console.error("Failed to start Marketing OS server:", err);
    process.exit(1);
  });
}
