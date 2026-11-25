import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { User } from "firebase/auth";
import { ModelSelector } from "../components/ModelSelector";
import { apiGet, apiPost } from "../lib/api";
import type {
  AiMemoryItem,
  AutomationRunLog,
  CalendarPost,
  ChannelAnalysisResult,
  CompetitorItem,
  ContentProject,
  InfluencerItem,
  MediaAsset,
  ModelCatalog,
  ModelPreferences,
  NotebookSectionInsight,
  NotebookVersion,
  Page,
  SavedStrategy,
  SeoIssueItem,
  SeoKeywordItem,
  SourceType,
  StrategyFeedbackComparison,
  StrategyPlan,
  TrendFormatItem,
  VideoBreakdownItem,
  WorkspaceProfile,
} from "../types/marketing";

export function SourceBadge({ sourceType }: { sourceType?: SourceType }) {
  if (!sourceType) return null;
  const map: Record<SourceType, { label: string; tone: string }> = {
    live_api: { label: "Live API", tone: "mint" },
    live_crawl: { label: "Live Crawl", tone: "mint" },
    ai_grounded: { label: "AI Grounded", tone: "blue" },
    ai_simulation: { label: "AI Simulation", tone: "review" },
    imported: { label: "Imported", tone: "blue" },
    manual: { label: "Edited", tone: "mint" },
  };
  const item = map[sourceType];
  if (!item) return null;
  return (
    <span className={`badge ${item.tone}`}>
      <i />
      {item.label}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  copy,
  actions,
}: {
  eyebrow?: string;
  title: string;
  copy: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  );
}

export function CardTitle({
  title,
  copy,
  action,
  onAction,
}: {
  title: string;
  copy?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="card-title">
      <div>
        <h3>{title}</h3>
        {copy && <p>{copy}</p>}
      </div>
      {action && (
        <button onClick={onAction} type="button">
          {action} <span>⌄</span>
        </button>
      )}
    </div>
  );
}

