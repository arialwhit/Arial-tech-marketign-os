import { useRef, useState } from "react";
import { CardTitle, PageHeader, SourceBadge } from "./IntelligenceViews";
import {
  apiDelete,
  apiPatch,
  apiPost,
  replaceMediaFile,
  uploadMediaFileWithProgress,
} from "../lib/api";
import {
  BRAND_ASSET_CATEGORIES,
  type BrandAssetCategory,
  type MediaAsset,
  type ModelPreferences,
  type Page,
  type WorkspaceProfile,
} from "../types/marketing";

interface UploadQueueItem {
  localId: string;
  file: File;
  category: BrandAssetCategory;
  tags: string;
  description: string;
  progressPct: number;
  status: "uploading" | "completed" | "cancelled" | "error";
  error?: string;
  duplicateWarning?: boolean;
  controller: AbortController;
}

export function MediaLibraryView({
  workspace,
  mediaAssets,
  models,
  onAddMediaAsset,
  onUpdateMediaAsset,
  onDeleteMediaAsset,
  onSendToVideoEditor,
  onConsumeCredits,
  go,
  notify,
}: {
  workspace: WorkspaceProfile;
  mediaAssets: MediaAsset[];
  models: ModelPreferences;
  onAddMediaAsset: (asset: MediaAsset) => void;
  onUpdateMediaAsset: (id: string, patch: Partial<MediaAsset>) => void;
  onDeleteMediaAsset: (id: string) => void;
  onSendToVideoEditor: (urls: string[]) => void;
  onConsumeCredits: (amount: number, label: string) => void;
  go: (p: Page) => void;
  notify: (s: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [batchCategory, setBatchCategory] = useState<BrandAssetCategory>("product_demo_video");
  const [batchTags, setBatchTags] = useState("");
  const [batchDesc, setBatchDesc] = useState("");
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);

  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "video" | "image" | "audio" | "document">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);

  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState<BrandAssetCategory>("product_demo_video");
  const [editTags, setEditTags] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [replacingAssetId, setReplacingAssetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const categoryLabel = (cat?: string) =>
    BRAND_ASSET_CATEGORIES.find((c) => c.id === cat)?.label || "Uncategorized";

  const startSingleUpload = async (item: UploadQueueItem) => {
    setQueue((prev) =>
      prev.map((q) =>
        q.localId === item.localId ? { ...q, status: "uploading", progressPct: 5, error: undefined } : q,
      ),
    );
    try {
      const res = await uploadMediaFileWithProgress(
        item.file,
        {
          category: item.category,
          tags: item.tags,
          description: item.description,
        },
        (pct) => {
          setQueue((prev) =>
            prev.map((q) => (q.localId === item.localId ? { ...q, progressPct: pct } : q)),
          );
        },
        item.controller.signal,
      );

      const created: MediaAsset = {
        id: res.id || `asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: res.originalName || item.file.name,
        kind: res.kind,
        url: res.url,
        durationOrSize: `${Math.max(1, Math.round((res.sizeBytes || res.size || item.file.size) / 1024))} KB`,
        sourceType: "imported",
        category: (res.category as BrandAssetCategory) || item.category,
        tags: res.tags || item.tags.split(",").map((t) => t.trim()).filter(Boolean),
        description: res.description ?? item.description,
        sizeBytes: res.sizeBytes || res.size || item.file.size,
        mimeType: res.mimeType || item.file.type,
        createdAt: res.createdAt || new Date().toISOString(),
      };
      onAddMediaAsset(created);
      setQueue((prev) =>
        prev.map((q) =>
          q.localId === item.localId ? { ...q, status: "completed", progressPct: 100 } : q,
        ),
      );
      notify(`Uploaded ${created.name} (${categoryLabel(created.category)})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      const isCancel = msg.toLowerCase().includes("cancel");
      setQueue((prev) =>
        prev.map((q) =>
          q.localId === item.localId
            ? { ...q, status: isCancel ? "cancelled" : "error", error: isCancel ? undefined : msg }
            : q,
        ),
      );
    }
  };

  const enqueueFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const newItems: UploadQueueItem[] = files.map((file) => {
      const isDup = mediaAssets.some(
        (a) => a.name === file.name && (a.sizeBytes ? a.sizeBytes === file.size : false),
      );
      return {
        localId: `upq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        category: batchCategory,
        tags: batchTags,
        description: batchDesc,
        progressPct: 0,
        status: "uploading",
        duplicateWarning: isDup,
        controller: new AbortController(),
      };
    });

    setQueue((prev) => [...newItems, ...prev]);
    for (const item of newItems) {
      void startSingleUpload(item);
    }
  };

  const handleInspectAi = async (asset: MediaAsset) => {
    setAnalyzingId(asset.id);
    try {
      const res = await apiPost<{ analysis: MediaAsset["aiAnalysis"] }>("/api/media/analyze", {
        mediaId: asset.id,
        assetUrl: asset.url,
        kind: asset.kind,
        mimeType: asset.mimeType,
        model: models.textModel,
      });
      if (res.analysis) {
        onUpdateMediaAsset(asset.id, { aiAnalysis: res.analysis });
        setPreviewAsset((curr) =>
          curr && curr.id === asset.id ? { ...curr, aiAnalysis: res.analysis } : curr,
        );
        onConsumeCredits(35, `Media Intelligence (${asset.name})`);
        notify(`Extracted visual, OCR, and feature intelligence for ${asset.name}`);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "AI inspection failed");
    } finally {
      setAnalyzingId(null);
    }
  };

  const openEdit = (asset: MediaAsset) => {
    setEditingAsset(asset);
    setEditName(asset.name);
    setEditCategory(asset.category || "brand_assets");
    setEditTags((asset.tags || []).join(", "));
    setEditDesc(asset.description || "");
  };

  const saveEdit = async () => {
    if (!editingAsset) return;
    setSavingEdit(true);
    const parsedTags = editTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      await apiPatch(`/api/media/${editingAsset.id}`, {
        originalName: editName.trim() || editingAsset.name,
        category: editCategory,
        tags: parsedTags,
        description: editDesc.trim(),
      });
    } catch {
      // Allow local-only generated assets without server record to update gracefully
    } finally {
      onUpdateMediaAsset(editingAsset.id, {
        name: editName.trim() || editingAsset.name,
        category: editCategory,
        tags: parsedTags,
        description: editDesc.trim(),
      });
      setSavingEdit(false);
      setEditingAsset(null);
      notify("Updated asset metadata");
    }
  };

  const handleDelete = async (asset: MediaAsset) => {
    try {
      await apiDelete(`/api/media/${asset.id}`);
    } catch {
      // Proceed removing local asset entry if generated locally
    }
    onDeleteMediaAsset(asset.id);
    setSelectedUrls((prev) => prev.filter((u) => u !== asset.url));
    if (previewAsset?.id === asset.id) setPreviewAsset(null);
    notify(`Removed ${asset.name}`);
  };

  const handleDeleteSelected = async () => {
    const targets = mediaAssets.filter((m) => selectedUrls.includes(m.url));
    for (const asset of targets) {
      try {
        await apiDelete(`/api/media/${asset.id}`);
      } catch {
        // Ignore if generated locally
      }
      onDeleteMediaAsset(asset.id);
    }
    setSelectedUrls([]);
    notify(`Removed ${targets.length} selected asset(s)`);
  };

  const handleReplaceFile = async (assetId: string, file: File) => {
    try {
      const { asset: updated } = await replaceMediaFile(assetId, file);
      onUpdateMediaAsset(assetId, {
        name: updated.originalName || file.name,
        kind: updated.kind,
        url: updated.url,
        sizeBytes: updated.sizeBytes || file.size,
        durationOrSize: `${Math.max(1, Math.round((updated.sizeBytes || file.size) / 1024))} KB`,
        mimeType: updated.mimeType || file.type,
      });
      notify(`Replaced media file with ${updated.originalName || file.name}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to replace file");
    } finally {
      setReplacingAssetId(null);
    }
  };

  const filtered = mediaAssets.filter((a) => {
    if (kindFilter !== "all" && a.kind !== kindFilter) return false;
    if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        (a.description || "").toLowerCase().includes(q) ||
        (a.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        (a.aiAnalysis?.extractedText || "").toLowerCase().includes(q) ||
        (a.aiAnalysis?.summary || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const toggleSelect = (url: string) => {
    setSelectedUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="Brand Asset Vault · 22 Categories"
        title="Media Library & Asset Intelligence"
        copy={`Centralized uploads, categorization, Gemini multimodal inspection, and direct Video Editor & Content Studio routing for ${workspace.name || "your workspace"}.`}
        actions={
          <>
            {selectedUrls.length > 0 && (
              <>
                <button
                  className="btn primary"
                  onClick={() => {
                    onSendToVideoEditor(selectedUrls);
                    go("Video Editor");
                  }}
                >
                  Send {selectedUrls.length} to Video Editor →
                </button>
                <button
                  className="btn ghost"
                  style={{ color: "#ff9c9c" }}
                  onClick={() => void handleDeleteSelected()}
                >
                  Delete Selected ({selectedUrls.length})
                </button>
              </>
            )}
            <button
              className="btn secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              ＋ Upload Multiple Files
            </button>
          </>
        }
      />

      <section className="card" style={{ padding: 18, marginBottom: 14 }}>
        <CardTitle
          title="Multi-File Upload & Categorization"
          copy="Product demonstration videos, product demonstration images, and product clips remain distinct for accurate AI routing."
        />
        <div className="form-grid" style={{ marginTop: 12, marginBottom: 12 }}>
          <label>
            <span>Brand Asset Category (22 categories)</span>
            <select
              value={batchCategory}
              onChange={(e) => setBatchCategory(e.target.value as BrandAssetCategory)}
            >
              {BRAND_ASSET_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Tags (comma-separated)</span>
            <input
              placeholder="e.g. Q2 launch, hero demo, pricing"
              value={batchTags}
              onChange={(e) => setBatchTags(e.target.value)}
            />
          </label>
          <label className="wide">
            <span>Asset Context / Description (optional)</span>
            <input
              placeholder="Describe what this batch showcases so Creative & Strategy agents use it accurately…"
              value={batchDesc}
              onChange={(e) => setBatchDesc(e.target.value)}
            />
          </label>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,image/*,audio/*,.pdf,.txt,.md"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) {
              enqueueFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
        <div
          className={`media-dropzone ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) enqueueFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <b style={{ display: "block", fontSize: 13 }}>
            Drag &amp; drop multiple videos, images, audio tracks, or brand PDFs here
          </b>
          <small style={{ color: "var(--muted)", display: "block", marginTop: 4 }}>
            Category selected: <strong style={{ color: "var(--mint)" }}>{categoryLabel(batchCategory)}</strong> · Max 150 MB per file
          </small>
        </div>

        {queue.length > 0 && (
          <div className="mos-stack" style={{ marginTop: 12 }}>
            {queue.slice(0, 8).map((item) => (
              <div key={item.localId} className="mos-subcard">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <b style={{ fontSize: 12 }}>{item.file.name}</b>{" "}
                    <small style={{ color: "var(--muted)" }}>
                      ({Math.max(1, Math.round(item.file.size / 1024))} KB · {categoryLabel(item.category)})
                    </small>
                    {item.duplicateWarning && (
                      <small style={{ color: "var(--gold)", display: "block" }}>
                        Notice: Filename + byte size match an existing asset in this workspace.
                      </small>
                    )}
                    {item.error && (
                      <small style={{ color: "#ff9c9c", display: "block" }}>{item.error}</small>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span className={`badge ${item.status === "completed" ? "mint" : item.status === "error" ? "high" : "blue"}`}>
                      <i />
                      {item.status === "uploading" ? `${item.progressPct}%` : item.status}
                    </span>
                    {item.status === "uploading" && (
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ height: 26, padding: "0 8px", fontSize: 11 }}
                        onClick={() => item.controller.abort()}
                      >
                        Cancel
                      </button>
                    )}
                    {(item.status === "error" || item.status === "cancelled") && (
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ height: 26, padding: "0 8px", fontSize: 11 }}
                        onClick={() =>
                          void startSingleUpload({
                            ...item,
                            controller: new AbortController(),
                          })
                        }
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
                <div className="progress-bar-track" style={{ marginTop: 6 }}>
                  <div className="progress-bar-fill" style={{ width: `${item.progressPct}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <div className="tabs">
          {(["all", "video", "image", "audio", "document"] as const).map((k) => (
            <button
              key={k}
              className={kindFilter === k ? "active" : ""}
              onClick={() => setKindFilter(k)}
            >
              {k === "all" ? "All Media" : k.toUpperCase()}{" "}
              <span>
                {k === "all"
                  ? mediaAssets.length
                  : mediaAssets.filter((m) => m.kind === k).length}
              </span>
            </button>
          ))}
        </div>

        <input
          ref={replaceInputRef}
          type="file"
          accept="video/*,image/*,audio/*,.pdf,.txt,.md"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && replacingAssetId) {
              void handleReplaceFile(replacingAssetId, f);
            }
            e.target.value = "";
          }}
        />
        <select
          className="filter"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">All 22 Categories</option>
          {BRAND_ASSET_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        <div className="filter wide">
          ⌕{" "}
          <input
            style={{ background: "none", border: 0, color: "inherit", outline: 0, width: "100%" }}
            placeholder="Search filename, tags, OCR text, features…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <h3>No matching media assets yet</h3>
          <p style={{ color: "var(--muted)", marginTop: 6, fontSize: 12 }}>
            Upload product demonstration videos, product demonstration images, clips, testimonials, or audio above to populate your brand library.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {filtered.map((asset) => {
            const isSelected = selectedUrls.includes(asset.url);
            const busyAi = analyzingId === asset.id;
            return (
              <article
                key={asset.id}
                className="card"
                style={{
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  borderColor: isSelected ? "var(--mint)" : undefined,
                }}
              >
                <div
                  style={{
                    height: 150,
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "var(--surface2)",
                    position: "relative",
                    cursor: "pointer",
                  }}
                  onClick={() => setPreviewAsset(asset)}
                >
                  {asset.kind === "video" ? (
                    <video
                      src={asset.url}
                      muted
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : asset.kind === "image" ? (
                    <img
                      src={asset.url}
                      alt={asset.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        display: "grid",
                        placeItems: "center",
                        color: "var(--mint)",
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {asset.kind === "audio" ? "♫ Audio Track" : "▤ Document"}
                    </div>
                  )}
                  <span
                    className="badge dark"
                    style={{ position: "absolute", left: 8, top: 8 }}
                  >
                    <i />
                    {asset.kind.toUpperCase()}
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <b style={{ fontSize: 12, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {asset.name}
                    </b>
                    <small style={{ color: "var(--mint)", fontSize: 10 }}>
                      {categoryLabel(asset.category)}
                    </small>
                    <small style={{ color: "var(--muted)", fontSize: 10, display: "block" }}>
                      {asset.durationOrSize}
                    </small>
                  </div>
                  <SourceBadge sourceType={asset.sourceType} />
                </div>

                {asset.description && (
                  <p style={{ fontSize: 11, color: "var(--muted)" }}>{asset.description}</p>
                )}

                {asset.tags && asset.tags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {asset.tags.slice(0, 4).map((t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {asset.aiAnalysis && (
                  <div className="mos-subcard" style={{ padding: 8 }}>
                    <small style={{ color: "var(--mint)", fontWeight: 600 }}>✦ AI Inspection</small>
                    <p style={{ fontSize: 11, marginTop: 2 }}>{asset.aiAnalysis.summary}</p>
                    {asset.aiAnalysis.productFeatures && asset.aiAnalysis.productFeatures.length > 0 && (
                      <small style={{ color: "var(--muted)", display: "block", marginTop: 4 }}>
                        Features: {asset.aiAnalysis.productFeatures.slice(0, 3).join(" · ")}
                      </small>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto" }}>
                  {(asset.kind === "video" || asset.kind === "image") && (
                    <button
                      type="button"
                      className={`btn ${isSelected ? "primary" : "secondary"}`}
                      style={{ height: 28, padding: "0 8px", fontSize: 11 }}
                      onClick={() => toggleSelect(asset.url)}
                    >
                      {isSelected ? "✓ Selected" : "+ Editor"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ height: 28, padding: "0 8px", fontSize: 11 }}
                    disabled={busyAi}
                    onClick={() => void handleInspectAi(asset)}
                  >
                    {busyAi ? "Inspecting…" : asset.aiAnalysis ? "Re-Inspect" : "✦ Inspect AI"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ height: 28, padding: "0 8px", fontSize: 11 }}
                    onClick={() => openEdit(asset)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ height: 28, padding: "0 8px", fontSize: 11 }}
                    onClick={() => {
                      setReplacingAssetId(asset.id);
                      replaceInputRef.current?.click();
                    }}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ height: 28, padding: "0 8px", fontSize: 11, color: "#ff9c9c" }}
                    onClick={() => void handleDelete(asset)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editingAsset && (
        <div className="modal-backdrop" onMouseDown={() => setEditingAsset(null)}>
          <div className="mos-modal small" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mos-modal-head">
              <h3>Edit Brand Asset</h3>
              <button className="btn ghost" onClick={() => setEditingAsset(null)}>✕</button>
            </div>
            <div className="mos-modal-body">
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <span>Display Name</span>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <span>Brand Asset Category</span>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as BrandAssetCategory)}
                >
                  {BRAND_ASSET_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <span>Tags (comma-separated)</span>
                <input value={editTags} onChange={(e) => setEditTags(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <span>Description</span>
                <textarea rows={3} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
              </label>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn ghost" onClick={() => setEditingAsset(null)}>Cancel</button>
                <button className="btn primary" disabled={savingEdit} onClick={() => void saveEdit()}>
                  {savingEdit ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewAsset && (
        <div className="modal-backdrop" onMouseDown={() => setPreviewAsset(null)}>
          <div className="mos-modal large" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mos-modal-head">
              <div>
                <span className="badge mint">
                  <i />
                  {categoryLabel(previewAsset.category)}
                </span>
                <h3 style={{ marginTop: 4 }}>{previewAsset.name}</h3>
              </div>
              <button className="btn ghost" onClick={() => setPreviewAsset(null)}>✕</button>
            </div>
            <div className="mos-modal-body">
              <a className="btn secondary" href={previewAsset.url} download={previewAsset.name} style={{ marginBottom: 10 }}>
                ↓ Download
              </a>
              {previewAsset.kind === "video" ? (
                <video
                  src={previewAsset.url}
                  controls
                  style={{ width: "100%", maxHeight: 360, borderRadius: 10, background: "#000" }}
                />
              ) : previewAsset.kind === "image" ? (
                <img
                  src={previewAsset.url}
                  alt={previewAsset.name}
                  style={{ width: "100%", maxHeight: 360, objectFit: "contain", borderRadius: 10 }}
                />
              ) : previewAsset.kind === "audio" ? (
                <audio src={previewAsset.url} controls style={{ width: "100%" }} />
              ) : (
                <a className="btn secondary" href={previewAsset.url} target="_blank" rel="noreferrer">
                  Open Document ↗
                </a>
              )}

              {previewAsset.aiAnalysis ? (
                <div className="mos-subcard">
                  <b>✦ Multimodal Intelligence ({previewAsset.aiAnalysis.model})</b>
                  <p style={{ fontSize: 12, marginTop: 6 }}>{previewAsset.aiAnalysis.summary}</p>
                  {previewAsset.aiAnalysis.visualStyle && (
                    <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                      <b>Visual style:</b> {previewAsset.aiAnalysis.visualStyle}
                    </p>
                  )}
                  {previewAsset.aiAnalysis.extractedText && (
                    <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                      <b>OCR On-Screen Text:</b> {previewAsset.aiAnalysis.extractedText}
                    </p>
                  )}
                  {previewAsset.aiAnalysis.transcript && (
                    <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                      <b>Transcript:</b> {previewAsset.aiAnalysis.transcript}
                    </p>
                  )}
                  {previewAsset.aiAnalysis.productFeatures && previewAsset.aiAnalysis.productFeatures.length > 0 && (
                    <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                      <b>Product Features:</b> {previewAsset.aiAnalysis.productFeatures.join(" · ")}
                    </p>
                  )}
                  {previewAsset.aiAnalysis.scenes && previewAsset.aiAnalysis.scenes.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <b style={{ fontSize: 11 }}>Scenes Detected</b>
                      {previewAsset.aiAnalysis.scenes.map((sc, i) => (
                        <div key={i} style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                          <b>{sc.timeRange}</b>: {sc.description}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  className="btn primary"
                  disabled={analyzingId === previewAsset.id}
                  onClick={() => void handleInspectAi(previewAsset)}
                >
                  {analyzingId === previewAsset.id ? "Analyzing with Gemini…" : "✦ Run Multimodal Asset Inspection"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
