import { useState } from "react";
import {
  createGoogleCalendarEvent,
  createGoogleDocBrief,
  createGoogleTask,
  ensureWorkspaceToken,
  exportReportToGoogleSheets,
  listDriveFiles,
  listGoogleChatSpaces,
  listGoogleContacts,
  listGoogleForms,
  sendGmailMessage,
} from "../lib/api";
import { auth, getCachedWorkspaceToken, isGoogleSignedInUser, signInWithGoogle } from "../lib/firebase";
import type {
  CalendarPost,
  CompetitorItem,
  SeoKeywordItem,
  WorkspaceProfile,
} from "../types/marketing";

export function GoogleSignInButton({
  onClick,
  label = "Sign in with Google",
  disabled = false,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button className="google-signin-btn" onClick={onClick} disabled={disabled} type="button">
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
        />
        <path
          fill="#FBBC05"
          d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
        />
      </svg>
      <span>{label}</span>
    </button>
  );
}

export function GoogleWorkspaceModal({
  open,
  onClose,
  workspace,
  competitors,
  keywords,
  calendarPosts,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  workspace: WorkspaceProfile;
  competitors: CompetitorItem[];
  keywords: SeoKeywordItem[];
  calendarPosts: CalendarPost[];
  notify: (msg: string) => void;
}) {
  const [tab, setTab] = useState<"drive" | "sheets" | "calendar" | "gmail" | "chat">("drive");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasToken, setHasToken] = useState(() => Boolean(getCachedWorkspaceToken()));

  const [driveFiles, setDriveFiles] = useState<
    Array<{ id: string; name: string; mimeType: string; webViewLink?: string }>
  >([]);
  const [createdDocUrl, setCreatedDocUrl] = useState("");
  const [createdSheetUrl, setCreatedSheetUrl] = useState("");
  const [formsList, setFormsList] = useState<Array<{ id: string; name: string }>>([]);
  const [contacts, setContacts] = useState<Array<{ name: string; email: string }>>([]);
  const [chatSpaces, setChatSpaces] = useState<Array<{ name: string; displayName?: string }>>([]);

  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState(`Partnership idea with ${workspace.name}`);
  const [emailBody, setEmailBody] = useState(
    `Hi there,\n\nWe're building ${workspace.name} (${workspace.valueProposition}) and would love to explore a creator collaboration.\n\nBest,\nMarketing OS Team`,
  );
  const [confirmAction, setConfirmAction] = useState<null | {
    title: string;
    detail: string;
    run: () => Promise<void>;
  }>(null);

  if (!open) return null;

  const connectScopes = async () => {
    setError("");
    setBusy(true);
    try {
      const { workspaceToken } = await signInWithGoogle(true);
      setHasToken(Boolean(workspaceToken));
      notify("Google Workspace scopes connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect Google Workspace");
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await ensureWorkspaceToken();
      setHasToken(true);
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="mos-modal large card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mos-modal-head">
          <div>
            <span className="eyebrow">Connected Google Workspace</span>
            <h2>Google Workspace Hub</h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={`badge ${hasToken ? "mint" : "draft"}`}>
              <i />
              {hasToken ? "OAuth active" : "Connect required"}
            </span>
            <button className="btn ghost" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {!hasToken && (
          <div className="mos-banner-row">
            <p>
              {isGoogleSignedInUser(auth.currentUser) && auth.currentUser?.email
                ? `Signed in with Google (${auth.currentUser.email}). Authorize Drive, Docs, Sheets, Calendar, Tasks, Gmail, Contacts, Forms & Chat on this account or pick another Google account.`
                : "Authorize Google Drive, Docs, Sheets, Calendar, Tasks, Gmail, Contacts, Forms & Chat to sync real marketing deliverables directly to your Google account."}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <GoogleSignInButton
                onClick={connectScopes}
                disabled={busy}
                label={
                  busy
                    ? "Connecting…"
                    : isGoogleSignedInUser(auth.currentUser) && auth.currentUser?.email
                      ? `Connect ${auth.currentUser.email}`
                      : "Authorize Google Workspace"
                }
              />
              {isGoogleSignedInUser(auth.currentUser) && (
                <button type="button" className="btn ghost" onClick={connectScopes} disabled={busy}>
                  Use different account
                </button>
              )}
            </div>
          </div>
        )}

        <div className="tabs" style={{ marginBottom: 14 }}>
          {(
            [
              ["drive", "Drive & Docs"],
              ["sheets", "Sheets & Forms"],
              ["calendar", "Calendar & Tasks"],
              ["gmail", "Gmail & Contacts"],
              ["chat", "Chat & Keep"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <div className="mos-error-box">{error}</div>}

        {confirmAction && (
          <div className="mos-confirm-box">
            <b>Confirm Google Workspace Action: {confirmAction.title}</b>
            <p>{confirmAction.detail}</p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  const act = confirmAction;
                  setConfirmAction(null);
                  await runAction(act.run);
                }}
              >
                Confirm & execute
              </button>
              <button className="btn ghost" onClick={() => setConfirmAction(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mos-modal-body">
          {tab === "drive" && (
            <div className="mos-stack">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    runAction(async () => {
                      const res = await listDriveFiles();
                      setDriveFiles(res.files || []);
                      notify(`Loaded ${(res.files || []).length} Drive files`);
                    })
                  }
                >
                  Load recent Drive files
                </button>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() =>
                    setConfirmAction({
                      title: "Create Google Doc Brief",
                      detail: `Create a new Google Doc "${workspace.name} — Marketing Intelligence Brief" in your Google Drive?`,
                      run: async () => {
                        const text = [
                          `${workspace.name} — Marketing Intelligence Brief`,
                          `Website: ${workspace.websiteUrl}`,
                          `Industry: ${workspace.industry}`,
                          "",
                          `Positioning:\n${workspace.positioning}`,
                          "",
                          `Value Proposition:\n${workspace.valueProposition}`,
                          "",
                          `Brand Voice:\n${workspace.brandVoiceNotes}`,
                          `Words to use: ${workspace.wordsToUse}`,
                          `Words to avoid: ${workspace.wordsToAvoid}`,
                        ].join("\n");
                        const doc = await createGoogleDocBrief(
                          `${workspace.name} — Business Notebook Brief`,
                          text,
                        );
                        setCreatedDocUrl(doc.url);
                        notify("Google Doc brief created in Drive");
                      },
                    })
                  }
                >
                  Export Business Notebook to Google Docs
                </button>
              </div>
              {createdDocUrl && (
                <div className="mos-success-box">
                  Created Google Doc:{" "}
                  <a href={createdDocUrl} target="_blank" rel="noreferrer">
                    {createdDocUrl}
                  </a>
                </div>
              )}
              {driveFiles.length > 0 && (
                <div className="mos-list">
                  {driveFiles.map((f) => (
                    <div key={f.id} className="mos-list-row">
                      <span>
                        <b>{f.name}</b>
                        <small>{f.mimeType}</small>
                      </span>
                      {f.webViewLink && (
                        <a
                          className="btn secondary"
                          href={f.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "sheets" && (
            <div className="mos-stack">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() =>
                    setConfirmAction({
                      title: "Export Competitor & SEO Report to Google Sheets",
                      detail: `Create a new spreadsheet with ${competitors.length} competitors and ${keywords.length} SEO keywords?`,
                      run: async () => {
                        const rows: string[][] = [
                          ["Competitor", "Category", "Positioning", "Strength", "Weakness", "Opportunity Score"],
                          ...competitors.map((c) => [
                            c.name,
                            c.category,
                            c.positioning,
                            c.strength,
                            c.weakness,
                            String(c.opportunityScore),
                          ]),
                          [],
                          ["SEO Keyword", "Volume / Intent", "Difficulty", "Priority"],
                          ...keywords.map((k) => [
                            k.keyword,
                            k.volumeOrIntent,
                            k.difficulty,
                            k.priority,
                          ]),
                        ];
                        const sheet = await exportReportToGoogleSheets(
                          `${workspace.name} — Competitive & SEO Report`,
                          rows,
                        );
                        setCreatedSheetUrl(sheet.spreadsheetUrl);
                        notify("Exported report to Google Sheets");
                      },
                    })
                  }
                >
                  Export Competitors & Keywords to Sheets
                </button>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    runAction(async () => {
                      const res = await listGoogleForms();
                      setFormsList(res.files || []);
                      notify(`Found ${(res.files || []).length} Google Forms`);
                    })
                  }
                >
                  List Campaign Forms
                </button>
              </div>
              {createdSheetUrl && (
                <div className="mos-success-box">
                  Spreadsheet created:{" "}
                  <a href={createdSheetUrl} target="_blank" rel="noreferrer">
                    Open in Google Sheets ↗
                  </a>
                </div>
              )}
              {formsList.length > 0 && (
                <div className="mos-list">
                  {formsList.map((f) => (
                    <div key={f.id} className="mos-list-row">
                      <b>{f.name}</b>
                      <small>{f.id}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "calendar" && (
            <div className="mos-stack">
              <p style={{ color: "var(--muted)", fontSize: 12 }}>
                Sync upcoming content milestones directly to your primary Google Calendar or push
                tasks to Google Tasks.
              </p>
              <div className="mos-list">
                {calendarPosts.slice(0, 4).map((post) => (
                  <div key={post.id} className="mos-list-row">
                    <span>
                      <b>{post.title}</b>
                      <small>
                        {post.platform} · {post.dateStr} at {post.timeStr}
                      </small>
                    </span>
                    <button
                      className="btn secondary"
                      disabled={busy}
                      onClick={() =>
                        setConfirmAction({
                          title: "Sync to Google Calendar",
                          detail: `Create calendar event "${post.title} (${post.platform})" on ${post.dateStr} at ${post.timeStr}?`,
                          run: async () => {
                            await createGoogleCalendarEvent({
                              summary: `[Marketing OS] ${post.title} (${post.platform})`,
                              description: post.caption,
                              dateStr: post.dateStr,
                              timeStr: post.timeStr,
                            });
                            notify("Synced post to Google Calendar");
                          },
                        })
                      }
                    >
                      Sync event
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  setConfirmAction({
                    title: "Create Google Task",
                    detail: `Add "${workspace.name}: Review weekly SEO & content queue" to your default Google Tasks list?`,
                    run: async () => {
                      await createGoogleTask(
                        `${workspace.name}: Review weekly SEO & content queue`,
                        "Generated from Marketing OS Workspace Hub.",
                      );
                      notify("Task created in Google Tasks");
                    },
                  })
                }
              >
                Create review reminder in Google Tasks
              </button>
            </div>
          )}

          {tab === "gmail" && (
            <div className="mos-stack">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <b>Creator Outreach via Gmail</b>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    runAction(async () => {
                      const res = await listGoogleContacts();
                      const mapped = (res.connections || [])
                        .map((c) => ({
                          name: c.names?.[0]?.displayName || "Contact",
                          email: c.emailAddresses?.[0]?.value || "",
                        }))
                        .filter((c) => c.email);
                      setContacts(mapped);
                      notify(`Loaded ${mapped.length} Google Contacts`);
                    })
                  }
                >
                  Load Contacts
                </button>
              </div>
              {contacts.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {contacts.slice(0, 6).map((c) => (
                    <button
                      key={c.email}
                      className="filter"
                      onClick={() => setEmailTo(c.email)}
                    >
                      {c.name} ({c.email})
                    </button>
                  ))}
                </div>
              )}
              <div className="form-grid">
                <label className="wide">
                  <span>Recipient email</span>
                  <input
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="creator@example.com"
                  />
                </label>
                <label className="wide">
                  <span>Subject</span>
                  <input
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                  />
                </label>
                <label className="wide">
                  <span>Message</span>
                  <textarea
                    rows={4}
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                  />
                </label>
              </div>
              <button
                className="btn primary"
                disabled={busy || !emailTo.trim()}
                onClick={() =>
                  setConfirmAction({
                    title: "Send Gmail Message",
                    detail: `Send email to ${emailTo} with subject "${emailSubject}"?`,
                    run: async () => {
                      await sendGmailMessage({
                        to: emailTo.trim(),
                        subject: emailSubject,
                        body: emailBody,
                      });
                      notify(`Email sent to ${emailTo}`);
                    },
                  })
                }
              >
                Review & Send via Gmail
              </button>
            </div>
          )}

          {tab === "chat" && (
            <div className="mos-stack">
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() =>
                  runAction(async () => {
                    try {
                      const res = await listGoogleChatSpaces();
                      setChatSpaces(res.spaces || []);
                      notify(`Loaded ${(res.spaces || []).length} Google Chat spaces`);
                    } catch (err) {
                      throw new Error(
                        `${err instanceof Error ? err.message : String(err)} — Note: Google Chat API requires a Google Workspace Business/Enterprise account with a configured Chat App in Cloud Console.`,
                      );
                    }
                  })
                }
              >
                Load Google Chat Spaces
              </button>
              {chatSpaces.length > 0 && (
                <div className="mos-list">
                  {chatSpaces.map((s) => (
                    <div key={s.name} className="mos-list-row">
                      <b>{s.displayName || s.name}</b>
                      <small>{s.name}</small>
                    </div>
                  ))}
                </div>
              )}
              <div className="demo-note">
                Google Keep API is restricted by Google to Workspace Enterprise accounts using
                domain-wide delegation and is unavailable on standard consumer Google OAuth clients.
                Use Google Docs & Tasks above for personal note & action sync.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
