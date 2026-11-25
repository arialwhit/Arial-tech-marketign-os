import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ModelSelector } from "../components/ModelSelector";
import { CardTitle, PageHeader } from "./IntelligenceViews";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import {
  formatFirebaseAuthError,
  reloadCurrentUser,
  resetPasswordEmail,
  sendVerificationEmail,
  signOutGoogle,
  updateUserProfileInfo,
} from "../lib/firebase";
import type {
  AdCampaignItem,
  AnalyticsConnectionSummary,
  AnalyticsProviderId,
  AutomationExecutionLog,
  AutomationRunLog,
  AutomationWorkflow,
  CalendarPost,
  CompetitorItem,
  ContentProject,
  CreditTransaction,
  IntegrationRecommendation,
  ModelCatalog,
  ModelPreferences,
  Page,
  SearchConsoleResponse,
  SeoKeywordItem,
  SupabaseTableMappings,
  WeeklySeoReport,
  WorkflowNode,
  WorkspaceProfile,
} from "../types/marketing";

interface ComposioAccountSummary {
  id: string;
  toolkit: string;
  status: "active" | "initiated" | "failed" | "disconnected";
  isDefault: boolean;
  username?: string;
  displayName?: string;
}

interface SocialCapabilityEntry {
  status: "Supported" | "Setup Required" | "Unsupported";
  toolSlug?: string;
  note: string;
}

interface SocialPlatformCoverage {
  platform: string;
  badge: string;
  toolkit: string;
  handlePlaceholder: string;
  connectionStatus: "Connected" | "Setup Required";
  accounts: ComposioAccountSummary[];
  primaryAccount: ComposioAccountSummary | null;
  capabilities: {
    publishText: SocialCapabilityEntry;
    publishMedia: SocialCapabilityEntry;
    scheduleNative: SocialCapabilityEntry;
    profileRead: SocialCapabilityEntry;
    analyticsInsights: SocialCapabilityEntry;
    adCampaigns: SocialCapabilityEntry;
  };
}

interface ComposioConnectionsResponse {
  configured: boolean;
  mode: string;
  mcpUrl: string;
  statuses: Record<string, { toolkit: string; status: string; accounts: ComposioAccountSummary[] }>;
  accounts: ComposioAccountSummary[];
  socialCoverage: SocialPlatformCoverage[];
  logs: Array<{
    id: string;
    toolkit: string;
    action: string;
    status: string;
    detail: string;
    createdAt: string;
  }>;
}

