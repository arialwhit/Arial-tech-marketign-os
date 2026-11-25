import type { NextFunction, Request, Response } from "express";
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { stateStore } from "../services/stateStore.js";
import { getFirebaseServerConfig, isPlaceholderFirebaseProject } from "../utils/firebaseConfig.js";

export interface AuthenticatedRequest extends Request {
  user?: DecodedIdToken;
  workspaceId?: string;
}

const firebaseConfig = getFirebaseServerConfig();
const isPlaceholderProject = isPlaceholderFirebaseProject();

if (!isPlaceholderProject) {
  try {
    if (!getApps().length) {
      initializeApp({
        projectId: firebaseConfig.projectId,
      });
    }
  } catch (err) {
    console.warn("Firebase Admin initialization skipped:", err instanceof Error ? err.message : err);
  }
}

export async function attachFirebaseUser(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const rawWs = req.headers["x-workspace-id"];
  if (typeof rawWs === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(rawWs)) {
    req.workspaceId = rawWs;
  }

  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ") && !isPlaceholderProject) {
    const token = header.slice("Bearer ".length).trim();
    if (token) {
      try {
        const app = getApp();
        const decoded = await getAuth(app).verifyIdToken(token);
        req.user = decoded;
      } catch {
        // Leave req.user undefined if token is expired or invalid
      }
    }
  }
  next();
}

export function extractWorkspaceContext(req: Request): {
  workspaceId: string;
  actorUid: string;
} {
  const areq = req as AuthenticatedRequest;
  const rawWs =
    (typeof req.headers["x-workspace-id"] === "string" ? req.headers["x-workspace-id"] : "") ||
    (typeof req.query.workspaceId === "string" ? req.query.workspaceId : "") ||
    (typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "") ||
    "default";
  const workspaceId = rawWs.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128) || "default";
  const actorUid = areq.user?.uid || "anonymous";
  return { workspaceId, actorUid };
}

/**
 * Enforces workspace isolation across authenticated users.
 * - If workspaceId is "default" or user is in guest/anonymous local preview mode without an owner claim,
 *   requests proceed using the workspace namespace.
 * - Once a non-default workspace is claimed by an authenticated UID, only that UID may access or mutate it.
 */
export function assertWorkspaceAccess(
  req: Request,
  res: Response,
): { workspaceId: string; actorUid: string } | null {
  const { workspaceId, actorUid } = extractWorkspaceContext(req);
  if (workspaceId !== "default" && actorUid !== "anonymous") {
    const allowed = stateStore.claimOrVerifyWorkspaceOwner(workspaceId, actorUid);
    if (!allowed) {
      res.status(403).json({
        error: "Access denied: this workspace belongs to another authenticated account.",
      });
      return null;
    }
  } else if (workspaceId !== "default" && actorUid === "anonymous") {
    const existingOwner = stateStore.getWorkspaceOwner(workspaceId);
    if (existingOwner) {
      res.status(401).json({
        error: "Authentication required to access this workspace.",
      });
      return null;
    }
  }
  return { workspaceId, actorUid };
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function apiRateLimiter(windowMs = 60_000, maxRequests = 240) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "local";
    const key = `${ip}:${req.user?.uid || "anon"}`;
    const now = Date.now();
    const existing = rateBuckets.get(key);
    if (!existing || existing.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (existing.count >= maxRequests) {
      res.status(429).json({
        error: "Rate limit exceeded. Please wait a moment before sending more requests.",
      });
      return;
    }
    existing.count += 1;
    next();
  };
}
