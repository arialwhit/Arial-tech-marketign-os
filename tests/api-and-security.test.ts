import fs from "fs";
import http from "http";
import path from "path";
import zlib from "zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMarketingOsApp } from "../server.ts";
import { buildSocialCoverageReport } from "../server/services/socialCapabilityMatrix";
import { normalizeAndAssertPublicUrl } from "../server/utils/ssrf";

function buildValidPngBuffer(width = 64, height = 64): Buffer {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowStride = 1 + width * 3;
  const raw = Buffer.alloc(rowStride * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowStride] = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * rowStride + 1 + x * 3;
      raw[idx] = 20;
      raw[idx + 1] = 180;
      raw[idx + 2] = 140;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("Marketing OS API, FFmpeg, SSRF & Security Suite", () => {
  let server: http.Server;
  let baseUrl = "";
  const cleanupPaths: string[] = [];

  beforeAll(async () => {
    process.env.VITEST = "true";
    const app = await createMarketingOsApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Failed to bind ephemeral HTTP port");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    for (const p of cleanupPaths) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // ignore cleanup error
      }
    }
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("blocks private, loopback, metadata, and credentialed URLs (SSRF protection)", async () => {
    const blocked = [
      "http://127.0.0.1:3000",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1",
      "http://[::1]:3000",
      "http://localhost:8080",
      "http://metadata.google.internal",
      "http://user:pass@example.com",
      "file:///etc/passwd",
    ];
    for (const url of blocked) {
      await expect(normalizeAndAssertPublicUrl(url)).rejects.toThrow();
    }
    const allowed = await normalizeAndAssertPublicUrl("https://1.1.1.1");
    expect(allowed).toBe("https://1.1.1.1/");
  });

  it("ensures no dummy seed files or simulated operational constants remain", () => {
    expect(fs.existsSync(path.resolve(process.cwd(), "src/data/demoSeed.ts"))).toBe(false);
    const dataFiles = fs.readdirSync(path.resolve(process.cwd(), "src/data"));
    expect(dataFiles).toEqual(["defaults.ts"]);

    const srcDefaults = fs.readFileSync(
      path.resolve(process.cwd(), "src/data/defaults.ts"),
      "utf8",
    );
    expect(srcDefaults).not.toMatch(/DEMO_WORKSPACE|demoSeed|fakeFollower|mockDashboardStats/);
  });

  it("produces truthful 6-platform social capability matrix statuses", () => {
    const matrix = buildSocialCoverageReport({});
    expect(matrix.map((m) => m.platform)).toEqual([
      "Instagram",
      "Facebook",
      "TikTok",
      "YouTube",
      "LinkedIn",
      "X",
    ]);
    const ig = matrix.find((m) => m.platform === "Instagram")!;
    expect(ig.connectionStatus).toBe("Setup Required");
    expect(ig.capabilities.publishText.status).toBe("Unsupported");
    expect(ig.capabilities.publishMedia.status).toBe("Setup Required");

    const fb = matrix.find((m) => m.platform === "Facebook")!;
    expect(fb.capabilities.publishText.status).toBe("Setup Required");
  });

  it("serves health, integrations, notifications, and never leaks secrets", async () => {
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
    expect(health.ok).toBe(true);

    const statusRes = await fetch(`${baseUrl}/api/composio/status`).then((r) => r.json());
    expect(typeof statusRes.configured).toBe("boolean");
    expect(JSON.stringify(statusRes)).not.toMatch(/ck_foCAK|AIza/);

    const integrations = await fetch(`${baseUrl}/api/integrations/status`).then((r) => r.json());
    expect(integrations.providers).toBeTruthy();
    expect(typeof integrations.providers.composio?.configured).toBe("boolean");
    expect(typeof integrations.providers.gemini?.configured).toBe("boolean");
    expect(typeof integrations.providers.googleWorkspace?.configured).toBe("boolean");
    expect(typeof integrations.providers.metaAds?.configured).toBe("boolean");
    expect(typeof integrations.providers.stripe?.configured).toBe("boolean");
    expect(typeof integrations.providers.paystack?.configured).toBe("boolean");

    const notifs = await fetch(`${baseUrl}/api/notifications`).then((r) => r.json());
    expect(Array.isArray(notifs.notifications)).toBe(true);
  });

  it("enforces human confirmation gates on publishing and paid ad spend", async () => {
    const pubRes = await fetch(`${baseUrl}/api/social/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws" },
      body: JSON.stringify({
        platform: "Instagram",
        caption: "Should not publish without confirmation",
        confirmed: false,
      }),
    });
    expect(pubRes.status).toBe(400);

    const adsRes = await fetch(`${baseUrl}/api/ads/meta/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws" },
      body: JSON.stringify({
        adAccountId: "act_12345",
        name: "Unauthorized Campaign",
        dailyBudgetUsd: 50,
        confirmed: true,
        budgetAuthorized: false,
      }),
    });
    expect(adsRes.status).toBe(400);
  });

  it("persists scheduled jobs & cleans them up and returns honest billing status", async () => {
    const schedCreate = await fetch(`${baseUrl}/api/scheduler/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws" },
      body: JSON.stringify({
        title: "Test Launch Post",
        platform: "LinkedIn",
        caption: "Draft scheduled caption",
        scheduledForIso: new Date(Date.now() + 86400000).toISOString(),
        approvedForAutoPublish: false,
      }),
    }).then((r) => r.json());
    expect(schedCreate.job?.id).toBeTruthy();
    expect(schedCreate.job?.status).toBe("awaiting_confirmation");

    const schedDel = await fetch(`${baseUrl}/api/scheduler/jobs/${schedCreate.job.id}`, {
      method: "DELETE",
      headers: { "x-workspace-id": "test-ws" },
    }).then((r) => r.json());
    expect(schedDel.cancelled).toBe(true);

    const checkout = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws" },
      body: JSON.stringify({
        provider: "stripe",
        planOrPack: "Pro Plan",
        amountUsd: 49,
        creditsToGrant: 1000,
      }),
    });
    expect(checkout.status).toBe(410);
    const body = await checkout.json();
    expect(body.productBilling).toBe("disabled");
  });

  it("renders a real MP4 with burned subtitles via FFmpeg and tracks job completion", async () => {
    const mediaDir = path.resolve(process.cwd(), "uploads/media");
    fs.mkdirSync(mediaDir, { recursive: true });
    const pngName = `vitest-frame-${Date.now()}.png`;
    const pngPath = path.join(mediaDir, pngName);
    fs.writeFileSync(pngPath, buildValidPngBuffer(64, 64));
    cleanupPaths.push(pngPath);

    const renderRes = await fetch(`${baseUrl}/api/editor/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws" },
      body: JSON.stringify({
        sourceUrl: `/uploads/media/${pngName}`,
        aspectRatio: "9:16",
        trimStartSec: 0,
        trimDurationSec: 2,
        burnSubtitles: true,
        captionsTrack: [{ startSec: 0, endSec: 2, text: "Marketing OS Test" }],
        title: "vitest-render",
      }),
    });

    expect(renderRes.status).toBe(200);
    const data = await renderRes.json();
    expect(data.renderUrl).toMatch(/^\/uploads\/renders\/.*\.mp4$/);
    expect(data.sizeBytes).toBeGreaterThan(1000);
    expect(data.subtitlesBurned).toBe(true);

    const renderedDiskPath = path.resolve(process.cwd(), data.renderUrl.replace(/^\/+/, ""));
    cleanupPaths.push(renderedDiskPath);
    expect(fs.existsSync(renderedDiskPath)).toBe(true);

    const jobsData = await fetch(`${baseUrl}/api/video/jobs`, {
      headers: { "x-workspace-id": "test-ws" },
    }).then((r) => r.json());
    const matched = jobsData.jobs.find((j: { id: string }) => j.id === data.jobId);
    expect(matched?.status).toBe("completed");
  }, 30000);

  it("queries live Composio connections read-only when COMPOSIO_API_KEY is configured", async () => {
    if (!process.env.COMPOSIO_API_KEY) return;
    const res = await fetch(`${baseUrl}/api/composio/connections`, {
      headers: { "x-workspace-id": "test-ws" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.configured).toBe(true);
    expect(json.statuses).toBeTruthy();
  }, 20000);

  it("supports durable Business Intelligence jobs, status polling, and cancellation", async () => {
    const createRes = await fetch(`${baseUrl}/api/jobs/business-intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws-bi" },
      body: JSON.stringify({
        name: "Test BI Workspace",
        websiteUrl: "http://127.0.0.1:9999/blocked",
      }),
    });
    expect(createRes.status).toBe(202);
    const created = await createRes.json();
    expect(created.job?.id).toBeTruthy();

    const fetchRes = await fetch(`${baseUrl}/api/jobs/${created.job.id}`, {
      headers: { "x-workspace-id": "test-ws-bi" },
    });
    expect(fetchRes.status).toBe(200);
    const fetched = await fetchRes.json();
    expect(fetched.job?.id).toBe(created.job.id);

    const cancelRes = await fetch(`${baseUrl}/api/jobs/${created.job.id}/cancel`, {
      method: "POST",
      headers: { "x-workspace-id": "test-ws-bi" },
    });
    expect(cancelRes.status).toBe(200);
    const cancelled = await cancelRes.json();
    expect(cancelled.job?.status).toBe("cancelled");
  });

  it("exposes Search Console topPages shape and weekly technical SEO reports endpoint", async () => {
    const gscRes = await fetch(`${baseUrl}/api/seo/search-console`, {
      headers: { "x-workspace-id": "test-ws" },
    });
    expect(gscRes.status).toBe(200);
    const gsc = await gscRes.json();
    expect(typeof gsc.connected).toBe("boolean");
    expect(Array.isArray(gsc.rows)).toBe(true);
    expect(Array.isArray(gsc.topPages)).toBe(true);

    const repRes = await fetch(`${baseUrl}/api/seo/reports`, {
      headers: { "x-workspace-id": "test-ws" },
    });
    expect(repRes.status).toBe(200);
    const rep = await repRes.json();
    expect(Array.isArray(rep.reports)).toBe(true);
  });

  it("persists workspace continuity snapshots and structured AI memory CRUD", async () => {
    const putRes = await fetch(`${baseUrl}/api/workspace-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws-mem" },
      body: JSON.stringify({
        businessName: "Continuity Co",
        websiteUrl: "https://example.com",
        lastPage: "Video Editor",
        activeScriptTitle: "Hook Variant B",
        videoEditorState: { mode: "hybrid", speed: 1.15 },
      }),
    });
    expect(putRes.status).toBe(200);

    const getSnap = await fetch(`${baseUrl}/api/workspace-state`, {
      headers: { "x-workspace-id": "test-ws-mem" },
    }).then((r) => r.json());
    expect(getSnap.snapshot?.lastPage).toBe("Video Editor");
    expect(getSnap.snapshot?.activeScriptTitle).toBe("Hook Variant B");

    const memCreate = await fetch(`${baseUrl}/api/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws-mem" },
      body: JSON.stringify({
        scope: "business",
        source: "verified_business",
        approved: true,
        title: "Core Guarantee",
        content: "Always offer 14-day free trial without card.",
      }),
    }).then((r) => r.json());
    expect(memCreate.memory?.id).toBeTruthy();

    const memPatch = await fetch(`${baseUrl}/api/memory/${memCreate.memory.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws-mem" },
      body: JSON.stringify({ approved: false }),
    }).then((r) => r.json());
    expect(memPatch.memory?.approved).toBe(false);

    const memDel = await fetch(`${baseUrl}/api/memory/${memCreate.memory.id}`, {
      method: "DELETE",
      headers: { "x-workspace-id": "test-ws-mem" },
    }).then((r) => r.json());
    expect(memDel.deleted).toBe(true);
  });

  it("supports categorized media library upload, distinct categories, edit, and safe delete", async () => {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(buildValidPngBuffer(16, 16))], { type: "image/png" });
    form.append("file", blob, "demo-shot.png");
    form.append("category", "product_demo_image");
    form.append("tags", "hero,launch");
    form.append("description", "Product hero screenshot");

    const upRes = await fetch(`${baseUrl}/api/media/upload`, {
      method: "POST",
      headers: { "x-workspace-id": "test-ws-media" },
      body: form,
    });
    expect(upRes.status).toBe(200);
    const up = await upRes.json();
    expect(up.id).toBeTruthy();
    expect(up.category).toBe("product_demo_image");

    const listRes = await fetch(`${baseUrl}/api/media`, {
      headers: { "x-workspace-id": "test-ws-media" },
    }).then((r) => r.json());
    expect(listRes.assets.some((a: { id: string }) => a.id === up.id)).toBe(true);

    const patchRes = await fetch(`${baseUrl}/api/media/${up.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws-media" },
      body: JSON.stringify({ category: "product_clips", description: "Updated tag" }),
    }).then((r) => r.json());
    expect(patchRes.asset?.category).toBe("product_clips");

    const delRes = await fetch(`${baseUrl}/api/media/${up.id}`, {
      method: "DELETE",
      headers: { "x-workspace-id": "test-ws-media" },
    }).then((r) => r.json());
    expect(delRes.deleted).toBe(true);

    const diskPath = path.resolve(process.cwd(), String(up.url).replace(/^\/+/, ""));
    expect(fs.existsSync(diskPath)).toBe(false);
  });

  it("enforces SSRF protection on creator/video endpoints and authenticates account cleanup", async () => {
    const chanRes = await fetch(`${baseUrl}/api/intelligence/channel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws" },
      body: JSON.stringify({ channelUrl: "http://127.0.0.1:8080/internal", platform: "YouTube" }),
    });
    expect(chanRes.status).toBeGreaterThanOrEqual(400);

    const vidRes = await fetch(`${baseUrl}/api/intelligence/video`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws" },
      body: JSON.stringify({ videoUrl: "http://169.254.169.254/latest/meta-data/", platform: "TikTok" }),
    });
    expect(vidRes.status).toBeGreaterThanOrEqual(400);

    const cleanupRes = await fetch(`${baseUrl}/api/auth/account-cleanup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(cleanupRes.status).toBe(401);
  });

  it("includes Vercel/Node runtime diagnostics in /api/health and ships Vercel serverless config", async () => {
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
    expect(health.ok).toBe(true);
    expect(typeof health.runtime).toBe("string");
    expect(health.capabilities).toBeTruthy();
    expect(typeof health.capabilities.vercel).toBe("boolean");
    expect(typeof health.capabilities.persistentScheduler).toBe("boolean");
    expect(typeof health.capabilities.nativeWebSocketLiveVoice).toBe("boolean");

    expect(fs.existsSync(path.resolve(process.cwd(), "vercel.json"))).toBe(true);
    expect(fs.existsSync(path.resolve(process.cwd(), "api/index.ts"))).toBe(true);
    const vercelCfg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8"),
    );
    expect(vercelCfg.buildCommand).toBe("npm run build");
    expect(vercelCfg.outputDirectory).toBe("dist");
  });

  it("enforces Strategy -> Calendar -> Content Project 17-state pipeline and approval gates", async () => {
    const ws = "test-ws-pipeline";

    // 1. Strategy CRUD
    const stratCreate = await fetch(`${baseUrl}/api/strategies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({
        title: "Q3 Product Launch",
        executiveSummary: "Launch vertical demo series",
        contentPillars: [{ pillar: "Product Proofs", goal: "Conversions", mix: "50%" }],
      }),
    }).then((r) => r.json());
    expect(stratCreate.strategy?.id).toBeTruthy();

    const stratPatch = await fetch(`${baseUrl}/api/strategies/${stratCreate.strategy.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({ title: "Q3 Launch Updated" }),
    }).then((r) => r.json());
    expect(stratPatch.strategy?.title).toBe("Q3 Launch Updated");

    // 2. Calendar Entry -> Create Project
    const calCreate = await fetch(`${baseUrl}/api/calendar-entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({
        strategyId: stratCreate.strategy.id,
        title: "60s Founder Workflow Demo",
        platform: "Instagram Reels",
        formatType: "short_form",
      }),
    }).then((r) => r.json());
    expect(calCreate.entry?.id).toBeTruthy();

    const projCreate = await fetch(
      `${baseUrl}/api/calendar-entries/${calCreate.entry.id}/create-project`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      },
    ).then((r) => r.json());
    expect(projCreate.project?.id).toBeTruthy();
    expect(projCreate.project?.status).toBe("SCRIPT_PENDING");

    const projectId = projCreate.project.id as string;

    // 3. Enforce 409 block when jumping to VIDEO_GENERATING before script approval
    const badTransition = await fetch(`${baseUrl}/api/projects/${projectId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({ status: "VIDEO_GENERATING" }),
    });
    expect(badTransition.status).toBe(409);

    // 4. Enforce 409 block on final approval before script + asset + caption
    const badFinal = await fetch(`${baseUrl}/api/projects/${projectId}/approve-final`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({}),
    });
    expect(badFinal.status).toBe(409);

    // 5. Approve Script -> unlocks SCRIPT_APPROVED
    const scriptApprove = await fetch(`${baseUrl}/api/projects/${projectId}/approve-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({
        hook: "Stop manually stitching Reels.",
        script: "Watch how our workflow ships edited MP4s in 3 steps.",
        cta: "Try it free today.",
      }),
    }).then((r) => r.json());
    expect(scriptApprove.project?.status).toBe("SCRIPT_APPROVED");
    expect(scriptApprove.project?.scriptApproved).toBe(true);

    // 6. Build Production Plan -> moves to VIDEO_PENDING
    const planRes = await fetch(`${baseUrl}/api/projects/${projectId}/production-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({
        formatType: "short_form",
        method: "hybrid",
        aspectRatio: "9:16",
        durationTargetSec: 30,
      }),
    }).then((r) => r.json());
    expect(planRes.project?.status).toBe("VIDEO_PENDING");
    expect(Array.isArray(planRes.plan?.shotList)).toBe(true);

    // 7. Attach edited asset & caption, then Grant Final Approval
    await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({
        editedVideoUrl: "/uploads/renders/sample-demo.mp4",
        caption: "3 steps to automate your content calendar.",
      }),
    });

    const finalRes = await fetch(`${baseUrl}/api/projects/${projectId}/approve-final`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({ caption: "3 steps to automate your content calendar." }),
    }).then((r) => r.json());
    expect(finalRes.project?.status).toBe("APPROVED_FOR_PUBLISHING");
    expect(finalRes.project?.finalApproved).toBe(true);

    // Cleanup strategy
    const delStrat = await fetch(`${baseUrl}/api/strategies/${stratCreate.strategy.id}`, {
      method: "DELETE",
      headers: { "x-workspace-id": ws },
    }).then((r) => r.json());
    expect(delStrat.deleted).toBe(true);
  });

  it("enforces Presenter likeness consent and Automation Workflow activation confirmation", async () => {
    const ws = "test-ws-gates";

    // Presenter without consentConfirmed: true must 400
    const noConsent = await fetch(`${baseUrl}/api/presenters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({ name: "Founder Sam", consentConfirmed: false }),
    });
    expect(noConsent.status).toBe(400);

    const withConsent = await fetch(`${baseUrl}/api/presenters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({
        name: "Founder Sam",
        role: "Founder",
        avatarKind: "uploaded_photo",
        consentConfirmed: true,
        consentOwner: "sam@example.com",
      }),
    }).then((r) => r.json());
    expect(withConsent.presenter?.id).toBeTruthy();

    // Enabled workflow without confirmedToActivate: true must 400
    const badWf = await fetch(`${baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({
        name: "Auto Publish Loop",
        enabled: true,
        confirmedToActivate: false,
      }),
    });
    expect(badWf.status).toBe(400);

    // Draft workflow + manual test run succeeds and logs execution
    const wfCreate = await fetch(`${baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({
        name: "Weekly QA Draft Flow",
        triggerType: "manual",
        enabled: false,
        confirmedToActivate: false,
        conditionMinQaScore: 75,
        requireHumanApproval: true,
      }),
    }).then((r) => r.json());
    expect(wfCreate.workflow?.id).toBeTruthy();

    const runRes = await fetch(`${baseUrl}/api/workflows/${wfCreate.workflow.id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
    }).then((r) => r.json());
    expect(runRes.execution?.id).toBeTruthy();
    expect(Array.isArray(runRes.execution?.stepLogs)).toBe(true);
  });

  it("supports media file replacement and returns internal telemetry usage without secrets", async () => {
    const ws = "test-ws-replace";
    const form1 = new FormData();
    form1.append("file", new Blob([new Uint8Array(buildValidPngBuffer(12, 12))], { type: "image/png" }), "v1.png");
    form1.append("category", "logo");

    const up = await fetch(`${baseUrl}/api/media/upload`, {
      method: "POST",
      headers: { "x-workspace-id": ws },
      body: form1,
    }).then((r) => r.json());
    expect(up.id).toBeTruthy();
    const oldDiskPath = path.resolve(process.cwd(), String(up.url).replace(/^\/+/, ""));

    const form2 = new FormData();
    form2.append("file", new Blob([new Uint8Array(buildValidPngBuffer(20, 20))], { type: "image/png" }), "v2-logo.png");
    const repRes = await fetch(`${baseUrl}/api/media/${up.id}/replace`, {
      method: "POST",
      headers: { "x-workspace-id": ws },
      body: form2,
    });
    expect(repRes.status).toBe(200);
    const replaced = await repRes.json();
    expect(replaced.asset?.url).not.toBe(up.url);
    expect(replaced.asset?.originalName).toBe("v2-logo.png");
    expect(fs.existsSync(oldDiskPath)).toBe(false);

    // Cleanup replaced file
    await fetch(`${baseUrl}/api/media/${up.id}`, {
      method: "DELETE",
      headers: { "x-workspace-id": ws },
    });

    const telem = await fetch(`${baseUrl}/api/telemetry/usage`, {
      headers: { "x-workspace-id": ws },
    });
    expect(telem.status).toBe(200);
    const telemJson = await telem.json();
    expect(typeof telemJson.totalRuns).toBe("number");
    expect(typeof telemJson.avgLatencyMs).toBe("number");
    expect(Array.isArray(telemJson.recentModels)).toBe(true);
    expect(JSON.stringify(telemJson)).not.toMatch(/ck_foCAK|AIza/);
  });

  it("enforces Storyboard Approval Gate and Script Post-Approval Edit Lock", async () => {
    const ws = "test-ws-storyboard";
    const projCreate = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({ title: "Storyboard Gate Test", platform: "TikTok" }),
    }).then((r) => r.json());
    const id = projCreate.project.id as string;

    await fetch(`${baseUrl}/api/projects/${id}/approve-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({ script: "Hook -> Proof -> CTA", hook: "Stop scrolling." }),
    });

    const sbSave = await fetch(`${baseUrl}/api/projects/${id}/storyboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({
        scenes: [
          {
            number: "01",
            timeRange: "0:00-0:04",
            beat: "Hook",
            visual: "Close-up founder studio shot",
            dialogue: "Stop wasting hours stitching clips manually.",
          },
        ],
      }),
    }).then((r) => r.json());
    expect(sbSave.project?.status).toBe("STORYBOARD_READY");
    expect(sbSave.project?.storyboardApproved).toBe(false);

    // Must block production-plan and VIDEO_GENERATING while storyboardApproved is false
    const blockedPlan = await fetch(`${baseUrl}/api/projects/${id}/production-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({ formatType: "short_form", method: "hybrid" }),
    });
    expect(blockedPlan.status).toBe(409);

    const blockedTransition = await fetch(`${baseUrl}/api/projects/${id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({ status: "VIDEO_GENERATING" }),
    });
    expect(blockedTransition.status).toBe(409);

    // Approve storyboard -> unlocks STORYBOARD_APPROVED & production plan
    const sbApprove = await fetch(`${baseUrl}/api/projects/${id}/approve-storyboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    expect(sbApprove.project?.status).toBe("STORYBOARD_APPROVED");
    expect(sbApprove.project?.storyboardApproved).toBe(true);

    // Script post-approval edit lock creates revision & clears scriptApproved
    const lockEdit = await fetch(`${baseUrl}/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({ script: "Edited post-approval script text" }),
    }).then((r) => r.json());
    expect(lockEdit.project?.scriptApproved).toBe(false);
    expect(lockEdit.project?.status).toBe("AWAITING_SCRIPT_APPROVAL");
    expect(Array.isArray(lockEdit.project?.scriptVersions)).toBe(true);
    expect(lockEdit.project.scriptVersions.length).toBeGreaterThanOrEqual(1);
  });

  it("exposes model capabilities & verification, detects SDKs, encrypts analytics credentials, and isolates Growth Telemetry", async () => {
    const modelsRes = await fetch(`${baseUrl}/api/models`).then((r) => r.json());
    expect(Array.isArray(modelsRes.catalog?.text)).toBe(true);
    expect(modelsRes.catalog.text[0].capabilities).toBeTruthy();

    const verifyRes = await fetch(`${baseUrl}/api/models/verify`).then((r) => r.json());
    expect(typeof verifyRes.geminiConfigured).toBe("boolean");
    expect(Array.isArray(verifyRes.models)).toBe(true);
    expect(verifyRes.models.length).toBeGreaterThan(0);
    expect(typeof verifyRes.models[0].verificationStatus).toBe("string");
    expect(verifyRes.models[0].capabilities).toBeTruthy();

    const { detectTrackingTechnologies, safeGrowthPct, safeRatioPct } = await import(
      "../server/services/analyticsAdapters.ts"
    );
    expect(safeGrowthPct(10, 0)).toBeNull();
    expect(safeGrowthPct(null, 5)).toBeNull();
    expect(safeGrowthPct(120, 100)).toBe(20);
    expect(safeRatioPct(5, 0)).toBeNull();
    expect(safeRatioPct(25, 100)).toBe(25);

    const detected = detectTrackingTechnologies(`
      <html>
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
        <script>window.posthog.init('phc_123');</script>
        <a href="https://play.google.com/store/apps/details?id=com.test.app">Play Store</a>
      </html>
    `);
    expect(detected.sdks.find((s) => s.provider === "ga4")?.detected).toBe(true);
    expect(detected.sdks.find((s) => s.provider === "posthog")?.detected).toBe(true);
    expect(detected.storeLinks.some((l) => l.store === "google_play")).toBe(true);

    // Store connection in workspace A and verify secrets are masked and isolated from workspace B
    const fakeSecretKey = "phx_super_secret_token_987654";
    const connCreate = await fetch(`${baseUrl}/api/growth/connections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": "ws-growth-a" },
      body: JSON.stringify({
        provider: "posthog",
        authMode: "api_key",
        apiKey: fakeSecretKey,
        hostUrl: "https://us.posthog.com",
        runSync: false,
      }),
    }).then((r) => r.json());
    expect(connCreate.connection?.id).toBeTruthy();
    expect(JSON.stringify(connCreate)).not.toContain(fakeSecretKey);

    const dashA = await fetch(`${baseUrl}/api/growth/dashboard`, {
      headers: { "x-workspace-id": "ws-growth-a" },
    }).then((r) => r.json());
    expect(dashA.overlapWarning).toContain("incompatible identity models");
    expect(dashA.connections.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(dashA)).not.toContain(fakeSecretKey);

    const dashB = await fetch(`${baseUrl}/api/growth/dashboard`, {
      headers: { "x-workspace-id": "ws-growth-b" },
    }).then((r) => r.json());
    expect(dashB.connections.some((c: { id: string }) => c.id === connCreate.connection.id)).toBe(false);

    // Clean up connection
    const delConn = await fetch(`${baseUrl}/api/growth/connections/${connCreate.connection.id}`, {
      method: "DELETE",
      headers: { "x-workspace-id": "ws-growth-a" },
    }).then((r) => r.json());
    expect(delConn.deleted).toBe(true);
  });

  it("links automation workflow executions to persisted ContentProjects and supports full script-approval-to-final flow", async () => {
    const ws = "test-ws-auto-approval";

    // 1. Create a content workflow with script action + human approval gate
    const wfCreate = await fetch(`${baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({
        name: "Automated Script & Video Flow",
        triggerType: "manual",
        enabled: false,
        confirmedToActivate: false,
        requireHumanApproval: true,
        nodes: [
          { id: "n1", type: "trigger", label: "Manual Trigger", config: {} },
          { id: "n2", type: "action", label: "Draft Script Deliverable", config: { actionType: "content" } },
          { id: "n3", type: "approval_gate", label: "Human Review Before Publish", config: {} },
        ],
      }),
    }).then((r) => r.json());
    expect(wfCreate.workflow?.id).toBeTruthy();

    // 2. Run workflow -> execution log must link a persisted awaiting-approval ContentProject
    const runRes = await fetch(`${baseUrl}/api/workflows/${wfCreate.workflow.id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
    }).then((r) => r.json());
    expect(runRes.execution?.status).toBe("awaiting_approval");
    expect(runRes.execution?.projectId).toBeTruthy();

    const projectId = runRes.execution.projectId as string;

    // 3. Approve script -> SCRIPT_APPROVED
    const approveRes = await fetch(`${baseUrl}/api/projects/${projectId}/approve-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);
    const approved = await approveRes.json();
    expect(approved.project?.status).toBe("SCRIPT_APPROVED");
    expect(approved.project?.scriptApproved).toBe(true);

    // 4. Attach rendered MP4 directly from SCRIPT_APPROVED -> AWAITING_FINAL_APPROVAL
    const attachRes = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({
        editedVideoUrl: "/uploads/renders/auto-flow.mp4",
        videoUrl: "/uploads/renders/auto-flow.mp4",
        caption: "Approved script & edited MP4 ready for final approval.",
        status: "AWAITING_FINAL_APPROVAL",
      }),
    });
    expect(attachRes.status).toBe(200);
    const attached = await attachRes.json();
    expect(attached.project?.status).toBe("AWAITING_FINAL_APPROVAL");

    // 5. Grant final approval -> APPROVED_FOR_PUBLISHING
    const finalRes = await fetch(`${baseUrl}/api/projects/${projectId}/approve-final`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-workspace-id": ws },
      body: JSON.stringify({ caption: "Approved script & edited MP4 ready for final approval." }),
    });
    expect(finalRes.status).toBe(200);
    const finalized = await finalRes.json();
    expect(finalized.project?.status).toBe("APPROVED_FOR_PUBLISHING");
    expect(finalized.project?.finalApproved).toBe(true);
  });

  it("handles Business Intelligence jobs inline in simulated Vercel serverless mode without HTTP 500", async () => {
    const prevVercel = process.env.VERCEL;
    const prevGemini = process.env.GEMINI_API_KEY;
    process.env.VERCEL = "1";
    delete process.env.GEMINI_API_KEY;

    try {
      const biRes = await fetch(`${baseUrl}/api/jobs/business-intelligence`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": "test-ws-vercel-bi" },
        body: JSON.stringify({
          name: "Vercel Inline Test Co",
          websiteUrl: "http://127.0.0.1:9999/blocked",
        }),
      });
      expect(biRes.status).toBe(200);
      const biJson = await biRes.json();
      expect(biJson.executionMode).toBe("inline");
      expect(["failed", "partially_completed", "completed"]).toContain(biJson.job?.status);
      expect(String(biJson.job?.error || "")).toBeTruthy();

      const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
      expect(typeof health.capabilities?.geminiConfigured).toBe("boolean");
      expect(typeof health.capabilities?.composioConfigured).toBe("boolean");
    } finally {
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
      if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGemini;
    }
  });

  it("parses, filters placeholders, and masks secrets cleanly in vercel-env-sync script", async () => {
    const mod = (await import("../scripts/vercel-env-sync.mjs")) as {
      parseDotEnv: (s: string) => Record<string, string>;
      collectSyncEntries: (e: Record<string, string>) => {
        configured: Array<{ key: string; value: string; type: string }>;
        missing: string[];
      };
      maskSecretSummary: (v: string) => string;
    };
    const parsed = mod.parseDotEnv(`
      # comment
      GEMINI_API_KEY="MY_GEMINI_API_KEY"
      APP_URL=https://arial-tech-marketing-os.vercel.app
      COMPOSIO_API_KEY="ck_test_example_value_123"
      VITE_CUSTOM_FLAG="enabled"
    `);
    expect(parsed.GEMINI_API_KEY).toBe("MY_GEMINI_API_KEY");
    expect(parsed.APP_URL).toBe("https://arial-tech-marketing-os.vercel.app");

    const { configured, missing } = mod.collectSyncEntries(parsed);
    expect(configured.some((c) => c.key === "GEMINI_API_KEY")).toBe(false);
    expect(missing).toContain("GEMINI_API_KEY");
    expect(configured.find((c) => c.key === "APP_URL")?.type).toBe("encrypted");
    expect(configured.find((c) => c.key === "VITE_CUSTOM_FLAG")?.type).toBe("plain");
    expect(mod.maskSecretSummary("ck_test_example_value_123")).not.toContain("ck_test_example_value_123");
  });

  it("wires static ../server.js import in api/index.ts, resolves proxy URLs, enforces CORS & cron auth, and invokes serverless handler under VERCEL=1", async () => {
    const apiEntrySrc = fs.readFileSync(path.resolve(process.cwd(), "api/index.ts"), "utf8");
    expect(apiEntrySrc).toMatch(/from\s+["']\.\.\/server\.js["']/);
    expect(apiEntrySrc).not.toMatch(/bundledServerPath/);

    const { resolvePublicBaseUrl } = await import("../server/utils/paths.ts");
    const prevAppUrl = process.env.APP_URL;
    const prevVercelUrl = process.env.VERCEL_URL;
    const prevProdUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    try {
      delete process.env.APP_URL;
      delete process.env.VERCEL_URL;
      delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

      expect(
        resolvePublicBaseUrl({
          protocol: "http",
          headers: {
            "x-forwarded-proto": "https",
            "x-forwarded-host": "arial-tech-marketing-os.vercel.app",
          },
        }),
      ).toBe("https://arial-tech-marketing-os.vercel.app");

      process.env.VERCEL_PROJECT_PRODUCTION_URL = "arial-tech-marketing-os.vercel.app";
      expect(resolvePublicBaseUrl()).toBe("https://arial-tech-marketing-os.vercel.app");

      process.env.APP_URL = "https://custom.marketingos.app/";
      expect(resolvePublicBaseUrl()).toBe("https://custom.marketingos.app");
    } finally {
      if (prevAppUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = prevAppUrl;
      if (prevVercelUrl === undefined) delete process.env.VERCEL_URL;
      else process.env.VERCEL_URL = prevVercelUrl;
      if (prevProdUrl === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
      else process.env.VERCEL_PROJECT_PRODUCTION_URL = prevProdUrl;
    }

    // CORS preflight allow vs deny
    const allowedOriginRes = await fetch(`${baseUrl}/api/health`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(allowedOriginRes.status).toBe(204);
    expect(allowedOriginRes.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");

    const blockedOriginRes = await fetch(`${baseUrl}/api/health`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.untrusted.example" },
    });
    expect(blockedOriginRes.status).toBe(403);

    // Health capabilities + direct serverless handler invocation under VERCEL=1
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
    expect(typeof health.capabilities?.ffmpegAvailable).toBe("boolean");
    expect(typeof health.capabilities?.ffprobeAvailable).toBe("boolean");

    const prevVercel = process.env.VERCEL;
    const prevCron = process.env.CRON_SECRET;
    process.env.VERCEL = "1";
    process.env.CRON_SECRET = "cron_test_secret_abc";
    let serverlessServer: http.Server | null = null;
    try {
      const { default: vercelHandler } = await import("../api/index.ts");
      serverlessServer = http.createServer((req, res) => {
        void vercelHandler(req, res);
      });
      await new Promise<void>((resolve) => serverlessServer!.listen(0, "127.0.0.1", resolve));
      const addr = serverlessServer.address();
      if (!addr || typeof addr === "string") throw new Error("No serverless bind port");
      const slBase = `http://127.0.0.1:${addr.port}`;

      const slHealthRes = await fetch(`${slBase}/api/health`);
      expect(slHealthRes.status).toBe(200);
      const slHealth = await slHealthRes.json();
      expect(slHealth.ok).toBe(true);
      expect(slHealth.runtime).toBe("vercel-serverless");

      const unauthCron = await fetch(`${slBase}/api/cron/tick`);
      expect(unauthCron.status).toBe(401);

      const authCron = await fetch(`${slBase}/api/cron/tick`, {
        headers: { Authorization: "Bearer cron_test_secret_abc" },
      });
      expect(authCron.status).toBe(200);
      const cronJson = await authCron.json();
      expect(cronJson.ok).toBe(true);
    } finally {
      if (serverlessServer) {
        await new Promise<void>((resolve) => serverlessServer!.close(() => resolve()));
      }
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
      if (prevCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevCron;
    }
  });
});




