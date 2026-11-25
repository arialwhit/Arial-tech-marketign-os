// server.ts
import "dotenv/config";
import http from "http";
import path8 from "path";
import express from "express";

// server/middleware/auth.ts
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// server/services/stateStore.ts
import fs2 from "fs";
import path2 from "path";
import crypto from "crypto";

// server/utils/paths.ts
import fs from "fs";
import os from "os";
import path from "path";
function isVercelRuntime() {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}
function writableBaseDir() {
  if (isVercelRuntime()) {
    return path.join(os.tmpdir(), "marketing-os");
  }
  return process.cwd();
}
function getDataDir() {
  const dir = path.resolve(writableBaseDir(), ".data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function getUploadsRootDir() {
  const dir = path.resolve(writableBaseDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function getMediaDir() {
  const dir = path.join(getUploadsRootDir(), "media");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function getRendersDir() {
  const dir = path.join(getUploadsRootDir(), "renders");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function getGeneratedDir() {
  const dir = path.join(getUploadsRootDir(), "generated");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function getTempDir() {
  const dir = path.join(getUploadsRootDir(), "tmp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function resolveSafeUploadCandidate(assetUrl) {
  if (!assetUrl) return null;
  const cleanRel = assetUrl.split("?")[0].replace(/^\/+/, "");
  const writableRoot = writableBaseDir();
  const cwd = process.cwd();
  const roots = [
    { base: getUploadsRootDir(), rel: cleanRel.startsWith("uploads/") ? cleanRel.slice("uploads/".length) : cleanRel },
    { base: path.resolve(cwd, "public"), rel: cleanRel },
    { base: path.resolve(cwd, "dist"), rel: cleanRel },
    { base: path.resolve(cwd, "uploads"), rel: cleanRel.startsWith("uploads/") ? cleanRel.slice("uploads/".length) : cleanRel }
  ];
  for (const { base, rel } of roots) {
    if (!rel) continue;
    const candidate = path.resolve(base, rel);
    if ((candidate.startsWith(base + path.sep) || candidate.startsWith(writableRoot + path.sep) || candidate.startsWith(cwd + path.sep)) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}
function resolveFfmpegBin() {
  const candidates = [process.env.FFMPEG_PATH, "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"].filter(
    Boolean
  );
  for (const c of candidates) {
    if (c === "ffmpeg" || fs.existsSync(c)) return c;
  }
  return "ffmpeg";
}
function resolveFfprobeBin() {
  const candidates = [process.env.FFPROBE_PATH, "/usr/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"].filter(
    Boolean
  );
  for (const c of candidates) {
    if (c === "ffprobe" || fs.existsSync(c)) return c;
  }
  return "ffprobe";
}
function isExecutableBinaryAvailable(bin) {
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
    }
  }
  return false;
}
function hasFfmpegBinary() {
  return isExecutableBinaryAvailable(resolveFfmpegBin());
}
function hasFfprobeBinary() {
  return isExecutableBinaryAvailable(resolveFfprobeBin());
}
function firstHeaderVal(val) {
  const raw = Array.isArray(val) ? val[0] : val;
  return String(raw || "").split(",")[0].trim();
}
function resolvePublicBaseUrl(req) {
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

// server/services/stateStore.ts
function mapProjectStateToStage(state) {
  switch (state) {
    case "PLANNED":
      return "Research";
    case "SCRIPT_PENDING":
    case "SCRIPT_GENERATING":
    case "SCRIPT_READY":
    case "AWAITING_SCRIPT_APPROVAL":
    case "SCRIPT_APPROVED":
    case "STORYBOARD_READY":
    case "AWAITING_STORYBOARD_APPROVAL":
      return "Script";
    case "STORYBOARD_APPROVED":
    case "VIDEO_PENDING":
    case "VIDEO_GENERATING":
    case "VIDEO_READY":
    case "VIDEO_EDITING":
      return "Video editing";
    case "AWAITING_FINAL_APPROVAL":
      return "Awaiting approval";
    case "APPROVED_FOR_PUBLISHING":
    case "SCHEDULED":
    case "PUBLISHING":
    case "PUBLISHED":
    case "PUBLISH_FAILED":
    case "CANCELLED":
      return "Scheduled";
  }
}
function mapProjectStateToProgress(state) {
  const map = {
    PLANNED: 10,
    SCRIPT_PENDING: 18,
    SCRIPT_GENERATING: 24,
    SCRIPT_READY: 35,
    AWAITING_SCRIPT_APPROVAL: 40,
    SCRIPT_APPROVED: 45,
    STORYBOARD_READY: 48,
    AWAITING_STORYBOARD_APPROVAL: 51,
    STORYBOARD_APPROVED: 54,
    VIDEO_PENDING: 58,
    VIDEO_GENERATING: 65,
    VIDEO_READY: 72,
    VIDEO_EDITING: 78,
    AWAITING_FINAL_APPROVAL: 86,
    APPROVED_FOR_PUBLISHING: 92,
    SCHEDULED: 95,
    PUBLISHING: 97,
    PUBLISHED: 100,
    PUBLISH_FAILED: 90,
    CANCELLED: 0
  };
  return map[state] ?? 10;
}
var DATA_DIR = getDataDir();
var STATE_FILE = path2.join(DATA_DIR, "marketing-os-state.json");
function defaultState() {
  return {
    workspaceOwners: {},
    workspaceSnapshots: {},
    strategies: [],
    calendarEntries: [],
    contentProjects: [],
    presenters: [],
    workflows: [],
    workflowExecutions: [],
    backgroundJobs: [],
    aiMemories: [],
    mediaLibrary: [],
    seoAuditReports: [],
    videoBreakdowns: [],
    aiRuns: [],
    integrationLogs: [],
    notifications: [],
    scheduledJobs: [],
    videoJobs: [],
    auditLogs: [],
    billingRecords: [],
    analyticsConnections: [],
    growthSnapshots: [],
    growthReports: [],
    integrationRecommendationsByWs: {},
    idempotencyCache: {}
  };
}
var ServerStateStore = class {
  constructor() {
    try {
      fs2.mkdirSync(DATA_DIR, { recursive: true });
    } catch (err) {
      console.warn("State dir init warning:", err);
    }
    this.state = this.loadFromDisk();
  }
  loadFromDisk() {
    try {
      if (fs2.existsSync(STATE_FILE)) {
        const raw = fs2.readFileSync(STATE_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return { ...defaultState(), ...parsed };
      }
    } catch (err) {
      console.error("Failed to read server state file, starting fresh:", err);
    }
    return defaultState();
  }
  save() {
    try {
      fs2.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${STATE_FILE}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      fs2.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 384 });
      fs2.renameSync(tmp, STATE_FILE);
    } catch (err) {
      console.error("Failed to persist server state:", err);
    }
  }
  newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  }
  // Workspace ownership isolation
  getWorkspaceOwner(workspaceId) {
    return this.state.workspaceOwners[workspaceId] || null;
  }
  claimOrVerifyWorkspaceOwner(workspaceId, uid) {
    if (!workspaceId || workspaceId === "default" || !uid || uid === "anonymous") return true;
    const current = this.state.workspaceOwners[workspaceId];
    if (!current) {
      this.state.workspaceOwners[workspaceId] = uid;
      this.save();
      return true;
    }
    return current === uid;
  }
  // Workspace snapshots & continuity
  upsertWorkspaceSnapshot(workspaceId, ownerUid, patch) {
    const existing = this.state.workspaceSnapshots[workspaceId];
    const next = {
      ...existing || { workspaceId, ownerUid },
      ...patch,
      workspaceId,
      ownerUid: ownerUid !== "anonymous" ? ownerUid : existing?.ownerUid || "anonymous",
      savedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.state.workspaceSnapshots[workspaceId] = next;
    this.save();
    return next;
  }
  getWorkspaceSnapshot(workspaceId) {
    return this.state.workspaceSnapshots[workspaceId] || null;
  }
  listWorkspaceSnapshotsWithWebsite() {
    return Object.values(this.state.workspaceSnapshots).filter((s) => Boolean(s.websiteUrl?.trim()));
  }
  // Durable Background Jobs
  createBackgroundJob(entry) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const rec = {
      id: this.newId("bgjob"),
      createdAt: now,
      updatedAt: now,
      ...entry
    };
    this.state.backgroundJobs.unshift(rec);
    this.state.backgroundJobs = this.state.backgroundJobs.slice(0, 200);
    this.save();
    return rec;
  }
  getBackgroundJobById(id) {
    return this.state.backgroundJobs.find((j) => j.id === id) || null;
  }
  getBackgroundJobs(workspaceId) {
    return workspaceId ? this.state.backgroundJobs.filter((j) => j.workspaceId === workspaceId) : this.state.backgroundJobs;
  }
  updateBackgroundJob(id, patch) {
    const found = this.state.backgroundJobs.find((j) => j.id === id);
    if (!found) return null;
    Object.assign(found, patch, { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    this.save();
    return found;
  }
  // Structured Persistent AI Memory
  listMemories(workspaceId, scope) {
    return this.state.aiMemories.filter(
      (m) => m.workspaceId === workspaceId && (!scope || m.scope === scope)
    );
  }
  addMemory(entry) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const rec = {
      id: this.newId("mem"),
      createdAt: now,
      updatedAt: now,
      ...entry
    };
    this.state.aiMemories.unshift(rec);
    this.state.aiMemories = this.state.aiMemories.slice(0, 500);
    this.save();
    return rec;
  }
  updateMemory(id, workspaceId, patch) {
    const found = this.state.aiMemories.find((m) => m.id === id && m.workspaceId === workspaceId);
    if (!found) return null;
    Object.assign(found, patch, { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    this.save();
    return found;
  }
  deleteMemory(id, workspaceId) {
    const before = this.state.aiMemories.length;
    this.state.aiMemories = this.state.aiMemories.filter(
      (m) => !(m.id === id && m.workspaceId === workspaceId)
    );
    if (this.state.aiMemories.length !== before) {
      this.save();
      return true;
    }
    return false;
  }
  // Media Library Metadata Registry
  listMediaAssets(workspaceId) {
    return this.state.mediaLibrary.filter((m) => m.workspaceId === workspaceId);
  }
  getMediaAssetById(id, workspaceId) {
    return this.state.mediaLibrary.find(
      (m) => m.id === id && (!workspaceId || m.workspaceId === workspaceId)
    ) || null;
  }
  addMediaAsset(entry) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const rec = {
      id: this.newId("media"),
      createdAt: now,
      updatedAt: now,
      ...entry
    };
    this.state.mediaLibrary.unshift(rec);
    this.state.mediaLibrary = this.state.mediaLibrary.slice(0, 600);
    this.save();
    return rec;
  }
  updateMediaAsset(id, workspaceId, patch) {
    const found = this.state.mediaLibrary.find((m) => m.id === id && m.workspaceId === workspaceId);
    if (!found) return null;
    Object.assign(found, patch, { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    this.save();
    return found;
  }
  deleteMediaAsset(id, workspaceId) {
    const idx = this.state.mediaLibrary.findIndex((m) => m.id === id && m.workspaceId === workspaceId);
    if (idx === -1) return null;
    const [removed] = this.state.mediaLibrary.splice(idx, 1);
    this.save();
    return removed;
  }
  // Weekly Technical SEO Audit Reports
  addSeoAuditReport(entry) {
    const rec = {
      id: this.newId("seo"),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...entry
    };
    this.state.seoAuditReports.unshift(rec);
    this.state.seoAuditReports = this.state.seoAuditReports.slice(0, 120);
    this.save();
    return rec;
  }
  getSeoAuditReports(workspaceId) {
    return this.state.seoAuditReports.filter((r) => r.workspaceId === workspaceId);
  }
  // Video Breakdowns & Reference Intelligence
  addVideoBreakdown(entry) {
    const rec = {
      id: this.newId("vb"),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...entry
    };
    this.state.videoBreakdowns.unshift(rec);
    this.state.videoBreakdowns = this.state.videoBreakdowns.slice(0, 150);
    this.save();
    return rec;
  }
  listVideoBreakdowns(workspaceId) {
    return this.state.videoBreakdowns.filter((b) => b.workspaceId === workspaceId);
  }
  // Strategies CRUD
  listStrategies(workspaceId) {
    return this.state.strategies.filter((s) => s.workspaceId === workspaceId);
  }
  getStrategyById(id, workspaceId) {
    return this.state.strategies.find(
      (s) => s.id === id && (!workspaceId || s.workspaceId === workspaceId)
    ) || null;
  }
  upsertStrategy(record) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (record.id) {
      const idx = this.state.strategies.findIndex(
        (s) => s.id === record.id && s.workspaceId === record.workspaceId
      );
      if (idx !== -1) {
        const next = {
          ...this.state.strategies[idx],
          ...record,
          updatedAt: now
        };
        this.state.strategies[idx] = next;
        this.save();
        return next;
      }
    }
    const created = {
      ...record,
      id: record.id || this.newId("strat"),
      createdAt: now,
      updatedAt: now
    };
    this.state.strategies.unshift(created);
    this.state.strategies = this.state.strategies.slice(0, 120);
    this.save();
    return created;
  }
  deleteStrategy(id, workspaceId) {
    const before = this.state.strategies.length;
    this.state.strategies = this.state.strategies.filter(
      (s) => !(s.id === id && s.workspaceId === workspaceId)
    );
    if (this.state.strategies.length !== before) {
      this.save();
      return true;
    }
    return false;
  }
  // Content Calendar Entries CRUD
  listCalendarEntries(workspaceId) {
    return this.state.calendarEntries.filter((c) => c.workspaceId === workspaceId);
  }
  getCalendarEntryById(id, workspaceId) {
    return this.state.calendarEntries.find(
      (c) => c.id === id && (!workspaceId || c.workspaceId === workspaceId)
    ) || null;
  }
  upsertCalendarEntry(entry) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (entry.id) {
      const idx = this.state.calendarEntries.findIndex(
        (c) => c.id === entry.id && c.workspaceId === entry.workspaceId
      );
      if (idx !== -1) {
        const next = {
          ...this.state.calendarEntries[idx],
          ...entry,
          updatedAt: now
        };
        this.state.calendarEntries[idx] = next;
        this.save();
        return next;
      }
    }
    const created = {
      ...entry,
      id: entry.id || this.newId("cal"),
      createdAt: now,
      updatedAt: now
    };
    this.state.calendarEntries.unshift(created);
    this.state.calendarEntries = this.state.calendarEntries.slice(0, 300);
    this.save();
    return created;
  }
  deleteCalendarEntry(id, workspaceId) {
    const before = this.state.calendarEntries.length;
    this.state.calendarEntries = this.state.calendarEntries.filter(
      (c) => !(c.id === id && c.workspaceId === workspaceId)
    );
    if (this.state.calendarEntries.length !== before) {
      this.save();
      return true;
    }
    return false;
  }
  // Content Projects & 17-State Pipeline
  listContentProjects(workspaceId) {
    return this.state.contentProjects.filter((p) => p.workspaceId === workspaceId);
  }
  getContentProjectById(id, workspaceId) {
    return this.state.contentProjects.find(
      (p) => p.id === id && (!workspaceId || p.workspaceId === workspaceId)
    ) || null;
  }
  upsertContentProject(proj) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (proj.id) {
      const idx = this.state.contentProjects.findIndex(
        (p) => p.id === proj.id && p.workspaceId === proj.workspaceId
      );
      if (idx !== -1) {
        const existing = this.state.contentProjects[idx];
        const status2 = proj.status || existing.status || "PLANNED";
        const next = {
          ...existing,
          ...proj,
          status: status2,
          stage: proj.stage || mapProjectStateToStage(status2),
          progress: proj.progress ?? mapProjectStateToProgress(status2),
          updatedAt: now
        };
        this.state.contentProjects[idx] = next;
        this.save();
        return next;
      }
    }
    const status = proj.status || "PLANNED";
    const created = {
      platform: "Instagram Reels",
      owner: "Workspace Owner",
      creditsUsed: 0,
      formatType: "short_form",
      productionMethod: "hybrid",
      scriptApproved: false,
      scriptVersions: [],
      scriptVariants: [],
      platformAdaptations: {},
      finalApproved: false,
      sourceType: "manual",
      ...proj,
      id: proj.id || this.newId("proj"),
      status,
      stage: proj.stage || mapProjectStateToStage(status),
      progress: proj.progress ?? mapProjectStateToProgress(status),
      createdAt: now,
      updatedAt: now
    };
    this.state.contentProjects.unshift(created);
    this.state.contentProjects = this.state.contentProjects.slice(0, 300);
    this.save();
    return created;
  }
  deleteContentProject(id, workspaceId) {
    const before = this.state.contentProjects.length;
    this.state.contentProjects = this.state.contentProjects.filter(
      (p) => !(p.id === id && p.workspaceId === workspaceId)
    );
    if (this.state.contentProjects.length !== before) {
      this.save();
      return true;
    }
    return false;
  }
  // Presenter Presets CRUD
  listPresenters(workspaceId) {
    return this.state.presenters.filter((p) => p.workspaceId === workspaceId);
  }
  upsertPresenter(entry) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (entry.id) {
      const idx = this.state.presenters.findIndex(
        (p) => p.id === entry.id && p.workspaceId === entry.workspaceId
      );
      if (idx !== -1) {
        const next = {
          ...this.state.presenters[idx],
          ...entry,
          updatedAt: now
        };
        this.state.presenters[idx] = next;
        this.save();
        return next;
      }
    }
    const created = {
      ...entry,
      id: entry.id || this.newId("pres"),
      createdAt: now,
      updatedAt: now
    };
    this.state.presenters.unshift(created);
    this.save();
    return created;
  }
  deletePresenter(id, workspaceId) {
    const before = this.state.presenters.length;
    this.state.presenters = this.state.presenters.filter(
      (p) => !(p.id === id && p.workspaceId === workspaceId)
    );
    if (this.state.presenters.length !== before) {
      this.save();
      return true;
    }
    return false;
  }
  // Automation Workflows & Execution Logs
  listWorkflows(workspaceId) {
    return workspaceId ? this.state.workflows.filter((w) => w.workspaceId === workspaceId) : this.state.workflows;
  }
  getWorkflowById(id, workspaceId) {
    return this.state.workflows.find(
      (w) => w.id === id && (!workspaceId || w.workspaceId === workspaceId)
    ) || null;
  }
  upsertWorkflow(entry) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (entry.id) {
      const idx = this.state.workflows.findIndex(
        (w) => w.id === entry.id && w.workspaceId === entry.workspaceId
      );
      if (idx !== -1) {
        const next = {
          ...this.state.workflows[idx],
          ...entry,
          updatedAt: now
        };
        this.state.workflows[idx] = next;
        this.save();
        return next;
      }
    }
    const created = {
      ...entry,
      id: entry.id || this.newId("wf"),
      createdAt: now,
      updatedAt: now
    };
    this.state.workflows.unshift(created);
    this.state.workflows = this.state.workflows.slice(0, 120);
    this.save();
    return created;
  }
  deleteWorkflow(id, workspaceId) {
    const before = this.state.workflows.length;
    this.state.workflows = this.state.workflows.filter(
      (w) => !(w.id === id && w.workspaceId === workspaceId)
    );
    if (this.state.workflows.length !== before) {
      this.save();
      return true;
    }
    return false;
  }
  addWorkflowExecution(entry) {
    const rec = {
      id: this.newId("wfexec"),
      ...entry
    };
    this.state.workflowExecutions.unshift(rec);
    this.state.workflowExecutions = this.state.workflowExecutions.slice(0, 300);
    this.save();
    return rec;
  }
  listWorkflowExecutions(workspaceId, workflowId) {
    return this.state.workflowExecutions.filter(
      (e) => e.workspaceId === workspaceId && (!workflowId || e.workflowId === workflowId)
    );
  }
  // Account Deletion Server Data Purge
  purgeUserData(ownerUid) {
    if (!ownerUid || ownerUid === "anonymous") return 0;
    const ownedWorkspaces = Object.entries(this.state.workspaceOwners).filter(([, uid]) => uid === ownerUid).map(([wsId]) => wsId);
    for (const wsId of ownedWorkspaces) {
      delete this.state.workspaceOwners[wsId];
      delete this.state.workspaceSnapshots[wsId];
      delete this.state.integrationRecommendationsByWs[wsId];
    }
    this.state.strategies = this.state.strategies.filter((s) => s.ownerUid !== ownerUid);
    this.state.calendarEntries = this.state.calendarEntries.filter((c) => c.ownerUid !== ownerUid);
    this.state.contentProjects = this.state.contentProjects.filter((p) => p.ownerUid !== ownerUid);
    this.state.presenters = this.state.presenters.filter((p) => p.ownerUid !== ownerUid);
    this.state.workflows = this.state.workflows.filter((w) => w.ownerUid !== ownerUid);
    this.state.workflowExecutions = this.state.workflowExecutions.filter((e) => e.ownerUid !== ownerUid);
    this.state.backgroundJobs = this.state.backgroundJobs.filter((j) => j.ownerUid !== ownerUid);
    this.state.aiMemories = this.state.aiMemories.filter((m) => m.ownerUid !== ownerUid);
    this.state.mediaLibrary = this.state.mediaLibrary.filter((m) => m.ownerUid !== ownerUid);
    this.state.seoAuditReports = this.state.seoAuditReports.filter((r) => r.ownerUid !== ownerUid);
    this.state.videoBreakdowns = this.state.videoBreakdowns.filter((v) => v.ownerUid !== ownerUid);
    this.state.notifications = this.state.notifications.filter((n) => n.ownerUid !== ownerUid);
    this.state.scheduledJobs = this.state.scheduledJobs.filter((j) => j.ownerUid !== ownerUid);
    this.state.analyticsConnections = this.state.analyticsConnections.filter((c) => c.ownerUid !== ownerUid);
    this.state.growthSnapshots = this.state.growthSnapshots.filter((g) => g.ownerUid !== ownerUid);
    this.state.growthReports = this.state.growthReports.filter((r) => r.ownerUid !== ownerUid);
    this.save();
    return ownedWorkspaces.length;
  }
  // Encrypted Analytics Provider Connections & Growth Intelligence Storage
  listAnalyticsConnections(workspaceId) {
    return this.state.analyticsConnections.filter((c) => c.workspaceId === workspaceId);
  }
  getAnalyticsConnectionById(id, workspaceId) {
    return this.state.analyticsConnections.find(
      (c) => c.id === id && (!workspaceId || c.workspaceId === workspaceId)
    ) || null;
  }
  upsertAnalyticsConnection(entry) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (entry.id) {
      const idx = this.state.analyticsConnections.findIndex(
        (c) => c.id === entry.id && c.workspaceId === entry.workspaceId
      );
      if (idx !== -1) {
        const next = {
          ...this.state.analyticsConnections[idx],
          ...entry,
          updatedAt: now
        };
        this.state.analyticsConnections[idx] = next;
        this.save();
        return next;
      }
    }
    const existingByProvider = this.state.analyticsConnections.findIndex(
      (c) => c.workspaceId === entry.workspaceId && c.provider === entry.provider
    );
    if (existingByProvider !== -1) {
      const next = {
        ...this.state.analyticsConnections[existingByProvider],
        ...entry,
        updatedAt: now
      };
      this.state.analyticsConnections[existingByProvider] = next;
      this.save();
      return next;
    }
    const created = {
      ...entry,
      id: entry.id || this.newId("aconn"),
      createdAt: now,
      updatedAt: now
    };
    this.state.analyticsConnections.unshift(created);
    this.save();
    return created;
  }
  deleteAnalyticsConnection(id, workspaceId) {
    const before = this.state.analyticsConnections.length;
    this.state.analyticsConnections = this.state.analyticsConnections.filter(
      (c) => !(c.id === id && c.workspaceId === workspaceId)
    );
    this.state.growthSnapshots = this.state.growthSnapshots.filter(
      (s) => !(s.connectionId === id && s.workspaceId === workspaceId)
    );
    if (this.state.analyticsConnections.length !== before) {
      this.save();
      return true;
    }
    return false;
  }
  saveGrowthSnapshot(entry) {
    const idx = this.state.growthSnapshots.findIndex(
      (s) => s.workspaceId === entry.workspaceId && s.connectionId === entry.connectionId && s.periodKey === entry.periodKey
    );
    if (idx !== -1) {
      const next = { ...entry, id: this.state.growthSnapshots[idx].id };
      this.state.growthSnapshots[idx] = next;
      this.save();
      return next;
    }
    const created = { id: this.newId("gsnap"), ...entry };
    this.state.growthSnapshots.unshift(created);
    this.state.growthSnapshots = this.state.growthSnapshots.slice(0, 400);
    this.save();
    return created;
  }
  listGrowthSnapshots(workspaceId, periodKey) {
    return this.state.growthSnapshots.filter(
      (s) => s.workspaceId === workspaceId && (!periodKey || s.periodKey === periodKey)
    );
  }
  addGrowthReport(entry) {
    const created = {
      id: this.newId("grep"),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...entry
    };
    this.state.growthReports.unshift(created);
    this.state.growthReports = this.state.growthReports.slice(0, 120);
    this.save();
    return created;
  }
  listGrowthReports(workspaceId) {
    return this.state.growthReports.filter((r) => r.workspaceId === workspaceId);
  }
  setIntegrationRecommendations(workspaceId, items) {
    this.state.integrationRecommendationsByWs[workspaceId] = items;
    this.save();
  }
  getIntegrationRecommendations(workspaceId) {
    return this.state.integrationRecommendationsByWs[workspaceId] || [];
  }
  addAiRun(entry) {
    const rec = {
      id: this.newId("airun"),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...entry
    };
    this.state.aiRuns.unshift(rec);
    this.state.aiRuns = this.state.aiRuns.slice(0, 250);
    this.save();
    return rec;
  }
  getAiRuns(workspaceId) {
    return workspaceId ? this.state.aiRuns.filter((r) => r.workspaceId === workspaceId || r.workspaceId === "default") : this.state.aiRuns;
  }
  addIntegrationLog(entry) {
    const rec = {
      id: this.newId("intlog"),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...entry
    };
    this.state.integrationLogs.unshift(rec);
    this.state.integrationLogs = this.state.integrationLogs.slice(0, 200);
    this.save();
    return rec;
  }
  getIntegrationLogs(workspaceId) {
    return workspaceId ? this.state.integrationLogs.filter((l) => l.workspaceId === workspaceId || l.workspaceId === "default") : this.state.integrationLogs;
  }
  addNotification(entry) {
    const rec = {
      id: this.newId("notif"),
      read: false,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...entry
    };
    this.state.notifications.unshift(rec);
    this.state.notifications = this.state.notifications.slice(0, 150);
    this.save();
    return rec;
  }
  getNotifications(workspaceId) {
    return workspaceId ? this.state.notifications.filter((n) => n.workspaceId === workspaceId || n.workspaceId === "default") : this.state.notifications;
  }
  markNotificationRead(id) {
    const found = this.state.notifications.find((n) => n.id === id);
    if (!found) return null;
    found.read = true;
    this.save();
    return found;
  }
  markAllNotificationsRead(workspaceId) {
    let changed = 0;
    for (const n of this.state.notifications) {
      if ((!workspaceId || n.workspaceId === workspaceId || n.workspaceId === "default") && !n.read) {
        n.read = true;
        changed++;
      }
    }
    if (changed > 0) this.save();
    return changed;
  }
  addScheduledJob(entry) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const rec = {
      id: this.newId("job"),
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
      ...entry
    };
    this.state.scheduledJobs.unshift(rec);
    this.state.scheduledJobs = this.state.scheduledJobs.slice(0, 200);
    this.save();
    return rec;
  }
  getScheduledJobs(workspaceId) {
    return workspaceId ? this.state.scheduledJobs.filter((j) => j.workspaceId === workspaceId) : this.state.scheduledJobs;
  }
  updateScheduledJob(id, patch) {
    const found = this.state.scheduledJobs.find((j) => j.id === id);
    if (!found) return null;
    Object.assign(found, patch, { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    this.save();
    return found;
  }
  createVideoJob(entry) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const rec = {
      id: this.newId("vidjob"),
      createdAt: now,
      updatedAt: now,
      ...entry
    };
    this.state.videoJobs.unshift(rec);
    this.state.videoJobs = this.state.videoJobs.slice(0, 100);
    this.save();
    return rec;
  }
  updateVideoJob(id, patch) {
    const found = this.state.videoJobs.find((j) => j.id === id);
    if (!found) return null;
    Object.assign(found, patch, { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    this.save();
    return found;
  }
  getVideoJobs(workspaceId) {
    return workspaceId ? this.state.videoJobs.filter((j) => j.workspaceId === workspaceId || j.workspaceId === "default") : this.state.videoJobs;
  }
  getVideoJobById(id) {
    return this.state.videoJobs.find((j) => j.id === id) || null;
  }
  addAuditLog(entry) {
    const rec = {
      id: this.newId("audit"),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...entry
    };
    this.state.auditLogs.unshift(rec);
    this.state.auditLogs = this.state.auditLogs.slice(0, 300);
    this.save();
    return rec;
  }
  getAuditLogs(workspaceId) {
    return workspaceId ? this.state.auditLogs.filter((a) => a.workspaceId === workspaceId || a.workspaceId === "default") : this.state.auditLogs;
  }
  addBillingRecord(entry) {
    const rec = {
      id: this.newId("bill"),
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...entry
    };
    this.state.billingRecords.unshift(rec);
    this.state.billingRecords = this.state.billingRecords.slice(0, 100);
    this.save();
    return rec;
  }
  getBillingRecords(workspaceId) {
    return workspaceId ? this.state.billingRecords.filter((b) => b.workspaceId === workspaceId) : this.state.billingRecords;
  }
  getIdempotentResult(key) {
    if (!key) return null;
    return this.state.idempotencyCache[key] || null;
  }
  setIdempotentResult(key, status, result) {
    if (!key) return;
    this.state.idempotencyCache[key] = { status, result, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    const keys = Object.keys(this.state.idempotencyCache);
    if (keys.length > 500) {
      for (const oldKey of keys.slice(0, keys.length - 400)) {
        delete this.state.idempotencyCache[oldKey];
      }
    }
    this.save();
  }
};
var stateStore = new ServerStateStore();

// server/utils/firebaseConfig.ts
import fs3 from "fs";
import path3 from "path";
var cachedConfig = null;
function getFirebaseServerConfig() {
  if (cachedConfig) return cachedConfig;
  const candidates = [
    path3.resolve(process.cwd(), "firebase-applet-config.json"),
    path3.resolve(import.meta.dirname || process.cwd(), "../../firebase-applet-config.json"),
    path3.resolve(import.meta.dirname || process.cwd(), "../firebase-applet-config.json")
  ];
  for (const filePath of candidates) {
    try {
      if (fs3.existsSync(filePath)) {
        const raw = fs3.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.projectId === "string" && parsed.projectId.trim()) {
          cachedConfig = {
            projectId: parsed.projectId.trim(),
            appId: parsed.appId,
            apiKey: parsed.apiKey,
            authDomain: parsed.authDomain,
            firestoreDatabaseId: parsed.firestoreDatabaseId,
            storageBucket: parsed.storageBucket,
            messagingSenderId: parsed.messagingSenderId,
            measurementId: parsed.measurementId,
            oAuthClientId: parsed.oAuthClientId
          };
          return cachedConfig;
        }
      }
    } catch {
    }
  }
  const envProjectId = process.env.FIREBASE_PROJECT_ID?.trim() || process.env.VITE_FIREBASE_PROJECT_ID?.trim() || "";
  cachedConfig = {
    projectId: envProjectId,
    firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID?.trim() || void 0
  };
  return cachedConfig;
}
function isPlaceholderFirebaseProject() {
  const cfg = getFirebaseServerConfig();
  return !cfg.projectId || cfg.projectId === "remixed-project-id";
}

// server/middleware/auth.ts
var firebaseConfig = getFirebaseServerConfig();
var isPlaceholderProject = isPlaceholderFirebaseProject();
if (!isPlaceholderProject) {
  try {
    if (!getApps().length) {
      initializeApp({
        projectId: firebaseConfig.projectId
      });
    }
  } catch (err) {
    console.warn("Firebase Admin initialization skipped:", err instanceof Error ? err.message : err);
  }
}
async function attachFirebaseUser(req, _res, next) {
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
      }
    }
  }
  next();
}
function extractWorkspaceContext(req) {
  const areq = req;
  const rawWs = (typeof req.headers["x-workspace-id"] === "string" ? req.headers["x-workspace-id"] : "") || (typeof req.query.workspaceId === "string" ? req.query.workspaceId : "") || (typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "") || "default";
  const workspaceId = rawWs.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128) || "default";
  const actorUid = areq.user?.uid || "anonymous";
  return { workspaceId, actorUid };
}
function assertWorkspaceAccess(req, res) {
  const { workspaceId, actorUid } = extractWorkspaceContext(req);
  if (workspaceId !== "default" && actorUid !== "anonymous") {
    const allowed = stateStore.claimOrVerifyWorkspaceOwner(workspaceId, actorUid);
    if (!allowed) {
      res.status(403).json({
        error: "Access denied: this workspace belongs to another authenticated account."
      });
      return null;
    }
  } else if (workspaceId !== "default" && actorUid === "anonymous") {
    const existingOwner = stateStore.getWorkspaceOwner(workspaceId);
    if (existingOwner) {
      res.status(401).json({
        error: "Authentication required to access this workspace."
      });
      return null;
    }
  }
  return { workspaceId, actorUid };
}
var rateBuckets = /* @__PURE__ */ new Map();
function apiRateLimiter(windowMs = 6e4, maxRequests = 240) {
  return (req, res, next) => {
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
        error: "Rate limit exceeded. Please wait a moment before sending more requests."
      });
      return;
    }
    existing.count += 1;
    next();
  };
}

// server/routes/intelligence.ts
import { execFile } from "child_process";
import fs5 from "fs";
import { promisify } from "util";
import { Router } from "express";
import * as cheerio2 from "cheerio";
import { Type } from "@google/genai";

// server/ai/geminiClient.ts
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
var MODEL_CATALOG = {
  text: [
    {
      id: "gemini-4-hydrogen",
      label: "Gemini 4 Hydrogen (Flash)",
      tier: "standard",
      description: "Fast reasoning, strategy, grounded research & daily marketing agents",
      contextWindow: "1M tokens",
      recommendedFor: "Daily content planning, scripts, web research & analytics Q&A",
      capabilities: {
        text: true,
        multimodalInput: true,
        searchGrounding: true
      }
    },
    {
      id: "gemini-4-neon",
      label: "Gemini 4 Neon (Pro)",
      tier: "paid",
      description: "Deep complex reasoning, campaign architecture, multi-modal analysis",
      contextWindow: "2M tokens",
      recommendedFor: "Deep campaign strategy, creative audits & multimodal video breakdown",
      capabilities: {
        text: true,
        multimodalInput: true,
        searchGrounding: true
      }
    },
    {
      id: "gemini-4-carbon",
      label: "Gemini 4 Carbon",
      tier: "paid",
      description: "Maximum analytical depth for competitive & growth audits",
      contextWindow: "2M tokens",
      recommendedFor: "Executive growth diagnostics, multi-source KPI analysis & deep positioning",
      capabilities: {
        text: true,
        multimodalInput: true,
        searchGrounding: true
      }
    },
    {
      id: "gemini-3.1-flash-lite",
      label: "Gemini 3.1 Flash Lite",
      tier: "standard",
      description: "Ultra-low-latency quick edits, summaries, and classifications",
      contextWindow: "1M tokens",
      recommendedFor: "Quick rewrites, caption variations, tagging & fast UI assists",
      capabilities: {
        text: true,
        multimodalInput: true,
        searchGrounding: true
      }
    }
  ],
  image: [
    {
      id: "gemini-3.1-flash-lite-image",
      label: "Nano Banana 2 Lite",
      tier: "paid",
      description: "Fast general image generation and creative editing",
      contextWindow: "Multi-turn image edit",
      recommendedFor: "Rapid storyboard frames, social thumbnails & product concept drafts",
      capabilities: {
        imageGeneration: true,
        multimodalInput: true
      }
    },
    {
      id: "gemini-nano-banana-2.1",
      label: "Nano Banana 2.1 (1K\u20134K)",
      tier: "paid",
      description: "High-res 1K/2K/4K studio visuals + Google Image Search grounding",
      contextWindow: "Multi-reference + Search",
      recommendedFor: "1K\u20134K hero creatives, reference-matched product scenes & grounded visuals",
      capabilities: {
        imageGeneration: true,
        multimodalInput: true,
        searchGrounding: true,
        imageSearchGrounding: true
      }
    },
    {
      id: "gemini-3-pro-image",
      label: "Nano Banana Pro",
      tier: "paid",
      description: "Studio-grade typography, product scenes, and art direction",
      contextWindow: "Multi-reference studio",
      recommendedFor: "Ad creatives with crisp typography, studio packaging & poster layouts",
      capabilities: {
        imageGeneration: true,
        multimodalInput: true,
        searchGrounding: true
      }
    }
  ],
  video: [
    {
      id: "gemini-omni-1.2-flash",
      label: "Gemini Omni 1.2 Flash (Veo)",
      tier: "paid",
      description: "Text-to-video, image-to-video animation, editing & extension",
      contextWindow: "Multi-modal video interaction",
      recommendedFor: "AI-assisted short-form visual clips & animated storyboard scenes",
      capabilities: {
        videoGeneration: true,
        multimodalInput: true
      }
    }
  ],
  voice: [
    {
      id: "gemini-3.8-flash-lite-tts",
      label: "Gemini 3.8 Flash Lite TTS",
      tier: "standard",
      description: "Fast, natural single-speaker marketing voiceovers",
      contextWindow: "Speech synthesis",
      recommendedFor: "Fast narration tracks for Reels, Shorts & explainer storyboards",
      capabilities: {
        audioGeneration: true
      }
    },
    {
      id: "gemini-3.8-flash-tts",
      label: "Gemini 3.8 Flash TTS (Voice Design)",
      tier: "standard",
      description: "Dual-speaker dialogue, vocal bursts & custom voice direction",
      contextWindow: "Multi-speaker TTS",
      recommendedFor: "Conversational UGC scripts, dialogue ads & styled voiceovers",
      capabilities: {
        audioGeneration: true
      }
    }
  ],
  music: [
    {
      id: "lyria-3-clip-preview",
      label: "Lyria 3 Clip (30s)",
      tier: "paid",
      description: "30-second background music beds & jingles",
      contextWindow: "30s audio clip",
      recommendedFor: "Short-form video background beds & branded sonic hooks",
      capabilities: {
        audioGeneration: true
      }
    },
    {
      id: "lyria-3-pro-preview",
      label: "Lyria 3 Pro (Full Track)",
      tier: "paid",
      description: "Full-length custom soundtrack generation",
      contextWindow: "Full-length track",
      recommendedFor: "Long-form YouTube demos, launch trailers & podcast beds",
      capabilities: {
        audioGeneration: true
      }
    }
  ],
  transcription: [
    {
      id: "gemini-3.5-transcribe",
      label: "Gemini 3.5 Transcribe",
      tier: "standard",
      description: "Pre-recorded speech-to-text transcription",
      contextWindow: "Audio-to-text",
      recommendedFor: "Captions, interview transcripts & spoken script extraction",
      capabilities: {
        text: true,
        multimodalInput: true
      }
    }
  ],
  live: [
    {
      id: "gemini-3.8-live",
      label: "Gemini 3.8 Live Voice",
      tier: "standard",
      description: "Real-time bidirectional voice strategy session",
      contextWindow: "Low-latency audio stream",
      recommendedFor: "Live brainstorming & hands-free creative direction",
      capabilities: {
        text: true,
        audioGeneration: true,
        multimodalInput: true
      }
    }
  ],
  decision: [
    {
      id: "gemini-decision-1",
      label: "Gemini Decision 1",
      tier: "standard",
      description: "Calibrated yes/no gates & rubric scoring",
      contextWindow: "Calibrated evaluation",
      recommendedFor: "Audience readiness scoring & automated QA approval thresholds",
      capabilities: {
        text: true
      }
    }
  ]
};
var ALLOWED_TEXT_IDS = new Set(MODEL_CATALOG.text.map((m) => m.id));
var ALLOWED_IMAGE_IDS = new Set(MODEL_CATALOG.image.map((m) => m.id));
var ALLOWED_VOICE_IDS = new Set(MODEL_CATALOG.voice.map((m) => m.id));
var ALLOWED_MUSIC_IDS = new Set(MODEL_CATALOG.music.map((m) => m.id));
function resolveTextModel(model) {
  if (model && ALLOWED_TEXT_IDS.has(model)) return model;
  return "gemini-4-hydrogen";
}
function resolveImageModel(model) {
  if (model === "gemini-3-pro-image-preview") return "gemini-3-pro-image";
  if (model && ALLOWED_IMAGE_IDS.has(model)) return model;
  return "gemini-3.1-flash-lite-image";
}
function resolveVoiceModel(model) {
  if (model && ALLOWED_VOICE_IDS.has(model)) return model;
  return "gemini-3.8-flash-lite-tts";
}
function resolveMusicModel(model) {
  if (model && ALLOWED_MUSIC_IDS.has(model)) return model;
  return "lyria-3-clip-preview";
}
function requireApiKey() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === "MY_GEMINI_API_KEY") {
    const isVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
    const err = new Error(
      isVercel ? "GEMINI_API_KEY is not configured in Vercel Environment Variables. Run `npm run vercel:env` (or set GEMINI_API_KEY in Vercel Project Settings -> Environment Variables) and redeploy." : "GEMINI_API_KEY is not configured. Please add your Gemini API key in AI Studio Settings > Secrets or .env."
    );
    err.status = 503;
    throw err;
  }
  return key;
}
function getGeminiClient() {
  const apiKey = requireApiKey();
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function getDecisionsClient() {
  const apiKey = requireApiKey();
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function thinkingConfigForModel(model, depth = "medium") {
  if (model === "gemini-3.1-flash-lite") {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  if (depth === "low") return { thinkingLevel: ThinkingLevel.LOW };
  if (depth === "high") return { thinkingLevel: ThinkingLevel.HIGH };
  return { thinkingLevel: ThinkingLevel.MEDIUM };
}
function parseJsonSafe(raw, fallback) {
  const text = (raw || "").trim();
  if (!text) {
    if (fallback !== void 0) return fallback;
    throw new Error("Empty model response");
  }
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i) || text.match(/```([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const braceMatch = candidate.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[1]);
      } catch {
      }
    }
    if (fallback !== void 0) return fallback;
    throw new Error("Failed to parse structured JSON from Gemini response.");
  }
}
function formatGeminiError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const explicitStatus = err?.status;
  if (msg.includes("GEMINI_API_KEY is not configured")) {
    return { status: 400, message: msg };
  }
  if (msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID") || explicitStatus === 403) {
    return {
      status: 403,
      message: "Gemini API access denied or invalid API key. Check your GEMINI_API_KEY in AI Studio Settings > Secrets."
    };
  }
  if (msg.includes("RESOURCE_EXHAUSTED") || explicitStatus === 429) {
    return {
      status: 429,
      message: "Gemini API quota exceeded or paid-tier key required for this model. Verify your billing-enabled API key in AI Studio Settings > Secrets."
    };
  }
  if (msg.includes("NOT_FOUND") || explicitStatus === 404) {
    return {
      status: 404,
      message: `Requested Gemini model was not found or is unsupported: ${msg}`
    };
  }
  return {
    status: explicitStatus && explicitStatus >= 400 && explicitStatus < 600 ? explicitStatus : 500,
    message: msg || "Unexpected AI service error"
  };
}
function buildBusinessContextPrompt(business) {
  if (!business) return "Business: General SaaS/Brand.";
  const lines = [
    `Business Name: ${String(business.name || "Unknown")}`,
    business.websiteUrl ? `Website: ${String(business.websiteUrl)}` : "",
    business.industry ? `Industry: ${String(business.industry)}` : "",
    business.description ? `Description: ${String(business.description)}` : "",
    business.location ? `Location: ${String(business.location)}` : "",
    business.targetCountries ? `Target Markets: ${String(business.targetCountries)}` : "",
    business.positioning ? `Positioning: ${String(business.positioning)}` : "",
    business.valueProposition ? `Value Proposition: ${String(business.valueProposition)}` : "",
    business.brandVoiceNotes ? `Brand Voice: ${String(business.brandVoiceNotes)}` : "",
    business.wordsToUse ? `Preferred Terms: ${String(business.wordsToUse)}` : "",
    business.wordsToAvoid ? `Words to Avoid: ${String(business.wordsToAvoid)}` : "",
    Array.isArray(business.products) && business.products.length ? `Product Surfaces: ${business.products.join(", ")}` : "",
    Array.isArray(business.objectives) && business.objectives.length ? `Objectives: ${business.objectives.join(", ")}` : "",
    Array.isArray(business.channels) && business.channels.length ? `Priority Channels: ${business.channels.join(", ")}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

// server/services/aiTelemetry.ts
function isTransientError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const status = err?.status;
  return status === 429 || status === 503 || status === 502 || msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT");
}
async function withRetry(fn, retries = 2, baseDelayMs = 600) {
  let lastErr;
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
async function runTrackedAiCall(meta, fn) {
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
      creditsEstimated: meta.creditsEstimated ?? 0
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
      error: err instanceof Error ? err.message.slice(0, 260) : String(err).slice(0, 260)
    });
    throw err;
  }
}

// server/services/analyticsAdapters.ts
import crypto2 from "crypto";
import fs4 from "fs";
import path4 from "path";
import * as cheerio from "cheerio";

// server/services/composio.ts
import { Composio } from "@composio/core";
var DEFAULT_MCP_URL = "https://connect.composio.dev/mcp";
var MARKETING_TOOLKITS = [
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "linkedin",
  "twitter",
  "metaads",
  "google_search_console",
  "stripe"
];
function getKey() {
  return (process.env.COMPOSIO_API_KEY || "").trim();
}
function getComposioMode() {
  const key = getKey();
  if (!key) return "unconfigured";
  if (key.startsWith("ck_")) return "mcp_consumer_key";
  return "v3_api_key";
}
function isComposioConfigured() {
  return Boolean(getKey());
}
function getComposioMcpUrl() {
  return (process.env.COMPOSIO_MCP_URL || DEFAULT_MCP_URL).trim();
}
var cachedV3Client = null;
function getV3Client() {
  if (!cachedV3Client) {
    cachedV3Client = new Composio({ apiKey: getKey() });
  }
  return cachedV3Client;
}
async function callComposioMcp(toolName, args, timeoutMs = 25e3) {
  const key = getKey();
  if (!key) {
    throw new Error("COMPOSIO_API_KEY is not configured on the server.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(getComposioMcpUrl(), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args
        }
      })
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Composio MCP HTTP ${response.status}: ${raw.slice(0, 240)}`);
    }
    const dataLines = raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
    const jsonLine = dataLines.length > 0 ? dataLines[dataLines.length - 1] : raw;
    const rpc = JSON.parse(jsonLine);
    if (rpc.error?.message) {
      throw new Error(`Composio MCP error: ${rpc.error.message}`);
    }
    const contentText = rpc.result?.content?.[0]?.text;
    if (!contentText) {
      return { successful: !rpc.result?.isError, data: {} };
    }
    try {
      return JSON.parse(contentText);
    } catch {
      return { successful: !rpc.result?.isError, data: { rawText: contentText } };
    }
  } finally {
    clearTimeout(timer);
  }
}
function normalizeMcpAccounts(toolkit, rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map((item) => {
    const obj = item || {};
    const userInfo = obj.user_info || {};
    const username = typeof userInfo.username === "string" ? userInfo.username : typeof userInfo.handle === "string" ? userInfo.handle : typeof obj.alias === "string" ? obj.alias : void 0;
    const displayName = typeof userInfo.name === "string" ? userInfo.name : typeof userInfo.display_name === "string" ? userInfo.display_name : username;
    return {
      id: String(obj.id || ""),
      toolkit,
      status: String(obj.status || "active").toLowerCase(),
      isDefault: Boolean(obj.is_default),
      accountType: typeof obj.account_type === "string" ? obj.account_type : void 0,
      username,
      displayName,
      externalUserId: typeof userInfo.id === "string" ? userInfo.id : void 0,
      userInfo
    };
  });
}
async function probeComposioHealth() {
  const mode = getComposioMode();
  const mcpUrl = getComposioMcpUrl();
  if (mode === "unconfigured") {
    return { configured: false, mode, mcpUrl, reachable: false, error: "COMPOSIO_API_KEY missing" };
  }
  try {
    if (mode === "mcp_consumer_key") {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8e3);
      try {
        const res = await fetch(mcpUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${getKey()}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "marketing-os", version: "1.0.0" }
            }
          })
        });
        return { configured: true, mode, mcpUrl, reachable: res.ok };
      } finally {
        clearTimeout(timer);
      }
    }
    await getV3Client().authConfigs.list({});
    return { configured: true, mode, mcpUrl, reachable: true };
  } catch (err) {
    return {
      configured: true,
      mode,
      mcpUrl,
      reachable: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function listComposioConnections(toolkits = [...MARKETING_TOOLKITS], workspaceId = "default") {
  const mode = getComposioMode();
  if (mode === "unconfigured") {
    return { statuses: {}, accounts: [], mode };
  }
  if (mode === "mcp_consumer_key") {
    const res = await callComposioMcp("COMPOSIO_MANAGE_CONNECTIONS", {
      toolkits: toolkits.slice(0, 12).map((name) => ({ name, action: "list" }))
    });
    if (!res.successful && res.error) {
      throw new Error(res.error);
    }
    const statuses2 = {};
    const allAccounts2 = [];
    const results = res.data?.results || {};
    for (const tk of toolkits) {
      const entry = results[tk];
      const accounts = normalizeMcpAccounts(tk, entry?.accounts);
      statuses2[tk] = {
        toolkit: tk,
        status: entry?.status || (accounts.some((a) => a.status === "active") ? "active" : "not_connected"),
        accounts
      };
      allAccounts2.push(...accounts);
    }
    stateStore.addIntegrationLog({
      workspaceId,
      provider: "composio",
      toolkit: toolkits.join(","),
      action: "list_connections",
      status: "success",
      detail: `Synced ${allAccounts2.length} active account(s) across ${toolkits.length} toolkits`
    });
    return { statuses: statuses2, accounts: allAccounts2, mode };
  }
  const client = getV3Client();
  const list = await client.connectedAccounts.list({ toolkitSlugs: toolkits });
  const statuses = {};
  const allAccounts = [];
  for (const tk of toolkits) {
    statuses[tk] = { toolkit: tk, status: "not_connected", accounts: [] };
  }
  for (const item of list.items || []) {
    const tk = item.toolkit?.slug || "unknown";
    const status = String(item.status || "active").toLowerCase();
    const summary = {
      id: item.id,
      toolkit: tk,
      status,
      isDefault: true
    };
    if (!statuses[tk]) statuses[tk] = { toolkit: tk, status: "not_connected", accounts: [] };
    statuses[tk].accounts.push(summary);
    if (status === "active") statuses[tk].status = "active";
    allAccounts.push(summary);
  }
  return { statuses, accounts: allAccounts, mode };
}
async function initiateComposioConnection(params) {
  const toolkit = params.toolkit.trim().toLowerCase();
  const workspaceId = params.workspaceId || "default";
  const mode = getComposioMode();
  if (mode === "unconfigured") {
    throw new Error("COMPOSIO_API_KEY is not configured.");
  }
  if (mode === "mcp_consumer_key") {
    const res = await callComposioMcp("COMPOSIO_MANAGE_CONNECTIONS", {
      toolkits: [
        {
          name: toolkit,
          action: "add",
          ...params.alias ? { alias: params.alias.slice(0, 120) } : {}
        }
      ],
      ...params.callbackUrl ? { custom_callback_url: params.callbackUrl } : {}
    });
    const entry = res.data?.results?.[toolkit];
    const redirectUrl = entry?.redirect_url || entry?.redirectUrl || "";
    if (!res.successful && res.error) {
      throw new Error(res.error);
    }
    if (entry?.error) {
      throw new Error(entry.error);
    }
    if (!redirectUrl) {
      throw new Error(`Composio did not return an OAuth Connect Link for toolkit "${toolkit}".`);
    }
    stateStore.addIntegrationLog({
      workspaceId,
      provider: "composio",
      toolkit,
      action: "initiate_connect",
      accountId: entry?.connected_account_id,
      status: "initiated",
      detail: `Generated OAuth Connect Link for ${toolkit}`
    });
    return {
      toolkit,
      status: entry?.status || "initiated",
      redirectUrl,
      accountId: entry?.connected_account_id
    };
  }
  const client = getV3Client();
  const configs = await client.authConfigs.list({ toolkit });
  let authConfigId = configs.items?.[0]?.id;
  if (!authConfigId) {
    const created = await client.authConfigs.create(toolkit, {
      type: "use_composio_managed_auth",
      name: `${toolkit}-managed`
    });
    authConfigId = created.id;
  }
  const link = await client.connectedAccounts.link(params.userId || workspaceId, authConfigId, {
    callbackUrl: params.callbackUrl
  });
  return {
    toolkit,
    status: "initiated",
    redirectUrl: link.redirectUrl || "",
    accountId: link.id
  };
}
async function disconnectComposioAccount(params) {
  const mode = getComposioMode();
  const workspaceId = params.workspaceId || "default";
  if (mode === "unconfigured") throw new Error("COMPOSIO_API_KEY is not configured.");
  if (mode === "mcp_consumer_key") {
    const res = await callComposioMcp("COMPOSIO_MANAGE_CONNECTIONS", {
      toolkits: [
        {
          name: params.toolkit,
          action: "remove",
          account_id: params.accountId
        }
      ]
    });
    if (!res.successful && res.error) {
      throw new Error(res.error);
    }
    const entry = res.data?.results?.[params.toolkit];
    if (entry?.error) throw new Error(entry.error);
    stateStore.addIntegrationLog({
      workspaceId,
      provider: "composio",
      toolkit: params.toolkit,
      action: "disconnect_account",
      accountId: params.accountId,
      status: "success",
      detail: `Disconnected ${params.toolkit} account ${params.accountId}`
    });
    return { removed: true, toolkit: params.toolkit, accountId: params.accountId };
  }
  await getV3Client().connectedAccounts.delete(params.accountId);
  return { removed: true, toolkit: params.toolkit, accountId: params.accountId };
}
async function executeComposioTool(params) {
  const mode = getComposioMode();
  const workspaceId = params.workspaceId || "default";
  if (mode === "unconfigured") {
    throw new Error("COMPOSIO_API_KEY is not configured on the server.");
  }
  const started = Date.now();
  try {
    if (mode === "mcp_consumer_key") {
      const toolCall = {
        tool_slug: params.toolSlug,
        arguments: params.arguments
      };
      if (params.accountId) {
        toolCall.connected_account_id = params.accountId;
      }
      const rpcRes = await callComposioMcp("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [toolCall] }, 45e3);
      const first = rpcRes.data?.results?.[0]?.response;
      const ok = Boolean(rpcRes.successful !== false && first?.successful !== false);
      const errMsg = first?.error || rpcRes.error || void 0;
      const latencyMs2 = Date.now() - started;
      stateStore.addIntegrationLog({
        workspaceId,
        provider: "composio",
        toolkit: params.toolkit,
        action: params.toolSlug,
        accountId: params.accountId,
        status: ok ? "success" : "error",
        latencyMs: latencyMs2,
        detail: ok ? `Executed ${params.toolSlug} successfully (${latencyMs2}ms)` : `Failed ${params.toolSlug}: ${errMsg || "Unknown tool error"}`
      });
      if (!ok) {
        throw new Error(errMsg || `Composio tool ${params.toolSlug} failed.`);
      }
      return {
        successful: true,
        data: first?.data || {},
        logId: rpcRes.log_id
      };
    }
    const res = await getV3Client().tools.execute(params.toolSlug, {
      userId: params.userId || workspaceId,
      arguments: params.arguments,
      connectedAccountId: params.accountId,
      dangerouslySkipVersionCheck: true
    });
    const latencyMs = Date.now() - started;
    stateStore.addIntegrationLog({
      workspaceId,
      provider: "composio",
      toolkit: params.toolkit,
      action: params.toolSlug,
      accountId: params.accountId,
      status: res.successful ? "success" : "error",
      latencyMs,
      detail: res.successful ? `Executed ${params.toolSlug} (${latencyMs}ms)` : `Failed ${params.toolSlug}: ${res.error || "Tool error"}`
    });
    if (!res.successful) {
      throw new Error(res.error || `Tool ${params.toolSlug} failed.`);
    }
    return {
      successful: true,
      data: res.data || {}
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    stateStore.addIntegrationLog({
      workspaceId,
      provider: "composio",
      toolkit: params.toolkit,
      action: params.toolSlug,
      accountId: params.accountId,
      status: "error",
      latencyMs,
      detail: message
    });
    throw err;
  }
}
async function searchComposioTools(query) {
  if (getComposioMode() !== "mcp_consumer_key") {
    return [];
  }
  const res = await callComposioMcp("COMPOSIO_SEARCH_TOOLS", {
    queries: [{ use_case: query }]
  });
  return res.data?.results || [];
}

// server/services/analyticsAdapters.ts
var PROVIDER_LABELS = {
  posthog: "PostHog Product Analytics",
  firebase: "Direct Firebase (Auth & Firestore)",
  supabase: "Direct Supabase Database",
  ga4: "Google Analytics 4",
  gsc: "Google Search Console",
  google_play: "Google Play Console",
  app_store: "Apple App Store Connect",
  meta_social: "Meta / Instagram Insights",
  tiktok: "TikTok Analytics",
  youtube: "YouTube Studio Analytics",
  linkedin: "LinkedIn Page Analytics",
  ads: "Paid Ad Platforms"
};
function getProviderLabel(provider) {
  return PROVIDER_LABELS[provider] || provider;
}
var ephemeralVaultKey = null;
function getVaultKey() {
  const envSecret = process.env.MOS_CREDENTIAL_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return crypto2.createHash("sha256").update(envSecret).digest();
  }
  if (ephemeralVaultKey) return ephemeralVaultKey;
  try {
    const keyFile = path4.join(getDataDir(), ".mos-vault.key");
    fs4.mkdirSync(path4.dirname(keyFile), { recursive: true });
    if (fs4.existsSync(keyFile)) {
      const hex = fs4.readFileSync(keyFile, "utf8").trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        ephemeralVaultKey = Buffer.from(hex, "hex");
        return ephemeralVaultKey;
      }
    }
    const generated = crypto2.randomBytes(32);
    fs4.writeFileSync(keyFile, generated.toString("hex"), { mode: 384 });
    ephemeralVaultKey = generated;
    return generated;
  } catch {
    ephemeralVaultKey = crypto2.randomBytes(32);
    return ephemeralVaultKey;
  }
}
function encryptCredentialPayload(payload) {
  const key = getVaultKey();
  const iv = crypto2.randomBytes(12);
  const cipher = crypto2.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}
function decryptCredentialPayload(encoded) {
  if (!encoded || !encoded.includes(".")) return {};
  try {
    const [ivB64, tagB64, dataB64] = encoded.split(".");
    const key = getVaultKey();
    const decipher = crypto2.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return {};
  }
}
function maskSecret(secret) {
  const clean = (secret || "").trim();
  if (!clean) return "Configured";
  if (clean.length <= 6) return "\u2022\u2022\u2022\u2022\u2022\u2022";
  return `\u2022\u2022\u2022\u2022${clean.slice(-4)}`;
}
function sanitizeConnectionSummary(conn) {
  const { encryptedCredentials: _stripped, ...safe } = conn;
  return safe;
}
function safeGrowthPct(current, previous) {
  if (current === null || current === void 0 || previous === null || previous === void 0) {
    return null;
  }
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) {
    return null;
  }
  return Math.round((current - previous) / previous * 1e3) / 10;
}
function safeRatioPct(numerator, denominator) {
  if (numerator === null || numerator === void 0 || denominator === null || denominator === void 0) {
    return null;
  }
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return Math.round(numerator / denominator * 1e3) / 10;
}
function resolveDateRange(range = "30d", customStart, customEnd) {
  const now = /* @__PURE__ */ new Date();
  const toIsoDay = (d) => d.toISOString().slice(0, 10);
  const addDays = (d, delta) => {
    const copy = new Date(d);
    copy.setUTCDate(copy.getUTCDate() + delta);
    return copy;
  };
  let start;
  let end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === "today") {
    start = end;
  } else if (range === "yesterday") {
    end = addDays(end, -1);
    start = end;
  } else if (range === "7d") {
    start = addDays(end, -6);
  } else if (range === "90d") {
    start = addDays(end, -89);
  } else if (range === "this_month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else if (range === "last_month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  } else if (range === "custom" && customStart && customEnd) {
    const s = /* @__PURE__ */ new Date(`${customStart.slice(0, 10)}T00:00:00Z`);
    const e = /* @__PURE__ */ new Date(`${customEnd.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s <= e) {
      start = s;
      end = e;
    } else {
      start = addDays(end, -29);
    }
  } else {
    range = "30d";
    start = addDays(end, -29);
  }
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 864e5) + 1);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(spanDays - 1));
  const startDate = toIsoDay(start);
  const endDate = toIsoDay(end);
  return {
    range,
    startDate,
    endDate,
    prevStartDate: toIsoDay(prevStart),
    prevEndDate: toIsoDay(prevEnd),
    periodKey: `${startDate}_${endDate}`
  };
}
function detectTrackingTechnologies(html) {
  const $ = cheerio.load(html || "");
  const scriptSrcs = $("script[src]").map((_, el) => $(el).attr("src") || "").get();
  const inlineScripts = $("script:not([src])").map((_, el) => $(el).html() || "").get().join("\n");
  const allScriptsText = `${scriptSrcs.join("\n")}
${inlineScripts}`;
  const storeLinks = [];
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (/play\.google\.com\/store\/apps/i.test(href) && !storeLinks.some((s) => s.url === href)) {
      storeLinks.push({ store: "google_play", url: href });
    }
    if (/apps\.apple\.com\//i.test(href) && !storeLinks.some((s) => s.url === href)) {
      storeLinks.push({ store: "app_store", url: href });
    }
  });
  const phMatch = allScriptsText.match(/posthog\.init|us\.i\.posthog\.com|eu\.i\.posthog\.com|app\.posthog\.com/i);
  const ga4Match = allScriptsText.match(/G-[A-Z0-9]{6,}|gtag\/js\?id=G-/i);
  const gtmMatch = allScriptsText.match(/GTM-[A-Z0-9]{4,}|googletagmanager\.com\/gtm\.js/i);
  const fbMatch = allScriptsText.match(/firebaseapp\.com|firebaseConfig|initializeApp|gstatic\.com\/firebasejs/i);
  const supaMatch = allScriptsText.match(/[a-z0-9-]+\.supabase\.co/i);
  const metaPixelMatch = allScriptsText.match(/connect\.facebook\.net|fbq\(['"]init['"]/i);
  const tiktokPixelMatch = allScriptsText.match(/analytics\.tiktok\.com|ttq\.load/i);
  const sdks = [
    {
      provider: "posthog",
      label: "PostHog",
      detected: Boolean(phMatch),
      evidence: phMatch ? `Matched "${phMatch[0]}" in page scripts` : "No PostHog snippet detected in homepage HTML"
    },
    {
      provider: "ga4",
      label: "Google Analytics 4",
      detected: Boolean(ga4Match || gtmMatch),
      evidence: ga4Match ? `Matched GA4 measurement token (${ga4Match[0]})` : gtmMatch ? `Matched Google Tag Manager (${gtmMatch[0]})` : "No GA4 / GTM tag detected in homepage HTML"
    },
    {
      provider: "firebase",
      label: "Firebase Web SDK",
      detected: Boolean(fbMatch),
      evidence: fbMatch ? `Matched Firebase config/SDK (${fbMatch[0]})` : "No Firebase snippet detected in homepage HTML"
    },
    {
      provider: "supabase",
      label: "Supabase Project",
      detected: Boolean(supaMatch),
      evidence: supaMatch ? `Matched Supabase URL (${supaMatch[0]})` : "No Supabase endpoint found in homepage HTML"
    },
    {
      provider: "meta_social",
      label: "Meta Pixel",
      detected: Boolean(metaPixelMatch),
      evidence: metaPixelMatch ? `Matched Meta Pixel (${metaPixelMatch[0]})` : "No Meta Pixel detected"
    },
    {
      provider: "tiktok",
      label: "TikTok Pixel",
      detected: Boolean(tiktokPixelMatch),
      evidence: tiktokPixelMatch ? `Matched TikTok Pixel (${tiktokPixelMatch[0]})` : "No TikTok Pixel detected"
    }
  ];
  const eventTaxonomyGaps = [];
  if (!phMatch && !ga4Match && !gtmMatch) {
    eventTaxonomyGaps.push(
      "No client-side product or web analytics tag (PostHog / GA4 / GTM) detected on the public landing page."
    );
  }
  if (!phMatch) {
    eventTaxonomyGaps.push(
      "Recommend instrumenting custom conversion events (`signup_started`, `signup_completed`, `activation_action`) in PostHog or server telemetry."
    );
  }
  if (!metaPixelMatch && !tiktokPixelMatch) {
    eventTaxonomyGaps.push(
      "No paid social attribution pixel detected; attribution for Meta/TikTok campaigns will rely on UTM parameters until pixel/CAPI is added."
    );
  }
  return { sdks, storeLinks, eventTaxonomyGaps };
}
function buildIntegrationRecommendations(params) {
  const products = (params.products || []).map((p) => p.toLowerCase());
  const channels = (params.channels || []).map((c) => c.toLowerCase());
  const connected = new Set(params.connectedProviders || []);
  const sdks = new Map((params.tracking?.sdks || []).map((s) => [s.provider, s]));
  const storeLinks = params.tracking?.storeLinks || [];
  const isWebOrSaas = Boolean(params.websiteUrl) || products.some((p) => /web|saas|site|landing|desktop|api|commerce/.test(p));
  const hasAndroid = products.some((p) => /android|mobile app/.test(p)) || storeLinks.some((s) => s.store === "google_play");
  const hasIos = products.some((p) => /ios|iphone|ipad|mobile app/.test(p)) || storeLinks.some((s) => s.store === "app_store");
  const hasSocial = channels.some((c) => /instagram|tiktok|youtube|linkedin|social|facebook/.test(c));
  const recs = [];
  if (isWebOrSaas || sdks.get("posthog")?.detected) {
    const ph = sdks.get("posthog");
    recs.push({
      provider: "posthog",
      providerLabel: "PostHog Product Analytics",
      priority: ph?.detected ? "High" : "Medium",
      whyRecommended: ph?.detected ? "PostHog SDK detected on your site \u2014 connect your Personal API Key to stream real DAU/WAU/MAU, funnels, and events." : "Track SaaS & web user journeys, retention, UTM traffic, and product activation milestones.",
      metricsUnlocked: ["DAU / WAU / MAU", "Pageviews", "Custom funnel events", "UTM & referrer attribution"],
      permissionsRequired: "PostHog Personal API Key with Project Read / Query permissions.",
      sdkDetected: Boolean(ph?.detected),
      detectedEvidence: ph?.evidence,
      historicalDataNote: "Full historical query window available back to project event inception.",
      connected: connected.has("posthog")
    });
  }
  if (isWebOrSaas || sdks.get("ga4")?.detected) {
    const ga = sdks.get("ga4");
    recs.push({
      provider: "ga4",
      providerLabel: "Google Analytics 4",
      priority: ga?.detected ? "High" : "Medium",
      whyRecommended: ga?.detected ? "GA4 / GTM tag detected on your website \u2014 authorize read access to pull sessions, engagement, and conversions." : "Measure acquisition channels, landing page conversion rates, and mobile/web attribution.",
      metricsUnlocked: ["Active users", "Sessions & engaged sessions", "Top landing pages", "Channel conversions"],
      permissionsRequired: "Google OAuth (`analytics.readonly`) or GA4 Service Account Viewer role.",
      sdkDetected: Boolean(ga?.detected),
      detectedEvidence: ga?.evidence,
      historicalDataNote: "Supports full GA4 property reporting history via Analytics Data API.",
      connected: connected.has("ga4")
    });
  }
  if (params.websiteUrl) {
    recs.push({
      provider: "gsc",
      providerLabel: "Google Search Console",
      priority: "High",
      whyRecommended: "Monitor organic impressions, search clicks, CTR, and average keyword positions for your website.",
      metricsUnlocked: ["Organic clicks", "Search impressions", "Average SERP position", "Top ranking pages"],
      permissionsRequired: "Composio Search Console connection (Google verified property owner/user).",
      sdkDetected: false,
      detectedEvidence: `Target domain: ${params.websiteUrl}`,
      historicalDataNote: "Up to 16 months of search performance history from Google.",
      connected: connected.has("gsc")
    });
  }
  if (sdks.get("firebase")?.detected || products.some((p) => /firebase|mobile|app|saas/.test(p))) {
    const fb = sdks.get("firebase");
    recs.push({
      provider: "firebase",
      providerLabel: "Direct Firebase (Auth & Firestore)",
      priority: fb?.detected ? "High" : "Low",
      whyRecommended: fb?.detected ? "Firebase Web SDK detected on site \u2014 inspect verified accounts and Firestore collection metrics safely." : "Directly query Firebase Authentication signups & Firestore business records without duplicating databases.",
      metricsUnlocked: ["Registered Auth accounts", "Email-verified accounts", "Firestore collection inspection"],
      permissionsRequired: "Firebase Project ID + Service Account JSON or Google Cloud OAuth token.",
      sdkDetected: Boolean(fb?.detected),
      detectedEvidence: fb?.evidence,
      historicalDataNote: "Account creation timestamps support historical signup trend bucketing.",
      connected: connected.has("firebase")
    });
  }
  if (sdks.get("supabase")?.detected || products.some((p) => /supabase|saas|web/.test(p))) {
    const sup = sdks.get("supabase");
    recs.push({
      provider: "supabase",
      providerLabel: "Direct Supabase Database",
      priority: sup?.detected ? "High" : "Low",
      whyRecommended: sup?.detected ? "Supabase project endpoint detected on your site \u2014 map your user/conversion tables for verified signup analytics." : "Read real signup, subscription, or event tables directly from Supabase via schema inspection.",
      metricsUnlocked: ["Table row counts", "User signups over time", "Mapped custom conversion events"],
      permissionsRequired: "Supabase Project URL + Read-Only / Service Role Key (encrypted server-side only).",
      sdkDetected: Boolean(sup?.detected),
      detectedEvidence: sup?.evidence,
      historicalDataNote: "Uses mapped `created_at` column for historical cohort/signup ranges.",
      connected: connected.has("supabase")
    });
  }
  if (hasAndroid) {
    recs.push({
      provider: "google_play",
      providerLabel: "Google Play Console",
      priority: "High",
      whyRecommended: "Android app presence detected \u2014 connect Play Console for reviews, vitals, and install reporting.",
      metricsUnlocked: ["Recent user reviews & ratings", "Crash/ANR vitals status", "Store listing diagnostics"],
      permissionsRequired: "Play Console Service Account linked to Google Cloud + Play Reporting API enabled.",
      sdkDetected: storeLinks.some((s) => s.store === "google_play"),
      detectedEvidence: storeLinks.find((s) => s.store === "google_play")?.url,
      historicalDataNote: "Direct Play API gives recent vitals/reviews; bulk historical store installs require Play GCS export.",
      connected: connected.has("google_play")
    });
  }
  if (hasIos) {
    recs.push({
      provider: "app_store",
      providerLabel: "Apple App Store Connect",
      priority: "Medium",
      whyRecommended: "iOS app presence detected \u2014 connect App Store Connect Analytics API for iOS install & retention data.",
      metricsUnlocked: ["App Store impressions", "Product page views", "App units & proceeds"],
      permissionsRequired: "App Store Connect API Key (.p8), Issuer ID, and Key ID.",
      sdkDetected: storeLinks.some((s) => s.store === "app_store"),
      detectedEvidence: storeLinks.find((s) => s.store === "app_store")?.url,
      historicalDataNote: "Requires Apple App Store Connect Analytics Reports API provisioning.",
      connected: connected.has("app_store")
    });
  }
  if (hasSocial) {
    recs.push({
      provider: "meta_social",
      providerLabel: "Meta / Social Accounts (Composio)",
      priority: "Medium",
      whyRecommended: "Connect Instagram, TikTok, YouTube, or LinkedIn via Composio for direct post & audience metrics.",
      metricsUnlocked: ["Follower growth", "Post reach & impressions", "Engagement actions"],
      permissionsRequired: "OAuth connection via Composio Connect in Social Accounts / Integrations.",
      sdkDetected: Boolean(sdks.get("meta_social")?.detected || sdks.get("tiktok")?.detected),
      detectedEvidence: sdks.get("meta_social")?.evidence,
      historicalDataNote: "Social platform APIs typically limit organic insights lookback windows (30\u201390 days).",
      connected: connected.has("meta_social")
    });
  }
  return recs;
}
async function getGoogleAccessTokenFromServiceAccount(saJsonRaw, scopes) {
  const sa = JSON.parse(saJsonRaw);
  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account JSON must contain client_email and private_key.");
  }
  const nowSec = Math.floor(Date.now() / 1e3);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: scopes.join(" "),
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600
    })
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signer = crypto2.createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(sa.private_key).toString("base64url");
  const jwt = `${signingInput}.${signature}`;
  const resp = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    }).toString()
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google OAuth token exchange failed (${resp.status})`);
  }
  return data.access_token;
}
function normalizeHost(rawHost, fallback = "https://us.posthog.com") {
  const clean = (rawHost || fallback).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(clean)) return `https://${clean}`;
  return clean;
}
async function syncPostHog(conn, creds, rangeSpec) {
  const apiKey = String(creds.apiKey || "").trim();
  const host = normalizeHost(conn.hostUrl || String(creds.hostUrl || "https://us.posthog.com"));
  if (!apiKey) {
    throw new Error("PostHog Personal API Key is missing.");
  }
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  const projResp = await fetch(`${host}/api/projects/`, { headers, signal: AbortSignal.timeout(12e3) });
  if (projResp.status === 401 || projResp.status === 403) {
    const snapshot = {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "posthog",
      providerLabel: getProviderLabel("posthog"),
      projectOrProperty: conn.selectedProjectName || "PostHog",
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: "permission_restricted",
      statusDetail: `PostHog returned HTTP ${projResp.status}. Verify Personal API Key permissions (project:read & query:read).`,
      metrics: [],
      timeSeries: [],
      topPagesOrEvents: [],
      channels: [],
      retrievedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return {
      connPatch: {
        status: "error",
        completenessStatus: "permission_restricted",
        statusDetail: snapshot.statusDetail,
        lastError: snapshot.statusDetail
      },
      snapshot
    };
  }
  if (!projResp.ok) {
    throw new Error(`PostHog projects lookup failed (HTTP ${projResp.status}).`);
  }
  const projData = await projResp.json();
  const projects = (projData.results || []).map((p) => ({
    id: String(p.id),
    name: p.name || `Project ${p.id}`
  }));
  if (projects.length === 0) {
    const snapshot = {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "posthog",
      providerLabel: getProviderLabel("posthog"),
      projectOrProperty: "No accessible projects",
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: "connected_no_events",
      statusDetail: "Connected to PostHog, but this API key has access to zero projects.",
      metrics: [],
      timeSeries: [],
      topPagesOrEvents: [],
      channels: [],
      retrievedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return {
      connPatch: {
        status: "connected",
        discoveredProjects: [],
        completenessStatus: "connected_no_events",
        statusDetail: snapshot.statusDetail,
        lastSyncedAt: snapshot.retrievedAt
      },
      snapshot
    };
  }
  const activeProj = projects.find((p) => p.id === conn.selectedProjectId) || projects[0];
  const runHogQL = async (query) => {
    const r = await fetch(`${host}/api/projects/${activeProj.id}/query/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      signal: AbortSignal.timeout(15e3)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j.detail || j.error || `HTTP ${r.status}`;
      const e = new Error(msg);
      e.status = r.status;
      throw e;
    }
    return j.results || [];
  };
  try {
    const s = rangeSpec.startDate;
    const e = rangeSpec.endDate;
    const ps = rangeSpec.prevStartDate;
    const pe = rangeSpec.prevEndDate;
    const [currSummary, prevSummary, dailyRows, topPagesRows, utmRows] = await Promise.all([
      runHogQL(
        `SELECT count() AS events, uniq(distinct_id) AS unique_users, countIf(event = '$pageview') AS pageviews FROM events WHERE timestamp >= toDateTime('${s} 00:00:00') AND timestamp <= toDateTime('${e} 23:59:59')`
      ),
      runHogQL(
        `SELECT count() AS events, uniq(distinct_id) AS unique_users, countIf(event = '$pageview') AS pageviews FROM events WHERE timestamp >= toDateTime('${ps} 00:00:00') AND timestamp <= toDateTime('${pe} 23:59:59')`
      ),
      runHogQL(
        `SELECT toString(toDate(timestamp)) AS day, uniq(distinct_id) AS unique_users, count() AS events, countIf(event = '$pageview') AS pageviews FROM events WHERE timestamp >= toDateTime('${s} 00:00:00') AND timestamp <= toDateTime('${e} 23:59:59') GROUP BY day ORDER BY day ASC`
      ),
      runHogQL(
        `SELECT properties.$pathname AS pathname, count() AS views FROM events WHERE event = '$pageview' AND timestamp >= toDateTime('${s} 00:00:00') AND timestamp <= toDateTime('${e} 23:59:59') AND properties.$pathname IS NOT NULL GROUP BY pathname ORDER BY views DESC LIMIT 10`
      ),
      runHogQL(
        `SELECT coalesce(nullIf(properties.utm_source, ''), nullIf(properties.$referring_domain, ''), 'Direct / None') AS source, uniq(distinct_id) AS users, countIf(event = '$pageview') AS pageviews FROM events WHERE timestamp >= toDateTime('${s} 00:00:00') AND timestamp <= toDateTime('${e} 23:59:59') GROUP BY source ORDER BY users DESC LIMIT 8`
      )
    ]);
    const totalEvents = Number(currSummary[0]?.[0] ?? 0);
    const uniqueUsers = Number(currSummary[0]?.[1] ?? 0);
    const pageviews = Number(currSummary[0]?.[2] ?? 0);
    const prevEvents = prevSummary[0] ? Number(prevSummary[0][0] ?? 0) : null;
    const prevUsers = prevSummary[0] ? Number(prevSummary[0][1] ?? 0) : null;
    const prevPageviews = prevSummary[0] ? Number(prevSummary[0][2] ?? 0) : null;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const completenessStatus = totalEvents === 0 ? "connected_no_events" : "connected_and_reporting";
    const statusDetail = totalEvents === 0 ? `Connected to PostHog project "${activeProj.name}", but zero events were recorded between ${s} and ${e}.` : `Reporting ${totalEvents.toLocaleString()} events across ${uniqueUsers.toLocaleString()} unique distinct users in "${activeProj.name}".`;
    const mkProv = (definition) => ({
      provider: "posthog",
      providerLabel: getProviderLabel("posthog"),
      projectOrProperty: activeProj.name,
      reportingPeriod: { startDate: s, endDate: e },
      retrievedAt: nowIso,
      definition,
      attributionMethod: "Direct",
      completenessStatus
    });
    const snapshot = {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "posthog",
      providerLabel: getProviderLabel("posthog"),
      projectOrProperty: activeProj.name,
      periodKey: rangeSpec.periodKey,
      startDate: s,
      endDate: e,
      completenessStatus,
      statusDetail,
      metrics: [
        {
          key: "unique_users",
          label: "PostHog Unique Users",
          value: uniqueUsers,
          previousValue: prevUsers,
          growthPct: safeGrowthPct(uniqueUsers, prevUsers),
          unit: "count",
          provenance: mkProv("Distinct `distinct_id` count across all captured PostHog events.")
        },
        {
          key: "pageviews",
          label: "Pageviews ($pageview)",
          value: pageviews,
          previousValue: prevPageviews,
          growthPct: safeGrowthPct(pageviews, prevPageviews),
          unit: "count",
          provenance: mkProv("Count of `$pageview` events ingested by PostHog.")
        },
        {
          key: "total_events",
          label: "Total Product Events",
          value: totalEvents,
          previousValue: prevEvents,
          growthPct: safeGrowthPct(totalEvents, prevEvents),
          unit: "count",
          provenance: mkProv("All captured PostHog events in selected window.")
        }
      ],
      timeSeries: dailyRows.map((row) => ({
        date: String(row[0] || ""),
        unique_users: Number(row[1] ?? 0),
        total_events: Number(row[2] ?? 0),
        pageviews: Number(row[3] ?? 0)
      })),
      topPagesOrEvents: topPagesRows.map((row) => ({
        name: String(row[0] || "/"),
        count: Number(row[1] ?? 0),
        detail: "PostHog $pathname"
      })),
      channels: utmRows.map((row) => ({
        channel: String(row[0] || "Direct / None"),
        users: Number(row[1] ?? 0),
        sessionsOrVisits: Number(row[2] ?? 0),
        conversions: null,
        attributionMethod: "Direct"
      })),
      retrievedAt: nowIso
    };
    return {
      connPatch: {
        status: "connected",
        hostUrl: host,
        discoveredProjects: projects,
        selectedProjectId: activeProj.id,
        selectedProjectName: activeProj.name,
        completenessStatus,
        statusDetail,
        lastSyncedAt: nowIso,
        lastError: void 0
      },
      snapshot
    };
  } catch (err) {
    const status = err?.status;
    const msg = err instanceof Error ? err.message : String(err);
    const comp = status === 401 || status === 403 ? "permission_restricted" : "sync_failed";
    const snapshot = {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "posthog",
      providerLabel: getProviderLabel("posthog"),
      projectOrProperty: activeProj.name,
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: comp,
      statusDetail: msg,
      metrics: [],
      timeSeries: [],
      topPagesOrEvents: [],
      channels: [],
      retrievedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return {
      connPatch: {
        status: "error",
        hostUrl: host,
        discoveredProjects: projects,
        selectedProjectId: activeProj.id,
        selectedProjectName: activeProj.name,
        completenessStatus: comp,
        statusDetail: msg,
        lastError: msg
      },
      snapshot
    };
  }
}
async function syncSupabase(conn, creds, rangeSpec) {
  const projectUrl = normalizeHost(conn.hostUrl || String(creds.projectUrl || ""));
  const apiKey = String(creds.apiKey || "").trim();
  if (!projectUrl || !apiKey) {
    throw new Error("Supabase Project URL and API Key are required.");
  }
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json"
  };
  const schemaResp = await fetch(`${projectUrl}/rest/v1/`, {
    headers,
    signal: AbortSignal.timeout(12e3)
  });
  if (schemaResp.status === 401 || schemaResp.status === 403) {
    const detail2 = `Supabase REST API returned HTTP ${schemaResp.status}. Check your API key or PostgREST schema permissions.`;
    return {
      connPatch: {
        status: "error",
        completenessStatus: "permission_restricted",
        statusDetail: detail2,
        lastError: detail2
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "supabase",
        providerLabel: getProviderLabel("supabase"),
        projectOrProperty: projectUrl,
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "permission_restricted",
        statusDetail: detail2,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  }
  if (!schemaResp.ok) {
    throw new Error(`Supabase schema discovery failed (HTTP ${schemaResp.status}).`);
  }
  const swagger = await schemaResp.json().catch(() => ({}));
  const discoveredTables = Object.entries(swagger.definitions || {}).map(([name, def]) => ({
    name,
    columns: Object.keys(def.properties || {})
  }));
  const mappings = conn.tableMappings || {};
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  if (!mappings.usersTable && !mappings.eventsTable) {
    const detail2 = `Connected to Supabase (${discoveredTables.length} exposed table${discoveredTables.length === 1 ? "" : "s"} discovered). Map your user/event tables to activate verified counts.`;
    return {
      connPatch: {
        status: "connected",
        hostUrl: projectUrl,
        selectedProjectName: new URL(projectUrl).hostname,
        discoveredTables,
        completenessStatus: "connected_no_events",
        statusDetail: detail2,
        lastSyncedAt: nowIso,
        lastError: void 0
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "supabase",
        providerLabel: getProviderLabel("supabase"),
        projectOrProperty: new URL(projectUrl).hostname,
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "connected_no_events",
        statusDetail: detail2,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso
      }
    };
  }
  const queryExactCount = async (table, filterQuery = "") => {
    const sep = filterQuery ? `?${filterQuery}` : "";
    const r = await fetch(`${projectUrl}/rest/v1/${encodeURIComponent(table)}${sep}`, {
      method: "HEAD",
      headers: { ...headers, Prefer: "count=exact" },
      signal: AbortSignal.timeout(1e4)
    });
    if (!r.ok) return null;
    const rangeHdr = r.headers.get("content-range") || "";
    const totalPart = rangeHdr.split("/")[1];
    const num = Number(totalPart);
    return Number.isFinite(num) ? num : null;
  };
  const metrics = [];
  const timeSeriesMap = /* @__PURE__ */ new Map();
  if (mappings.usersTable) {
    const totalUsers = await queryExactCount(mappings.usersTable);
    let rangeSignups = null;
    let prevSignups = null;
    if (mappings.createdAtCol) {
      const col = encodeURIComponent(mappings.createdAtCol);
      rangeSignups = await queryExactCount(
        mappings.usersTable,
        `and=(${col}.gte.${rangeSpec.startDate}T00:00:00Z,${col}.lte.${rangeSpec.endDate}T23:59:59Z)`
      );
      prevSignups = await queryExactCount(
        mappings.usersTable,
        `and=(${col}.gte.${rangeSpec.prevStartDate}T00:00:00Z,${col}.lte.${rangeSpec.prevEndDate}T23:59:59Z)`
      );
      const rowsResp = await fetch(
        `${projectUrl}/rest/v1/${encodeURIComponent(mappings.usersTable)}?select=${col}&and=(${col}.gte.${rangeSpec.startDate}T00:00:00Z,${col}.lte.${rangeSpec.endDate}T23:59:59Z)&limit=1000`,
        { headers, signal: AbortSignal.timeout(1e4) }
      );
      if (rowsResp.ok) {
        const rows = await rowsResp.json().catch(() => []);
        for (const r of rows) {
          const val = String(r[mappings.createdAtCol] || "").slice(0, 10);
          if (val) {
            const cur = timeSeriesMap.get(val) || { date: val, signups: 0 };
            cur.signups += 1;
            timeSeriesMap.set(val, cur);
          }
        }
      }
    }
    const baseProv = {
      provider: "supabase",
      providerLabel: getProviderLabel("supabase"),
      projectOrProperty: `${new URL(projectUrl).hostname} (${mappings.usersTable})`,
      reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
      retrievedAt: nowIso,
      attributionMethod: "Direct",
      completenessStatus: "connected_and_reporting"
    };
    if (totalUsers !== null) {
      metrics.push({
        key: "supabase_total_rows",
        label: `Total Rows (${mappings.usersTable})`,
        value: totalUsers,
        previousValue: null,
        growthPct: null,
        unit: "count",
        provenance: {
          ...baseProv,
          definition: `PostgREST exact count on table "${mappings.usersTable}".`
        }
      });
    }
    if (rangeSignups !== null) {
      metrics.push({
        key: "supabase_period_signups",
        label: `New Records in Period`,
        value: rangeSignups,
        previousValue: prevSignups,
        growthPct: safeGrowthPct(rangeSignups, prevSignups),
        unit: "count",
        provenance: {
          ...baseProv,
          definition: `Records in "${mappings.usersTable}" where "${mappings.createdAtCol}" falls in reporting range.`
        }
      });
    }
  }
  if (mappings.eventsTable) {
    const eventsCount = await queryExactCount(mappings.eventsTable);
    if (eventsCount !== null) {
      metrics.push({
        key: "supabase_events_total",
        label: `Events (${mappings.eventsTable})`,
        value: eventsCount,
        previousValue: null,
        growthPct: null,
        unit: "count",
        provenance: {
          provider: "supabase",
          providerLabel: getProviderLabel("supabase"),
          projectOrProperty: `${new URL(projectUrl).hostname} (${mappings.eventsTable})`,
          reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
          retrievedAt: nowIso,
          definition: `PostgREST exact count on mapped events table "${mappings.eventsTable}".`,
          attributionMethod: "Direct",
          completenessStatus: "connected_and_reporting"
        }
      });
    }
  }
  const timeSeries = Array.from(timeSeriesMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const completeness = metrics.length > 0 ? "connected_and_reporting" : "permission_restricted";
  const detail = metrics.length > 0 ? `Verified Supabase metrics retrieved from ${mappings.usersTable || mappings.eventsTable}.` : "Supabase connected, but mapped tables returned permission restriction (check RLS/API key).";
  return {
    connPatch: {
      status: "connected",
      hostUrl: projectUrl,
      selectedProjectName: new URL(projectUrl).hostname,
      discoveredTables,
      completenessStatus: completeness,
      statusDetail: detail,
      lastSyncedAt: nowIso,
      lastError: void 0
    },
    snapshot: {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "supabase",
      providerLabel: getProviderLabel("supabase"),
      projectOrProperty: new URL(projectUrl).hostname,
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: completeness,
      statusDetail: detail,
      metrics,
      timeSeries,
      topPagesOrEvents: [],
      channels: [],
      retrievedAt: nowIso
    }
  };
}
async function syncFirebaseDirect(conn, creds, rangeSpec) {
  const projectId = String(conn.selectedProjectId || creds.projectId || "").trim();
  if (!projectId) {
    throw new Error("Firebase Project ID is required.");
  }
  let bearerToken = String(creds.oauthAccessToken || "").trim();
  if (!bearerToken && creds.serviceAccountJson) {
    bearerToken = await getGoogleAccessTokenFromServiceAccount(
      String(creds.serviceAccountJson),
      [
        "https://www.googleapis.com/auth/cloud-platform.read-only",
        "https://www.googleapis.com/auth/datastore",
        "https://www.googleapis.com/auth/identitytoolkit"
      ]
    );
  }
  if (!bearerToken) {
    throw new Error("Provide a Firebase Service Account JSON or authorize Google Cloud OAuth access.");
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const metrics = [];
  const timeSeriesMap = /* @__PURE__ */ new Map();
  const topPagesOrEvents = [];
  let permissionNotes = [];
  try {
    const authResp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ returnUserInfo: true, limit: "500" }),
        signal: AbortSignal.timeout(12e3)
      }
    );
    if (authResp.ok) {
      const authData = await authResp.json().catch(() => ({}));
      const users = authData.userInfo || [];
      const totalAuthUsers = Number(authData.recordsCount ?? users.length);
      const verifiedUsers = users.filter((u) => u.emailVerified).length;
      const sMs = (/* @__PURE__ */ new Date(`${rangeSpec.startDate}T00:00:00Z`)).getTime();
      const eMs = (/* @__PURE__ */ new Date(`${rangeSpec.endDate}T23:59:59Z`)).getTime();
      const psMs = (/* @__PURE__ */ new Date(`${rangeSpec.prevStartDate}T00:00:00Z`)).getTime();
      const peMs = (/* @__PURE__ */ new Date(`${rangeSpec.prevEndDate}T23:59:59Z`)).getTime();
      let periodSignups = 0;
      let prevSignups = 0;
      for (const u of users) {
        const createdMs = Number(u.createdAt || 0);
        if (!createdMs) continue;
        if (createdMs >= sMs && createdMs <= eMs) {
          periodSignups++;
          const day = new Date(createdMs).toISOString().slice(0, 10);
          const cur = timeSeriesMap.get(day) || { date: day, auth_signups: 0 };
          cur.auth_signups += 1;
          timeSeriesMap.set(day, cur);
        } else if (createdMs >= psMs && createdMs <= peMs) {
          prevSignups++;
        }
      }
      const prov = {
        provider: "firebase",
        providerLabel: getProviderLabel("firebase"),
        projectOrProperty: projectId,
        reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
        retrievedAt: nowIso,
        attributionMethod: "Direct",
        completenessStatus: "connected_and_reporting",
        limitations: "Firebase Auth accounts represent registered accounts\u2014never web visitors or GA4 analytics events."
      };
      metrics.push(
        {
          key: "firebase_auth_accounts",
          label: "Firebase Registered Accounts",
          value: totalAuthUsers,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: { ...prov, definition: "Total Firebase Authentication accounts returned by Identity Toolkit." }
        },
        {
          key: "firebase_period_signups",
          label: "New Auth Signups (Period)",
          value: periodSignups,
          previousValue: prevSignups,
          growthPct: safeGrowthPct(periodSignups, prevSignups),
          unit: "count",
          provenance: { ...prov, definition: "Auth accounts created within reporting date range (up to first 500 queried)." }
        },
        {
          key: "firebase_verified_accounts",
          label: "Email-Verified Accounts",
          value: verifiedUsers,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: { ...prov, definition: "Accounts with `emailVerified === true`." }
        }
      );
    } else if (authResp.status === 401 || authResp.status === 403) {
      permissionNotes.push(`Identity Toolkit returned HTTP ${authResp.status} (missing firebaseauth.users.get permission).`);
    }
  } catch (e) {
    permissionNotes.push(e instanceof Error ? e.message : String(e));
  }
  try {
    const colResp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:listCollectionIds`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pageSize: 20 }),
        signal: AbortSignal.timeout(1e4)
      }
    );
    if (colResp.ok) {
      const colData = await colResp.json().catch(() => ({}));
      for (const col of colData.collectionIds || []) {
        topPagesOrEvents.push({ name: `firestore/${col}`, count: 1, detail: "Discovered Firestore collection" });
      }
    }
  } catch {
  }
  const completeness = metrics.length > 0 ? "connected_and_reporting" : permissionNotes.length > 0 ? "permission_restricted" : "connected_no_events";
  const statusDetail = metrics.length > 0 ? `Connected to Firebase project "${projectId}". Firebase Analytics behavioral events come via GA4 Property connection.` : permissionNotes[0] || `Connected to Firebase project "${projectId}", no metrics returned.`;
  return {
    connPatch: {
      status: metrics.length > 0 ? "connected" : "error",
      selectedProjectId: projectId,
      selectedProjectName: projectId,
      completenessStatus: completeness,
      statusDetail,
      lastSyncedAt: nowIso,
      lastError: metrics.length > 0 ? void 0 : statusDetail
    },
    snapshot: {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "firebase",
      providerLabel: getProviderLabel("firebase"),
      projectOrProperty: projectId,
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: completeness,
      statusDetail,
      metrics,
      timeSeries: Array.from(timeSeriesMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      topPagesOrEvents,
      channels: [],
      retrievedAt: nowIso
    }
  };
}
async function syncGa4(conn, creds, rangeSpec) {
  let token = String(creds.oauthAccessToken || "").trim();
  if (!token && creds.serviceAccountJson) {
    token = await getGoogleAccessTokenFromServiceAccount(String(creds.serviceAccountJson), [
      "https://www.googleapis.com/auth/analytics.readonly"
    ]);
  }
  if (!token) {
    throw new Error("GA4 requires a Google OAuth token (analytics.readonly) or Service Account JSON.");
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const sumResp = await fetch(
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=20",
    { headers, signal: AbortSignal.timeout(12e3) }
  );
  const discoveredProjects = [];
  if (sumResp.ok) {
    const sumJson = await sumResp.json().catch(() => ({}));
    for (const acct of sumJson.accountSummaries || []) {
      for (const prop of acct.propertySummaries || []) {
        if (prop.property) {
          discoveredProjects.push({
            id: prop.property.replace(/^properties\//, ""),
            name: prop.displayName || prop.property
          });
        }
      }
    }
  } else if (sumResp.status === 401 || sumResp.status === 403) {
    const detail2 = `GA4 Admin API returned HTTP ${sumResp.status}. Grant Google Analytics Read-Only permission.`;
    return {
      connPatch: {
        status: "error",
        completenessStatus: "permission_restricted",
        statusDetail: detail2,
        lastError: detail2
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "ga4",
        providerLabel: getProviderLabel("ga4"),
        projectOrProperty: conn.selectedProjectName || "GA4 Property",
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "permission_restricted",
        statusDetail: detail2,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso
      }
    };
  }
  const activePropId = (conn.selectedProjectId || discoveredProjects[0]?.id || "").replace(/^properties\//, "");
  const activePropName = discoveredProjects.find((p) => p.id === activePropId)?.name || conn.selectedProjectName || (activePropId ? `GA4 Property ${activePropId}` : "No GA4 Property Selected");
  if (!activePropId) {
    const detail2 = "Connected Google account, but no GA4 property ID found.";
    return {
      connPatch: {
        status: "connected",
        discoveredProjects,
        completenessStatus: "connected_no_events",
        statusDetail: detail2,
        lastSyncedAt: nowIso
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "ga4",
        providerLabel: getProviderLabel("ga4"),
        projectOrProperty: activePropName,
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "connected_no_events",
        statusDetail: detail2,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso
      }
    };
  }
  const runReport = async (body) => {
    const r = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(activePropId)}:runReport`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15e3)
      }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(j.error?.message || `GA4 Data API HTTP ${r.status}`);
    }
    return j.rows || [];
  };
  const [dailyRows, prevSummaryRows, channelRows, pageRows] = await Promise.all([
    runReport({
      dateRanges: [{ startDate: rangeSpec.startDate, endDate: rangeSpec.endDate }],
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "conversions" }
      ],
      orderBys: [{ dimension: { dimensionName: "date" } }]
    }),
    runReport({
      dateRanges: [{ startDate: rangeSpec.prevStartDate, endDate: rangeSpec.prevEndDate }],
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "conversions" }
      ]
    }),
    runReport({
      dateRanges: [{ startDate: rangeSpec.startDate, endDate: rangeSpec.endDate }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "conversions" }],
      limit: 10
    }),
    runReport({
      dateRanges: [{ startDate: rangeSpec.startDate, endDate: rangeSpec.endDate }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      limit: 10
    })
  ]);
  let activeUsers = 0;
  let sessions = 0;
  let pageViews = 0;
  let conversions = 0;
  const timeSeries = dailyRows.map((row) => {
    const rawDate = row.dimensionValues?.[0]?.value || "";
    const isoDate = rawDate.length === 8 ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : rawDate;
    const u = Number(row.metricValues?.[0]?.value || 0);
    const s = Number(row.metricValues?.[1]?.value || 0);
    const pv = Number(row.metricValues?.[2]?.value || 0);
    const c = Number(row.metricValues?.[3]?.value || 0);
    activeUsers += u;
    sessions += s;
    pageViews += pv;
    conversions += c;
    return { date: isoDate, active_users: u, sessions: s, pageviews: pv, conversions: c };
  });
  const prevRow = prevSummaryRows[0];
  const prevUsers = prevRow ? Number(prevRow.metricValues?.[0]?.value || 0) : null;
  const prevSessions = prevRow ? Number(prevRow.metricValues?.[1]?.value || 0) : null;
  const prevPageViews = prevRow ? Number(prevRow.metricValues?.[2]?.value || 0) : null;
  const prevConversions = prevRow ? Number(prevRow.metricValues?.[3]?.value || 0) : null;
  const completeness = sessions === 0 && pageViews === 0 ? "connected_no_events" : "connected_and_reporting";
  const detail = completeness === "connected_no_events" ? `GA4 property "${activePropName}" connected, zero traffic recorded in period.` : `GA4 reporting ${sessions.toLocaleString()} sessions and ${pageViews.toLocaleString()} pageviews.`;
  const mkProv = (definition) => ({
    provider: "ga4",
    providerLabel: getProviderLabel("ga4"),
    projectOrProperty: activePropName,
    reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
    retrievedAt: nowIso,
    definition,
    attributionMethod: "Provider-Attributed",
    completenessStatus: completeness
  });
  return {
    connPatch: {
      status: "connected",
      discoveredProjects,
      selectedProjectId: activePropId,
      selectedProjectName: activePropName,
      completenessStatus: completeness,
      statusDetail: detail,
      lastSyncedAt: nowIso,
      lastError: void 0
    },
    snapshot: {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "ga4",
      providerLabel: getProviderLabel("ga4"),
      projectOrProperty: activePropName,
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: completeness,
      statusDetail: detail,
      metrics: [
        {
          key: "ga4_sessions",
          label: "GA4 Sessions",
          value: sessions,
          previousValue: prevSessions,
          growthPct: safeGrowthPct(sessions, prevSessions),
          unit: "count",
          provenance: mkProv("GA4 `sessions` metric over selected reporting period.")
        },
        {
          key: "ga4_active_users",
          label: "GA4 Active Users (Sum Daily)",
          value: activeUsers,
          previousValue: prevUsers,
          growthPct: safeGrowthPct(activeUsers, prevUsers),
          unit: "count",
          provenance: mkProv("GA4 `activeUsers` summed across selected days.")
        },
        {
          key: "ga4_pageviews",
          label: "GA4 Screen Page Views",
          value: pageViews,
          previousValue: prevPageViews,
          growthPct: safeGrowthPct(pageViews, prevPageViews),
          unit: "count",
          provenance: mkProv("GA4 `screenPageViews` metric.")
        },
        {
          key: "ga4_conversions",
          label: "GA4 Key Events / Conversions",
          value: conversions,
          previousValue: prevConversions,
          growthPct: safeGrowthPct(conversions, prevConversions),
          unit: "count",
          provenance: mkProv("GA4 `conversions` key events count.")
        }
      ],
      timeSeries,
      topPagesOrEvents: pageRows.map((r) => ({
        name: r.dimensionValues?.[0]?.value || "/",
        count: Number(r.metricValues?.[0]?.value || 0),
        detail: "GA4 pagePath"
      })),
      channels: channelRows.map((r) => ({
        channel: r.dimensionValues?.[0]?.value || "Unassigned",
        sessionsOrVisits: Number(r.metricValues?.[0]?.value || 0),
        users: Number(r.metricValues?.[1]?.value || 0),
        conversions: Number(r.metricValues?.[2]?.value || 0),
        attributionMethod: "Provider-Attributed"
      })),
      retrievedAt: nowIso
    }
  };
}
async function syncGooglePlay(conn, creds, rangeSpec) {
  const packageName = String(conn.selectedProjectId || creds.packageName || "").trim();
  if (!packageName) {
    throw new Error("Android Package Name (e.g. com.company.app) is required.");
  }
  let token = String(creds.oauthAccessToken || "").trim();
  if (!token && creds.serviceAccountJson) {
    token = await getGoogleAccessTokenFromServiceAccount(String(creds.serviceAccountJson), [
      "https://www.googleapis.com/auth/androidpublisher",
      "https://www.googleapis.com/auth/playdeveloperreporting"
    ]);
  }
  if (!token) {
    throw new Error("Google Play Console requires a Service Account JSON or Google OAuth token.");
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const revResp = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/reviews?maxResults=25`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12e3)
    }
  );
  if (revResp.status === 401 || revResp.status === 403 || revResp.status === 404) {
    const detail2 = `Google Play API returned HTTP ${revResp.status} for "${packageName}". Confirm Play Console API access & service account permissions. Bulk install history requires Play GCS export or Play Developer Reporting API.`;
    return {
      connPatch: {
        status: "error",
        selectedProjectId: packageName,
        selectedProjectName: packageName,
        completenessStatus: "permission_restricted",
        statusDetail: detail2,
        lastError: detail2
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "google_play",
        providerLabel: getProviderLabel("google_play"),
        projectOrProperty: packageName,
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "permission_restricted",
        statusDetail: detail2,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso
      }
    };
  }
  const revJson = await revResp.json().catch(() => ({}));
  const reviews = revJson.reviews || [];
  const ratings = reviews.map((r) => r.comments?.[0]?.userComment?.starRating).filter((n) => typeof n === "number");
  const avgRating = ratings.length > 0 ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length * 100) / 100 : null;
  const detail = `Connected to Play Console package "${packageName}". Showing live reviews (${reviews.length} recent). Store install/revenue exports require Play GCS bucket sync.`;
  return {
    connPatch: {
      status: "connected",
      selectedProjectId: packageName,
      selectedProjectName: packageName,
      completenessStatus: "connected_and_reporting",
      statusDetail: detail,
      lastSyncedAt: nowIso,
      lastError: void 0
    },
    snapshot: {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "google_play",
      providerLabel: getProviderLabel("google_play"),
      projectOrProperty: packageName,
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: "connected_and_reporting",
      statusDetail: detail,
      metrics: [
        {
          key: "play_recent_reviews",
          label: "Recent Play Reviews",
          value: reviews.length,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: {
            provider: "google_play",
            providerLabel: getProviderLabel("google_play"),
            projectOrProperty: packageName,
            reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
            retrievedAt: nowIso,
            definition: "Recent reviews fetched via Android Publisher v3 API (last 7 days / max 25).",
            attributionMethod: "Direct",
            completenessStatus: "connected_and_reporting",
            limitations: "Historical install/revenue time-series require Google Play Cloud Storage export."
          }
        },
        {
          key: "play_avg_recent_rating",
          label: "Avg Recent Rating",
          value: avgRating,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: {
            provider: "google_play",
            providerLabel: getProviderLabel("google_play"),
            projectOrProperty: packageName,
            reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
            retrievedAt: nowIso,
            definition: "Average star rating across retrieved recent Play reviews.",
            attributionMethod: "Direct",
            completenessStatus: "connected_and_reporting"
          }
        }
      ],
      timeSeries: [],
      topPagesOrEvents: [],
      channels: [],
      retrievedAt: nowIso
    }
  };
}
async function syncGscViaComposio(conn, rangeSpec) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  if (!isComposioConfigured()) {
    const detail2 = "Composio is not configured in environment.";
    return {
      connPatch: { status: "error", completenessStatus: "not_connected", statusDetail: detail2 },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "gsc",
        providerLabel: getProviderLabel("gsc"),
        projectOrProperty: "Search Console",
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "not_connected",
        statusDetail: detail2,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso
      }
    };
  }
  const { statuses } = await listComposioConnections(["google_search_console"], conn.workspaceId);
  const gscAccount = statuses.google_search_console?.accounts.find((a) => a.status === "active");
  if (!gscAccount) {
    const detail2 = "Google Search Console is not authorized in Composio Connect yet.";
    return {
      connPatch: { status: "disconnected", completenessStatus: "not_connected", statusDetail: detail2 },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "gsc",
        providerLabel: getProviderLabel("gsc"),
        projectOrProperty: "Search Console",
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "not_connected",
        statusDetail: detail2,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso
      }
    };
  }
  const sitesResult = await executeComposioTool({
    toolkit: "google_search_console",
    toolSlug: "GOOGLE_SEARCH_CONSOLE_LIST_SITES",
    arguments: {},
    accountId: gscAccount.id,
    workspaceId: conn.workspaceId,
    userId: conn.ownerUid
  });
  const sites = Array.isArray(sitesResult.data?.siteEntry) ? sitesResult.data.siteEntry : [];
  const siteUrl = conn.selectedProjectId || sites[0]?.siteUrl || "";
  if (!siteUrl) {
    const detail2 = "Authorized Search Console, but no verified site property was found.";
    return {
      connPatch: {
        status: "connected",
        completenessStatus: "connected_no_events",
        statusDetail: detail2,
        lastSyncedAt: nowIso
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: "gsc",
        providerLabel: getProviderLabel("gsc"),
        projectOrProperty: "No verified site",
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "connected_no_events",
        statusDetail: detail2,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: nowIso
      }
    };
  }
  const analyticsRes = await executeComposioTool({
    toolkit: "google_search_console",
    toolSlug: "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
    arguments: {
      siteUrl,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      dimensions: ["date"],
      rowLimit: 90
    },
    accountId: gscAccount.id,
    workspaceId: conn.workspaceId,
    userId: conn.ownerUid
  });
  const rows = Array.isArray(analyticsRes.data?.rows) ? analyticsRes.data.rows : [];
  const totalClicks = rows.reduce((s, r) => s + Number(r.clicks || 0), 0);
  const totalImpressions = rows.reduce((s, r) => s + Number(r.impressions || 0), 0);
  const avgPos = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + Number(r.position || 0), 0) / rows.length * 10) / 10 : null;
  const completeness = rows.length > 0 ? "connected_and_reporting" : "connected_no_events";
  const detail = rows.length > 0 ? `Reporting ${totalClicks.toLocaleString()} organic clicks & ${totalImpressions.toLocaleString()} impressions for ${siteUrl}.` : `Connected to ${siteUrl}; zero Search Console impressions in range.`;
  return {
    connPatch: {
      status: "connected",
      selectedProjectId: siteUrl,
      selectedProjectName: siteUrl,
      discoveredProjects: sites.filter((s) => s.siteUrl).map((s) => ({ id: s.siteUrl, name: s.siteUrl })),
      completenessStatus: completeness,
      statusDetail: detail,
      lastSyncedAt: nowIso
    },
    snapshot: {
      workspaceId: conn.workspaceId,
      ownerUid: conn.ownerUid,
      connectionId: conn.id,
      provider: "gsc",
      providerLabel: getProviderLabel("gsc"),
      projectOrProperty: siteUrl,
      periodKey: rangeSpec.periodKey,
      startDate: rangeSpec.startDate,
      endDate: rangeSpec.endDate,
      completenessStatus: completeness,
      statusDetail: detail,
      metrics: [
        {
          key: "gsc_clicks",
          label: "Organic Clicks",
          value: totalClicks,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: {
            provider: "gsc",
            providerLabel: getProviderLabel("gsc"),
            projectOrProperty: siteUrl,
            reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
            retrievedAt: nowIso,
            definition: "Google Search Console total organic clicks.",
            attributionMethod: "Direct",
            completenessStatus: completeness
          }
        },
        {
          key: "gsc_impressions",
          label: "Search Impressions",
          value: totalImpressions,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: {
            provider: "gsc",
            providerLabel: getProviderLabel("gsc"),
            projectOrProperty: siteUrl,
            reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
            retrievedAt: nowIso,
            definition: "Google Search Console total impressions.",
            attributionMethod: "Direct",
            completenessStatus: completeness
          }
        },
        {
          key: "gsc_avg_position",
          label: "Average SERP Position",
          value: avgPos,
          previousValue: null,
          growthPct: null,
          unit: "count",
          provenance: {
            provider: "gsc",
            providerLabel: getProviderLabel("gsc"),
            projectOrProperty: siteUrl,
            reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
            retrievedAt: nowIso,
            definition: "Mean ranking position across reporting days.",
            attributionMethod: "Direct",
            completenessStatus: completeness
          }
        }
      ],
      timeSeries: rows.map((r) => ({
        date: r.keys?.[0] || "",
        clicks: Number(r.clicks || 0),
        impressions: Number(r.impressions || 0)
      })),
      topPagesOrEvents: [],
      channels: [
        {
          channel: "Google Organic Search",
          sessionsOrVisits: totalClicks,
          users: null,
          conversions: null,
          attributionMethod: "Direct"
        }
      ],
      retrievedAt: nowIso
    }
  };
}
async function testAndSyncProviderConnection(conn, rangeSpec) {
  const creds = decryptCredentialPayload(conn.encryptedCredentials);
  let outcome;
  try {
    switch (conn.provider) {
      case "posthog":
        outcome = await syncPostHog(conn, creds, rangeSpec);
        break;
      case "supabase":
        outcome = await syncSupabase(conn, creds, rangeSpec);
        break;
      case "firebase":
        outcome = await syncFirebaseDirect(conn, creds, rangeSpec);
        break;
      case "ga4":
        outcome = await syncGa4(conn, creds, rangeSpec);
        break;
      case "google_play":
        outcome = await syncGooglePlay(conn, creds, rangeSpec);
        break;
      case "gsc":
        outcome = await syncGscViaComposio(conn, rangeSpec);
        break;
      case "app_store":
        outcome = {
          connPatch: {
            status: "connected",
            completenessStatus: "unsupported",
            statusDetail: "Apple App Store Connect Analytics Reports requires signed .p8 JWT async report generation in App Store Connect. Credentials metadata saved.",
            lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString()
          },
          snapshot: {
            workspaceId: conn.workspaceId,
            ownerUid: conn.ownerUid,
            connectionId: conn.id,
            provider: "app_store",
            providerLabel: getProviderLabel("app_store"),
            projectOrProperty: conn.selectedProjectName || "App Store Connect",
            periodKey: rangeSpec.periodKey,
            startDate: rangeSpec.startDate,
            endDate: rangeSpec.endDate,
            completenessStatus: "unsupported",
            statusDetail: "App Store Connect Analytics API uses async Analytics Report Requests (.p8 private key JWT) rather than synchronous KPI reads.",
            metrics: [],
            timeSeries: [],
            topPagesOrEvents: [],
            channels: [],
            retrievedAt: (/* @__PURE__ */ new Date()).toISOString()
          }
        };
        break;
      default:
        outcome = {
          connPatch: {
            status: "error",
            completenessStatus: "unsupported",
            statusDetail: `Provider "${conn.provider}" requires Composio OAuth or direct read-only adapter setup.`
          },
          snapshot: {
            workspaceId: conn.workspaceId,
            ownerUid: conn.ownerUid,
            connectionId: conn.id,
            provider: conn.provider,
            providerLabel: getProviderLabel(conn.provider),
            projectOrProperty: conn.selectedProjectName || conn.provider,
            periodKey: rangeSpec.periodKey,
            startDate: rangeSpec.startDate,
            endDate: rangeSpec.endDate,
            completenessStatus: "unsupported",
            statusDetail: `Direct pull not yet authorized for ${conn.provider}.`,
            metrics: [],
            timeSeries: [],
            topPagesOrEvents: [],
            channels: [],
            retrievedAt: (/* @__PURE__ */ new Date()).toISOString()
          }
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outcome = {
      connPatch: {
        status: "error",
        completenessStatus: "sync_failed",
        statusDetail: msg,
        lastError: msg
      },
      snapshot: {
        workspaceId: conn.workspaceId,
        ownerUid: conn.ownerUid,
        connectionId: conn.id,
        provider: conn.provider,
        providerLabel: getProviderLabel(conn.provider),
        projectOrProperty: conn.selectedProjectName || conn.provider,
        periodKey: rangeSpec.periodKey,
        startDate: rangeSpec.startDate,
        endDate: rangeSpec.endDate,
        completenessStatus: "sync_failed",
        statusDetail: msg,
        metrics: [],
        timeSeries: [],
        topPagesOrEvents: [],
        channels: [],
        retrievedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  }
  const updatedConn = stateStore.upsertAnalyticsConnection({
    ...conn,
    ...outcome.connPatch,
    id: conn.id,
    workspaceId: conn.workspaceId,
    ownerUid: conn.ownerUid
  });
  const savedSnapshot = stateStore.saveGrowthSnapshot(outcome.snapshot);
  return { connection: updatedConn, snapshot: savedSnapshot };
}
function buildStrategyFeedbackComparison(workspaceId) {
  const strategies = stateStore.listStrategies(workspaceId);
  const activeStrategy = strategies.find((s) => s.status === "active") || strategies[0];
  if (!activeStrategy) return null;
  const snapshots = stateStore.listGrowthSnapshots(workspaceId);
  const comparisons = [];
  for (const pillar of activeStrategy.contentPillars || []) {
    const posthogSnap = snapshots.find((s) => s.provider === "posthog");
    const ga4Snap = snapshots.find((s) => s.provider === "ga4");
    const gscSnap = snapshots.find((s) => s.provider === "gsc");
    const supaSnap = snapshots.find((s) => s.provider === "supabase");
    const fbSnap = snapshots.find((s) => s.provider === "firebase");
    const bestSnap = posthogSnap || ga4Snap || gscSnap || supaSnap || fbSnap;
    const firstMetric = bestSnap?.metrics?.[0];
    comparisons.push({
      pillarOrGoal: pillar.pillar,
      linkedProvider: bestSnap?.providerLabel,
      observedMetric: firstMetric?.label || "No connected metric mapped",
      observedValue: firstMetric?.value !== void 0 && firstMetric?.value !== null ? Number(firstMetric.value).toLocaleString() : "Unavailable",
      assessment: bestSnap ? `Grounded in live ${bestSnap.providerLabel} data (${bestSnap.completenessStatus.replace(/_/g, " ")}).` : "Connect PostHog, GA4, Search Console, or Supabase to track pillar outcome against real metrics."
    });
  }
  const reportingCount = snapshots.filter((s) => s.completenessStatus === "connected_and_reporting").length;
  const goalAlignmentStatus = reportingCount === 0 ? "no_connected_data" : reportingCount >= 2 ? "aligned_data_available" : "partial_data";
  return {
    strategyId: activeStrategy.id,
    strategyTitle: activeStrategy.title,
    northStarMetric: activeStrategy.northStarMetric,
    goalAlignmentStatus,
    summary: reportingCount === 0 ? `Strategy "${activeStrategy.title}" has no live analytics snapshots yet. Connect telemetry in Growth Intelligence to evaluate performance.` : `Evaluating "${activeStrategy.title}" (${activeStrategy.northStarMetric}) against ${reportingCount} live reporting source(s).`,
    comparisons
  };
}

// server/utils/ssrf.ts
import dns from "dns/promises";
import net from "net";
var BLOCKED_HOSTNAMES = /* @__PURE__ */ new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata"
]);
function isPrivateIp(ip) {
  const normalized = ip.toLowerCase().replace(/^::ffff:/, "");
  if (!net.isIP(normalized)) return false;
  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && parts[2] === 2) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe80:") || normalized.startsWith("fec0:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("ff")) return true;
  return false;
}
async function normalizeAndAssertPublicUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Website URL is required.");
  if (trimmed.length > 500) throw new Error("URL exceeds maximum allowed length (500 chars).");
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed;
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
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Private or internal network hostnames cannot be crawled.");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw new Error("Private or loopback IP addresses cannot be crawled.");
    }
    return parsed.toString();
  }
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
    throw new Error(`Unable to resolve public hostname "${host}".`);
  }
  return parsed.toString();
}
async function safePublicFetch(targetUrl, options = {}) {
  let currentUrl = await normalizeAndAssertPublicUrl(targetUrl);
  const timeoutMs = options.timeoutMs ?? 12e3;
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
        headers: options.headers
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

// server/routes/intelligence.ts
var execFileAsync = promisify(execFile);
var router = Router();
function wsCtx(req) {
  return extractWorkspaceContext(req);
}
async function checkUrlExists(url) {
  try {
    const { response } = await safePublicFetch(url, {
      timeoutMs: 4e3,
      method: "GET",
      headers: { "User-Agent": "MarketingOSBot/1.0" }
    });
    return response.ok;
  } catch {
    return false;
  }
}
async function crawlUrl(targetUrl) {
  const safeTarget = await normalizeAndAssertPublicUrl(targetUrl);
  const { response: res, finalUrl, ttfbMs } = await safePublicFetch(safeTarget, {
    timeoutMs: 12e3,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; MarketingOSBot/1.0; +https://marketingos.app)",
      Accept: "text/html,application/xhtml+xml"
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${finalUrl}`);
  }
  const html = await res.text();
  const tracking = detectTrackingTechnologies(html);
  const $ = cheerio2.load(html);
  $("script, style, noscript, svg").remove();
  const title = $("title").first().text().trim();
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || $('meta[property="og:description"]').attr("content")?.trim() || "";
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || "";
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim() || "";
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || "";
  const viewport = $('meta[name="viewport"]').attr("content")?.trim() || "";
  const h1s = $("h1").map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 10);
  const h2s = $("h2").map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 15);
  const jsonLdCount = html.includes("application/ld+json") ? 1 : 0;
  const images = $("img").toArray();
  const imagesMissingAlt = images.filter((el) => !$(el).attr("alt")?.trim()).length;
  const parsedFinal = new URL(finalUrl);
  const links = $("a[href]").map((_, el) => $(el).attr("href") || "").get().filter(Boolean);
  const internalLinks = links.filter(
    (href) => href.startsWith("/") || href.includes(parsedFinal.hostname)
  ).length;
  const origin = parsedFinal.origin;
  const [robotsTxtFound, sitemapXmlFound] = await Promise.all([
    checkUrlExists(`${origin}/robots.txt`),
    checkUrlExists(`${origin}/sitemap.xml`)
  ]);
  const candidateLinks = [];
  for (const href of links) {
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const abs = new URL(href, origin).toString();
      if (/^https?:\/\//i.test(abs) && !candidateLinks.includes(abs)) {
        candidateLinks.push(abs);
      }
      if (candidateLinks.length >= 5) break;
    } catch {
    }
  }
  const brokenLinks = [];
  await Promise.all(
    candidateLinks.map(async (linkUrl) => {
      try {
        const check = await safePublicFetch(linkUrl, { timeoutMs: 4e3, method: "HEAD" });
        if (check.response.status >= 400 && check.response.status !== 405) {
          brokenLinks.push(`${linkUrl} (HTTP ${check.response.status})`);
        }
      } catch {
      }
    })
  );
  const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 8e3);
  return {
    ok: true,
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
    tracking
  };
}
function extractGroundingSources(response) {
  const candidates = response?.candidates;
  const chunks = candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = /* @__PURE__ */ new Set();
  const sources = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ title: chunk.web?.title || uri, url: uri });
    }
  }
  return sources.slice(0, 8);
}
async function executeBusinessIntelligenceAnalysis(params) {
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
    model
  } = params.input;
  params.onStageProgress?.("Validating & normalizing website URL", 15);
  const target = await normalizeAndAssertPublicUrl(String(websiteUrl || ""));
  params.onStageProgress?.("Crawling public website & metadata", 35);
  let crawled = null;
  let crawlError = "";
  try {
    crawled = await crawlUrl(target);
  } catch (err) {
    crawlError = err instanceof Error ? err.message : String(err);
  }
  const partialCrawl = crawled ? {
    url: crawled.url,
    title: crawled.title,
    metaDescription: crawled.metaDescription,
    h1s: crawled.h1s,
    h2s: crawled.h2s,
    wordCount: crawled.wordCount,
    internalLinks: crawled.internalLinks
  } : null;
  params.onStageProgress?.("Running Gemini Business Intelligence extraction", 65, {
    crawled: partialCrawl,
    crawlError: crawlError || void 0
  });
  const ai = getGeminiClient();
  const selectedModel = resolveTextModel(typeof model === "string" ? model : void 0);
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

${crawled ? `Live Crawled Website Snapshot:
- Title: ${crawled.title}
- Meta Description: ${crawled.metaDescription}
- H1 Headings: ${crawled.h1s.join(" | ")}
- H2 Headings: ${crawled.h2s.join(" | ")}
- Word Count (excerpt): ${crawled.wordCount}
- Content Excerpt: ${crawled.bodyExcerpt}` : `Direct HTML crawl encountered (${crawlError}). Use Google Search grounding for ${target} and the user description.`}

Return a strict JSON object matching the schema.`;
  const response = await runTrackedAiCall(
    {
      workspaceId: params.workspaceId,
      actorUid: params.actorUid,
      endpoint: "/api/analyze-website",
      agent: "Business Intelligence Analyzer",
      model: selectedModel,
      creditsEstimated: 80
    },
    () => ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: "You are a senior brand strategist and marketing intelligence analyst. Base claims on crawled facts and provided inputs; never invent fake metrics.",
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        ...crawled ? {} : { tools: [{ googleSearch: {} }] },
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
              items: { type: Type.STRING }
            },
            competitorNames: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            contentFormats: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        }
      }
    })
  );
  const parsed = parseJsonSafe(response.text);
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
        content: `${String(parsed.positioning || "")} \u2014 Value Prop: ${String(parsed.valueProposition || "")}`,
        tags: ["positioning", "onboarding"]
      });
    }
  }
  const connectedProviders = params.workspaceId ? stateStore.listAnalyticsConnections(params.workspaceId).filter((c) => c.status === "connected").map((c) => c.provider) : [];
  const integrationRecommendations = buildIntegrationRecommendations({
    products: Array.isArray(products) ? products.map(String) : [],
    channels: Array.isArray(channels) ? channels.map(String) : [],
    websiteUrl: target,
    tracking: crawled?.tracking || null,
    connectedProviders
  });
  if (params.workspaceId) {
    stateStore.setIntegrationRecommendations(
      params.workspaceId,
      integrationRecommendations
    );
  }
  return {
    sourceType: crawled ? "live_crawl" : "ai_grounded",
    model: selectedModel,
    crawled: partialCrawl,
    crawlError: crawlError || void 0,
    tracking: crawled?.tracking || null,
    integrationRecommendations,
    intelligence: parsed,
    sources
  };
}
router.post("/analyze-website", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const result = await executeBusinessIntelligenceAnalysis({
      input: req.body,
      workspaceId: ctx.workspaceId,
      actorUid: ctx.actorUid
    });
    res.json(result);
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router.post("/research/competitors", async (req, res) => {
  try {
    const { business, market = "Global", focusQuery = "", model } = req.body;
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
        systemInstruction: "You are a competitive intelligence researcher. Use Google Search to find real competing products and companies. Output strictly valid JSON.",
        tools: [{ googleSearch: {} }],
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json"
      }
    });
    const data = parseJsonSafe(response.text);
    const sources = extractGroundingSources(response);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data,
      sources
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router.post("/research/influencers", async (req, res) => {
  try {
    const { business, platform = "All", nicheQuery = "", country = "Global", model } = req.body;
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const prompt = `Find 4 to 6 real, publicly active content creators / influencers who align with this business.
${buildBusinessContextPrompt(business)}
Platform focus: ${platform}
Country/Region: ${country}
Niche search: ${nicheQuery || "Core industry creators and educators"}

Important accuracy rules:
- Use Google Search to identify real creators and their public handles/channels.
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
      "profileUrl": "string"
    }
  ]
}`;
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: "You are a creator partnerships strategist. Use Google Search grounding to recommend real creators. Return strictly valid JSON.",
        tools: [{ googleSearch: {} }],
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json"
      }
    });
    const data = parseJsonSafe(response.text);
    const sources = extractGroundingSources(response);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data,
      sources
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router.post("/research/trends", async (req, res) => {
  try {
    const { business, topic = "", timeframe = "Last 30 days", model } = req.body;
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
      "signalSummary": "string (grounded trend signal, no fake guaranteed views)",
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
        systemInstruction: "You are a creative strategist analyzing real social video patterns and industry conversations. Output strictly valid JSON.",
        tools: [{ googleSearch: {} }],
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json"
      }
    });
    const data = parseJsonSafe(response.text);
    const sources = extractGroundingSources(response);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data,
      sources
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
async function executeSeoAuditAnalysis(params) {
  const target = await normalizeAndAssertPublicUrl(String(params.websiteUrl || params.business?.websiteUrl || ""));
  let crawled = null;
  let crawlError = "";
  try {
    crawled = await crawlUrl(target);
  } catch (err) {
    crawlError = err instanceof Error ? err.message : String(err);
  }
  const technicalChecks = crawled ? [
    {
      title: "Title tag length & presence",
      severity: !crawled.title ? "High" : crawled.title.length < 25 || crawled.title.length > 65 ? "Medium" : "Low",
      passed: Boolean(crawled.title) && crawled.title.length >= 25 && crawled.title.length <= 65,
      why: crawled.title ? `Detected title (${crawled.title.length} chars): "${crawled.title}"` : "No <title> tag detected on homepage.",
      fix: "Keep <title> between 45\u201360 characters with primary commercial intent keywords."
    },
    {
      title: "Meta description coverage",
      severity: !crawled.metaDescription ? "High" : "Low",
      passed: Boolean(crawled.metaDescription),
      why: crawled.metaDescription ? `Meta description found (${crawled.metaDescription.length} chars).` : "Missing <meta name='description'> reduces SERP click-through clarity.",
      fix: "Write a compelling 135\u2013155 character summary explaining value proposition and CTA."
    },
    {
      title: "Robots.txt & XML Sitemap discovery",
      severity: !crawled.robotsTxtFound || !crawled.sitemapXmlFound ? "Medium" : "Low",
      passed: crawled.robotsTxtFound && crawled.sitemapXmlFound,
      why: `robots.txt: ${crawled.robotsTxtFound ? "found" : "missing"}, sitemap.xml: ${crawled.sitemapXmlFound ? "found" : "missing"}, TTFB: ${crawled.ttfbMs}ms.`,
      fix: "Publish valid /robots.txt and /sitemap.xml and link the sitemap inside Search Console."
    },
    {
      title: "Structured JSON-LD schema & Canonical tag",
      severity: crawled.jsonLdCount === 0 ? "High" : !crawled.canonical ? "Medium" : "Low",
      passed: crawled.jsonLdCount > 0 && Boolean(crawled.canonical),
      why: `JSON-LD: ${crawled.jsonLdCount > 0 ? "detected" : "missing"}, canonical: ${crawled.canonical ? crawled.canonical : "missing"}.`,
      fix: "Add Organization + Product JSON-LD schema and self-referencing <link rel='canonical'>."
    },
    {
      title: "H1 hierarchy, image alt & sampled link health",
      severity: crawled.brokenLinks.length > 0 || crawled.h1s.length === 0 || crawled.imagesMissingAlt > 0 ? "Medium" : "Low",
      passed: crawled.h1s.length === 1 && crawled.imagesMissingAlt === 0 && crawled.brokenLinks.length === 0,
      why: `Found ${crawled.h1s.length} H1 tags, ${crawled.imagesMissingAlt}/${crawled.totalImages} images missing alt, ${crawled.brokenLinks.length} broken sampled links.`,
      fix: "Ensure one clear H1, descriptive alt attributes, and fix any 4xx/5xx internal links."
    }
  ] : [];
  const ai = getGeminiClient();
  const selectedModel = resolveTextModel(params.model);
  const prompt = `Perform an actionable SEO keyword & technical opportunity analysis for ${target}.
${buildBusinessContextPrompt(params.business)}
${crawled ? `Live Crawl Findings:
- Title: ${crawled.title}
- Meta Description: ${crawled.metaDescription}
- Canonical: ${crawled.canonical || "Missing"}
- robots.txt: ${crawled.robotsTxtFound}, sitemap.xml: ${crawled.sitemapXmlFound}, TTFB: ${crawled.ttfbMs}ms
- H1s: ${crawled.h1s.join(" | ")}
- H2s: ${crawled.h2s.join(" | ")}
- Images missing alt: ${crawled.imagesMissingAlt}/${crawled.totalImages}
- Broken sampled links: ${crawled.brokenLinks.join(", ") || "None"}
- JSON-LD present: ${crawled.jsonLdCount > 0}
- Word count: ${crawled.wordCount}` : `Crawl note: ${crawlError}`}

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
      creditsEstimated: 65
    },
    () => ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: "You are a technical SEO strategist. Base technical issues on real crawled evidence and avoid fabricating fake search volume numbers.",
        tools: [{ googleSearch: {} }],
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json"
      }
    })
  );
  const aiAudit = parseJsonSafe(response.text);
  const sources = extractGroundingSources(response);
  const savedReport = stateStore.addSeoAuditReport({
    workspaceId: params.workspaceId,
    ownerUid: params.actorUid,
    websiteUrl: target,
    triggeredBy: params.triggeredBy || "manual",
    healthScore: Number(aiAudit.healthScore) || 75,
    headline: String(aiAudit.headline || `Technical SEO Audit \u2014 ${target}`),
    summary: String(aiAudit.summary || ""),
    technicalChecks,
    issues: Array.isArray(aiAudit.issues) ? aiAudit.issues : [],
    keywords: Array.isArray(aiAudit.keywords) ? aiAudit.keywords : [],
    crawled: crawled ? { url: crawled.url, title: crawled.title, ttfbMs: crawled.ttfbMs, robotsTxtFound: crawled.robotsTxtFound, sitemapXmlFound: crawled.sitemapXmlFound } : null
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
    sources
  };
}
router.post("/seo/audit", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const { websiteUrl, business, model, triggeredBy } = req.body;
    const out = await executeSeoAuditAnalysis({
      websiteUrl: String(websiteUrl || business?.websiteUrl || ""),
      business,
      model,
      workspaceId: ctx.workspaceId,
      actorUid: ctx.actorUid,
      triggeredBy: triggeredBy || "seo_agent"
    });
    res.json(out);
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router.post("/aso/optimize", async (req, res) => {
  try {
    const { business, currentTitle, currentSubtitle, currentDescription, model } = req.body;
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
        responseMimeType: "application/json"
      }
    });
    const data = parseJsonSafe(response.text);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router.post("/strategy/generate", async (req, res) => {
  try {
    const { business, goal = "30-day multi-channel growth", budget = "$500/mo", model } = req.body;
    const ctx = wsCtx(req);
    const snapshots = stateStore.listGrowthSnapshots(ctx.workspaceId);
    const telemetryBlock = snapshots.length ? `
Connected Real Growth Metrics Snapshot:
${snapshots.slice(0, 4).map(
      (s) => `- ${s.providerLabel} (${s.completenessStatus}): ${(s.metrics || []).map((m) => `${String(m.label)}=${String(m.value ?? "N/A")}`).join(", ")}`
    ).join("\n")}
Use these real baseline metrics in your strategy recommendations without inventing unseen numbers.` : "";
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
        responseMimeType: "application/json"
      }
    });
    const data = parseJsonSafe(response.text);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
function resolveSafeLocalMediaPath(assetUrl) {
  return resolveSafeUploadCandidate(assetUrl);
}
router.post("/intelligence/channel", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const { channelUrl, handle, platform = "Instagram", business, model } = req.body;
    if (!channelUrl?.trim() && !handle?.trim()) {
      res.status(400).json({ error: "Provide a public channel URL or creator handle." });
      return;
    }
    let crawled = null;
    let safeChannelUrl = "";
    if (channelUrl?.trim()) {
      safeChannelUrl = await normalizeAndAssertPublicUrl(channelUrl.trim());
      try {
        crawled = await crawlUrl(safeChannelUrl);
      } catch {
      }
    }
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const prompt = `Analyze this creator/brand social channel and separate verifiable public observations from strategic hypotheses.
${buildBusinessContextPrompt(business)}
Target Platform: ${platform}
Handle: ${handle || "Unknown"}
Channel URL: ${safeChannelUrl || "N/A"}
${crawled ? `Observed Public HTML Snapshot:
Title: ${crawled.title}
Meta: ${crawled.metaDescription}
Excerpt: ${crawled.bodyExcerpt.slice(0, 2e3)}` : "Direct HTML crawl unavailable; rely on public Google Search results only. Never invent private analytics or exact view counts if unavailable."}

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
        creditsEstimated: 55
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents: prompt,
        config: {
          systemInstruction: "You are a senior creator economy strategist. Strictly separate verifiable public facts from AI hypotheses. Never fabricate engagement rates, revenue, or follower stats.",
          tools: [{ googleSearch: {} }],
          thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
          responseMimeType: "application/json"
        }
      })
    );
    const parsed = parseJsonSafe(response.text);
    const sources = extractGroundingSources(response);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      channelUrl: safeChannelUrl || void 0,
      ...parsed,
      sources
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
      model
    } = req.body;
    const assetRecord = mediaId ? stateStore.getMediaAssetById(mediaId, ctx.workspaceId) : null;
    const localRel = assetRecord?.url || assetUrl || "";
    const localPath = localRel ? resolveSafeLocalMediaPath(localRel) : null;
    let safePublicVideoUrl = "";
    let crawled = null;
    if (!localPath) {
      if (!videoUrl?.trim()) {
        res.status(400).json({ error: "Provide an uploaded video from Media Library or a public video URL." });
        return;
      }
      safePublicVideoUrl = await normalizeAndAssertPublicUrl(videoUrl.trim());
      try {
        crawled = await crawlUrl(safePublicVideoUrl);
      } catch {
      }
    }
    let durationSec;
    let videoMetadata = null;
    let inlineVideoPart = null;
    if (localPath) {
      try {
        const { stdout } = await execFileAsync(resolveFfprobeBin(), [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          localPath
        ]);
        const probe = JSON.parse(stdout);
        const vStream = probe.streams?.find((s) => s.codec_type === "video");
        durationSec = probe.format?.duration ? Math.round(Number(probe.format.duration)) : void 0;
        videoMetadata = {
          durationSec,
          width: vStream?.width,
          height: vStream?.height
        };
      } catch {
      }
      const stats = fs5.statSync(localPath);
      if (stats.size <= 16 * 1024 * 1024) {
        inlineVideoPart = {
          inlineData: {
            data: fs5.readFileSync(localPath).toString("base64"),
            mimeType: assetRecord?.mimeType || "video/mp4"
          }
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
${crawled ? `Observed Page Snapshot:
Title: ${crawled.title}
Meta: ${crawled.metaDescription}
Excerpt: ${crawled.bodyExcerpt.slice(0, 1500)}` : ""}

Return ONLY valid JSON:
{
  "title": "string",
  "hookBreakdown": "string",
  "pacingSummary": "string",
  "visualCues": ["string"],
  "audioCues": ["string"],
  "timeline": [
    {
      "timestamp": "00:00\u201300:02",
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
    const contents = inlineVideoPart ? { parts: [inlineVideoPart, { text: textPrompt }] } : textPrompt;
    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/intelligence/video",
        agent: "Viral Video Pattern Analyzer",
        model: selectedModel,
        creditsEstimated: 75
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents,
        config: {
          systemInstruction: "You are a viral short-form creative director and video editor. If analyzing an uploaded video directly, mark timeline beats as 'observed'. If inferring from public URL metadata without direct frames, mark inferred beats honestly as 'estimated'.",
          ...inlineVideoPart ? {} : { tools: [{ googleSearch: {} }] },
          thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
          responseMimeType: "application/json"
        }
      })
    );
    const parsed = parseJsonSafe(response.text);
    const sources = extractGroundingSources(response);
    const saved = stateStore.addVideoBreakdown({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      title: String(parsed.title || title || assetRecord?.originalName || "Reference Breakdown"),
      sourceUrl: safePublicVideoUrl || void 0,
      mediaAssetId: assetRecord?.id,
      platform,
      creatorHandle: creatorHandle || void 0,
      durationSec,
      hookBreakdown: String(parsed.hookBreakdown || ""),
      pacingSummary: String(parsed.pacingSummary || ""),
      visualCues: Array.isArray(parsed.visualCues) ? parsed.visualCues.map(String) : [],
      audioCues: Array.isArray(parsed.audioCues) ? parsed.audioCues.map(String) : [],
      timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
      repeatableTemplate: parsed.repeatableTemplate || {
        hookFormula: "",
        sceneStructure: [],
        captionStyle: "",
        musicAndAudioFormula: ""
      }
    });
    res.json({
      breakdown: saved,
      metadata: videoMetadata,
      directMultimodalUsed: Boolean(inlineVideoPart),
      sources,
      model: selectedModel
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
    breakdowns: stateStore.listVideoBreakdowns(ctx.workspaceId)
  });
});
router.post("/intelligence/creator-report", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const { creatorName, channelData, breakdownIds = [], business, model } = req.body;
    const stored = stateStore.listVideoBreakdowns(ctx.workspaceId).filter((b) => breakdownIds.length === 0 || breakdownIds.includes(b.id)).slice(0, 6);
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
        creditsEstimated: 55
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents: prompt,
        config: {
          systemInstruction: "You are a growth & content systems director converting creator observations into repeatable video playbooks.",
          thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
          responseMimeType: "application/json"
        }
      })
    );
    const report = parseJsonSafe(response.text);
    res.json({
      model: selectedModel,
      breakdownsAnalyzed: stored.length,
      report
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
var intelligence_default = router;

// server/routes/aiStudio.ts
import fs6 from "fs";
import path5 from "path";
import crypto3 from "crypto";
import { Router as Router2 } from "express";
import multer from "multer";
var router2 = Router2();
function wsCtx2(req) {
  const areq = req;
  const workspaceId = String(req.headers["x-workspace-id"] || req.body?.workspaceId || "default");
  return { workspaceId, actorUid: areq.user?.uid || "anonymous" };
}
function buildApprovedMemoryBlock(workspaceId) {
  const memories = stateStore.listMemories(workspaceId).filter((m) => m.approved).slice(0, 12);
  if (!memories.length) return "";
  return `
Persistent Workspace AI Memory (approved context):
${memories.map((m) => `- [${m.scope.toUpperCase()} | ${m.source}] ${m.title}: ${m.content}`).join("\n")}
`;
}
var GENERATED_DIR = getGeneratedDir();
var uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});
function toDataUrlIfSmall(buffer, mimeType, maxBytes = 25e5) {
  if (!buffer || buffer.byteLength === 0 || buffer.byteLength > maxBytes) return void 0;
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
function saveGeneratedFile(buffer, ext) {
  const filename = `${Date.now()}-${crypto3.randomBytes(4).toString("hex")}.${ext}`;
  const fullPath = path5.join(GENERATED_DIR, filename);
  fs6.writeFileSync(fullPath, buffer);
  return `/uploads/generated/${filename}`;
}
function readLocalOrBase64Asset(input) {
  if (input.imageBase64) {
    const match = input.imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { data: match[2], mimeType: input.mimeType || match[1] || "image/png" };
    }
    const clean = input.imageBase64.replace(/^data:[^;]+;base64,/, "");
    return { data: clean, mimeType: input.mimeType || "image/png" };
  }
  if (input.imageUrl) {
    const dataMatch = input.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (dataMatch) {
      return { data: dataMatch[2], mimeType: input.mimeType || dataMatch[1] || "image/png" };
    }
    const candidate = resolveSafeUploadCandidate(input.imageUrl);
    if (candidate) {
      const ext = path5.extname(candidate).toLowerCase();
      const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      return {
        data: fs6.readFileSync(candidate).toString("base64"),
        mimeType
      };
    }
  }
  return null;
}
router2.post("/command-center/chat", async (req, res) => {
  try {
    const { message, history = [], business, model, systemRole } = req.body;
    if (!message?.trim()) {
      res.status(400).json({ error: "Message is required." });
      return;
    }
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const conversationText = history.slice(-10).map((m) => `${m.role === "user" ? "Founder" : "Marketing OS"}: ${m.text}`).join("\n");
    const ctx = wsCtx2(req);
    const memoryBlock = buildApprovedMemoryBlock(ctx.workspaceId);
    const prompt = `${buildBusinessContextPrompt(business)}${memoryBlock}

Recent Conversation:
${conversationText || "(New conversation)"}

Latest Founder Request:
${message}

Respond as Marketing OS Central Orchestrator. Provide:
1) A concise strategic reply grounded in the business context.
2) A structured 6-stage agent execution plan tailored to the request.

Return ONLY valid JSON:
{
  "reply": "string",
  "planTitle": "string",
  "estimatedCredits": 450,
  "expectedTime": "~4 minutes",
  "stages": [
    { "step": "string", "agent": "Research Agent" | "Strategy Agent" | "Script + Storyboard" | "Creative Agent" | "Quality Agents" | "Publishing Agent", "detail": "string" }
  ]
}`;
    const roleDirective = systemRole?.trim() ? `Adopt this specialist persona: ${systemRole.trim()}.` : "Act as an AI marketing department orchestrator.";
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: `You are Marketing OS. ${roleDirective} Never fabricate metrics or fake historical data. Draft-only permissions apply until human approval.`,
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json"
      }
    });
    const data = parseJsonSafe(response.text);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router2.post("/command-center/execute", async (req, res) => {
  try {
    const { goal, planTitle, business, model } = req.body;
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const prompt = `Execute the Marketing OS campaign workflow for:
Plan: ${planTitle || "Growth Campaign"}
Goal: ${goal || "Create high-converting short-form content and distribution drafts"}
${buildBusinessContextPrompt(business)}

Generate concrete draft deliverables ready for the Content Pipeline and Content Calendar (draft-only, awaiting approval).
Return ONLY valid JSON:
{
  "summary": "string",
  "researchInsights": ["string"],
  "projects": [
    {
      "title": "string",
      "platform": "Instagram" | "TikTok" | "YouTube" | "LinkedIn",
      "hook": "string",
      "script": "string",
      "stage": "Script" | "Awaiting approval"
    }
  ],
  "calendarDrafts": [
    {
      "title": "string",
      "platform": "Instagram" | "TikTok" | "LinkedIn" | "YouTube",
      "dayOffset": 2,
      "time": "18:00",
      "caption": "string"
    }
  ]
}`;
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: "You are the Marketing OS execution coordinator. Produce concrete, brand-aligned draft deliverables in strict JSON.",
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json"
      }
    });
    const data = parseJsonSafe(response.text);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router2.post("/content/scripts", async (req, res) => {
  try {
    const {
      topic,
      platform = "Instagram Reels + TikTok",
      duration = "30 seconds",
      audience = "Target customers",
      objective = "App consideration",
      tone = "Direct, credible, encouraging",
      cta = "Start today",
      blueprint = "",
      business,
      model
    } = req.body;
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const ctx = wsCtx2(req);
    const memoryBlock = buildApprovedMemoryBlock(ctx.workspaceId);
    const prompt = `Generate 3 distinct, high-retention marketing script variations and scene-by-scene storyboards.
${buildBusinessContextPrompt(business)}${memoryBlock}

Creative Brief:
- Topic: ${topic || "Core value proposition"}
- Platform: ${platform}
- Duration: ${duration}
- Target Audience: ${audience}
- Objective: ${objective}
- Tone: ${tone}
- Call to Action: ${cta}
${blueprint ? `- Blueprint Format: ${blueprint}` : ""}

Return ONLY valid JSON:
{
  "variations": [
    {
      "title": "string",
      "hook": "string",
      "angle": "string",
      "score": 92,
      "recommended": true,
      "scenes": [
        {
          "number": "01",
          "timeRange": "0:00-0:03",
          "beat": "Hook",
          "visual": "string",
          "dialogue": "string"
        }
      ]
    }
  ]
}`;
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: "You are an expert short-form video scriptwriter and creative director. Respect the brand's words to use and words to avoid.",
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json"
      }
    });
    const data = parseJsonSafe(response.text);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router2.post("/content/regenerate-section", async (req, res) => {
  try {
    const { beat, currentDialogue, currentVisual, instruction, business, model } = req.body;
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: `${buildBusinessContextPrompt(business)}
Rewrite this single storyboard scene (${beat || "Scene"}).
Current Dialogue: ${currentDialogue || ""}
Current Visual: ${currentVisual || ""}
Instruction: ${instruction || "Make it sharper, clearer, and more visual."}

Return ONLY valid JSON: { "dialogue": "string", "visual": "string" }`,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: thinkingConfigForModel(selectedModel, "low")
      }
    });
    const data = parseJsonSafe(response.text);
    res.json({ model: selectedModel, ...data });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router2.post("/image/generate", async (req, res) => {
  try {
    const {
      prompt,
      model,
      aspectRatio = "1:1",
      imageSize = "1K",
      useGoogleSearch = false,
      stylePreset,
      brandColors,
      referenceImageUrls = [],
      composition,
      textPlacement,
      backgroundInstruction,
      subjectPosition,
      saveToMediaLibrary = false,
      business
    } = req.body;
    if (!prompt?.trim()) {
      res.status(400).json({ error: "Image prompt is required." });
      return;
    }
    const ai = getGeminiClient();
    const selectedModel = resolveImageModel(model);
    const ctx = wsCtx2(req);
    const directives = [
      prompt.trim(),
      stylePreset ? `Style Preset: ${stylePreset}` : "",
      brandColors ? `Brand Color Palette: ${brandColors}` : "",
      composition ? `Composition: ${composition}` : "",
      subjectPosition ? `Subject Positioning: ${subjectPosition}` : "",
      textPlacement ? `Text Overlay Placement: ${textPlacement}` : "",
      backgroundInstruction ? `Background Direction: ${backgroundInstruction}` : "",
      business?.name ? `Brand Context: ${String(business.name)} (${String(business.industry || "modern brand")}). Clean studio quality, high contrast.` : ""
    ].filter(Boolean);
    const parts = [];
    for (const refUrl of referenceImageUrls.slice(0, 3)) {
      const refData = readLocalOrBase64Asset({ imageUrl: refUrl });
      if (refData) {
        parts.push({ inlineData: refData });
      }
    }
    parts.push({ text: directives.join("\n") });
    const imageConfig = { aspectRatio };
    if (selectedModel === "gemini-nano-banana-2.1" || selectedModel === "gemini-3-pro-image") {
      imageConfig.imageSize = ["1K", "2K", "4K"].includes(imageSize) ? imageSize : "1K";
    }
    const tools = useGoogleSearch && (selectedModel === "gemini-nano-banana-2.1" || selectedModel === "gemini-3-pro-image") ? [
      {
        googleSearch: {
          searchTypes: selectedModel === "gemini-nano-banana-2.1" ? { webSearch: {}, imageSearch: {} } : { webSearch: {} }
        }
      }
    ] : void 0;
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: { parts },
      config: {
        imageConfig,
        ...tools ? { tools } : {}
      }
    });
    let savedUrl = "";
    let mimeType = "image/png";
    let generatedBuffer = null;
    let textNote = "";
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data && !savedUrl) {
        mimeType = part.inlineData.mimeType || "image/png";
        const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
        generatedBuffer = Buffer.from(part.inlineData.data, "base64");
        savedUrl = saveGeneratedFile(generatedBuffer, ext);
      } else if (part.text) {
        textNote += part.text;
      }
    }
    if (!savedUrl || !generatedBuffer) {
      res.status(502).json({ error: "Model did not return an image asset. Try refining your prompt." });
      return;
    }
    const dataUrl = toDataUrlIfSmall(generatedBuffer, mimeType);
    let mediaAsset = null;
    if (saveToMediaLibrary) {
      const fullPath = resolveSafeUploadCandidate(savedUrl);
      const sizeBytes = fullPath && fs6.existsSync(fullPath) ? fs6.statSync(fullPath).size : generatedBuffer.byteLength;
      mediaAsset = stateStore.addMediaAsset({
        workspaceId: ctx.workspaceId,
        ownerUid: ctx.actorUid,
        url: dataUrl || savedUrl,
        filename: path5.basename(savedUrl),
        originalName: `nano-banana-${Date.now()}.png`,
        mimeType,
        sizeBytes,
        kind: "image",
        category: "campaign_creatives",
        tags: ["nano-banana", ...stylePreset ? [stylePreset] : []],
        description: prompt.trim().slice(0, 180)
      });
    }
    res.json({
      imageUrl: savedUrl,
      ...dataUrl ? { dataUrl } : {},
      mimeType,
      text: textNote,
      model: selectedModel,
      mediaAsset
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router2.post("/image/edit", async (req, res) => {
  try {
    const { imageUrl, imageBase64, mimeType, instruction, model, aspectRatio = "1:1" } = req.body;
    if (!instruction?.trim()) {
      res.status(400).json({ error: "Edit instruction is required." });
      return;
    }
    const sourceImage = readLocalOrBase64Asset({ imageUrl, imageBase64, mimeType });
    if (!sourceImage) {
      res.status(400).json({ error: "A valid source image is required for image editing." });
      return;
    }
    const ai = getGeminiClient();
    const selectedModel = resolveImageModel(model);
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: {
        parts: [
          {
            inlineData: {
              data: sourceImage.data,
              mimeType: sourceImage.mimeType
            }
          },
          { text: instruction.trim() }
        ]
      },
      config: {
        imageConfig: { aspectRatio }
      }
    });
    let savedUrl = "";
    let outMime = "image/png";
    let outBuffer = null;
    let textNote = "";
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data && !savedUrl) {
        outMime = part.inlineData.mimeType || "image/png";
        const ext = outMime.includes("jpeg") ? "jpg" : "png";
        outBuffer = Buffer.from(part.inlineData.data, "base64");
        savedUrl = saveGeneratedFile(outBuffer, ext);
      } else if (part.text) {
        textNote += part.text;
      }
    }
    if (!savedUrl || !outBuffer) {
      res.status(502).json({ error: "Image edit did not return an updated image." });
      return;
    }
    const dataUrl = toDataUrlIfSmall(outBuffer, outMime);
    res.json({
      imageUrl: savedUrl,
      ...dataUrl ? { dataUrl } : {},
      mimeType: outMime,
      text: textNote,
      model: selectedModel
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router2.post("/image/analyze", async (req, res) => {
  try {
    const { imageUrl, imageBase64, mimeType, question, model } = req.body;
    const sourceImage = readLocalOrBase64Asset({ imageUrl, imageBase64, mimeType });
    if (!sourceImage) {
      res.status(400).json({ error: "Valid image required for analysis." });
      return;
    }
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model || "gemini-4-neon");
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: {
        parts: [
          { inlineData: { data: sourceImage.data, mimeType: sourceImage.mimeType } },
          {
            text: question || "Critique this marketing creative for visual hierarchy, scroll-stopping hook strength, clarity, and conversion potential."
          }
        ]
      }
    });
    res.json({
      analysis: response.text || "",
      model: selectedModel
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router2.post("/video/generate", async (req, res) => {
  try {
    const {
      prompt,
      aspectRatio = "9:16",
      duration = "6s",
      resolution = "720p",
      imageUrl,
      imageBase64,
      mimeType,
      previousInteractionId
    } = req.body;
    if (!prompt?.trim()) {
      res.status(400).json({ error: "Video prompt is required." });
      return;
    }
    const ai = getGeminiClient();
    const sourceImage = readLocalOrBase64Asset({ imageUrl, imageBase64, mimeType });
    const input = sourceImage ? [
      {
        type: "image",
        mime_type: sourceImage.mimeType,
        data: sourceImage.data
      },
      {
        type: "text",
        text: prompt.trim()
      }
    ] : prompt.trim();
    const ctx = wsCtx2(req);
    const job = stateStore.createVideoJob({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      title: prompt.trim().slice(0, 64),
      aspectRatio: aspectRatio === "16:9" ? "16:9" : "9:16",
      status: "processing",
      progressPct: 25
    });
    const interaction = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/video/generate",
        agent: "Omni Video Generator",
        model: "gemini-omni-1.2-flash",
        creditsEstimated: 240
      },
      () => ai.interactions.create(
        {
          model: "gemini-omni-1.2-flash",
          ...previousInteractionId ? { previous_interaction_id: previousInteractionId } : {},
          input,
          background: false,
          store: true,
          stream: false,
          response_format: {
            type: "video",
            aspect_ratio: aspectRatio === "16:9" ? "16:9" : "9:16",
            duration: duration || "6s",
            resolution: resolution || "720p"
          }
        },
        { timeout: 3e5 }
      )
    );
    const videoPart = interaction.output_video;
    if (!videoPart?.data) {
      stateStore.updateVideoJob(job.id, { status: "failed", progressPct: 100, error: "No video bytes returned" });
      res.status(502).json({
        error: "Video generation completed without video bytes. Try a simpler motion prompt."
      });
      return;
    }
    const videoBuffer = Buffer.from(videoPart.data, "base64");
    const savedVideoUrl = saveGeneratedFile(videoBuffer, "mp4");
    stateStore.updateVideoJob(job.id, {
      status: "completed",
      progressPct: 100,
      renderUrl: savedVideoUrl,
      filename: path5.basename(savedVideoUrl),
      sizeBytes: videoBuffer.byteLength
    });
    res.json({
      jobId: job.id,
      videoUrl: savedVideoUrl,
      interactionId: interaction.id,
      model: "gemini-omni-1.2-flash",
      mimeType: videoPart.mime_type || "video/mp4"
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router2.post("/audio/tts", async (req, res) => {
  try {
    const {
      text,
      voiceName = "Kore",
      style = "Warm, clear, confident marketing presenter",
      model,
      dualSpeaker = false,
      secondSpeakerVoice = "Puck"
    } = req.body;
    if (!text?.trim()) {
      res.status(400).json({ error: "Narration text is required." });
      return;
    }
    const ai = getGeminiClient();
    const selectedModel = resolveVoiceModel(dualSpeaker ? "gemini-3.8-flash-tts" : model);
    const validVoices = ["Puck", "Charon", "Kore", "Fenrir", "Zephyr"];
    const primaryVoice = validVoices.includes(voiceName) ? voiceName : "Kore";
    const secondaryVoice = validVoices.includes(secondSpeakerVoice) ? secondSpeakerVoice : "Puck";
    const response = dualSpeaker ? await ai.models.generateContent({
      model: "gemini-3.8-flash-tts",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: text.trim(),
              speechMetadata: {
                speaker: "Host",
                style
              }
            }
          ]
        }
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              { speaker: "Host", voiceConfig: { prebuiltVoiceConfig: { voiceName: primaryVoice } } },
              { speaker: "Guest", voiceConfig: { prebuiltVoiceConfig: { voiceName: secondaryVoice } } }
            ]
          }
        }
      }
    }) : await ai.models.generateContent({
      model: selectedModel,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: text.trim(),
              speechMetadata: {
                style
              }
            }
          ]
        }
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: primaryVoice }
          }
        }
      }
    });
    const inlinePart = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    const base64Audio = inlinePart?.data;
    if (!base64Audio) {
      res.status(502).json({ error: "TTS model returned no audio data." });
      return;
    }
    const rawBytes = Buffer.from(base64Audio, "base64");
    if (rawBytes.length === 0) {
      res.status(502).json({ error: "TTS model returned an empty audio payload." });
      return;
    }
    const mimeStr = String(inlinePart?.mimeType || "audio/pcm;rate=24000");
    const hasRiffHeader = rawBytes.length >= 12 && rawBytes.subarray(0, 4).toString("ascii") === "RIFF" && rawBytes.subarray(8, 12).toString("ascii") === "WAVE";
    let playableBuffer = rawBytes;
    if (!hasRiffHeader && !mimeStr.includes("mpeg") && !mimeStr.includes("ogg")) {
      const rateMatch = mimeStr.match(/rate=(\d+)/i);
      const sampleRate = rateMatch ? Number(rateMatch[1]) || 24e3 : 24e3;
      const numChannels = 1;
      const bitsPerSample = 16;
      const byteRate = sampleRate * numChannels * bitsPerSample / 8;
      const blockAlign = numChannels * bitsPerSample / 8;
      const header = Buffer.alloc(44);
      header.write("RIFF", 0, "ascii");
      header.writeUInt32LE(36 + rawBytes.length, 4);
      header.write("WAVE", 8, "ascii");
      header.write("fmt ", 12, "ascii");
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(numChannels, 22);
      header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(byteRate, 28);
      header.writeUInt16LE(blockAlign, 32);
      header.writeUInt16LE(bitsPerSample, 34);
      header.write("data", 36, "ascii");
      header.writeUInt32LE(rawBytes.length, 40);
      playableBuffer = Buffer.concat([header, rawBytes]);
    }
    if (playableBuffer.length <= 44) {
      res.status(502).json({ error: "Generated TTS audio stream was empty." });
      return;
    }
    const audioUrl = saveGeneratedFile(playableBuffer, "wav");
    const dataUrl = toDataUrlIfSmall(playableBuffer, "audio/wav");
    res.json({
      audioUrl,
      ...dataUrl ? { dataUrl } : {},
      mimeType: "audio/wav",
      sizeBytes: playableBuffer.length,
      model: selectedModel,
      voiceName: primaryVoice
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router2.post("/audio/music", async (req, res) => {
  try {
    const { prompt, model } = req.body;
    if (!prompt?.trim()) {
      res.status(400).json({ error: "Music prompt is required." });
      return;
    }
    const ai = getGeminiClient();
    const selectedModel = resolveMusicModel(model);
    const stream = await ai.models.generateContentStream({
      model: selectedModel,
      contents: prompt.trim()
    });
    const audioChunks = [];
    let lyrics = "";
    let mimeType = "audio/mpeg";
    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (!parts) continue;
      for (const part of parts) {
        if (part.inlineData?.data) {
          if (audioChunks.length === 0 && part.inlineData.mimeType) {
            mimeType = part.inlineData.mimeType;
          }
          audioChunks.push(Buffer.from(part.inlineData.data, "base64"));
        }
        if (part.text) {
          lyrics += part.text;
        }
      }
    }
    if (!audioChunks.length) {
      res.status(502).json({ error: "Lyria did not produce audio chunks." });
      return;
    }
    const fullBuffer = Buffer.concat(audioChunks);
    if (fullBuffer.length === 0) {
      res.status(502).json({ error: "Lyria returned an empty audio stream." });
      return;
    }
    const ext = mimeType.includes("wav") ? "wav" : "mp3";
    const audioUrl = saveGeneratedFile(fullBuffer, ext);
    const dataUrl = toDataUrlIfSmall(fullBuffer, mimeType);
    res.json({
      audioUrl,
      ...dataUrl ? { dataUrl } : {},
      lyrics,
      mimeType,
      sizeBytes: fullBuffer.length,
      model: selectedModel
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router2.post("/audio/transcribe", uploadAudio.single("audio"), async (req, res) => {
  try {
    let base64 = "";
    let mimeType = "audio/webm";
    if (req.file) {
      base64 = req.file.buffer.toString("base64");
      mimeType = req.file.mimetype || "audio/webm";
    } else if (req.body?.audioBase64) {
      base64 = String(req.body.audioBase64).replace(/^data:[^;]+;base64,/, "");
      mimeType = req.body.mimeType || "audio/webm";
    }
    if (!base64) {
      res.status(400).json({ error: "Audio file or base64 audio payload is required." });
      return;
    }
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3.5-transcribe",
      contents: {
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: "Transcribe this spoken audio cleanly with punctuation." }
        ]
      }
    });
    res.json({
      transcript: response.text || "",
      model: "gemini-3.5-transcribe"
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router2.post("/evaluate/audience", async (req, res) => {
  try {
    const { title, script, platform = "Instagram Reels + TikTok", business, model, useDecisionCalibration = true } = req.body;
    if (!script?.trim()) {
      res.status(400).json({ error: "Script or creative content is required for evaluation." });
      return;
    }
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const evalPromise = ai.models.generateContent({
      model: selectedModel,
      contents: `Evaluate this marketing creative across 6 simulated audience & reviewer perspectives.
${buildBusinessContextPrompt(business)}
Platform: ${platform}
Creative Title: ${title || "Untitled Creative"}
Script / Copy:
${script}

Return ONLY valid JSON:
{
  "overallScore": 87,
  "headline": "string",
  "summary": "string",
  "dimensions": [
    { "label": "Attention", "score": 90 },
    { "label": "Clarity", "score": 88 },
    { "label": "Relevance", "score": 91 },
    { "label": "Credibility", "score": 78 },
    { "label": "CTA", "score": 85 }
  ],
  "evaluators": [
    { "role": "Impatient viewer", "focus": "Hook retention", "score": 88, "quote": "string", "recommendation": "string" },
    { "role": "Target customer", "focus": "Relevance", "score": 92, "quote": "string", "recommendation": "string" },
    { "role": "Skeptical viewer", "focus": "Credibility", "score": 76, "quote": "string", "recommendation": "string" },
    { "role": "Potential buyer", "focus": "Value clarity", "score": 84, "quote": "string", "recommendation": "string" },
    { "role": "Casual viewer", "focus": "Clarity", "score": 90, "quote": "string", "recommendation": "string" },
    { "role": "Brand reviewer", "focus": "Brand fit", "score": 94, "quote": "string", "recommendation": "string" }
  ]
}`,
      config: {
        systemInstruction: "You are an objective AI Audience Simulation Lab. Critique rigorously\u2014point out real weaknesses in hook, proof, or CTA. Clearly this is AI simulation, not real user testing.",
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json"
      }
    });
    let calibrationPromise = Promise.resolve(null);
    if (useDecisionCalibration) {
      const decisionsAi = getDecisionsClient();
      calibrationPromise = decisionsAi.decisions.create({
        model: "gemini-decision-1",
        input: `Platform: ${platform}
Business: ${String(business?.name || "Brand")}
Creative Title: ${title || ""}
Script:
${script}`,
        questions: {
          publish_ready: {
            type: "noul",
            instructions: "Is the creative clear, credible, and compelling enough to move to scheduling without major rework?",
            criteria: {
              true_description: "Strong opening hook, clear product proof, concrete CTA, zero misleading claims.",
              false_description: "Weak hook, vague value proposition, or lacks credible proof."
            }
          },
          quality_rubric: {
            type: "score",
            instructions: "Rate overall creative readiness for paid/organic distribution.",
            criteria: [
              "Needs full rewrite",
              "Weak hook or missing proof",
              "Solid draft with minor edits",
              "High-conviction ready to publish"
            ]
          }
        }
      }).then((result) => {
        const ready = result.answers?.publish_ready;
        const rubric = result.answers?.quality_rubric;
        return {
          readyToPublishProb: ready?.type === "noul" ? Math.round(ready.noul * 100) : void 0,
          rubricScore: rubric?.type === "score" ? Math.round(rubric.score / 3 * 100) : void 0
        };
      }).catch(() => null);
    }
    const [evalResponse, calibration] = await Promise.all([evalPromise, calibrationPromise]);
    const parsed = parseJsonSafe(evalResponse.text);
    res.json({
      sourceType: "ai_simulation",
      model: selectedModel,
      calibration,
      ...parsed
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router2.post("/evaluate/improve", async (req, res) => {
  try {
    const { title, script, feedbackSummary, business, model } = req.body;
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: `Improve this marketing script by directly resolving the evaluation feedback.
${buildBusinessContextPrompt(business)}
Title: ${title || "Creative"}
Original Script:
${script || ""}

Evaluation Feedback to Address:
${feedbackSummary || "Strengthen opening hook, add concrete product proof earlier, sharpen CTA."}

Return ONLY valid JSON:
{
  "improvedScript": "string",
  "changesMade": ["string"],
  "projectedScore": 94,
  "headline": "string"
}`,
      config: {
        systemInstruction: "You are a senior direct-response copywriter and creative editor.",
        thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
        responseMimeType: "application/json"
      }
    });
    const data = parseJsonSafe(response.text);
    res.json({
      sourceType: "ai_simulation",
      model: selectedModel,
      ...data
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
var aiStudio_default = router2;

// server/routes/videoEditor.ts
import { execFile as execFile2 } from "child_process";
import crypto4 from "crypto";
import fs7 from "fs";
import path6 from "path";
import { promisify as promisify2 } from "util";
import { Router as Router3 } from "express";
import multer2 from "multer";
var execFileAsync2 = promisify2(execFile2);
var router3 = Router3();
var MEDIA_DIR = getMediaDir();
var RENDERS_DIR = getRendersDir();
var TEMP_DIR = getTempDir();
var FFMPEG_BIN = resolveFfmpegBin();
var FFPROBE_BIN = resolveFfprobeBin();
var ALLOWED_MEDIA_CATEGORIES = /* @__PURE__ */ new Set([
  "logo",
  "product_screenshot",
  "app_screenshot",
  "product_demo_video",
  "product_demo_image",
  "product_clips",
  "product_clip_ref_image",
  "founder_clips",
  "talking_head_clips",
  "presenter_photograph",
  "testimonials",
  "tutorials",
  "brand_assets",
  "voiceovers",
  "background_music",
  "social_templates",
  "reference_viral_videos",
  "reference_image",
  "thumbnails",
  "campaign_creatives",
  "raw_screen_recordings",
  "other"
]);
var storage = multer2.diskStorage({
  destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
  filename: (_req, file, cb) => {
    const safeExt = path6.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, "") || ".bin";
    cb(null, `${Date.now()}-${crypto4.randomBytes(4).toString("hex")}${safeExt}`);
  }
});
var upload = multer2({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 }
});
function resolveLocalAssetPath(assetUrl) {
  return resolveSafeUploadCandidate(assetUrl);
}
function formatSrtTime(sec) {
  const safe = Math.max(0, sec);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor(safe % 3600 / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1e3);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
function writeCaptionsSrtFile(captions) {
  if (!captions.length) return null;
  const lines = captions.filter((c) => c.text?.trim()).map((c, idx) => {
    const start = Math.max(0, Number(c.startSec) || idx * 3);
    const end = Math.max(start + 0.8, Number(c.endSec) || start + 3);
    return `${idx + 1}
${formatSrtTime(start)} --> ${formatSrtTime(end)}
${c.text.trim()}
`;
  }).join("\n");
  if (!lines) return null;
  const srtPath = path6.join(TEMP_DIR, `subs-${Date.now()}-${crypto4.randomBytes(3).toString("hex")}.srt`);
  fs7.writeFileSync(srtPath, lines, "utf8");
  return srtPath;
}
function escapeFilterPath(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
router3.get("/media", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({
    assets: stateStore.listMediaAssets(ctx.workspaceId)
  });
});
router3.post("/media/upload", upload.single("file"), (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded." });
    return;
  }
  const mime = req.file.mimetype || "application/octet-stream";
  const kind = mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : mime.startsWith("image/") ? "image" : "document";
  const requestedCategory = String(req.body?.category || "").trim();
  const defaultCategory = kind === "video" ? "product_demo_video" : kind === "audio" ? "voiceovers" : kind === "image" ? "product_demo_image" : "brand_assets";
  const category = ALLOWED_MEDIA_CATEGORIES.has(requestedCategory) ? requestedCategory : defaultCategory;
  const rawTags = typeof req.body?.tags === "string" ? req.body.tags : "";
  const tags = rawTags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12);
  const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 600) : "";
  const url = `/uploads/media/${req.file.filename}`;
  const asset = stateStore.addMediaAsset({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    url,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: mime,
    sizeBytes: req.file.size,
    kind,
    category,
    tags,
    description
  });
  res.json({
    id: asset.id,
    url: asset.url,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    size: asset.sizeBytes,
    sizeBytes: asset.sizeBytes,
    kind: asset.kind,
    category: asset.category,
    tags: asset.tags,
    description: asset.description,
    createdAt: asset.createdAt
  });
});
router3.patch("/media/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const id = String(req.params.id);
  const { category, tags, description, originalName } = req.body;
  const patch = {};
  if (category && ALLOWED_MEDIA_CATEGORIES.has(category)) {
    patch.category = category;
  }
  if (Array.isArray(tags)) {
    patch.tags = tags.map(String).map((t) => t.trim()).filter(Boolean).slice(0, 15);
  } else if (typeof tags === "string") {
    patch.tags = tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 15);
  }
  if (typeof description === "string") {
    patch.description = description.trim().slice(0, 600);
  }
  if (typeof originalName === "string" && originalName.trim()) {
    patch.originalName = originalName.trim().slice(0, 180);
  }
  const updated = stateStore.updateMediaAsset(id, ctx.workspaceId, patch);
  if (!updated) {
    res.status(404).json({ error: "Media asset not found in this workspace." });
    return;
  }
  res.json({ asset: updated });
});
router3.post("/media/:id/replace", upload.single("file"), (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  if (!req.file) {
    res.status(400).json({ error: "Replacement file is required." });
    return;
  }
  const id = String(req.params.id);
  const existing = stateStore.getMediaAssetById(id, ctx.workspaceId);
  if (!existing) {
    try {
      if (fs7.existsSync(req.file.path)) fs7.unlinkSync(req.file.path);
    } catch {
    }
    res.status(404).json({ error: "Media asset not found in this workspace." });
    return;
  }
  const oldPath = resolveLocalAssetPath(existing.url);
  if (oldPath && oldPath.startsWith(MEDIA_DIR + path6.sep)) {
    try {
      if (fs7.existsSync(oldPath)) fs7.unlinkSync(oldPath);
    } catch {
    }
  }
  const mime = req.file.mimetype || "application/octet-stream";
  const kind = mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : mime.startsWith("image/") ? "image" : "document";
  const updated = stateStore.updateMediaAsset(id, ctx.workspaceId, {
    url: `/uploads/media/${req.file.filename}`,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: mime,
    sizeBytes: req.file.size,
    kind
  });
  res.json({ asset: updated });
});
router3.delete("/media/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const id = String(req.params.id);
  const removed = stateStore.deleteMediaAsset(id, ctx.workspaceId);
  if (!removed) {
    res.status(404).json({ error: "Media asset not found." });
    return;
  }
  const resolved = resolveLocalAssetPath(removed.url);
  if (resolved && resolved.startsWith(MEDIA_DIR + path6.sep)) {
    try {
      if (fs7.existsSync(resolved)) fs7.unlinkSync(resolved);
    } catch {
    }
  }
  res.json({ deleted: true, id: removed.id });
});
router3.post("/media/analyze", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const { mediaId, assetUrl, kind, mimeType, model } = req.body;
    const existing = mediaId ? stateStore.getMediaAssetById(mediaId, ctx.workspaceId) : null;
    const targetUrl = existing?.url || assetUrl || "";
    const resolved = resolveLocalAssetPath(targetUrl);
    if (!resolved) {
      res.status(400).json({ error: "Valid workspace media file is required for AI inspection." });
      return;
    }
    const effectiveKind = existing?.kind || kind || "image";
    const effectiveMime = existing?.mimeType || mimeType || "application/octet-stream";
    const stats = fs7.statSync(resolved);
    let probeMeta = null;
    if (effectiveKind === "video" || effectiveKind === "audio") {
      try {
        const { stdout } = await execFileAsync2(FFPROBE_BIN, [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          resolved
        ]);
        const parsedProbe = JSON.parse(stdout);
        const vStream = parsedProbe.streams?.find((s) => s.codec_type === "video");
        probeMeta = {
          durationSec: parsedProbe.format?.duration ? Math.round(Number(parsedProbe.format.duration)) : void 0,
          width: vStream?.width,
          height: vStream?.height,
          codec: vStream?.codec_name
        };
      } catch {
      }
    }
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    let analysis;
    if (stats.size > 16 * 1024 * 1024) {
      res.status(413).json({
        error: "File exceeds 16 MB inline multimodal analysis limit. Trim or compress under 16 MB to inspect."
      });
      return;
    }
    const base64Data = fs7.readFileSync(resolved).toString("base64");
    if (effectiveKind === "audio") {
      const txRes = await runTrackedAiCall(
        {
          workspaceId: ctx.workspaceId,
          actorUid: ctx.actorUid,
          endpoint: "/api/media/analyze",
          agent: "Audio Asset Analyzer",
          model: "gemini-3.5-transcribe",
          creditsEstimated: 20
        },
        () => ai.models.generateContent({
          model: "gemini-3.5-transcribe",
          contents: {
            parts: [
              { inlineData: { data: base64Data, mimeType: effectiveMime } },
              { text: "Transcribe this audio accurately with punctuation and speaker clarity." }
            ]
          }
        })
      );
      analysis = {
        summary: (txRes.text || "").slice(0, 280) || "Transcribed audio asset.",
        transcript: txRes.text || "",
        visualStyle: "Audio recording",
        analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
        model: "gemini-3.5-transcribe"
      };
    } else {
      const inspectRes = await runTrackedAiCall(
        {
          workspaceId: ctx.workspaceId,
          actorUid: ctx.actorUid,
          endpoint: "/api/media/analyze",
          agent: "Multimodal Asset Inspector",
          model: selectedModel,
          creditsEstimated: 35
        },
        () => ai.models.generateContent({
          model: selectedModel,
          contents: {
            parts: [
              { inlineData: { data: base64Data, mimeType: effectiveMime } },
              {
                text: `Inspect this ${effectiveKind} marketing brand asset carefully.
Extract visible on-screen text (OCR), key product features shown, visual style, spoken transcript if any, and scene breakdown.
Return ONLY valid JSON:
{
  "summary": "string",
  "extractedText": "string",
  "productFeatures": ["string"],
  "transcript": "string",
  "visualStyle": "string",
  "scenes": [{ "timeRange": "00:00-00:03", "description": "string" }]
}`
              }
            ]
          },
          config: {
            thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
            responseMimeType: "application/json"
          }
        })
      );
      const parsed = parseJsonSafe(inspectRes.text, {});
      analysis = {
        summary: String(parsed.summary || "Asset inspected"),
        extractedText: typeof parsed.extractedText === "string" ? parsed.extractedText : void 0,
        productFeatures: Array.isArray(parsed.productFeatures) ? parsed.productFeatures.map(String) : [],
        transcript: typeof parsed.transcript === "string" ? parsed.transcript : void 0,
        scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
        visualStyle: typeof parsed.visualStyle === "string" ? parsed.visualStyle : void 0,
        analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
        model: selectedModel
      };
    }
    if (existing) {
      stateStore.updateMediaAsset(existing.id, ctx.workspaceId, { aiAnalysis: analysis });
    }
    res.json({ analysis, metadata: probeMeta });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router3.post("/editor/ai-plan", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const {
      instruction,
      projectTitle = "Video Project",
      durationSec = 29,
      aspectRatio = "9:16",
      script = "",
      business,
      model
    } = req.body;
    if (!instruction?.trim()) {
      res.status(400).json({ error: "Editing instruction is required." });
      return;
    }
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const prompt = `Create a structured, reversible AI video editing plan for FFmpeg + multi-track timeline execution.
${buildBusinessContextPrompt(business)}
Project Title: ${projectTitle}
Current Duration: ${durationSec}s
Target Aspect Ratio: ${aspectRatio}
Script / Narration: ${script || "N/A"}
User Editing Instruction: ${instruction}

Return ONLY valid JSON:
{
  "summary": "string",
  "actions": ["Removed 1.8s pauses", "Added dynamic centered captions"],
  "trimStartSec": 0,
  "trimDurationSec": 12,
  "suggestedAspectRatio": "9:16" | "16:9" | "1:1" | "4:5",
  "captions": [
    { "startSec": 0, "endSec": 3, "text": "string" },
    { "startSec": 3, "endSec": 8, "text": "string" }
  ],
  "brollCues": [
    { "startSec": 4, "durationSec": 3, "label": "Product UI showcase" }
  ]
}`;
    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/editor/ai-plan",
        agent: "Video Edit Planner",
        model: selectedModel,
        creditsEstimated: 45
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents: prompt,
        config: {
          systemInstruction: "You are an expert short-form video editor. Return strictly valid JSON with realistic timestamps inside the project duration.",
          thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
          responseMimeType: "application/json"
        }
      })
    );
    const plan = parseJsonSafe(response.text);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      plan
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router3.post("/editor/render", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const tempFilesToClean = [];
  const {
    sourceUrl,
    clips = [],
    audioUrl,
    musicUrl,
    logoUrl,
    burnSubtitles = false,
    captionsTrack = [],
    aspectRatio = "9:16",
    trimStartSec = 0,
    trimDurationSec = 8,
    speed = 1,
    zoomFactor = 1,
    fadeInOut = false,
    voVolume = 1,
    musicVolume = 0.22,
    title = "render"
  } = req.body;
  const rawVisualUrls = Array.isArray(clips) && clips.length > 0 ? clips : sourceUrl ? [sourceUrl] : [];
  const resolvedVisuals = rawVisualUrls.map((u) => resolveLocalAssetPath(u)).filter((p) => Boolean(p));
  if (resolvedVisuals.length === 0) {
    res.status(400).json({ error: "Please upload or select a video or image asset first." });
    return;
  }
  if (!hasFfmpegBinary()) {
    res.status(503).json({
      error: "FFmpeg video rendering requires a Node or Docker runtime with ffmpeg installed. Configure FFMPEG_PATH on a dedicated render worker or run locally.",
      capabilityRequired: "ffmpeg"
    });
    return;
  }
  const job = stateStore.createVideoJob({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    title: title || "Video Render",
    aspectRatio,
    status: "processing",
    progressPct: 15
  });
  try {
    const resolvedVoice = audioUrl ? resolveLocalAssetPath(audioUrl) : null;
    const resolvedMusic = musicUrl ? resolveLocalAssetPath(musicUrl) : null;
    const dimensions = {
      "9:16": { w: 720, h: 1280 },
      "16:9": { w: 1280, h: 720 },
      "1:1": { w: 1080, h: 1080 },
      "4:5": { w: 864, h: 1080 }
    };
    const { w, h } = dimensions[aspectRatio] || dimensions["9:16"];
    const safeStart = Math.max(0, Number(trimStartSec) || 0);
    const safeDuration = Math.min(60, Math.max(2, Number(trimDurationSec) || 8));
    const safeSpeed = Math.min(1.5, Math.max(0.75, Number(speed) || 1));
    const safeZoom = Math.min(1.3, Math.max(1, Number(zoomFactor) || 1));
    const safeVoVol = Math.min(2, Math.max(0.1, Number(voVolume) || 1));
    const safeMusicVol = Math.min(1, Math.max(0, Number(musicVolume) ?? 0.22));
    const outFilename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)}-${Date.now()}.mp4`;
    const outPath = path6.join(RENDERS_DIR, outFilename);
    let primaryVideoPath = "";
    const isSingleVisual = resolvedVisuals.length === 1;
    const perClipSec = Math.max(1.5, Number((safeDuration / resolvedVisuals.length).toFixed(2)));
    if (!isSingleVisual) {
      const normalizedClips = [];
      for (let i = 0; i < Math.min(6, resolvedVisuals.length); i++) {
        const src = resolvedVisuals[i];
        const ext = path6.extname(src).toLowerCase();
        const isImg = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
        const clipOut = path6.join(TEMP_DIR, `seg-${job.id}-${i}.mp4`);
        tempFilesToClean.push(clipOut);
        const segArgs = ["-y"];
        if (isImg) {
          segArgs.push("-loop", "1", "-t", String(perClipSec), "-i", src);
        } else {
          segArgs.push("-ss", i === 0 ? String(safeStart) : "0", "-t", String(perClipSec), "-i", src);
        }
        segArgs.push(
          "-vf",
          `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p`,
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "23",
          clipOut
        );
        await execFileAsync2(FFMPEG_BIN, segArgs, { timeout: 9e4 });
        normalizedClips.push(clipOut);
      }
      const listFile = path6.join(TEMP_DIR, `concat-${job.id}.txt`);
      tempFilesToClean.push(listFile);
      fs7.writeFileSync(
        listFile,
        normalizedClips.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
        "utf8"
      );
      const mergedVisual = path6.join(TEMP_DIR, `merged-${job.id}.mp4`);
      tempFilesToClean.push(mergedVisual);
      await execFileAsync2(
        FFMPEG_BIN,
        ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", mergedVisual],
        { timeout: 9e4 }
      );
      primaryVideoPath = mergedVisual;
    } else {
      primaryVideoPath = resolvedVisuals[0];
    }
    stateStore.updateVideoJob(job.id, { progressPct: 60 });
    const primaryExt = path6.extname(primaryVideoPath).toLowerCase();
    const isPrimaryImage = isSingleVisual && [".jpg", ".jpeg", ".png", ".webp"].includes(primaryExt);
    const srtPath = burnSubtitles && Array.isArray(captionsTrack) && captionsTrack.length > 0 ? writeCaptionsSrtFile(captionsTrack) : null;
    if (srtPath) tempFilesToClean.push(srtPath);
    const resolvedLogo = logoUrl ? resolveLocalAssetPath(logoUrl) : null;
    const args = ["-y"];
    if (isPrimaryImage) {
      args.push("-loop", "1", "-t", String(safeDuration), "-i", primaryVideoPath);
    } else if (isSingleVisual) {
      args.push("-ss", String(safeStart), "-t", String(safeDuration), "-i", primaryVideoPath);
    } else {
      args.push("-i", primaryVideoPath);
    }
    const baseVf = (() => {
      let base = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
      if (safeZoom > 1.01) {
        const zw = Math.round(w * safeZoom / 2) * 2;
        const zh = Math.round(h * safeZoom / 2) * 2;
        base += `,scale=${zw}:${zh},crop=${w}:${h}`;
      }
      if (!isPrimaryImage && Math.abs(safeSpeed - 1) > 0.04) {
        base += `,setpts=${(1 / safeSpeed).toFixed(3)}*PTS`;
      }
      if (fadeInOut && safeDuration >= 2) {
        const fadeOutStart = Math.max(0.6, safeDuration - 0.5).toFixed(2);
        base += `,fade=t=in:st=0:d=0.45,fade=t=out:st=${fadeOutStart}:d=0.45`;
      }
      base += `,format=yuv420p`;
      if (srtPath) {
        base += `,subtitles='${escapeFilterPath(srtPath)}':force_style='FontSize=18,PrimaryColour=&HFFFFFF&,OutlineColour=&H111415&,Outline=2,Alignment=2,MarginV=36'`;
      }
      return base;
    })();
    const filterParts = [];
    let audioMapTarget = "1:a:0";
    let nextInputIndex = 1;
    if (resolvedVoice && resolvedMusic) {
      const voIdx = nextInputIndex++;
      const muIdx = nextInputIndex++;
      args.push("-i", resolvedVoice, "-stream_loop", "-1", "-i", resolvedMusic);
      filterParts.push(
        `[${voIdx}:a]volume=${safeVoVol.toFixed(2)}[va];[${muIdx}:a]volume=${safeMusicVol.toFixed(2)}[ma];[va][ma]amix=inputs=2:duration=first:dropout_transition=2[aout]`
      );
      audioMapTarget = "[aout]";
    } else if (resolvedVoice) {
      const voIdx = nextInputIndex++;
      args.push("-i", resolvedVoice);
      filterParts.push(`[${voIdx}:a]volume=${safeVoVol.toFixed(2)}[aout]`);
      audioMapTarget = "[aout]";
    } else if (resolvedMusic) {
      const muIdx = nextInputIndex++;
      args.push("-stream_loop", "-1", "-i", resolvedMusic);
      filterParts.push(`[${muIdx}:a]volume=${safeMusicVol.toFixed(2)}[aout]`);
      audioMapTarget = "[aout]";
    } else {
      const silIdx = nextInputIndex++;
      args.push("-f", "lavfi", "-t", String(safeDuration), "-i", "anullsrc=r=44100:cl=stereo");
      audioMapTarget = `${silIdx}:a:0`;
    }
    const validLogo = resolvedLogo && [".png", ".jpg", ".jpeg", ".webp"].includes(path6.extname(resolvedLogo).toLowerCase()) ? resolvedLogo : null;
    if (validLogo) {
      const logoIdx = nextInputIndex++;
      args.push("-i", validLogo);
      filterParts.push(`[0:v]${baseVf}[vbase]`);
      filterParts.push(`[${logoIdx}:v]scale=110:-1[wm]`);
      filterParts.push(`[vbase][wm]overlay=W-w-24:24[vout]`);
      args.push("-filter_complex", filterParts.join(";"), "-map", "[vout]", "-map", audioMapTarget);
    } else if (filterParts.length > 0) {
      args.push("-filter_complex", filterParts.join(";"), "-map", "0:v:0", "-map", audioMapTarget, "-vf", baseVf);
    } else {
      args.push("-map", "0:v:0", "-map", audioMapTarget, "-vf", baseVf);
    }
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-t",
      String(safeDuration),
      "-movflags",
      "+faststart",
      outPath
    );
    await execFileAsync2(FFMPEG_BIN, args, { timeout: 12e4 });
    if (!fs7.existsSync(outPath)) {
      throw new Error("Render completed without creating an MP4 file.");
    }
    const stats = fs7.statSync(outPath);
    if (stats.size <= 0) {
      throw new Error("Rendered MP4 file is empty.");
    }
    const renderUrl = `/uploads/renders/${outFilename}`;
    stateStore.updateVideoJob(job.id, {
      status: "completed",
      progressPct: 100,
      renderUrl,
      filename: outFilename,
      sizeBytes: stats.size,
      durationSec: safeDuration,
      width: w,
      height: h
    });
    stateStore.addNotification({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      title: "Video Render Complete",
      message: `${outFilename} (${w}\xD7${h}, ${(stats.size / 1024).toFixed(0)} KB) is ready.`,
      category: "video",
      severity: "success",
      actionPage: "Video Editor"
    });
    res.json({
      jobId: job.id,
      renderUrl,
      filename: outFilename,
      sizeBytes: stats.size,
      aspectRatio,
      durationSec: safeDuration,
      width: w,
      height: h,
      clipsUsed: resolvedVisuals.length,
      subtitlesBurned: Boolean(srtPath)
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stateStore.updateVideoJob(job.id, {
      status: "failed",
      progressPct: 100,
      error: message
    });
    res.status(500).json({ error: `FFmpeg render failed: ${message}`, jobId: job.id });
  } finally {
    for (const f of tempFilesToClean) {
      try {
        if (fs7.existsSync(f)) fs7.unlinkSync(f);
      } catch {
      }
    }
  }
});
var videoEditor_default = router3;

// server/routes/integrations.ts
import { Router as Router4 } from "express";
var firebaseConfig2 = getFirebaseServerConfig();
var router4 = Router4();
function wsCtx3(req) {
  const areq = req;
  const workspaceId = String(req.headers["x-workspace-id"] || req.body?.workspaceId || "default");
  return { workspaceId, actorUid: areq.user?.uid || "anonymous" };
}
router4.get("/models", (_req, res) => {
  const key = process.env.GEMINI_API_KEY?.trim();
  res.json({
    geminiConfigured: Boolean(key && key !== "MY_GEMINI_API_KEY"),
    catalog: MODEL_CATALOG
  });
});
router4.get("/models/verify", async (_req, res) => {
  const key = process.env.GEMINI_API_KEY?.trim();
  const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
  const allEntries = Object.entries(MODEL_CATALOG).flatMap(
    ([category, list]) => list.map((m) => ({ category, ...m }))
  );
  if (!key || key === "MY_GEMINI_API_KEY") {
    res.json({
      geminiConfigured: false,
      checkedAt,
      liveCheckPerformed: false,
      error: "GEMINI_API_KEY is not configured.",
      models: allEntries.map((m) => ({
        ...m,
        availableOnKey: false,
        verificationStatus: "api_key_missing"
      }))
    });
    return;
  }
  try {
    const ai = getGeminiClient();
    const listedNames = /* @__PURE__ */ new Set();
    const pager = await ai.models.list();
    for await (const item of pager) {
      const rawName = String(item.name || "").replace(/^models\//, "");
      if (rawName) listedNames.add(rawName);
    }
    res.json({
      geminiConfigured: true,
      checkedAt,
      liveCheckPerformed: true,
      listedModelCount: listedNames.size,
      models: allEntries.map((m) => {
        const directMatch = listedNames.has(m.id);
        return {
          ...m,
          availableOnKey: directMatch,
          verificationStatus: directMatch ? "verified_available" : "not_in_models_list"
        };
      })
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.json({
      geminiConfigured: true,
      checkedAt,
      liveCheckPerformed: false,
      error: formatted.message,
      models: allEntries.map((m) => ({
        ...m,
        availableOnKey: false,
        verificationStatus: "verification_failed"
      }))
    });
  }
});
router4.get("/integrations/status", async (req, res) => {
  const appUrl = resolvePublicBaseUrl(req);
  const composioConfigured = isComposioConfigured();
  let composioActiveCount = 0;
  let activeToolkits = [];
  if (composioConfigured) {
    try {
      const conn = await listComposioConnections();
      composioActiveCount = conn.accounts.filter((a) => a.status === "active").length;
      activeToolkits = Object.values(conn.statuses).filter((s) => s.accounts.some((a) => a.status === "active")).map((s) => s.toolkit);
    } catch {
    }
  }
  res.json({
    appUrl,
    callbackUrl: `${appUrl.replace(/\/$/, "")}/auth/callback`,
    providers: {
      gemini: {
        configured: Boolean(
          process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY"
        )
      },
      composio: {
        configured: composioConfigured,
        mode: getComposioMode(),
        mcpUrl: getComposioMcpUrl(),
        activeAccounts: composioActiveCount,
        activeToolkits
      },
      googleWorkspace: {
        configured: Boolean(firebaseConfig2.oAuthClientId),
        clientIdConfigured: Boolean(firebaseConfig2.oAuthClientId)
      },
      metaAds: {
        configured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET) || activeToolkits.includes("metaads") || activeToolkits.includes("instagram")
      },
      stripe: {
        configured: Boolean(process.env.STRIPE_SECRET_KEY) || activeToolkits.includes("stripe")
      },
      paystack: {
        configured: Boolean(process.env.PAYSTACK_SECRET_KEY)
      }
    }
  });
});
router4.get("/oauth/meta/url", (req, res) => {
  const appId = process.env.META_APP_ID?.trim();
  const appUrl = resolvePublicBaseUrl(req);
  const redirectUri = `${appUrl}/auth/callback`;
  if (!appId) {
    res.json({
      configured: false,
      redirectUri,
      message: "Direct META_APP_ID is optional because Meta/Instagram OAuth is managed through Composio Connect."
    });
    return;
  }
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: "ads_management,ads_read,pages_show_list,instagram_basic,instagram_content_publish",
    response_type: "code",
    state: "meta_oauth"
  });
  res.json({
    configured: true,
    redirectUri,
    authUrl: `https://www.facebook.com/v20.0/dialog/oauth?${params.toString()}`
  });
});
router4.post("/ads/forecast", async (req, res) => {
  try {
    const { objective, audience, budgetUsd = 300, creativeTitle, business, model } = req.body;
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const ctx = wsCtx3(req);
    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/ads/forecast",
        agent: "Ads Forecast Agent",
        model: selectedModel,
        creditsEstimated: 35
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents: `Generate a Meta Ads campaign plan, directional estimates, and primary ad copy variations.
${buildBusinessContextPrompt(business)}
Objective: ${objective || "App installs"}
Audience: ${audience || "Core ICP"}
Total Budget: $${budgetUsd} USD
Creative: ${creativeTitle || "Video Creative"}

Return ONLY valid JSON:
{
  "estimatedResultsRange": "string",
  "estimatedCpaRange": "string",
  "estimatedReachRange": "string",
  "budgetSplit": {
    "creativeTesting": 90,
    "winnerScaling": 180,
    "retargeting": 30
  },
  "primaryCopyVariants": ["string", "string"],
  "headline": "string",
  "caveat": "Directional AI estimate based on benchmark ranges; actual delivery depends on Meta auction."
}`,
        config: {
          thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
          responseMimeType: "application/json"
        }
      })
    );
    const data = parseJsonSafe(response.text);
    res.json({
      sourceType: "ai_simulation",
      model: selectedModel,
      ...data
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router4.post("/automations/run", async (req, res) => {
  try {
    const { workflowName = "Weekly Content Engine", business, model } = req.body;
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const ctx = wsCtx3(req);
    const startedAt = Date.now();
    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/automations/run",
        agent: "Automation Workflow Engine",
        model: selectedModel,
        creditsEstimated: 180
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents: `Execute a live dry-run of the "${workflowName}" automation workflow for this business.
${buildBusinessContextPrompt(business)}

Simulate each workflow stage with real, actionable marketing output (grounded trend angle + ready-to-review draft script + audience score check), stopping cleanly at the Human Approval gate.

Return ONLY valid JSON:
{
  "summary": "string",
  "trendTopic": "string",
  "generatedScriptTitle": "string",
  "generatedHook": "string",
  "generatedScript": "string",
  "qualityScore": 91,
  "passedThreshold": true,
  "stageLogs": [
    { "node": "Trigger", "status": "completed", "detail": "string" },
    { "node": "Research", "status": "completed", "detail": "string" },
    { "node": "Generate", "status": "completed", "detail": "string" },
    { "node": "Evaluate", "status": "completed", "detail": "string" },
    { "node": "Approval", "status": "awaiting_human", "detail": "Queued for owner review before publishing" }
  ]
}`,
        config: {
          thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
          responseMimeType: "application/json"
        }
      })
    );
    const data = parseJsonSafe(response.text);
    const elapsedMs = Date.now() - startedAt;
    const draftTitle = String(
      data.generatedScriptTitle || data.trendTopic || `${workflowName} Draft`
    ).trim();
    const draftHook = String(data.generatedHook || "").trim();
    const draftScript = String(data.generatedScript || data.summary || "").trim();
    const draftSummary = String(data.summary || "").trim();
    const draftScore = typeof data.qualityScore === "number" ? data.qualityScore : 88;
    const channels = Array.isArray(business?.channels) ? business.channels : [];
    const primaryPlatform = String(channels[0] || "Instagram Reels");
    const scriptLines = draftScript.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const bodyMid = scriptLines.slice(0, Math.max(1, scriptLines.length - 1)).join(" ") || draftScript || "Core value walkthrough";
    const defaultScenes = [
      {
        number: "01",
        timeRange: "0:00-0:04",
        durationSec: 4,
        beat: "Hook",
        visual: `Direct-to-camera opening or high-contrast product frame for ${draftTitle}`,
        dialogue: draftHook || scriptLines[0] || draftTitle,
        onScreenText: (draftHook || draftTitle).slice(0, 48),
        cameraDirection: "Tight punch-in framing",
        transition: "Hard cut"
      },
      {
        number: "02",
        timeRange: "0:04-0:20",
        durationSec: 16,
        beat: "Value & Proof",
        visual: "Product workflow walkthrough + measurable outcome callouts",
        dialogue: bodyMid,
        onScreenText: String(data.trendTopic || "Real workflow proof").slice(0, 48),
        cameraDirection: "Screen recording + medium presenter",
        transition: "Smooth whip"
      },
      {
        number: "03",
        timeRange: "0:20-0:30",
        durationSec: 10,
        beat: "Call to Action",
        visual: "Branded end card with next step CTA",
        dialogue: scriptLines[scriptLines.length - 1] || "Start your free trial today via the link.",
        onScreenText: "Get started today",
        cameraDirection: "Clean brand card",
        transition: "Fade out"
      }
    ];
    const createdProject = stateStore.upsertContentProject({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      title: draftTitle,
      platform: primaryPlatform,
      status: "AWAITING_SCRIPT_APPROVAL",
      owner: "Automation Workflow",
      progress: 45,
      creditsUsed: 180,
      brief: String(data.trendTopic || workflowName),
      hook: draftHook,
      script: draftScript,
      cta: "Get started today",
      caption: draftHook ? `${draftHook}

${draftSummary.slice(0, 140)}` : draftSummary,
      qaScore: draftScore,
      formatType: "short_form",
      productionMethod: "hybrid",
      scriptApproved: false,
      scriptVariants: [
        {
          title: draftTitle,
          hook: draftHook || draftTitle,
          angle: String(data.trendTopic || "Automated Workflow Draft"),
          score: draftScore,
          recommended: true,
          body: draftScript,
          cta: "Get started today",
          scenes: defaultScenes
        }
      ],
      sourceType: "ai_grounded"
    });
    stateStore.addNotification({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      title: `Script draft ready for approval: ${createdProject.title}`,
      message: "Review and approve this automation-generated script to continue to Storyboard or Video Production.",
      category: "automation",
      severity: "info",
      actionPage: "Content Studio"
    });
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      durationLabel: `${Math.max(1, Math.round(elapsedMs / 1e3))}s`,
      creditsUsed: 180,
      project: createdProject,
      ...data
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router4.post("/analytics/insights", async (req, res) => {
  try {
    const { business, metricsSummary, model } = req.body;
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const ctx = wsCtx3(req);
    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/analytics/insights",
        agent: "Growth Intelligence Analyst",
        model: selectedModel,
        creditsEstimated: 35
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents: `Analyze these marketing performance signals and generate Growth Intelligence recommendations.
${buildBusinessContextPrompt(business)}
Current Workspace Signals:
${metricsSummary || "Evaluate strategic opportunities based on the Business Notebook and active workspace goals."}

Return ONLY valid JSON:
{
  "headline": "string",
  "insight": "string",
  "confidence": "High" | "Medium",
  "recommendations": [
    { "title": "string", "rationale": "string", "nextAction": "string", "targetPage": "Content Studio" | "SEO & ASO" | "Ads Manager" | "Content Calendar" }
  ]
}`,
        config: {
          thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
          responseMimeType: "application/json"
        }
      })
    );
    const data = parseJsonSafe(response.text);
    res.json({
      sourceType: "ai_grounded",
      model: selectedModel,
      ...data
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
var integrations_default = router4;

// server/routes/composio.ts
import { Router as Router5 } from "express";
import { z } from "zod";

// server/services/socialCapabilityMatrix.ts
var SOCIAL_PLATFORM_DEFINITIONS = [
  {
    platform: "Instagram",
    badge: "IG",
    toolkit: "instagram",
    handlePlaceholder: "@yourbrand",
    capabilities: {
      publishText: { supported: false, note: "Instagram Graph API requires an image or video URL (text-only posts unsupported)." },
      publishMedia: { supported: true, toolSlug: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", note: "Publishes image/Reels via container + publish flow (public media URL required)." },
      scheduleNative: { supported: true, note: "Scheduled via Marketing OS scheduler + human confirmation." },
      profileRead: { supported: true, toolSlug: "INSTAGRAM_GET_USER_INFO", note: "Fetches IG Business profile, follower count, and recent media." },
      analyticsInsights: { supported: true, toolSlug: "INSTAGRAM_GET_IG_MEDIA_INSIGHTS", note: "Fetches real views, reach, likes, comments, saves, and shares." },
      adCampaigns: { supported: true, toolSlug: "METAADS_CREATE_CAMPAIGN", note: "Managed via connected Meta Ads toolkit (metaads)." }
    }
  },
  {
    platform: "Facebook",
    badge: "FB",
    toolkit: "facebook",
    handlePlaceholder: "Your Facebook Page",
    capabilities: {
      publishText: { supported: true, toolSlug: "FACEBOOK_CREATE_POST", note: "Publishes text/link posts to a managed Facebook Page." },
      publishMedia: { supported: true, toolSlug: "FACEBOOK_CREATE_PHOTO_POST", note: "Publishes photo posts to a managed Facebook Page." },
      scheduleNative: { supported: true, note: "Supported via Page scheduled posts or Marketing OS scheduler." },
      profileRead: { supported: true, toolSlug: "FACEBOOK_LIST_MANAGED_PAGES", note: "Lists managed Pages and recent posts." },
      analyticsInsights: { supported: true, toolSlug: "FACEBOOK_GET_PAGE_INSIGHTS", note: "Fetches real Page & post insights." },
      adCampaigns: { supported: true, toolSlug: "METAADS_CREATE_CAMPAIGN", note: "Managed via Meta Ads toolkit (metaads)." }
    }
  },
  {
    platform: "TikTok",
    badge: "TT",
    toolkit: "tiktok",
    handlePlaceholder: "@yourbrand",
    capabilities: {
      publishText: { supported: false, note: "TikTok requires video or photo carousel media; text-only posts unsupported." },
      publishMedia: { supported: true, toolSlug: "TIKTOK_PUBLISH_VIDEO", note: "Publishes video/photo via TikTok Content Posting API." },
      scheduleNative: { supported: true, note: "Queued in Marketing OS scheduler for explicit publish trigger." },
      profileRead: { supported: true, toolSlug: "TIKTOK_QUERY_CREATOR_INFO", note: "Reads creator privacy & posting eligibility." },
      analyticsInsights: { supported: false, note: "Unsupported on standard TikTok OAuth posting scope (requires TikTok Research/Business insights approval)." },
      adCampaigns: { supported: false, note: "TikTok Ads API requires separate Business Center credentials." }
    }
  },
  {
    platform: "YouTube",
    badge: "YT",
    toolkit: "youtube",
    handlePlaceholder: "Your Channel Name",
    capabilities: {
      publishText: { supported: false, note: "Community text posts are unsupported in YouTube Data API v3." },
      publishMedia: { supported: true, toolSlug: "YOUTUBE_UPLOAD_VIDEO", note: "Uploads MP4 video + title/description + thumbnail." },
      scheduleNative: { supported: true, note: "Supports scheduled publication via Marketing OS queue." },
      profileRead: { supported: true, toolSlug: "YOUTUBE_LIST_CHANNELS", note: "Fetches channel info & uploaded videos." },
      analyticsInsights: { supported: true, toolSlug: "YOUTUBE_QUERY_ANALYTICS", note: "Queries YouTube Analytics API views, watch time & subscribers." },
      adCampaigns: { supported: false, note: "Google Ads account integration required separately." }
    }
  },
  {
    platform: "LinkedIn",
    badge: "LI",
    toolkit: "linkedin",
    handlePlaceholder: "Your Name or Company Page",
    capabilities: {
      publishText: { supported: true, toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST", note: "Creates native LinkedIn text or article share posts." },
      publishMedia: { supported: true, toolSlug: "LINKEDIN_REGISTER_IMAGE_UPLOAD", note: "Supports image registration + article/URL share." },
      scheduleNative: { supported: true, note: "Scheduled via Marketing OS queue with confirmation gate." },
      profileRead: { supported: true, toolSlug: "LINKEDIN_GET_MY_INFO", note: "Fetches authenticated LinkedIn member or company profile." },
      analyticsInsights: { supported: false, note: "Organic post analytics require LinkedIn Marketing Developer Platform Community Management approval." },
      adCampaigns: { supported: false, note: "LinkedIn Campaign Manager API not enabled on default OAuth scope." }
    }
  },
  {
    platform: "X",
    badge: "X",
    toolkit: "twitter",
    handlePlaceholder: "@yourhandle",
    capabilities: {
      publishText: { supported: true, toolSlug: "TWITTER_CREATION_OF_A_POST", note: "Publishes posts (tweets) via X API v2." },
      publishMedia: { supported: true, toolSlug: "TWITTER_UPLOAD_MEDIA", note: "Uploads media + attaches to X post." },
      scheduleNative: { supported: true, note: "Scheduled via Marketing OS queue with confirmation gate." },
      profileRead: { supported: true, toolSlug: "TWITTER_USER_LOOKUP_ME", note: "Fetches authenticated X user & recent posts." },
      analyticsInsights: { supported: true, toolSlug: "TWITTER_GET_USER_POSTS", note: "Public metrics available per post lookup depending on X API tier." },
      adCampaigns: { supported: false, note: "X Ads API requires separate whitelisted Ads account access." }
    }
  }
];
function buildSocialCoverageReport(statuses) {
  return SOCIAL_PLATFORM_DEFINITIONS.map((def) => {
    const tkStatus = statuses[def.toolkit];
    const activeAccounts = (tkStatus?.accounts || []).filter((a) => a.status === "active");
    const connected = activeAccounts.length > 0;
    const evalCap = (cap) => {
      if (!cap.supported) return { status: "Unsupported", note: cap.note };
      if (!connected) return { status: "Setup Required", toolSlug: cap.toolSlug, note: cap.note };
      return { status: "Supported", toolSlug: cap.toolSlug, note: cap.note };
    };
    return {
      platform: def.platform,
      badge: def.badge,
      toolkit: def.toolkit,
      handlePlaceholder: def.handlePlaceholder,
      connectionStatus: connected ? "Connected" : "Setup Required",
      accounts: activeAccounts,
      primaryAccount: activeAccounts.find((a) => a.isDefault) || activeAccounts[0] || null,
      capabilities: {
        publishText: evalCap(def.capabilities.publishText),
        publishMedia: evalCap(def.capabilities.publishMedia),
        scheduleNative: evalCap(def.capabilities.scheduleNative),
        profileRead: evalCap(def.capabilities.profileRead),
        analyticsInsights: evalCap(def.capabilities.analyticsInsights),
        adCampaigns: def.capabilities.adCampaigns.supported ? statuses.metaads?.accounts?.some((a) => a.status === "active") ? { status: "Supported", toolSlug: def.capabilities.adCampaigns.toolSlug, note: def.capabilities.adCampaigns.note } : { status: "Setup Required", toolSlug: def.capabilities.adCampaigns.toolSlug, note: def.capabilities.adCampaigns.note } : { status: "Unsupported", note: def.capabilities.adCampaigns.note }
      }
    };
  });
}

// server/routes/composio.ts
var router5 = Router5();
function getContext(req) {
  const workspaceId = req.headers["x-workspace-id"] || (typeof req.query.workspaceId === "string" ? req.query.workspaceId : "") || (typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "") || "default";
  return {
    workspaceId: workspaceId.replace(/[^a-zA-Z0-9_-]/g, "") || "default",
    actorUid: req.user?.uid || "anonymous"
  };
}
function getCallbackUrl(req) {
  return `${resolvePublicBaseUrl(req)}/auth/callback`;
}
function resolvePublicMediaUrl(mediaUrl, req) {
  if (!mediaUrl?.trim()) return void 0;
  const trimmed = mediaUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) {
    return `${resolvePublicBaseUrl(req)}${trimmed}`;
  }
  return void 0;
}
function mapPlatformToToolkit(platform) {
  const p = platform.toLowerCase();
  if (p.includes("instagram")) return "instagram";
  if (p.includes("facebook")) return "facebook";
  if (p.includes("tiktok")) return "tiktok";
  if (p.includes("youtube")) return "youtube";
  if (p.includes("linkedin")) return "linkedin";
  if (p === "x" || p.includes("twitter")) return "twitter";
  return p;
}
var ConnectSchema = z.object({
  toolkit: z.string().min(2).max(64),
  alias: z.string().max(120).optional(),
  workspaceId: z.string().max(128).optional()
});
var DisconnectSchema = z.object({
  toolkit: z.string().min(2).max(64),
  accountId: z.string().min(1).max(160),
  workspaceId: z.string().max(128).optional()
});
var ExecuteSchema = z.object({
  toolkit: z.string().min(2).max(64),
  toolSlug: z.string().min(3).max(120),
  arguments: z.record(z.string(), z.unknown()).default({}),
  accountId: z.string().max(160).optional(),
  confirmed: z.literal(true),
  workspaceId: z.string().max(128).optional()
});
var PublishSchema = z.object({
  platform: z.string().min(1).max(80),
  caption: z.string().min(1).max(5e3),
  title: z.string().max(240).optional(),
  mediaUrl: z.string().max(1e3).optional(),
  mediaType: z.enum(["image", "video", "reels"]).optional(),
  pageId: z.string().max(120).optional(),
  confirmed: z.literal(true),
  idempotencyKey: z.string().min(4).max(160),
  workspaceId: z.string().max(128).optional()
});
var MetaCampaignCreateSchema = z.object({
  adAccountId: z.string().min(2).max(80).optional(),
  name: z.string().min(2).max(200),
  objective: z.string().min(2).max(80).default("OUTCOME_TRAFFIC"),
  dailyBudgetUsd: z.number().min(1).max(5e4),
  confirmed: z.literal(true),
  budgetAuthorized: z.literal(true),
  idempotencyKey: z.string().min(4).max(160),
  workspaceId: z.string().max(128).optional()
});
router5.get("/composio/status", async (_req, res) => {
  const health = await probeComposioHealth();
  res.json({
    ...health,
    toolkits: MARKETING_TOOLKITS
  });
});
router5.get("/composio/connections", async (req, res) => {
  const { workspaceId } = getContext(req);
  if (!isComposioConfigured()) {
    res.json({
      configured: false,
      mode: "unconfigured",
      mcpUrl: getComposioMcpUrl(),
      statuses: {},
      accounts: [],
      socialCoverage: buildSocialCoverageReport({}),
      logs: stateStore.getIntegrationLogs(workspaceId).slice(0, 25)
    });
    return;
  }
  try {
    const { statuses, accounts, mode } = await listComposioConnections(
      [...MARKETING_TOOLKITS],
      workspaceId
    );
    const socialCoverage = buildSocialCoverageReport(statuses);
    res.json({
      configured: true,
      mode,
      mcpUrl: getComposioMcpUrl(),
      statuses,
      accounts,
      socialCoverage,
      logs: stateStore.getIntegrationLogs(workspaceId).slice(0, 25)
    });
  } catch (err) {
    res.status(502).json({
      configured: true,
      mode: getComposioMode(),
      error: err instanceof Error ? err.message : "Failed to load Composio connections",
      socialCoverage: buildSocialCoverageReport({}),
      logs: stateStore.getIntegrationLogs(workspaceId).slice(0, 25)
    });
  }
});
router5.post("/composio/connect", async (req, res) => {
  const parsed = ConnectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request payload" });
    return;
  }
  const { workspaceId, actorUid } = getContext(req);
  try {
    const result = await initiateComposioConnection({
      toolkit: parsed.data.toolkit,
      alias: parsed.data.alias,
      callbackUrl: getCallbackUrl(req),
      workspaceId,
      userId: actorUid
    });
    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: "composio.connect.initiated",
      target: parsed.data.toolkit,
      status: "allowed",
      detail: `Generated OAuth Connect Link for ${parsed.data.toolkit}`
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to initiate Composio connection"
    });
  }
});
router5.delete("/composio/accounts", async (req, res) => {
  const parsed = DisconnectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "toolkit and accountId are required" });
    return;
  }
  const { workspaceId, actorUid } = getContext(req);
  try {
    const result = await disconnectComposioAccount({
      toolkit: parsed.data.toolkit,
      accountId: parsed.data.accountId,
      workspaceId
    });
    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: "composio.account.disconnected",
      target: `${parsed.data.toolkit}:${parsed.data.accountId}`,
      status: "allowed",
      detail: `Disconnected ${parsed.data.toolkit} account`
    });
    stateStore.addNotification({
      workspaceId,
      ownerUid: actorUid,
      title: `${parsed.data.toolkit} disconnected`,
      message: `Removed connected account ${parsed.data.accountId}.`,
      category: "integration",
      severity: "info",
      actionPage: "Integrations"
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to disconnect Composio account"
    });
  }
});
router5.post("/composio/execute", async (req, res) => {
  const parsed = ExecuteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Explicit confirmation (confirmed: true) and valid toolSlug are required."
    });
    return;
  }
  const { workspaceId, actorUid } = getContext(req);
  try {
    const out = await executeComposioTool({
      toolkit: parsed.data.toolkit,
      toolSlug: parsed.data.toolSlug,
      arguments: parsed.data.arguments,
      accountId: parsed.data.accountId,
      workspaceId,
      userId: actorUid
    });
    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: `composio.execute.${parsed.data.toolSlug}`,
      target: parsed.data.toolkit,
      status: "allowed",
      detail: `Executed ${parsed.data.toolSlug} with explicit user confirmation`
    });
    res.json(out);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Composio tool execution failed"
    });
  }
});
router5.post("/social/profile", async (req, res) => {
  const { workspaceId, actorUid } = getContext(req);
  const platform = String(req.body?.platform || "Instagram");
  const toolkit = mapPlatformToToolkit(platform);
  if (!isComposioConfigured()) {
    res.json({
      connected: false,
      platform,
      toolkit,
      status: "Awaiting Credentials",
      message: "COMPOSIO_API_KEY is not configured."
    });
    return;
  }
  try {
    const { statuses } = await listComposioConnections([toolkit], workspaceId);
    const activeAccount = statuses[toolkit]?.accounts.find((a) => a.status === "active");
    if (!activeAccount) {
      res.json({
        connected: false,
        platform,
        toolkit,
        status: "Setup Required",
        message: `No active ${platform} account connected yet. Connect ${platform} via OAuth first.`
      });
      return;
    }
    if (toolkit === "instagram") {
      const infoRes = await executeComposioTool({
        toolkit: "instagram",
        toolSlug: "INSTAGRAM_GET_USER_INFO",
        arguments: { ig_user_id: "me" },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      const igId = String(infoRes.data?.id || activeAccount.externalUserId || "me");
      const mediaRes = await executeComposioTool({
        toolkit: "instagram",
        toolSlug: "INSTAGRAM_GET_IG_USER_MEDIA",
        arguments: { ig_user_id: igId, limit: 8 },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      }).catch(() => ({ data: { data: [] } }));
      res.json({
        connected: true,
        sourceType: "live_api",
        platform: "Instagram",
        toolkit: "instagram",
        accountId: activeAccount.id,
        profile: infoRes.data,
        recentMedia: mediaRes.data?.data || []
      });
      return;
    }
    if (toolkit === "facebook") {
      const pages = await executeComposioTool({
        toolkit: "facebook",
        toolSlug: "FACEBOOK_LIST_MANAGED_PAGES",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      res.json({
        connected: true,
        sourceType: "live_api",
        platform: "Facebook",
        toolkit: "facebook",
        accountId: activeAccount.id,
        profile: pages.data
      });
      return;
    }
    if (toolkit === "youtube") {
      const channels = await executeComposioTool({
        toolkit: "youtube",
        toolSlug: "YOUTUBE_LIST_CHANNELS",
        arguments: { mine: true },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      res.json({
        connected: true,
        sourceType: "live_api",
        platform: "YouTube",
        toolkit: "youtube",
        accountId: activeAccount.id,
        profile: channels.data
      });
      return;
    }
    if (toolkit === "linkedin") {
      const me = await executeComposioTool({
        toolkit: "linkedin",
        toolSlug: "LINKEDIN_GET_MY_INFO",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      res.json({
        connected: true,
        sourceType: "live_api",
        platform: "LinkedIn",
        toolkit: "linkedin",
        accountId: activeAccount.id,
        profile: me.data
      });
      return;
    }
    if (toolkit === "twitter") {
      const me = await executeComposioTool({
        toolkit: "twitter",
        toolSlug: "TWITTER_USER_LOOKUP_ME",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      res.json({
        connected: true,
        sourceType: "live_api",
        platform: "X",
        toolkit: "twitter",
        accountId: activeAccount.id,
        profile: me.data
      });
      return;
    }
    if (toolkit === "tiktok") {
      const info = await executeComposioTool({
        toolkit: "tiktok",
        toolSlug: "TIKTOK_QUERY_CREATOR_INFO",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      res.json({
        connected: true,
        sourceType: "live_api",
        platform: "TikTok",
        toolkit: "tiktok",
        accountId: activeAccount.id,
        profile: info.data
      });
      return;
    }
    res.status(400).json({ error: `Unsupported platform "${platform}"` });
  } catch (err) {
    res.status(502).json({
      connected: true,
      platform,
      toolkit,
      error: err instanceof Error ? err.message : "Failed to fetch live social profile"
    });
  }
});
router5.post("/social/publish", async (req, res) => {
  const parsed = PublishSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Publishing requires explicit confirmation (confirmed: true), idempotencyKey, platform, and caption."
    });
    return;
  }
  const { workspaceId, actorUid } = getContext(req);
  const { platform, caption, mediaUrl, mediaType, pageId, idempotencyKey, title } = parsed.data;
  const existing = stateStore.getIdempotentResult(idempotencyKey);
  if (existing?.status === "completed") {
    res.json({ deduplicated: true, ...existing.result });
    return;
  }
  const toolkit = mapPlatformToToolkit(platform);
  if (!isComposioConfigured()) {
    res.status(503).json({
      published: false,
      needsConnection: true,
      status: "Awaiting Credentials",
      error: "COMPOSIO_API_KEY is missing on the server."
    });
    return;
  }
  try {
    const { statuses } = await listComposioConnections([toolkit], workspaceId);
    const activeAccount = statuses[toolkit]?.accounts.find((a) => a.status === "active");
    if (!activeAccount) {
      res.status(412).json({
        published: false,
        needsConnection: true,
        toolkit,
        status: "Setup Required",
        error: `${platform} is not connected via Composio OAuth. Connect ${platform} in Social Accounts first.`
      });
      return;
    }
    const publicMedia = resolvePublicMediaUrl(mediaUrl, req);
    let providerPostId = "";
    let providerResponse = {};
    if (toolkit === "instagram") {
      if (!publicMedia) {
        res.status(400).json({
          published: false,
          error: "Instagram Graph API requires a public image or video URL (text-only posts are unsupported by Instagram)."
        });
        return;
      }
      const info = await executeComposioTool({
        toolkit: "instagram",
        toolSlug: "INSTAGRAM_GET_USER_INFO",
        arguments: { ig_user_id: "me" },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      const igUserId = String(info.data?.id || activeAccount.externalUserId || "me");
      const isVideo = mediaType === "video" || mediaType === "reels" || /\.(mp4|mov|webm)(\?|$)/i.test(publicMedia);
      const container = await executeComposioTool({
        toolkit: "instagram",
        toolSlug: "INSTAGRAM_POST_IG_USER_MEDIA",
        arguments: {
          ig_user_id: igUserId,
          caption,
          ...isVideo ? { video_url: publicMedia, media_type: "REELS" } : { image_url: publicMedia }
        },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      const creationId = String(container.data?.id || container.data?.creation_id || "");
      if (!creationId) {
        throw new Error("Instagram did not return a container creation_id.");
      }
      const published = await executeComposioTool({
        toolkit: "instagram",
        toolSlug: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
        arguments: {
          ig_user_id: igUserId,
          creation_id: creationId
        },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      providerPostId = String(published.data?.id || creationId);
      providerResponse = published.data;
    } else if (toolkit === "facebook") {
      let targetPageId = pageId;
      if (!targetPageId) {
        const pages = await executeComposioTool({
          toolkit: "facebook",
          toolSlug: "FACEBOOK_LIST_MANAGED_PAGES",
          arguments: {},
          accountId: activeAccount.id,
          workspaceId,
          userId: actorUid
        });
        targetPageId = pages.data?.data?.[0]?.id;
      }
      if (!targetPageId) {
        throw new Error("No managed Facebook Page found on connected account.");
      }
      const fbRes = publicMedia ? await executeComposioTool({
        toolkit: "facebook",
        toolSlug: "FACEBOOK_CREATE_PHOTO_POST",
        arguments: { page_id: targetPageId, url: publicMedia, caption },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      }) : await executeComposioTool({
        toolkit: "facebook",
        toolSlug: "FACEBOOK_CREATE_POST",
        arguments: { page_id: targetPageId, message: caption },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      providerPostId = String(fbRes.data?.id || fbRes.data?.post_id || "");
      providerResponse = fbRes.data;
    } else if (toolkit === "linkedin") {
      const me = await executeComposioTool({
        toolkit: "linkedin",
        toolSlug: "LINKEDIN_GET_MY_INFO",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      const personId = String(me.data?.sub || me.data?.id || activeAccount.externalUserId || "");
      const authorUrn = personId.startsWith("urn:") ? personId : `urn:li:person:${personId}`;
      const liRes = await executeComposioTool({
        toolkit: "linkedin",
        toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST",
        arguments: {
          author: authorUrn,
          commentary: caption,
          visibility: "PUBLIC"
        },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      providerPostId = String(liRes.data?.id || "");
      providerResponse = liRes.data;
    } else if (toolkit === "twitter") {
      const xRes = await executeComposioTool({
        toolkit: "twitter",
        toolSlug: "TWITTER_CREATION_OF_A_POST",
        arguments: { text: caption.slice(0, 280) },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      providerPostId = String(xRes.data?.data?.id || xRes.data?.id || "");
      providerResponse = xRes.data;
    } else if (toolkit === "tiktok") {
      if (!publicMedia) {
        res.status(400).json({
          published: false,
          error: "TikTok requires a public video URL."
        });
        return;
      }
      const ttRes = await executeComposioTool({
        toolkit: "tiktok",
        toolSlug: "TIKTOK_PUBLISH_VIDEO",
        arguments: { video_url: publicMedia, title: (title || caption).slice(0, 150) },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      providerPostId = String(ttRes.data?.publish_id || ttRes.data?.id || "");
      providerResponse = ttRes.data;
    } else if (toolkit === "youtube") {
      if (!publicMedia) {
        res.status(400).json({
          published: false,
          error: "YouTube upload requires a video asset."
        });
        return;
      }
      const ytRes = await executeComposioTool({
        toolkit: "youtube",
        toolSlug: "YOUTUBE_UPLOAD_VIDEO",
        arguments: {
          videoFilePath: publicMedia,
          title: (title || "Marketing OS Video").slice(0, 100),
          description: caption,
          privacyStatus: "private"
        },
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      providerPostId = String(ytRes.data?.id || "");
      providerResponse = ytRes.data;
    } else {
      throw new Error(`Unsupported platform "${platform}"`);
    }
    const payload = {
      published: true,
      sourceType: "live_api",
      platform,
      toolkit,
      accountId: activeAccount.id,
      providerPostId: providerPostId || "submitted",
      data: providerResponse
    };
    stateStore.setIdempotentResult(idempotencyKey, "completed", payload);
    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: "social.publish",
      target: `${platform}:${activeAccount.id}`,
      status: "allowed",
      detail: `Published post "${(title || caption).slice(0, 60)}" (id: ${providerPostId || "submitted"})`
    });
    stateStore.addNotification({
      workspaceId,
      ownerUid: actorUid,
      title: `Published to ${platform}`,
      message: `"${(title || caption).slice(0, 60)}" was delivered via Composio (${providerPostId || "confirmed"}).`,
      category: "publishing",
      severity: "success",
      actionPage: "Publishing Queue"
    });
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Live social publishing failed";
    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: "social.publish",
      target: platform,
      status: "error",
      detail: message
    });
    res.status(502).json({
      published: false,
      platform,
      toolkit,
      error: message
    });
  }
});
router5.get("/social/capabilities", async (req, res) => {
  const { workspaceId } = getContext(req);
  if (!isComposioConfigured()) {
    res.json({
      definitions: SOCIAL_PLATFORM_DEFINITIONS,
      coverage: buildSocialCoverageReport({})
    });
    return;
  }
  try {
    const { statuses } = await listComposioConnections([...MARKETING_TOOLKITS], workspaceId);
    res.json({
      definitions: SOCIAL_PLATFORM_DEFINITIONS,
      coverage: buildSocialCoverageReport(statuses)
    });
  } catch {
    res.json({
      definitions: SOCIAL_PLATFORM_DEFINITIONS,
      coverage: buildSocialCoverageReport({})
    });
  }
});
router5.get("/ads/meta/accounts", async (req, res) => {
  const { workspaceId, actorUid } = getContext(req);
  if (!isComposioConfigured()) {
    res.json({
      connected: false,
      status: "Awaiting Credentials",
      accounts: [],
      message: "COMPOSIO_API_KEY is missing."
    });
    return;
  }
  try {
    const { statuses } = await listComposioConnections(["metaads"], workspaceId);
    const activeAccount = statuses.metaads?.accounts.find((a) => a.status === "active");
    if (!activeAccount) {
      res.json({
        connected: false,
        status: "Setup Required",
        accounts: [],
        message: "Connect Meta Ads via Composio OAuth to load live Ad Accounts & Campaigns."
      });
      return;
    }
    const adAccounts = await executeComposioTool({
      toolkit: "metaads",
      toolSlug: "METAADS_GET_AD_ACCOUNTS",
      arguments: {},
      accountId: activeAccount.id,
      workspaceId,
      userId: actorUid
    });
    res.json({
      connected: true,
      sourceType: "live_api",
      accountId: activeAccount.id,
      accounts: adAccounts.data?.data || []
    });
  } catch (err) {
    res.status(502).json({
      connected: false,
      status: "Error",
      accounts: [],
      error: err instanceof Error ? err.message : "Failed to load Meta Ad Accounts"
    });
  }
});
router5.get("/ads/meta/campaigns", async (req, res) => {
  const { workspaceId, actorUid } = getContext(req);
  const requestedAdAccountId = typeof req.query.adAccountId === "string" ? req.query.adAccountId : "";
  if (!isComposioConfigured()) {
    res.json({ connected: false, campaigns: [], status: "Awaiting Credentials" });
    return;
  }
  try {
    const { statuses } = await listComposioConnections(["metaads"], workspaceId);
    const activeAccount = statuses.metaads?.accounts.find((a) => a.status === "active");
    if (!activeAccount) {
      res.json({ connected: false, campaigns: [], status: "Setup Required" });
      return;
    }
    let adAccountId = requestedAdAccountId;
    if (!adAccountId) {
      const adAccs = await executeComposioTool({
        toolkit: "metaads",
        toolSlug: "METAADS_GET_AD_ACCOUNTS",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      adAccountId = String(adAccs.data?.data?.[0]?.id || "");
    }
    if (!adAccountId) {
      res.json({ connected: true, campaigns: [], message: "No Meta Ad Account found on user." });
      return;
    }
    const campaigns = await executeComposioTool({
      toolkit: "metaads",
      toolSlug: "METAADS_LIST_CAMPAIGNS",
      arguments: { ad_account_id: adAccountId },
      accountId: activeAccount.id,
      workspaceId,
      userId: actorUid
    });
    res.json({
      connected: true,
      sourceType: "live_api",
      adAccountId,
      campaigns: campaigns.data?.data || []
    });
  } catch (err) {
    res.status(502).json({
      connected: false,
      campaigns: [],
      error: err instanceof Error ? err.message : "Failed to list Meta campaigns"
    });
  }
});
router5.post("/ads/meta/campaigns", async (req, res) => {
  const parsed = MetaCampaignCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Meta campaign submission requires confirmed: true, budgetAuthorized: true, idempotencyKey, name, and dailyBudgetUsd."
    });
    return;
  }
  const { workspaceId, actorUid } = getContext(req);
  const { idempotencyKey, name, objective, dailyBudgetUsd } = parsed.data;
  const cached = stateStore.getIdempotentResult(idempotencyKey);
  if (cached?.status === "completed") {
    res.json({ deduplicated: true, ...cached.result });
    return;
  }
  try {
    const { statuses } = await listComposioConnections(["metaads"], workspaceId);
    const activeAccount = statuses.metaads?.accounts.find((a) => a.status === "active");
    if (!activeAccount) {
      res.status(412).json({
        created: false,
        needsConnection: true,
        status: "Setup Required",
        error: "Meta Ads toolkit is not connected. Connect Meta Ads via Composio OAuth first."
      });
      return;
    }
    let adAccountId = parsed.data.adAccountId || "";
    if (!adAccountId) {
      const adAccs = await executeComposioTool({
        toolkit: "metaads",
        toolSlug: "METAADS_GET_AD_ACCOUNTS",
        arguments: {},
        accountId: activeAccount.id,
        workspaceId,
        userId: actorUid
      });
      adAccountId = String(adAccs.data?.data?.[0]?.id || "");
    }
    if (!adAccountId) {
      throw new Error("No Meta Ad Account ID available on the connected account.");
    }
    const created = await executeComposioTool({
      toolkit: "metaads",
      toolSlug: "METAADS_CREATE_CAMPAIGN",
      arguments: {
        ad_account_id: adAccountId,
        name,
        objective,
        status: "PAUSED",
        daily_budget: Math.round(dailyBudgetUsd * 100)
      },
      accountId: activeAccount.id,
      workspaceId,
      userId: actorUid
    });
    const resultPayload = {
      created: true,
      sourceType: "live_api",
      campaignId: String(created.data?.id || ""),
      adAccountId,
      status: "PAUSED",
      data: created.data
    };
    stateStore.setIdempotentResult(idempotencyKey, "completed", resultPayload);
    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: "metaads.campaign.create",
      target: adAccountId,
      status: "allowed",
      detail: `Created PAUSED Meta Ads campaign "${name}" ($${dailyBudgetUsd}/day)`
    });
    stateStore.addNotification({
      workspaceId,
      ownerUid: actorUid,
      title: "Meta Ads Campaign Created (PAUSED)",
      message: `Campaign "${name}" created safely in PAUSED state on ${adAccountId}.`,
      category: "ads",
      severity: "success",
      actionPage: "Ads Manager"
    });
    res.json(resultPayload);
  } catch (err) {
    res.status(502).json({
      created: false,
      error: err instanceof Error ? err.message : "Failed to create Meta Ads campaign"
    });
  }
});
router5.post("/ads/meta/campaigns/:id/status", async (req, res) => {
  const confirmed = req.body?.confirmed === true;
  const nextStatus = req.body?.status === "ACTIVE" ? "ACTIVE" : "PAUSED";
  if (!confirmed) {
    res.status(400).json({ error: "Explicit confirmation (confirmed: true) required." });
    return;
  }
  const { workspaceId, actorUid } = getContext(req);
  try {
    const { statuses } = await listComposioConnections(["metaads"], workspaceId);
    const activeAccount = statuses.metaads?.accounts.find((a) => a.status === "active");
    if (!activeAccount) {
      res.status(412).json({ error: "Meta Ads is not connected." });
      return;
    }
    const updated = await executeComposioTool({
      toolkit: "metaads",
      toolSlug: "METAADS_UPDATE_CAMPAIGN",
      arguments: {
        campaign_id: req.params.id,
        status: nextStatus
      },
      accountId: activeAccount.id,
      workspaceId,
      userId: actorUid
    });
    stateStore.addAuditLog({
      workspaceId,
      actorUid,
      action: "metaads.campaign.status",
      target: String(req.params.id),
      status: "allowed",
      detail: `Updated Meta Ads campaign status to ${nextStatus}`
    });
    res.json({ updated: true, status: nextStatus, data: updated.data });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to update Meta Ads campaign"
    });
  }
});
router5.get("/composio/tools/discover", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query) {
    res.status(400).json({ error: "Search query parameter q is required." });
    return;
  }
  try {
    const tools = await searchComposioTools(query);
    res.json({ query, count: tools.length, tools });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Composio tool discovery failed"
    });
  }
});
var composio_default = router5;

// server/routes/pipeline.ts
import fs8 from "fs";
import path7 from "path";
import crypto5 from "crypto";
import { Router as Router6 } from "express";
var router6 = Router6();
var VALID_TRANSITIONS = {
  PLANNED: ["SCRIPT_PENDING", "SCRIPT_GENERATING", "SCRIPT_READY", "CANCELLED"],
  SCRIPT_PENDING: ["SCRIPT_GENERATING", "SCRIPT_READY", "AWAITING_SCRIPT_APPROVAL", "CANCELLED"],
  SCRIPT_GENERATING: ["SCRIPT_READY", "SCRIPT_PENDING", "CANCELLED"],
  SCRIPT_READY: ["AWAITING_SCRIPT_APPROVAL", "SCRIPT_APPROVED", "SCRIPT_GENERATING", "CANCELLED"],
  AWAITING_SCRIPT_APPROVAL: ["SCRIPT_APPROVED", "SCRIPT_READY", "SCRIPT_GENERATING", "CANCELLED"],
  SCRIPT_APPROVED: [
    "STORYBOARD_READY",
    "AWAITING_STORYBOARD_APPROVAL",
    "STORYBOARD_APPROVED",
    "VIDEO_PENDING",
    "VIDEO_GENERATING",
    "VIDEO_READY",
    "VIDEO_EDITING",
    "AWAITING_FINAL_APPROVAL",
    "SCRIPT_READY",
    "CANCELLED"
  ],
  STORYBOARD_READY: ["AWAITING_STORYBOARD_APPROVAL", "STORYBOARD_APPROVED", "SCRIPT_READY", "CANCELLED"],
  AWAITING_STORYBOARD_APPROVAL: ["STORYBOARD_APPROVED", "STORYBOARD_READY", "SCRIPT_READY", "CANCELLED"],
  STORYBOARD_APPROVED: [
    "VIDEO_PENDING",
    "VIDEO_GENERATING",
    "VIDEO_READY",
    "VIDEO_EDITING",
    "AWAITING_FINAL_APPROVAL",
    "STORYBOARD_READY",
    "CANCELLED"
  ],
  VIDEO_PENDING: ["VIDEO_GENERATING", "VIDEO_READY", "VIDEO_EDITING", "AWAITING_FINAL_APPROVAL", "CANCELLED"],
  VIDEO_GENERATING: ["VIDEO_READY", "VIDEO_PENDING", "AWAITING_FINAL_APPROVAL", "CANCELLED"],
  VIDEO_READY: ["VIDEO_EDITING", "AWAITING_FINAL_APPROVAL", "VIDEO_GENERATING", "CANCELLED"],
  VIDEO_EDITING: ["VIDEO_READY", "AWAITING_FINAL_APPROVAL", "CANCELLED"],
  AWAITING_FINAL_APPROVAL: ["APPROVED_FOR_PUBLISHING", "VIDEO_EDITING", "SCRIPT_READY", "CANCELLED"],
  APPROVED_FOR_PUBLISHING: ["SCHEDULED", "PUBLISHING", "AWAITING_FINAL_APPROVAL", "CANCELLED"],
  SCHEDULED: ["PUBLISHING", "PUBLISHED", "PUBLISH_FAILED", "CANCELLED"],
  PUBLISHING: ["PUBLISHED", "PUBLISH_FAILED"],
  PUBLISHED: [],
  PUBLISH_FAILED: ["SCHEDULED", "PUBLISHING", "AWAITING_FINAL_APPROVAL", "CANCELLED"],
  CANCELLED: ["PLANNED", "SCRIPT_PENDING"]
};
function getProjectBlockingReasons(project) {
  const blockers = [];
  if (!project.script?.trim() && (!project.scriptVariants || project.scriptVariants.length === 0)) {
    blockers.push("Script not generated yet");
  }
  if (!project.scriptApproved) {
    blockers.push("Script approval required before storyboard/production");
  }
  if (project.storyboardScenes && project.storyboardScenes.length > 0 && !project.storyboardApproved) {
    blockers.push("Storyboard approval required before video production");
  }
  if (!project.videoUrl && !project.editedVideoUrl && !project.thumbUrl) {
    blockers.push("Video or rendered creative asset missing");
  }
  if (!project.caption?.trim()) {
    blockers.push("Platform caption missing");
  }
  if (!project.finalApproved) {
    blockers.push("Final human creative approval missing");
  }
  return blockers;
}
function validateProjectTransition(project, target) {
  if (project.status === target) return { ok: true };
  const allowed = VALID_TRANSITIONS[project.status] || [];
  if (!allowed.includes(target)) {
    return {
      ok: false,
      error: `Invalid state transition from ${project.status} to ${target}.`
    };
  }
  if (target === "VIDEO_GENERATING" || target === "VIDEO_READY" || target === "VIDEO_EDITING" || target === "VIDEO_PENDING" || target === "AWAITING_FINAL_APPROVAL") {
    if (!project.scriptApproved) {
      return {
        ok: false,
        error: "Script must be explicitly approved before moving into video production.",
        blockers: ["Script not approved"]
      };
    }
    if (project.storyboardScenes && project.storyboardScenes.length > 0 && !project.storyboardApproved) {
      return {
        ok: false,
        error: "Storyboard must be explicitly approved before starting video production.",
        blockers: ["Storyboard not approved"]
      };
    }
  }
  if (target === "APPROVED_FOR_PUBLISHING" || target === "SCHEDULED" || target === "PUBLISHING") {
    const missing = [];
    if (!project.scriptApproved) missing.push("Script not approved");
    if (!project.videoUrl && !project.editedVideoUrl && !project.thumbUrl) {
      missing.push("Creative/video asset missing");
    }
    if (target !== "APPROVED_FOR_PUBLISHING" && !project.finalApproved) {
      missing.push("Human final approval missing");
    }
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Cannot transition to ${target}: ${missing.join("; ")}`,
        blockers: missing
      };
    }
  }
  return { ok: true };
}
function buildApprovedMemoryContext(workspaceId) {
  const approved = stateStore.listMemories(workspaceId).filter((m) => m.approved).slice(0, 10);
  if (!approved.length) return "";
  return `
Verified Brand Memory:
${approved.map((m) => `- [${m.scope}] ${m.title}: ${m.content}`).join("\n")}`;
}
router6.get("/strategies", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({ strategies: stateStore.listStrategies(ctx.workspaceId) });
});
router6.post("/strategies", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = req.body;
  if (!body.title?.trim() || !body.executiveSummary?.trim()) {
    res.status(400).json({ error: "Strategy title and executiveSummary are required." });
    return;
  }
  const saved = stateStore.upsertStrategy({
    id: body.id,
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    title: body.title.trim(),
    executiveSummary: body.executiveSummary.trim(),
    northStarMetric: body.northStarMetric || "Qualified leads & conversions",
    icpSegments: Array.isArray(body.icpSegments) ? body.icpSegments : [],
    contentPillars: Array.isArray(body.contentPillars) ? body.contentPillars : [],
    weeklyRoadmap: Array.isArray(body.weeklyRoadmap) ? body.weeklyRoadmap : [],
    experiments: Array.isArray(body.experiments) ? body.experiments : [],
    status: body.status || "active",
    objective: body.objective,
    targetPlatforms: Array.isArray(body.targetPlatforms) ? body.targetPlatforms : [],
    sourceType: body.sourceType === "manual" ? "manual" : "ai_grounded"
  });
  res.json({ strategy: saved });
});
router6.patch("/strategies/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getStrategyById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Strategy not found." });
    return;
  }
  const body = req.body;
  const updated = stateStore.upsertStrategy({
    ...existing,
    ...body,
    id: existing.id,
    workspaceId: ctx.workspaceId,
    ownerUid: existing.ownerUid
  });
  res.json({ strategy: updated });
});
router6.delete("/strategies/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const ok = stateStore.deleteStrategy(String(req.params.id), ctx.workspaceId);
  if (!ok) {
    res.status(404).json({ error: "Strategy not found." });
    return;
  }
  res.json({ deleted: true });
});
router6.post("/strategies/:id/generate-calendar", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const strategy = stateStore.getStrategyById(String(req.params.id), ctx.workspaceId);
  if (!strategy) {
    res.status(404).json({ error: "Strategy not found." });
    return;
  }
  try {
    const { business, count = 6, platforms, model } = req.body;
    const targetPlatforms = platforms?.length ? platforms : strategy.targetPlatforms?.length ? strategy.targetPlatforms : Array.isArray(business?.channels) && business.channels.length ? business.channels : ["Instagram Reels", "TikTok", "YouTube Shorts", "LinkedIn"];
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const totalCount = Math.min(14, Math.max(3, Number(count) || 6));
    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/strategies/:id/generate-calendar",
        agent: "Calendar Planner",
        model: selectedModel,
        creditsEstimated: 35
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents: `Create ${totalCount} concrete, scheduled content calendar entries directly derived from this saved Marketing Strategy.
${buildBusinessContextPrompt(business)}
${buildApprovedMemoryContext(ctx.workspaceId)}
Strategy Title: ${strategy.title}
North Star Metric: ${strategy.northStarMetric}
Pillars: ${JSON.stringify(strategy.contentPillars)}
Target Platforms: ${targetPlatforms.join(", ")}

Return ONLY valid JSON:
{
  "entries": [
    {
      "title": "Concise deliverable title",
      "platform": "Instagram Reels",
      "pillar": "Content pillar name",
      "objective": "Awareness | Lead Gen | Product Proof | Conversion",
      "formatType": "short_form",
      "dayOffset": 1,
      "timeStr": "10:30 AM",
      "captionDraft": "Draft social caption tailored to platform"
    }
  ]
}`,
        config: {
          systemInstruction: "You turn marketing strategies into specific, actionable content calendar deliverables. Never invent fake view counts or analytics.",
          thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
          responseMimeType: "application/json"
        }
      })
    );
    const parsed = parseJsonSafe(response.text, { entries: [] });
    const tones = ["mint", "purple", "blue", "gold"];
    const baseDate = /* @__PURE__ */ new Date();
    const created = [];
    for (const [idx, item] of (parsed.entries || []).slice(0, totalCount).entries()) {
      const targetDate = new Date(baseDate.getTime() + Math.max(1, Number(item.dayOffset) || idx * 2 + 1) * 864e5);
      const dateStr = targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const entry = stateStore.upsertCalendarEntry({
        workspaceId: ctx.workspaceId,
        ownerUid: ctx.actorUid,
        strategyId: strategy.id,
        pillar: item.pillar || strategy.contentPillars[0]?.pillar || "Core Growth",
        objective: item.objective || "Growth",
        formatType: item.formatType === "long_form" ? "long_form" : "short_form",
        title: item.title?.trim() || `${strategy.title} Deliverable #${idx + 1}`,
        platform: item.platform?.trim() || targetPlatforms[idx % targetPlatforms.length],
        dateStr,
        dayOfMonth: targetDate.getDate(),
        timeStr: item.timeStr || "10:00 AM",
        tone: tones[idx % tones.length],
        caption: item.captionDraft?.trim() || "",
        status: "Needs review",
        projectStatus: "PLANNED",
        checksPassed: 0,
        thumbUrl: "",
        sourceType: "ai_grounded"
      });
      created.push(entry);
    }
    res.json({ entries: created, strategyId: strategy.id });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router6.get("/calendar-entries", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({ entries: stateStore.listCalendarEntries(ctx.workspaceId) });
});
router6.post("/calendar-entries", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = req.body;
  if (!body.title?.trim()) {
    res.status(400).json({ error: "Calendar entry title is required." });
    return;
  }
  const entry = stateStore.upsertCalendarEntry({
    id: body.id,
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    strategyId: body.strategyId,
    contentProjectId: body.contentProjectId,
    pillar: body.pillar,
    objective: body.objective,
    formatType: body.formatType || "short_form",
    title: body.title.trim(),
    platform: body.platform || "Instagram Reels",
    dateStr: body.dateStr || (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    dayOfMonth: body.dayOfMonth || (/* @__PURE__ */ new Date()).getDate(),
    timeStr: body.timeStr || "10:00 AM",
    tone: body.tone || "mint",
    caption: body.caption || "",
    status: body.status || "Needs review",
    projectStatus: body.projectStatus || "PLANNED",
    checksPassed: body.checksPassed ?? 0,
    thumbUrl: body.thumbUrl || "",
    sourceType: body.sourceType || "manual"
  });
  res.json({ entry });
});
router6.patch("/calendar-entries/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getCalendarEntryById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Calendar entry not found." });
    return;
  }
  const updated = stateStore.upsertCalendarEntry({
    ...existing,
    ...req.body,
    id: existing.id,
    workspaceId: ctx.workspaceId,
    ownerUid: existing.ownerUid
  });
  res.json({ entry: updated });
});
router6.delete("/calendar-entries/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const ok = stateStore.deleteCalendarEntry(String(req.params.id), ctx.workspaceId);
  if (!ok) {
    res.status(404).json({ error: "Calendar entry not found." });
    return;
  }
  res.json({ deleted: true });
});
router6.post("/calendar-entries/:id/create-project", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const entry = stateStore.getCalendarEntryById(String(req.params.id), ctx.workspaceId);
  if (!entry) {
    res.status(404).json({ error: "Calendar entry not found." });
    return;
  }
  if (entry.contentProjectId) {
    const existingProj = stateStore.getContentProjectById(entry.contentProjectId, ctx.workspaceId);
    if (existingProj) {
      res.json({ project: existingProj, entry, alreadyLinked: true });
      return;
    }
  }
  const project = stateStore.upsertContentProject({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    title: entry.title,
    platform: entry.platform,
    status: "SCRIPT_PENDING",
    strategyId: entry.strategyId,
    calendarEntryId: entry.id,
    brief: `${entry.objective || "Growth"} post for ${entry.platform} (${entry.pillar || "General pillar"})`,
    formatType: entry.formatType || "short_form",
    productionMethod: "hybrid",
    caption: entry.caption || "",
    sourceType: "manual"
  });
  const updatedEntry = stateStore.upsertCalendarEntry({
    ...entry,
    contentProjectId: project.id,
    projectStatus: project.status
  });
  res.json({ project, entry: updatedEntry });
});
router6.get("/projects", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const projects = stateStore.listContentProjects(ctx.workspaceId).map((p) => ({
    ...p,
    blockingReasons: getProjectBlockingReasons(p)
  }));
  res.json({ projects });
});
router6.post("/projects", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = req.body;
  if (!body.title?.trim()) {
    res.status(400).json({ error: "Project title is required." });
    return;
  }
  const created = stateStore.upsertContentProject({
    ...body,
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    title: body.title.trim(),
    status: body.status || "SCRIPT_PENDING"
  });
  res.json({ project: { ...created, blockingReasons: getProjectBlockingReasons(created) } });
});
router6.patch("/projects/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  const patch = req.body;
  if (patch.status && patch.status !== existing.status) {
    const check = validateProjectTransition(existing, patch.status);
    if (!check.ok) {
      res.status(409).json({ error: check.error, blockers: check.blockers || [] });
      return;
    }
  }
  let versionAdditions = existing.scriptVersions || [];
  let lockResetPatch = {};
  if (existing.scriptApproved && typeof patch.script === "string" && patch.script.trim() !== (existing.script || "").trim() && patch.scriptApproved !== true) {
    const nextV = versionAdditions.length + 1;
    versionAdditions = [
      {
        id: stateStore.newId("sv"),
        version: nextV,
        title: `${existing.title} v${nextV} (Post-approval revision)`,
        hook: patch.hook ?? existing.hook ?? "",
        body: patch.script,
        cta: patch.cta ?? existing.cta ?? "",
        angle: "Manual revision",
        scenes: existing.storyboardScenes || [],
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        createdBy: ctx.actorUid,
        note: "Edited after approval \u2014 requires re-approval"
      },
      ...versionAdditions
    ].slice(0, 25);
    lockResetPatch = {
      scriptApproved: false,
      scriptApprovedAt: void 0,
      status: patch.status || "AWAITING_SCRIPT_APPROVAL",
      scriptVersions: versionAdditions
    };
  }
  const updated = stateStore.upsertContentProject({
    ...existing,
    ...patch,
    ...lockResetPatch,
    id: existing.id,
    workspaceId: ctx.workspaceId,
    ownerUid: existing.ownerUid,
    title: patch.title?.trim() || existing.title
  });
  if (updated.calendarEntryId) {
    const cal = stateStore.getCalendarEntryById(updated.calendarEntryId, ctx.workspaceId);
    if (cal) {
      stateStore.upsertCalendarEntry({ ...cal, projectStatus: updated.status });
    }
  }
  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) } });
});
router6.delete("/projects/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const ok = stateStore.deleteContentProject(String(req.params.id), ctx.workspaceId);
  if (!ok) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  res.json({ deleted: true });
});
router6.post("/projects/:id/transition", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  const target = req.body?.status;
  if (!target) {
    res.status(400).json({ error: "Target status is required." });
    return;
  }
  const check = validateProjectTransition(existing, target);
  if (!check.ok) {
    res.status(409).json({ error: check.error, blockers: check.blockers || [] });
    return;
  }
  const updated = stateStore.upsertContentProject({
    ...existing,
    status: target
  });
  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) } });
});
router6.post("/projects/:id/script-variants", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  try {
    const {
      brief,
      briefConfig,
      platform,
      tone = "Confident, direct-response",
      duration = "30 seconds",
      objective = "Product conversion",
      audience = "Target ICP",
      cta = "Get started today",
      keyMessage = "",
      desiredOutcome = "",
      features = [],
      referenceMaterials = "",
      selectedMediaIds = [],
      competitorRefs = [],
      business,
      model
    } = req.body;
    const mediaRefs = selectedMediaIds.map((id) => stateStore.getMediaAssetById(id, ctx.workspaceId)).filter((m) => Boolean(m)).map(
      (m) => `- [${m.category}] ${m.originalName}: ${m.aiAnalysis?.summary || m.description || "Uploaded brand asset"}`
    ).join("\n");
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    stateStore.upsertContentProject({ ...project, status: "SCRIPT_GENERATING" });
    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/projects/:id/script-variants",
        agent: "Script Variant Studio",
        model: selectedModel,
        creditsEstimated: 35
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents: `Generate 3 genuinely distinct script variations and rich scene-by-scene storyboards for this Content Project.
${buildBusinessContextPrompt(business)}
${buildApprovedMemoryContext(ctx.workspaceId)}
${mediaRefs ? `
Selected Brand Media Assets:
${mediaRefs}` : ""}
${competitorRefs.length ? `
Competitor / Creator Reference Notes:
${competitorRefs.join(" | ")}` : ""}
Project Title: ${project.title}
Platform: ${platform || project.platform}
Objective: ${objective}
Target Audience: ${audience}
Tone: ${tone}
Target Duration: ${duration}
Call to Action: ${cta}
${keyMessage ? `Key Message: ${keyMessage}` : ""}
${desiredOutcome ? `Desired Outcome: ${desiredOutcome}` : ""}
${features.length ? `Key Features to Highlight: ${features.join(", ")}` : ""}
${referenceMaterials ? `Reference Materials: ${referenceMaterials}` : ""}
Brief: ${brief || project.brief || project.title}

Return ONLY valid JSON with 3 genuinely distinct creative approaches (e.g. Problem/Agitation, Founder/Behind-the-Scenes Proof, Contrarian Demo):
{
  "variations": [
    {
      "title": "Variation name",
      "hook": "Scroll-stopping opening line",
      "openingPattern": "Visual/Pattern Interrupt / Direct Question / Bold Claim",
      "angle": "Creative angle summary",
      "concept": "Core creative premise in 1-2 sentences",
      "structureSummary": "Hook -> Proof -> Walkthrough -> CTA pacing summary",
      "body": "Full cohesive script copy ready to read",
      "cta": "Concrete closing call to action",
      "pacingNotes": "Cutting cadence and energy notes",
      "visualDirectionNotes": "Overall lighting, camera, and styling guide",
      "score": 92,
      "recommended": true,
      "scenes": [
        {
          "number": "01",
          "timeRange": "0:00-0:04",
          "timestamp": "0:00",
          "durationSec": 4,
          "beat": "Hook",
          "scriptSection": "Opening Hook",
          "visual": "Primary shot description",
          "dialogue": "Spoken narration line",
          "onScreenText": "Big 3-5 word caption overlay",
          "cameraDirection": "Tight eye-level punch-in",
          "visualComposition": "Rule of thirds center subject with safe zone caption",
          "presenterRequirement": "Founder or narrator facing lens",
          "background": "Bright modern studio workspace",
          "brollRequirement": "1s UI screen flash",
          "animationDirection": "Subtle pop-in on keyword",
          "transition": "Hard cut on beat",
          "soundEffects": "Soft whoosh SFX",
          "musicDirection": "Upbeat clean tech synth @ -18dB",
          "requiredAssets": ["product_screenshot"],
          "imagePrompt": "Clean 9:16 editorial visual frame prompt for this exact beat"
        }
      ]
    }
  ]
}`,
        config: {
          systemInstruction: "You are a senior creative director & video scriptwriter. Produce 3 distinct creative approaches with complete 10-element scripts and rich production-ready storyboard scenes.",
          thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
          responseMimeType: "application/json"
        }
      })
    );
    const parsed = parseJsonSafe(response.text, { variations: [] });
    const variations = parsed.variations || [];
    const primary = variations.find((v) => v.recommended) || variations[0];
    const bodyText = primary?.body?.trim() || (primary?.scenes?.length ? primary.scenes.map((s) => `[${s.timeRange}] (${s.beat}) ${s.dialogue}`).join("\n") : project.script || "");
    const nextVersionNum = (project.scriptVersions?.length || 0) + 1;
    const versionEntry = primary ? {
      id: stateStore.newId("sv"),
      version: nextVersionNum,
      title: primary.title,
      hook: primary.hook,
      body: bodyText,
      cta: primary.cta || cta || "",
      angle: primary.angle,
      scenes: primary.scenes,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      createdBy: ctx.actorUid,
      note: "Generated 3 script variants"
    } : null;
    const updated = stateStore.upsertContentProject({
      ...project,
      brief: brief || project.brief,
      briefConfig: briefConfig || project.briefConfig,
      platform: platform || project.platform,
      status: "SCRIPT_READY",
      scriptApproved: false,
      storyboardApproved: false,
      storyboardScenes: primary?.scenes || project.storyboardScenes || [],
      hook: primary?.hook || project.hook,
      cta: primary?.cta || cta || project.cta,
      script: bodyText,
      scriptVariants: variations,
      scriptVersions: versionEntry ? [versionEntry, ...project.scriptVersions || []] : project.scriptVersions
    });
    res.json({
      project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) },
      variations
    });
  } catch (err) {
    stateStore.upsertContentProject({ ...project, status: "SCRIPT_PENDING" });
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router6.post("/projects/:id/rewrite-script", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  try {
    const {
      currentScript,
      currentHook,
      mode = "hook",
      instruction = "",
      targetLength = "Keep similar length",
      tone = "Sharper & punchier",
      business,
      model
    } = req.body;
    const sourceScript = currentScript?.trim() || project.script || project.title;
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/projects/:id/rewrite-script",
        agent: "Script Rewriter",
        model: selectedModel,
        creditsEstimated: 20
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents: `Rewrite this marketing script with a focused edit mode: "${mode}".
${buildBusinessContextPrompt(business)}
Project: ${project.title} (${project.platform})
Current Hook: ${currentHook || project.hook || ""}
Current Script:
${sourceScript}

Requested Tone: ${tone}
Requested Length: ${targetLength}
Additional Direction: ${instruction || `Improve ${mode} while staying strictly faithful to verified product facts.`}

Return ONLY valid JSON:
{
  "title": "Rewritten draft title",
  "hook": "New or refined hook line",
  "angle": "Angle summary",
  "cta": "Refined CTA",
  "body": "Full rewritten script with timestamps/beats",
  "scenes": [
    { "number": "01", "timeRange": "0:00-0:04", "beat": "Hook", "visual": "Visual", "dialogue": "Dialogue" }
  ],
  "changeSummary": "1-sentence summary of what changed"
}`,
        config: {
          systemInstruction: "You are a direct-response script editor. Return clean JSON.",
          thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
          responseMimeType: "application/json"
        }
      })
    );
    const parsed = parseJsonSafe(response.text, {});
    const nextVersionNum = (project.scriptVersions?.length || 0) + 1;
    const versionEntry = {
      id: stateStore.newId("sv"),
      version: nextVersionNum,
      title: parsed.title || `${project.title} v${nextVersionNum}`,
      hook: parsed.hook || currentHook || project.hook || "",
      body: parsed.body || sourceScript,
      cta: parsed.cta || project.cta || "",
      angle: parsed.angle || mode,
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      createdBy: ctx.actorUid,
      note: parsed.changeSummary || `Rewritten (${mode})`
    };
    const updated = stateStore.upsertContentProject({
      ...project,
      status: "AWAITING_SCRIPT_APPROVAL",
      scriptApproved: false,
      hook: versionEntry.hook,
      cta: versionEntry.cta,
      script: versionEntry.body,
      scriptVersions: [versionEntry, ...project.scriptVersions || []].slice(0, 25)
    });
    res.json({
      project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) },
      version: versionEntry
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router6.post("/projects/:id/adapt-platform", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  try {
    const {
      platforms = ["TikTok", "Instagram Reels", "YouTube Shorts", "LinkedIn"],
      business,
      model
    } = req.body;
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const targetList = platforms.slice(0, 6);
    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/projects/:id/adapt-platform",
        agent: "Platform Adaptation Engine",
        model: selectedModel,
        creditsEstimated: 25
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents: `Adapt this content project script cleanly for each requested social platform: ${targetList.join(", ")}.
${buildBusinessContextPrompt(business)}
Project Title: ${project.title}
Core Hook: ${project.hook || ""}
Core Script:
${project.script || project.brief || project.title}

Return ONLY valid JSON:
{
  "adaptations": [
    {
      "platform": "TikTok",
      "format": "short_form",
      "hook": "Platform-native opening line",
      "script": "Adapted spoken/written script tailored to platform pacing",
      "caption": "Publish-ready caption",
      "hashtags": ["#tag1", "#tag2", "#tag3"],
      "thumbnailPrompt": "Visual frame / cover prompt for this platform",
      "durationEstimateSec": 28
    }
  ]
}`,
        config: {
          systemInstruction: "Adapt scripts specifically for each platform's pacing, length, caption style, and formatting without generic boilerplate.",
          thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
          responseMimeType: "application/json"
        }
      })
    );
    const parsed = parseJsonSafe(response.text, { adaptations: [] });
    const nextAdaptations = { ...project.platformAdaptations || {} };
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (const item of parsed.adaptations || []) {
      if (!item.platform) continue;
      nextAdaptations[item.platform] = {
        platform: item.platform,
        format: item.format || "short_form",
        hook: item.hook,
        script: item.script,
        caption: item.caption,
        hashtags: Array.isArray(item.hashtags) ? item.hashtags : [],
        thumbnailPrompt: item.thumbnailPrompt || "",
        durationEstimateSec: item.durationEstimateSec || 30,
        updatedAt: now
      };
    }
    const primaryAdaptation = nextAdaptations[project.platform] || Object.values(nextAdaptations)[0];
    const updated = stateStore.upsertContentProject({
      ...project,
      platformAdaptations: nextAdaptations,
      caption: project.caption || primaryAdaptation?.caption || "",
      hashtags: project.hashtags?.length ? project.hashtags : primaryAdaptation?.hashtags || []
    });
    res.json({
      project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) },
      adaptations: nextAdaptations
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router6.post("/projects/:id/approve-script", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  const { script, hook, cta, note } = req.body;
  const effectiveScript = script?.trim() || project.script?.trim() || "";
  if (!effectiveScript) {
    res.status(400).json({ error: "Cannot approve an empty script. Generate or write a script first." });
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updated = stateStore.upsertContentProject({
    ...project,
    script: effectiveScript,
    hook: hook?.trim() || project.hook,
    cta: cta?.trim() || project.cta,
    scriptApproved: true,
    scriptApprovedAt: now,
    status: "SCRIPT_APPROVED"
  });
  stateStore.addAuditLog({
    workspaceId: ctx.workspaceId,
    actorUid: ctx.actorUid,
    action: "project.script.approve",
    target: updated.id,
    status: "allowed",
    detail: note || `Script approved for "${updated.title}"`
  });
  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) } });
});
router6.post("/projects/:id/storyboard", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  const { scenes, note } = req.body;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    res.status(400).json({ error: "At least one storyboard scene is required." });
    return;
  }
  const normalized = scenes.map((s, idx) => ({
    ...s,
    number: String(idx + 1).padStart(2, "0")
  }));
  const versions = project.storyboardVersions || [];
  const nextVersion = {
    id: stateStore.newId("sbv"),
    version: versions.length + 1,
    scenes: normalized,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    createdBy: ctx.actorUid,
    note: note || "Storyboard saved"
  };
  const nextStatus = project.scriptApproved ? "STORYBOARD_READY" : project.status;
  const updated = stateStore.upsertContentProject({
    ...project,
    storyboardScenes: normalized,
    storyboardApproved: false,
    storyboardApprovedAt: void 0,
    storyboardVersions: [nextVersion, ...versions].slice(0, 20),
    status: nextStatus
  });
  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) } });
});
router6.post("/projects/:id/approve-storyboard", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  if (!project.scriptApproved) {
    res.status(409).json({
      error: "Script must be approved before approving the storyboard.",
      blockers: ["Script not approved"]
    });
    return;
  }
  const scenesInput = req.body?.scenes;
  const scenes = scenesInput?.length ? scenesInput : project.storyboardScenes || [];
  if (!scenes.length) {
    res.status(400).json({ error: "Cannot approve an empty storyboard. Generate or add storyboard scenes first." });
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updated = stateStore.upsertContentProject({
    ...project,
    storyboardScenes: scenes,
    storyboardApproved: true,
    storyboardApprovedAt: now,
    status: "STORYBOARD_APPROVED"
  });
  stateStore.addAuditLog({
    workspaceId: ctx.workspaceId,
    actorUid: ctx.actorUid,
    action: "project.storyboard.approve",
    target: updated.id,
    status: "allowed",
    detail: `Storyboard (${scenes.length} scenes) approved for "${updated.title}"`
  });
  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) } });
});
router6.post("/projects/:id/scenes/:sceneIndex/generate-image", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  const idx = Number(req.params.sceneIndex);
  const scenes = [...project.storyboardScenes || []];
  if (!Number.isInteger(idx) || idx < 0 || idx >= scenes.length) {
    res.status(404).json({ error: "Storyboard scene index not found." });
    return;
  }
  try {
    const {
      prompt,
      model,
      aspectRatio = project.formatType === "long_form" ? "16:9" : "9:16",
      imageSize = "1K",
      referenceImageUrls = [],
      business
    } = req.body;
    const scene = scenes[idx];
    const effectivePrompt = prompt?.trim() || scene.imagePrompt || `${scene.visual}. ${scene.cameraDirection ? `Camera: ${scene.cameraDirection}.` : ""} ${scene.background ? `Background: ${scene.background}.` : ""} ${scene.onScreenText ? `Clean typography space for "${scene.onScreenText}".` : ""}`;
    const ai = getGeminiClient();
    const selectedModel = resolveImageModel(model);
    const parts = [];
    for (const refUrl of referenceImageUrls.slice(0, 3)) {
      const dataMatch = refUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (dataMatch) {
        parts.push({
          inlineData: { data: dataMatch[2], mimeType: dataMatch[1] }
        });
        continue;
      }
      const candidate = resolveSafeUploadCandidate(refUrl);
      if (candidate && fs8.existsSync(candidate)) {
        const ext = path7.extname(candidate).toLowerCase();
        const mimeType2 = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        parts.push({
          inlineData: { data: fs8.readFileSync(candidate).toString("base64"), mimeType: mimeType2 }
        });
      }
    }
    parts.push({
      text: business?.name ? `${effectivePrompt}
Brand: ${String(business.name)} (${String(business.industry || "brand")}). High-contrast production frame.` : effectivePrompt
    });
    const imageConfig = { aspectRatio };
    if (selectedModel === "gemini-nano-banana-2.1" || selectedModel === "gemini-3-pro-image") {
      imageConfig.imageSize = ["1K", "2K", "4K"].includes(imageSize) ? imageSize : "1K";
    }
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: { parts },
      config: { imageConfig }
    });
    let savedUrl = "";
    let mimeType = "image/png";
    let imgBuffer = null;
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data && !savedUrl) {
        mimeType = part.inlineData.mimeType || "image/png";
        const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
        const filename = `${Date.now()}-${crypto5.randomBytes(4).toString("hex")}.${ext}`;
        imgBuffer = Buffer.from(part.inlineData.data, "base64");
        fs8.writeFileSync(path7.join(getGeneratedDir(), filename), imgBuffer);
        savedUrl = `/uploads/generated/${filename}`;
      }
    }
    if (!savedUrl || !imgBuffer) {
      res.status(502).json({ error: "Image model did not return a generated frame." });
      return;
    }
    const dataUrl = imgBuffer.byteLength <= 25e5 ? `data:${mimeType};base64,${imgBuffer.toString("base64")}` : void 0;
    const displayUrl = dataUrl || savedUrl;
    scenes[idx] = { ...scene, generatedImageUrl: displayUrl, imagePrompt: effectivePrompt };
    const mediaRec = stateStore.addMediaAsset({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      url: displayUrl,
      filename: path7.basename(savedUrl),
      originalName: `${project.title}-Scene-${scene.number}.png`,
      mimeType,
      sizeBytes: imgBuffer.byteLength,
      kind: "image",
      category: "campaign_creatives",
      tags: ["storyboard", `scene-${scene.number}`, project.id],
      description: `Storyboard frame for ${project.title} Scene ${scene.number}: ${scene.beat}`
    });
    const updated = stateStore.upsertContentProject({
      ...project,
      storyboardScenes: scenes,
      thumbUrl: project.thumbUrl || displayUrl
    });
    res.json({
      imageUrl: savedUrl,
      ...dataUrl ? { dataUrl } : {},
      mediaAsset: mediaRec,
      project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) }
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router6.post("/projects/:id/production-plan", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  if (!project.scriptApproved) {
    res.status(409).json({
      error: "Script approval required before generating video production plan.",
      blockers: ["Script not approved"]
    });
    return;
  }
  if (project.storyboardScenes && project.storyboardScenes.length > 0 && !project.storyboardApproved) {
    res.status(409).json({
      error: "Storyboard approval required before starting video production.",
      blockers: ["Storyboard not approved"]
    });
    return;
  }
  const {
    formatType = project.formatType || "short_form",
    method = project.productionMethod || "hybrid",
    aspectRatio = formatType === "long_form" ? "16:9" : "9:16",
    durationTargetSec = formatType === "long_form" ? 180 : 30,
    presenterId,
    presenterName,
    voiceName,
    voiceoverUrl,
    generateWithAi = false,
    business,
    model
  } = req.body;
  let shotList = [
    {
      sceneNumber: "01",
      visualDirection: formatType === "long_form" ? "Wide presenter intro + screen capture overlay" : "Tight punch-in hook frame with bold caption",
      audioLine: project.hook || project.title,
      assetHint: "talking_head_clips or product_demo_video",
      durationSec: formatType === "long_form" ? 20 : 5
    },
    {
      sceneNumber: "02",
      visualDirection: "Product workflow demo showing real outcome",
      audioLine: project.script || project.brief || "Walkthrough of core product proof",
      assetHint: "product_screenshot or raw_screen_recordings",
      durationSec: formatType === "long_form" ? 120 : 18
    },
    {
      sceneNumber: "03",
      visualDirection: "Branded CTA end-card with logo & next step",
      audioLine: project.cta || "Try it today via link in bio",
      assetHint: "logo & brand_assets",
      durationSec: formatType === "long_form" ? 40 : 7
    }
  ];
  if (generateWithAi && process.env.GEMINI_API_KEY?.trim()) {
    try {
      const ai = getGeminiClient();
      const selectedModel = resolveTextModel(model);
      const aiResp = await runTrackedAiCall(
        {
          workspaceId: ctx.workspaceId,
          actorUid: ctx.actorUid,
          endpoint: "/api/projects/:id/production-plan",
          agent: "Video Production Planner",
          model: selectedModel,
          creditsEstimated: 20
        },
        () => ai.models.generateContent({
          model: selectedModel,
          contents: `Build a ${formatType} (${method}) video production shot list for "${project.title}".
${buildBusinessContextPrompt(business)}
Aspect Ratio: ${aspectRatio}, Target Duration: ${durationTargetSec}s
Script:
${project.script || project.brief || project.title}

Return ONLY valid JSON:
{
  "shotList": [
    { "sceneNumber": "01", "visualDirection": "string", "audioLine": "string", "assetHint": "string", "durationSec": 6 }
  ]
}`,
          config: {
            thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
            responseMimeType: "application/json"
          }
        })
      );
      const parsed = parseJsonSafe(aiResp.text, {});
      if (parsed.shotList?.length) shotList = parsed.shotList;
    } catch {
    }
  }
  const plan = {
    formatType,
    method,
    aspectRatio,
    durationTargetSec,
    presenterId,
    presenterName,
    voiceName,
    voiceoverUrl,
    shotList,
    capabilityNote: method === "ai_assisted" ? "Uses Gemini Omni video generation + TTS voiceover + FFmpeg assembly. Presenter photos animate visually without claiming frame-accurate neural lip-sync." : method === "traditional" ? "Uses human-filmed presenter footage, screen recordings, and FFmpeg timeline editing without synthetic avatar generation." : "Hybrid production: combines real product screen recordings/presenter footage with AI voiceover and B-roll transitions.",
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const nextStatus = project.scriptApproved && (project.status === "SCRIPT_APPROVED" || project.status === "STORYBOARD_APPROVED" || project.status === "PLANNED") ? "VIDEO_PENDING" : project.status;
  const updated = stateStore.upsertContentProject({
    ...project,
    formatType,
    productionMethod: method,
    videoProductionPlan: plan,
    status: nextStatus
  });
  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) }, plan });
});
router6.post("/projects/:id/approve-final", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const project = stateStore.getContentProjectById(String(req.params.id), ctx.workspaceId);
  if (!project) {
    res.status(404).json({ error: "Content project not found." });
    return;
  }
  const blockers = [];
  if (!project.scriptApproved) blockers.push("Script is not approved");
  if (!project.videoUrl && !project.editedVideoUrl && !project.thumbUrl) {
    blockers.push("Video or rendered creative asset must be attached before final approval");
  }
  const caption = req.body?.caption?.trim() || project.caption?.trim() || "";
  if (!caption) blockers.push("Platform caption is required before final approval");
  if (blockers.length > 0) {
    res.status(409).json({
      error: `Final approval blocked: ${blockers.join("; ")}`,
      blockers
    });
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updated = stateStore.upsertContentProject({
    ...project,
    caption,
    finalApproved: true,
    finalApprovedAt: now,
    status: "APPROVED_FOR_PUBLISHING"
  });
  if (updated.calendarEntryId) {
    const cal = stateStore.getCalendarEntryById(updated.calendarEntryId, ctx.workspaceId);
    if (cal) {
      stateStore.upsertCalendarEntry({
        ...cal,
        status: "Ready",
        projectStatus: updated.status,
        caption,
        thumbUrl: updated.thumbUrl || cal.thumbUrl
      });
    }
  }
  stateStore.addAuditLog({
    workspaceId: ctx.workspaceId,
    actorUid: ctx.actorUid,
    action: "project.final.approve",
    target: updated.id,
    status: "allowed",
    detail: `Final human creative approval granted for "${updated.title}"`
  });
  res.json({ project: { ...updated, blockingReasons: getProjectBlockingReasons(updated) } });
});
router6.get("/presenters", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({ presenters: stateStore.listPresenters(ctx.workspaceId) });
});
router6.post("/presenters", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = req.body;
  if (!body.name?.trim()) {
    res.status(400).json({ error: "Presenter name is required." });
    return;
  }
  if (!body.consentConfirmed) {
    res.status(400).json({
      error: "Likeness consent confirmation (consentConfirmed: true) is required before saving a presenter preset."
    });
    return;
  }
  const presenter = stateStore.upsertPresenter({
    id: body.id,
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    name: body.name.trim(),
    role: body.role?.trim() || "Brand Presenter",
    avatarKind: body.avatarKind || "uploaded_photo",
    mediaUrl: body.mediaUrl || "",
    voiceName: body.voiceName || "Kore",
    styleNotes: body.styleNotes?.trim() || "Direct to camera, confident pacing",
    consentConfirmed: true,
    consentOwner: body.consentOwner?.trim() || ctx.actorUid
  });
  res.json({ presenter });
});
router6.delete("/presenters/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const ok = stateStore.deletePresenter(String(req.params.id), ctx.workspaceId);
  if (!ok) {
    res.status(404).json({ error: "Presenter not found." });
    return;
  }
  res.json({ deleted: true });
});
async function executeAutomationWorkflow(workflow) {
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const stepLogs = [];
  let status = "completed";
  let attempts = 0;
  let linkedProject;
  const maxAttempts = Math.max(1, Math.min(3, workflow.retryLimit || 1));
  while (attempts < maxAttempts) {
    attempts++;
    stepLogs.length = 0;
    try {
      for (const node of workflow.nodes) {
        if (node.type === "trigger") {
          stepLogs.push({
            nodeId: node.id,
            label: node.label,
            status: "ok",
            detail: `Triggered (${workflow.triggerType})`
          });
        } else if (node.type === "condition") {
          const minQa = Number(workflow.conditionMinQaScore ?? node.config?.minQaScore ?? 0);
          if (minQa > 0) {
            const projects = stateStore.listContentProjects(workflow.workspaceId);
            const passing = projects.filter((p) => (p.qaScore ?? 0) >= minQa);
            if (projects.length > 0 && passing.length === 0) {
              stepLogs.push({
                nodeId: node.id,
                label: node.label,
                status: "skipped",
                detail: `Condition blocked: 0 projects meet minimum QA score ${minQa}.`
              });
              status = "skipped_condition";
              break;
            }
          }
          stepLogs.push({
            nodeId: node.id,
            label: node.label,
            status: "ok",
            detail: "Condition passed"
          });
        } else if (node.type === "approval_gate" || workflow.requireHumanApproval && node.label.toLowerCase().includes("publish")) {
          if (!linkedProject) {
            const existingProjects = stateStore.listContentProjects(workflow.workspaceId);
            linkedProject = existingProjects.find((p) => !p.scriptApproved || !p.finalApproved);
          }
          stepLogs.push({
            nodeId: node.id,
            label: node.label,
            status: "paused",
            detail: linkedProject ? `Paused at Human Approval Gate for "${linkedProject.title}" (${linkedProject.status}).` : "Paused at Human Approval Gate prior to external publishing/spend."
          });
          status = "awaiting_approval";
          stateStore.addNotification({
            workspaceId: workflow.workspaceId,
            ownerUid: workflow.ownerUid,
            title: linkedProject ? `Approval needed: ${linkedProject.title}` : `Workflow awaiting approval: ${workflow.name}`,
            message: linkedProject ? `Review "${linkedProject.title}" and approve script or final creative to continue.` : `Reached "${node.label}". Review deliverables before approving external action.`,
            category: "automation",
            severity: "warning",
            actionPage: linkedProject && !linkedProject.scriptApproved ? "Content Studio" : "Automation Workflows"
          });
          break;
        } else {
          const actionType = String(node.config?.actionType || node.label).toLowerCase();
          if (actionType.includes("seo")) {
            const snap = stateStore.getWorkspaceSnapshot(workflow.workspaceId);
            stepLogs.push({
              nodeId: node.id,
              label: node.label,
              status: "ok",
              detail: snap?.websiteUrl ? `Verified SEO sweep state for ${snap.websiteUrl}` : "Checked workspace SEO readiness"
            });
          } else if (actionType.includes("script") || actionType.includes("content")) {
            const projects = stateStore.listContentProjects(workflow.workspaceId);
            const snap = stateStore.getWorkspaceSnapshot(workflow.workspaceId);
            let targetProj = projects.find(
              (p) => p.status === "AWAITING_SCRIPT_APPROVAL" || p.status === "SCRIPT_READY" || p.status === "SCRIPT_PENDING" || p.status === "PLANNED"
            );
            if (!targetProj) {
              const title = `${workflow.name} Script Draft`;
              const brandLabel = snap?.businessName || "your brand";
              const hook = `Stop guessing what converts for ${brandLabel} \u2014 here is the repeatable workflow.`;
              const body = `[0:00-0:04] Hook: ${hook}
[0:04-0:20] Proof: Walk through one concrete customer workflow powered by ${brandLabel}.
[0:20-0:30] CTA: Try ${brandLabel} today using the link in bio.`;
              targetProj = stateStore.upsertContentProject({
                workspaceId: workflow.workspaceId,
                ownerUid: workflow.ownerUid,
                title,
                platform: "Instagram Reels",
                status: "AWAITING_SCRIPT_APPROVAL",
                owner: workflow.name,
                progress: 45,
                brief: workflow.nlPrompt || workflow.description || workflow.name,
                hook,
                script: body,
                cta: `Explore ${brandLabel}`,
                qaScore: workflow.conditionMinQaScore ?? 85,
                formatType: "short_form",
                productionMethod: "hybrid",
                scriptApproved: false,
                sourceType: "manual"
              });
            }
            linkedProject = targetProj;
            stepLogs.push({
              nodeId: node.id,
              label: node.label,
              status: "ok",
              detail: `Prepared "${targetProj.title}" (${targetProj.status}) for review & approval`
            });
          } else {
            stepLogs.push({
              nodeId: node.id,
              label: node.label,
              status: "ok",
              detail: `Executed step: ${node.label}`
            });
          }
        }
      }
      break;
    } catch (err) {
      stepLogs.push({
        nodeId: "error",
        label: "Execution Retry",
        status: "error",
        detail: err instanceof Error ? err.message : String(err)
      });
      if (attempts >= maxAttempts) {
        status = "failed";
      }
    }
  }
  const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
  const summary = status === "awaiting_approval" ? linkedProject ? `Awaiting approval for "${linkedProject.title}"` : "Paused safely at human approval gate" : status === "skipped_condition" ? "Skipped execution because condition threshold was not met" : status === "failed" ? "Execution failed after retries" : `Completed ${stepLogs.length} steps in ${attempts} attempt(s)`;
  stateStore.upsertWorkflow({
    ...workflow,
    lastRunAt: finishedAt,
    lastStatus: summary
  });
  return stateStore.addWorkflowExecution({
    workflowId: workflow.id,
    workflowName: workflow.name,
    workspaceId: workflow.workspaceId,
    ownerUid: workflow.ownerUid,
    startedAt,
    finishedAt,
    status,
    attempts,
    stepLogs,
    summary,
    projectId: linkedProject?.id,
    projectTitle: linkedProject?.title,
    projectStatus: linkedProject?.status
  });
}
router6.get("/workflows", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({
    workflows: stateStore.listWorkflows(ctx.workspaceId),
    executions: stateStore.listWorkflowExecutions(ctx.workspaceId)
  });
});
router6.get("/workflows/executions", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const workflowId = typeof req.query.workflowId === "string" ? req.query.workflowId : void 0;
  res.json({
    executions: stateStore.listWorkflowExecutions(ctx.workspaceId, workflowId)
  });
});
router6.post("/workflows", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = req.body;
  if (!body.name?.trim()) {
    res.status(400).json({ error: "Workflow name is required." });
    return;
  }
  const enabled = Boolean(body.enabled);
  const confirmedToActivate = Boolean(body.confirmedToActivate);
  if (enabled && !confirmedToActivate) {
    res.status(400).json({
      error: "Activating an autonomous workflow requires explicit user confirmation (confirmedToActivate: true)."
    });
    return;
  }
  const wf = stateStore.upsertWorkflow({
    id: body.id,
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    name: body.name.trim(),
    description: body.description?.trim() || "Custom marketing workflow",
    triggerType: body.triggerType || "manual",
    intervalMinutes: body.intervalMinutes ? Math.max(5, Number(body.intervalMinutes)) : void 0,
    conditionMinQaScore: body.conditionMinQaScore !== void 0 ? Number(body.conditionMinQaScore) : void 0,
    requireHumanApproval: body.requireHumanApproval ?? true,
    retryLimit: Math.min(3, Math.max(1, Number(body.retryLimit) || 2)),
    enabled,
    confirmedToActivate,
    nlPrompt: body.nlPrompt,
    nodes: Array.isArray(body.nodes) && body.nodes.length > 0 ? body.nodes : [
      { id: "n1", type: "trigger", label: "Manual or Schedule Trigger", config: {} },
      { id: "n2", type: "action", label: "Prepare Content Deliverables", config: { actionType: "content" } },
      { id: "n3", type: "approval_gate", label: "Human Review Before Publish", config: {} }
    ]
  });
  res.json({ workflow: wf });
});
router6.patch("/workflows/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getWorkflowById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Workflow not found." });
    return;
  }
  const patch = req.body;
  const nextEnabled = patch.enabled !== void 0 ? Boolean(patch.enabled) : existing.enabled;
  const nextConfirmed = patch.confirmedToActivate !== void 0 ? Boolean(patch.confirmedToActivate) : existing.confirmedToActivate;
  if (nextEnabled && !nextConfirmed) {
    res.status(400).json({
      error: "Activating an automated workflow requires confirmedToActivate: true."
    });
    return;
  }
  const updated = stateStore.upsertWorkflow({
    ...existing,
    ...patch,
    id: existing.id,
    workspaceId: ctx.workspaceId,
    ownerUid: existing.ownerUid
  });
  res.json({ workflow: updated });
});
router6.delete("/workflows/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const ok = stateStore.deleteWorkflow(String(req.params.id), ctx.workspaceId);
  if (!ok) {
    res.status(404).json({ error: "Workflow not found." });
    return;
  }
  res.json({ deleted: true });
});
router6.post("/workflows/generate-nl", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const { prompt, business, model } = req.body;
  if (!prompt?.trim()) {
    res.status(400).json({ error: "Describe the workflow you want to build." });
    return;
  }
  try {
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/workflows/generate-nl",
        agent: "Workflow Architect",
        model: selectedModel,
        creditsEstimated: 20
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents: `Convert this plain-English automation request into a structured Marketing OS workflow definition.
${buildBusinessContextPrompt(business)}
User Request: "${prompt.trim()}"

Return ONLY valid JSON:
{
  "name": "Short workflow name",
  "description": "What this workflow automates",
  "triggerType": "manual | interval | event",
  "intervalMinutes": 1440,
  "conditionMinQaScore": 80,
  "requireHumanApproval": true,
  "retryLimit": 2,
  "nodes": [
    { "id": "n1", "type": "trigger", "label": "Trigger step", "config": {} },
    { "id": "n2", "type": "condition", "label": "Check QA threshold >= 80", "config": { "minQaScore": 80 } },
    { "id": "n3", "type": "action", "label": "Prepare content & SEO deliverables", "config": { "actionType": "content" } },
    { "id": "n4", "type": "approval_gate", "label": "Human approval before publish", "config": {} }
  ]
}`,
        config: {
          systemInstruction: "Always include a human approval_gate node before external publishing or paid ad changes.",
          thinkingConfig: thinkingConfigForModel(selectedModel, "low"),
          responseMimeType: "application/json"
        }
      })
    );
    const parsed = parseJsonSafe(response.text, {});
    const draft = stateStore.upsertWorkflow({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      name: parsed.name || "AI Generated Workflow",
      description: parsed.description || prompt.trim(),
      triggerType: parsed.triggerType === "interval" ? "interval" : parsed.triggerType === "event" ? "event" : "manual",
      intervalMinutes: parsed.intervalMinutes || 1440,
      conditionMinQaScore: parsed.conditionMinQaScore,
      requireHumanApproval: parsed.requireHumanApproval ?? true,
      retryLimit: Math.min(3, Math.max(1, Number(parsed.retryLimit) || 2)),
      enabled: false,
      confirmedToActivate: false,
      nlPrompt: prompt.trim(),
      nodes: Array.isArray(parsed.nodes) && parsed.nodes.length ? parsed.nodes : [
        { id: "n1", type: "trigger", label: "Trigger", config: {} },
        { id: "n2", type: "action", label: prompt.trim().slice(0, 60), config: {} },
        { id: "n3", type: "approval_gate", label: "Human approval gate", config: {} }
      ]
    });
    res.json({ workflow: draft });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router6.post("/workflows/:id/run", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const wf = stateStore.getWorkflowById(String(req.params.id), ctx.workspaceId);
  if (!wf) {
    res.status(404).json({ error: "Workflow not found." });
    return;
  }
  const log = await executeAutomationWorkflow(wf);
  res.json({
    execution: log,
    workflow: stateStore.getWorkflowById(wf.id, ctx.workspaceId)
  });
});
var pipeline_default = router6;

// server/routes/growthAnalytics.ts
import { Router as Router7 } from "express";
var router7 = Router7();
function getRangeSpecFromReq(req) {
  const q = req.query;
  const range = q.range || req.body?.range || "30d";
  const startDate = q.startDate || req.body?.startDate;
  const endDate = q.endDate || req.body?.endDate;
  return resolveDateRange(range, startDate, endDate);
}
router7.get("/growth/recommendations", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const conns = stateStore.listAnalyticsConnections(ctx.workspaceId);
  const connectedIds = conns.filter((c) => c.status === "connected").map((c) => c.provider);
  const stored = stateStore.getIntegrationRecommendations(ctx.workspaceId);
  if (stored.length > 0) {
    res.json({
      recommendations: stored.map((item) => ({
        ...item,
        connected: connectedIds.includes(String(item.provider))
      }))
    });
    return;
  }
  const snap = stateStore.getWorkspaceSnapshot(ctx.workspaceId);
  const fallback = buildIntegrationRecommendations({
    websiteUrl: snap?.websiteUrl,
    connectedProviders: connectedIds
  });
  res.json({ recommendations: fallback });
});
router7.post("/growth/audit-tracking", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const { websiteUrl, products, channels } = req.body;
  const snap = stateStore.getWorkspaceSnapshot(ctx.workspaceId);
  const rawUrl = (websiteUrl || snap?.websiteUrl || "").trim();
  if (!rawUrl) {
    res.status(400).json({ error: "Provide a website URL to audit installed tracking SDKs." });
    return;
  }
  try {
    const safeUrl = await normalizeAndAssertPublicUrl(rawUrl);
    const { response, finalUrl } = await safePublicFetch(safeUrl, {
      timeoutMs: 12e3,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MarketingOSBot/1.0; +https://marketingos.app)",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    if (!response.ok) {
      res.status(422).json({ error: `Target site returned HTTP ${response.status}` });
      return;
    }
    const html = await response.text();
    const detected = detectTrackingTechnologies(html);
    const conns = stateStore.listAnalyticsConnections(ctx.workspaceId);
    const connectedProviders = conns.filter((c) => c.status === "connected").map((c) => c.provider);
    const recommendations = buildIntegrationRecommendations({
      websiteUrl: finalUrl,
      products,
      channels,
      tracking: detected,
      connectedProviders
    });
    stateStore.setIntegrationRecommendations(
      ctx.workspaceId,
      recommendations
    );
    res.json({
      auditedUrl: finalUrl,
      auditedAt: (/* @__PURE__ */ new Date()).toISOString(),
      detectedSdks: detected.sdks.map((s) => ({
        ...s,
        connectedInWorkspace: connectedProviders.includes(s.provider)
      })),
      detectedStoreLinks: detected.storeLinks,
      eventTaxonomyGaps: detected.eventTaxonomyGaps,
      recommendations
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to audit website tracking" });
  }
});
router7.get("/growth/connections", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const list = stateStore.listAnalyticsConnections(ctx.workspaceId).map(sanitizeConnectionSummary);
  res.json({ connections: list });
});
router7.post("/growth/connections", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const {
    provider,
    authMode = "api_key",
    apiKey,
    hostUrl,
    projectId,
    projectName,
    projectUrl,
    serviceAccountJson,
    oauthAccessToken,
    packageName,
    tableMappings,
    runSync = true
  } = req.body;
  if (!provider) {
    res.status(400).json({ error: "Analytics provider is required." });
    return;
  }
  if (provider === "posthog" && !apiKey?.trim()) {
    res.status(400).json({ error: "PostHog Personal API Key is required." });
    return;
  }
  if (provider === "supabase" && (!projectUrl?.trim() || !apiKey?.trim())) {
    res.status(400).json({ error: "Supabase Project URL and API Key are required." });
    return;
  }
  if (provider === "firebase" && !projectId?.trim()) {
    res.status(400).json({ error: "Firebase Project ID is required." });
    return;
  }
  if (provider === "google_play" && !packageName?.trim()) {
    res.status(400).json({ error: "Android package name (e.g. com.company.app) is required." });
    return;
  }
  const secretHintSource = apiKey || oauthAccessToken || serviceAccountJson || projectId || packageName || "";
  const encryptedCredentials = encryptCredentialPayload({
    apiKey: apiKey?.trim(),
    hostUrl: hostUrl?.trim(),
    projectUrl: projectUrl?.trim(),
    projectId: projectId?.trim(),
    serviceAccountJson: serviceAccountJson?.trim(),
    oauthAccessToken: oauthAccessToken?.trim(),
    packageName: packageName?.trim()
  });
  const saved = stateStore.upsertAnalyticsConnection({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    provider,
    providerLabel: getProviderLabel(provider),
    authMode,
    encryptedCredentials,
    maskedKeyHint: maskSecret(secretHintSource),
    selectedProjectId: (projectId || packageName || "").trim() || void 0,
    selectedProjectName: (projectName || projectId || packageName || "").trim() || void 0,
    hostUrl: (hostUrl || projectUrl || "").trim() || void 0,
    tableMappings,
    status: "connected",
    completenessStatus: "connected_no_events",
    statusDetail: "Credentials encrypted and stored server-side. Ready to test/sync."
  });
  stateStore.addAuditLog({
    workspaceId: ctx.workspaceId,
    actorUid: ctx.actorUid,
    action: "growth.connection.upsert",
    target: provider,
    status: "allowed",
    detail: `Encrypted credential stored for ${getProviderLabel(provider)}`
  });
  if (runSync) {
    const rangeSpec = getRangeSpecFromReq(req);
    const { connection, snapshot } = await testAndSyncProviderConnection(saved, rangeSpec);
    res.json({
      connection: sanitizeConnectionSummary(connection),
      snapshot
    });
    return;
  }
  res.json({ connection: sanitizeConnectionSummary(saved) });
});
router7.patch("/growth/connections/:id/config", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getAnalyticsConnectionById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Analytics connection not found." });
    return;
  }
  const { selectedProjectId, selectedProjectName, tableMappings, resync = true } = req.body;
  const updated = stateStore.upsertAnalyticsConnection({
    ...existing,
    selectedProjectId: selectedProjectId ?? existing.selectedProjectId,
    selectedProjectName: selectedProjectName ?? existing.selectedProjectName,
    tableMappings: tableMappings ?? existing.tableMappings
  });
  if (resync) {
    const rangeSpec = getRangeSpecFromReq(req);
    const { connection, snapshot } = await testAndSyncProviderConnection(updated, rangeSpec);
    res.json({ connection: sanitizeConnectionSummary(connection), snapshot });
    return;
  }
  res.json({ connection: sanitizeConnectionSummary(updated) });
});
router7.post("/growth/connections/:id/test", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getAnalyticsConnectionById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Analytics connection not found." });
    return;
  }
  const rangeSpec = getRangeSpecFromReq(req);
  const { connection, snapshot } = await testAndSyncProviderConnection(existing, rangeSpec);
  res.json({ connection: sanitizeConnectionSummary(connection), snapshot });
});
router7.post("/growth/connections/:id/sync", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const existing = stateStore.getAnalyticsConnectionById(String(req.params.id), ctx.workspaceId);
  if (!existing) {
    res.status(404).json({ error: "Analytics connection not found." });
    return;
  }
  const rangeSpec = getRangeSpecFromReq(req);
  const { connection, snapshot } = await testAndSyncProviderConnection(existing, rangeSpec);
  res.json({ connection: sanitizeConnectionSummary(connection), snapshot });
});
router7.delete("/growth/connections/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const deleted = stateStore.deleteAnalyticsConnection(String(req.params.id), ctx.workspaceId);
  if (!deleted) {
    res.status(404).json({ error: "Analytics connection not found." });
    return;
  }
  stateStore.addAuditLog({
    workspaceId: ctx.workspaceId,
    actorUid: ctx.actorUid,
    action: "growth.connection.delete",
    target: String(req.params.id),
    status: "allowed",
    detail: "Revoked analytics credentials and deleted cached provider snapshots."
  });
  res.json({ deleted: true });
});
router7.get("/growth/dashboard", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const rangeSpec = getRangeSpecFromReq(req);
  const compareEnabled = req.query.compare !== "false";
  const forceRefresh = req.query.refresh === "true";
  const conns = stateStore.listAnalyticsConnections(ctx.workspaceId);
  if (forceRefresh && conns.length > 0) {
    await Promise.all(conns.map((c) => testAndSyncProviderConnection(c, rangeSpec)));
  }
  const latestConns = stateStore.listAnalyticsConnections(ctx.workspaceId);
  const allSnapshots = stateStore.listGrowthSnapshots(ctx.workspaceId);
  const providerCards = latestConns.map((conn) => {
    const snap = allSnapshots.find((s) => s.connectionId === conn.id && s.periodKey === rangeSpec.periodKey) || allSnapshots.find((s) => s.connectionId === conn.id);
    return {
      connectionId: conn.id,
      provider: conn.provider,
      providerLabel: conn.providerLabel,
      projectOrProperty: snap?.projectOrProperty || conn.selectedProjectName || conn.providerLabel,
      completenessStatus: snap?.completenessStatus || conn.completenessStatus,
      statusDetail: snap?.statusDetail || conn.statusDetail,
      retrievedAt: snap?.retrievedAt || conn.lastSyncedAt || conn.updatedAt,
      metrics: snap?.metrics || [],
      timeSeries: snap?.timeSeries || [],
      topPagesOrEvents: snap?.topPagesOrEvents || [],
      channels: snap?.channels || []
    };
  });
  const connectedProviders = latestConns.filter((c) => c.status === "connected").map((c) => c.provider);
  const storedRecs = stateStore.getIntegrationRecommendations(ctx.workspaceId);
  const wsSnap = stateStore.getWorkspaceSnapshot(ctx.workspaceId);
  const recommendations = storedRecs.length > 0 ? storedRecs.map((r) => ({ ...r, connected: connectedProviders.includes(String(r.provider)) })) : buildIntegrationRecommendations({
    websiteUrl: wsSnap?.websiteUrl,
    connectedProviders
  });
  res.json({
    workspaceId: ctx.workspaceId,
    range: rangeSpec.range,
    reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
    previousPeriod: { startDate: rangeSpec.prevStartDate, endDate: rangeSpec.prevEndDate },
    compareEnabled,
    overlapWarning: "Per-provider metrics are intentionally kept separate because PostHog distinct_ids, GA4 sessions/activeUsers, Firebase Auth accounts, and Supabase table counts use incompatible identity models.",
    connections: latestConns.map(sanitizeConnectionSummary),
    providerCards,
    recommendations,
    strategyFeedback: buildStrategyFeedbackComparison(ctx.workspaceId)
  });
});
router7.post("/growth/funnel", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const { stages = [] } = req.body;
  const snapshots = stateStore.listGrowthSnapshots(ctx.workspaceId);
  const results = stages.map((st, idx) => {
    const snap = snapshots.find((s) => s.provider === st.provider);
    if (!snap) {
      return {
        stageName: st.stageName,
        provider: st.provider,
        sourceMapping: `${getProviderLabel(st.provider)} \xB7 Not connected`,
        count: null,
        conversionFromPreviousPct: null,
        completenessStatus: "not_connected",
        note: `Connect ${getProviderLabel(st.provider)} to evaluate this funnel step.`
      };
    }
    const metricObj = snap.metrics.find((m) => m.key === st.metricKey) || snap.metrics[0];
    const count = typeof metricObj?.value === "number" ? metricObj.value : null;
    return {
      stageName: st.stageName,
      provider: st.provider,
      sourceMapping: `${snap.providerLabel} \xB7 ${metricObj?.label || st.metricKey || "Primary metric"}`,
      count,
      conversionFromPreviousPct: idx === 0 ? 100 : null,
      completenessStatus: snap.completenessStatus,
      note: count === null ? snap.statusDetail : void 0
    };
  });
  for (let i = 1; i < results.length; i++) {
    results[i].conversionFromPreviousPct = safeRatioPct(results[i].count, results[i - 1].count);
  }
  res.json({ stages: results });
});
router7.get("/growth/strategy-feedback", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({ feedback: buildStrategyFeedbackComparison(ctx.workspaceId) });
});
router7.post("/growth/analyst/ask", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const { question, business, model } = req.body;
  if (!question?.trim()) {
    res.status(400).json({ error: "Ask a question for the Business Growth Analyst." });
    return;
  }
  try {
    const snapshots = stateStore.listGrowthSnapshots(ctx.workspaceId);
    const conns = stateStore.listAnalyticsConnections(ctx.workspaceId).map(sanitizeConnectionSummary);
    const strategies = stateStore.listStrategies(ctx.workspaceId);
    const seoReports = stateStore.getSeoAuditReports(ctx.workspaceId).slice(0, 2);
    const groundedEvidence = {
      connectedSources: conns.map((c) => ({
        provider: c.providerLabel,
        project: c.selectedProjectName,
        completenessStatus: c.completenessStatus,
        statusDetail: c.statusDetail,
        lastSyncedAt: c.lastSyncedAt
      })),
      retrievedMetricsByProvider: snapshots.map((s) => ({
        provider: s.providerLabel,
        period: `${s.startDate} to ${s.endDate}`,
        completenessStatus: s.completenessStatus,
        metrics: s.metrics.map((m) => ({
          label: m.label,
          value: m.value,
          previousValue: m.previousValue,
          growthPct: m.growthPct
        })),
        topPagesOrEvents: s.topPagesOrEvents.slice(0, 5),
        channels: s.channels.slice(0, 5)
      })),
      activeStrategy: strategies[0] ? {
        title: strategies[0].title,
        northStarMetric: strategies[0].northStarMetric,
        pillars: strategies[0].contentPillars
      } : null,
      latestSeoScore: seoReports[0]?.healthScore ?? null
    };
    const ai = getGeminiClient();
    const selectedModel = resolveTextModel(model);
    const response = await runTrackedAiCall(
      {
        workspaceId: ctx.workspaceId,
        actorUid: ctx.actorUid,
        endpoint: "/api/growth/analyst/ask",
        agent: "Business Growth Analyst",
        model: selectedModel,
        creditsEstimated: 30
      },
      () => ai.models.generateContent({
        model: selectedModel,
        contents: `Answer the founder's growth question strictly using the verified telemetry below.
${buildBusinessContextPrompt(business)}

Verified Telemetry & Context JSON:
${JSON.stringify(groundedEvidence, null, 2)}

Founder Question:
${question}

CRITICAL HONESTY RULES:
1. Cite ONLY numbers that exist in Verified Telemetry JSON above. Never invent traffic, conversion rates, or benchmarks.
2. If data needed to answer is missing or \`not_connected\` / \`permission_restricted\`, state clearly which provider/metric is missing and what connecting it unlocks.
3. Keep separate provider user definitions distinct (never add PostHog users + GA4 users + Firebase Auth users together).

Return ONLY valid JSON:
{
  "answer": "Clear, structured answer citing exact provenance and numbers",
  "dataGaps": ["Any missing source or permission limitation blocking full insight"],
  "recommendedActions": [
    { "title": "Action", "reason": "Grounded reason", "priority": "High" | "Medium" | "Low" }
  ]
}`,
        config: {
          systemInstruction: "You are an analytical Chief Growth Officer. Ground every metric claim in the retrieved JSON payload and disclose all telemetry gaps.",
          thinkingConfig: thinkingConfigForModel(selectedModel, "medium"),
          responseMimeType: "application/json"
        }
      })
    );
    const parsed = parseJsonSafe(response.text);
    res.json({ model: selectedModel, ...parsed });
  } catch (err) {
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});
router7.get("/growth/reports", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({ reports: stateStore.listGrowthReports(ctx.workspaceId) });
});
router7.post("/growth/reports/generate", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const { cadence = "weekly", range = "7d", startDate, endDate, saveToMemory = false } = req.body;
  const rangeSpec = resolveDateRange(
    range || (cadence === "daily" ? "today" : cadence === "monthly" ? "30d" : "7d"),
    startDate,
    endDate
  );
  const snapshots = stateStore.listGrowthSnapshots(ctx.workspaceId);
  const conns = stateStore.listAnalyticsConnections(ctx.workspaceId);
  const feedback = buildStrategyFeedbackComparison(ctx.workspaceId);
  const highlights = conns.map((c) => {
    const snap = snapshots.find((s) => s.connectionId === c.id);
    const keyFindings = (snap?.metrics || []).map((m) => {
      const val = m.value !== null && m.value !== void 0 ? String(m.value) : "Unavailable";
      const growth = typeof m.growthPct === "number" ? ` (${m.growthPct >= 0 ? "+" : ""}${m.growthPct}% vs prev)` : "";
      return `${String(m.label)}: ${val}${growth}`;
    });
    return {
      provider: c.providerLabel,
      status: snap?.completenessStatus || c.completenessStatus,
      keyFindings: keyFindings.length > 0 ? keyFindings : [snap?.statusDetail || c.statusDetail]
    };
  });
  const recs = [];
  if (conns.length === 0) {
    recs.push("Connect PostHog, GA4, Search Console, or Supabase in Integrations to unlock verified performance reporting.");
  }
  const missingRecs = stateStore.getIntegrationRecommendations(ctx.workspaceId).filter((r) => !conns.some((c) => c.provider === r.provider)).slice(0, 3);
  for (const r of missingRecs) {
    recs.push(`Connect ${String(r.providerLabel)}: ${String(r.whyRecommended)}`);
  }
  if (feedback) {
    recs.push(`Strategy Check (${feedback.strategyTitle}): ${feedback.summary}`);
  }
  const title = `${cadence[0].toUpperCase()}${cadence.slice(1)} Growth Intelligence Report (${rangeSpec.startDate} \u2192 ${rangeSpec.endDate})`;
  const executiveSummary = conns.length === 0 ? "No external analytics sources are connected to this workspace yet. Connect telemetry providers to replace gap disclosures with live conversion & acquisition data." : `Compiled verified metrics from ${conns.length} connected source(s) across ${rangeSpec.startDate} to ${rangeSpec.endDate}.`;
  const mdLines = [
    `# ${title}`,
    "",
    `Generated: ${(/* @__PURE__ */ new Date()).toISOString()}`,
    "",
    `## Executive Summary`,
    executiveSummary,
    "",
    `## Connected Data Sources`,
    ...highlights.length ? highlights.flatMap((h) => [
      `### ${h.provider} (${h.status})`,
      ...h.keyFindings.map((f) => `- ${f}`),
      ""
    ]) : ["- No analytics sources connected yet.", ""],
    `## Recommendations & Next Steps`,
    ...recs.map((r) => `- ${r}`)
  ];
  const report = stateStore.addGrowthReport({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    cadence,
    title,
    reportingPeriod: { startDate: rangeSpec.startDate, endDate: rangeSpec.endDate },
    executiveSummary,
    providerHighlights: highlights,
    recommendations: recs,
    markdown: mdLines.join("\n")
  });
  if (saveToMemory) {
    stateStore.addMemory({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      scope: "business",
      source: "verified_business",
      approved: true,
      title,
      content: `${executiveSummary} ${highlights.map((h) => `${h.provider}: ${h.keyFindings.join(", ")}`).join(" | ")}`,
      tags: ["growth-report", cadence]
    });
  }
  res.json({ report });
});
var growthAnalytics_default = router7;

// server/routes/operations.ts
import { Router as Router8 } from "express";
import { z as z2 } from "zod";
var router8 = Router8();
function getContext2(req) {
  const workspaceId = req.headers["x-workspace-id"] || (typeof req.query.workspaceId === "string" ? req.query.workspaceId : "") || (typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "") || "default";
  return {
    workspaceId: workspaceId.replace(/[^a-zA-Z0-9_-]/g, "") || "default",
    actorUid: req.user?.uid || "anonymous"
  };
}
function mapPlatformToToolkit2(platform) {
  const p = platform.toLowerCase();
  if (p.includes("instagram")) return "instagram";
  if (p.includes("facebook")) return "facebook";
  if (p.includes("tiktok")) return "tiktok";
  if (p.includes("youtube")) return "youtube";
  if (p.includes("linkedin")) return "linkedin";
  if (p === "x" || p.includes("twitter")) return "twitter";
  return p;
}
var ScheduleJobSchema = z2.object({
  title: z2.string().min(1).max(200),
  platform: z2.string().min(1).max(80),
  caption: z2.string().max(5e3).default(""),
  mediaUrl: z2.string().max(1e3).optional(),
  scheduledForIso: z2.string().min(4).max(64),
  approvedForAutoPublish: z2.boolean().default(false),
  idempotencyKey: z2.string().max(160).optional(),
  workspaceId: z2.string().max(128).optional()
});
var BillingCheckoutSchema = z2.object({
  provider: z2.enum(["stripe", "paystack"]).default("stripe"),
  planOrPack: z2.string().min(2).max(80),
  amountUsd: z2.number().min(1).max(1e4),
  creditsToGrant: z2.number().min(100).max(1e6),
  workspaceId: z2.string().max(128).optional()
});
router8.get("/notifications", (req, res) => {
  const { workspaceId } = getContext2(req);
  const items = stateStore.getNotifications(workspaceId);
  res.json({
    unreadCount: items.filter((n) => !n.read).length,
    notifications: items.slice(0, 40)
  });
});
router8.post("/notifications/:id/read", (req, res) => {
  const updated = stateStore.markNotificationRead(String(req.params.id));
  res.json({ ok: Boolean(updated), notification: updated });
});
router8.post("/notifications/read-all", (req, res) => {
  const { workspaceId } = getContext2(req);
  const changed = stateStore.markAllNotificationsRead(workspaceId);
  res.json({ ok: true, marked: changed });
});
router8.get("/audit/logs", (req, res) => {
  const { workspaceId } = getContext2(req);
  res.json({
    logs: stateStore.getAuditLogs(workspaceId).slice(0, 60),
    integrationLogs: stateStore.getIntegrationLogs(workspaceId).slice(0, 40)
  });
});
router8.get("/audit/ai-runs", (req, res) => {
  const { workspaceId } = getContext2(req);
  res.json({
    runs: stateStore.getAiRuns(workspaceId).slice(0, 60)
  });
});
router8.get("/video/jobs", (req, res) => {
  const { workspaceId } = getContext2(req);
  res.json({
    jobs: stateStore.getVideoJobs(workspaceId).slice(0, 30)
  });
});
router8.get("/video/jobs/:id", (req, res) => {
  const job = stateStore.getVideoJobById(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "Video render job not found." });
    return;
  }
  res.json({ job });
});
router8.get("/scheduler/jobs", (req, res) => {
  const { workspaceId } = getContext2(req);
  res.json({
    jobs: stateStore.getScheduledJobs(workspaceId)
  });
});
router8.post("/scheduler/jobs", (req, res) => {
  const parsed = ScheduleJobSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid schedule payload" });
    return;
  }
  const { workspaceId, actorUid } = getContext2(req);
  const { title, platform, caption, mediaUrl, scheduledForIso, approvedForAutoPublish } = parsed.data;
  const job = stateStore.addScheduledJob({
    workspaceId,
    ownerUid: actorUid,
    title,
    platform,
    caption,
    mediaUrl,
    scheduledForIso,
    approvedForAutoPublish,
    idempotencyKey: parsed.data.idempotencyKey || stateStore.newId("pub"),
    status: approvedForAutoPublish ? "scheduled" : "awaiting_confirmation"
  });
  stateStore.addNotification({
    workspaceId,
    ownerUid: actorUid,
    title: "Post Scheduled",
    message: `"${title}" scheduled for ${platform} (${scheduledForIso.slice(0, 16).replace("T", " ")}).`,
    category: "publishing",
    severity: "info",
    actionPage: "Publishing Queue"
  });
  res.json({ job });
});
router8.post("/scheduler/jobs/:id/confirm", (req, res) => {
  const { workspaceId, actorUid } = getContext2(req);
  const updated = stateStore.updateScheduledJob(String(req.params.id), {
    approvedForAutoPublish: true,
    status: "scheduled"
  });
  if (!updated) {
    res.status(404).json({ error: "Scheduled job not found." });
    return;
  }
  stateStore.addAuditLog({
    workspaceId,
    actorUid,
    action: "scheduler.job.approved",
    target: updated.id,
    status: "allowed",
    detail: `Approved scheduled post "${updated.title}" for automated execution`
  });
  res.json({ job: updated });
});
router8.delete("/scheduler/jobs/:id", (req, res) => {
  const updated = stateStore.updateScheduledJob(String(req.params.id), {
    status: "cancelled"
  });
  res.json({ cancelled: Boolean(updated), job: updated });
});
async function handleSearchConsoleRequest(req, res) {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const { workspaceId, actorUid } = ctx;
  const siteUrl = typeof req.body?.siteUrl === "string" ? req.body.siteUrl.trim() : typeof req.query.siteUrl === "string" ? req.query.siteUrl.trim() : "";
  if (!isComposioConfigured()) {
    res.json({
      connected: false,
      status: "Awaiting Credentials",
      sites: [],
      rows: [],
      topPages: [],
      lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return;
  }
  try {
    const { statuses } = await listComposioConnections(["google_search_console"], workspaceId);
    const active = statuses.google_search_console?.accounts.find((a) => a.status === "active");
    if (!active) {
      res.json({
        connected: false,
        status: "Setup Required",
        sites: [],
        rows: [],
        topPages: [],
        lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
        message: "Connect Google Search Console via Composio OAuth to pull live search queries & top-performing pages."
      });
      return;
    }
    const sitesRes = await executeComposioTool({
      toolkit: "google_search_console",
      toolSlug: "GOOGLE_SEARCH_CONSOLE_LIST_SITES",
      arguments: {},
      accountId: active.id,
      workspaceId,
      userId: actorUid
    });
    const targetSite = siteUrl || sitesRes.data?.siteEntry?.[0]?.siteUrl || "";
    let rows = [];
    let topPages = [];
    const end = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const start = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
    if (targetSite) {
      const [queryRes, pageRes] = await Promise.all([
        executeComposioTool({
          toolkit: "google_search_console",
          toolSlug: "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
          arguments: {
            siteUrl: targetSite,
            startDate: start,
            endDate: end,
            dimensions: ["query"],
            rowLimit: 20
          },
          accountId: active.id,
          workspaceId,
          userId: actorUid
        }).catch(() => ({ data: { rows: [] } })),
        executeComposioTool({
          toolkit: "google_search_console",
          toolSlug: "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
          arguments: {
            siteUrl: targetSite,
            startDate: start,
            endDate: end,
            dimensions: ["page"],
            rowLimit: 20
          },
          accountId: active.id,
          workspaceId,
          userId: actorUid
        }).catch(() => ({ data: { rows: [] } }))
      ]);
      rows = queryRes.data?.rows || [];
      topPages = pageRes.data?.rows || [];
    }
    res.json({
      connected: true,
      status: "connected",
      sourceType: "live_api",
      sites: sitesRes.data?.siteEntry || [],
      activeSite: targetSite,
      reportingPeriod: { startDate: start, endDate: end },
      lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
      rows,
      topPages
    });
  } catch (err) {
    res.status(502).json({
      connected: false,
      status: "Error",
      sites: [],
      rows: [],
      topPages: [],
      error: err instanceof Error ? err.message : "Failed to query Google Search Console"
    });
  }
}
router8.post("/seo/search-console", handleSearchConsoleRequest);
router8.get("/seo/search-console", handleSearchConsoleRequest);
router8.get("/seo/reports", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({
    reports: stateStore.getSeoAuditReports(ctx.workspaceId)
  });
});
router8.post("/seo/weekly-audit/run", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  try {
    const { websiteUrl, business, triggeredBy = "seo_agent", model } = req.body;
    const snap = stateStore.getWorkspaceSnapshot(ctx.workspaceId);
    const resolvedUrl = String(websiteUrl || business?.websiteUrl || snap?.websiteUrl || "").trim();
    if (!resolvedUrl) {
      res.status(400).json({ error: "A website URL is required to run a technical SEO audit." });
      return;
    }
    const result = await executeSeoAuditAnalysis({
      websiteUrl: resolvedUrl,
      business,
      model,
      workspaceId: ctx.workspaceId,
      actorUid: ctx.actorUid,
      triggeredBy
    });
    const reports = stateStore.getSeoAuditReports(ctx.workspaceId);
    const latestReport = reports[0];
    stateStore.addNotification({
      workspaceId: ctx.workspaceId,
      ownerUid: ctx.actorUid,
      title: "Weekly Technical SEO Report Ready",
      message: `${latestReport?.headline || resolvedUrl} (Score: ${latestReport?.healthScore ?? "\u2014"}/100) pushed to Analytics.`,
      category: "seo",
      severity: "success",
      actionPage: "Analytics"
    });
    res.json({ report: latestReport, audit: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to run technical SEO audit." });
  }
});
async function runBusinessIntelligenceJobAsync(jobId) {
  const job = stateStore.getBackgroundJobById(jobId);
  if (!job || job.status === "cancelled") return;
  let partialResult = { ...job.result || {} };
  let activeStage = "validate_url";
  try {
    stateStore.updateBackgroundJob(jobId, {
      status: "processing",
      stage: "Validating & normalizing website URL",
      progressPct: 12
    });
    const out = await executeBusinessIntelligenceAnalysis({
      input: job.input,
      workspaceId: job.workspaceId,
      actorUid: job.ownerUid,
      onStageProgress: (stageLabel, pct, partial) => {
        activeStage = stageLabel;
        if (partial) {
          partialResult = { ...partialResult, ...partial };
        }
        const current = stateStore.getBackgroundJobById(jobId);
        if (current?.status === "cancelled") return;
        const completed = [];
        if (pct >= 35) completed.push("validate_url");
        if (pct >= 65) completed.push("crawl_website");
        if (pct >= 90) completed.push("extract_intelligence");
        stateStore.updateBackgroundJob(jobId, {
          stage: stageLabel,
          progressPct: pct,
          completedStages: completed,
          pendingStages: ["validate_url", "crawl_website", "extract_intelligence", "finalize_workspace"].filter(
            (s) => !completed.includes(s)
          ),
          result: partialResult
        });
      }
    });
    const latest = stateStore.getBackgroundJobById(jobId);
    if (latest?.status === "cancelled") return;
    stateStore.updateBackgroundJob(jobId, {
      status: "completed",
      stage: "Completed",
      completedStages: ["validate_url", "crawl_website", "extract_intelligence", "finalize_workspace"],
      pendingStages: [],
      progressPct: 100,
      result: out,
      error: void 0,
      failedStage: void 0
    });
  } catch (err) {
    const current = stateStore.getBackgroundJobById(jobId);
    if (current?.status === "cancelled") return;
    const formatted = formatGeminiError(err);
    const hasPartial = Boolean(partialResult.crawled);
    stateStore.updateBackgroundJob(jobId, {
      status: hasPartial ? "partially_completed" : "failed",
      failedStage: activeStage,
      error: formatted.message,
      result: partialResult
    });
  }
}
router8.post("/jobs/business-intelligence", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const input = req.body || {};
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : void 0;
  if (idempotencyKey) {
    const existing = stateStore.getBackgroundJobs(ctx.workspaceId).find((j) => j.idempotencyKey === idempotencyKey && ["queued", "processing", "completed"].includes(j.status));
    if (existing) {
      res.status(202).json({ job: existing });
      return;
    }
  }
  const job = stateStore.createBackgroundJob({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    kind: "business_intelligence",
    status: "queued",
    stage: "Queued",
    completedStages: [],
    pendingStages: ["validate_url", "crawl_website", "extract_intelligence", "finalize_workspace"],
    progressPct: 5,
    input,
    retryCount: 0,
    idempotencyKey
  });
  if (isVercelRuntime() || input.synchronous === true) {
    await runBusinessIntelligenceJobAsync(job.id);
    const finished = stateStore.getBackgroundJobById(job.id) || job;
    res.status(200).json({ job: finished, executionMode: "inline" });
    return;
  }
  void runBusinessIntelligenceJobAsync(job.id);
  res.status(202).json({ job, executionMode: "background" });
});
router8.get("/jobs", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({
    jobs: stateStore.getBackgroundJobs(ctx.workspaceId).slice(0, 40)
  });
});
router8.get("/jobs/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const job = stateStore.getBackgroundJobById(String(req.params.id));
  if (!job || job.workspaceId !== ctx.workspaceId && ctx.workspaceId !== "default") {
    res.status(404).json({ error: "Background job not found." });
    return;
  }
  res.json({ job });
});
router8.post("/jobs/:id/retry", async (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const job = stateStore.getBackgroundJobById(String(req.params.id));
  if (!job || job.workspaceId !== ctx.workspaceId) {
    res.status(404).json({ error: "Background job not found." });
    return;
  }
  const updated = stateStore.updateBackgroundJob(job.id, {
    status: "queued",
    stage: "Retrying analysis",
    retryCount: (job.retryCount || 0) + 1,
    error: void 0,
    failedStage: void 0
  });
  if (isVercelRuntime() || req.body?.synchronous === true) {
    await runBusinessIntelligenceJobAsync(job.id);
    const finished = stateStore.getBackgroundJobById(job.id) || updated;
    res.status(200).json({ job: finished, executionMode: "inline" });
    return;
  }
  void runBusinessIntelligenceJobAsync(job.id);
  res.status(202).json({ job: updated, executionMode: "background" });
});
router8.post("/jobs/:id/cancel", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const job = stateStore.getBackgroundJobById(String(req.params.id));
  if (!job || job.workspaceId !== ctx.workspaceId) {
    res.status(404).json({ error: "Background job not found." });
    return;
  }
  const updated = stateStore.updateBackgroundJob(job.id, {
    status: "cancelled",
    stage: "Cancelled by user"
  });
  res.json({ job: updated });
});
router8.get("/workspace-state", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  res.json({
    snapshot: stateStore.getWorkspaceSnapshot(ctx.workspaceId)
  });
});
router8.put("/workspace-state", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const body = req.body || {};
  const snapshot = stateStore.upsertWorkspaceSnapshot(ctx.workspaceId, ctx.actorUid, {
    websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : void 0,
    businessName: typeof body.businessName === "string" ? body.businessName : void 0,
    lastPage: typeof body.lastPage === "string" ? body.lastPage : void 0,
    openProjectId: typeof body.openProjectId === "string" ? body.openProjectId : void 0,
    activeScriptTitle: typeof body.activeScriptTitle === "string" ? body.activeScriptTitle : void 0,
    activeScriptText: typeof body.activeScriptText === "string" ? body.activeScriptText : void 0,
    videoEditorState: body.videoEditorState && typeof body.videoEditorState === "object" ? body.videoEditorState : void 0,
    commandConversations: Array.isArray(body.commandConversations) ? body.commandConversations : void 0,
    drafts: body.drafts && typeof body.drafts === "object" ? body.drafts : void 0
  });
  res.json({ snapshot });
});
router8.get("/memory", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const scope = typeof req.query.scope === "string" ? req.query.scope : void 0;
  res.json({
    memories: stateStore.listMemories(ctx.workspaceId, scope)
  });
});
router8.post("/memory", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const { scope = "business", source = "user_provided", approved = true, title, content, projectId, tags = [] } = req.body;
  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ error: "Memory title and content are required." });
    return;
  }
  const memory = stateStore.addMemory({
    workspaceId: ctx.workspaceId,
    ownerUid: ctx.actorUid,
    scope,
    source,
    approved: Boolean(approved),
    title: title.trim().slice(0, 140),
    content: content.trim().slice(0, 2e3),
    projectId: projectId || void 0,
    tags: Array.isArray(tags) ? tags.map(String).slice(0, 10) : []
  });
  res.json({ memory });
});
router8.patch("/memory/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const id = String(req.params.id);
  const patch = req.body;
  const safePatch = {};
  if (typeof patch.title === "string") safePatch.title = patch.title.trim().slice(0, 140);
  if (typeof patch.content === "string") safePatch.content = patch.content.trim().slice(0, 2e3);
  if (typeof patch.approved === "boolean") safePatch.approved = patch.approved;
  if (typeof patch.scope === "string") safePatch.scope = patch.scope;
  if (typeof patch.source === "string") safePatch.source = patch.source;
  if (Array.isArray(patch.tags)) safePatch.tags = patch.tags.map(String).slice(0, 10);
  const memory = stateStore.updateMemory(id, ctx.workspaceId, safePatch);
  if (!memory) {
    res.status(404).json({ error: "Memory record not found." });
    return;
  }
  res.json({ memory });
});
router8.delete("/memory/:id", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const deleted = stateStore.deleteMemory(String(req.params.id), ctx.workspaceId);
  res.json({ deleted });
});
router8.post("/auth/account-cleanup", (req, res) => {
  if (!req.user?.uid) {
    res.status(401).json({ error: "Authenticated session required for account deletion cleanup." });
    return;
  }
  const purgedWorkspaces = stateStore.purgeUserData(req.user.uid);
  res.json({ ok: true, purgedWorkspaces });
});
router8.get("/billing/status", async (req, res) => {
  const { workspaceId } = getContext2(req);
  const stripeDirect = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  const paystackDirect = Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
  let stripeComposio = false;
  if (isComposioConfigured()) {
    try {
      const { statuses } = await listComposioConnections(["stripe"], workspaceId);
      stripeComposio = Boolean(statuses.stripe?.accounts.some((a) => a.status === "active"));
    } catch {
      stripeComposio = false;
    }
  }
  res.json({
    providers: {
      stripe: {
        configured: stripeDirect || stripeComposio,
        mode: stripeDirect ? "server_secret" : stripeComposio ? "composio_oauth" : "awaiting_credentials"
      },
      paystack: {
        configured: paystackDirect,
        mode: paystackDirect ? "server_secret" : "awaiting_credentials"
      }
    },
    records: stateStore.getBillingRecords(workspaceId)
  });
});
router8.post("/billing/checkout", async (req, res) => {
  const parsed = BillingCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid billing payload" });
    return;
  }
  const { workspaceId, actorUid } = getContext2(req);
  const { provider, planOrPack, amountUsd, creditsToGrant } = parsed.data;
  const appUrl = resolvePublicBaseUrl(req);
  if (provider === "stripe") {
    const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (stripeKey) {
      try {
        const form = new URLSearchParams({
          mode: "payment",
          success_url: `${appUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${appUrl}/?billing=cancelled`,
          "line_items[0][price_data][currency]": "usd",
          "line_items[0][price_data][unit_amount]": String(Math.round(amountUsd * 100)),
          "line_items[0][price_data][product_data][name]": `Marketing OS \u2014 ${planOrPack}`,
          "line_items[0][quantity]": "1"
        });
        const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stripeKey}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: form.toString()
        });
        const json = await stripeRes.json();
        if (!stripeRes.ok || !json.url) {
          throw new Error(json.error?.message || "Stripe checkout creation failed");
        }
        const record = stateStore.addBillingRecord({
          workspaceId,
          ownerUid: actorUid,
          provider: "stripe",
          planOrPack,
          amountUsd,
          creditsToGrant,
          status: "pending",
          checkoutUrl: json.url,
          providerSessionId: json.id
        });
        res.json({ checkoutUrl: json.url, sessionId: json.id, record });
        return;
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : "Stripe checkout failed"
        });
        return;
      }
    }
    if (isComposioConfigured()) {
      try {
        const { statuses } = await listComposioConnections(["stripe"], workspaceId);
        const activeStripe = statuses.stripe?.accounts.find((a) => a.status === "active");
        if (activeStripe) {
          const session = await executeComposioTool({
            toolkit: "stripe",
            toolSlug: "STRIPE_CREATE_CHECKOUT_SESSION",
            arguments: {
              mode: "payment",
              success_url: `${appUrl}/?billing=success`,
              cancel_url: `${appUrl}/?billing=cancelled`
            },
            accountId: activeStripe.id,
            workspaceId,
            userId: actorUid
          });
          if (session.data?.url) {
            const record = stateStore.addBillingRecord({
              workspaceId,
              ownerUid: actorUid,
              provider: "stripe",
              planOrPack,
              amountUsd,
              creditsToGrant,
              status: "pending",
              checkoutUrl: session.data.url,
              providerSessionId: session.data.id
            });
            res.json({ checkoutUrl: session.data.url, sessionId: session.data.id, record });
            return;
          }
        }
      } catch {
      }
    }
    res.status(503).json({
      status: "Awaiting Credentials",
      provider: "stripe",
      error: "Stripe checkout is Awaiting Credentials: configure STRIPE_SECRET_KEY in server Secrets or connect Stripe in Integrations."
    });
    return;
  }
  const paystackKey = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!paystackKey) {
    res.status(503).json({
      status: "Awaiting Credentials",
      provider: "paystack",
      error: "Paystack billing is Awaiting Credentials: add PAYSTACK_SECRET_KEY to server Secrets."
    });
    return;
  }
  try {
    const email = req.user?.email || "founder@marketingos.local";
    const psRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amountUsd * 100),
        callback_url: `${appUrl}/?billing=success`,
        metadata: { workspaceId, planOrPack, creditsToGrant }
      })
    });
    const json = await psRes.json();
    if (!psRes.ok || !json.status || !json.data?.authorization_url) {
      throw new Error(json.message || "Paystack initialization failed");
    }
    const record = stateStore.addBillingRecord({
      workspaceId,
      ownerUid: actorUid,
      provider: "paystack",
      planOrPack,
      amountUsd,
      creditsToGrant,
      status: "pending",
      checkoutUrl: json.data.authorization_url,
      providerSessionId: json.data.reference
    });
    res.json({ checkoutUrl: json.data.authorization_url, sessionId: json.data.reference, record });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Paystack initialization failed"
    });
  }
});
var schedulerInterval = null;
var lastWeeklySeoSweepAt = 0;
async function runSchedulerSweep() {
  let checkedScheduledJobs = 0;
  let triggeredWorkflows = 0;
  const now = Date.now();
  const jobs = stateStore.getScheduledJobs();
  for (const job of jobs) {
    if (job.status !== "scheduled") continue;
    const dueAt = new Date(job.scheduledForIso).getTime();
    if (Number.isNaN(dueAt) || dueAt > now) continue;
    checkedScheduledJobs += 1;
    if (!job.approvedForAutoPublish) {
      stateStore.updateScheduledJob(job.id, { status: "awaiting_confirmation" });
      stateStore.addNotification({
        workspaceId: job.workspaceId,
        ownerUid: job.ownerUid,
        title: `Approval needed: "${job.title}"`,
        message: `Scheduled post for ${job.platform} is due and awaiting human publish confirmation.`,
        category: "publishing",
        severity: "warning",
        actionPage: "Publishing Queue"
      });
      continue;
    }
    if (!isComposioConfigured()) {
      stateStore.updateScheduledJob(job.id, {
        status: "awaiting_confirmation",
        lastError: "Composio API key missing"
      });
      continue;
    }
    const toolkit = mapPlatformToToolkit2(job.platform);
    try {
      const { statuses } = await listComposioConnections([toolkit], job.workspaceId);
      const activeAccount = statuses[toolkit]?.accounts.find((a) => a.status === "active");
      if (!activeAccount) {
        stateStore.updateScheduledJob(job.id, {
          status: "awaiting_confirmation",
          lastError: `${job.platform} is not connected in Composio.`
        });
        continue;
      }
      stateStore.updateScheduledJob(job.id, {
        status: "processing",
        attempts: job.attempts + 1
      });
      let postId = "";
      if (toolkit === "facebook") {
        const pages = await executeComposioTool({
          toolkit: "facebook",
          toolSlug: "FACEBOOK_LIST_MANAGED_PAGES",
          arguments: {},
          accountId: activeAccount.id,
          workspaceId: job.workspaceId,
          userId: job.ownerUid
        });
        const pageId = pages.data?.data?.[0]?.id;
        if (!pageId) throw new Error("No managed Facebook Page found");
        const out = await executeComposioTool({
          toolkit: "facebook",
          toolSlug: "FACEBOOK_CREATE_POST",
          arguments: { page_id: pageId, message: job.caption || job.title },
          accountId: activeAccount.id,
          workspaceId: job.workspaceId,
          userId: job.ownerUid
        });
        postId = String(out.data?.id || "published");
      } else if (toolkit === "linkedin") {
        const me = await executeComposioTool({
          toolkit: "linkedin",
          toolSlug: "LINKEDIN_GET_MY_INFO",
          arguments: {},
          accountId: activeAccount.id,
          workspaceId: job.workspaceId,
          userId: job.ownerUid
        });
        const personId = String(me.data?.sub || me.data?.id || "");
        const authorUrn = personId.startsWith("urn:") ? personId : `urn:li:person:${personId}`;
        const out = await executeComposioTool({
          toolkit: "linkedin",
          toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST",
          arguments: { author: authorUrn, commentary: job.caption || job.title, visibility: "PUBLIC" },
          accountId: activeAccount.id,
          workspaceId: job.workspaceId,
          userId: job.ownerUid
        });
        postId = String(out.data?.id || "published");
      } else if (toolkit === "twitter") {
        const out = await executeComposioTool({
          toolkit: "twitter",
          toolSlug: "TWITTER_CREATION_OF_A_POST",
          arguments: { text: (job.caption || job.title).slice(0, 280) },
          accountId: activeAccount.id,
          workspaceId: job.workspaceId,
          userId: job.ownerUid
        });
        postId = String(out.data?.data?.id || "published");
      } else {
        if (!job.mediaUrl || !/^https?:\/\//i.test(job.mediaUrl)) {
          stateStore.updateScheduledJob(job.id, {
            status: "awaiting_confirmation",
            lastError: `${job.platform} requires verified public media URL before auto-publish.`
          });
          continue;
        }
        stateStore.updateScheduledJob(job.id, {
          status: "awaiting_confirmation",
          lastError: "Click Publish in Publishing Queue to confirm final media dispatch."
        });
        continue;
      }
      stateStore.updateScheduledJob(job.id, {
        status: "published",
        providerPostId: postId
      });
      stateStore.addNotification({
        workspaceId: job.workspaceId,
        ownerUid: job.ownerUid,
        title: `Scheduled post published to ${job.platform}`,
        message: `"${job.title}" published via scheduler (${postId}).`,
        category: "publishing",
        severity: "success",
        actionPage: "Publishing Queue"
      });
    } catch (err) {
      const attempts = job.attempts + 1;
      stateStore.updateScheduledJob(job.id, {
        status: attempts >= job.maxAttempts ? "failed" : "scheduled",
        attempts,
        lastError: err instanceof Error ? err.message : String(err)
      });
    }
  }
  if (now - lastWeeklySeoSweepAt >= 15 * 60 * 1e3 && process.env.GEMINI_API_KEY?.trim()) {
    lastWeeklySeoSweepAt = now;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1e3;
    const snapshots = stateStore.listWorkspaceSnapshotsWithWebsite();
    for (const snap of snapshots) {
      if (!snap.websiteUrl) continue;
      const existingReports = stateStore.getSeoAuditReports(snap.workspaceId);
      const latestAt = existingReports[0] ? new Date(existingReports[0].createdAt).getTime() : 0;
      if (latestAt && now - latestAt < SEVEN_DAYS_MS) continue;
      try {
        const audit = await executeSeoAuditAnalysis({
          websiteUrl: snap.websiteUrl,
          business: { name: snap.businessName || snap.workspaceId, websiteUrl: snap.websiteUrl },
          workspaceId: snap.workspaceId,
          actorUid: snap.ownerUid,
          triggeredBy: "weekly_cron"
        });
        stateStore.addNotification({
          workspaceId: snap.workspaceId,
          ownerUid: snap.ownerUid,
          title: "Weekly Technical SEO Report Pushed",
          message: `${String(audit.headline || snap.websiteUrl)} \u2014 Score ${String(audit.healthScore || "\u2014")}/100 now in Analytics.`,
          category: "seo",
          severity: "info",
          actionPage: "Analytics"
        });
      } catch {
      }
    }
  }
  const workflows = stateStore.listWorkflows();
  for (const wf of workflows) {
    if (!wf.enabled || !wf.confirmedToActivate || wf.triggerType !== "interval") continue;
    const intervalMs = Math.max(5, wf.intervalMinutes || 60) * 60 * 1e3;
    const lastRunMs = wf.lastRunAt ? new Date(wf.lastRunAt).getTime() : 0;
    if (lastRunMs && now - lastRunMs < intervalMs) continue;
    try {
      await executeAutomationWorkflow(wf);
      triggeredWorkflows += 1;
    } catch {
    }
  }
  return { checkedScheduledJobs, triggeredWorkflows };
}
function startBackgroundScheduler() {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    void runSchedulerSweep();
  }, 3e4);
  schedulerInterval.unref();
}
var handleCronTick = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = String(req.headers.authorization || "").trim();
  if (cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: "Unauthorized cron trigger." });
      return;
    }
  } else if (isVercelRuntime()) {
    res.status(503).json({
      error: "CRON_SECRET is not configured on Vercel; configure CRON_SECRET to authorize scheduled cron ticks."
    });
    return;
  }
  const summary = await runSchedulerSweep();
  res.json({ ok: true, ...summary, executedAt: (/* @__PURE__ */ new Date()).toISOString() });
};
router8.get("/cron/tick", handleCronTick);
router8.post("/cron/tick", handleCronTick);
router8.get("/telemetry/usage", (req, res) => {
  const ctx = assertWorkspaceAccess(req, res);
  if (!ctx) return;
  const runs = stateStore.getAiRuns(ctx.workspaceId);
  const byModel = {};
  for (const r of runs) {
    if (!byModel[r.model]) {
      byModel[r.model] = { runs: 0, completed: 0, failed: 0, avgLatencyMs: 0 };
    }
    const entry = byModel[r.model];
    entry.runs += 1;
    if (r.status === "completed") entry.completed += 1;
    else entry.failed += 1;
    entry.avgLatencyMs += r.latencyMs;
  }
  for (const key of Object.keys(byModel)) {
    byModel[key].avgLatencyMs = Math.round(byModel[key].avgLatencyMs / Math.max(1, byModel[key].runs));
  }
  const avgLatencyMs = runs.length ? Math.round(runs.reduce((sum, r) => sum + r.latencyMs, 0) / runs.length) : 0;
  res.json({
    totalRuns: runs.length,
    avgLatencyMs,
    recentModels: Object.keys(byModel),
    byModel,
    recentRuns: runs.slice(0, 40)
  });
});
var operations_default = router8;

// server/live/liveBridge.ts
import { Modality } from "@google/genai";
import { WebSocket, WebSocketServer } from "ws";
function attachLiveVoiceBridge(server) {
  const wss = new WebSocketServer({ noServer: true });
  wss.on("error", (err) => {
    console.error("Live voice WebSocket error:", err);
  });
  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (url.pathname === "/ws/live") {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      }
    } catch {
    }
  });
  wss.on("connection", async (clientWs, req) => {
    let session = null;
    try {
      const url = new URL(req.url || "/ws/live", "http://localhost");
      const businessName = url.searchParams.get("business") || "your business";
      const workspaceId = (url.searchParams.get("workspaceId") || "").replace(/[^a-zA-Z0-9_-]/g, "");
      const voiceName = url.searchParams.get("voice") || "Zephyr";
      const approvedMemories = workspaceId ? stateStore.listMemories(workspaceId).filter((m) => m.approved).slice(0, 8) : [];
      const memorySnippet = approvedMemories.length ? `
Approved workspace facts:
${approvedMemories.map((m) => `- ${m.title}: ${m.content}`).join("\n")}` : "";
      const ai = getGeminiClient();
      session = await ai.live.connect({
        model: "gemini-3.8-live",
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName }
            }
          },
          systemInstruction: `You are Marketing OS Live Voice Strategist for ${businessName}. Give sharp, actionable, concise marketing advice about positioning, hooks, video scripts, SEO, and growth experiments. Keep spoken answers crisp and conversational.${memorySnippet}`
        },
        callbacks: {
          onopen: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ ready: true }));
            }
          },
          onmessage: (message) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              clientWs.send(JSON.stringify({ inputTranscript: content.inputTranscription.text }));
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(JSON.stringify({ outputTranscript: content.outputTranscription.text }));
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
            if (content?.turnComplete) {
              clientWs.send(JSON.stringify({ turnComplete: true }));
            }
          },
          onerror: (err) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              const formatted = formatGeminiError(err);
              clientWs.send(JSON.stringify({ error: formatted.message }));
            }
          },
          onclose: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ closed: true }));
              clientWs.close();
            }
          }
        }
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ error: formatted.message }));
        clientWs.close();
      }
      return;
    }
    clientWs.on("message", (raw) => {
      if (!session) return;
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.audio) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" }
          });
        } else if (msg.text) {
          session.sendRealtimeInput({
            text: msg.text
          });
        }
      } catch {
      }
    });
    clientWs.on("close", () => {
      try {
        session?.close();
      } catch {
      }
      session = null;
    });
  });
}

// server.ts
function isAllowedCorsOrigin(origin, req) {
  try {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]") {
      return true;
    }
    const expectedBase = resolvePublicBaseUrl(req);
    if (expectedBase && origin === new URL(expectedBase).origin) {
      return true;
    }
    const allowedHosts = [
      process.env.APP_URL?.trim(),
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : "",
      process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}` : "",
      process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL.trim()}` : ""
    ].filter((v) => Boolean(v && v !== "MY_APP_URL" && /^https?:\/\//i.test(v))).map((v) => new URL(v).origin);
    return allowedHosts.includes(origin);
  } catch {
    return false;
  }
}
function renderOAuthCallbackHtml(req) {
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
      <p style="color:#8c9894;margin:0 0 16px">${error ? "You can close this window and retry." : "Connection verified. Returning to Marketing OS\u2026"}</p>
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
async function createMarketingOsApp(httpServer) {
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
        composioConfigured: Boolean(process.env.COMPOSIO_API_KEY?.trim())
      },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.use("/api", attachFirebaseUser);
  app.use("/api", apiRateLimiter());
  app.use("/api", intelligence_default);
  app.use("/api", aiStudio_default);
  app.use("/api", videoEditor_default);
  app.use("/api", integrations_default);
  app.use("/api", composio_default);
  app.use("/api", pipeline_default);
  app.use("/api", growthAnalytics_default);
  app.use("/api", operations_default);
  app.get(["/auth/callback", "/auth/callback/"], (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderOAuthCallbackHtml(req));
  });
  if (!isProd && !isVercel && process.env.VITEST !== "true") {
    let viteMiddleware = null;
    const viteReady = (async () => {
      const vitePkg = "vite";
      const { createServer: createViteServer } = await import(
        /* @vite-ignore */
        vitePkg
      );
      const disableHmr = process.env.DISABLE_HMR === "true";
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          allowedHosts: true,
          ...disableHmr ? { hmr: false } : {},
          ...httpServer ? { ws: { server: httpServer } } : {}
        },
        appType: "spa"
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
    const distDir = path8.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path8.join(distDir, "index.html"));
    });
  }
  app.use((err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    const status = err?.status;
    res.status(status && status >= 400 && status < 600 ? status : 500).json({
      error: message
    });
  });
  return app;
}
function parseServerCliArgs(argv) {
  let port;
  let host;
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
function resolveListenTarget() {
  const cli = parseServerCliArgs(process.argv.slice(2));
  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  const defaultAppPort = Number(process.env.DEFAULT_APP_PORT) || 3e3;
  const port = cli.port ?? (Number.isFinite(envPort) && envPort > 0 && envPort !== nginxPort ? envPort : defaultAppPort);
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
export {
  createMarketingOsApp
};
