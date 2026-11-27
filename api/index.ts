import type { IncomingMessage, ServerResponse } from "http";
import "./ensure-runtime-deps.js";

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

let appPromise: Promise<RequestHandler> | null = null;

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection in Marketing OS function:", err);
});

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function resolveAppHandler(): Promise<RequestHandler> {
  const loaded = await import("../server.js");
  const app = await loaded.createMarketingOsApp();
  return app as unknown as RequestHandler;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (!appPromise) {
      appPromise = resolveAppHandler().catch((err) => {
        appPromise = null;
        throw err;
      });
    }
    const app = await appPromise;

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      res.once("finish", done);
      res.once("close", done);
      try {
        app(req, res);
      } catch (dispatchErr) {
        sendJson(res, 500, {
          error:
            dispatchErr instanceof Error
              ? dispatchErr.message
              : "Unexpected API handler error",
        });
        done();
      }
    });
  } catch (err) {
    console.error("Vercel API bootstrap error:", err);
    sendJson(res, 500, {
      error:
        err instanceof Error
          ? `Server initialization failed: ${err.message}`
          : "Server initialization failed.",
    });
  }
}
