import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { approvalRequestSchema, type ApprovalRequest, type CreateApprovalRequestInput, type DecideApprovalRequestInput } from "@sp-agent/shared";
import { LocalJsonStore } from "./local-json-store.service.js";

type ApprovalsFile = {
  requests: ApprovalRequest[];
};

@Injectable()
export class ApprovalsService {
  constructor(@Inject(LocalJsonStore) private readonly store: LocalJsonStore) {}

  async list(status?: ApprovalRequest["status"]) {
    const file = await this.readFile();
    const changed = expireRequests(file.requests);
    if (changed) await this.writeFile(file);
    const requests = file.requests;
    return (status ? requests.filter((request) => request.status === status) : requests).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(input: CreateApprovalRequestInput) {
    return this.store.mutate<ApprovalsFile, { approval: ApprovalRequest }>("approvals.json", { requests: [] }, (raw) => {
      const file = normalizeFile(raw);
      if (input.idempotencyKey) {
        const existing = file.requests.find((request) => request.idempotencyKey === input.idempotencyKey && request.action === input.action && request.sessionId === input.sessionId);
        if (existing) return { approval: existing };
      }
      const now = new Date().toISOString();
      const request: ApprovalRequest = {
        id: `approval_${crypto.randomUUID()}`,
        extensionId: input.extensionId,
        capabilityId: input.capabilityId,
        action: input.action,
        reason: input.reason,
        permissions: input.permissions,
        input: input.input,
        status: "pending",
        executionPolicy: input.executionPolicy ?? "single_use",
        idempotencyKey: input.idempotencyKey,
        sessionId: input.sessionId,
        createdAt: now,
        updatedAt: now,
        expiresAt: approvalExpiry(now)
      };
      file.requests.push(request);
      raw.requests = file.requests;
      return { approval: request };
    });
  }

  async decide(id: string, input: DecideApprovalRequestInput) {
    const file = await this.readFile();
    const request = findApproval(file, id);
    if (expireRequest(request)) {
      await this.writeFile(file);
      throw new BadRequestException(`Approval request ${id} has expired`);
    }
    if (request.status !== "pending") throw new BadRequestException(`Approval request ${id} is already ${request.status}`);
    const now = new Date().toISOString();
    request.status = input.decision;
    request.updatedAt = now;
    request.decidedAt = now;
    if (input.reason) {
      request.reason = `${request.reason}\nDecision: ${input.reason}`;
    }
    await this.writeFile(file);
    return { approval: request };
  }

  async requireApproved(id: string) {
    const file = await this.readFile();
    const request = findApproval(file, id);
    if (expireRequest(request)) await this.writeFile(file);
    return request.status === "approved" ? request : undefined;
  }

  async requireApprovedFor(
    id: string,
    input: { extensionId: string; capabilityId: string; input: Record<string, unknown>; idempotencyKey?: string; sessionId?: string }
  ) {
    const file = await this.readFile();
    const request = findApproval(file, id);
    if (expireRequest(request)) {
      await this.writeFile(file);
      return undefined;
    }
    if (request.status !== "approved") {
      throw new BadRequestException(`Approval request ${id} is ${request.status}; request a new approval without reusing this id`);
    }
    if (
      request.extensionId !== input.extensionId ||
      request.capabilityId !== input.capabilityId ||
      stableStringify(request.input) !== stableStringify(input.input) ||
      request.idempotencyKey !== input.idempotencyKey ||
      request.sessionId !== input.sessionId
    ) {
      throw new BadRequestException(`Approval request ${id} does not match the requested extension action`);
    }
    return request;
  }

  async consumeApproved(id: string) {
    return this.store.mutate<ApprovalsFile, ApprovalRequest>("approvals.json", { requests: [] }, (raw) => {
      const file = normalizeFile(raw);
      const request = findApproval(file, id);
      if (request.executionPolicy === "reusable") return request;
      if (expireRequest(request)) throw new BadRequestException(`Approval request ${id} has expired`);
      if (request.status !== "approved") throw new BadRequestException(`Approval request ${id} is already ${request.status}`);
      const now = new Date().toISOString();
      request.status = "consumed";
      request.consumedAt = now;
      request.updatedAt = now;
      raw.requests = file.requests;
      return request;
    });
  }

  private async readFile(): Promise<ApprovalsFile> {
    const file = await this.store.read<ApprovalsFile>("approvals.json", { requests: [] });
    return { requests: (file.requests ?? []).map((request) => approvalRequestSchema.parse(request)) };
  }

  private async writeFile(file: ApprovalsFile) {
    await this.store.write("approvals.json", file);
  }
}

function approvalExpiry(now: string) {
  const configured = Number(process.env.SP_AGENT_APPROVAL_TTL_MS ?? 10 * 60 * 1000);
  const ttlMs = Number.isFinite(configured) && configured > 0 ? configured : 10 * 60 * 1000;
  return new Date(Date.parse(now) + ttlMs).toISOString();
}

function expireRequests(requests: ApprovalRequest[]) {
  let changed = false;
  for (const request of requests) {
    if (expireRequest(request)) changed = true;
  }
  return changed;
}

function expireRequest(request: ApprovalRequest) {
  if ((request.status !== "pending" && request.status !== "approved") || !request.expiresAt) return false;
  if (Date.parse(request.expiresAt) > Date.now()) return false;
  const now = new Date().toISOString();
  request.status = "expired";
  request.updatedAt = now;
  return true;
}

function findApproval(file: ApprovalsFile, id: string) {
  const request = file.requests.find((item) => item.id === id);
  if (!request) throw new NotFoundException(`Approval request ${id} not found`);
  return request;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function normalizeFile(file: ApprovalsFile): ApprovalsFile {
  return { requests: (file.requests ?? []).map((request) => approvalRequestSchema.parse(request)) };
}
