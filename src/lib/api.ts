import { getDownloadURL, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import { auth, getCachedWorkspaceToken, signInWithGoogle, storage } from "./firebase";

let activeWorkspaceHeaderId = "default";

export function setActiveWorkspaceHeaderId(workspaceId: string) {
  activeWorkspaceHeaderId = workspaceId?.trim() || "default";
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-workspace-id": activeWorkspaceHeaderId,
  };
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Guest call without ID token
  }
  return headers;
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
}

async function parseJsonOrThrow<T>(res: Response, endpoint: string): Promise<T> {
  const raw = await res.text().catch(() => "");
  let data: (T & { error?: string }) | null = null;
  if (raw) {
    try {
      data = JSON.parse(raw) as T & { error?: string };
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const plainSnippet =
      !data && raw
        ? raw
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 180)
        : "";
    throw new Error(
      data?.error ||
        (plainSnippet
          ? `Request to ${endpoint} failed with HTTP ${res.status}: ${plainSnippet}`
          : `Request to ${endpoint} failed with HTTP ${res.status}`),
    );
  }

  return (data ?? ({} as T)) as T;
}

export async function apiPost<T>(
  endpoint: string,
  payload: Record<string, unknown>,
  options?: ApiRequestOptions,
): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return parseJsonOrThrow<T>(res, endpoint);
}

export async function apiGet<T>(endpoint: string, options?: ApiRequestOptions): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(endpoint, {
    headers,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return parseJsonOrThrow<T>(res, endpoint);
}

export async function apiPut<T>(
  endpoint: string,
  payload: Record<string, unknown>,
  options?: ApiRequestOptions,
): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(endpoint, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return parseJsonOrThrow<T>(res, endpoint);
}

export async function apiPatch<T>(
  endpoint: string,
  payload: Record<string, unknown>,
  options?: ApiRequestOptions,
): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(endpoint, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return parseJsonOrThrow<T>(res, endpoint);
}

export async function apiDelete<T>(
  endpoint: string,
  payload?: Record<string, unknown>,
  options?: ApiRequestOptions,
): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(endpoint, {
    method: "DELETE",
    headers,
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return parseJsonOrThrow<T>(res, endpoint);
}

export interface UploadedMediaResponse {
  id?: string;
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
  sizeBytes?: number;
  kind: "video" | "image" | "audio" | "document";
  category?: string;
  tags?: string[];
  description?: string;
  createdAt?: string;
}

function kindFromMime(mime: string): UploadedMediaResponse["kind"] {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "document";
}

async function uploadViaFirebaseStorage(
  file: File,
  metadata: { category?: string; tags?: string; description?: string },
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<UploadedMediaResponse | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "asset";
  const objectPath = `users/${user.uid}/media/${Date.now()}-${safeName}`;
  const objectRef = storageRef(storage, objectPath);
  const task = uploadBytesResumable(objectRef, file, {
    contentType: file.type || "application/octet-stream",
  });
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      task.cancel();
      reject(new Error("Upload cancelled"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    task.on(
      "state_changed",
      (snap) => {
        if (onProgress && snap.totalBytes > 0) {
          onProgress(Math.min(90, Math.round((snap.bytesTransferred / snap.totalBytes) * 90)));
        }
      },
      (err) => reject(err),
      () => resolve(),
    );
  });
  const url = await getDownloadURL(task.snapshot.ref);
  const registered = await apiPost<UploadedMediaResponse>("/api/media/register", {
    url,
    originalName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    category: metadata.category || "",
    tags: metadata.tags || "",
    description: metadata.description || "",
  });
  onProgress?.(100);
  return {
    ...registered,
    url: registered.url || url,
    originalName: registered.originalName || file.name,
    mimeType: registered.mimeType || file.type || "application/octet-stream",
    size: registered.size || file.size,
    kind: registered.kind || kindFromMime(file.type || ""),
  };
}

export async function uploadMediaFile(file: File): Promise<UploadedMediaResponse> {
  return uploadMediaFileWithProgress(file);
}

export async function keepGeneratedFile(localUrl: string, filename: string): Promise<string> {
  if (!localUrl.startsWith("/uploads/") || !auth.currentUser) return localUrl;
  const res = await fetch(localUrl);
  if (!res.ok) return localUrl;
  const blob = await res.blob();
  const file = new File([blob], filename || "render.mp4", { type: blob.type || "video/mp4" });
  const stored = await uploadMediaFileWithProgress(file, { category: "product_demo_video" });
  return stored.url || localUrl;
}

export async function uploadMediaFileWithProgress(
  file: File,
  metadata: { category?: string; tags?: string; description?: string } = {},
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<UploadedMediaResponse> {
  if (auth.currentUser) {
    try {
      const cloud = await uploadViaFirebaseStorage(file, metadata, onProgress, signal);
      if (cloud) return cloud;
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === "Upload cancelled") throw err;
      console.warn("Firebase Storage upload fell back to local disk:", message);
    }
  }
  return uploadMediaFileToLocalDisk(file, metadata, onProgress, signal);
}

async function uploadMediaFileToLocalDisk(
  file: File,
  metadata: { category?: string; tags?: string; description?: string } = {},
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<UploadedMediaResponse> {
  const form = new FormData();
  form.append("file", file);
  if (metadata.category) form.append("category", metadata.category);
  if (metadata.tags) form.append("tags", metadata.tags);
  if (metadata.description) form.append("description", metadata.description);

  let token: string | undefined;
  try {
    token = await auth.currentUser?.getIdToken();
  } catch {
    // guest mode
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload", true);
    xhr.setRequestHeader("x-workspace-id", activeWorkspaceHeaderId);
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        reject(new Error("Upload cancelled"));
        return;
      }
      signal.addEventListener("abort", () => {
        xhr.abort();
        reject(new Error("Upload cancelled"));
      });
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}") as UploadedMediaResponse & { error?: string };
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          resolve(data);
        } else {
          reject(new Error(data.error || `Upload failed with HTTP ${xhr.status}`));
        }
      } catch {
        reject(new Error("Upload failed due to invalid server response."));
      }
    };

    xhr.onerror = () => reject(new Error("Network error while uploading file."));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(form);
  });
}

