import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { CapabilityAuditEvent, ExtensionInvocationAudit } from "@sp-agent/shared";
import { LocalJsonStore } from "./local-json-store.service.js";

type CapabilityAuditFile = { events: CapabilityAuditEvent[] };

export type RecordCapabilityAuditInput = {
  extensionId: string;
  capabilityId: string;
  sessionId?: string;
  runtimeId?: string;
  skillId?: string;
  status: CapabilityAuditEvent["status"];
  permissionAudit: ExtensionInvocationAudit;
  input: Record<string, unknown>;
  result?: unknown;
  degradedReason?: string;
};

@Injectable()
export class CapabilityAuditService {
  constructor(@Inject(LocalJsonStore) private readonly store: LocalJsonStore) {}

  async list(input: { sessionId?: string; extensionId?: string; limit?: number } = {}) {
    const events = (await this.store.read<CapabilityAuditFile>("capability-audit.json", { events: [] })).events ?? [];
    return events
      .filter((event) => !input.sessionId || event.sessionId === input.sessionId)
      .filter((event) => !input.extensionId || event.extensionId === input.extensionId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit ?? 100);
  }

  async record(input: RecordCapabilityAuditInput) {
    const event: CapabilityAuditEvent = {
      id: `capability_audit_${crypto.randomUUID()}`,
      extensionId: input.extensionId,
      capabilityId: input.capabilityId,
      sessionId: input.sessionId,
      runtimeId: input.runtimeId,
      skillId: input.skillId,
      status: input.status,
      permissionAudit: input.permissionAudit,
      inputDigest: digest(input.input),
      inputSummary: summarizeInput(input.input),
      scope: scopeFor(input.extensionId, input.capabilityId, input.input),
      resultSummary: input.result === undefined ? undefined : summarizeResult(input.result),
      degradedReason: input.degradedReason,
      createdAt: new Date().toISOString()
    };
    await this.store.mutate<CapabilityAuditFile, void>("capability-audit.json", { events: [] }, (file) => {
      file.events.push(event);
      if (file.events.length > 5_000) file.events.splice(0, file.events.length - 5_000);
    });
    return event;
  }
}

function digest(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function summarizeInput(input: Record<string, unknown>) {
  const summary: Record<string, unknown> = { keys: Object.keys(input).sort() };
  for (const [key, value] of Object.entries(input)) {
    if (/audio|token|secret|password|credential|key/i.test(key)) {
      summary[key] = "[redacted]";
    } else if (typeof value === "string") {
      summary[key] = value.length > 240 ? `${value.slice(0, 240)}...` : value;
    } else if (Array.isArray(value)) {
      summary[key] = { type: "array", length: value.length };
    } else if (value && typeof value === "object") {
      summary[key] = { type: "object", keys: Object.keys(value as Record<string, unknown>).sort().slice(0, 30) };
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

function scopeFor(extensionId: string, capabilityId: string, input: Record<string, unknown>) {
  const scope: Record<string, unknown> = { extensionId, capabilityId };
  for (const key of ["path", "cwd", "skillId", "version", "serverId", "toolName", "repositoryUrl", "skillPath"]) {
    if (input[key] !== undefined) scope[key] = input[key];
  }
  return scope;
}

function summarizeResult(value: unknown): Record<string, unknown> {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "string") return { type: "string", length: value.length };
  if (typeof value === "object") return { type: "object", keys: Object.keys(value as Record<string, unknown>).sort().slice(0, 30) };
  return { type: typeof value, value };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}
