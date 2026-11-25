import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ModelSelector } from "../components/ModelSelector";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import type {
  AnalyticsProviderId,
  DataCompletenessStatus,
  FunnelStageResult,
  GrowthDashboardPayload,
  GrowthReportRecord,
  MetricProvenance,
  ModelCatalog,
  ModelOption,
  ModelPreferences,
  Page,
  ProviderKpiCard,
  TrackingAuditResult,
  WorkspaceProfile,
} from "../types/marketing";
import { CardTitle, PageHeader } from "./IntelligenceViews";

function statusTone(status: DataCompletenessStatus): string {
  if (status === "connected_and_reporting") return "mint";
  if (status === "connected_no_events" || status === "insufficient_historical_data") return "blue";
  if (status === "permission_restricted" || status === "sync_failed") return "high";
  return "review";
}

function statusLabel(status: DataCompletenessStatus): string {
  switch (status) {
    case "connected_and_reporting":
      return "Connected · Reporting";
    case "connected_no_events":
      return "Connected · No Events Yet";
    case "permission_restricted":
      return "Permission Restricted";
    case "not_connected":
      return "Not Connected";
    case "unsupported":
      return "Unsupported";
    case "insufficient_historical_data":
      return "Insufficient History";
    case "sync_failed":
      return "Sync Failed";
  }
}

function formatMetricValue(val: number | null, unit: string): string {
  if (val === null || val === undefined || Number.isNaN(val)) return "—";
  if (unit === "percent") return `${val.toFixed(1)}%`;
  if (unit === "seconds") return `${val.toFixed(1)}s`;
  if (unit === "currency") return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return val.toLocaleString();
}

