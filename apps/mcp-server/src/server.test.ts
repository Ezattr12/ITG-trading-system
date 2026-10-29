import { describe, expect, it } from "vitest";
import { createRequestHandler } from "./server";
import type { ToolCallResult } from "./tools";

function handler() {
  const calls: { name: string; args: unknown }[] = [];
  const callTool = async (name: string, args: unknown): Promise<ToolCallResult> => {
    calls.push({ name, args });
    return { isError: false, payload: { ok: true } };
  };
  return { handleLine: createRequestHandler(callTool), calls };
}

function parse(line: string | null): Record<string, unknown> {
  expect(line).not.toBeNull();
  return JSON.parse(line as string) as Record<string, unknown>;
}

describe("JSON-RPC / MCP protocol subset", () => {
  it("answers initialize with serverInfo, capabilities and a supported protocol version", async () => {
    const { handleLine } = handler();
    const res = parse(
      await handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26" },
        }),
      ),
    );
    const result = res.result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: { tools: Record<string, unknown> };
    };
    expect(result.protocolVersion).toBe("2025-03-26");
    expect(result.serverInfo).toEqual({ name: "itg-mcp-server", version: "0.1.0" });
    expect(result.capabilities).toEqual({ tools: {} });
  });

  it("falls back to a supported version for an unknown requested version", async () => {
    const { handleLine } = handler();
    const res = parse(
      await handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "1999-01-01" },
        }),
      ),
    );
    expect((res.result as { protocolVersion: string }).protocolVersion).toBe(
      "2025-03-26",
    );
  });

  it("notifications get no response", async () => {
    const { handleLine } = handler();
    expect(
      await handleLine(
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      ),
    ).toBeNull();
  });

  it("tools/list exposes exactly the 12 read-only tools (Stages 3 + 4)", async () => {
    const { handleLine } = handler();
    const res = parse(
      await handleLine(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })),
    );
    const tools = (res.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      "get_trade",
      "analyze_trade",
      "get_recent_trades",
      "get_performance_summary",
      "get_strategy_performance",
      "get_session_performance",
      "get_psychology_summary",
      "get_risk_status",
      "get_goal_progress",
      "get_discipline_status",
      "get_level_status",
      "get_weekly_review",
    ]);
  });

  it("tools/call wraps the tool payload as MCP content", async () => {
    const { handleLine, calls } = handler();
    const res = parse(
      await handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "get_trade", arguments: { trade_id: "x" } },
        }),
      ),
    );
    const result = res.result as {
      content: { type: string; text: string }[];
      isError: boolean;
    };
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual({ ok: true });
    expect(calls).toEqual([{ name: "get_trade", args: { trade_id: "x" } }]);
  });

  it("ping answers, unknown methods get -32601, garbage gets -32700 — and nothing throws", async () => {
    const { handleLine } = handler();
    const ping = parse(
      await handleLine(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ping" })),
    );
    expect(ping.result).toEqual({});
    const unknown = parse(
      await handleLine(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "nope" })),
    );
    expect((unknown.error as { code: number }).code).toBe(-32601);
    const garbage = parse(await handleLine("this is not json"));
    expect((garbage.error as { code: number }).code).toBe(-32700);
    expect(garbage.id).toBeNull();
  });
});
