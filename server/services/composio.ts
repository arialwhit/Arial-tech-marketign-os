import { Composio } from "@composio/core";
import { stateStore } from "./stateStore.js";

const DEFAULT_MCP_URL = "https://connect.composio.dev/mcp";

export const MARKETING_TOOLKITS = [
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "linkedin",
  "twitter",
  "metaads",
  "google_search_console",
  "stripe",
] as const;

export type MarketingToolkitSlug = (typeof MARKETING_TOOLKITS)[number];

export interface ComposioAccountSummary {
  id: string;
  toolkit: string;
  status: "active" | "initiated" | "failed" | "disconnected";
  isDefault: boolean;
  accountType?: string;
  username?: string;
  displayName?: string;
  externalUserId?: string;
  userInfo?: Record<string, unknown>;
}

export interface ComposioToolkitStatus {
  toolkit: string;
  status: string;
  accounts: ComposioAccountSummary[];
  redirectUrl?: string;
}

interface McpToolResponse<T = Record<string, unknown>> {
  successful?: boolean;
  data?: T;
  error?: string | null;
  log_id?: string;
}

function getKey(): string {
  return (process.env.COMPOSIO_API_KEY || "").trim();
}

export function getComposioMode(): "mcp_consumer_key" | "v3_api_key" | "unconfigured" {
  const key = getKey();
  if (!key) return "unconfigured";
  if (key.startsWith("ck_")) return "mcp_consumer_key";
  return "v3_api_key";
}

export function isComposioConfigured(): boolean {
  return Boolean(getKey());
}

export function getComposioMcpUrl(): string {
  return (process.env.COMPOSIO_MCP_URL || DEFAULT_MCP_URL).trim();
}

let cachedV3Client: Composio | null = null;
function getV3Client(): Composio {
  if (!cachedV3Client) {
    cachedV3Client = new Composio({ apiKey: getKey() });
  }
  return cachedV3Client;
}

async function callComposioMcp<T = Record<string, unknown>>(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 25000,
): Promise<McpToolResponse<T>> {
  const key = getKey();
  if (!key) {
    throw new Error("COMPOSIO_API_KEY is not configured on the server.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(getComposioMcpUrl(), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Composio MCP HTTP ${response.status}: ${raw.slice(0, 240)}`);
    }

    const dataLines = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);

    const jsonLine = dataLines.length > 0 ? dataLines[dataLines.length - 1] : raw;
    const rpc = JSON.parse(jsonLine) as {
      result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
      error?: { message?: string };
    };

    if (rpc.error?.message) {
      throw new Error(`Composio MCP error: ${rpc.error.message}`);
    }

    const contentText = rpc.result?.content?.[0]?.text;
    if (!contentText) {
      return { successful: !rpc.result?.isError, data: {} as T };
    }

    try {
      return JSON.parse(contentText) as McpToolResponse<T>;
    } catch {
      return { successful: !rpc.result?.isError, data: { rawText: contentText } as unknown as T };
    }
  } finally {
    clearTimeout(timer);
  }
}

function normalizeMcpAccounts(toolkit: string, rawList: unknown): ComposioAccountSummary[] {
  if (!Array.isArray(rawList)) return [];
  return rawList.map((item) => {
    const obj = (item || {}) as Record<string, unknown>;
    const userInfo = (obj.user_info || {}) as Record<string, unknown>;
    const username =
      typeof userInfo.username === "string"
        ? userInfo.username
        : typeof userInfo.handle === "string"
          ? userInfo.handle
          : typeof obj.alias === "string"
            ? obj.alias
            : undefined;
    const displayName =
      typeof userInfo.name === "string"
        ? userInfo.name
        : typeof userInfo.display_name === "string"
          ? userInfo.display_name
          : username;
    return {
      id: String(obj.id || ""),
      toolkit,
      status: (String(obj.status || "active").toLowerCase() as ComposioAccountSummary["status"]),
      isDefault: Boolean(obj.is_default),
      accountType: typeof obj.account_type === "string" ? obj.account_type : undefined,
      username,
      displayName,
      externalUserId: typeof userInfo.id === "string" ? userInfo.id : undefined,
      userInfo,
    };
  });
}