export function CalendarView({
  calendarPosts,
  approved,
  onAddPost,
  onCreateProjectFromEntry,
  onOpenWorkspaceHub,
  go,
  notify,
}: {
  calendarPosts: CalendarPost[];
  approved: boolean;
  onAddPost: (post: CalendarPost) => void;
  onCreateProjectFromEntry?: (id: string) => Promise<ContentProject>;
  onOpenWorkspaceHub: () => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const currentMonthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const firstWeekdayOffset = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;

  const [view, setView] = useState<"Month" | "Week" | "Day" | "List">("Month");
  const [channelFilter, setChannelFilter] = useState("All");
  const [composerTitle, setComposerTitle] = useState("");
  const [composerDate, setComposerDate] = useState(todayIso);
  const [composerTime, setComposerTime] = useState("18:00");
  const [composerPlatform, setComposerPlatform] = useState("Instagram");
  const [composerCaption, setComposerCaption] = useState("");
  const [schedulingBusy, setSchedulingBusy] = useState(false);

  const totalCells = Math.ceil((firstWeekdayOffset + daysInMonth) / 7) * 7;
  const days = Array.from({ length: totalCells }, (_, i) => i + 1 - firstWeekdayOffset);
  const visiblePosts = calendarPosts.filter(
    (p) => channelFilter === "All" || p.platform.toLowerCase().includes(channelFilter.toLowerCase()),
  );

  const scheduleNewPost = async () => {
    if (!composerTitle.trim()) {
      notify("Enter a post title first");
      return;
    }
    setSchedulingBusy(true);
    const parsedDay = Number(composerDate.split("-")[2] || now.getDate());
    const id = `cal-${Date.now()}`;
    onAddPost({
      id,
      title: composerTitle.trim(),
      platform: composerPlatform,
      dateStr: composerDate,
      dayOfMonth: parsedDay,
      timeStr: composerTime,
      tone: "mint",
      caption: composerCaption.trim(),
      status: approved ? "Scheduled" : "Needs review",
      checksPassed: approved ? 5 : 4,
      thumbUrl: "",
      sourceType: "manual",
    });

    try {
      await apiPost("/api/scheduler/jobs", {
        title: composerTitle.trim(),
        platform: composerPlatform,
        caption: composerCaption.trim() || composerTitle.trim(),
        scheduledForIso: new Date(`${composerDate}T${composerTime || "18:00"}:00`).toISOString(),
        approvedForAutoPublish: false,
        idempotencyKey: id,
      });
      notify("Post saved to calendar & server scheduler queue");
    } catch {
      notify("Post scheduled to calendar & Publishing Queue");
    } finally {
      setComposerTitle("");
      setComposerCaption("");
      setSchedulingBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Distribution planning"
        title="Content Calendar"
        copy="Plan, approve, and schedule every channel from one view."
        actions={
          <>
            <button className="btn secondary" onClick={onOpenWorkspaceHub}>
              Sync to Google Calendar
            </button>
            <button
              className="btn primary"
              disabled={!composerTitle.trim() || schedulingBusy}
              onClick={() => void scheduleNewPost()}
            >
              {schedulingBusy ? "Scheduling…" : "＋ Schedule composer draft"}
            </button>
          </>
        }
      />

      <div className="calendar-toolbar">
        <div>
          <h2>{currentMonthLabel}</h2>
        </div>
        <div className="view-switch">
          {(["Month", "Week", "Day", "List"] as const).map((x) => (
            <button className={view === x ? "active" : ""} onClick={() => setView(x)} key={x}>
              {x}
            </button>
          ))}
        </div>
        <select
          className="filter"
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
        >
          <option value="All">All channels</option>
          <option value="Instagram">Instagram</option>
          <option value="Facebook">Facebook</option>
          <option value="TikTok">TikTok</option>
          <option value="YouTube">YouTube</option>
          <option value="LinkedIn">LinkedIn</option>
          <option value="X">X</option>
        </select>
      </div>

      <div className="calendar-layout">
        <section className="calendar card">
          {view === "List" || view === "Day" ? (
            <div className="mos-stack" style={{ padding: 16 }}>
              {visiblePosts.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>
                  No scheduled posts yet. Use the Post Composer on the right or AI Command Center to
                  schedule your first campaign posts.
                </p>
              ) : (
                visiblePosts.map((p) => (
                  <div key={p.id} className="mos-list-row">
                    <span>
                      <b>{p.title}</b>
                      <small>
                        {p.dateStr} · {p.timeStr} · {p.platform} {p.projectStatus ? `· ${p.projectStatus}` : ""}
                      </small>
                    </span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {onCreateProjectFromEntry && (
                        <button
                          type="button"
                          className="btn secondary"
                          style={{ height: 28, padding: "0 10px", fontSize: 11 }}
                          onClick={() => {
                            void onCreateProjectFromEntry(p.id)
                              .then((proj) => {
                                notify(`Project ready: ${proj.title}`);
                                go("Content Studio");
                              })
                              .catch((err) => notify(err instanceof Error ? err.message : "Failed"));
                          }}
                        >
                          {p.contentProjectId ? "Open Project →" : "Create Project →"}
                        </button>
                      )}
                      <span className={`badge ${p.status === "Published" ? "mint" : "ready"}`}>
                        <i />
                        {p.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              <div className="weekdays">
                {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
              <div className="calendar-days">
                {(view === "Week" ? days.slice(0, 7) : days).map((d, i) => {
                  const inMonth = d >= 1 && d <= daysInMonth;
                  return (
                    <div
                      className={`${!inMonth ? "muted" : ""} ${inMonth && d === now.getDate() ? "today" : ""}`}
                      key={i}
                    >
                      <span>{d < 1 ? "" : d > daysInMonth ? d - daysInMonth : d}</span>
                      {inMonth &&
                        visiblePosts
                          .filter((p) => p.dayOfMonth === d)
                          .map((p) => (
                            <button className={`cal-item ${p.tone}`} key={p.id}>
                              <b>{p.title}</b>
                              <small>
                                {p.platform} · {p.timeStr}
                              </small>
                            </button>
                          ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <aside className="schedule-panel card">
          <span className={`badge ${approved ? "mint" : "review"}`}>
            <i />
            {approved ? "Approved content" : "Approval recommended"}
          </span>
          <h3>Post Composer</h3>
          <label>Title</label>
          <input
            placeholder="e.g., Launch announcement clip"
            value={composerTitle}
            onChange={(e) => setComposerTitle(e.target.value)}
          />
          <label>Channel</label>
          <select
            value={composerPlatform}
            onChange={(e) => setComposerPlatform(e.target.value)}
          >
            <option>Instagram</option>
            <option>Facebook</option>
            <option>TikTok</option>
            <option>YouTube</option>
            <option>LinkedIn</option>
            <option>X</option>
          </select>
          <label>Publication date</label>
          <input
            type="date"
            value={composerDate}
            onChange={(e) => setComposerDate(e.target.value)}
          />
          <label>Time</label>
          <input
            type="time"
            value={composerTime}
            onChange={(e) => setComposerTime(e.target.value)}
          />
          <label>Caption</label>
          <textarea
            placeholder="Write the post caption and CTA…"
            value={composerCaption}
            onChange={(e) => setComposerCaption(e.target.value)}
          />
          <button
            className="btn primary"
            disabled={!composerTitle.trim() || schedulingBusy}
            onClick={() => void scheduleNewPost()}
          >
            {schedulingBusy ? "Scheduling…" : "Schedule post"}
          </button>
          <button className="text-button" onClick={() => go("Publishing Queue")}>
            Go to Publishing Queue →
          </button>
        </aside>
      </div>
    </>
  );
}

export function SocialAccountsView({
  workspace,
  onUpdateWorkspace,
  notify,
}: {
  workspace: WorkspaceProfile;
  onUpdateWorkspace: (patch: Partial<WorkspaceProfile>) => void;
  notify: (s: string) => void;
}) {
  const [coverage, setCoverage] = useState<SocialPlatformCoverage[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingToolkit, setConnectingToolkit] = useState("");
  const [pendingAuthLink, setPendingAuthLink] = useState<{ toolkit: string; url: string } | null>(null);
  const [liveProfileData, setLiveProfileData] = useState<{
    platform: string;
    profile: Record<string, unknown>;
    recentMedia?: Array<Record<string, unknown>>;
  } | null>(null);
  const [syncingPlatform, setSyncingPlatform] = useState("");

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<ComposioConnectionsResponse>("/api/composio/connections");
      setCoverage(res.socialCoverage || []);
      const connectedNames = (res.socialCoverage || [])
        .filter((p) => p.connectionStatus === "Connected")
        .map((p) => p.platform);
      if (connectedNames.length > 0) {
        const merged = Array.from(new Set([...workspace.channels, ...connectedNames]));
        if (merged.length !== workspace.channels.length) {
          onUpdateWorkspace({ channels: merged });
        }
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to load Composio social accounts");
    } finally {
      setLoading(false);
    }
  }, [notify, onUpdateWorkspace, workspace.channels]);

  useEffect(() => {
    void loadConnections();
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.type === "MOS_OAUTH_CALLBACK") {
        setPendingAuthLink(null);
        void loadConnections();
        notify("OAuth authorization callback received — syncing connected accounts");
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [loadConnections, notify]);

  const initiateConnect = async (platformName: string, toolkit: string) => {
    setConnectingToolkit(toolkit);
    try {
      const res = await apiPost<{ redirectUrl: string }>("/api/composio/connect", {
        toolkit,
        alias: workspace.name || platformName,
      });
      setPendingAuthLink({ toolkit: platformName, url: res.redirectUrl });
      notify(`OAuth Connect Link ready for ${platformName} — open link below to authorize`);
    } catch (err) {
      notify(err instanceof Error ? err.message : `Failed to start OAuth for ${platformName}`);
    } finally {
      setConnectingToolkit("");
    }
  };

  const disconnectAccount = async (toolkit: string, accountId: string, platformName: string) => {
    try {
      await apiDelete("/api/composio/accounts", { toolkit, accountId });
      notify(`Disconnected ${platformName}`);
      await loadConnections();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Disconnect failed");
    }
  };

  const inspectLiveProfile = async (platformName: string) => {
    setSyncingPlatform(platformName);
    try {
      const res = await apiPost<{
        connected: boolean;
        profile?: Record<string, unknown>;
        recentMedia?: Array<Record<string, unknown>>;
        message?: string;
      }>("/api/social/profile", { platform: platformName });
      if (!res.connected || !res.profile) {
        notify(res.message || `${platformName} not connected`);
        return;
      }
      setLiveProfileData({
        platform: platformName,
        profile: res.profile,
        recentMedia: res.recentMedia,
      });
      notify(`Synced live ${platformName} profile via Composio`);
    } catch (err) {
      notify(err instanceof Error ? err.message : `Live sync failed for ${platformName}`);
    } finally {
      setSyncingPlatform("");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Channel management · Composio OAuth"
        title="Social Accounts"
        copy="Connect 6 social platforms via Composio OAuth with live API inspection and explicit capability coverage."
        actions={
          <button className="btn secondary" onClick={() => void loadConnections()} disabled={loading}>
            {loading ? "Syncing…" : "↻ Refresh Composio Accounts"}
          </button>
        }
      />

      {pendingAuthLink && (
        <div
          className="card"
          style={{
            padding: 14,
            marginBottom: 14,
            borderColor: "var(--mint)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <b>Authorize {pendingAuthLink.toolkit} via Composio OAuth</b>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              Open the secure authorization link in a new tab, complete consent, then click Refresh.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <a
              className="btn primary"
              href={pendingAuthLink.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open OAuth Connect Page ↗
            </a>
            <button className="btn secondary" onClick={() => void loadConnections()}>
              I Finished — Refresh
            </button>
            <button className="btn ghost" onClick={() => setPendingAuthLink(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="social-grid">
        {coverage.map((item) => {
          const isConn = item.connectionStatus === "Connected";
          const handleDisplay = item.primaryAccount?.username
            ? `@${item.primaryAccount.username.replace(/^@/, "")}`
            : item.primaryAccount?.displayName || "No account connected";
          const capEntries = [
            ["Publish Media", item.capabilities.publishMedia],
            ["Publish Text", item.capabilities.publishText],
            ["Read Profile", item.capabilities.profileRead],
            ["Analytics", item.capabilities.analyticsInsights],
            ["Ad Campaigns", item.capabilities.adCampaigns],
          ] as const;

          return (
            <article className="card social-card" key={item.platform}>
              <div>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 700,
                    fontSize: 13,
                    color: isConn ? "var(--mint)" : "var(--muted)",
                    flexShrink: 0,
                  }}
                >
                  {item.badge}
                </div>
                <span>
                  <h3>{item.platform}</h3>
                  <p>{handleDisplay}</p>
                </span>
                <span className={`badge ${isConn ? "mint" : "draft"}`}>
                  <i />
                  {item.connectionStatus}
                </span>
              </div>

              <div style={{ display: "grid", gap: 4, margin: "10px 0", fontSize: 11 }}>
                {capEntries.map(([label, cap]) => (
                  <div
                    key={label}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                    title={cap.note}
                  >
                    <span style={{ color: "var(--muted)" }}>{label}</span>
                    <b
                      style={{
                        color:
                          cap.status === "Supported"
                            ? "var(--mint)"
                            : cap.status === "Setup Required"
                              ? "var(--gold)"
                              : "var(--red)",
                      }}
                    >
                      {cap.status}
                    </b>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {isConn && item.primaryAccount ? (
                  <>
                    <button
                      className="btn secondary"
                      style={{ flex: 1 }}
                      disabled={syncingPlatform === item.platform}
                      onClick={() => void inspectLiveProfile(item.platform)}
                    >
                      {syncingPlatform === item.platform ? "Syncing…" : "Inspect Live Profile"}
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() =>
                        void disconnectAccount(item.toolkit, item.primaryAccount!.id, item.platform)
                      }
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    className="btn primary"
                    style={{ width: "100%" }}
                    disabled={connectingToolkit === item.toolkit}
                    onClick={() => void initiateConnect(item.platform, item.toolkit)}
                  >
                    {connectingToolkit === item.toolkit
                      ? "Generating OAuth Link…"
                      : `Connect ${item.platform}`}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {liveProfileData && (
        <section className="card" style={{ padding: 18, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span className="badge mint">
                <i />
                Live API Read · {liveProfileData.platform}
              </span>
              <h3 style={{ marginTop: 6 }}>
                @{String(liveProfileData.profile.username || liveProfileData.profile.name || "account")}
              </h3>
            </div>
            <button className="btn ghost" onClick={() => setLiveProfileData(null)}>
              Close
            </button>
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 12, fontSize: 13 }}>
            {typeof liveProfileData.profile.followers_count === "number" && (
              <div>
                <small style={{ color: "var(--muted)", display: "block" }}>Followers</small>
                <b>{liveProfileData.profile.followers_count.toLocaleString()}</b>
              </div>
            )}
            {typeof liveProfileData.profile.follows_count === "number" && (
              <div>
                <small style={{ color: "var(--muted)", display: "block" }}>Following</small>
                <b>{liveProfileData.profile.follows_count.toLocaleString()}</b>
              </div>
            )}
            {typeof liveProfileData.profile.media_count === "number" && (
              <div>
                <small style={{ color: "var(--muted)", display: "block" }}>Media Count</small>
                <b>{liveProfileData.profile.media_count.toLocaleString()}</b>
              </div>
            )}
            {typeof liveProfileData.profile.biography === "string" && liveProfileData.profile.biography && (
              <div style={{ maxWidth: 480 }}>
                <small style={{ color: "var(--muted)", display: "block" }}>Bio</small>
                <span>{liveProfileData.profile.biography}</span>
              </div>
            )}
          </div>

          {liveProfileData.recentMedia && liveProfileData.recentMedia.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <small style={{ color: "var(--muted)", display: "block", marginBottom: 8 }}>
                Recent Live Posts ({liveProfileData.recentMedia.length})
              </small>
              <div className="mos-stack">
                {liveProfileData.recentMedia.slice(0, 4).map((m, idx) => (
                  <div key={String(m.id || idx)} className="mos-list-row">
                    <span>
                      <b>{String(m.caption || "Untitled post").slice(0, 90)}</b>
                      <small>
                        {String(m.media_type || "MEDIA")} · {String(m.timestamp || "").slice(0, 10)}
                      </small>
                    </span>
                    {typeof m.permalink === "string" && (
                      <a
                        className="btn ghost"
                        href={m.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function PublishingQueueView({
  posts,
  projects = [],
  onPatchProject,
  onRefreshPipeline,
  onOpenProject,
  onPublishPost,
  go,
  notify,
}: {
  posts: CalendarPost[];
  projects?: ContentProject[];
  onPatchProject?: (id: string, patch: Partial<ContentProject>) => Promise<ContentProject>;
  onRefreshPipeline?: () => Promise<void>;
  onOpenProject?: (
    p: ContentProject,
    dest?: "auto" | "brief" | "scripts" | "storyboard" | "video" | "avatar" | "queue",
  ) => void;
  onPublishPost: (id: string) => void;
  go?: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [filterTab, setFilterTab] = useState<"All" | "Awaiting Script" | "Awaiting Final" | "Ready" | "Scheduled" | "Published">("All");
  const [confirmPost, setConfirmPost] = useState<CalendarPost | null>(null);
  const [publishingId, setPublishingId] = useState("");
  const [approvingProjectId, setApprovingProjectId] = useState("");
  const [coverage, setCoverage] = useState<SocialPlatformCoverage[]>([]);
  const [postResultMap, setPostResultMap] = useState<Record<string, { postId?: string; note?: string }>>({});

  useEffect(() => {
    apiGet<ComposioConnectionsResponse>("/api/composio/connections")
      .then((res) => setCoverage(res.socialCoverage || []))
      .catch(() => {});
  }, []);

  const isPlatformConnected = (platform: string) => {
    const p = platform.toLowerCase();
    return coverage.some(
      (c) => c.connectionStatus === "Connected" && p.includes(c.platform.toLowerCase()),
    );
  };

  const getProjectBlockers = (p: ContentProject) => {
    const blockers: string[] = [];
    if (!p.script?.trim() && !(p.scriptVariants?.length)) blockers.push("Script missing");
    if (!p.scriptApproved) blockers.push("Script approval needed");
    if (!p.videoUrl && !p.editedVideoUrl && !p.thumbUrl) blockers.push("Video / creative asset missing");
    if (!p.caption?.trim()) blockers.push("Caption missing");
    if (!p.finalApproved) blockers.push("Final human approval needed");
    return blockers;
  };

  const approveProjectScript = async (proj: ContentProject) => {
    setApprovingProjectId(proj.id);
    try {
      const res = await apiPost<{ project: ContentProject }>(`/api/projects/${proj.id}/approve-script`, {
        script: proj.script || proj.scriptVariants?.[0]?.body || proj.title,
        hook: proj.hook || proj.scriptVariants?.[0]?.hook || "",
        cta: proj.cta || proj.scriptVariants?.[0]?.cta || "",
      });
      if (res.project && onPatchProject) await onPatchProject(proj.id, res.project);
      await onRefreshPipeline?.();
      notify(`Script approved for "${proj.title}" — ready for Storyboard / Video`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Script approval failed");
    } finally {
      setApprovingProjectId("");
    }
  };

  const approveProjectFinal = async (proj: ContentProject) => {
    setApprovingProjectId(proj.id);
    try {
      const res = await apiPost<{ project: ContentProject }>(`/api/projects/${proj.id}/approve-final`, {
        caption: proj.caption || proj.title,
      });
      if (res.project && onPatchProject) await onPatchProject(proj.id, res.project);
      await onRefreshPipeline?.();
      notify(`Final human approval granted for "${proj.title}"`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Final approval blocked");
    } finally {
      setApprovingProjectId("");
    }
  };

  const executeLivePublish = async (post: CalendarPost) => {
    setPublishingId(post.id);
    setConfirmPost(null);
    try {
      const targetPlatform = post.platform.split("+")[0].trim() || "Instagram";
      const res = await apiPost<{
        published: boolean;
        providerPostId?: string;
        platform?: string;
      }>("/api/social/publish", {
        platform: targetPlatform,
        title: post.title,
        caption: post.caption || post.title,
        mediaUrl: post.thumbUrl || undefined,
        confirmed: true,
        idempotencyKey: `pub_${post.id}`,
      });
      if (res.published) {
        onPublishPost(post.id);
        setPostResultMap((prev) => ({
          ...prev,
          [post.id]: { postId: res.providerPostId, note: `Live ID: ${res.providerPostId}` },
        }));
        notify(`Live published "${post.title}" to ${targetPlatform} (${res.providerPostId})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Live publishing failed";
      setPostResultMap((prev) => ({
        ...prev,
        [post.id]: { note: msg },
      }));
      notify(msg);
    } finally {
      setPublishingId("");
    }
  };

  const filteredPosts = posts.filter((p) => {
    if (filterTab === "All") return true;
    if (filterTab === "Ready") return p.status === "Ready";
    if (filterTab === "Scheduled") return p.status === "Scheduled";
    if (filterTab === "Published") return p.status === "Published";
    if (filterTab === "Awaiting Script") return p.projectStatus === "SCRIPT_PENDING" || p.projectStatus === "AWAITING_SCRIPT_APPROVAL";
    if (filterTab === "Awaiting Final") return p.status === "Needs review" || p.projectStatus === "AWAITING_FINAL_APPROVAL";
    return true;
  });

  const filteredProjects = projects.filter((p) => {
    if (filterTab === "All") return true;
    if (filterTab === "Awaiting Script") return !p.scriptApproved;
    if (filterTab === "Awaiting Final") return Boolean(p.scriptApproved && !p.finalApproved);
    if (filterTab === "Ready") return Boolean(p.finalApproved && p.status !== "PUBLISHED" && p.status !== "SCHEDULED");
    if (filterTab === "Scheduled") return p.status === "SCHEDULED";
    if (filterTab === "Published") return p.status === "PUBLISHED";
    return true;
  });

  return (
    <>
      <PageHeader
        eyebrow="Publishing operations"
        title="Publishing Queue"
        copy="Explicit approval gates, blocking diagnostics, Composio API checks, and human-confirmed live publishing."
      />

      <ConfirmDialog
        open={Boolean(confirmPost)}
        title={`Live Publish "${confirmPost?.title || ""}"?`}
        description={
          confirmPost && isPlatformConnected(confirmPost.platform)
            ? `This will dispatch a real post to your connected ${confirmPost.platform} account via Composio API.`
            : `${confirmPost?.platform || "This channel"} is not yet connected via Composio OAuth. Connect it in Social Accounts first, or dispatch will return Setup Required.`
        }
        confirmLabel="Confirm Live Publish"
        onCancel={() => setConfirmPost(null)}
        onConfirm={() => {
          if (confirmPost) {
            void executeLivePublish(confirmPost);
          }
        }}
      />

      <div className="queue-summary">
        {[
          ["Ready", posts.filter((p) => p.status === "Ready").length + projects.filter((p) => p.finalApproved).length, "mint"],
          ["Needs approval", projects.filter((p) => !p.finalApproved).length, "gold"],
          ["Scheduled", posts.filter((p) => p.status === "Scheduled").length, "blue"],
          ["Published", posts.filter((p) => p.status === "Published").length, "mint"],
        ].map((x) => (
          <span key={x[0] as string}>
            <i className={x[2] as string} />
            <b>{x[1]}</b>
            <small>{x[0]}</small>
          </span>
        ))}
      </div>

      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <div className="tabs">
          {(["All", "Awaiting Script", "Awaiting Final", "Ready", "Scheduled", "Published"] as const).map((t) => (
            <button key={t} className={filterTab === t ? "active" : ""} onClick={() => setFilterTab(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {filteredProjects.length > 0 && (
        <section className="card" style={{ padding: 16, marginBottom: 14 }}>
          <CardTitle title={`Production Projects in Queue (${filteredProjects.length})`} copy="Clear every blocking gate before granting Final Human Approval." />
          <div className="mos-stack" style={{ marginTop: 10 }}>
            {filteredProjects.map((proj) => {
              const blockers = getProjectBlockers(proj);
              const onlyNeedsFinal = blockers.length === 1 && blockers[0] === "Final human approval needed";
              return (
                <div key={proj.id} className="mos-list-row" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 220 }}>
                    <b>{proj.title}</b> <small>({proj.platform} · {proj.status || proj.stage})</small>
                    {blockers.length > 0 ? (
                      <small style={{ color: "var(--gold)", display: "block" }}>
                        Blocked by: {blockers.join(" · ")}
                      </small>
                    ) : (
                      <small style={{ color: "var(--mint)", display: "block" }}>
                        All production &amp; human approval gates passed
                      </small>
                    )}
                  </span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {!proj.scriptApproved && (
                      <>
                        {(proj.script?.trim() || proj.scriptVariants?.length) && (
                          <button
                            type="button"
                            className="btn primary"
                            style={{ height: 28, fontSize: 11 }}
                            disabled={approvingProjectId === proj.id}
                            onClick={() => void approveProjectScript(proj)}
                          >
                            {approvingProjectId === proj.id ? "Approving…" : "✓ Approve Script"}
                          </button>
                        )}
                        {(onOpenProject || go) && (
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ height: 28, fontSize: 11 }}
                            onClick={() =>
                              onOpenProject ? onOpenProject(proj, "scripts") : go?.("Content Studio")
                            }
                          >
                            Review Script →
                          </button>
                        )}
                      </>
                    )}
                    {proj.scriptApproved && !proj.videoUrl && !proj.editedVideoUrl && (onOpenProject || go) && (
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ height: 28, fontSize: 11 }}
                        onClick={() =>
                          onOpenProject ? onOpenProject(proj, "video") : go?.("Video Editor")
                        }
                      >
                        Attach Video →
                      </button>
                    )}
                    {!proj.finalApproved && onlyNeedsFinal && (
                      <button
                        type="button"
                        className="btn primary"
                        style={{ height: 28, fontSize: 11 }}
                        disabled={approvingProjectId === proj.id}
                        onClick={() => void approveProjectFinal(proj)}
                      >
                        {approvingProjectId === proj.id ? "Approving…" : "Grant Final Approval ✓"}
                      </button>
                    )}
                    {proj.finalApproved && (
                      <button
                        type="button"
                        className="btn primary"
                        style={{ height: 28, fontSize: 11 }}
                        onClick={() =>
                          setConfirmPost({
                            id: proj.id,
                            title: proj.title,
                            platform: proj.platform,
                            dateStr: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                            dayOfMonth: new Date().getDate(),
                            timeStr: "Now",
                            tone: "mint",
                            caption: proj.caption || proj.title,
                            status: "Ready",
                            checksPassed: 5,
                            thumbUrl: proj.editedVideoUrl || proj.videoUrl || proj.thumbUrl || "",
                            sourceType: proj.sourceType,
                          })
                        }
                      >
                        Publish →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="card queue-table">
        <div className="table-head">
          <span>Content</span>
          <span>Channels</span>
          <span>Scheduled</span>
          <span>Checks</span>
          <span>Status</span>
          <span />
        </div>
        {filteredPosts.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            No matching calendar entries in Publishing Queue. Schedule posts from Content Calendar or AI Command Center.
          </div>
        ) : (
          filteredPosts.map((post) => {
            const conn = isPlatformConnected(post.platform);
            const meta = postResultMap[post.id];
            const linkedProj = post.contentProjectId ? projects.find((pr) => pr.id === post.contentProjectId) : undefined;
            const projBlockers = linkedProj ? getProjectBlockers(linkedProj) : [];
            const blockedByApproval = post.status === "Needs review" || projBlockers.length > 0;
            return (
              <div className="queue-row" key={post.id}>
                <div>
                  {post.thumbUrl ? (
                    <img src={post.thumbUrl} alt={post.title} />
                  ) : (
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 6,
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--mint)",
                        flexShrink: 0,
                      }}
                    >
                      {post.title.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span>
                    <b>{post.title}</b>
                    <small>
                      {projBlockers.length > 0
                        ? `Blocked: ${projBlockers.join(", ")}`
                        : meta?.note || (post.caption || "No caption yet").slice(0, 56)}
                    </small>
                  </span>
                </div>
                <span>
                  {post.platform}
                  <small style={{ display: "block", fontSize: 11, color: conn ? "var(--mint)" : "var(--muted)" }}>
                    {conn ? "API Connected" : "Setup Required"}
                  </small>
                </span>
                <span>
                  {post.dateStr} · {post.timeStr}
                </span>
                <span className="checks">{post.checksPassed}/5 passed</span>
                <span
                  className={`badge ${
                    post.status === "Published"
                      ? "mint"
                      : post.status === "Ready"
                        ? "ready"
                        : "review"
                  }`}
                >
                  <i />
                  {post.status}
                </span>
                {post.status !== "Published" ? (
                  <button
                    className="btn primary"
                    disabled={publishingId === post.id || blockedByApproval}
                    title={blockedByApproval ? "Complete final approval first before publishing" : "Publish now"}
                    onClick={() => setConfirmPost(post)}
                  >
                    {publishingId === post.id ? "Publishing…" : blockedByApproval ? "Approval Needed" : "Publish"}
                  </button>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--mint)" }}>
                    ✓ {meta?.postId ? `ID ${meta.postId.slice(0, 10)}` : "Published"}
                  </span>
                )}
              </div>
            );
          })
        )}
      </section>
    </>
  );
}

export function AdsManagerView({
  workspace,
  adCampaigns,
  models,
  modelCatalog,
  onSelectTextModel,
  onCreateCampaign,
  onConsumeCredits,
  notify,
}: {
  workspace: WorkspaceProfile;
  adCampaigns: AdCampaignItem[];
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  onSelectTextModel: (id: string) => void;
  onCreateCampaign: (c: AdCampaignItem) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  notify: (s: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [objective, setObjective] = useState("App installs");
  const [audienceLoc, setAudienceLoc] = useState(workspace.targetCountries || "");
  const [audienceInterests, setAudienceInterests] = useState("");
  const [budgetUsd, setBudgetUsd] = useState(300);
  const [primaryText, setPrimaryText] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitToMetaLive, setSubmitToMetaLive] = useState(false);
  const [metaConnected, setMetaConnected] = useState(false);
  const [metaAccounts, setMetaAccounts] = useState<Array<{ id: string; name?: string }>>([]);
  const [selectedAdAccount, setSelectedAdAccount] = useState("");
  const [liveCampaigns, setLiveCampaigns] = useState<Array<{ id: string; name: string; status: string; objective?: string }>>([]);
  const [connectLink, setConnectLink] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [forecast, setForecast] = useState<{
    estimatedResultsRange: string;
    estimatedCpaRange: string;
    estimatedReachRange: string;
  } | null>(null);
  const [forecastBusy, setForecastBusy] = useState(false);

  const loadMetaState = useCallback(async () => {
    try {
      const accRes = await apiGet<{
        connected: boolean;
        accounts?: Array<{ id: string; name?: string }>;
      }>("/api/ads/meta/accounts");
      setMetaConnected(Boolean(accRes.connected));
      const accs = accRes.accounts || [];
      setMetaAccounts(accs);
      if (accs[0]?.id) {
        setSelectedAdAccount(accs[0].id);
        const campRes = await apiGet<{
          campaigns?: Array<{ id: string; name: string; status: string; objective?: string }>;
        }>(`/api/ads/meta/campaigns?adAccountId=${encodeURIComponent(accs[0].id)}`);
        setLiveCampaigns(campRes.campaigns || []);
      }
    } catch {
      setMetaConnected(false);
    }
  }, []);

  useEffect(() => {
    void loadMetaState();
  }, [loadMetaState]);

  const labels = ["Objective", "Audience", "Budget", "Creative", "Review"];

  const generateAiForecast = async () => {
    setForecastBusy(true);
    try {
      const res = await apiPost<{
        estimatedResultsRange: string;
        estimatedCpaRange: string;
        estimatedReachRange: string;
        primaryCopyVariants?: string[];
      }>("/api/ads/forecast", {
        objective,
        audience: `${audienceLoc} · ${audienceInterests}`,
        budgetUsd,
        business: workspace,
        model: models.textModel,
      });
      setForecast({
        estimatedResultsRange: res.estimatedResultsRange || "Estimate ready",
        estimatedCpaRange: res.estimatedCpaRange || "—",
        estimatedReachRange: res.estimatedReachRange || "—",
      });
      if (res.primaryCopyVariants?.[0]) setPrimaryText(res.primaryCopyVariants[0]);
      onConsumeCredits(35, "Meta Ads AI Copy & Forecast");
      notify("Updated Meta campaign copy & directional forecast");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Forecast failed");
    } finally {
      setForecastBusy(false);
    }
  };

  const connectMetaAds = async () => {
    try {
      const res = await apiPost<{ redirectUrl: string }>("/api/composio/connect", {
        toolkit: "metaads",
        alias: workspace.name || "Meta Ads",
      });
      setConnectLink(res.redirectUrl);
      notify("Meta Ads OAuth Connect Link generated");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to initialize Meta Ads OAuth");
    }
  };

  const launchCampaign = async () => {
    setSubmitting(true);
    try {
      if (submitToMetaLive && metaConnected) {
        const objectiveMap: Record<string, string> = {
          "App installs": "OUTCOME_APP_PROMOTION",
          "Website conversions": "OUTCOME_SALES",
          "Brand awareness": "OUTCOME_AWARENESS",
          "Video views": "OUTCOME_ENGAGEMENT",
        };
        const liveRes = await apiPost<{ campaignId: string }>("/api/ads/meta/campaigns", {
          adAccountId: selectedAdAccount || undefined,
          name: `${workspace.name || "Campaign"} · ${objective}`,
          objective: objectiveMap[objective] || "OUTCOME_TRAFFIC",
          dailyBudgetUsd: Math.max(5, Math.round(budgetUsd / 14)),
          confirmed: true,
          budgetAuthorized: true,
          idempotencyKey: `meta_camp_${workspace.id}_${Date.now()}`,
        });
        await loadMetaState();
        onCreateCampaign({
          id: liveRes.campaignId || `ad-${Date.now()}`,
          name: `${workspace.name || "Campaign"} · ${objective}`,
          objective,
          audience: audienceLoc || "Global",
          budgetUsd,
          creativeTitle: workspace.name || "Primary Creative",
          primaryText: primaryText.trim(),
          status: "Live Meta Ready",
          estimatedResults: forecast?.estimatedResultsRange || "Created PAUSED on Meta",
          estimatedCpa: forecast?.estimatedCpaRange || "—",
          estimatedReach: forecast?.estimatedReachRange || "—",
          sourceType: "live_api",
        });
        notify(`Created PAUSED Meta Ads campaign (${liveRes.campaignId})`);
      } else {
        onCreateCampaign({
          id: `ad-${Date.now()}`,
          name: `${workspace.name || "Campaign"} · ${objective}`,
          objective,
          audience: audienceLoc || "Global",
          budgetUsd,
          creativeTitle: workspace.name || "Primary Creative",
          primaryText: primaryText.trim(),
          status: "Authorized",
          estimatedResults: forecast?.estimatedResultsRange || "Pending AI forecast",
          estimatedCpa: forecast?.estimatedCpaRange || "Pending AI forecast",
          estimatedReach: forecast?.estimatedReachRange || "Pending AI forecast",
          sourceType: "ai_simulation",
        });
        notify("Campaign plan saved with explicit spend cap");
      }
      setConfirmOpen(false);
      setStep(0);
      setAuthorized(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Campaign creation failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Paid growth"
        title="Ads Manager"
        copy="Build evidence-led Meta campaigns with explicit budget authorization and live PAUSED campaign submission."
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`badge ${metaConnected ? "mint" : "draft"}`}>
              <i />
              {metaConnected ? `Meta Ads Connected (${metaAccounts.length})` : "Meta Ads: Setup Required"}
            </span>
            <ModelSelector
              label="Copy AI"
              value={models.textModel}
              options={modelCatalog.text}
              onChange={onSelectTextModel}
              compact
            />
          </div>
        }
      />

      {!metaConnected && (
        <div
          className="card"
          style={{
            padding: 14,
            marginBottom: 14,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <b>Live Meta Ads Account: Awaiting Credentials</b>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              Connect your Meta Ads account via Composio OAuth to load live campaigns and submit PAUSED campaigns.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {connectLink ? (
              <>
                <a className="btn primary" href={connectLink} target="_blank" rel="noopener noreferrer">
                  Authorize Meta Ads ↗
                </a>
                <button className="btn secondary" onClick={() => void loadMetaState()}>
                  Refresh Status
                </button>
              </>
            ) : (
              <button className="btn secondary" onClick={() => void connectMetaAds()}>
                Connect Meta Ads (Composio)
              </button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={
          submitToMetaLive && metaConnected
            ? `Create PAUSED Meta Campaign ($${budgetUsd} cap)?`
            : `Confirm $${budgetUsd} Campaign Plan Authorization`
        }
        description={
          submitToMetaLive && metaConnected
            ? "Creates a real campaign in your Meta Ad Account in PAUSED status so zero ad spend occurs until you manually activate it."
            : "Saves this authorized campaign plan inside your workspace. Connect Meta Ads to push live."
        }
        confirmLabel={submitting ? "Submitting…" : "Confirm Authorization"}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void launchCampaign()}
      />

      <div className="ads-layout">
        <section className="card campaign-wizard">
          <div className="wizard-steps">
            {labels.map((x, i) => (
              <span
                className={i === step ? "active" : i < step ? "done" : ""}
                key={x}
                onClick={() => setStep(i)}
                style={{ cursor: "pointer" }}
              >
                <i>{i < step ? "✓" : i + 1}</i>
                <b>{x}</b>
              </span>
            ))}
          </div>

          {step === 0 && (
            <div className="wizard-body">
              <h2>What should this campaign achieve?</h2>
              <div className="objective-grid">
                {["App installs", "Website conversions", "Brand awareness", "Video views"].map(
                  (x) => (
                    <button
                      className={objective === x ? "selected" : ""}
                      key={x}
                      onClick={() => setObjective(x)}
                    >
                      <b>{x}</b>
                      <p>Optimize Meta delivery toward {x.toLowerCase()}.</p>
                    </button>
                  ),
                )}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-body">
              <h2>Define your test audience.</h2>
              <div className="form-grid">
                <label className="wide">
                  <span>Locations</span>
                  <input
                    placeholder="e.g., United States, United Kingdom, Canada"
                    value={audienceLoc}
                    onChange={(e) => setAudienceLoc(e.target.value)}
                  />
                </label>
                <label className="wide">
                  <span>Interests & Behaviors</span>
                  <textarea
                    placeholder="Describe target customer interests, job roles, or buying behaviors…"
                    value={audienceInterests}
                    onChange={(e) => setAudienceInterests(e.target.value)}
                  />
                </label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-body">
              <h2>Set a hard campaign limit.</h2>
              <div className="budget-box">
                <span>$</span>
                <input
                  type="number"
                  min={50}
                  value={budgetUsd}
                  onChange={(e) => setBudgetUsd(Math.max(50, Number(e.target.value) || 50))}
                />
                <small>Total campaign budget</small>
              </div>
              <div className="allocation">
                <div>
                  <span>Creative testing (30%)</span>
                  <b>${Math.round(budgetUsd * 0.3)}</b>
                </div>
                <div>
                  <span>Winner scaling (60%)</span>
                  <b>${Math.round(budgetUsd * 0.6)}</b>
                </div>
                <div>
                  <span>Retargeting (10%)</span>
                  <b>${Math.round(budgetUsd * 0.1)}</b>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizard-body">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h2>Ad copy & creative</h2>
                <button
                  className="btn secondary"
                  disabled={forecastBusy}
                  onClick={() => void generateAiForecast()}
                >
                  {forecastBusy ? "Generating copy…" : "✦ AI Write Copy & Forecast"}
                </button>
              </div>
              <label className="ad-copy">
                <span>Primary text</span>
                <textarea
                  placeholder="Write primary Meta ad text or click AI Write Copy & Forecast above…"
                  value={primaryText}
                  onChange={(e) => setPrimaryText(e.target.value)}
                />
              </label>
            </div>
          )}

          {step === 4 && (
            <div className="wizard-body review-campaign">
              <span className="badge review">
                <i />
                Spend authorization required
              </span>
              <h2>Review before authorization</h2>
              {[
                ["Objective", objective],
                ["Audience", audienceLoc || "Not specified"],
                ["Total spend limit", `$${budgetUsd}.00 USD`],
                ["Primary copy", primaryText ? `${primaryText.slice(0, 72)}…` : "Not added yet"],
              ].map((x) => (
                <div key={x[0]}>
                  <span>{x[0]}</span>
                  <b>{x[1]}</b>
                </div>
              ))}
              {metaConnected && (
                <label className="authorization" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={submitToMetaLive}
                    onChange={(e) => setSubmitToMetaLive(e.target.checked)}
                  />{" "}
                  Create real campaign in Meta Ad Account ({selectedAdAccount}) in PAUSED status
                </label>
              )}
              <label className="authorization">
                <input
                  type="checkbox"
                  checked={authorized}
                  onChange={(e) => setAuthorized(e.target.checked)}
                />{" "}
                I explicitly authorize this campaign configuration with a hard maximum budget of $
                {budgetUsd}.
              </label>
            </div>
          )}

          <div className="wizard-actions">
            <button
              className="btn ghost"
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </button>
            <div className="spacer" />
            {step < 4 ? (
              <button className="btn primary" onClick={() => setStep((s) => s + 1)}>
                Continue →
              </button>
            ) : (
              <button
                className="btn primary"
                disabled={!authorized || !primaryText.trim()}
                onClick={() => setConfirmOpen(true)}
              >
                Authorize campaign
              </button>
            )}
          </div>
        </section>

        <aside className="card forecast">
          <span className="badge blue">
            <i />
            {forecast ? "AI directional forecast" : "Forecast pending"}
          </span>
          <h3>Campaign forecast</h3>
          {forecast ? (
            <>
              <strong>{forecast.estimatedResultsRange}</strong>
              <span>estimated outcomes</span>
              <div>
                <small>Estimated CPA</small>
                <b>{forecast.estimatedCpaRange}</b>
              </div>
              <div>
                <small>Estimated reach</small>
                <b>{forecast.estimatedReachRange}</b>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
              Run “AI Write Copy &amp; Forecast” in step 4 to estimate directional CPA and reach
              for your budget.
            </p>
          )}
          {liveCampaigns.length > 0 && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <small style={{ color: "var(--mint)" }}>Live Meta Campaigns ({liveCampaigns.length})</small>
              {liveCampaigns.slice(0, 4).map((c) => (
                <div key={c.id} style={{ fontSize: 12, marginTop: 6, display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <span>
                    <b>{c.name}</b> · {c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
          {adCampaigns.length > 0 && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <small style={{ color: "var(--mint)" }}>Workspace Campaigns ({adCampaigns.length})</small>
              {adCampaigns.slice(0, 3).map((c) => (
                <div key={c.id} style={{ fontSize: 12, marginTop: 4 }}>
                  <b>{c.objective}</b> · ${c.budgetUsd} ({c.status})
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

export function AnalyticsView({
  workspace,
  posts,
  projects,
  competitors,
  seoKeywords,
  adCampaigns,
  models,
  modelCatalog,
  onSelectTextModel,
  onConsumeCredits,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  posts: CalendarPost[];
  projects: ContentProject[];
  competitors: CompetitorItem[];
  seoKeywords: SeoKeywordItem[];
  adCampaigns: AdCampaignItem[];
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  onSelectTextModel: (id: string) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [headline, setHeadline] = useState("");
  const [insight, setInsight] = useState("");
  const [recommendations, setRecommendations] = useState<
    Array<{ title: string; rationale: string; nextAction: string; targetPage: Page }>
  >([]);
  const [loading, setLoading] = useState(false);

  const [gscData, setGscData] = useState<SearchConsoleResponse | null>(null);
  const [gscLoading, setGscLoading] = useState(false);
  const [gscView, setGscView] = useState<"pages" | "queries">("pages");
  const [selectedSite, setSelectedSite] = useState(workspace.websiteUrl || "");
  const [gscConnectUrl, setGscConnectUrl] = useState("");

  const [seoReports, setSeoReports] = useState<WeeklySeoReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [runningWeeklyAudit, setRunningWeeklyAudit] = useState(false);

  const loadGsc = useCallback(async (site?: string) => {
    setGscLoading(true);
    try {
      const target = site ?? selectedSite ?? workspace.websiteUrl ?? "";
      const res = await apiGet<SearchConsoleResponse>(
        `/api/seo/search-console${target ? `?siteUrl=${encodeURIComponent(target)}` : ""}`,
      );
      setGscData(res);
      if (res.activeSite) setSelectedSite(res.activeSite);
    } catch {
      // Keep non-blocking
    } finally {
      setGscLoading(false);
    }
  }, [selectedSite, workspace.websiteUrl]);

  const loadSeoReports = useCallback(async () => {
    try {
      const res = await apiGet<{ reports: WeeklySeoReport[] }>("/api/seo/reports");
      const list = res.reports || [];
      setSeoReports(list);
      if (list.length > 0 && !selectedReportId) {
        setSelectedReportId(list[0].id);
      }
    } catch {
      // ignore offline
    }
  }, [selectedReportId]);

  useEffect(() => {
    void loadGsc(workspace.websiteUrl || "");
    void loadSeoReports();
  }, [workspace.id]);

  const activeReport = seoReports.find((r) => r.id === selectedReportId) || seoReports[0] || null;

  const connectGscComposio = async () => {
    try {
      const res = await apiPost<{ redirectUrl: string }>("/api/composio/connect", {
        toolkit: "google_search_console",
      });
      setGscConnectUrl(res.redirectUrl);
      notify("Google Search Console OAuth consent link ready");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to initiate Search Console OAuth");
    }
  };

  const triggerWeeklySeoReport = async () => {
    const url = selectedSite || workspace.websiteUrl;
    if (!url) {
      notify("Set a website URL in Settings or Notebook to run a technical SEO audit.");
      return;
    }
    setRunningWeeklyAudit(true);
    try {
      const res = await apiPost<{ report?: WeeklySeoReport }>("/api/seo/weekly-audit/run", {
        websiteUrl: url,
        business: workspace,
        triggeredBy: "seo_agent",
        model: models.textModel,
      });
      await loadSeoReports();
      if (res.report?.id) setSelectedReportId(res.report.id);
      onConsumeCredits(65, "Weekly Technical SEO Audit");
      notify("Weekly Technical SEO report generated & saved");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Technical SEO audit failed");
    } finally {
      setRunningWeeklyAudit(false);
    }
  };

  const publishedCount = posts.filter((p) => p.status === "Published").length;
  const readyCount = posts.filter((p) => p.status === "Ready").length;
  const reviewCount = posts.filter((p) => p.status === "Needs review").length;

  const artifactBreakdown = [
    { name: "Competitors", count: competitors.length },
    { name: "Keywords", count: seoKeywords.length },
    { name: "Projects", count: projects.length },
    { name: "Calendar", count: posts.length },
    { name: "Ad Campaigns", count: adCampaigns.length },
  ];

  const queueDistribution = [
    { status: "Needs Review", count: reviewCount },
    { status: "Ready", count: readyCount },
    { status: "Scheduled", count: posts.filter((p) => p.status === "Scheduled").length },
    { status: "Published", count: publishedCount },
  ];

  const refreshInsights = async () => {
    setLoading(true);
    try {
      const res = await apiPost<{
        headline: string;
        insight: string;
        recommendations: Array<{
          title: string;
          rationale: string;
          nextAction: string;
          targetPage: Page;
        }>;
      }>("/api/analytics/insights", {
        business: workspace,
        metricsSummary: `Projects: ${projects.length}, Competitors: ${competitors.length}, Keywords: ${seoKeywords.length}, Scheduled posts: ${posts.length}, Published posts: ${publishedCount}, Ad campaigns: ${adCampaigns.length}. Channels: ${workspace.channels.join(", ")}`,
        model: models.textModel,
      });
      if (res.headline) setHeadline(res.headline);
      if (res.insight) setInsight(res.insight);
      if (res.recommendations?.length) setRecommendations(res.recommendations);
      onConsumeCredits(35, `Growth Intelligence (${models.textModel})`);
      notify("Growth Intelligence refreshed with Gemini");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to refresh Growth Intelligence");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Unified performance"
        title="Growth Analytics & Intelligence"
        copy="Real workspace outputs, queue telemetry, and Gemini-powered growth recommendations."
        actions={
          <>
            <ModelSelector
              label="Analyst"
              value={models.textModel}
              options={modelCatalog.text}
              onChange={onSelectTextModel}
              compact
            />
            <button className="btn primary" disabled={loading} onClick={() => void refreshInsights()}>
              {loading ? "Analyzing…" : "✦ Refresh Growth Intelligence"}
            </button>
          </>
        }
      />

      <div className="analytics-top">
        {[
          ["Content projects", String(projects.length), "Pipeline"],
          ["Scheduled posts", String(posts.length), "Calendar"],
          ["Published posts", String(publishedCount), "Completed"],
          ["Tracked keywords", String(seoKeywords.length), "SEO & ASO"],
          ["Ad campaigns", String(adCampaigns.length), "Meta Ads"],
        ].map((x) => (
          <div key={x[0]}>
            <span>{x[0]}</span>
            <strong>{x[1]}</strong>
            <small>{x[2]}</small>
          </div>
        ))}
      </div>

      <div className="analytics-grid">
        <section className="card main-chart">
          <CardTitle
            title="Workspace output distribution"
            copy="Tracked research, creative, and distribution artifacts"
          />
          <div style={{ width: "100%", height: 240, marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={artifactBreakdown}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="name" stroke="#8c9894" fontSize={11} />
                <YAxis stroke="#8c9894" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface2)",
                    border: "1px solid var(--border2)",
                    borderRadius: 8,
                  }}
                />
                <Bar dataKey="count" fill="#72e6bd" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card channel-chart">
          <CardTitle title="Publishing pipeline status" copy="Posts across review & live states" />
          <div style={{ width: "100%", height: 210, marginTop: 10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={queueDistribution}>
                <XAxis dataKey="status" stroke="#8c9894" fontSize={11} />
                <YAxis stroke="#8c9894" fontSize={11} allowDecimals={false} />
                <Bar dataKey="count" fill="#9a8cff" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card intelligence-card" style={{ gridColumn: "1 / -1" }}>
          <span className="badge mint">
            <i />
            Growth Intelligence
          </span>
          {headline ? (
            <>
              <h2 style={{ marginTop: 8 }}>{headline}</h2>
              <p>{insight}</p>
            </>
          ) : (
            <p style={{ marginTop: 10 }}>
              Click “Refresh Growth Intelligence” above to synthesize next-step priorities based on
              your real workspace assets, SEO keywords, competitors, and campaign queue.
            </p>
          )}
          {recommendations.length > 0 && (
            <div className="mos-stack" style={{ margin: "12px 0" }}>
              {recommendations.map((rec) => (
                <div
                  key={rec.title}
                  className="mos-subcard"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <b>{rec.title}</b>
                    <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      {rec.rationale}
                    </p>
                  </div>
                  <button
                    className="btn secondary"
                    onClick={() => go(rec.targetPage || "Content Studio")}
                  >
                    {rec.nextAction} →
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            className="btn primary"
            style={{ marginTop: 8 }}
            onClick={() => go("Content Studio")}
          >
            Launch next growth experiment →
          </button>
        </section>

        <section className="card" style={{ gridColumn: "1 / -1", padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <CardTitle
                title="Google Search Console · Live Organic Performance"
                copy={
                  gscData?.connected
                    ? `${gscData.activeSite || "Verified property"} · ${gscData.reportingPeriod ? `${gscData.reportingPeriod.startDate} → ${gscData.reportingPeriod.endDate}` : "Last 28 days"}${gscData.lastSyncedAt ? ` · Synced ${new Date(gscData.lastSyncedAt).toLocaleTimeString()}` : ""}`
                    : "Real-time Search Console clicks, impressions, CTR, and average position via Composio"
                }
              />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {gscData?.sites && gscData.sites.length > 0 && (
                <select
                  className="filter"
                  value={selectedSite}
                  onChange={(e) => {
                    setSelectedSite(e.target.value);
                    void loadGsc(e.target.value);
                  }}
                >
                  {gscData.sites.map((s) => (
                    <option key={s.siteUrl} value={s.siteUrl}>
                      {s.siteUrl}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="btn secondary"
                type="button"
                disabled={gscLoading}
                onClick={() => void loadGsc(selectedSite)}
              >
                {gscLoading ? "Syncing…" : "↻ Sync Search Console"}
              </button>
            </div>
          </div>

          {!gscData?.connected ? (
            <div className="mos-subcard" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <span className="badge review">
                  <i />
                  {gscData?.status || "Setup Required"}
                </span>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                  {gscData?.message ||
                    gscData?.error ||
                    "Connect Google Search Console via Composio OAuth to display real-time top-performing pages, clicks, impressions, CTR, and average position."}
                </p>
                {gscConnectUrl && (
                  <p style={{ fontSize: 12, marginTop: 6 }}>
                    <a href={gscConnectUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--mint)" }}>
                      Authorize Google Search Console OAuth ↗
                    </a>
                  </p>
                )}
              </div>
              <button className="btn primary" type="button" onClick={() => void connectGscComposio()}>
                Connect Search Console
              </button>
            </div>
          ) : (
            <>
              <div className="tabs" style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  className={gscView === "pages" ? "active" : ""}
                  onClick={() => setGscView("pages")}
                >
                  Top-Performing Pages ({gscData.topPages?.length || 0})
                </button>
                <button
                  type="button"
                  className={gscView === "queries" ? "active" : ""}
                  onClick={() => setGscView("queries")}
                >
                  Top Search Queries ({gscData.rows?.length || 0})
                </button>
              </div>
              <div className="gsc-table-wrap">
                <table className="gsc-table">
                  <thead>
                    <tr>
                      <th>{gscView === "pages" ? "Page URL" : "Query"}</th>
                      <th>Clicks</th>
                      <th>Impressions</th>
                      <th>CTR</th>
                      <th>Avg Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(gscView === "pages" ? gscData.topPages : gscData.rows || []).length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 16 }}>
                          No Search Console rows returned for this property in the current 28-day window.
                        </td>
                      </tr>
                    ) : (
                      (gscView === "pages" ? gscData.topPages : gscData.rows || []).map((row, idx) => (
                        <tr key={idx}>
                          <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>
                            <b>{row.keys?.[0] || "—"}</b>
                          </td>
                          <td>{Number(row.clicks ?? 0).toLocaleString()}</td>
                          <td>{Number(row.impressions ?? 0).toLocaleString()}</td>
                          <td>{((Number(row.ctr ?? 0)) * 100).toFixed(1)}%</td>
                          <td>{Number(row.position ?? 0).toFixed(1)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="card" style={{ gridColumn: "1 / -1", padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <CardTitle
              title="Weekly Technical SEO Audit Reports"
              copy="Persistent scheduled weekly crawls & SEO Agent audits pushed automatically to Analytics."
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {seoReports.length > 0 && (
                <select
                  className="filter"
                  value={activeReport?.id || ""}
                  onChange={(e) => setSelectedReportId(e.target.value)}
                >
                  {seoReports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {new Date(r.createdAt).toLocaleDateString()} · Score {r.healthScore}/100 ({r.triggeredBy})
                    </option>
                  ))}
                </select>
              )}
              <button
                className="btn primary"
                type="button"
                disabled={runningWeeklyAudit}
                onClick={() => void triggerWeeklySeoReport()}
              >
                {runningWeeklyAudit ? "Auditing…" : "✦ Run Weekly Audit Now"}
              </button>
            </div>
          </div>

          {!activeReport ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              No weekly technical SEO reports generated yet. Ensure a website URL is saved in your workspace or trigger a manual audit above.
            </p>
          ) : (
            <div className="mos-stack">
              <div className="mos-subcard" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <span className={`badge ${activeReport.healthScore >= 80 ? "mint" : "review"}`}>
                    <i />
                    Score {activeReport.healthScore}/100 · {activeReport.triggeredBy}
                  </span>
                  <h3 style={{ marginTop: 6 }}>{activeReport.headline}</h3>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{activeReport.summary}</p>
                </div>
                <small style={{ color: "var(--muted)" }}>
                  {activeReport.websiteUrl} · {new Date(activeReport.createdAt).toLocaleString()}
                </small>
              </div>
              <div className="mos-stack">
                {(activeReport.technicalChecks || []).map((chk, idx) => (
                  <div className="mos-list-row" key={idx}>
                    <span>
                      <b>{chk.title}</b>
                      <small>{chk.why}</small>
                      {!chk.passed && <small style={{ color: "var(--mint)" }}>Fix: {chk.fix}</small>}
                    </span>
                    <span className={`badge ${chk.passed ? "mint" : chk.severity.toLowerCase()}`}>
                      <i />
                      {chk.passed ? "Passed" : chk.severity}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export function IntegrationsView({
  onOpenWorkspaceHub,
  go,
  notify,
}: {
  onOpenWorkspaceHub: () => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [cat, setCat] = useState("All");
  const [statusData, setStatusData] = useState<
    Record<string, { configured: boolean; activeAccounts?: number }>
  >({});
  const [composio, setComposio] = useState<ComposioConnectionsResponse | null>(null);
  const [growthConnections, setGrowthConnections] = useState<AnalyticsConnectionSummary[]>([]);
  const [recommendations, setRecommendations] = useState<IntegrationRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingConnect, setPendingConnect] = useState<{ label: string; url: string } | null>(null);

  // Analytics & Data Sources modal state
  const [activeProviderModal, setActiveProviderModal] = useState<AnalyticsProviderId | null>(null);
  const [connSaving, setConnSaving] = useState(false);
  const [connError, setConnError] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formHostUrl, setFormHostUrl] = useState("https://us.posthog.com");
  const [formProjectId, setFormProjectId] = useState("");
  const [formProjectUrl, setFormProjectUrl] = useState("");
  const [formServiceAccount, setFormServiceAccount] = useState("");
  const [formPackageName, setFormPackageName] = useState("");
  const [formAuthMode, setFormAuthMode] = useState<"api_key" | "service_account" | "google_oauth" | "composio">("api_key");
  const [tableMapForm, setTableMapForm] = useState<SupabaseTableMappings>({
    usersTable: "users",
    createdAtCol: "created_at",
    verifiedCol: "email_verified",
    eventsTable: "events",
    eventNameCol: "event_name",
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, compRes, growthRes, recRes] = await Promise.all([
        apiGet<{ providers: Record<string, { configured: boolean; activeAccounts?: number }> }>(
          "/api/integrations/status",
        ),
        apiGet<ComposioConnectionsResponse>("/api/composio/connections"),
        apiGet<{ connections: AnalyticsConnectionSummary[] }>("/api/growth/connections").catch(() => ({
          connections: [],
        })),
        apiGet<{ recommendations: IntegrationRecommendation[] }>("/api/growth/recommendations").catch(() => ({
          recommendations: [],
        })),
      ]);
      setStatusData(statusRes.providers || {});
      setComposio(compRes);
      setGrowthConnections(growthRes.connections || []);
      setRecommendations(recRes.recommendations || []);
    } catch {
      // Keep graceful UI
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openAnalyticsConnector = (provider: AnalyticsProviderId) => {
    setConnError("");
    setFormApiKey("");
    setFormServiceAccount("");
    setFormProjectId("");
    setFormProjectUrl("");
    setFormPackageName("");
    if (provider === "posthog") {
      setFormAuthMode("api_key");
      setFormHostUrl("https://us.posthog.com");
    } else if (provider === "supabase") {
      setFormAuthMode("api_key");
    } else if (provider === "firebase" || provider === "ga4" || provider === "google_play") {
      setFormAuthMode("service_account");
    } else if (provider === "gsc") {
      setFormAuthMode("composio");
    } else {
      setFormAuthMode("api_key");
    }
    setActiveProviderModal(provider);
  };

  const saveAnalyticsConnection = async () => {
    if (!activeProviderModal) return;
    setConnError("");
    setConnSaving(true);
    try {
      await apiPost("/api/growth/connections", {
        provider: activeProviderModal,
        authMode: formAuthMode,
        apiKey: formApiKey.trim() || undefined,
        hostUrl: formHostUrl.trim() || undefined,
        projectId: formProjectId.trim() || undefined,
        projectUrl: formProjectUrl.trim() || undefined,
        serviceAccountJson: formServiceAccount.trim() || undefined,
        packageName: formPackageName.trim() || undefined,
        tableMappings: activeProviderModal === "supabase" ? tableMapForm : undefined,
        runSync: true,
      });
      notify(`Connected & synced ${activeProviderModal}`);
      setActiveProviderModal(null);
      await loadAll();
    } catch (err) {
      setConnError(err instanceof Error ? err.message : "Failed to save analytics connection");
    } finally {
      setConnSaving(false);
    }
  };

  const connectToolkit = async (label: string, toolkit: string) => {
    try {
      const res = await apiPost<{ redirectUrl: string }>("/api/composio/connect", {
        toolkit,
      });
      setPendingConnect({ label, url: res.redirectUrl });
      notify(`OAuth Connect Link generated for ${label}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : `Failed to connect ${label}`);
    }
  };

  const tkStatus = (tk: string) => {
    const acc = composio?.statuses?.[tk]?.accounts?.find((a) => a.status === "active");
    return acc
      ? {
          badge: "Connected",
          detail: acc.username ? `@${acc.username.replace(/^@/, "")}` : acc.id,
          connected: true,
          accountId: acc.id,
        }
      : {
          badge: composio?.configured ? "Setup Required" : "Awaiting Credentials",
          detail: "Click Connect to authorize via Composio OAuth",
          connected: false,
          accountId: "",
        };
  };

  const items: Array<{
    name: string;
    category: string;
    status: string;
    connected: boolean;
    detail: string;
    toolkit?: string;
    accountId?: string;
    actionType: "composio" | "workspace" | "settings" | "social";
  }> = [
    {
      name: "Gemini AI Suite",
      category: "AI models",
      status: statusData.gemini?.configured ? "Connected" : "Awaiting Credentials",
      connected: Boolean(statusData.gemini?.configured),
      detail: "Gemini 4, Nano Banana, Omni Video, Lyria & Live Voice",
      actionType: "settings",
    },
    {
      name: "Google Workspace",
      category: "Productivity",
      status: statusData.googleWorkspace?.configured ? "OAuth Ready" : "Setup Required",
      connected: Boolean(statusData.googleWorkspace?.configured),
      detail: "Drive, Docs, Sheets, Calendar, Gmail, Tasks & Chat",
      actionType: "workspace",
    },
    ...(
      [
        ["Instagram", "Social platforms", "instagram"],
        ["Facebook", "Social platforms", "facebook"],
        ["TikTok", "Social platforms", "tiktok"],
        ["YouTube", "Social platforms", "youtube"],
        ["LinkedIn", "Social platforms", "linkedin"],
        ["X (Twitter)", "Social platforms", "twitter"],
        ["Meta Ads", "Advertising", "metaads"],
        ["Google Search Console", "SEO tools", "google_search_console"],
      ] as const
    ).map(([name, category, toolkit]) => {
      const st = tkStatus(toolkit);
      return {
        name,
        category,
        status: st.badge,
        connected: st.connected,
        detail: st.detail,
        toolkit,
        accountId: st.accountId,
        actionType: "composio" as const,
      };
    }),
  ];

  const cats = ["All", "AI models", "Productivity", "Social platforms", "Advertising", "SEO tools"];
  const activeCount = composio?.accounts?.filter((a) => a.status === "active").length || 0;

  const analyticsCatalog: Array<{
    provider: AnalyticsProviderId;
    title: string;
    subtitle: string;
  }> = [
    { provider: "posthog", title: "PostHog Analytics", subtitle: "Events, WAU, signups & retention" },
    { provider: "supabase", title: "Direct Supabase", subtitle: "Users table, signups & custom schema" },
    { provider: "firebase", title: "Direct Firebase", subtitle: "Firebase Auth verified users & activity" },
    { provider: "ga4", title: "Google Analytics 4", subtitle: "Sessions, activeUsers, keyEvents & channels" },
    { provider: "google_play", title: "Google Play Console", subtitle: "Android app store installs & ratings" },
    { provider: "gsc", title: "Search Console Telemetry", subtitle: "Sync organic clicks & pages to Growth Hub" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Connected ecosystem · Composio & Direct Analytics"
        title="Integrations"
        copy="AI models, Google Workspace, Composio OAuth connectors, and encrypted Growth Intelligence telemetry sources."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn secondary" onClick={() => void loadAll()} disabled={loading}>
              {loading ? "Refreshing…" : "↻ Sync Hub"}
            </button>
            <button className="btn primary" onClick={() => go("Growth Intelligence")}>
              Open Growth Intelligence →
            </button>
          </div>
        }
      />

      {/* Analytics & Growth Data Sources */}
      <section className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <CardTitle
            title="Analytics & Product Telemetry Sources"
            copy="All API keys & Service Account JSON are encrypted server-side (AES-256-GCM) and never exposed to browsers"
          />
          <button type="button" className="btn secondary" onClick={() => go("Growth Intelligence")}>
            Inspect Metrics & Audit SDKs →
          </button>
        </div>

        {recommendations.length > 0 && (
          <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {recommendations.slice(0, 4).map((rec) => (
              <button
                key={rec.provider}
                type="button"
                className="btn ghost"
                style={{ height: 30, fontSize: 11, borderColor: rec.connected ? "var(--mint)" : "var(--border)" }}
                onClick={() => openAnalyticsConnector(rec.provider)}
              >
                {rec.connected ? "✓ " : `+ Recommended (${rec.priority}): `}
                {rec.providerLabel}
              </button>
            ))}
          </div>
        )}

        <div className="integration-grid">
          {analyticsCatalog.map((item, idx) => {
            const conn = growthConnections.find((c) => c.provider === item.provider);
            const isConnected = conn?.status === "connected";
            return (
              <article className="card integration" key={item.provider}>
                <div className={`integration-logo il${idx % 8}`}>{item.title.slice(0, 2)}</div>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.subtitle}</p>
                </div>
                <span className={`badge ${isConnected ? "mint" : conn?.status === "error" ? "high" : "review"}`}>
                  <i />
                  {conn ? conn.completenessStatus.replace(/_/g, " ") : "Not connected"}
                </span>
                <p style={{ fontSize: 11 }}>
                  {conn
                    ? `${conn.selectedProjectName || conn.hostUrl || "Configured"} · Key ${conn.maskedKeyHint || "stored"}`
                    : "Click Connect to configure server-side credentials."}
                </p>
                {conn?.discoveredProjects && conn.discoveredProjects.length > 1 && (
                  <select
                    className="filter"
                    style={{ marginBottom: 8 }}
                    value={conn.selectedProjectId || ""}
                    onChange={async (e) => {
                      const nextId = e.target.value;
                      const found = conn.discoveredProjects?.find((p) => p.id === nextId);
                      await apiPatch(`/api/growth/connections/${conn.id}/config`, {
                        selectedProjectId: nextId,
                        selectedProjectName: found?.name || nextId,
                        resync: true,
                      });
                      notify(`Switched ${item.title} project to ${found?.name || nextId}`);
                      await loadAll();
                    }}
                  >
                    {conn.discoveredProjects.map((proj) => (
                      <option key={proj.id} value={proj.id}>
                        {proj.name} ({proj.id})
                      </option>
                    ))}
                  </select>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={`btn ${isConnected ? "secondary" : "primary"}`}
                    onClick={() => openAnalyticsConnector(item.provider)}
                  >
                    {isConnected ? "Reconfigure" : "Connect"}
                  </button>
                  {conn && (
                    <>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={async () => {
                          await apiPost(`/api/growth/connections/${conn.id}/test`, {});
                          notify(`Tested & synced ${item.title}`);
                          await loadAll();
                        }}
                      >
                        Test / Sync
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ color: "#ff9c9c" }}
                        onClick={async () => {
                          await apiDelete(`/api/growth/connections/${conn.id}`);
                          notify(`Revoked ${item.title}`);
                          await loadAll();
                        }}
                      >
                        Disconnect
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {activeProviderModal && (
        <div className="modal-backdrop" onMouseDown={() => setActiveProviderModal(null)}>
          <div
            className="card"
            style={{ width: 520, maxWidth: "92vw", padding: 20 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3>Connect {activeProviderModal.toUpperCase()}</h3>
              <button className="btn ghost" onClick={() => setActiveProviderModal(null)}>
                ✕
              </button>
            </div>
            {connError && <div className="mos-error-box" style={{ marginTop: 10 }}>{connError}</div>}
            <div className="form-grid" style={{ marginTop: 12 }}>
              {activeProviderModal === "posthog" && (
                <>
                  <label className="wide">
                    <span>PostHog Personal API Key (stored encrypted server-side)</span>
                    <input
                      type="password"
                      placeholder="phx_..."
                      value={formApiKey}
                      onChange={(e) => setFormApiKey(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>PostHog Host URL</span>
                    <input
                      placeholder="https://us.posthog.com"
                      value={formHostUrl}
                      onChange={(e) => setFormHostUrl(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Project ID (optional auto-detect)</span>
                    <input
                      placeholder="Auto-discovers if blank"
                      value={formProjectId}
                      onChange={(e) => setFormProjectId(e.target.value)}
                    />
                  </label>
                </>
              )}

              {activeProviderModal === "supabase" && (
                <>
                  <label className="wide">
                    <span>Supabase Project URL</span>
                    <input
                      placeholder="https://your-ref.supabase.co"
                      value={formProjectUrl}
                      onChange={(e) => setFormProjectUrl(e.target.value)}
                    />
                  </label>
                  <label className="wide">
                    <span>Supabase Service Role or Read API Key</span>
                    <input
                      type="password"
                      placeholder="eyJ..."
                      value={formApiKey}
                      onChange={(e) => setFormApiKey(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Users Table Name</span>
                    <input
                      value={tableMapForm.usersTable || ""}
                      onChange={(e) => setTableMapForm((p) => ({ ...p, usersTable: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Created Timestamp Column</span>
                    <input
                      value={tableMapForm.createdAtCol || ""}
                      onChange={(e) => setTableMapForm((p) => ({ ...p, createdAtCol: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Verified / Confirmed Column</span>
                    <input
                      value={tableMapForm.verifiedCol || ""}
                      onChange={(e) => setTableMapForm((p) => ({ ...p, verifiedCol: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Events Table Name (optional)</span>
                    <input
                      value={tableMapForm.eventsTable || ""}
                      onChange={(e) => setTableMapForm((p) => ({ ...p, eventsTable: e.target.value }))}
                    />
                  </label>
                </>
              )}

              {(activeProviderModal === "firebase" ||
                activeProviderModal === "ga4" ||
                activeProviderModal === "google_play") && (
                <>
                  {activeProviderModal === "google_play" ? (
                    <label className="wide">
                      <span>Android Package Name</span>
                      <input
                        placeholder="com.company.app"
                        value={formPackageName}
                        onChange={(e) => setFormPackageName(e.target.value)}
                      />
                    </label>
                  ) : (
                    <label className="wide">
                      <span>
                        {activeProviderModal === "ga4" ? "GA4 Numeric Property ID" : "Firebase Project ID"}
                      </span>
                      <input
                        placeholder={activeProviderModal === "ga4" ? "e.g. 421983712" : "my-firebase-project"}
                        value={formProjectId}
                        onChange={(e) => setFormProjectId(e.target.value)}
                      />
                    </label>
                  )}
                  <label className="wide">
                    <span>Google Service Account JSON (encrypted server-side)</span>
                    <textarea
                      rows={5}
                      placeholder='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
                      value={formServiceAccount}
                      onChange={(e) => setFormServiceAccount(e.target.value)}
                    />
                  </label>
                </>
              )}

              {activeProviderModal === "gsc" && (
                <div className="wide mos-subcard" style={{ fontSize: 12 }}>
                  Google Search Console uses your active Composio OAuth connection. Click Save &amp; Sync to index Search Console clicks, impressions, and top pages directly into Growth Intelligence.
                </div>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setActiveProviderModal(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={connSaving}
                onClick={() => void saveAnalyticsConnection()}
              >
                {connSaving ? "Encrypting & Syncing…" : "Save, Encrypt & Sync"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="card"
        style={{
          padding: 14,
          marginBottom: 14,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span className={`badge ${composio?.configured ? "mint" : "review"}`}>
            <i />
            {composio?.configured
              ? `Composio Connect Active · ${activeCount} connected account(s)`
              : "Composio Awaiting Credentials"}
          </span>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            Central MCP Integration Layer ({composio?.mode || "unconfigured"}). Tokens stay strictly server-side.
          </p>
        </div>
        <button className="btn secondary" onClick={() => go("Social Accounts")}>
          Open 6-Platform Matrix →
        </button>
      </div>

      {pendingConnect && (
        <div
          className="card"
          style={{
            padding: 14,
            marginBottom: 14,
            borderColor: "var(--mint)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <b>Authorize {pendingConnect.label}</b>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              Complete OAuth consent in the new tab, then click Refresh.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a
              className="btn primary"
              href={pendingConnect.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open OAuth Connect ↗
            </a>
            <button className="btn secondary" onClick={() => void loadAll()}>
              Refresh
            </button>
            <button className="btn ghost" onClick={() => setPendingConnect(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      <div className="category-tabs">
        {cats.map((x) => (
          <button className={cat === x ? "active" : ""} onClick={() => setCat(x)} key={x}>
            {x}
          </button>
        ))}
      </div>

      <div className="integration-grid">
        {items
          .filter((x) => cat === "All" || x.category === cat)
          .map((x, i) => (
            <article className="card integration" key={x.name}>
              <div className={`integration-logo il${i % 8}`}>{x.name.slice(0, 2)}</div>
              <div>
                <h3>{x.name}</h3>
                <p>{x.category}</p>
              </div>
              <span
                className={`badge ${
                  x.connected ? "mint" : x.status.includes("Setup") ? "review" : "draft"
                }`}
              >
                <i />
                {x.status}
              </span>
              <p>{x.detail}</p>
              <div style={{ display: "flex", gap: 8 }}>
                {x.actionType === "composio" && x.toolkit ? (
                  x.connected && x.accountId ? (
                    <>
                      <button className="btn secondary" onClick={() => go("Social Accounts")}>
                        Manage
                      </button>
                      <button
                        className="btn ghost"
                        onClick={async () => {
                          await apiDelete("/api/composio/accounts", {
                            toolkit: x.toolkit!,
                            accountId: x.accountId!,
                          });
                          notify(`Disconnected ${x.name}`);
                          await loadAll();
                        }}
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn primary"
                      onClick={() => void connectToolkit(x.name, x.toolkit!)}
                    >
                      Connect
                    </button>
                  )
                ) : (
                  <button
                    className="btn secondary"
                    onClick={() => {
                      if (x.actionType === "workspace") onOpenWorkspaceHub();
                      else go("Settings");
                    }}
                  >
                    {x.actionType === "workspace" ? "Open Workspace Hub" : "Configure"}
                  </button>
                )}
              </div>
            </article>
          ))}
      </div>

      {composio?.logs && composio.logs.length > 0 && (
        <section className="card" style={{ padding: 18, marginTop: 18 }}>
          <CardTitle title="Integration Activity Log" copy="Live server-recorded Composio & connector telemetry" />
          <div className="mos-stack" style={{ marginTop: 10 }}>
            {composio.logs.slice(0, 8).map((log) => (
              <div className="mos-list-row" key={log.id}>
                <span>
                  <b>
                    {log.toolkit} · {log.action}
                  </b>
                  <small>{log.detail}</small>
                </span>
                <span className={`badge ${log.status === "success" ? "mint" : "review"}`}>
                  <i />
                  {log.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function AutomationsView({
  workspace,
  projects = [],
  runs,
  workflows = [],
  workflowExecutions = [],
  models,
  onUpdateWorkflows,
  onUpdateExecutions,
  onAddRun,
  onSyncProject,
  onUpsertProject,
  onPatchProject,
  onRefreshPipeline,
  onOpenProject,
  onAddProject,
  onConsumeCredits,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  projects?: ContentProject[];
  runs: AutomationRunLog[];
  workflows?: AutomationWorkflow[];
  workflowExecutions?: AutomationExecutionLog[];
  models: ModelPreferences;
  onUpdateWorkflows?: (wfs: AutomationWorkflow[] | ((prev: AutomationWorkflow[]) => AutomationWorkflow[])) => void;
  onUpdateExecutions?: (logs: AutomationExecutionLog[] | ((prev: AutomationExecutionLog[]) => AutomationExecutionLog[])) => void;
  onAddRun: (run: AutomationRunLog) => void;
  onSyncProject?: (p: ContentProject) => void;
  onUpsertProject?: (p: Partial<ContentProject> & { title: string }) => Promise<ContentProject>;
  onPatchProject?: (id: string, patch: Partial<ContentProject>) => Promise<ContentProject>;
  onRefreshPipeline?: () => Promise<void>;
  onOpenProject?: (
    p: ContentProject,
    dest?: "auto" | "brief" | "scripts" | "storyboard" | "video" | "avatar" | "queue",
  ) => void;
  onAddProject: (p: ContentProject) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  go?: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(() => workflows[0]?.id || "");
  const [nlPrompt, setNlPrompt] = useState("");
  const [generatingNl, setGeneratingNl] = useState(false);
  const [runningTest, setRunningTest] = useState(false);
  const [savingWf, setSavingWf] = useState(false);
  const [confirmActivation, setConfirmActivation] = useState(false);
  const [approvingProjId, setApprovingProjId] = useState("");

  const [draftName, setDraftName] = useState("Weekly Content Engine");
  const [draftTrigger, setDraftTrigger] = useState<"manual" | "interval" | "event">("interval");
  const [draftIntervalMin, setDraftIntervalMin] = useState(1440);
  const [draftMinQa, setDraftMinQa] = useState(80);
  const [draftRetry, setDraftRetry] = useState(2);
  const [draftRequireApproval, setDraftRequireApproval] = useState(true);
  const [draftNodes, setDraftNodes] = useState<WorkflowNode[]>([
    { id: "n1", type: "trigger", label: "Schedule / Manual Trigger", config: {} },
    { id: "n2", type: "condition", label: "QA Score >= 80", config: { minQaScore: 80 } },
    { id: "n3", type: "action", label: "Prepare Content & SEO Sweep", config: { actionType: "content" } },
    { id: "n4", type: "approval_gate", label: "Human Approval Before Publish", config: {} },
  ]);

  const activeWorkflow = workflows.find((w) => w.id === selectedId) || null;

  useEffect(() => {
    if (!selectedId && workflows.length > 0) {
      setSelectedId(workflows[0].id);
    }
  }, [workflows, selectedId]);

  useEffect(() => {
    if (activeWorkflow) {
      setDraftName(activeWorkflow.name);
      setDraftTrigger(activeWorkflow.triggerType);
      setDraftIntervalMin(activeWorkflow.intervalMinutes || 1440);
      setDraftMinQa(activeWorkflow.conditionMinQaScore ?? 80);
      setDraftRetry(activeWorkflow.retryLimit || 2);
      setDraftRequireApproval(activeWorkflow.requireHumanApproval);
      setDraftNodes(activeWorkflow.nodes || []);
      setConfirmActivation(activeWorkflow.confirmedToActivate);
    }
  }, [activeWorkflow]);

  const generateFromNl = async () => {
    if (!nlPrompt.trim()) return;
    setGeneratingNl(true);
    try {
      const res = await apiPost<{ workflow: AutomationWorkflow }>("/api/workflows/generate-nl", {
        prompt: nlPrompt,
        business: workspace,
        model: models.textModel,
      });
      if (res.workflow) {
        onUpdateWorkflows?.((prev) => [res.workflow, ...prev.filter((x) => x.id !== res.workflow.id)]);
        setSelectedId(res.workflow.id);
        setNlPrompt("");
        notify(`Generated workflow draft "${res.workflow.name}" (disabled until confirmed)`);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to generate workflow from prompt");
    } finally {
      setGeneratingNl(false);
    }
  };

  const saveWorkflow = async (enableRequested?: boolean) => {
    const nextEnabled = enableRequested !== undefined ? enableRequested : Boolean(activeWorkflow?.enabled);
    if (nextEnabled && !confirmActivation) {
      notify("Check the confirmation box below before activating autonomous scheduling.");
      return;
    }
    setSavingWf(true);
    try {
      const payload = {
        id: activeWorkflow?.id,
        name: draftName.trim() || "Custom Workflow",
        description: `${draftTrigger} workflow · QA >= ${draftMinQa}`,
        triggerType: draftTrigger,
        intervalMinutes: draftTrigger === "interval" ? draftIntervalMin : undefined,
        conditionMinQaScore: draftMinQa,
        retryLimit: draftRetry,
        requireHumanApproval: draftRequireApproval,
        enabled: nextEnabled,
        confirmedToActivate: confirmActivation,
        nodes: draftNodes,
      };
      const res = activeWorkflow
        ? await apiPatch<{ workflow: AutomationWorkflow }>(`/api/workflows/${activeWorkflow.id}`, payload)
        : await apiPost<{ workflow: AutomationWorkflow }>("/api/workflows", payload);
      if (res.workflow) {
        onUpdateWorkflows?.((prev) => [res.workflow, ...prev.filter((x) => x.id !== res.workflow.id)]);
        setSelectedId(res.workflow.id);
        notify(`Saved workflow "${res.workflow.name}"`);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save workflow");
    } finally {
      setSavingWf(false);
    }
  };

  const approveLinkedProject = async (
    proj: ContentProject,
    nextDest: "stay" | "storyboard" | "video" | "avatar" = "stay",
  ) => {
    setApprovingProjId(proj.id);
    try {
      let latest = proj;
      if (!latest.scriptApproved) {
        const res = await apiPost<{ project: ContentProject }>(`/api/projects/${latest.id}/approve-script`, {
          script: latest.script || latest.scriptVariants?.[0]?.body || latest.title,
          hook: latest.hook || latest.scriptVariants?.[0]?.hook || "",
          cta: latest.cta || latest.scriptVariants?.[0]?.cta || "",
        });
        if (res.project) {
          latest = res.project;
          if (onPatchProject) await onPatchProject(latest.id, latest);
          else onSyncProject?.(latest);
        }
      }
      if (nextDest === "video" || nextDest === "avatar") {
        if ((latest.storyboardScenes?.length || 0) > 0 && !latest.storyboardApproved) {
          const sbRes = await apiPost<{ project: ContentProject }>(`/api/projects/${latest.id}/approve-storyboard`, {
            scenes: latest.storyboardScenes,
          });
          if (sbRes.project) {
            latest = sbRes.project;
            if (onPatchProject) await onPatchProject(latest.id, latest);
            else onSyncProject?.(latest);
          }
        }
      }
      await onRefreshPipeline?.();
      notify(`Script approved for "${latest.title}"`);
      if (nextDest === "storyboard") {
        if (onOpenProject) onOpenProject(latest, "storyboard");
        else go?.("Content Studio");
      } else if (nextDest === "video") {
        if (onOpenProject) onOpenProject(latest, "video");
        else go?.("Video Editor");
      } else if (nextDest === "avatar") {
        if (onOpenProject) onOpenProject(latest, "avatar");
        else go?.("AI Avatar Studio");
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not approve project script");
    } finally {
      setApprovingProjId("");
    }
  };

  const runSelectedWorkflow = async () => {
    setRunningTest(true);
    try {
      if (activeWorkflow) {
        const res = await apiPost<{ execution: AutomationExecutionLog; workflow: AutomationWorkflow }>(
          `/api/workflows/${activeWorkflow.id}/run`,
          {},
        );
        await onRefreshPipeline?.();
        if (res.execution) {
          onUpdateExecutions?.((prev) => [res.execution, ...prev]);
          onAddRun({
            id: res.execution.id,
            runAt: "Just now",
            status: res.execution.status === "awaiting_approval" ? "Awaiting approval" : "Completed",
            duration: "Server run",
            credits: "Tracked",
            summary: res.execution.summary,
            projectId: res.execution.projectId,
            projectTitle: res.execution.projectTitle,
            projectStatus: res.execution.projectStatus,
          });
        }
        if (res.workflow) {
          onUpdateWorkflows?.((prev) => prev.map((w) => (w.id === res.workflow.id ? res.workflow : w)));
        }
        notify(`Executed "${activeWorkflow.name}": ${res.execution.summary}`);
      } else {
        const res = await apiPost<{
          summary: string;
          trendTopic: string;
          generatedScriptTitle: string;
          generatedHook: string;
          generatedScript: string;
          qualityScore: number;
          durationLabel: string;
          project?: ContentProject;
        }>("/api/automations/run", {
          workflowName: draftName,
          business: workspace,
          model: models.textModel,
        });
        let createdProj = res.project;
        if (!createdProj && onUpsertProject) {
          createdProj = await onUpsertProject({
            title: res.generatedScriptTitle || res.trendTopic || "Automated Draft",
            platform: workspace.channels[0] || "Instagram Reels",
            status: "AWAITING_SCRIPT_APPROVAL",
            owner: "Automation Workflow",
            progress: 45,
            creditsUsed: 180,
            hook: res.generatedHook,
            script: res.generatedScript,
            qaScore: res.qualityScore || 88,
            sourceType: "ai_grounded",
          });
        }
        if (createdProj) {
          if (onSyncProject) onSyncProject(createdProj);
          else onAddProject(createdProj);
        }
        onAddRun({
          id: `run-${Date.now()}`,
          runAt: "Just now",
          status: "Awaiting approval",
          duration: res.durationLabel || "4s",
          credits: "Tracked",
          summary: res.summary,
          projectId: createdProj?.id,
          projectTitle: createdProj?.title,
          projectStatus: createdProj?.status,
        });
        onConsumeCredits(0, "Workflow Run");
        notify(
          createdProj
            ? `Draft "${createdProj.title}" saved — approve script below or open Content Studio`
            : "Workflow executed — new draft queued in Content Pipeline",
        );
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Automation execution failed");
    } finally {
      setRunningTest(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Persistent workflow orchestration"
        title="Automation Workflows"
        copy="Build repeatable, condition-checked marketing automations with explicit activation and human approval gates."
        actions={
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setSelectedId("");
              setDraftName("New Marketing Workflow");
              setConfirmActivation(false);
            }}
          >
            + New Workflow
          </button>
        }
      />

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <b style={{ fontSize: 12 }}>Natural Language Workflow Generator</b>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <input
            style={{ flex: 1, minWidth: 240, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)" }}
            placeholder="e.g., Every Monday morning audit SEO & draft 2 short video projects when QA >= 85, pause before publish…"
            value={nlPrompt}
            onChange={(e) => setNlPrompt(e.target.value)}
          />
          <button type="button" className="btn primary" disabled={generatingNl || !nlPrompt.trim()} onClick={() => void generateFromNl()}>
            {generatingNl ? "Drafting…" : "✦ Draft Workflow from Prompt"}
          </button>
        </div>
      </div>

      {workflows.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {workflows.map((wf) => (
            <div key={wf.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: activeWorkflow?.id === wf.id ? "1px solid var(--mint)" : "1px solid var(--border)", borderRadius: 8, padding: "5px 10px", background: "var(--surface)" }}>
              <button type="button" className="text-button" style={{ fontSize: 12 }} onClick={() => setSelectedId(wf.id)}>
                {wf.name} <small>({wf.enabled ? "Active" : "Paused"})</small>
              </button>
              <button
                type="button"
                className="text-button"
                style={{ fontSize: 11, color: "#ff9c9c" }}
                onClick={() => {
                  void apiDelete(`/api/workflows/${wf.id}`).then(() => {
                    onUpdateWorkflows?.((prev) => prev.filter((x) => x.id !== wf.id));
                    if (selectedId === wf.id) setSelectedId("");
                    notify("Deleted workflow");
                  });
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <section className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div>
            <b>{activeWorkflow ? activeWorkflow.name : "New Workflow Configuration"}</b>
            <small style={{ color: "var(--muted)", display: "block" }}>
              {activeWorkflow?.lastRunAt ? `Last run: ${new Date(activeWorkflow.lastRunAt).toLocaleString()} (${activeWorkflow.lastStatus || ""})` : "Not saved/executed yet"}
            </small>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn secondary" disabled={savingWf} onClick={() => void saveWorkflow(false)}>
              {savingWf ? "Saving…" : "Save Draft"}
            </button>
            <button type="button" className="btn secondary" disabled={savingWf} onClick={() => void saveWorkflow(!activeWorkflow?.enabled)}>
              {activeWorkflow?.enabled ? "Pause Automation" : "Activate Schedule"}
            </button>
            <button type="button" className="btn primary" disabled={runningTest} onClick={() => void runSelectedWorkflow()}>
              {runningTest ? "Running…" : "▶ Run Workflow Now"}
            </button>
          </div>
        </div>

        <div className="form-grid" style={{ marginTop: 12 }}>
          <label>
            <span>Workflow Name</span>
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
          </label>
          <label>
            <span>Trigger Mode</span>
            <select value={draftTrigger} onChange={(e) => setDraftTrigger(e.target.value as typeof draftTrigger)}>
              <option value="manual">Manual Trigger</option>
              <option value="interval">Interval Schedule (Backend Cron)</option>
              <option value="event">Event Hook</option>
            </select>
          </label>
          {draftTrigger === "interval" && (
            <label>
              <span>Interval (Minutes)</span>
              <input type="number" min={5} value={draftIntervalMin} onChange={(e) => setDraftIntervalMin(Number(e.target.value))} />
            </label>
          )}
          <label>
            <span>Condition: Min QA Score</span>
            <input type="number" min={0} max={100} value={draftMinQa} onChange={(e) => setDraftMinQa(Number(e.target.value))} />
          </label>
          <label>
            <span>Retry Limit (max 3)</span>
            <input type="number" min={1} max={3} value={draftRetry} onChange={(e) => setDraftRetry(Number(e.target.value))} />
          </label>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={draftRequireApproval} onChange={(e) => setDraftRequireApproval(e.target.checked)} />
            <span>Require Human Approval Gate before publishing</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={confirmActivation} onChange={(e) => setConfirmActivation(e.target.checked)} />
            <span>I confirm activating this workflow when scheduled</span>
          </label>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <b style={{ fontSize: 12 }}>Workflow Nodes ({draftNodes.length})</b>
            <button
              type="button"
              className="btn ghost"
              style={{ height: 26, fontSize: 11 }}
              onClick={() =>
                setDraftNodes((prev) => [
                  ...prev,
                  { id: `n-${Date.now()}`, type: "action", label: "New Workflow Step", config: {} },
                ])
              }
            >
              + Add Step
            </button>
          </div>
          <div className="mos-stack">
            {draftNodes.map((n, idx) => (
              <div key={n.id} className="mos-list-row" style={{ gap: 8 }}>
                <span className="badge blue"><i />{idx + 1}. {n.type}</span>
                <select
                  value={n.type}
                  onChange={(e) =>
                    setDraftNodes((prev) =>
                      prev.map((x) => (x.id === n.id ? { ...x, type: e.target.value as WorkflowNode["type"] } : x)),
                    )
                  }
                >
                  <option value="trigger">trigger</option>
                  <option value="condition">condition</option>
                  <option value="action">action</option>
                  <option value="approval_gate">approval_gate</option>
                </select>
                <input
                  style={{ flex: 1, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", color: "var(--text)" }}
                  value={n.label}
                  onChange={(e) =>
                    setDraftNodes((prev) => prev.map((x) => (x.id === n.id ? { ...x, label: e.target.value } : x)))
                  }
                />
                <button
                  type="button"
                  className="btn ghost"
                  style={{ height: 26, fontSize: 11, color: "#ff9c9c" }}
                  onClick={() => setDraftNodes((prev) => prev.filter((x) => x.id !== n.id))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {projects.filter((p) => !p.scriptApproved && (p.script?.trim() || p.scriptVariants?.length)).length > 0 && (
        <section className="card" style={{ padding: 16, marginBottom: 14, borderColor: "var(--gold)" }}>
          <CardTitle
            title={`Scripts Awaiting Approval (${projects.filter((p) => !p.scriptApproved && (p.script?.trim() || p.scriptVariants?.length)).length})`}
            copy="Approve an automated script draft to unlock Storyboard, Avatar Studio, and Video Editor."
          />
          <div className="mos-stack" style={{ marginTop: 10 }}>
            {projects
              .filter((p) => !p.scriptApproved && (p.script?.trim() || p.scriptVariants?.length))
              .slice(0, 5)
              .map((proj) => (
                <div key={proj.id} className="mos-subcard" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div>
                      <b>{proj.title}</b>
                      <small style={{ display: "block", color: "var(--muted)" }}>
                        {proj.platform} · {proj.status || "AWAITING_SCRIPT_APPROVAL"}
                        {proj.hook ? ` · Hook: “${proj.hook.slice(0, 90)}”` : ""}
                      </small>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn primary"
                        style={{ height: 28, fontSize: 11 }}
                        disabled={approvingProjId === proj.id}
                        onClick={() => void approveLinkedProject(proj, "stay")}
                      >
                        {approvingProjId === proj.id ? "Approving…" : "✓ Approve Script Now"}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ height: 28, fontSize: 11 }}
                        disabled={approvingProjId === proj.id}
                        onClick={() => void approveLinkedProject(proj, "storyboard")}
                      >
                        ✓ Approve &amp; Open Storyboard →
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ height: 28, fontSize: 11 }}
                        disabled={approvingProjId === proj.id}
                        onClick={() => void approveLinkedProject(proj, "video")}
                      >
                        ✓ Approve &amp; Create Video →
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ height: 28, fontSize: 11 }}
                        onClick={() =>
                          onOpenProject ? onOpenProject(proj, "scripts") : go?.("Content Studio")
                        }
                      >
                        Edit in Content Studio →
                      </button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      <section className="card run-history">
        <CardTitle title="Execution History & Step Logs" copy="Server-persisted execution runs with retry & approval gate tracking" />
        {workflowExecutions.length === 0 && runs.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13, padding: "12px 0" }}>
            No execution runs yet. Save or run a workflow above.
          </p>
        ) : (
          <div className="mos-stack" style={{ marginTop: 10 }}>
            {workflowExecutions.slice(0, 8).map((ex) => {
              const linked =
                (ex.projectId ? projects.find((p) => p.id === ex.projectId) : undefined) ||
                (ex.projectTitle ? projects.find((p) => p.title === ex.projectTitle) : undefined) ||
                projects.find((p) => !p.scriptApproved && (p.script?.trim() || p.scriptVariants?.length));
              return (
                <div key={ex.id} className="mos-subcard">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <b>
                      {ex.workflowName} · {ex.attempts} attempt(s)
                      {linked ? ` · ${linked.title}` : ""}
                    </b>
                    <span
                      className={`badge ${
                        linked?.scriptApproved && linked?.finalApproved
                          ? "mint"
                          : ex.status === "completed"
                            ? "mint"
                            : ex.status === "awaiting_approval"
                              ? "review"
                              : "high"
                      }`}
                    >
                      <i />
                      {linked
                        ? !linked.scriptApproved
                          ? "Awaiting Script Approval"
                          : !linked.videoUrl && !linked.editedVideoUrl
                            ? "Script Approved · Ready for Video"
                            : !linked.finalApproved
                              ? "Awaiting Final Approval"
                              : "Ready to Publish"
                        : ex.status}
                    </span>
                  </div>
                  <small style={{ color: "var(--muted)", display: "block", marginTop: 4 }}>{ex.summary}</small>
                  <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
                    {ex.stepLogs.map((st, idx) => (
                      <small key={`${st.nodeId}-${idx}`} style={{ color: "var(--muted)" }}>
                        [{st.status}] {st.label}: {st.detail}
                      </small>
                    ))}
                  </div>
                  {linked && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                      {!linked.scriptApproved ? (
                        <>
                          <button
                            type="button"
                            className="btn primary"
                            style={{ height: 28, fontSize: 11 }}
                            disabled={approvingProjId === linked.id}
                            onClick={() => void approveLinkedProject(linked, "stay")}
                          >
                            {approvingProjId === linked.id ? "Approving…" : "✓ Approve Script Now"}
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ height: 28, fontSize: 11 }}
                            onClick={() =>
                              onOpenProject ? onOpenProject(linked, "scripts") : go?.("Content Studio")
                            }
                          >
                            Review Script in Studio →
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ height: 28, fontSize: 11 }}
                            disabled={approvingProjId === linked.id}
                            onClick={() => void approveLinkedProject(linked, "video")}
                          >
                            ✓ Approve &amp; Create Video →
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ height: 28, fontSize: 11 }}
                            onClick={() =>
                              onOpenProject ? onOpenProject(linked, "storyboard") : go?.("Content Studio")
                            }
                          >
                            Open Storyboard →
                          </button>
                          <button
                            type="button"
                            className="btn primary"
                            style={{ height: 28, fontSize: 11 }}
                            onClick={() =>
                              onOpenProject ? onOpenProject(linked, "video") : go?.("Video Editor")
                            }
                          >
                            Create Video in Editor →
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            style={{ height: 28, fontSize: 11 }}
                            onClick={() =>
                              onOpenProject ? onOpenProject(linked, "avatar") : go?.("AI Avatar Studio")
                            }
                          >
                            Avatar Studio →
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {runs.map((r) => {
              const linked =
                (r.projectId ? projects.find((p) => p.id === r.projectId) : undefined) ||
                (r.projectTitle ? projects.find((p) => p.title === r.projectTitle) : undefined);
              return (
                <div key={r.id} className="mos-list-row" style={{ flexWrap: "wrap", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 200 }}>
                    <b>{r.runAt}{linked ? ` · ${linked.title}` : ""}</b>
                    <small>{r.summary}</small>
                  </span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span
                      className={`badge ${
                        linked?.scriptApproved || r.status === "Completed" ? "mint" : "review"
                      }`}
                    >
                      <i />
                      {linked
                        ? !linked.scriptApproved
                          ? "Awaiting Script Approval"
                          : "Script Approved"
                        : r.status}
                    </span>
                    {linked && !linked.scriptApproved && (
                      <>
                        <button
                          type="button"
                          className="btn primary"
                          style={{ height: 26, fontSize: 11 }}
                          disabled={approvingProjId === linked.id}
                          onClick={() => void approveLinkedProject(linked, "stay")}
                        >
                          {approvingProjId === linked.id ? "Approving…" : "✓ Approve Script"}
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          style={{ height: 26, fontSize: 11 }}
                          onClick={() =>
                            onOpenProject ? onOpenProject(linked, "scripts") : go?.("Content Studio")
                          }
                        >
                          Review Script →
                        </button>
                      </>
                    )}
                    {linked && linked.scriptApproved && (
                      <button
                        type="button"
                        className="btn primary"
                        style={{ height: 26, fontSize: 11 }}
                        onClick={() =>
                          onOpenProject ? onOpenProject(linked, "video") : go?.("Video Editor")
                        }
                      >
                        Create Video →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

export function SettingsView({
  workspace,
  authUser,
  models,
  modelCatalog,
  geminiConfigured,
  onOpenAuth,
  onSignOut,
  onDeleteAccount,
  onRefreshUser,
  onUpdateWorkspace,
  onUpdateModels,
  notify,
}: {
  workspace: WorkspaceProfile;
  authUser: User | null;
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  geminiConfigured: boolean;
  creditTransactions?: CreditTransaction[];
  onOpenAuth?: () => void;
  onSignOut?: () => Promise<void>;
  onDeleteAccount?: () => Promise<void>;
  onRefreshUser?: () => Promise<void>;
  onUpdateWorkspace: (patch: Partial<WorkspaceProfile>) => void;
  onUpdateModels: (patch: Partial<ModelPreferences>) => void;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState("Account & Security");
  const [name, setName] = useState(workspace.name);
  const [url, setUrl] = useState(workspace.websiteUrl);
  const [displayNameInput, setDisplayNameInput] = useState(authUser?.displayName || "");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [members, setMembers] = useState<Array<{ name: string; email: string; role: string }>>(() =>
    authUser
      ? [
          {
            name: authUser.displayName || "Workspace Owner",
            email: authUser.email || "",
            role: "Owner",
          },
        ]
      : [],
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; action: string; target: string; status: string; detail: string; createdAt: string }>>([]);
  const [aiRuns, setAiRuns] = useState<Array<{ id: string; agent: string; model: string; status: string; latencyMs: number; createdAt: string }>>([]);
  const [telemetry, setTelemetry] = useState<{ totalRuns?: number; avgLatencyMs?: number; recentModels?: string[] } | null>(null);

  useEffect(() => {
    setName(workspace.name);
    setUrl(workspace.websiteUrl);
    setDisplayNameInput(authUser?.displayName || "");
  }, [workspace.name, workspace.websiteUrl, authUser?.displayName]);

  useEffect(() => {
    if (tab === "AI & Audit Logs" || tab === "AI Telemetry") {
      Promise.all([
        apiGet<{ logs: typeof auditLogs }>("/api/audit/logs"),
        apiGet<{ runs: typeof aiRuns }>("/api/audit/ai-runs"),
        apiGet<{ totalRuns?: number; avgLatencyMs?: number; recentModels?: string[] }>("/api/telemetry/usage"),
      ])
        .then(([l, r, t]) => {
          setAuditLogs(l.logs || []);
          setAiRuns(r.runs || []);
          setTelemetry(t);
        })
        .catch(() => {});
    }
  }, [tab]);

  useEffect(() => {
    if (authUser) {
      setMembers((prev) => {
        const hasOwner = prev.some((m) => m.email === (authUser.email || ""));
        if (hasOwner) return prev;
        return [
          {
            name: authUser.displayName || "Workspace Owner",
            email: authUser.email || "",
            role: "Owner",
          },
          ...prev,
        ];
      });
    }
  }, [authUser]);

  const tabs = [
    "Account & Security",
    "Workspace",
    "AI Models",
    "AI & Audit Logs",
    "Team members",
    "AI Telemetry",
    "Security",
  ];

  return (
    <>
      <PageHeader
        eyebrow="Workspace administration"
        title="Settings & team"
        copy="Manage your personal account, workspace continuity, AI model routing, audit trails, and security."
      />

      <div className="mos-mobile-pills">
        {tabs.map((x) => (
          <button key={x} className={tab === x ? "active" : ""} onClick={() => setTab(x)}>
            {x}
          </button>
        ))}
      </div>

      <div className="settings-layout">
        <aside>
          {tabs.map((x) => (
            <button className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>
              {x}
              <span>›</span>
            </button>
          ))}
        </aside>

        <section className="card settings-page">
          {tab === "Account & Security" ? (
            <>
              <h2>User Account &amp; Workspace Isolation</h2>
              <p>Manage registration, email verification, password reset, and permanent account deletion.</p>
              {!authUser ? (
                <div className="mos-subcard" style={{ marginTop: 16 }}>
                  <b>Guest Session Active</b>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    Sign in or create an account to isolate your workspace to your UID and sync across devices.
                  </p>
                  {onOpenAuth && (
                    <button className="btn primary" style={{ marginTop: 12 }} onClick={onOpenAuth}>
                      Sign In or Create Account
                    </button>
                  )}
                </div>
              ) : (
                <div className="mos-stack" style={{ marginTop: 16 }}>
                  <div className="mos-list-row">
                    <span>
                      <b>{authUser.email || "Signed-in User"}</b>
                      <small>UID: {authUser.uid}</small>
                    </span>
                    <span className={`badge ${authUser.emailVerified ? "mint" : "review"}`}>
                      <i />
                      {authUser.emailVerified ? "Email Verified" : "Verification Pending"}
                    </span>
                  </div>

                  {!authUser.emailVerified && (
                    <div className="mos-confirm-box">
                      <b style={{ fontSize: 12 }}>Verify your email address to activate Firestore cloud sync</b>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={accountBusy}
                          onClick={async () => {
                            setAccountBusy(true);
                            try {
                              await sendVerificationEmail();
                              notify("Verification email sent");
                            } catch (err) {
                              notify(formatFirebaseAuthError(err));
                            } finally {
                              setAccountBusy(false);
                            }
                          }}
                        >
                          Resend Verification Email
                        </button>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={accountBusy}
                          onClick={async () => {
                            setAccountBusy(true);
                            try {
                              await reloadCurrentUser();
                              await onRefreshUser?.();
                              notify("Refreshed account verification status");
                            } catch (err) {
                              notify(formatFirebaseAuthError(err));
                            } finally {
                              setAccountBusy(false);
                            }
                          }}
                        >
                          I&apos;ve Verified — Refresh
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="form-grid">
                    <label>
                      <span>Profile Display Name</span>
                      <input
                        value={displayNameInput}
                        onChange={(e) => setDisplayNameInput(e.target.value)}
                      />
                    </label>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={accountBusy}
                        onClick={async () => {
                          setAccountBusy(true);
                          try {
                            await updateUserProfileInfo(displayNameInput);
                            await onRefreshUser?.();
                            notify("Profile display name updated");
                          } catch (err) {
                            notify(formatFirebaseAuthError(err));
                          } finally {
                            setAccountBusy(false);
                          }
                        }}
                      >
                        Save Name
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={accountBusy || !authUser.email}
                        onClick={async () => {
                          if (!authUser.email) return;
                          setAccountBusy(true);
                          try {
                            await resetPasswordEmail(authUser.email);
                            notify(`Password reset email sent to ${authUser.email}`);
                          } catch (err) {
                            notify(formatFirebaseAuthError(err));
                          } finally {
                            setAccountBusy(false);
                          }
                        }}
                      >
                        Reset Password
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() =>
                          void (onSignOut ? onSignOut() : signOutGoogle()).then(() =>
                            notify("Signed out"),
                          )
                        }
                      >
                        Sign Out
                      </button>
                    </div>
                  </div>

                  {onDeleteAccount && (
                    <div className="mos-error-box" style={{ marginTop: 10 }}>
                      <b>Danger Zone · Delete Account Permanently</b>
                      <p style={{ fontSize: 11, marginTop: 4 }}>
                        Type <b>DELETE</b> below to remove your Firebase user, Firestore workspaces, and server workspace state.
                      </p>
                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <input
                          style={{ background: "var(--surface)", color: "var(--text)", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                          placeholder="Type DELETE"
                          value={deleteConfirmText}
                          onChange={(e) => setDeleteConfirmText(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn primary"
                          style={{ background: "#c93b3b", borderColor: "#c93b3b", color: "#fff" }}
                          disabled={accountBusy || deleteConfirmText.trim() !== "DELETE"}
                          onClick={async () => {
                            setAccountBusy(true);
                            try {
                              await onDeleteAccount();
                              setDeleteConfirmText("");
                              notify("Account deleted");
                            } catch (err) {
                              notify(formatFirebaseAuthError(err));
                            } finally {
                              setAccountBusy(false);
                            }
                          }}
                        >
                          Delete Account Forever
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : tab === "AI Models" ? (
            <>
              <h2>AI Model Routing</h2>
              <p>Choose your default Gemini, Nano Banana, Omni Video, TTS, and Lyria models across all studios.</p>
              <div className="form-grid" style={{ marginTop: 18 }}>
                <ModelSelector
                  label="Text, Strategy & Research Model"
                  value={models.textModel}
                  options={modelCatalog.text}
                  onChange={(id) => {
                    onUpdateModels({ textModel: id });
                    notify(`Default reasoning model set to ${id}`);
                  }}
                />
                <ModelSelector
                  label="Image Studio Model"
                  value={models.imageModel}
                  options={modelCatalog.image}
                  onChange={(id) => {
                    onUpdateModels({ imageModel: id });
                    notify(`Default image model set to ${id}`);
                  }}
                />
                <ModelSelector
                  label="Video Generation Model"
                  value={models.videoModel}
                  options={modelCatalog.video}
                  onChange={(id) => onUpdateModels({ videoModel: id })}
                />
                <ModelSelector
                  label="Voice & Narration Model"
                  value={models.voiceModel}
                  options={modelCatalog.voice}
                  onChange={(id) => onUpdateModels({ voiceModel: id })}
                />
                <ModelSelector
                  label="Music Generation Model"
                  value={models.musicModel}
                  options={modelCatalog.music}
                  onChange={(id) => onUpdateModels({ musicModel: id })}
                />
              </div>
              <div className="demo-note" style={{ marginTop: 18 }}>
                Server Gemini API Status:{" "}
                <b>{geminiConfigured ? "Configured via Settings > Secrets" : "Pending GEMINI_API_KEY in AI Studio Settings > Secrets"}</b>
              </div>
            </>
          ) : tab === "AI & Audit Logs" ? (
            <>
              <h2>AI Execution & Security Audit Logs</h2>
              <p>Live server-persisted Gemini runs, model latencies, and confirmed OAuth/publishing events.</p>
              <h3 style={{ marginTop: 18, marginBottom: 8 }}>Recent Gemini Runs ({aiRuns.length})</h3>
              {aiRuns.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>No server AI runs logged yet.</p>
              ) : (
                <div className="mos-stack">
                  {aiRuns.slice(0, 10).map((run) => (
                    <div className="mos-list-row" key={run.id}>
                      <span>
                        <b>{run.agent}</b>
                        <small>{run.model} · {run.latencyMs}ms · {run.createdAt.slice(11, 19)}</small>
                      </span>
                      <span className={`badge ${run.status === "completed" ? "mint" : "review"}`}>
                        <i />
                        {run.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <h3 style={{ marginTop: 22, marginBottom: 8 }}>Security & Publishing Audit Trail ({auditLogs.length})</h3>
              {auditLogs.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>No security/audit actions logged yet.</p>
              ) : (
                <div className="mos-stack">
                  {auditLogs.slice(0, 10).map((log) => (
                    <div className="mos-list-row" key={log.id}>
                      <span>
                        <b>{log.action}</b>
                        <small>{log.detail}</small>
                      </span>
                      <span className={`badge ${log.status === "allowed" ? "mint" : "review"}`}>
                        <i />
                        {log.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : tab === "Team members" ? (
            <>
              <h2>Team members</h2>
              <p>Control who can access {workspace.name || "this workspace"} and approve critical actions.</p>
              {members.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13, margin: "14px 0" }}>
                  Sign in with Google to register as workspace owner, or invite a teammate below.
                </p>
              ) : (
                <div className="member-list">
                  {members.map((m, i) => (
                    <div key={m.email || m.name}>
                      <span className={`member-avatar m${i % 3}`}>
                        {m.name
                          .split(" ")
                          .filter(Boolean)
                          .map((y) => y[0])
                          .join("") || "U"}
                      </span>
                      <span>
                        <b>{m.name}</b>
                        <small>{m.email}</small>
                      </span>
                      <span className="badge blue">
                        <i />
                        {m.role}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  style={{
                    flex: 1,
                    minWidth: 200,
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "8px 10px",
                    color: "var(--text)",
                  }}
                  placeholder="teammate@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
                <button
                  className="btn primary"
                  onClick={() => {
                    if (!inviteEmail.trim()) return;
                    setMembers((prev) => [
                      ...prev,
                      { name: inviteEmail.split("@")[0], email: inviteEmail.trim(), role: "Editor" },
                    ]);
                    setInviteEmail("");
                    notify("Teammate invited");
                  }}
                >
                  Invite member
                </button>
              </div>
            </>
          ) : tab === "AI Telemetry" ? (
            <>
              <h2>Internal AI Telemetry</h2>
              <p>Server-side Gemini usage telemetry for your personal workspace (no credit locks or limits).</p>
              <div className="mos-stack" style={{ marginTop: 16 }}>
                <div className="mos-list-row">
                  <span>
                    <b>Total Recorded Server AI Calls</b>
                    <small>Tracked across Strategy, Content, Intelligence, and Media Analysis</small>
                  </span>
                  <b>{telemetry?.totalRuns ?? aiRuns.length}</b>
                </div>
                <div className="mos-list-row">
                  <span>
                    <b>Average Model Latency</b>
                    <small>Measured server-side per API invocation</small>
                  </span>
                  <b>{telemetry?.avgLatencyMs ? `${Math.round(telemetry.avgLatencyMs)} ms` : "—"}</b>
                </div>
                {telemetry?.recentModels && telemetry.recentModels.length > 0 && (
                  <div className="mos-list-row">
                    <span>
                      <b>Models Used</b>
                      <small>{telemetry.recentModels.join(" · ")}</small>
                    </span>
                  </div>
                )}
              </div>
            </>
          ) : tab === "Security" ? (
            <>
              <h2>Security & Server Secrets</h2>
              <p>API keys and service credentials are strictly isolated server-side.</p>
              <div className="mos-stack" style={{ marginTop: 16 }}>
                <div className="mos-list-row">
                  <span>
                    <b>Gemini API Key</b>
                    <small>Managed securely via server environment (never exposed to browser)</small>
                  </span>
                  <span className={`badge ${geminiConfigured ? "mint" : "review"}`}>
                    <i />
                    {geminiConfigured ? "Configured" : "Set in Secrets"}
                  </span>
                </div>
                <div className="mos-list-row">
                  <span>
                    <b>Composio Connect Secret Isolation</b>
                    <small>Consumer key and OAuth tokens reside exclusively server-side</small>
                  </span>
                  <span className="badge mint">
                    <i />
                    Enforced
                  </span>
                </div>
                <div className="mos-list-row">
                  <span>
                    <b>Firestore Isolation Rules</b>
                    <small>Owner-scoped rules with terminal state immutability enforced at database layer</small>
                  </span>
                  <span className="badge mint">
                    <i />
                    Deployed
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <h2>Workspace profile</h2>
              <p>Core details visible across the Marketing OS workspace.</p>
              <div className="form-grid" style={{ marginTop: 18 }}>
                <label>
                  <span>Workspace name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  <span>Website URL</span>
                  <input value={url} onChange={(e) => setUrl(e.target.value)} />
                </label>
              </div>
              <button
                className="btn primary"
                style={{ marginTop: 16 }}
                onClick={() => {
                  onUpdateWorkspace({ name, websiteUrl: url });
                  notify("Workspace settings saved");
                }}
              >
                Save changes
              </button>
            </>
          )}
        </section>
      </div>
    </>
  );
}
