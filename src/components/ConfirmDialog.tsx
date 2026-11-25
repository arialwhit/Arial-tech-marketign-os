export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="mos-modal small card" onMouseDown={(e) => e.stopPropagation()}>
        <span className="badge review">
          <i /> Human Approval Required
        </span>
        <h3 style={{ marginTop: 10, fontSize: 18 }}>{title}</h3>
        <p style={{ color: "var(--muted)", margin: "10px 0 18px", lineHeight: 1.5 }}>{description}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
