import React from "react";

interface State {
  hasError: boolean;
  message: string;
  details?: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    let message = error.message || "Unexpected application error";
    let details: string | undefined;
    try {
      const parsed = JSON.parse(message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed?.error) {
        message = parsed.error;
        details = `Operation: ${parsed.operationType || "unknown"} · Path: ${parsed.path || "n/a"}`;
      }
    } catch {
      // Plain error string
    }
    return { hasError: true, message, details };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("Marketing OS ErrorBoundary:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: 24,
            background: "var(--bg)",
            color: "var(--text)",
          }}
        >
          <div
            className="card"
            style={{ maxWidth: 520, width: "100%", padding: 28, display: "grid", gap: 14 }}
          >
            <span className="badge review">
              <i /> Workspace Recovery
            </span>
            <h2 style={{ fontSize: 22 }}>Something interrupted this view.</h2>
            <p style={{ color: "var(--muted)", lineHeight: 1.5 }}>{this.state.message}</p>
            {this.state.details && (
              <small style={{ color: "var(--muted)", fontFamily: "monospace" }}>
                {this.state.details}
              </small>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn primary"
                onClick={() => this.setState({ hasError: false, message: "", details: undefined })}
              >
                Recover view
              </button>
              <button className="btn secondary" onClick={() => window.location.reload()}>
                Reload app
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
