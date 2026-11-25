import { stateStore } from "./stateStore.js";

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  return (
    status === 429 ||
    status === 503 ||
    status === 502 ||
    msg.includes("503") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT")
  );
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  baseDelayMs = 600,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries && isTransientError(err)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function runTrackedAiCall<T>(
  meta: {
    workspaceId?: string;
    actorUid?: string;
    endpoint: string;
    agent: string;
    provider?: string;
    model: string;
    creditsEstimated?: number;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const workspaceId = meta.workspaceId || "default";
  const actorUid = meta.actorUid || "anonymous";
  try {
    const result = await withRetry(fn, 1, 500);
    stateStore.addAiRun({
      workspaceId,
      actorUid,
      endpoint: meta.endpoint,
      agent: meta.agent,
      provider: meta.provider || "google-genai",
      model: meta.model,
      status: "completed",
      latencyMs: Date.now() - started,
      creditsEstimated: meta.creditsEstimated ?? 0,
    });
    return result;
  } catch (err) {
    stateStore.addAiRun({
      workspaceId,
      actorUid,
      endpoint: meta.endpoint,
      agent: meta.agent,
      provider: meta.provider || "google-genai",
      model: meta.model,
      status: "failed",
      latencyMs: Date.now() - started,
      creditsEstimated: 0,
      error: err instanceof Error ? err.message.slice(0, 260) : String(err).slice(0, 260),
    });
    throw err;
  }
}