function Sparkline({
  color = "#72e6bd",
  values = [8, 18, 13, 29, 24, 43, 37, 58, 54, 71],
}: {
  color?: string;
  values?: number[];
}) {
  const max = Math.max(...values);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${38 - (v / max) * 34}`)
    .join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 40" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`g${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor={color} stopOpacity=".26" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,40 ${pts} 100,40`} fill={`url(#g${color.replace("#", "")})`} />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function OverviewView({
  workspace,
  authUser,
  projects,
  competitors,
  seoKeywords,
  strategy,
  calendarPosts,
  automationRuns,
  go,
  onOpenVoice,
}: {
  workspace: WorkspaceProfile;
  authUser: User | null;
  projects: ContentProject[];
  competitors: CompetitorItem[];
  seoKeywords: SeoKeywordItem[];
  strategy: StrategyPlan | null;
  calendarPosts: CalendarPost[];
  automationRuns: AutomationRunLog[];
  go: (p: Page) => void;
  onOpenVoice: () => void;
}) {
  const publishedCount = calendarPosts.filter((p) => p.status === "Published").length;
  const firstName = authUser?.displayName?.split(" ")[0];
  const greeting = firstName
    ? `Welcome back, ${firstName}.`
    : workspace.name
      ? `${workspace.name} Workspace`
      : "Marketing OS Workspace";

  const metrics = [
    ["Content projects", String(projects.length), projects.length ? "In pipeline" : "No projects yet", "#72e6bd"],
    ["Scheduled posts", String(calendarPosts.length), publishedCount ? `${publishedCount} published` : "Calendar queue", "#8d9eff"],
    ["Competitors tracked", String(competitors.length), competitors.length ? "Grounded scan" : "Run discovery", "#e9b76e"],
    ["SEO keywords", String(seoKeywords.length), seoKeywords.length ? "Tracked intent" : "Run SEO audit", "#d58cff"],
  ];

  const workspaceActivityData = [
    { stage: "Competitors", count: competitors.length },
    { stage: "Keywords", count: seoKeywords.length },
    { stage: "Projects", count: projects.length },
    { stage: "Scheduled", count: calendarPosts.length },
    { stage: "Automations", count: automationRuns.length },
  ];

  const liveFeed: Array<[string, string, string]> = [
    ...automationRuns.slice(0, 2).map(
      (r) => ["Automation", r.summary, r.runAt] as [string, string, string],
    ),
    ...projects.slice(0, 2).map(
      (p) => ["Pipeline", `${p.title} (${p.stage})`, p.platform] as [string, string, string],
    ),
    ...calendarPosts.slice(0, 2).map(
      (c) => ["Publisher", `${c.title} · ${c.status}`, c.dateStr] as [string, string, string],
    ),
  ].slice(0, 4);

  return (
    <>
      <div className="overview-hero">
        <div>
          <span className="badge mint">
            <i />
            {workspace.name ? `${workspace.name} intelligence active` : "Ready for business setup"}
          </span>
          <h1>{greeting}</h1>
          <p>
            {workspace.name
              ? `${workspace.name} is connected. Monitor live workspace progress and launch AI agents below.`
              : "Complete your Business Notebook or open AI Command Center to begin."}
          </p>
        </div>
        <div className="hero-actions">
          <button className="btn secondary" onClick={onOpenVoice}>
            🎙 Live Voice AI
          </button>
          <button className="btn secondary" onClick={() => go("Business Notebook")}>
            Business Notebook
          </button>
          <button className="btn primary" onClick={() => go("AI Command Center")}>
            Ask Marketing AI →
          </button>
        </div>
      </div>

      <div className="metric-grid">
        {metrics.map((m, i) => (
          <div className="metric-card" key={m[0]}>
            <div>
              <span>{m[0]}</span>
              <span className="badge blue">
                <i />
                {m[2]}
              </span>
            </div>
            <strong>{m[1]}</strong>
            <Sparkline
              color={m[3]}
              values={[
                Math.max(1, Number(m[1])),
                Math.max(1, Number(m[1]) + (i % 2)),
                Math.max(1, Number(m[1]) + 1),
              ]}
            />
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="card growth-card">
          <CardTitle
            title="Workspace output breakdown"
            copy="Tracked research, creative, and distribution artifacts"
            action="Open analytics"
            onAction={() => go("Analytics")}
          />
          <div style={{ width: "100%", height: 225, marginTop: 14 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workspaceActivityData} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="stage" stroke="#8c9894" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#8c9894" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface2)",
                    border: "1px solid var(--border2)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="#72e6bd" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card recommendation">
          <div className="rec-icon">✦</div>
          <span className="badge mint">
            <i />
            Strategy Intelligence
          </span>
          {strategy ? (
            <>
              <h3>{strategy.title}</h3>
              <p>{strategy.executiveSummary}</p>
              <div className="evidence">
                <span>{strategy.contentPillars.length}</span>
                <small>content pillars</small>
                <span>{strategy.experiments.length}</span>
                <small>experiments</small>
              </div>
              <button className="btn primary" onClick={() => go("Marketing Strategy")}>
                Open full strategy →
              </button>
            </>
          ) : (
            <>
              <h3>No marketing strategy generated yet.</h3>
              <p>
                Generate a tailored multi-channel roadmap using your Business Notebook and target
                goals.
              </p>
              <button className="btn primary" onClick={() => go("Marketing Strategy")}>
                Generate AI Strategy →
              </button>
            </>
          )}
        </section>

        <section className="card activity-card">
          <CardTitle title="Recent workspace activity" copy="Projects, runs & posts" action="Automations" onAction={() => go("Automation Workflows")} />
          {liveFeed.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 12 }}>
              No agent runs or content items recorded yet. Launch a workflow in AI Command Center or Content Studio.
            </p>
          ) : (
            liveFeed.map((a, i) => (
              <div className="activity" key={`${a[0]}-${a[1]}-${i}`}>
                <span className={`agent a${i % 4}`}>●</span>
                <div>
                  <b>{a[0]}</b>
                  <p>{a[1]}</p>
                </div>
                <small>{a[2]}</small>
              </div>
            ))
          )}
        </section>

        <section className="card upcoming">
          <CardTitle
            title="Upcoming content"
            copy="Your scheduled posts"
            action="Open calendar"
            onAction={() => go("Content Calendar")}
          />
          {calendarPosts.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 12 }}>
              No scheduled posts yet. Draft and schedule posts in Content Calendar.
            </p>
          ) : (
            calendarPosts.slice(0, 3).map((post, i) => (
              <button className="upcoming-row" onClick={() => go("Content Calendar")} key={post.id}>
                <div className={`post-thumb p${i % 3}`}>
                  <span>{i === 0 ? "▶" : "Aa"}</span>
                </div>
                <div>
                  <small>
                    {post.dateStr} · {post.timeStr}
                  </small>
                  <b>{post.title}</b>
                  <span>{post.platform}</span>
                </div>
                <span className={`badge ${post.status === "Published" ? "mint" : post.status === "Ready" ? "ready" : "review"}`}>
                  <i />
                  {post.status.toLowerCase()}
                </span>
              </button>
            ))
          )}
        </section>
      </div>

      <section className="quick-section">
        <CardTitle title="Move work forward" copy="Start with a focused action" />
        <div className="quick-grid">
          {[
            ["Research competitors", "Live Google Search scan", "Competitors"],
            ["Create a short video", "Scripts, Nano Banana & FFmpeg", "Content Studio"],
            ["Run SEO audit", "Live HTML crawl + fixes", "SEO & ASO"],
            ["Build a campaign", "Plan & execute via agents", "AI Command Center"],
          ].map((x) => (
            <button key={x[0]} onClick={() => go(x[2] as Page)}>
              <span>◈</span>
              <b>{x[0]}</b>
              <small>{x[1]}</small>
              <i>↗</i>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

interface ChatConversation {
  id: string;
  title: string;
  subtitle: string;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  planTitle: string;
  stages: Array<{ step: string; agent: string; detail: string }>;
  estimatedCredits: number;
  expectedTime: string;
}

export function CommandCenterView({
  workspace,
  models,
  modelCatalog,
  onSelectTextModel,
  onAddProjects,
  onAddCalendarDrafts,
  onConsumeCredits,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  onSelectTextModel: (id: string) => void;
  onAddProjects: (items: ContentProject[]) => void;
  onAddCalendarDrafts: (posts: CalendarPost[]) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [conversations, setConversations] = useState<ChatConversation[]>([
    {
      id: "conv-1",
      title: "New Marketing Thread",
      subtitle: "Ready",
      messages: [],
      planTitle: "",
      stages: [],
      estimatedCredits: 0,
      expectedTime: "",
    },
  ]);
  const [activeConvId, setActiveConvId] = useState("conv-1");
  const [systemRole, setSystemRole] = useState("Chief Marketing Strategist");
  const [inputText, setInputText] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [executionSummary, setExecutionSummary] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const activeConv = conversations.find((c) => c.id === activeConvId) || conversations[0];

  const sendMessage = async () => {
    const prompt = inputText.trim();
    if (!prompt || chatLoading) return;
    setErrorMsg("");
    setInputText("");
    setChatLoading(true);
    setProgress(0);
    setExecutionSummary("");

    const updatedMsgs = [...activeConv.messages, { role: "user" as const, text: prompt }];
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConv.id ? { ...c, messages: updatedMsgs } : c)),
    );

    try {
      const res = await apiPost<{
        reply: string;
        planTitle: string;
        estimatedCredits: number;
        expectedTime: string;
        stages: { step: string; agent: string; detail: string }[];
      }>("/api/command-center/chat", {
        message: prompt,
        history: updatedMsgs,
        business: workspace,
        model: models.textModel,
        systemRole,
      });

      onConsumeCredits(35, `Command Center (${models.textModel})`);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConv.id
            ? {
                ...c,
                title: prompt.slice(0, 34),
                subtitle: "Plan ready",
                messages: [...updatedMsgs, { role: "assistant", text: res.reply }],
                planTitle: res.planTitle || c.planTitle,
                stages: res.stages?.length ? res.stages : c.stages,
                estimatedCredits: res.estimatedCredits || 380,
                expectedTime: res.expectedTime || "~3 minutes",
              }
            : c,
        ),
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to run Marketing AI chat");
    } finally {
      setChatLoading(false);
    }
  };

  const runPlan = async () => {
    if (executing) return;
    setErrorMsg("");
    setExecuting(true);
    setProgress(1);
    const timer = setInterval(() => {
      setProgress((p) => (p < 5 ? p + 1 : p));
    }, 850);

    try {
      const lastUser =
        [...activeConv.messages].reverse().find((m) => m.role === "user")?.text ||
        activeConv.planTitle;

      const res = await apiPost<{
        summary: string;
        projects?: Array<{
          title: string;
          platform: string;
          hook: string;
          script: string;
          stage: "Script" | "Awaiting approval";
        }>;
        calendarDrafts?: Array<{
          title: string;
          platform: string;
          dayOffset: number;
          time: string;
          caption: string;
        }>;
      }>("/api/command-center/execute", {
        goal: lastUser,
        planTitle: activeConv.planTitle,
        business: workspace,
        model: models.textModel,
      });

      clearInterval(timer);
      setProgress(6);
      setExecutionSummary(res.summary || "Execution completed with draft-only deliverables.");
      onConsumeCredits(180, `Multi-Agent Plan (${models.textModel})`);

      if (res.projects?.length) {
        onAddProjects(
          res.projects.map((p, idx) => ({
            id: `ai-proj-${Date.now()}-${idx}`,
            title: p.title,
            platform: p.platform || "Instagram",
            stage: p.stage === "Awaiting approval" ? "Awaiting approval" : "Script",
            owner: "Command Center AI",
            progress: p.stage === "Awaiting approval" ? 90 : 45,
            creditsUsed: 90,
            thumbUrl: "",
            hook: p.hook,
            script: p.script,
            sourceType: "ai_grounded",
          })),
        );
      }

      if (res.calendarDrafts?.length) {
        const now = new Date();
        onAddCalendarDrafts(
          res.calendarDrafts.map((d, idx) => {
            const targetDate = new Date(now);
            targetDate.setDate(now.getDate() + (d.dayOffset || idx + 1));
            const dateStr = targetDate.toISOString().slice(0, 10);
            return {
              id: `ai-cal-${Date.now()}-${idx}`,
              title: d.title,
              platform: d.platform || "Instagram",
              dateStr,
              dayOfMonth: targetDate.getDate(),
              timeStr: d.time || "18:00",
              tone: idx % 2 === 0 ? "mint" : "purple",
              caption: d.caption,
              status: "Needs review",
              checksPassed: 4,
              thumbUrl: "",
              sourceType: "ai_grounded",
            };
          }),
        );
      }

      notify("Multi-agent plan completed — drafts added to Pipeline & Calendar");
    } catch (err) {
      clearInterval(timer);
      setProgress(0);
      setErrorMsg(err instanceof Error ? err.message : "Plan execution failed");
    } finally {
      setExecuting(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Central orchestration"
        title="AI Command Center"
        copy="Describe the outcome. Marketing OS plans the work, coordinates agents, and stops before publishing."
        actions={
          <>
            <select
              className="filter"
              value={systemRole}
              onChange={(e) => setSystemRole(e.target.value)}
              title="System instruction persona"
            >
              <option value="Chief Marketing Strategist">Persona: Chief Strategist</option>
              <option value="Performance Marketer">Persona: Performance Marketer</option>
              <option value="SEO & Growth Lead">Persona: SEO & Growth Lead</option>
              <option value="Creative Director">Persona: Creative Director</option>
            </select>
            <ModelSelector
              label="Model"
              value={models.textModel}
              options={modelCatalog.text}
              onChange={onSelectTextModel}
              compact
            />
            <button
              className="btn secondary"
              onClick={() => {
                const newId = `conv-${Date.now()}`;
                setConversations((prev) => [
                  {
                    id: newId,
                    title: "New Marketing Thread",
                    subtitle: "Ready",
                    messages: [],
                    planTitle: "",
                    stages: [],
                    estimatedCredits: 0,
                    expectedTime: "",
                  },
                  ...prev,
                ]);
                setActiveConvId(newId);
                setProgress(0);
                setExecutionSummary("");
              }}
            >
              + New conversation
            </button>
          </>
        }
      />

      {errorMsg && <div className="mos-error-box">{errorMsg}</div>}

      <div className="command-layout">
        <aside className="conversation-list">
          {conversations.map((c) => (
            <button
              key={c.id}
              className={c.id === activeConv.id ? "active" : ""}
              onClick={() => setActiveConvId(c.id)}
            >
              <b>{c.title}</b>
              <small>{c.subtitle}</small>
            </button>
          ))}
        </aside>

        <section className="ai-chat card">
          <div className="ai-context">
            <div className="logo-mark">
              <span />
            </div>
            <span>
              <b>Marketing AI · {models.textModel}</b>
              <small>{workspace.name} Business Notebook connected</small>
            </span>
            <span className="badge mint">
              <i />
              6 agents available
            </span>
          </div>

          <div className="chat-thread">
            {activeConv.messages.length === 0 && (
              <div className="mos-subcard" style={{ margin: "12px 0" }}>
                <b>Start a multi-turn strategy & campaign conversation</b>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Ask Marketing OS ({systemRole} · {models.textModel}) to research your market,
                  build a campaign plan, or draft pipeline deliverables.
                </p>
              </div>
            )}
            {activeConv.messages.map((m, idx) =>
              m.role === "user" ? (
                <div className="user-msg" key={idx}>
                  {m.text}
                </div>
              ) : (
                <div className="ai-msg" key={idx}>
                  <span className="ai-avatar">✦</span>
                  <div>
                    <p>{m.text}</p>
                  </div>
                </div>
              ),
            )}

            {activeConv.stages.length > 0 && (
              <div className="ai-msg">
                <span className="ai-avatar">✦</span>
                <div>
                  <div className="plan-card">
                    <div className="plan-head">
                      <b>{activeConv.planTitle}</b>
                      <span
                        className={`badge ${
                          executing ? "blue" : progress === 6 ? "mint" : "draft"
                        }`}
                      >
                        <i />
                        {executing ? "Executing" : progress === 6 ? "Complete" : "Ready to run"}
                      </span>
                    </div>

                    {activeConv.stages.map((s, i) => (
                      <div
                        className={`plan-step ${
                          i < progress ? "done" : i === progress && executing ? "running" : ""
                        }`}
                        key={s.step}
                      >
                        <span>{i < progress ? "✓" : i + 1}</span>
                        <b>{s.step}</b>
                        <small>
                          {i < progress
                            ? "Complete"
                            : i === progress && executing
                              ? "Agent working…"
                              : s.agent}
                        </small>
                      </div>
                    ))}

                    <div className="plan-meta">
                      <span>
                        <small>Execution mode</small>
                        <b>Personal workspace</b>
                      </span>
                      <span>
                        <small>Approval gates</small>
                        <b>Draft-only mode</b>
                      </span>
                      <span>
                        <small>Expected time</small>
                        <b>{activeConv.expectedTime}</b>
                      </span>
                    </div>
                  </div>

                  {executionSummary && (
                    <div className="mos-success-box" style={{ marginTop: 10 }}>
                      {executionSummary}
                    </div>
                  )}

                  {progress === 0 && (
                    <div className="permission">
                      <b>Permission check</b>
                      <p>
                        Creates draft projects and calendar proposals only. Live publishing remains
                        disabled until explicit approval.
                      </p>
                    </div>
                  )}

                  {progress === 6 && (
                    <div className="result-links">
                      <button onClick={() => go("Content Pipeline")}>
                        Inspect Pipeline Drafts <span>→</span>
                      </button>
                      <button onClick={() => go("Content Calendar")}>
                        Inspect Calendar Drafts <span>→</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="chat-compose">
            <textarea
              placeholder={
                workspace.name
                  ? `Ask Marketing OS to plan a campaign or audit for ${workspace.name}…`
                  : "Ask Marketing OS to plan a campaign, audit positioning, or generate deliverables…"
              }
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <div>
              <span className="context-pill">
                {workspace.name || "Workspace"} · {systemRole}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn secondary"
                  disabled={chatLoading || !inputText.trim()}
                  onClick={() => void sendMessage()}
                >
                  {chatLoading ? "Thinking…" : "Plan with AI"}
                </button>
                <button
                  className="btn primary"
                  disabled={executing || activeConv.stages.length === 0}
                  onClick={() => void runPlan()}
                >
                  {executing ? "Running agents…" : "Execute plan ↑"}
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="run-panel">
          <CardTitle title="Execution" copy="Live activity" />
          <div className="run-stat">
            <span>{progress}/6</span>
            <small>stages complete</small>
            <div className="progress">
              <i style={{ width: `${(progress / 6) * 100}%` }} />
            </div>
          </div>
          <label>Running agents</label>
          {["Research", "Strategy", "Creative", "Quality"].map((x, i) => (
            <div className="agent-row" key={x}>
              <span
                className={executing && i === Math.min(3, Math.floor(progress / 1.5)) ? "live" : ""}
              />
              <b>{x} Agent</b>
              <small>{models.textModel}</small>
            </div>
          ))}
          <label>Safety controls</label>
          <div className="safety">
            <span>✓</span>
            <p>
              <b>Human approval enforced</b>
              <small>Publishing and spend require review.</small>
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

export function NotebookView({
  workspace,
  insights,
  versions,
  models,
  memories = [],
  onSaveMemory,
  onUpdateMemory,
  onDeleteMemory,
  go,
  onUpdateWorkspace,
  onUpdateInsights,
  onAddVersion,
  onConsumeCredits,
  notify,
}: {
  workspace: WorkspaceProfile;
  insights: NotebookSectionInsight[];
  versions: NotebookVersion[];
  models: ModelPreferences;
  memories?: AiMemoryItem[];
  onSaveMemory?: (payload: {
    scope: AiMemoryItem["scope"];
    source: AiMemoryItem["source"];
    approved?: boolean;
    title: string;
    content: string;
    tags?: string[];
  }) => Promise<unknown>;
  onUpdateMemory?: (id: string, patch: Partial<AiMemoryItem>) => Promise<unknown>;
  onDeleteMemory?: (id: string) => Promise<void>;
  go?: (p: Page) => void;
  onUpdateWorkspace: (patch: Partial<WorkspaceProfile>) => void;
  onUpdateInsights: (items: NotebookSectionInsight[]) => void;
  onAddVersion: (summary: string, sourceType: SourceType) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  notify: (s: string) => void;
}) {
  const sections = [
    "Business Profile",
    "AI Memory & Facts",
    "Brand Identity",
    "Products",
    "Target Audience",
    "Customer Personas",
    "Brand Voice",
    "Marketing Objectives",
    "SEO Strategy",
    "Content History",
    "Uploaded Assets",
  ];
  const [section, setSection] = useState("Business Profile");
  const [search, setSearch] = useState("");
  const [enriching, setEnriching] = useState(false);
  const [memScopeFilter, setMemScopeFilter] = useState<"all" | AiMemoryItem["scope"]>("all");
  const [newMemScope, setNewMemScope] = useState<AiMemoryItem["scope"]>("business");
  const [newMemSource, setNewMemSource] = useState<AiMemoryItem["source"]>("user_provided");
  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemContent, setNewMemContent] = useState("");
  const [memBusy, setMemBusy] = useState(false);

  const [name, setName] = useState(workspace.name);
  const [websiteUrl, setWebsiteUrl] = useState(workspace.websiteUrl);
  const [industry, setIndustry] = useState(workspace.industry);
  const [positioning, setPositioning] = useState(workspace.positioning);
  const [valueProp, setValueProp] = useState(workspace.valueProposition);
  const [markets, setMarkets] = useState(workspace.targetCountries);
  const [description, setDescription] = useState(workspace.description);
  const [brandVoiceNotes, setBrandVoiceNotes] = useState(workspace.brandVoiceNotes);
  const [wordsToUse, setWordsToUse] = useState(workspace.wordsToUse);
  const [wordsToAvoid, setWordsToAvoid] = useState(workspace.wordsToAvoid);
  const [sliders, setSliders] = useState<number[]>(workspace.voiceSliders || [50, 50, 50, 50]);
  const [editingInsightIdx, setEditingInsightIdx] = useState<number | null>(null);

  useEffect(() => {
    setName(workspace.name);
    setWebsiteUrl(workspace.websiteUrl);
    setIndustry(workspace.industry);
    setPositioning(workspace.positioning);
    setValueProp(workspace.valueProposition);
    setMarkets(workspace.targetCountries);
    setDescription(workspace.description);
    setBrandVoiceNotes(workspace.brandVoiceNotes);
    setWordsToUse(workspace.wordsToUse);
    setWordsToAvoid(workspace.wordsToAvoid);
    setSliders(workspace.voiceSliders || [50, 50, 50, 50]);
  }, [workspace]);

  const filteredSections = sections.filter((s) =>
    s.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const saveNotebook = () => {
    onUpdateWorkspace({
      name,
      websiteUrl,
      industry,
      positioning,
      valueProposition: valueProp,
      targetCountries: markets,
      description,
      brandVoiceNotes,
      wordsToUse,
      wordsToAvoid,
      voiceSliders: sliders,
    });
    onAddVersion(`Updated ${section} for ${name}`, "manual");
    notify("Business Notebook saved across all Marketing OS agents");
  };

  const reEnrichFromWeb = async () => {
    if (!websiteUrl.trim()) {
      notify("Enter a website URL first");
      return;
    }
    setEnriching(true);
    try {
      const res = await apiPost<{
        sourceType: SourceType;
        intelligence: {
          industry?: string;
          positioning?: string;
          valueProposition?: string;
          brandVoiceNotes?: string;
          wordsToUse?: string;
          wordsToAvoid?: string;
          customerNeed?: string;
          keyDifferentiator?: string;
          proofDirection?: string;
          businessSummary?: string;
        };
      }>("/api/analyze-website", {
        name,
        websiteUrl,
        industry,
        description,
        model: models.textModel,
      });
      const intel = res.intelligence || {};
      if (intel.industry) setIndustry(intel.industry);
      if (intel.positioning) setPositioning(intel.positioning);
      if (intel.valueProposition) setValueProp(intel.valueProposition);
      if (intel.brandVoiceNotes) setBrandVoiceNotes(intel.brandVoiceNotes);
      if (intel.wordsToUse) setWordsToUse(intel.wordsToUse);
      if (intel.wordsToAvoid) setWordsToAvoid(intel.wordsToAvoid);
      if (intel.businessSummary) setDescription(intel.businessSummary);

      const newInsights: NotebookSectionInsight[] = [
        { label: "Customer need", text: intel.customerNeed || insights[0]?.text || "" },
        { label: "Key differentiator", text: intel.keyDifferentiator || insights[1]?.text || "" },
        { label: "Proof direction", text: intel.proofDirection || insights[2]?.text || "" },
      ];
      onUpdateInsights(newInsights);
      onUpdateWorkspace({
        name,
        websiteUrl,
        industry: intel.industry || industry,
        positioning: intel.positioning || positioning,
        valueProposition: intel.valueProposition || valueProp,
        brandVoiceNotes: intel.brandVoiceNotes || brandVoiceNotes,
        wordsToUse: intel.wordsToUse || wordsToUse,
        wordsToAvoid: intel.wordsToAvoid || wordsToAvoid,
        description: intel.businessSummary || description,
      });
      onAddVersion(`Re-crawled & enriched from ${websiteUrl}`, res.sourceType);
      onConsumeCredits(60, "Website Crawl + Enrichment");
      notify(`Business Notebook enriched via ${res.sourceType === "live_crawl" ? "Live Website Crawl" : "Grounded Search"}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Website enrichment failed");
    } finally {
      setEnriching(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Shared business memory"
        title="Business Notebook"
        copy="One structured source of truth used by every Marketing OS agent."
        actions={
          <>
            <button className="btn secondary" disabled={enriching} onClick={() => void reEnrichFromWeb()}>
              {enriching ? "Crawling website…" : "↻ Enrich from URL"}
            </button>
            <button className="btn primary" onClick={saveNotebook}>
              Save changes
            </button>
          </>
        }
      />

      <div className="mos-mobile-pills">
        {sections.map((s) => (
          <button
            key={s}
            className={section === s ? "active" : ""}
            onClick={() => setSection(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="notebook-layout">
        <aside className="notebook-nav">
          <div className="knowledge-search">
            ⌕{" "}
            <input
              placeholder="Search knowledge…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {filteredSections.map((s) => (
            <button className={section === s ? "active" : ""} onClick={() => setSection(s)} key={s}>
              {s}
              <span>›</span>
            </button>
          ))}
        </aside>

        <section className="notebook-page card">
          {section === "AI Memory & Facts" ? (
            <>
              <div className="notebook-title">
                <div className="workspace-logo large">AI</div>
                <div>
                  <h2>Structured AI Memory ({memories.length})</h2>
                  <p>
                    Only approved memories are injected into AI Command Center and Content Studio prompts.
                  </p>
                </div>
                <span className="badge mint">
                  <i />
                  Provenance tracked
                </span>
              </div>

              <div className="tabs" style={{ marginTop: 14, marginBottom: 14 }}>
                {(["all", "user", "business", "project", "conversation"] as const).map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    className={memScopeFilter === sc ? "active" : ""}
                    onClick={() => setMemScopeFilter(sc)}
                  >
                    {sc === "all" ? "All Scopes" : sc.toUpperCase()}
                  </button>
                ))}
              </div>

              {onSaveMemory && (
                <div className="mos-subcard" style={{ marginBottom: 16 }}>
                  <b style={{ fontSize: 12 }}>Add Persistent Memory Rule</b>
                  <div className="form-grid" style={{ marginTop: 8 }}>
                    <label>
                      <span>Scope</span>
                      <select
                        value={newMemScope}
                        onChange={(e) => setNewMemScope(e.target.value as AiMemoryItem["scope"])}
                      >
                        <option value="business">Business</option>
                        <option value="user">User Preference</option>
                        <option value="project">Project</option>
                        <option value="conversation">Conversation</option>
                      </select>
                    </label>
                    <label>
                      <span>Provenance Source</span>
                      <select
                        value={newMemSource}
                        onChange={(e) => setNewMemSource(e.target.value as AiMemoryItem["source"])}
                      >
                        <option value="verified_business">Verified Business</option>
                        <option value="user_provided">User Provided</option>
                        <option value="external_research">External Research</option>
                        <option value="ai_assumption">AI Assumption</option>
                      </select>
                    </label>
                    <label className="wide">
                      <span>Title</span>
                      <input
                        placeholder="e.g. Primary Pricing & Free Trial Guarantee"
                        value={newMemTitle}
                        onChange={(e) => setNewMemTitle(e.target.value)}
                      />
                    </label>
                    <label className="wide">
                      <span>Fact / Instruction</span>
                      <textarea
                        rows={2}
                        placeholder="Exact verified fact or rule for every agent to honor…"
                        value={newMemContent}
                        onChange={(e) => setNewMemContent(e.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    style={{ marginTop: 10 }}
                    disabled={memBusy || !newMemTitle.trim() || !newMemContent.trim()}
                    onClick={async () => {
                      setMemBusy(true);
                      try {
                        await onSaveMemory({
                          scope: newMemScope,
                          source: newMemSource,
                          approved: true,
                          title: newMemTitle.trim(),
                          content: newMemContent.trim(),
                        });
                        setNewMemTitle("");
                        setNewMemContent("");
                        notify("Saved approved AI memory fact");
                      } catch (err) {
                        notify(err instanceof Error ? err.message : "Failed to save memory");
                      } finally {
                        setMemBusy(false);
                      }
                    }}
                  >
                    {memBusy ? "Saving…" : "＋ Save Approved Memory"}
                  </button>
                </div>
              )}

              <div className="mos-stack">
                {memories.filter((m) => memScopeFilter === "all" || m.scope === memScopeFilter).length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: 12 }}>
                    No AI memories stored for this filter yet.
                  </p>
                ) : (
                  memories
                    .filter((m) => memScopeFilter === "all" || m.scope === memScopeFilter)
                    .map((m) => (
                      <div key={m.id} className="mos-subcard">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div>
                            <b style={{ fontSize: 12 }}>{m.title}</b>
                            <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 8 }}>
                              [{m.scope}] · {m.source.replace(/_/g, " ")}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <span className={`badge ${m.approved ? "mint" : "review"}`}>
                              <i />
                              {m.approved ? "Approved" : "Needs Review"}
                            </span>
                            {onUpdateMemory && (
                              <button
                                type="button"
                                className="btn ghost"
                                style={{ height: 24, padding: "0 8px", fontSize: 10 }}
                                onClick={() => void onUpdateMemory(m.id, { approved: !m.approved })}
                              >
                                {m.approved ? "Pause" : "Approve"}
                              </button>
                            )}
                            {onDeleteMemory && (
                              <button
                                type="button"
                                className="btn ghost"
                                style={{ height: 24, padding: "0 8px", fontSize: 10, color: "#ff9c9c" }}
                                onClick={() => void onDeleteMemory(m.id)}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{m.content}</p>
                      </div>
                    ))
                )}
              </div>
            </>
          ) : section === "Uploaded Assets" ? (
            <>
              <div className="notebook-title">
                <div className="workspace-logo large">ML</div>
                <div>
                  <h2>Brand Assets &amp; Multimodal Vault</h2>
                  <p>Organize uploads across all 14 distinct asset categories for AI routing.</p>
                </div>
                {go && (
                  <button className="btn primary" onClick={() => go("Media Library")}>
                    Open Media Library →
                  </button>
                )}
              </div>
              <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 14 }}>
                Your Media Library keeps Product Demonstration Videos, Product Demonstration Images, Product Clips, Testimonials, Tutorials, Reference Viral Videos, and Brand Assets cleanly separated so the AI Video Editor and Content Studio use the right asset at every step.
              </p>
            </>
          ) : section === "Brand Voice" ? (
            <>
              <div className="notebook-title">
                <div className="workspace-logo large">Aa</div>
                <div>
                  <h2>Brand Voice</h2>
                  <p>Controls how every creative agent writes for {name}.</p>
                </div>
                <span className="badge mint">
                  <i />
                  Applied globally
                </span>
              </div>
              <div className="voice-spectrum">
                <h3>Voice characteristics</h3>
                {[
                  ["Encouraging", "Direct"],
                  ["Expert", "Approachable"],
                  ["Calm", "Energetic"],
                  ["Playful", "Serious"],
                ].map((pair, idx) => (
                  <div key={pair[0]}>
                    <span>{pair[0]}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={sliders[idx] ?? 50}
                      onChange={(e) => {
                        const next = [...sliders];
                        next[idx] = Number(e.target.value);
                        setSliders(next);
                      }}
                    />
                    <span>{pair[1]}</span>
                  </div>
                ))}
              </div>
              <div className="form-grid">
                <label className="wide">
                  <span>Writing style</span>
                  <textarea
                    value={brandVoiceNotes}
                    onChange={(e) => setBrandVoiceNotes(e.target.value)}
                  />
                </label>
                <label>
                  <span>Words we use</span>
                  <input value={wordsToUse} onChange={(e) => setWordsToUse(e.target.value)} />
                </label>
                <label>
                  <span>Words to avoid</span>
                  <input value={wordsToAvoid} onChange={(e) => setWordsToAvoid(e.target.value)} />
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="notebook-title">
                <div className="workspace-logo large">
                  {name.slice(0, 2).toUpperCase() || "MO"}
                </div>
                <div>
                  <h2>{section}</h2>
                  <p>Synchronized across Research, Strategy, Studio, and Ads</p>
                </div>
                <span className="badge mint">
                  <i />
                  Agent ready
                </span>
              </div>
              <div className="intel-banner">
                <span>✦</span>
                <span>
                  <b>Used by active Marketing OS agents</b>
                  <p>
                    This knowledge informs grounded research, copy, creative direction, and audience
                    simulation.
                  </p>
                </span>
              </div>

              <div className="form-grid">
                <label>
                  <span>Business name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  <span>Website URL</span>
                  <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
                </label>
                <label>
                  <span>Industry</span>
                  <input value={industry} onChange={(e) => setIndustry(e.target.value)} />
                </label>
                <label>
                  <span>Primary markets</span>
                  <input value={markets} onChange={(e) => setMarkets(e.target.value)} />
                </label>
                <label className="wide">
                  <span>Positioning</span>
                  <textarea value={positioning} onChange={(e) => setPositioning(e.target.value)} />
                </label>
                <label className="wide">
                  <span>Core value proposition</span>
                  <textarea value={valueProp} onChange={(e) => setValueProp(e.target.value)} />
                </label>
                <label className="wide">
                  <span>Business summary ({section})</span>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
              </div>

              <div className="insight-list">
                <h3>Structured intelligence</h3>
                {insights.length === 0 ? (
                  <p style={{ color: "var(--muted)", fontSize: 12 }}>
                    No structured intelligence extracted yet. Enter your Website URL above and click “↻ Enrich from URL”.
                  </p>
                ) : (
                  insights.map((ins, idx) => (
                    <div key={ins.label}>
                      <span>{ins.label}</span>
                      {editingInsightIdx === idx ? (
                        <input
                          style={{ flex: 1, padding: "6px 8px", borderRadius: 6 }}
                          value={ins.text}
                          onChange={(e) => {
                            const next = [...insights];
                            next[idx] = { ...next[idx], text: e.target.value };
                            onUpdateInsights(next);
                          }}
                          onBlur={() => setEditingInsightIdx(null)}
                          autoFocus
                        />
                      ) : (
                        <p>{ins.text}</p>
                      )}
                      <button onClick={() => setEditingInsightIdx(editingInsightIdx === idx ? null : idx)}>
                        ✎
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </section>

        <aside className="notebook-aside">
          <CardTitle title="Knowledge health" copy="Coverage across core areas" />
          {(() => {
            const brandCtxScore =
              (name.trim() ? 35 : 0) + (positioning.trim() ? 35 : 0) + (valueProp.trim() ? 30 : 0);
            const audienceScore =
              (markets.trim() ? 55 : 0) + (description.trim() ? 45 : 0);
            const productsScore = workspace.products.length > 0 ? 100 : websiteUrl.trim() ? 50 : 0;
            const voiceScore =
              (brandVoiceNotes.trim() ? 60 : 0) +
              (wordsToUse.trim() ? 20 : 0) +
              (wordsToAvoid.trim() ? 20 : 0);
            const overallHealth = Math.round(
              (brandCtxScore + audienceScore + productsScore + voiceScore) / 4,
            );
            return (
              <>
                <div className="health-ring">
                  <strong>
                    {overallHealth}
                    <small>%</small>
                  </strong>
                </div>
                {[
                  ["Brand context", brandCtxScore],
                  ["Audience", audienceScore],
                  ["Products", productsScore],
                  ["Brand voice", voiceScore],
                ].map((x) => (
                  <div className="health-row" key={x[0] as string}>
                    <span>
                      {x[0]}
                      <b>{x[1]}%</b>
                    </span>
                    <div>
                      <i style={{ width: `${x[1]}%` }} />
                    </div>
                  </div>
                ))}
              </>
            );
          })()}
          <div style={{ marginTop: 18 }}>
            <b style={{ fontSize: 12, display: "block", marginBottom: 8 }}>Version history</b>
            {versions.length === 0 ? (
              <span style={{ color: "var(--muted)", fontSize: 11 }}>No revisions saved yet.</span>
            ) : (
              versions.slice(0, 4).map((v) => (
                <div
                  key={v.id}
                  style={{
                    fontSize: 11,
                    padding: "6px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <b>{v.timestamp}</b>
                    <SourceBadge sourceType={v.sourceType} />
                  </div>
                  <span style={{ color: "var(--muted)" }}>{v.summary}</span>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

export function MarketingStrategyView({
  workspace,
  strategy,
  strategies = [],
  models,
  modelCatalog,
  onSelectTextModel,
  onUpdateStrategy,
  onSaveStrategy,
  onDeleteStrategy,
  onGenerateCalendar,
  onUpsertProject,
  onAddProjects,
  onConsumeCredits,
  onOpenWorkspaceHub,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  strategy: StrategyPlan | null;
  strategies?: SavedStrategy[];
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  onSelectTextModel: (id: string) => void;
  onUpdateStrategy: (s: StrategyPlan) => void;
  onSaveStrategy?: (s: StrategyPlan, status?: "draft" | "active" | "archived") => Promise<SavedStrategy>;
  onDeleteStrategy?: (id: string) => Promise<void>;
  onGenerateCalendar?: (strategyId: string, count?: number) => Promise<CalendarPost[]>;
  onUpsertProject?: (proj: Partial<ContentProject> & { title: string }) => Promise<ContentProject>;
  onAddProjects: (items: ContentProject[]) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  onOpenWorkspaceHub: () => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState("");
  const [loading, setLoading] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<StrategyFeedbackComparison | null>(null);

  useEffect(() => {
    void apiGet<{ feedback: StrategyFeedbackComparison | null }>("/api/growth/strategy-feedback")
      .then((res) => setFeedback(res.feedback || null))
      .catch(() => {});
  }, [strategy?.id]);

  const generateStrategy = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await apiPost<StrategyPlan>("/api/strategy/generate", {
        business: workspace,
        goal: goal.trim() || "Grow qualified customer acquisition and organic reach over 30 days",
        budget: budget.trim() || "Flexible monthly marketing budget",
        model: models.textModel,
      });
      const built: StrategyPlan = {
        ...res,
        id: `strat-${Date.now()}`,
        sourceType: "ai_grounded",
      };
      if (onSaveStrategy) {
        const saved = await onSaveStrategy(built, "active");
        onUpdateStrategy(saved);
      } else {
        onUpdateStrategy(built);
      }
      onConsumeCredits(90, `Marketing Strategy (${models.textModel})`);
      notify("Marketing Strategy generated & saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate strategy");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCurrent = async (status: "draft" | "active" | "archived" = "active") => {
    if (!strategy || !onSaveStrategy) return;
    try {
      const saved = await onSaveStrategy(strategy, status);
      onUpdateStrategy(saved);
      notify(`Saved strategy "${saved.title}" (${status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save strategy");
    }
  };

  const handleGenerateCalendar = async () => {
    if (!strategy || !onGenerateCalendar) return;
    setError("");
    setCalendarBusy(true);
    try {
      let targetId = strategy.id;
      if (onSaveStrategy && !strategies.some((s) => s.id === strategy.id)) {
        const saved = await onSaveStrategy(strategy, "active");
        targetId = saved.id;
        onUpdateStrategy(saved);
      }
      const entries = await onGenerateCalendar(targetId, 6);
      notify(`Generated ${entries.length} scheduled deliverables in Content Calendar`);
      go("Content Calendar");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate Content Calendar from strategy");
    } finally {
      setCalendarBusy(false);
    }
  };

  const pushToPipeline = async () => {
    if (!strategy) return;
    setProjectBusy(true);
    try {
      if (onUpsertProject) {
        for (const p of strategy.contentPillars) {
          await onUpsertProject({
            title: p.exampleHook.slice(0, 64),
            platform: strategy.icpSegments[0]?.channels[0] || "Instagram Reels",
            status: "SCRIPT_PENDING",
            stage: "Script",
            strategyId: strategy.id,
            brief: `${p.pillar} (${p.format}): ${p.exampleHook}`,
            hook: p.exampleHook,
            owner: "Strategy Agent",
            sourceType: strategy.sourceType,
          });
        }
        notify(`Created ${strategy.contentPillars.length} Content Projects in Script Studio queue`);
        go("Content Studio");
      } else {
        const newProjects: ContentProject[] = strategy.contentPillars.map((p, idx) => ({
          id: `strat-proj-${Date.now()}-${idx}`,
          title: p.exampleHook.slice(0, 48),
          platform: strategy.icpSegments[0]?.channels[0] || "Instagram",
          stage: "Script",
          status: "SCRIPT_PENDING",
          owner: "Strategy Agent",
          progress: 20,
          creditsUsed: 0,
          hook: p.exampleHook,
          script: "",
          sourceType: strategy.sourceType,
        }));
        onAddProjects(newProjects);
        notify(`Added ${newProjects.length} strategic content projects to Pipeline`);
        go("Content Pipeline");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create content projects");
    } finally {
      setProjectBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Strategic planning"
        title="Marketing Strategy"
        copy="Turn your Business Notebook and research into a coherent multi-channel growth plan."
        actions={
          <>
            <ModelSelector
              label="Model"
              value={models.textModel}
              options={modelCatalog.text}
              onChange={onSelectTextModel}
              compact
            />
            <button className="btn secondary" onClick={onOpenWorkspaceHub}>
              Export to Docs
            </button>
            <button className="btn primary" disabled={loading} onClick={() => void generateStrategy()}>
              {loading ? "Generating strategy…" : "✦ Generate AI Strategy"}
            </button>
          </>
        }
      />

      {error && <div className="mos-error-box">{error}</div>}

      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div className="form-grid">
          <label>
            <span>Primary growth objective</span>
            <input
              placeholder="e.g. Increase qualified trial signups & organic reach over 30 days"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>
          <label>
            <span>Monthly budget / production capacity</span>
            <input
              placeholder="e.g. $500/mo or 3 short videos/week"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>
        </div>
      </div>

      {feedback && (
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <span className={`badge ${feedback.goalAlignmentStatus === "aligned_data_available" ? "mint" : feedback.goalAlignmentStatus === "partial_data" ? "blue" : "review"}`}>
                <i />
                Growth Feedback · {feedback.goalAlignmentStatus.replace(/_/g, " ")}
              </span>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{feedback.summary}</p>
            </div>
            <button type="button" className="btn secondary" onClick={() => go("Growth Intelligence")}>
              Open Growth Intelligence →
            </button>
          </div>
        </div>
      )}

      {strategies.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <b style={{ fontSize: 12 }}>Saved Strategies ({strategies.length})</b>
            {strategy && onSaveStrategy && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="btn secondary" style={{ height: 28, padding: "0 10px", fontSize: 11 }} onClick={() => void handleSaveCurrent("active")}>
                  Save Active
                </button>
                <button type="button" className="btn ghost" style={{ height: 28, padding: "0 10px", fontSize: 11 }} onClick={() => void handleSaveCurrent("archived")}>
                  Archive
                </button>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {strategies.map((s) => (
              <div key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: strategy?.id === s.id ? "1px solid var(--mint)" : "1px solid var(--border)", borderRadius: 8, padding: "4px 8px", background: "var(--surface2)" }}>
                <button
                  type="button"
                  className="text-button"
                  style={{ fontSize: 11, fontWeight: strategy?.id === s.id ? 700 : 500, color: strategy?.id === s.id ? "var(--mint)" : "var(--text)" }}
                  onClick={() => onUpdateStrategy(s)}
                >
                  {s.title} <small>({s.status})</small>
                </button>
                {onDeleteStrategy && (
                  <button
                    type="button"
                    className="text-button"
                    style={{ fontSize: 11, color: "#ff9c9c" }}
                    title="Delete strategy"
                    onClick={() => void onDeleteStrategy(s.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!strategy ? (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <span className="badge blue">
            <i />
            Ready to generate
          </span>
          <h2 style={{ marginTop: 10 }}>No marketing strategy generated yet</h2>
          <p style={{ color: "var(--muted)", marginTop: 6, maxWidth: 520, marginInline: "auto" }}>
            Enter your target objective and budget above, then click “Generate AI Strategy” to build ICP segments, content pillars, a weekly roadmap, and experiments.
          </p>
          <button
            className="btn primary"
            style={{ marginTop: 16 }}
            disabled={loading}
            onClick={() => void generateStrategy()}
          >
            {loading ? "Generating strategy…" : "✦ Generate AI Strategy"}
          </button>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 20, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <SourceBadge sourceType={strategy.sourceType} />
                <h2 style={{ marginTop: 8 }}>{strategy.title}</h2>
                <p style={{ color: "var(--muted)", marginTop: 6 }}>{strategy.executiveSummary}</p>
              </div>
              <div style={{ background: "var(--surface2)", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)" }}>
                <small style={{ color: "var(--muted)", display: "block" }}>North Star Metric</small>
                <b>{strategy.northStarMetric}</b>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              {onGenerateCalendar && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={calendarBusy}
                  onClick={() => void handleGenerateCalendar()}
                >
                  {calendarBusy ? "Generating Calendar…" : "✦ Generate Content Calendar →"}
                </button>
              )}
              <button
                type="button"
                className="btn secondary"
                disabled={projectBusy}
                onClick={() => void pushToPipeline()}
              >
                {projectBusy ? "Creating Projects…" : "Create Content Projects (Script Stage) →"}
              </button>
            </div>
          </div>

          <div className="dashboard-grid">
            <section className="card" style={{ padding: 18 }}>
              <CardTitle title="Ideal Customer Segments" copy="Targeting & messaging angles" />
              <div className="mos-stack">
                {strategy.icpSegments.map((seg) => (
                  <div key={seg.name} className="mos-subcard">
                    <b>{seg.name}</b>
                    <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>Pain: {seg.painPoint}</p>
                    <p style={{ color: "var(--mint)", fontSize: 12, marginTop: 4 }}>Hook: “{seg.hookAngle}”</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="card" style={{ padding: 18 }}>
              <CardTitle title="Content Pillars" copy="Format allocation" />
              <div className="mos-stack">
                {strategy.contentPillars.map((p) => (
                  <div key={p.pillar} className="mos-subcard">
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <b>{p.pillar}</b>
                      <span className="badge mint">
                        <i />
                        {p.ratio}
                      </span>
                    </div>
                    <small style={{ color: "var(--muted)" }}>{p.format}</small>
                    <p style={{ fontSize: 12, marginTop: 4 }}>“{p.exampleHook}”</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="card" style={{ padding: 18 }}>
              <CardTitle title="Execution Roadmap" copy="Phased deliverables" />
              <div className="mos-stack">
                {strategy.weeklyRoadmap.map((w) => (
                  <div key={w.week} className="mos-subcard">
                    <b>
                      {w.week} · {w.focus}
                    </b>
                    <ul style={{ margin: "6px 0 0 18px", color: "var(--muted)", fontSize: 12 }}>
                      {w.deliverables.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            <section className="card" style={{ padding: 18 }}>
              <CardTitle title="Growth Experiments" copy="Hypothesis-driven tests" />
              <div className="mos-stack">
                {strategy.experiments.map((exp) => (
                  <div key={exp.name} className="mos-subcard">
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <b>{exp.name}</b>
                      <span className="badge blue">
                        <i />
                        {exp.effort} effort
                      </span>
                    </div>
                    <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{exp.hypothesis}</p>
                    <small style={{ color: "var(--mint)" }}>Measure: {exp.metric}</small>
                  </div>
                ))}
              </div>
              <button className="btn primary" style={{ marginTop: 14 }} disabled={projectBusy} onClick={() => void pushToPipeline()}>
                {projectBusy ? "Creating Projects…" : "Create Content Projects from Pillars →"}
              </button>
            </section>
          </div>
        </>
      )}
    </>
  );
}

export function CompetitorsView({
  workspace,
  competitors,
  models,
  modelCatalog,
  onSelectTextModel,
  onUpdateCompetitors,
  onConsumeCredits,
  onOpenWorkspaceHub,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  competitors: CompetitorItem[];
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  onSelectTextModel: (id: string) => void;
  onUpdateCompetitors: (items: CompetitorItem[]) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  onOpenWorkspaceHub: () => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<"All" | "Direct" | "Indirect">("All");
  const [search, setSearch] = useState("");
  const [market, setMarket] = useState("Global");
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Array<{ title: string; url: string }>>([]);
  const [opportunity, setOpportunity] = useState<{
    headline: string;
    summary: string;
    score: number;
  } | null>(null);

  const filtered = competitors.filter((c) => {
    if (tab !== "All" && c.category !== tab) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.positioning.toLowerCase().includes(q) ||
        c.strength.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const active = filtered[selected] || filtered[0] || competitors[0];

  const discover = async () => {
    setLoading(true);
    try {
      const res = await apiPost<{
        competitors: Array<Omit<CompetitorItem, "id" | "sourceType">>;
        positioningOpportunity?: { headline: string; summary: string; score: number };
        sources?: Array<{ title: string; url: string }>;
      }>("/api/research/competitors", {
        business: workspace,
        market,
        focusQuery: search,
        model: models.textModel,
      });
      if (res.competitors?.length) {
        onUpdateCompetitors(
          res.competitors.map((c, idx) => ({
            ...c,
            id: `comp-ai-${Date.now()}-${idx}`,
            sourceType: "ai_grounded",
          })),
        );
        setSelected(0);
      }
      if (res.positioningOpportunity) setOpportunity(res.positioningOpportunity);
      if (res.sources) setSources(res.sources);
      onConsumeCredits(70, `Grounded Competitor Scan (${models.textModel})`);
      notify(`Discovered ${res.competitors?.length || 0} grounded competitors`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Competitor research failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Market intelligence"
        title="Competitive landscape"
        copy={`Evidence-backed positioning, content, and keyword intelligence for ${workspace.name}.`}
        actions={
          <>
            <ModelSelector
              label="Model"
              value={models.textModel}
              options={modelCatalog.text}
              onChange={onSelectTextModel}
              compact
            />
            <button className="btn secondary" onClick={onOpenWorkspaceHub}>
              Export to Sheets
            </button>
            <button className="btn primary" disabled={loading} onClick={() => void discover()}>
              {loading ? "Searching web…" : "＋ Discover competitors"}
            </button>
          </>
        }
      />

      <div className="toolbar">
        <div className="tabs">
          {(["All", "Direct", "Indirect"] as const).map((t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => {
                setTab(t);
                setSelected(0);
              }}
            >
              {t === "All" ? "All competitors" : t}{" "}
              <span>
                {t === "All"
                  ? competitors.length
                  : competitors.filter((c) => c.category === t).length}
              </span>
            </button>
          ))}
        </div>
        <div className="filter">
          ⌕{" "}
          <input
            style={{ background: "none", border: 0, color: "inherit", outline: 0, width: 150 }}
            placeholder="Search competitors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="filter"
          value={market}
          onChange={(e) => setMarket(e.target.value)}
        >
          <option value="Global">Market: Global</option>
          <option value="USA">Market: USA</option>
          <option value="UK">Market: UK</option>
          <option value="Europe">Market: Europe</option>
        </select>
      </div>

      {!active ? (
        <div className="card" style={{ padding: 32, textAlign: "center", marginTop: 14 }}>
          <span className="badge blue">
            <i />
            Google Search Grounded
          </span>
          <h2 style={{ marginTop: 10 }}>No competitors tracked yet</h2>
          <p style={{ color: "var(--muted)", marginTop: 6, maxWidth: 500, marginInline: "auto" }}>
            Run live Google-grounded competitor discovery for {workspace.name || "your business"} to analyze direct and indirect positioning gaps.
          </p>
          <button
            className="btn primary"
            style={{ marginTop: 16 }}
            disabled={loading}
            onClick={() => void discover()}
          >
            {loading ? "Searching web…" : "＋ Discover competitors"}
          </button>
        </div>
      ) : (
        <div className="competitor-layout">
          <div className="competitor-table card">
            <div className="table-head">
              <span>Company</span>
              <span>Positioning</span>
              <span>Audience signal</span>
              <span>Opportunity score</span>
            </div>
            {filtered.map((c, i) => (
              <div
                role="button"
                tabIndex={0}
                className={`comp-row ${active.id === c.id ? "selected" : ""}`}
                onClick={() => setSelected(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(i);
                  }
                }}
                key={c.id}
              >
                <div className="comp-company-cell">
                  <span className={`comp-logo c${i % 4}`}>{c.name[0]}</span>
                  <div className="comp-company-meta">
                    <b>{c.name}</b>
                    <small>{c.category}</small>
                  </div>
                </div>
                <span className="comp-text-cell">{c.positioning}</span>
                <span className="comp-text-cell">{c.estimatedAudience}</span>
                <span className="comp-score-cell">
                  {c.opportunityScore ? (
                    <>
                      <b>{c.opportunityScore}</b>/100
                    </>
                  ) : (
                    "Pending"
                  )}
                </span>
              </div>
            ))}
          </div>

          <aside className="competitor-detail card">
            <div className="detail-head">
              <div className={`comp-logo c${selected % 4}`}>{active.name[0]}</div>
              <div>
                <h3>{active.name}</h3>
                <span>{active.category} competitor</span>
              </div>
              <SourceBadge sourceType={active.sourceType} />
            </div>
            <div className="positioning">
              <span>POSITIONING</span>
              <p>{active.positioning}</p>
            </div>
            <div className="sw-grid">
              <div>
                <small>Key strength</small>
                <b>{active.strength}</b>
              </div>
              <div>
                <small>Key weakness</small>
                <b>{active.weakness}</b>
              </div>
            </div>
            <h4>Content strategy</h4>
            {(active.contentPillars || []).map((x, i) => (
              <div className="strategy-row" key={x.title}>
                <span>{i + 1}</span>
                <b>{x.title}</b>
                <small>{x.share}%</small>
              </div>
            ))}
            <button className="btn primary" onClick={() => go("Trending Content")}>
              Explore content formats →
            </button>
          </aside>
        </div>
      )}

      {opportunity && (
        <div className="opportunity-strip">
          <span>✦</span>
          <div>
            <span className="badge mint">
              <i />
              Positioning opportunity
            </span>
            <h3>{opportunity.headline}</h3>
            <p>{opportunity.summary}</p>
          </div>
          <div className="op-score">
            <strong>{opportunity.score}</strong>
            <span>
              opportunity
              <br />
              score
            </span>
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <div className="demo-note">
          Grounded Search Sources:{" "}
          {sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--mint)", marginRight: 12 }}
            >
              {s.title} ↗
            </a>
          ))}
        </div>
      )}
    </>
  );
}

export function InfluencersView({
  workspace,
  influencers,
  models,
  modelCatalog,
  onSelectTextModel,
  onUpdateInfluencers,
  onConsumeCredits,
  onOpenWorkspaceHub,
  notify,
}: {
  workspace: WorkspaceProfile;
  influencers: InfluencerItem[];
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  onSelectTextModel: (id: string) => void;
  onUpdateInfluencers: (items: InfluencerItem[]) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  onOpenWorkspaceHub: () => void;
  notify: (s: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("All");
  const [onlySaved, setOnlySaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Array<{ title: string; url: string }>>([]);

  const [channelUrl, setChannelUrl] = useState("");
  const [channelHandle, setChannelHandle] = useState("");
  const [channelPlatform, setChannelPlatform] = useState("Instagram");
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelReport, setChannelReport] = useState<ChannelAnalysisResult | null>(null);

  const analyzeChannel = async () => {
    if (!channelUrl.trim() && !channelHandle.trim()) {
      notify("Enter a public creator URL or @handle to analyze");
      return;
    }
    setChannelBusy(true);
    try {
      const res = await apiPost<ChannelAnalysisResult>("/api/intelligence/channel", {
        channelUrl: channelUrl.trim() || undefined,
        handle: channelHandle.trim() || undefined,
        platform: channelPlatform,
        business: workspace,
        model: models.textModel,
      });
      setChannelReport(res);
      onConsumeCredits(55, `Creator Channel Intelligence (${channelHandle || channelUrl})`);
      notify(`Analyzed ${res.creatorName || channelHandle || "creator channel"}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Channel analysis failed");
    } finally {
      setChannelBusy(false);
    }
  };

  const filtered = influencers.filter((c) => {
    if (onlySaved && !c.saved) return false;
    if (platform !== "All" && c.platform !== platform) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.handle.toLowerCase().includes(q) ||
        c.niche.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const discoverCreators = async () => {
    setLoading(true);
    try {
      const res = await apiPost<{
        creators: Array<{
          name: string;
          handle: string;
          platform: string;
          niche: string;
          followers: string;
          engagement: string;
          brandFit: number;
          whyFit?: string;
          profileUrl?: string;
          avatarUrl?: string;
        }>;
        sources?: Array<{ title: string; url: string }>;
      }>("/api/research/influencers", {
        business: workspace,
        platform,
        nicheQuery: search,
        model: models.textModel,
      });

      if (res.creators?.length) {
        onUpdateInfluencers(
          res.creators.map((c, idx) => ({
            id: `inf-ai-${Date.now()}-${idx}`,
            name: c.name,
            handle: c.handle,
            platform: c.platform || "Instagram",
            niche: c.niche,
            followers: c.followers,
            engagement: c.engagement,
            brandFit: c.brandFit || 88,
            avatarUrl: c.avatarUrl && /^https?:\/\//i.test(c.avatarUrl) ? c.avatarUrl : "",
            whyFit: c.whyFit,
            profileUrl: c.profileUrl,
            saved: false,
            sourceType: "ai_grounded" as const,
          })),
        );
      }
      if (res.sources) setSources(res.sources);
      onConsumeCredits(65, `Creator Discovery (${models.textModel})`);
      notify(`Discovered ${res.creators?.length || 0} grounded creators`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Creator discovery failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Creator intelligence"
        title="Influencer discovery"
        copy={`Find creators whose audience, voice, and formats align with ${workspace.name}.`}
        actions={
          <>
            <ModelSelector
              label="Model"
              value={models.textModel}
              options={modelCatalog.text}
              onChange={onSelectTextModel}
              compact
            />
            <button className="btn secondary" onClick={() => setOnlySaved(!onlySaved)}>
              Shortlist ({influencers.filter((c) => c.saved).length})
            </button>
            <button className="btn primary" disabled={loading} onClick={() => void discoverCreators()}>
              {loading ? "Searching creators…" : "✦ Discover creators"}
            </button>
          </>
        }
      />

      <div className="toolbar">
        <div className="filter wide">
          ⌕{" "}
          <input
            style={{ background: "none", border: 0, color: "inherit", outline: 0, width: "100%" }}
            placeholder="Search creator, niche, or topic…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="filter" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="All">Platform: All</option>
          <option value="Instagram">Instagram</option>
          <option value="TikTok">TikTok</option>
          <option value="YouTube">YouTube</option>
          <option value="LinkedIn">LinkedIn</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: "center", marginTop: 14 }}>
          <span className="badge blue">
            <i />
            Google Search Grounded
          </span>
          <h2 style={{ marginTop: 10 }}>No creators discovered yet</h2>
          <p style={{ color: "var(--muted)", marginTop: 6, maxWidth: 500, marginInline: "auto" }}>
            Click “Discover creators” to search Google for real content creators aligned with {workspace.name || "your niche"}.
          </p>
          <button
            className="btn primary"
            style={{ marginTop: 16 }}
            disabled={loading}
            onClick={() => void discoverCreators()}
          >
            {loading ? "Searching creators…" : "✦ Discover creators"}
          </button>
        </div>
      ) : (
        <div className="creator-grid">
          {filtered.map((c) => (
            <article className="creator-card card" key={c.id}>
              <div className="creator-img">
                {c.avatarUrl ? (
                  <img
                    src={c.avatarUrl}
                    alt=""
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div style={{ display: "grid", placeItems: "center", height: "100%", fontWeight: 700 }}>
                    {(c.name || "?").slice(0, 1)}
                  </div>
                )}
                <span className="badge dark">
                  <i />
                  {c.platform}
                </span>
                <button
                  className={c.saved ? "saved" : ""}
                  onClick={() => {
                    onUpdateInfluencers(
                      influencers.map((item) =>
                        item.id === c.id ? { ...item, saved: !item.saved } : item,
                      ),
                    );
                    notify(c.saved ? "Removed from shortlist" : "Creator saved to shortlist");
                  }}
                >
                  {c.saved ? "♥" : "♡"}
                </button>
              </div>
              <div className="creator-info">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                  <h3>{c.name}</h3>
                  <SourceBadge sourceType={c.sourceType} />
                </div>
                <p>
                  {c.handle} · {c.niche}
                </p>
                {c.whyFit && (
                  <small style={{ color: "var(--muted)", display: "block", marginBottom: 8 }}>
                    {c.whyFit}
                  </small>
                )}
                <div>
                  <span>
                    <b>{c.followers}</b>
                    <small>followers</small>
                  </span>
                  <span>
                    <b>{c.engagement}</b>
                    <small>engagement</small>
                  </span>
                  <span>
                    <b>{c.brandFit}</b>
                    <small>brand fit</small>
                  </span>
                </div>
                <button className="btn secondary" onClick={onOpenWorkspaceHub}>
                  Outreach via Gmail →
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <div className="demo-note">
          Grounded via Google Search. Verify current channel metrics before contracting.
        </div>
      )}

      <section className="card" style={{ padding: 18, marginTop: 18 }}>
        <CardTitle
          title="Creator Channel Analyzer · Facts vs Hypotheses"
          copy="Analyze any public creator profile URL or handle with strict separation between observed public facts and strategic AI hypotheses."
        />
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label>
            <span>Public Channel URL</span>
            <input
              placeholder="https://youtube.com/@creator or https://instagram.com/handle"
              value={channelUrl}
              onChange={(e) => setChannelUrl(e.target.value)}
            />
          </label>
          <label>
            <span>Creator @handle</span>
            <input
              placeholder="@creator"
              value={channelHandle}
              onChange={(e) => setChannelHandle(e.target.value)}
            />
          </label>
          <label>
            <span>Platform</span>
            <select value={channelPlatform} onChange={(e) => setChannelPlatform(e.target.value)}>
              <option value="Instagram">Instagram</option>
              <option value="TikTok">TikTok</option>
              <option value="YouTube">YouTube</option>
              <option value="LinkedIn">LinkedIn</option>
            </select>
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              className="btn primary"
              type="button"
              disabled={channelBusy}
              onClick={() => void analyzeChannel()}
            >
              {channelBusy ? "Analyzing channel…" : "✦ Analyze Creator Channel"}
            </button>
          </div>
        </div>

        {channelReport && (
          <div className="mos-stack" style={{ marginTop: 16 }}>
            <div className="mos-subcard">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <b>
                  {channelReport.creatorName} ({channelReport.handle}) · {channelReport.platform}
                </b>
                <span className="badge blue">
                  <i />
                  {channelReport.niche}
                </span>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{channelReport.positioningSummary}</p>
              <small style={{ color: "var(--mint)", display: "block", marginTop: 4 }}>
                Posting cadence &amp; CTA style: {channelReport.postingPatterns} · {channelReport.ctaStyle}
              </small>
            </div>

            <div className="dashboard-grid">
              <div className="mos-subcard">
                <b style={{ fontSize: 12, color: "var(--mint)" }}>✓ Observed Public Facts</b>
                <ul style={{ margin: "6px 0 0 18px", fontSize: 12, color: "var(--muted)" }}>
                  {(channelReport.observedFacts || []).map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
              <div className="mos-subcard">
                <b style={{ fontSize: 12, color: "var(--gold)" }}>◈ AI Hypotheses (Inferred)</b>
                <ul style={{ margin: "6px 0 0 18px", fontSize: 12, color: "var(--muted)" }}>
                  {(channelReport.aiHypotheses || []).map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mos-subcard">
              <b style={{ fontSize: 12 }}>Adaptation Ideas for {workspace.name || "Your Brand"}</b>
              <ul style={{ margin: "6px 0 0 18px", fontSize: 12, color: "var(--muted)" }}>
                {(channelReport.brandAdaptationIdeas || []).map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

export function TrendsView({
  workspace,
  trends,
  models,
  modelCatalog,
  mediaAssets = [],
  onCreateProject,
  onSetActiveScript,
  onLoadInVideoEditor,
  onSelectTextModel,
  onUpdateTrends,
  onConsumeCredits,
  onUseBlueprint,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  trends: TrendFormatItem[];
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  mediaAssets?: MediaAsset[];
  onCreateProject?: (proj: Partial<ContentProject> & { title: string }) => Promise<ContentProject>;
  onSetActiveScript?: (title: string, script: string) => void;
  onLoadInVideoEditor?: (breakdownId: string) => void;
  onSelectTextModel: (id: string) => void;
  onUpdateTrends: (items: TrendFormatItem[]) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  onUseBlueprint: (t: TrendFormatItem) => void;
  go?: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);

  const [refUrl, setRefUrl] = useState("");
  const [refMediaId, setRefMediaId] = useState("");
  const [refPlatform, setRefPlatform] = useState("TikTok");
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoBreakdown, setVideoBreakdown] = useState<VideoBreakdownItem | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [methodReport, setMethodReport] = useState<{
    reportTitle?: string;
    coreThesis?: string;
    repeatableHooks?: string[];
    structuralFormula?: string[];
    visualAndEditingChecklist?: string[];
    brandAdaptationAngles?: string[];
  } | null>(null);

  const videoAssets = mediaAssets.filter((m) => m.kind === "video");

  const analyzeVideoPattern = async () => {
    if (!refUrl.trim() && !refMediaId) {
      notify("Select a Media Library video or enter a public video URL");
      return;
    }
    setVideoBusy(true);
    try {
      const res = await apiPost<{ breakdown: VideoBreakdownItem }>("/api/intelligence/video", {
        videoUrl: refUrl.trim() || undefined,
        mediaId: refMediaId || undefined,
        platform: refPlatform,
        business: workspace,
        model: models.textModel,
      });
      if (res.breakdown) {
        setVideoBreakdown(res.breakdown);
        onConsumeCredits(75, `Viral Video Pattern Breakdown`);
        notify(`Saved timestamped breakdown: ${res.breakdown.title}`);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Video breakdown failed");
    } finally {
      setVideoBusy(false);
    }
  };

  const generateMethodReport = async () => {
    setReportBusy(true);
    try {
      const res = await apiPost<{ report: NonNullable<typeof methodReport> }>(
        "/api/intelligence/creator-report",
        {
          creatorName: videoBreakdown?.creatorHandle || workspace.name || "Creator Study",
          breakdownIds: videoBreakdown ? [videoBreakdown.id] : [],
          business: workspace,
          model: models.textModel,
        },
      );
      if (res.report) {
        setMethodReport(res.report);
        onConsumeCredits(55, "Repeatable Creator Method Playbook");
        notify("Generated Repeatable Creator Method Playbook");
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to synthesize playbook");
    } finally {
      setReportBusy(false);
    }
  };

  const selected = trends.find((t) => t.id === selectedId) || null;

  const discoverTrends = async () => {
    setLoading(true);
    try {
      const res = await apiPost<{
        trends: Array<{
          title: string;
          patternName: string;
          platform: string;
          duration: string;
          whyItFits: string;
          signalSummary: string;
          sourceUrl?: string;
          thumbUrl?: string;
          timeline: { time: string; beat: string; text: string }[];
          productionNotes: string[];
        }>;
      }>("/api/research/trends", {
        business: workspace,
        topic: topic || workspace.industry,
        model: models.textModel,
      });

      if (res.trends?.length) {
        onUpdateTrends(
          res.trends.map((t, idx) => ({
            id: `trend-ai-${Date.now()}-${idx}`,
            title: t.title,
            patternName: t.patternName,
            platform: t.platform || "TikTok",
            duration: t.duration || "28s",
            viewsLabel: t.signalSummary || "Source-backed format",
            engagementLabel: t.sourceUrl ? "Source linked" : "No public image",
            thumbUrl: t.thumbUrl && /^https?:\/\//i.test(t.thumbUrl) ? t.thumbUrl : "",
            whyItFits: t.whyItFits,
            timeline: t.timeline || [],
            productionNotes: t.productionNotes || [],
            sourceType: "ai_grounded" as const,
          })),
        );
      }
      onConsumeCredits(60, `Trending Format Discovery (${models.textModel})`);
      notify(`Discovered ${res.trends?.length || 0} grounded content blueprints`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Trend discovery failed");
    } finally {
      setLoading(false);
    }
  };

  if (selected) {
    return (
      <>
        <button className="back-link" onClick={() => setSelectedId(null)}>
          ← Back to trending content
        </button>
        <div className="trend-detail">
          <section className="phone-video">
            {selected.thumbUrl ? (
              <img src={selected.thumbUrl} alt="" />
            ) : (
              <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 16, textAlign: "center" }}>
                <b>{selected.platform}</b>
              </div>
            )}
            <div className="video-overlay">
              <SourceBadge sourceType={selected.sourceType} />
              <button type="button">▶</button>
              <h3>{selected.title}</h3>
            </div>
          </section>
          <section>
            <PageHeader
              eyebrow="Format analysis"
              title={selected.patternName}
              copy={selected.whyItFits}
            />
            <div className="detail-stats">
              <span>
                <b>{selected.duration}</b>
                <small>duration</small>
              </span>
              <span>
                <b>{selected.platform}</b>
                <small>platform</small>
              </span>
              <span>
                <b>{selected.viewsLabel}</b>
                <small>signal</small>
              </span>
            </div>
            <div className="format-timeline">
              {selected.timeline.map((x) => (
                <div key={x.time + x.beat}>
                  <span>{x.time}</span>
                  <b>{x.beat}</b>
                  <p>{x.text}</p>
                </div>
              ))}
            </div>
            <div className="analysis-tags">
              {selected.productionNotes.map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button className="btn primary" onClick={() => onUseBlueprint(selected)}>
                Create Script Idea in Studio <span>→</span>
              </button>
              {onCreateProject && (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    void onCreateProject({
                      title: selected.title,
                      platform: selected.platform,
                      status: "SCRIPT_PENDING",
                      stage: "Script",
                      brief: `${selected.patternName}: ${selected.whyItFits}`,
                      hook: selected.timeline[0]?.text || selected.title,
                      sourceType: selected.sourceType,
                    }).then(() => {
                      notify(`Created Content Project "${selected.title}"`);
                      go?.("Content Studio");
                    });
                  }}
                >
                  Create Content Project
                </button>
              )}
              {go && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    onSetActiveScript?.(
                      selected.title,
                      selected.timeline.map((t) => `[${t.time}] ${t.beat}: ${t.text}`).join("\n"),
                    );
                    go("Video Editor");
                  }}
                >
                  Open in Video Editor
                </button>
              )}
            </div>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Content intelligence"
        title="Trending formats"
        copy="Relevant public content patterns, translated into reusable creative blueprints."
        actions={
          <>
            <ModelSelector
              label="Model"
              value={models.textModel}
              options={modelCatalog.text}
              onChange={onSelectTextModel}
              compact
            />
            <button className="btn primary" disabled={loading} onClick={() => void discoverTrends()}>
              {loading ? "Scanning trends…" : "✦ Discover live formats"}
            </button>
          </>
        }
      />
      <div className="toolbar">
        <div className="tabs">
          {["For " + workspace.name, "Educational", "Behind the scenes", "Problem-Solution"].map(
            (t, idx) => (
              <button
                key={t}
                className={(idx === 0 && !topic) || topic === t ? "active" : ""}
                onClick={() => setTopic(idx === 0 ? "" : t)}
              >
                {t}
              </button>
            ),
          )}
        </div>
      </div>

      {trends.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: "center", marginTop: 14 }}>
          <span className="badge blue">
            <i />
            Live Format Blueprints
          </span>
          <h2 style={{ marginTop: 10 }}>No trending formats scanned yet</h2>
          <p style={{ color: "var(--muted)", marginTop: 6, maxWidth: 500, marginInline: "auto" }}>
            Click “Discover live formats” to find current high-retention content hooks and beat-by-beat production blueprints for {workspace.name || "your industry"}.
          </p>
          <button
            className="btn primary"
            style={{ marginTop: 16 }}
            disabled={loading}
            onClick={() => void discoverTrends()}
          >
            {loading ? "Scanning trends…" : "✦ Discover live formats"}
          </button>
        </div>
      ) : (
        <div className="trend-grid">
          {trends.map((t) => (
            <button className="trend-card" onClick={() => setSelectedId(t.id)} key={t.id}>
              <div className="trend-img">
                {t.thumbUrl ? (
                  <img src={t.thumbUrl} alt="" />
                ) : (
                  <div style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 12, padding: 8 }}>
                    {t.platform}
                  </div>
                )}
                <span className="platform">◎</span>
                <div className="play">▶</div>
                <small>{t.duration}</small>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <span className="badge blue">
                    <i />
                    {t.patternName}
                  </span>
                  <SourceBadge sourceType={t.sourceType} />
                </div>
                <h3>{t.title}</h3>
                <p>{t.whyItFits}</p>
                <span className="views">
                  <b>{t.viewsLabel}</b> <i>{t.platform}</i>
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <section className="card" style={{ padding: 18, marginTop: 18 }}>
        <CardTitle
          title="Viral Video Pattern Analyzer & Repeatable Creator Method"
          copy="Analyze any uploaded reference video or public video URL into observed/estimated editing timestamps and load the template straight into Video Editor."
        />
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label>
            <span>Workspace Video Asset (Observed Multimodal)</span>
            <select value={refMediaId} onChange={(e) => setRefMediaId(e.target.value)}>
              <option value="">— Or choose an uploaded video —</option>
              {videoAssets.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.durationOrSize})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Public Reference Video URL</span>
            <input
              placeholder="https://youtube.com/shorts/... or https://tiktok.com/..."
              value={refUrl}
              onChange={(e) => setRefUrl(e.target.value)}
            />
          </label>
          <label>
            <span>Platform</span>
            <select value={refPlatform} onChange={(e) => setRefPlatform(e.target.value)}>
              <option value="TikTok">TikTok</option>
              <option value="Instagram Reels">Instagram Reels</option>
              <option value="YouTube Shorts">YouTube Shorts</option>
            </select>
          </label>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn primary"
              type="button"
              disabled={videoBusy}
              onClick={() => void analyzeVideoPattern()}
            >
              {videoBusy ? "Breaking down video…" : "✦ Break Down Video Pattern"}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={reportBusy}
              onClick={() => void generateMethodReport()}
            >
              {reportBusy ? "Synthesizing…" : "Repeatable Playbook"}
            </button>
          </div>
        </div>

        {videoBreakdown && (
          <div className="mos-stack" style={{ marginTop: 16 }}>
            <div className="mos-subcard">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <b>{videoBreakdown.title} ({videoBreakdown.platform})</b>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {onCreateProject && (
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ height: 28, padding: "0 10px", fontSize: 11 }}
                      onClick={() => {
                        void onCreateProject({
                          title: `${videoBreakdown.title} Adaptation`,
                          platform: videoBreakdown.platform,
                          status: "SCRIPT_PENDING",
                          stage: "Script",
                          brief: videoBreakdown.hookBreakdown,
                          hook: videoBreakdown.repeatableTemplate?.hookFormula || videoBreakdown.hookBreakdown,
                          sourceType: "ai_grounded",
                        }).then(() => {
                          notify("Created Content Project from viral breakdown");
                          go?.("Content Studio");
                        });
                      }}
                    >
                      + Content Project
                    </button>
                  )}
                  {onLoadInVideoEditor && (
                    <button
                      className="btn primary"
                      type="button"
                      style={{ height: 28, padding: "0 10px", fontSize: 11 }}
                      onClick={() => onLoadInVideoEditor(videoBreakdown.id)}
                    >
                      Edit my footage like this →
                    </button>
                  )}
                </div>
              </div>
              <p style={{ fontSize: 12, marginTop: 6 }}>
                <b>Hook Breakdown:</b> {videoBreakdown.hookBreakdown}
              </p>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                <b>Pacing:</b> {videoBreakdown.pacingSummary}
              </p>
            </div>

            <div className="mos-stack">
              {(videoBreakdown.timeline || []).map((beat, i) => (
                <div className="mos-list-row" key={i}>
                  <span>
                    <b>
                      {beat.timestamp} · {beat.editingEffect}
                    </b>
                    <small>{beat.visualAction} · Audio: {beat.audioCue}</small>
                    {beat.transcriptOrText && <small>“{beat.transcriptOrText}”</small>}
                  </span>
                  <span className={`badge ${beat.confidence === "observed" ? "mint" : "review"}`}>
                    <i />
                    {beat.confidence}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {methodReport && (
          <div className="mos-subcard" style={{ marginTop: 14 }}>
            <b>✦ {methodReport.reportTitle || "Repeatable Creator Method Playbook"}</b>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{methodReport.coreThesis}</p>
            {methodReport.repeatableHooks && methodReport.repeatableHooks.length > 0 && (
              <p style={{ fontSize: 12, marginTop: 8 }}>
                <b>Repeatable Hooks:</b> {methodReport.repeatableHooks.join(" · ")}
              </p>
            )}
            {methodReport.visualAndEditingChecklist && methodReport.visualAndEditingChecklist.length > 0 && (
              <ul style={{ margin: "6px 0 0 18px", fontSize: 12, color: "var(--muted)" }}>
                {methodReport.visualAndEditingChecklist.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </>
  );
}

export function SeoView({
  workspace,
  issues,
  keywords,
  models,
  modelCatalog,
  go,
  onSelectTextModel,
  onUpdateIssues,
  onUpdateKeywords,
  onConsumeCredits,
  onOpenWorkspaceHub,
  notify,
}: {
  workspace: WorkspaceProfile;
  issues: SeoIssueItem[];
  keywords: SeoKeywordItem[];
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  go?: (p: Page) => void;
  onSelectTextModel: (id: string) => void;
  onUpdateIssues: (items: SeoIssueItem[]) => void;
  onUpdateKeywords: (items: SeoKeywordItem[]) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  onOpenWorkspaceHub: () => void;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState<"seo" | "aso">("seo");
  const [auditUrl, setAuditUrl] = useState(workspace.websiteUrl);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [headline, setHeadline] = useState("");
  const [auditSource, setAuditSource] = useState<SourceType | undefined>(undefined);
  const [auditing, setAuditing] = useState(false);
  const [weeklyPushing, setWeeklyPushing] = useState(false);
  const [weeklyPushed, setWeeklyPushed] = useState(false);
  const [gscLoading, setGscLoading] = useState(false);
  const [gscState, setGscState] = useState<{
    status?: string;
    activeSite?: string;
    rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; position?: number }>;
    message?: string;
  } | null>(null);

  const [asoOptimized, setAsoOptimized] = useState(false);
  const [asoLoading, setAsoLoading] = useState(false);
  const [asoData, setAsoData] = useState<{
    currentScore: number;
    potentialScore: number;
    headline: string;
    optimizedSubtitle: string;
    optimizedHeadline: string;
    optimizedDescription: string;
    breakdown: { label: string; score: number }[];
  } | null>(null);

  useEffect(() => {
    setAuditUrl(workspace.websiteUrl);
  }, [workspace.websiteUrl]);

  const runLiveAudit = async () => {
    if (!auditUrl.trim()) {
      notify("Enter a website URL to audit");
      return;
    }
    setAuditing(true);
    try {
      const res = await apiPost<{
        sourceType: SourceType;
        healthScore: number;
        headline: string;
        technicalChecks?: Array<{
          title: string;
          severity: "High" | "Medium" | "Low";
          why: string;
          fix: string;
        }>;
        issues?: SeoIssueItem[];
        keywords?: Array<{
          keyword: string;
          intent: string;
          difficulty: string;
          priority: string;
        }>;
      }>("/api/seo/audit", {
        websiteUrl: auditUrl,
        business: workspace,
        model: models.textModel,
      });

      setAuditSource(res.sourceType);
      if (typeof res.healthScore === "number") setHealthScore(res.healthScore);
      if (res.headline) setHeadline(res.headline);

      const combinedIssues = [
        ...(res.technicalChecks || []).map((c) => ({
          title: c.title,
          severity: c.severity,
          why: c.why,
          fix: c.fix,
        })),
        ...(res.issues || []),
      ].slice(0, 6);
      if (combinedIssues.length) onUpdateIssues(combinedIssues);

      if (res.keywords?.length) {
        onUpdateKeywords(
          res.keywords.map((k) => ({
            keyword: k.keyword,
            volumeOrIntent: k.intent,
            difficulty: k.difficulty,
            priority: k.priority,
          })),
        );
      }

      onConsumeCredits(65, `Live SEO Audit (${models.textModel})`);
      notify(`Completed live SEO audit for ${auditUrl}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "SEO audit failed");
    } finally {
      setAuditing(false);
    }
  };

  const querySearchConsole = async () => {
    setGscLoading(true);
    try {
      const res = await apiPost<{
        connected: boolean;
        status?: string;
        activeSite?: string;
        rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; position?: number }>;
        message?: string;
      }>("/api/seo/search-console", { siteUrl: auditUrl });
      setGscState(res);
      notify(
        res.connected
          ? `Loaded ${res.rows?.length || 0} Search Console queries`
          : res.message || "Google Search Console requires OAuth connection",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "Search Console check failed");
    } finally {
      setGscLoading(false);
    }
  };

  const optimizeAso = async () => {
    setAsoLoading(true);
    try {
      const res = await apiPost<{
        currentScore: number;
        potentialScore: number;
        headline: string;
        optimizedSubtitle: string;
        optimizedHeadline: string;
        optimizedDescription: string;
        breakdown: { label: string; score: number }[];
      }>("/api/aso/optimize", {
        business: workspace,
        currentTitle: workspace.name,
        model: models.textModel,
      });

      setAsoData({
        currentScore: res.currentScore || 70,
        potentialScore: res.potentialScore || 90,
        headline: res.headline || "A sharper, intent-led listing.",
        optimizedSubtitle: res.optimizedSubtitle,
        optimizedHeadline: res.optimizedHeadline,
        optimizedDescription: res.optimizedDescription,
        breakdown: res.breakdown || [],
      });
      setAsoOptimized(true);
      onConsumeCredits(45, "ASO Listing Optimizer");
      notify("Optimized App Store listing generated");
    } catch (err) {
      notify(err instanceof Error ? err.message : "ASO optimization failed");
    } finally {
      setAsoLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Search intelligence"
        title="SEO & ASO"
        copy="Technical health, demand signals, and prioritized actions across web and app stores."
        actions={
          <>
            <ModelSelector
              label="Model"
              value={models.textModel}
              options={modelCatalog.text}
              onChange={onSelectTextModel}
              compact
            />
            <button className="btn secondary" onClick={onOpenWorkspaceHub}>
              Export to Sheets
            </button>
            <button className="btn primary" disabled={auditing} onClick={() => void runLiveAudit()}>
              {auditing ? "Crawling URL…" : "Run live audit"}
            </button>
          </>
        }
      />

      <div className="large-tabs">
        <button className={tab === "seo" ? "active" : ""} onClick={() => setTab("seo")}>
          Website SEO
        </button>
        <button className={tab === "aso" ? "active" : ""} onClick={() => setTab("aso")}>
          App Store Optimization
        </button>
      </div>

      {tab === "seo" ? (
        <>
          <div className="card" style={{ padding: 14, marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Target URL</span>
            <input
              placeholder="https://yourbusiness.com"
              style={{
                flex: 1,
                minWidth: 220,
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 10px",
                color: "var(--text)",
              }}
              value={auditUrl}
              onChange={(e) => setAuditUrl(e.target.value)}
            />
            {auditSource && <SourceBadge sourceType={auditSource} />}
            <button
              className="btn secondary"
              type="button"
              disabled={gscLoading}
              onClick={() => void querySearchConsole()}
            >
              {gscLoading ? "Querying GSC…" : "Search Console"}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={weeklyPushing}
              onClick={async () => {
                if (!auditUrl.trim()) {
                  notify("Enter a website URL first");
                  return;
                }
                setWeeklyPushing(true);
                try {
                  const res = await apiPost<{
                    report?: { healthScore: number; headline: string };
                  }>("/api/seo/weekly-audit/run", {
                    websiteUrl: auditUrl,
                    business: workspace,
                    triggeredBy: "seo_agent",
                    model: models.textModel,
                  });
                  if (typeof res.report?.healthScore === "number") {
                    setHealthScore(res.report.healthScore);
                  }
                  if (res.report?.headline) setHeadline(res.report.headline);
                  setWeeklyPushed(true);
                  onConsumeCredits(65, "Weekly SEO Agent Report");
                  notify("Persistent SEO report pushed to Analytics");
                } catch (err) {
                  notify(err instanceof Error ? err.message : "Weekly audit push failed");
                } finally {
                  setWeeklyPushing(false);
                }
              }}
            >
              {weeklyPushing ? "Pushing report…" : "Push Weekly Report → Analytics"}
            </button>
          </div>
          {weeklyPushed && go && (
            <div className="mos-success-box" style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span>Weekly technical SEO audit report saved &amp; pushed to Analytics.</span>
              <button className="btn secondary" onClick={() => go("Analytics")}>
                Open Analytics Report →
              </button>
            </div>
          )}

          {gscState && (
            <div className="card" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <b style={{ fontSize: 12 }}>
                  Google Search Console {gscState.activeSite ? `· ${gscState.activeSite}` : ""}
                </b>
                <span className={`badge ${gscState.rows?.length ? "mint" : "review"}`}>
                  <i />
                  {gscState.status || (gscState.rows?.length ? "Connected" : "Setup Required")}
                </span>
              </div>
              {gscState.message && (
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{gscState.message}</p>
              )}
              {gscState.rows && gscState.rows.length > 0 && (
                <div className="mos-list" style={{ marginTop: 10 }}>
                  {gscState.rows.slice(0, 8).map((r, i) => (
                    <div className="mos-list-row" key={i}>
                      <b>{r.keys?.[0] || "query"}</b>
                      <small>
                        {r.clicks ?? 0} clicks · {r.impressions ?? 0} impr · pos {Number(r.position || 0).toFixed(1)}
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="seo-grid">
            <section className="card score-card">
              <div className="score-ring">
                <strong>{healthScore !== null ? healthScore : "—"}</strong>
                <span>SEO health</span>
              </div>
              <div>
                <span className={`badge ${healthScore !== null && healthScore >= 80 ? "mint" : healthScore !== null ? "review" : "draft"}`}>
                  <i />
                  {healthScore === null ? "Not audited" : healthScore >= 80 ? "Healthy" : "Needs attention"}
                </span>
                <h2>{headline || "Enter a website URL and run a live audit."}</h2>
                <p>Technical checks parse live HTML metadata, headings, schema, and image attributes.</p>
              </div>
            </section>

            <section className="card seo-metrics">
              {[
                ["Audit score", healthScore !== null ? `${healthScore}/100` : "—", healthScore !== null ? "Live crawl" : "Pending audit"],
                ["Tracked keywords", String(keywords.length), "Opportunities"],
                ["Open audit fixes", String(issues.length), "Prioritized"],
              ].map((x) => (
                <div key={x[0]}>
                  <span>{x[0]}</span>
                  <strong>{x[1]}</strong>
                  <small>{x[2]}</small>
                </div>
              ))}
            </section>

            <section className="card audit-table">
              <CardTitle title="Priority audit issues" copy="Ordered by likely business impact" />
              {issues.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 12, padding: "12px 0" }}>
                  No audit issues logged yet. Click “Run live audit” to inspect HTML metadata and structured data.
                </p>
              ) : (
                issues.map((x, idx) => (
                  <details key={x.title + idx}>
                    <summary>
                      <span className={`severity ${x.severity.toLowerCase()}`} />
                      <b>{x.title}</b>
                      <span className={`badge ${x.severity.toLowerCase()}`}>
                        <i />
                        {x.severity}
                      </span>
                      <i>⌄</i>
                    </summary>
                    <div>
                      <p>
                        <b>Why it matters</b>
                        {x.why}
                      </p>
                      <p>
                        <b>Recommended fix</b>
                        {x.fix}
                      </p>
                      <button
                        className="btn secondary"
                        onClick={() => {
                          notify(`Task queued: ${x.title}`);
                          onOpenWorkspaceHub();
                        }}
                      >
                        Push to Google Tasks
                      </button>
                    </div>
                  </details>
                ))
              )}
            </section>

            <section className="card keyword-card">
              <CardTitle title="Keyword opportunities" copy="High relevance · attainable intent" />
              {keywords.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 12, padding: "12px 0" }}>
                  Keyword opportunities populate automatically after onboarding or running a live SEO audit.
                </p>
              ) : (
                keywords.map((k) => (
                  <div key={k.keyword}>
                    <b>{k.keyword}</b>
                    <span>{k.volumeOrIntent}</span>
                    <span>KD {k.difficulty}</span>
                    <span className="badge mint">
                      <i />
                      {k.priority}
                    </span>
                  </div>
                ))
              )}
            </section>
          </div>
        </>
      ) : (
        <div className="aso-layout">
          <section className="store-preview card">
            <div className="phone-store">
              <div className="store-top">
                ‹ <span>App Store</span> •••
              </div>
              <div className="app-head">
                <div className="workspace-logo large">
                  {(workspace.name || "MO").slice(0, 2).toUpperCase()}
                </div>
                <span>
                  <h3>{workspace.name || "Your App"}</h3>
                  <p>{asoOptimized && asoData ? asoData.optimizedSubtitle : workspace.positioning || "App Store subtitle"}</p>
                  <small>{workspace.industry || "Productivity"}</small>
                </span>
                <button>GET</button>
              </div>
              <div className="screens">
                <div>Feature 1</div>
                <div>Feature 2</div>
                <div>Social Proof</div>
              </div>
              <h4>{asoOptimized && asoData ? asoData.optimizedHeadline : "About this app"}</h4>
              <p>
                {asoOptimized && asoData
                  ? asoData.optimizedDescription
                  : workspace.description || "Run AI optimization to draft high-converting App Store copy."}
              </p>
            </div>
          </section>
          <section className="aso-panel">
            <span className="badge mint">
              <i />
              {asoOptimized ? "AI Optimized Preview" : "ASO Optimizer Ready"}
            </span>
            <h2>{asoData ? asoData.headline : `Optimize ${workspace.name || "your"} app listing`}</h2>
            <p>
              Generate intent-led App Store titles, subtitles, and value-focused descriptions tailored to your Business Notebook.
            </p>
            {asoData && (
              <>
                <div className="aso-score">
                  <span>
                    <small>Baseline score</small>
                    <b>{asoData.currentScore}</b>
                  </span>
                  <i>→</i>
                  <span>
                    <small>Projected score</small>
                    <b>{asoData.potentialScore}</b>
                  </span>
                </div>
                {asoData.breakdown.map((x) => (
                  <div className="aso-row" key={x.label}>
                    <span>{x.label}</span>
                    <b>{x.score}%</b>
                    <div>
                      <i style={{ width: `${x.score}%` }} />
                    </div>
                  </div>
                ))}
              </>
            )}
            <button className="btn primary" disabled={asoLoading} onClick={() => void optimizeAso()}>
              {asoLoading ? "Optimizing with AI…" : "Optimize My Listing"}
            </button>
            <p className="disclaimer">Preview only. No live app store listing is modified.</p>
          </section>
        </div>
      )}
    </>
  );
}
