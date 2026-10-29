import { TOOL_DEFINITIONS, type ToolCallResult } from "./tools.js";

/**
 * The MCP protocol subset over JSON-RPC 2.0 (design §1):
 * initialize, notifications/initialized, ping, tools/list,
 * tools/call. Implemented directly — no SDK — and isolated
 * per request: a malformed line or a failing call produces an
 * error response, never a crashed process (design §5).
 */

export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export type CallToolFn = (name: string, args: unknown) => Promise<ToolCallResult>;

function resultResponse(id: string | number | null, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

export function createRequestHandler(callTool: CallToolFn) {
  async function handleOne(message: unknown): Promise<string | null> {
    if (message === null || typeof message !== "object" || Array.isArray(message)) {
      return errorResponse(null, -32600, "Invalid Request");
    }
    const request = message as JsonRpcRequest;
    const hasId = "id" in request && request.id !== undefined;
    const id = (request.id ?? null) as string | number | null;
    const method = request.method;

    if (typeof method !== "string") {
      return hasId ? errorResponse(id, -32600, "Invalid Request: method missing") : null;
    }

    // Notifications (no id) never get a response.
    if (method.startsWith("notifications/")) return null;

    switch (method) {
      case "initialize": {
        const params = (request.params ?? {}) as { protocolVersion?: unknown };
        const requested =
          typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(
          requested,
        )
          ? requested
          : DEFAULT_PROTOCOL_VERSION;
        return resultResponse(id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "itg-mcp-server", version: "0.1.0" },
        });
      }
      case "ping":
        return resultResponse(id, {});
      case "tools/list":
        return resultResponse(id, { tools: TOOL_DEFINITIONS });
      case "tools/call": {
        const params = (request.params ?? {}) as {
          name?: unknown;
          arguments?: unknown;
        };
        if (typeof params.name !== "string") {
          return errorResponse(id, -32602, "Invalid params: tool name is required");
        }
        const outcome = await callTool(params.name, params.arguments ?? {});
        const text = JSON.stringify(outcome.payload);
        return resultResponse(id, {
          content: [{ type: "text", text }],
          structuredContent: outcome.payload,
          isError: outcome.isError,
        });
      }
      default:
        return hasId ? errorResponse(id, -32601, `Method not found: ${method}`) : null;
    }
  }

  /**
   * Handle one raw input line. Returns the response line to
   * write, or null when nothing should be written (a
   * notification). Never throws.
   */
  return async function handleLine(line: string): Promise<string | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return errorResponse(null, -32700, "Parse error");
    }
    try {
      if (Array.isArray(parsed)) {
        const responses: string[] = [];
        for (const item of parsed) {
          const response = await handleOne(item);
          if (response !== null) responses.push(response);
        }
        if (responses.length === 0) return null;
        // Batch members were answered individually above; a
        // JSON-RPC batch expects one array frame back.
        return `[${responses.join(",")}]`;
      }
      return await handleOne(parsed);
    } catch {
      return errorResponse(null, -32603, "Internal error");
    }
  };
}