export function GrowthIntelligenceView({
  workspace,
  models,
  modelCatalog,
  onSelectTextModel,
  onConsumeCredits,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  models: ModelPreferences;
  modelCatalog: ModelCatalog;
  onSelectTextModel: (id: string) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [range, setRange] = useState<string>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dashboard, setDashboard] = useState<GrowthDashboardPayload | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string>("");
  const [inspectedProvenance, setInspectedProvenance] = useState<{
    label: string;
    value: string;
    provenance: MetricProvenance;
  } | null>(null);

  // Tracking & SDK Audit
  const [auditUrl, setAuditUrl] = useState(() => workspace.websiteUrl || "");
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<TrackingAuditResult | null>(null);

  // Model Capability Verification
  const [verifyingModels, setVerifyingModels] = useState(false);
  const [modelVerifyRes, setModelVerifyRes] = useState<{
    geminiConfigured: boolean;
    checkedAt?: string;
    liveCheckPerformed?: boolean;
    listedModelCount?: number;
    error?: string;
    models?: Array<{
      category?: string;
      id: string;
      label: string;
      tier?: string;
      description?: string;
      capabilities?: ModelOption["capabilities"];
      recommendedFor?: string;
      availableOnKey?: boolean;
      verificationStatus?:
        | "verified_available"
        | "not_in_models_list"
        | "api_key_missing"
        | "verification_failed";
    }>;
  } | null>(null);

  // Configurable Acquisition Funnel
  const [funnelStages, setFunnelStages] = useState<
    Array<{ stageName: string; provider: AnalyticsProviderId; metricKey?: string }>
  >([
    { stageName: "Organic Search Impressions / Clicks", provider: "gsc" },
    { stageName: "Website Visits / Active Users", provider: "ga4" },
    { stageName: "Product Events / Signups", provider: "posthog" },
    { stageName: "Verified Accounts / Subscribers", provider: "supabase" },
  ]);
  const [funnelResults, setFunnelResults] = useState<FunnelStageResult[]>([]);
  const [funnelBusy, setFunnelBusy] = useState(false);

  // AI Growth Analyst Q&A
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [analystAnswer, setAnalystAnswer] = useState<{
    answer?: string;
    dataGaps?: string[];
    recommendedActions?: Array<{ title: string; reason: string; priority: string }>;
    model?: string;
  } | null>(null);

  // Reports
  const [reports, setReports] = useState<GrowthReportRecord[]>([]);
  const [reportCadence, setReportCadence] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [generatingReport, setGeneratingReport] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const buildQueryString = useCallback(
    (forceRefresh = false) => {
      const params = new URLSearchParams();
      params.set("range", range);
      params.set("compare", String(compareEnabled));
      if (forceRefresh) params.set("refresh", "true");
      if (range === "custom" && customStart && customEnd) {
        params.set("startDate", customStart);
        params.set("endDate", customEnd);
      }
      return params.toString();
    },
    [compareEnabled, customEnd, customStart, range],
  );

  const loadDashboard = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) setSyncing(true);
      else setLoading(true);
      setErrorMsg("");
      try {
        const [dash, repRes] = await Promise.all([
          apiGet<GrowthDashboardPayload>(`/api/growth/dashboard?${buildQueryString(forceRefresh)}`),
          apiGet<{ reports: GrowthReportRecord[] }>("/api/growth/reports"),
        ]);
        setDashboard(dash);
        setReports(repRes.reports || []);
        if (dash.providerCards?.length && !selectedCardId) {
          setSelectedCardId(dash.providerCards[0].connectionId);
        }
        if (forceRefresh) notify("Synced live analytics providers");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Failed to load Growth Intelligence");
      } finally {
        setLoading(false);
        setSyncing(false);
      }
    },
    [buildQueryString, notify, selectedCardId],
  );

  const evaluateFunnel = useCallback(async () => {
    setFunnelBusy(true);
    try {
      const res = await apiPost<{ stages: FunnelStageResult[] }>("/api/growth/funnel", {
        stages: funnelStages,
      });
      setFunnelResults(res.stages || []);
    } catch {
      // ignore initial empty funnel failure
    } finally {
      setFunnelBusy(false);
    }
  }, [funnelStages]);

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  useEffect(() => {
    if (dashboard) {
      void evaluateFunnel();
    }
  }, [dashboard, evaluateFunnel]);

  const runTrackingAudit = async () => {
    const target = auditUrl.trim() || workspace.websiteUrl;
    if (!target) {
      notify("Enter your website URL to audit installed tracking SDKs");
      return;
    }
    setAuditing(true);
    setErrorMsg("");
    try {
      const res = await apiPost<TrackingAuditResult>("/api/growth/audit-tracking", {
        websiteUrl: target,
        products: workspace.products,
        channels: workspace.channels,
      });
      setAuditResult(res);
      notify(`Tracking audit completed for ${res.auditedUrl}`);
      await loadDashboard(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Tracking SDK audit failed");
    } finally {
      setAuditing(false);
    }
  };

  const verifyAiModels = async () => {
    setVerifyingModels(true);
    try {
      const res = await apiGet<{
        geminiConfigured: boolean;
        checkedAt?: string;
        liveCheckPerformed?: boolean;
        listedModelCount?: number;
        error?: string;
        models?: Array<{
          category?: string;
          id: string;
          label: string;
          tier?: string;
          description?: string;
          capabilities?: ModelOption["capabilities"];
          recommendedFor?: string;
          availableOnKey?: boolean;
          verificationStatus?:
            | "verified_available"
            | "not_in_models_list"
            | "api_key_missing"
            | "verification_failed";
        }>;
      }>("/api/models/verify");
      setModelVerifyRes(res);
      if (!res.geminiConfigured) {
        notify("GEMINI_API_KEY not configured");
      } else if (res.error) {
        notify(`Live model check warning: ${res.error}`);
      } else {
        const verifiedCount = (res.models || []).filter((m) => m.availableOnKey).length;
        notify(`Verified ${verifiedCount} catalog models (${res.listedModelCount || 0} listed on key)`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to verify Gemini model availability");
    } finally {
      setVerifyingModels(false);
    }
  };

  const askAnalyst = async () => {
    if (!question.trim()) return;
    setAsking(true);
    setErrorMsg("");
    try {
      const res = await apiPost<{
        answer?: string;
        dataGaps?: string[];
        recommendedActions?: Array<{ title: string; reason: string; priority: string }>;
        model?: string;
      }>("/api/growth/analyst/ask", {
        question: question.trim(),
        business: workspace,
        model: models.textModel,
      });
      setAnalystAnswer(res);
      onConsumeCredits(30, "Business Growth Analyst Q&A");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Growth Analyst failed");
    } finally {
      setAsking(false);
    }
  };

  const generateReport = async (saveToMemory = false) => {
    setGeneratingReport(true);
    setErrorMsg("");
    try {
      const res = await apiPost<{ report: GrowthReportRecord }>("/api/growth/reports/generate", {
        cadence: reportCadence,
        range,
        startDate: customStart || undefined,
        endDate: customEnd || undefined,
        saveToMemory,
      });
      if (res.report) {
        setReports((prev) => [res.report, ...prev]);
        notify(`Generated ${reportCadence} Growth Intelligence Report`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Report generation failed");
    } finally {
      setGeneratingReport(false);
    }
  };

  const downloadBlob = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeCard: ProviderKpiCard | null =
    dashboard?.providerCards.find((c) => c.connectionId === selectedCardId) ||
    dashboard?.providerCards[0] ||
    null;

  const seriesKeys =
    activeCard?.timeSeries?.[0]
      ? Object.keys(activeCard.timeSeries[0]).filter(
          (k) => k !== "date" && typeof activeCard.timeSeries[0][k] === "number",
        )
      : [];

  return (
    <>
      <PageHeader
        eyebrow="Connected business telemetry"
        title="Growth Intelligence"
        copy="Real multi-source product, acquisition, search, and marketing analytics with strict provider isolation and metric provenance."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <ModelSelector
              label="Analyst Model"
              value={models.textModel}
              options={modelCatalog.text}
              onChange={onSelectTextModel}
              compact
            />
            <button
              className="btn secondary"
              type="button"
              disabled={syncing}
              onClick={() => void loadDashboard(true)}
            >
              {syncing ? "Syncing providers…" : "↻ Sync All Sources"}
            </button>
            <button className="btn primary" type="button" onClick={() => go("Integrations")}>
              ＋ Connect Analytics Source
            </button>
          </div>
        }
      />

      {errorMsg && <div className="mos-error-box">{errorMsg}</div>}

      {/* Reporting Period & Comparison Bar */}
      <section
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
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {[
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["7d", "Last 7d"],
            ["30d", "Last 30d"],
            ["90d", "Last 90d"],
            ["this_month", "This Month"],
            ["last_month", "Last Month"],
            ["custom", "Custom"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn ${range === id ? "primary" : "ghost"}`}
              style={{ height: 30, padding: "0 10px", fontSize: 11 }}
              onClick={() => setRange(id)}
            >
              {label}
            </button>
          ))}
          {range === "custom" && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="date"
                className="filter"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              <span style={{ color: "var(--muted)", fontSize: 11 }}>→</span>
              <input
                type="date"
                className="filter"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)" }}>
            <input
              type="checkbox"
              checked={compareEnabled}
              onChange={(e) => setCompareEnabled(e.target.checked)}
            />
            Compare previous period
          </label>
          {dashboard?.reportingPeriod && (
            <small className="tabular-nums" style={{ color: "var(--muted)", fontSize: 11 }}>
              {dashboard.reportingPeriod.startDate} → {dashboard.reportingPeriod.endDate}
            </small>
          )}
        </div>
      </section>

      {/* Honest Identity Isolation Notice */}
      {dashboard?.overlapWarning && (
        <div
          className="card"
          style={{
            padding: 12,
            marginBottom: 14,
            borderColor: "rgba(96, 165, 250, 0.3)",
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          <b style={{ color: "var(--text)" }}>Metric Isolation Policy:</b> {dashboard.overlapWarning}
        </div>
      )}

      {/* Per-Provider KPI Cards */}
      {loading ? (
        <div className="card" style={{ padding: 28, textAlign: "center", marginBottom: 14 }}>
          Loading connected analytics telemetry…
        </div>
      ) : !dashboard || dashboard.providerCards.length === 0 ? (
        <section className="card" style={{ padding: 26, marginBottom: 14 }}>
          <span className="badge review">
            <i />
            Not Connected
          </span>
          <h2 style={{ marginTop: 10 }}>No external analytics sources connected yet</h2>
          <p style={{ color: "var(--muted)", marginTop: 6, maxWidth: 680 }}>
            Connect PostHog, Direct Supabase, Direct Firebase, Google Analytics 4, Google Search Console, or Google Play Console in Integrations. No placeholder metrics are fabricated here.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <button className="btn primary" type="button" onClick={() => go("Integrations")}>
              Connect Analytics Sources →
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={auditing}
              onClick={() => void runTrackingAudit()}
            >
              {auditing ? "Auditing Website SDKs…" : "Audit Website Tracking SDKs"}
            </button>
          </div>
        </section>
      ) : (
        <div style={{ display: "grid", gap: 14, marginBottom: 14 }}>
          {dashboard.providerCards.map((card) => (
            <section
              className="card"
              key={card.connectionId}
              style={{
                padding: 18,
                borderColor: selectedCardId === card.connectionId ? "var(--mint)" : undefined,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0 }}>{card.providerLabel}</h3>
                    <span className={`badge ${statusTone(card.completenessStatus)}`}>
                      <i />
                      {statusLabel(card.completenessStatus)}
                    </span>
                    <small style={{ color: "var(--muted)" }}>{card.projectOrProperty}</small>
                  </div>
                  <small style={{ color: "var(--muted)", display: "block", marginTop: 4 }}>
                    {card.statusDetail} · Retrieved {new Date(card.retrievedAt).toLocaleString()}
                  </small>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className={`btn ${selectedCardId === card.connectionId ? "primary" : "secondary"}`}
                    style={{ height: 30, fontSize: 11 }}
                    onClick={() => setSelectedCardId(card.connectionId)}
                  >
                    {selectedCardId === card.connectionId ? "Viewing Trend & Channels" : "Inspect Series"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ height: 30, fontSize: 11 }}
                    onClick={async () => {
                      setSyncing(true);
                      try {
                        await apiPost(`/api/growth/connections/${card.connectionId}/sync`, { range });
                        await loadDashboard(false);
                        notify(`Synced ${card.providerLabel}`);
                      } catch (err) {
                        notify(err instanceof Error ? err.message : "Sync failed");
                      } finally {
                        setSyncing(false);
                      }
                    }}
                  >
                    ↻ Sync
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ height: 30, fontSize: 11, color: "#ff9c9c" }}
                    onClick={async () => {
                      await apiDelete(`/api/growth/connections/${card.connectionId}`);
                      notify(`Disconnected ${card.providerLabel}`);
                      await loadDashboard(false);
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </div>

              {card.metrics.length === 0 ? (
                <div className="mos-subcard" style={{ fontSize: 12, color: "var(--muted)" }}>
                  No numeric metrics returned for this reporting window ({card.statusDetail}).
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                    gap: 10,
                  }}
                >
                  {card.metrics.map((m) => (
                    <button
                      type="button"
                      key={m.key}
                      className="mos-subcard"
                      style={{ textAlign: "left", cursor: "pointer", padding: 12 }}
                      onClick={() =>
                        setInspectedProvenance({
                          label: m.label,
                          value: formatMetricValue(m.value, m.unit),
                          provenance: m.provenance,
                        })
                      }
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <small style={{ color: "var(--muted)" }}>{m.label}</small>
                        <small style={{ color: "var(--mint)", fontSize: 10 }}>Provenance ⓘ</small>
                      </div>
                      <div
                        className="tabular-nums"
                        style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}
                      >
                        {formatMetricValue(m.value, m.unit)}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11 }}>
                        <span style={{ color: "var(--muted)" }}>
                          {compareEnabled
                            ? `Prev: ${formatMetricValue(m.previousValue, m.unit)}`
                            : m.provenance.attributionMethod}
                        </span>
                        <span
                          className="tabular-nums"
                          style={{
                            color:
                              typeof m.growthPct !== "number"
                                ? "var(--muted)"
                                : m.growthPct >= 0
                                  ? "var(--mint)"
                                  : "#ff8c8c",
                          }}
                        >
                          {typeof m.growthPct === "number"
                            ? `${m.growthPct >= 0 ? "+" : ""}${m.growthPct.toFixed(1)}%`
                            : "—"}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {/* Provenance Inspector Modal */}
      {inspectedProvenance && (
        <div className="modal-backdrop" onMouseDown={() => setInspectedProvenance(null)}>
          <div
            className="card"
            style={{ width: 520, maxWidth: "92vw", padding: 20 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3>Metric Provenance Inspector</h3>
              <button className="btn ghost" onClick={() => setInspectedProvenance(null)}>
                ✕
              </button>
            </div>
            <div className="mos-stack" style={{ marginTop: 12, fontSize: 12 }}>
              <div className="mos-list-row">
                <b>Metric</b>
                <span>
                  {inspectedProvenance.label}: <strong className="tabular-nums">{inspectedProvenance.value}</strong>
                </span>
              </div>
              <div className="mos-list-row">
                <b>Source Provider</b>
                <span>{inspectedProvenance.provenance.providerLabel}</span>
              </div>
              <div className="mos-list-row">
                <b>Project / Property</b>
                <span>{inspectedProvenance.provenance.projectOrProperty}</span>
              </div>
              <div className="mos-list-row">
                <b>Reporting Period</b>
                <span className="tabular-nums">
                  {inspectedProvenance.provenance.reportingPeriod.startDate} →{" "}
                  {inspectedProvenance.provenance.reportingPeriod.endDate}
                </span>
              </div>
              <div className="mos-list-row">
                <b>Attribution Method</b>
                <span className="badge blue">
                  <i />
                  {inspectedProvenance.provenance.attributionMethod}
                </span>
              </div>
              <div className="mos-list-row">
                <b>Completeness Status</b>
                <span className={`badge ${statusTone(inspectedProvenance.provenance.completenessStatus)}`}>
                  <i />
                  {statusLabel(inspectedProvenance.provenance.completenessStatus)}
                </span>
              </div>
              <div className="mos-subcard">
                <b>Metric Definition</b>
                <p style={{ color: "var(--muted)", marginTop: 4 }}>
                  {inspectedProvenance.provenance.definition}
                </p>
                {inspectedProvenance.provenance.limitations && (
                  <p style={{ color: "#ffd580", marginTop: 6 }}>
                    Limitation: {inspectedProvenance.provenance.limitations}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Time Series + Channels / Top Items */}
      {activeCard && (
        <div className="dashboard-grid" style={{ marginBottom: 14 }}>
          <section className="card" style={{ padding: 18 }}>
            <CardTitle
              title={`${activeCard.providerLabel} Historical Trend`}
              copy={`${activeCard.projectOrProperty} · Real retrieved time series only`}
            />
            {activeCard.timeSeries.length > 0 && seriesKeys.length > 0 ? (
              <div style={{ width: "100%", height: 240, marginTop: 12 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activeCard.timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#12151c",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        fontSize: 11,
                      }}
                    />
                    {seriesKeys.slice(0, 3).map((k, idx) => (
                      <Line
                        key={k}
                        type="monotone"
                        dataKey={k}
                        stroke={["#2dd4bf", "#60a5fa", "#a78bfa"][idx % 3]}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="mos-subcard" style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
                Insufficient historical time series returned by {activeCard.providerLabel} for this date window.
              </div>
            )}
          </section>

          <section className="card" style={{ padding: 18 }}>
            <CardTitle
              title="Acquisition Channels & Attribution"
              copy="Each row states Direct, Provider-Attributed, Correlated, or Unknown attribution"
            />
            {activeCard.channels.length === 0 ? (
              <div className="mos-subcard" style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
                {activeCard.topPagesOrEvents.length > 0
                  ? "Channel breakdown unavailable on this provider; showing top pages/events below."
                  : "No channel acquisition records returned for this provider."}
              </div>
            ) : (
              <div className="mos-stack" style={{ marginTop: 10 }}>
                {activeCard.channels.slice(0, 8).map((ch, idx) => (
                  <div key={ch.channel + idx} className="mos-list-row">
                    <span>
                      <b>{ch.channel}</b>
                      <small>
                        Visits: {ch.sessionsOrVisits ?? "—"} · Users: {ch.users ?? "—"} · Conv:{" "}
                        {ch.conversions ?? "—"}
                      </small>
                    </span>
                    <span className="badge blue">
                      <i />
                      {ch.attributionMethod}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {activeCard.topPagesOrEvents.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <b style={{ fontSize: 12 }}>Top Pages / Events</b>
                <div className="mos-stack" style={{ marginTop: 6 }}>
                  {activeCard.topPagesOrEvents.slice(0, 5).map((item, idx) => (
                    <div key={item.name + idx} className="mos-list-row">
                      <span>
                        <b>{item.name}</b>
                        {item.detail && <small>{item.detail}</small>}
                      </span>
                      <strong className="tabular-nums">{item.count.toLocaleString()}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Configurable Funnel + Strategy Feedback Loop */}
      <div className="dashboard-grid" style={{ marginBottom: 14 }}>
        <section className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <CardTitle
              title="Configurable Acquisition Funnel"
              copy="Maps each conversion step to its verified source (missing steps fail closed)"
            />
            <button
              type="button"
              className="btn secondary"
              style={{ height: 28, fontSize: 11 }}
              disabled={funnelBusy}
              onClick={() => void evaluateFunnel()}
            >
              {funnelBusy ? "Evaluating…" : "Recalculate"}
            </button>
          </div>
          <div className="mos-stack" style={{ marginTop: 10 }}>
            {funnelStages.map((st, idx) => {
              const resRow = funnelResults[idx];
              return (
                <div key={idx} className="mos-subcard" style={{ padding: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      className="filter"
                      style={{ flex: 1, minWidth: 160 }}
                      value={st.stageName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFunnelStages((prev) =>
                          prev.map((x, xi) => (xi === idx ? { ...x, stageName: val } : x)),
                        );
                      }}
                    />
                    <select
                      className="filter"
                      value={st.provider}
                      onChange={(e) => {
                        const val = e.target.value as AnalyticsProviderId;
                        setFunnelStages((prev) =>
                          prev.map((x, xi) => (xi === idx ? { ...x, provider: val } : x)),
                        );
                      }}
                    >
                      <option value="gsc">Search Console</option>
                      <option value="ga4">Google Analytics 4</option>
                      <option value="posthog">PostHog</option>
                      <option value="supabase">Direct Supabase</option>
                      <option value="firebase">Direct Firebase</option>
                      <option value="google_play">Google Play Console</option>
                    </select>
                    <strong className="tabular-nums" style={{ minWidth: 70, textAlign: "right" }}>
                      {resRow?.count !== null && resRow?.count !== undefined
                        ? resRow.count.toLocaleString()
                        : "—"}
                    </strong>
                    <span className={`badge ${statusTone(resRow?.completenessStatus || "not_connected")}`}>
                      <i />
                      {idx === 0
                        ? "Base Step"
                        : typeof resRow?.conversionFromPreviousPct === "number"
                          ? `${resRow.conversionFromPreviousPct.toFixed(1)}% step conv`
                          : "—"}
                    </span>
                  </div>
                  {resRow?.note && (
                    <small style={{ color: "var(--muted)", display: "block", marginTop: 4 }}>
                      {resRow.note}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="card" style={{ padding: 18 }}>
          <CardTitle
            title="Strategy-to-Analytics Feedback Loop"
            copy="Measures active Marketing Strategy North Star & pillars against real connected data"
          />
          {!dashboard?.strategyFeedback ? (
            <div className="mos-subcard" style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
              No saved Marketing Strategy yet. Generate and save a strategy first to compare pillars against live metrics.
              <div style={{ marginTop: 10 }}>
                <button className="btn secondary" type="button" onClick={() => go("Marketing Strategy")}>
                  Open Marketing Strategy →
                </button>
              </div>
            </div>
          ) : (
            <div className="mos-stack" style={{ marginTop: 10 }}>
              <div className="mos-subcard">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <b>{dashboard.strategyFeedback.strategyTitle}</b>
                  <span
                    className={`badge ${
                      dashboard.strategyFeedback.goalAlignmentStatus === "aligned_data_available"
                        ? "mint"
                        : dashboard.strategyFeedback.goalAlignmentStatus === "partial_data"
                          ? "blue"
                          : "review"
                    }`}
                  >
                    <i />
                    {dashboard.strategyFeedback.goalAlignmentStatus.replace(/_/g, " ")}
                  </span>
                </div>
                <small style={{ color: "var(--muted)", display: "block", marginTop: 4 }}>
                  North Star: {dashboard.strategyFeedback.northStarMetric}
                </small>
                <p style={{ fontSize: 12, marginTop: 6 }}>{dashboard.strategyFeedback.summary}</p>
              </div>
              {dashboard.strategyFeedback.comparisons.map((cmp, idx) => (
                <div key={idx} className="mos-list-row">
                  <span>
                    <b>{cmp.pillarOrGoal}</b>
                    <small>
                      {cmp.observedMetric}: {cmp.observedValue}
                    </small>
                    <small style={{ display: "block" }}>{cmp.assessment}</small>
                  </span>
                  {cmp.linkedProvider && (
                    <span className="badge blue">
                      <i />
                      {cmp.linkedProvider}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Website Tracking Audit & AI Model Verification */}
      <div className="dashboard-grid" style={{ marginBottom: 14 }}>
        <section className="card" style={{ padding: 18 }}>
          <CardTitle
            title="Website Tracking & SDK Audit"
            copy="Inspect your live site HTML/scripts for GA4, PostHog, GTM, Firebase, Supabase, Meta Pixel, TikTok Pixel, Clarity & Play/App Store links"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <input
              className="filter"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="https://yourcompany.com"
              value={auditUrl}
              onChange={(e) => setAuditUrl(e.target.value)}
            />
            <button
              type="button"
              className="btn primary"
              disabled={auditing}
              onClick={() => void runTrackingAudit()}
            >
              {auditing ? "Scanning…" : "Run Tracking Audit"}
            </button>
          </div>
          {auditResult && (
            <div className="mos-stack" style={{ marginTop: 12 }}>
              {auditResult.detectedSdks.map((sdk) => (
                <div key={sdk.provider} className="mos-list-row">
                  <span>
                    <b>{sdk.label}</b>
                    <small>{sdk.evidence}</small>
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <span className={`badge ${sdk.detected ? "mint" : "draft"}`}>
                      <i />
                      {sdk.detected ? "SDK Found" : "Not Found"}
                    </span>
                    <span className={`badge ${sdk.connectedInWorkspace ? "mint" : "review"}`}>
                      <i />
                      {sdk.connectedInWorkspace ? "Connected" : "Unlinked"}
                    </span>
                  </div>
                </div>
              ))}
              {auditResult.eventTaxonomyGaps.length > 0 && (
                <div className="mos-subcard" style={{ fontSize: 12 }}>
                  <b>Detected Gaps</b>
                  <ul style={{ margin: "6px 0 0 18px", color: "var(--muted)" }}>
                    {auditResult.eventTaxonomyGaps.map((g, idx) => (
                      <li key={idx}>{g}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <CardTitle
              title="AI Model Availability & Capabilities"
              copy="Checks live Gemini API model listing without exposing credentials"
            />
            <button
              type="button"
              className="btn secondary"
              style={{ height: 28, fontSize: 11 }}
              disabled={verifyingModels}
              onClick={() => void verifyAiModels()}
            >
              {verifyingModels ? "Checking…" : "Verify Live Models"}
            </button>
          </div>
          {modelVerifyRes ? (
            <div className="mos-stack" style={{ marginTop: 10 }}>
              <div className="mos-subcard" style={{ fontSize: 12 }}>
                <b>
                  {modelVerifyRes.geminiConfigured ? "Gemini API Connected" : "GEMINI_API_KEY Not Configured"}
                </b>
                <p style={{ color: "var(--muted)", marginTop: 4 }}>
                  {modelVerifyRes.error
                    ? modelVerifyRes.error
                    : modelVerifyRes.liveCheckPerformed
                      ? `${modelVerifyRes.listedModelCount ?? 0} models accessible on this key${
                          modelVerifyRes.checkedAt
                            ? ` · Checked ${new Date(modelVerifyRes.checkedAt).toLocaleTimeString()}`
                            : ""
                        }`
                      : "Static capability catalog loaded."}
                </p>
              </div>
              {(modelVerifyRes.models || []).slice(0, 8).map((m) => (
                <div key={m.id} className="mos-list-row">
                  <span>
                    <b>{m.label}</b>
                    <small>{m.recommendedFor || m.description || m.id}</small>
                  </span>
                  <span
                    className={`badge ${
                      m.availableOnKey
                        ? "mint"
                        : m.verificationStatus === "verification_failed" ||
                            m.verificationStatus === "api_key_missing"
                          ? "high"
                          : "blue"
                    }`}
                  >
                    <i />
                    {m.availableOnKey
                      ? "Live Verified"
                      : m.verificationStatus === "api_key_missing"
                        ? "Key Missing"
                        : m.verificationStatus === "verification_failed"
                          ? "Check Failed"
                          : "Alias / Preview"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mos-subcard" style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
              Click “Verify Live Models” to verify real-time Gemini API model access and view capability tags for text, Nano Banana image, and Omni video models.
            </div>
          )}
        </section>
      </div>

      {/* Business Growth Analyst Q&A + Periodic Reports */}
      <div className="dashboard-grid">
        <section className="card" style={{ padding: 18 }}>
          <CardTitle
            title="AI Business Growth Analyst"
            copy="Answers strictly from verified telemetry in this workspace and discloses missing data"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <input
              className="filter"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="e.g., What is converting best this month and where are we losing signups?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button
              type="button"
              className="btn primary"
              disabled={asking || !question.trim()}
              onClick={() => void askAnalyst()}
            >
              {asking ? "Analyzing…" : "Ask Analyst"}
            </button>
          </div>
          {analystAnswer && (
            <div className="mos-stack" style={{ marginTop: 12 }}>
              <div className="mos-subcard">
                <b>Answer ({analystAnswer.model || models.textModel})</b>
                <p style={{ fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap" }}>{analystAnswer.answer}</p>
              </div>
              {analystAnswer.dataGaps && analystAnswer.dataGaps.length > 0 && (
                <div className="mos-subcard">
                  <b>Disclosed Telemetry Gaps</b>
                  <ul style={{ margin: "6px 0 0 18px", color: "var(--muted)", fontSize: 12 }}>
                    {analystAnswer.dataGaps.map((g, idx) => (
                      <li key={idx}>{g}</li>
                    ))}
                  </ul>
                </div>
              )}
              {analystAnswer.recommendedActions && analystAnswer.recommendedActions.length > 0 && (
                <div className="mos-stack">
                  {analystAnswer.recommendedActions.map((act, idx) => (
                    <div key={idx} className="mos-list-row">
                      <span>
                        <b>{act.title}</b>
                        <small>{act.reason}</small>
                      </span>
                      <span className="badge mint">
                        <i />
                        {act.priority}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="card" style={{ padding: 18 }}>
          <CardTitle
            title="Periodic Growth Reports & Exports"
            copy="Generate Daily / Weekly / Monthly summaries grounded in retrieved provider snapshots"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select
              className="filter"
              value={reportCadence}
              onChange={(e) => setReportCadence(e.target.value as "daily" | "weekly" | "monthly")}
            >
              <option value="daily">Daily Snapshot</option>
              <option value="weekly">Weekly Report</option>
              <option value="monthly">Monthly Report</option>
            </select>
            <button
              type="button"
              className="btn primary"
              disabled={generatingReport}
              onClick={() => void generateReport(false)}
            >
              {generatingReport ? "Generating…" : "Generate Report"}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={generatingReport}
              onClick={() => void generateReport(true)}
            >
              Generate & Save to AI Memory
            </button>
          </div>
          <div className="mos-stack" style={{ marginTop: 12 }}>
            {reports.length === 0 ? (
              <div className="mos-subcard" style={{ fontSize: 12, color: "var(--muted)" }}>
                No Growth Intelligence reports generated yet.
              </div>
            ) : (
              reports.slice(0, 5).map((rep) => (
                <div key={rep.id} className="mos-subcard" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <b>{rep.title}</b>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ height: 24, fontSize: 10 }}
                        onClick={() => downloadBlob(rep.markdown, `${rep.id}.md`, "text/markdown")}
                      >
                        Export MD
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ height: 24, fontSize: 10 }}
                        onClick={() =>
                          downloadBlob(JSON.stringify(rep, null, 2), `${rep.id}.json`, "application/json")
                        }
                      >
                        Export JSON
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{rep.executiveSummary}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}
