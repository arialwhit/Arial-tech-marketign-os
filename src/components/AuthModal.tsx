import React, { useEffect, useState } from "react";
import {
  formatFirebaseAuthError,
  registerWithEmailPassword,
  resetPasswordEmail,
  signInWithEmailPassword,
  signInWithGoogle,
} from "../lib/firebase";

export function AuthModal({
  open,
  initialMode = "signup",
  title,
  subtitle,
  onClose,
  onAuthenticated,
}: {
  open: boolean;
  initialMode?: "signin" | "signup" | "reset";
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onAuthenticated?: () => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError("");
      setNotice("");
    }
  }, [open, initialMode]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "reset") {
        await resetPasswordEmail(email);
        setNotice("Password reset email sent. Check your inbox and follow the link to reset.");
        setBusy(false);
        return;
      }

      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        setBusy(false);
        return;
      }

      if (mode === "signup") {
        await registerWithEmailPassword({ email, password, displayName: name });
        setNotice("Account created! Verification email sent to your inbox.");
      } else {
        await signInWithEmailPassword(email, password);
      }

      onAuthenticated?.();
      onClose();
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await signInWithGoogle(false);
      if (res.redirected) {
        setNotice("Redirecting to Google Sign-In…");
        return;
      }
      onAuthenticated?.();
      onClose();
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Account Authentication"
      style={{ zIndex: 1200 }}
      onMouseDown={onClose}
    >
      <div className="mos-modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mos-modal-head">
          <div>
            <span className="badge blue">
              <i />
              Workspace Account
            </span>
            <h3 style={{ marginTop: 6 }}>
              {title ||
                (mode === "signup"
                  ? "Create your Marketing OS account"
                  : mode === "signin"
                    ? "Sign in to Marketing OS"
                    : "Reset your password")}
            </h3>
            <p style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
              {subtitle ||
                "Save your workspace, AI memory, media library, and weekly SEO reports securely across devices."}
            </p>
          </div>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mos-modal-body">
          <div className="tabs">
            <button
              type="button"
              className={mode === "signup" ? "active" : ""}
              onClick={() => {
                setMode("signup");
                setError("");
                setNotice("");
              }}
            >
              Create Account
            </button>
            <button
              type="button"
              className={mode === "signin" ? "active" : ""}
              onClick={() => {
                setMode("signin");
                setError("");
                setNotice("");
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={mode === "reset" ? "active" : ""}
              onClick={() => {
                setMode("reset");
                setError("");
                setNotice("");
              }}
            >
              Reset Password
            </button>
          </div>

          {error && (
            <div className="mos-error-box">
              <strong>Authentication error:</strong> {error}
            </div>
          )}
          {notice && <div className="mos-success-box">{notice}</div>}

          <button
            type="button"
            className="btn secondary"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => void handleGoogle()}
            disabled={busy}
          >
            {busy ? "Connecting…" : "Continue with Google"}
          </button>

          <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)" }}>
            or with email &amp; password
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="mos-stack">
            {mode === "signup" && (
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <span style={{ color: "var(--muted)" }}>Full Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Morgan"
                  autoComplete="name"
                />
              </label>
            )}
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              <span style={{ color: "var(--muted)" }}>Email Address</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="founder@company.com"
                autoComplete="email"
                required
              />
            </label>
            {mode !== "reset" && (
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <span style={{ color: "var(--muted)" }}>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  required
                />
              </label>
            )}
            <button
              type="submit"
              className="btn primary"
              disabled={busy}
              style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
            >
              {busy
                ? "Working…"
                : mode === "signup"
                  ? "Create Account & Verify Email"
                  : mode === "signin"
                    ? "Sign In"
                    : "Send Reset Email"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
