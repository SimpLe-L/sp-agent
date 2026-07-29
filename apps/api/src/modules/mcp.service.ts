import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { CreateMcpServerInput, McpServer, McpTool, UpdateMcpServerInput } from "@sp-agent/shared";
import { LocalJsonStore } from "./local-json-store.service.js";

type McpFile = { servers: McpServer[] };
type McpManifest = {
  id: string;
  name: string;
  description: string;
  kind: "connector";
  phase: string;
  status: "active" | "disabled" | "degraded";
  entrypoint: string;
  capabilities: Array<{ id: string; label: string; description: string; permissions: string[]; effects: string[]; riskLevel: string; executionPolicy: string; inputSchema: string; outputSchema: string }>;
  degradedReason?: string;
};

@Injectable()
export class McpService {
  constructor(private readonly store: LocalJsonStore) {}

  async list() {
    return (await this.read()).servers.sort((left, right) => left.name.localeCompare(right.name));
  }

  async get(id: string) {
    const server = (await this.read()).servers.find((item) => item.id === id);
    if (!server) throw new NotFoundException(`MCP server ${id} was not found.`);
    return server;
  }

  async create(input: CreateMcpServerInput) {
    const file = await this.read();
    if (file.servers.some((server) => server.id === input.id)) throw new BadRequestException(`MCP server ${input.id} already exists.`);
    const now = new Date().toISOString();
    const server: McpServer = { ...input, enabled: false, tools: [], createdAt: now, updatedAt: now };
    file.servers.push(server);
    await this.write(file);
    return server;
  }

  async update(id: string, input: UpdateMcpServerInput) {
    const file = await this.read();
    const server = requiredServer(file, id);
    Object.assign(server, input, { updatedAt: new Date().toISOString() });
    await this.write(file);
    return server;
  }

  async remove(id: string) {
    const file = await this.read();
    requiredServer(file, id);
    file.servers = file.servers.filter((server) => server.id !== id);
    await this.write(file);
    return { removed: true, id };
  }

  async discover(id: string) {
    const file = await this.read();
    const server = requiredServer(file, id);
    if (!server.enabled) throw new BadRequestException("Enable the MCP server before discovering its tools.");
    try {
      const result = await this.request(server, "tools/list", {});
      const rawTools = (result as { tools?: unknown }).tools;
      if (!Array.isArray(rawTools)) throw new BadRequestException("MCP server returned an invalid tools/list response.");
      const now = new Date().toISOString();
      server.tools = rawTools.map((tool) => normalizeTool(tool, now));
      server.lastDiscoveredAt = now;
      server.degradedReason = undefined;
      server.updatedAt = now;
      await this.write(file);
      return server;
    } catch (error) {
      server.degradedReason = error instanceof Error ? error.message : "MCP tool discovery failed.";
      server.updatedAt = new Date().toISOString();
      await this.write(file);
      throw error;
    }
  }

  async manifests(): Promise<McpManifest[]> {
    return (await this.list()).map((server) => ({
      id: extensionId(server.id),
      name: server.name,
      description: `Managed MCP server ${server.name}. Tools are discovered explicitly and execute through the local API control plane.`,
      kind: "connector" as const,
      phase: "mcp",
      status: !server.enabled ? "disabled" as const : server.degradedReason ? "degraded" as const : "active" as const,
      entrypoint: `/api/mcp/servers/${encodeURIComponent(server.id)}`,
      capabilities: server.tools.map((tool) => {
        const policy = server.toolPolicies[tool.name] ?? { effects: ["provider_call"], riskLevel: "medium", executionPolicy: "auto" };
        return {
          id: capabilityId(tool.name),
          label: tool.name,
          description: tool.description || `Call MCP tool ${tool.name}.`,
          permissions: ["mcp:invoke", `mcp:server:${server.id}`],
          effects: policy.effects,
          riskLevel: policy.riskLevel,
          executionPolicy: policy.executionPolicy,
          inputSchema: JSON.stringify(tool.inputSchema),
          outputSchema: "{ content?: unknown[], structuredContent?: unknown, isError?: boolean }"
        };
      }),
      degradedReason: server.degradedReason
    }));
  }

  async invoke(extension: string, capability: string, input: Record<string, unknown>) {
    const serverId = parseExtensionId(extension);
    const server = await this.get(serverId);
    if (!server.enabled) throw new BadRequestException("MCP server is disabled.");
    const toolName = parseCapabilityId(capability);
    const tool = server.tools.find((item) => item.name === toolName);
    if (!tool) throw new BadRequestException(`MCP tool ${toolName} has not been discovered for ${serverId}.`);
    validateToolInput(tool.inputSchema, input);
    return this.request(server, "tools/call", { name: toolName, arguments: input });
  }