export async function probeComposioHealth(): Promise<{
  configured: boolean;
  mode: ReturnType<typeof getComposioMode>;
  mcpUrl: string;
  reachable: boolean;
  error?: string;
}> {
  const mode = getComposioMode();
  const mcpUrl = getComposioMcpUrl();
  if (mode === "unconfigured") {
    return { configured: false, mode, mcpUrl, reachable: false, error: "COMPOSIO_API_KEY missing" };
  }

  try {
    if (mode === "mcp_consumer_key") {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(mcpUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${getKey()}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "marketing-os", version: "1.0.0" },
            },
          }),
        });
        return { configured: true, mode, mcpUrl, reachable: res.ok };
      } finally {
        clearTimeout(timer);
      }
    }

    await getV3Client().authConfigs.list({});
    return { configured: true, mode, mcpUrl, reachable: true };
  } catch (err) {
    return {
      configured: true,
      mode,
      mcpUrl,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function listComposioConnections(
  toolkits: string[] = [...MARKETING_TOOLKITS],
  workspaceId = "default",
): Promise<{
  statuses: Record<string, ComposioToolkitStatus>;
  accounts: ComposioAccountSummary[];
  mode: ReturnType<typeof getComposioMode>;
}> {
  const mode = getComposioMode();
  if (mode === "unconfigured") {
    return { statuses: {}, accounts: [], mode };
  }

  if (mode === "mcp_consumer_key") {
    const res = await callComposioMcp<{
      results?: Record<
        string,
        { toolkit?: string; status?: string; accounts?: unknown[]; error?: string }
      >;
    }>("COMPOSIO_MANAGE_CONNECTIONS", {
      toolkits: toolkits.slice(0, 12).map((name) => ({ name, action: "list" })),
    });

    if (!res.successful && res.error) {
      throw new Error(res.error);
    }

    const statuses: Record<string, ComposioToolkitStatus> = {};
    const allAccounts: ComposioAccountSummary[] = [];
    const results = res.data?.results || {};

    for (const tk of toolkits) {
      const entry = results[tk];
      const accounts = normalizeMcpAccounts(tk, entry?.accounts);
      statuses[tk] = {
        toolkit: tk,
        status: entry?.status || (accounts.some((a) => a.status === "active") ? "active" : "not_connected"),
        accounts,
      };
      allAccounts.push(...accounts);
    }

    stateStore.addIntegrationLog({
      workspaceId,
      provider: "composio",
      toolkit: toolkits.join(","),
      action: "list_connections",
      status: "success",
      detail: `Synced ${allAccounts.length} active account(s) across ${toolkits.length} toolkits`,
    });

    return { statuses, accounts: allAccounts, mode };
  }

  // Standard v3 SDK path for ak_ keys
  const client = getV3Client();
  const list = await client.connectedAccounts.list({ toolkitSlugs: toolkits });
  const statuses: Record<string, ComposioToolkitStatus> = {};
  const allAccounts: ComposioAccountSummary[] = [];

  for (const tk of toolkits) {
    statuses[tk] = { toolkit: tk, status: "not_connected", accounts: [] };
  }

  for (const item of list.items || []) {
    const tk = item.toolkit?.slug || "unknown";
    const status = String(item.status || "active").toLowerCase() as ComposioAccountSummary["status"];
    const summary: ComposioAccountSummary = {
      id: item.id,
      toolkit: tk,
      status,
      isDefault: true,
    };
    if (!statuses[tk]) statuses[tk] = { toolkit: tk, status: "not_connected", accounts: [] };
    statuses[tk].accounts.push(summary);
    if (status === "active") statuses[tk].status = "active";
    allAccounts.push(summary);
  }

  return { statuses, accounts: allAccounts, mode };
}

export async function initiateComposioConnection(params: {
  toolkit: string;
  alias?: string;
  callbackUrl?: string;
  workspaceId?: string;
  userId?: string;
}): Promise<{
  toolkit: string;
  status: string;
  redirectUrl: string;
  accountId?: string;
}> {
  const toolkit = params.toolkit.trim().toLowerCase();
  const workspaceId = params.workspaceId || "default";
  const mode = getComposioMode();
  if (mode === "unconfigured") {
    throw new Error("COMPOSIO_API_KEY is not configured.");
  }

  if (mode === "mcp_consumer_key") {
    const res = await callComposioMcp<{
      results?: Record<
        string,
        {
          toolkit?: string;
          status?: string;
          redirect_url?: string;
          redirectUrl?: string;
          connected_account_id?: string;
          error?: string;
        }
      >;
    }>("COMPOSIO_MANAGE_CONNECTIONS", {
      toolkits: [
        {
          name: toolkit,
          action: "add",
          ...(params.alias ? { alias: params.alias.slice(0, 120) } : {}),
        },
      ],
      ...(params.callbackUrl ? { custom_callback_url: params.callbackUrl } : {}),
    });

    const entry = res.data?.results?.[toolkit];
    const redirectUrl = entry?.redirect_url || entry?.redirectUrl || "";
    if (!res.successful && res.error) {
      throw new Error(res.error);
    }
    if (entry?.error) {
      throw new Error(entry.error);
    }
    if (!redirectUrl) {
      throw new Error(`Composio did not return an OAuth Connect Link for toolkit "${toolkit}".`);
    }

    stateStore.addIntegrationLog({
      workspaceId,
      provider: "composio",
      toolkit,
      action: "initiate_connect",
      accountId: entry?.connected_account_id,
      status: "initiated",
      detail: `Generated OAuth Connect Link for ${toolkit}`,
    });

    return {
      toolkit,
      status: entry?.status || "initiated",
      redirectUrl,
      accountId: entry?.connected_account_id,
    };
  }

  // v3 SDK flow with managed auth config discovery
  const client = getV3Client();
  const configs = await client.authConfigs.list({ toolkit });
  let authConfigId = configs.items?.[0]?.id;
  if (!authConfigId) {
    const created = await client.authConfigs.create(toolkit, {
      type: "use_composio_managed_auth",
      name: `${toolkit}-managed`,
    });
    authConfigId = created.id;
  }
  const link = await client.connectedAccounts.link(params.userId || workspaceId, authConfigId, {
    callbackUrl: params.callbackUrl,
  });
  return {
    toolkit,
    status: "initiated",
    redirectUrl: link.redirectUrl || "",
    accountId: link.id,
  };
}

export async function disconnectComposioAccount(params: {
  toolkit: string;
  accountId: string;
  workspaceId?: string;
}): Promise<{ removed: boolean; toolkit: string; accountId: string }> {
  const mode = getComposioMode();
  const workspaceId = params.workspaceId || "default";
  if (mode === "unconfigured") throw new Error("COMPOSIO_API_KEY is not configured.");

  if (mode === "mcp_consumer_key") {
    const res = await callComposioMcp<{
      results?: Record<string, { status?: string; error?: string }>;
    }>("COMPOSIO_MANAGE_CONNECTIONS", {
      toolkits: [
        {
          name: params.toolkit,
          action: "remove",
          account_id: params.accountId,
        },
      ],
    });
    if (!res.successful && res.error) {
      throw new Error(res.error);
    }
    const entry = res.data?.results?.[params.toolkit];
    if (entry?.error) throw new Error(entry.error);

    stateStore.addIntegrationLog({
      workspaceId,
      provider: "composio",
      toolkit: params.toolkit,
      action: "disconnect_account",
      accountId: params.accountId,
      status: "success",
      detail: `Disconnected ${params.toolkit} account ${params.accountId}`,
    });

    return { removed: true, toolkit: params.toolkit, accountId: params.accountId };
  }

  await getV3Client().connectedAccounts.delete(params.accountId);
  return { removed: true, toolkit: params.toolkit, accountId: params.accountId };
}

export async function executeComposioTool<T = Record<string, unknown>>(params: {
  toolkit: string;
  toolSlug: string;
  arguments: Record<string, unknown>;
  accountId?: string;
  workspaceId?: string;
  userId?: string;
}): Promise<{ successful: boolean; data: T; error?: string; logId?: string }> {
  const mode = getComposioMode();
  const workspaceId = params.workspaceId || "default";
  if (mode === "unconfigured") {
    throw new Error("COMPOSIO_API_KEY is not configured on the server.");
  }

  const started = Date.now();
  try {
    if (mode === "mcp_consumer_key") {
      const toolCall: Record<string, unknown> = {
        tool_slug: params.toolSlug,
        arguments: params.arguments,
      };
      if (params.accountId) {
        toolCall.connected_account_id = params.accountId;
      }

      const rpcRes = await callComposioMcp<{
        results?: Array<{
          tool_slug?: string;
          index?: number;
          response?: {
            successful?: boolean;
            data?: T;
            error?: string | null;
          };
        }>;
      }>("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [toolCall] }, 45000);

      const first = rpcRes.data?.results?.[0]?.response;
      const ok = Boolean(rpcRes.successful !== false && first?.successful !== false);
      const errMsg = first?.error || rpcRes.error || undefined;
      const latencyMs = Date.now() - started;

      stateStore.addIntegrationLog({
        workspaceId,
        provider: "composio",
        toolkit: params.toolkit,
        action: params.toolSlug,
        accountId: params.accountId,
        status: ok ? "success" : "error",
        latencyMs,
        detail: ok
          ? `Executed ${params.toolSlug} successfully (${latencyMs}ms)`
          : `Failed ${params.toolSlug}: ${errMsg || "Unknown tool error"}`,
      });

      if (!ok) {
        throw new Error(errMsg || `Composio tool ${params.toolSlug} failed.`);
      }

      return {
        successful: true,
        data: (first?.data || {}) as T,
        logId: rpcRes.log_id,
      };
    }

    const res = await getV3Client().tools.execute(params.toolSlug, {
      userId: params.userId || workspaceId,
      arguments: params.arguments,
      connectedAccountId: params.accountId,
      dangerouslySkipVersionCheck: true,
    });
    const latencyMs = Date.now() - started;
    stateStore.addIntegrationLog({
      workspaceId,
      provider: "composio",
      toolkit: params.toolkit,
      action: params.toolSlug,
      accountId: params.accountId,
      status: res.successful ? "success" : "error",
      latencyMs,
      detail: res.successful
        ? `Executed ${params.toolSlug} (${latencyMs}ms)`
        : `Failed ${params.toolSlug}: ${res.error || "Tool error"}`,
    });
    if (!res.successful) {
      throw new Error(res.error || `Tool ${params.toolSlug} failed.`);
    }
    return {
      successful: true,
      data: (res.data || {}) as T,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    stateStore.addIntegrationLog({
      workspaceId,
      provider: "composio",
      toolkit: params.toolkit,
      action: params.toolSlug,
      accountId: params.accountId,
      status: "error",
      latencyMs,
      detail: message,
    });
    throw err;
  }
}

export async function searchComposioTools(query: string) {
  if (getComposioMode() !== "mcp_consumer_key") {
    return [];
  }
  const res = await callComposioMcp<{
    results?: Array<{
      use_case?: string;
      toolkits?: string[];
      primary_tool_slugs?: string[];
      related_tool_slugs?: string[];
    }>;
  }>("COMPOSIO_SEARCH_TOOLS", {
    queries: [{ use_case: query }],
  });
  return res.data?.results || [];
}