export async function replaceMediaFile(id: string, file: File): Promise<{ asset: UploadedMediaResponse & { id: string } }> {
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {
    "x-workspace-id": activeWorkspaceHeaderId,
  };
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // guest mode
  }
  const res = await fetch(`/api/media/${encodeURIComponent(id)}/replace`, {
    method: "POST",
    headers,
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as { asset?: UploadedMediaResponse & { id: string }; error?: string };
  if (!res.ok || !data.asset) {
    throw new Error(data.error || `Failed to replace media (${res.status})`);
  }
  return { asset: data.asset };
}

export async function ensureWorkspaceToken(): Promise<string> {
  const existing = getCachedWorkspaceToken();
  if (existing) return existing;
  const { workspaceToken, redirected } = await signInWithGoogle(true);
  if (redirected) {
    throw new Error("Redirecting to Google to grant Workspace permissions…");
  }
  if (!workspaceToken) {
    throw new Error("Google Workspace OAuth access token was not granted. Please approve permissions in the popup.");
  }
  return workspaceToken;
}

async function googleFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await ensureWorkspaceToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg =
      (data as { error?: { message?: string } })?.error?.message ||
      `Google Workspace API error (${res.status})`;
    if (res.status === 401) {
      throw new Error("Google Workspace session expired. Please reconnect Workspace permissions.");
    }
    throw new Error(errMsg);
  }
  return data as T;
}

export async function listDriveFiles() {
  return googleFetch<{ files?: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string }> }>(
    "https://www.googleapis.com/drive/v3/files?pageSize=12&fields=files(id,name,mimeType,modifiedTime,webViewLink)&orderBy=modifiedTime desc",
  );
}

export async function createGoogleDocBrief(title: string, bodyText: string) {
  const doc = await googleFetch<{ documentId: string; title: string }>(
    "https://docs.googleapis.com/v1/documents",
    {
      method: "POST",
      body: JSON.stringify({ title }),
    },
  );
  await googleFetch(`https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{ insertText: { location: { index: 1 }, text: bodyText } }],
    }),
  });
  return {
    ...doc,
    url: `https://docs.google.com/document/d/${doc.documentId}/edit`,
  };
}

export async function exportReportToGoogleSheets(title: string, rows: string[][]) {
  const sheet = await googleFetch<{ spreadsheetId: string; spreadsheetUrl: string }>(
    "https://sheets.googleapis.com/v4/spreadsheets",
    {
      method: "POST",
      body: JSON.stringify({
        properties: { title },
      }),
    },
  );
  if (rows.length > 0) {
    await googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`,
      {
        method: "POST",
        body: JSON.stringify({ values: rows }),
      },
    );
  }
  return sheet;
}

export async function createGoogleCalendarEvent(params: {
  summary: string;
  description: string;
  dateStr: string;
  timeStr: string;
}) {
  const startIso = new Date(`${params.dateStr}T${params.timeStr || "09:00"}:00`).toISOString();
  const endIso = new Date(new Date(startIso).getTime() + 30 * 60 * 1000).toISOString();
  return googleFetch<{ id: string; htmlLink?: string }>(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      body: JSON.stringify({
        summary: params.summary,
        description: params.description,
        start: { dateTime: startIso },
        end: { dateTime: endIso },
      }),
    },
  );
}

export async function createGoogleTask(title: string, notes: string) {
  return googleFetch<{ id: string; title: string }>(
    "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks",
    {
      method: "POST",
      body: JSON.stringify({ title, notes }),
    },
  );
}

export async function sendGmailMessage(params: { to: string; subject: string; body: string }) {
  const rawEmail = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    params.body,
  ].join("\r\n");
  const encoded = btoa(unescape(encodeURIComponent(rawEmail)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return googleFetch<{ id: string }>(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      body: JSON.stringify({ raw: encoded }),
    },
  );
}

export async function listGoogleContacts() {
  return googleFetch<{
    connections?: Array<{
      resourceName: string;
      names?: Array<{ displayName?: string }>;
      emailAddresses?: Array<{ value?: string }>;
    }>;
  }>(
    "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=15",
  );
}

export async function listGoogleForms() {
  return googleFetch<{ files?: Array<{ id: string; name: string; webViewLink?: string }> }>(
    "https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.form'&pageSize=10&fields=files(id,name,webViewLink)",
  );
}

export async function listGoogleChatSpaces() {
  return googleFetch<{ spaces?: Array<{ name: string; displayName?: string; type?: string }> }>(
    "https://chat.googleapis.com/v1/spaces?pageSize=10",
  );
}
