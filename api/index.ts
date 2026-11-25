import type { IncomingMessage, ServerResponse } from "http";
import { createMarketingOsApp } from "../server.js";

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

let appPromise: Promise<RequestHandler> | null = null;

async function resolveAppHandler(): Promise<RequestHandler> {
  const app = await createMarketingOsApp();
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
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error:
                dispatchErr instanceof Error
                  ? dispatchErr.message
                  : "Unexpected API handler error",
            }),
          );
        }
        done();
      }
    });
  } catch (err) {
    console.error("Vercel API bootstrap error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error:
            err instanceof Error
              ? `Server initialization failed: ${err.message}`
              : "Server initialization failed.",
        }),
      );
    }
  }
}