  private async request(server: McpServer, method: string, params: Record<string, unknown>) {
    const result = await startClient(server);
    try {
      await result.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "sp-agent", version: "0.1.0" }
      });
      result.notify("notifications/initialized", {});
      return await result.request(method, params);
    } finally {
      result.dispose();
    }
  }

  private async read(): Promise<McpFile> {
    const value = await this.store.read<McpFile>("mcp-servers.json", { servers: [] });
    return { servers: value.servers ?? [] };
  }

  private async write(value: McpFile) {
    await this.store.write("mcp-servers.json", value);
  }
}

function requiredServer(file: McpFile, id: string) {
  const server = file.servers.find((item) => item.id === id);
  if (!server) throw new NotFoundException(`MCP server ${id} was not found.`);
  return server;
}

function normalizeTool(value: unknown, discoveredAt: string): McpTool {
  if (!value || typeof value !== "object") throw new BadRequestException("MCP server returned an invalid tool descriptor.");
  const tool = value as { name?: unknown; description?: unknown; inputSchema?: unknown };
  if (typeof tool.name !== "string" || !tool.name.trim() || tool.name.length > 160) throw new BadRequestException("MCP tool name is invalid.");
  return {
    name: tool.name,
    description: typeof tool.description === "string" ? tool.description.slice(0, 4_000) : "",
    inputSchema: tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema) ? tool.inputSchema as Record<string, unknown> : {},
    discoveredAt
  };
}

function extensionId(serverId: string) { return `mcp.${serverId}`; }
function capabilityId(toolName: string) { return `mcp.call.${toolName}`; }
function parseExtensionId(value: string) { return value.startsWith("mcp.") ? value.slice(4) : value; }
function parseCapabilityId(value: string) { return value.startsWith("mcp.call.") ? value.slice("mcp.call.".length) : value; }

async function startClient(server: McpServer) {
  const cwd = server.cwd ? resolve(server.cwd) : process.cwd();
  const child = spawn(server.command, server.args, {
    cwd,
    // Do not hand the server the desktop process environment or its credentials.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let nextId = 0;
  let stdout = "";
  let stderr = "";
  const pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const rejectAll = (reason: Error) => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(reason); }
    pending.clear();
  };
  child.on("error", (error) => rejectAll(error));
  child.stderr.on("data", (chunk: Buffer) => { stderr = bounded(`${stderr}${chunk.toString()}`); });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = bounded(`${stdout}${chunk.toString()}`);
    let boundary = stdout.indexOf("\n");
    while (boundary >= 0) {
      const line = stdout.slice(0, boundary).trim();
      stdout = stdout.slice(boundary + 1);
      boundary = stdout.indexOf("\n");
      if (!line) continue;
      try {
        const message = JSON.parse(line) as { id?: unknown; result?: unknown; error?: { message?: unknown } };
        if (typeof message.id !== "number") continue;
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new BadRequestException(typeof message.error.message === "string" ? message.error.message : "MCP server returned an error."));
        else request.resolve(message.result);
      } catch {
        // MCP servers may log malformed output to stdout; only valid JSON-RPC responses are consumed.
      }
    }
  });
  child.on("close", (code) => rejectAll(new BadRequestException(`MCP server exited with code ${code ?? "unknown"}${stderr ? `: ${stderr}` : ""}`)));
  const request = (method: string, params: Record<string, unknown>) => new Promise<unknown>((resolveRequest, rejectRequest) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new BadRequestException(`MCP ${method} timed out.`));
    }, 30_000);
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const notify = (method: string, params: Record<string, unknown>) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  return { request, notify, dispose: () => { rejectAll(new Error("MCP client closed.")); child.kill("SIGTERM"); } };
}

function bounded(value: string) {
  return Buffer.byteLength(value) <= 1_000_000 ? value : Buffer.from(value).subarray(-1_000_000).toString();
}

function validateToolInput(schema: Record<string, unknown>, input: Record<string, unknown>) {
  if (schema.type !== undefined && schema.type !== "object") return;
  const properties = schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, Record<string, unknown>>
    : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
  for (const key of required) if (input[key] === undefined) throw new BadRequestException(`MCP tool input requires ${key}.`);
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) if (!properties[key]) throw new BadRequestException(`MCP tool input does not allow ${key}.`);
  }
  for (const [key, value] of Object.entries(input)) {
    const expected = properties[key]?.type;
    if (!expected) continue;
    const valid =
      (expected === "string" && typeof value === "string") ||
      (expected === "number" && typeof value === "number") ||
      (expected === "integer" && typeof value === "number" && Number.isInteger(value)) ||
      (expected === "boolean" && typeof value === "boolean") ||
      (expected === "array" && Array.isArray(value)) ||
      (expected === "object" && value !== null && typeof value === "object" && !Array.isArray(value));
    if (!valid) throw new BadRequestException(`MCP tool input ${key} must be ${expected}.`);
  }
}
