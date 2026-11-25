import type { ModelOption } from "../types/marketing";

export function ModelSelector({
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  label: string;
  value: string;
  options: ModelOption[];
  onChange: (modelId: string) => void;
  compact?: boolean;
}) {
  return (
    <label className={`mos-model-select ${compact ? "compact" : ""}`}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label} {opt.tier === "paid" ? "· Paid tier" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
