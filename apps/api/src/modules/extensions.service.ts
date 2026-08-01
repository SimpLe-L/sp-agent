import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { findCapability, getExtensionManifest, getExtensionRuntimeStatus, parseExtensionCapabilityInput } from "@sp-agent/extensions";
import { getSpeechStatus } from "@sp-agent/speech";
import {
  artifactWriteCsvSchema,
  artifactWriteMarkdownSchema,
  consolidateMemorySchema,
  extractMemoryFromSessionSchema,
  contextBriefingSchema,
  createMemoryCandidateSchema,
  localBookmarkConnectorFileSchema,
  localBookmarkDigestSchema,
  localBookmarkSearchSchema,
  mergeMemorySchema,
  projectPlanSchema,
  promoteMemorySchema,
  projectDocSearchSchema,
  searchMemorySchema,
  summarizeMemorySessionSchema,
  type ExtensionCapability,
  type ExtensionManifest,
  type ExtensionInvocationAudit,
  type InvokeExtensionInput,
  updateMemorySchema,
  voiceSynthesizeSchema,
  voiceTranscribeSchema,
  workspaceApplyPatchSchema,
  workspaceGitSchema,
  workspaceListSchema,
  workspaceReadFileSchema,
  workspaceRunScriptSchema,
  workspaceSearchSchema,
  workspaceWriteFileSchema,
  webReadUrlSchema,
  webSearchSchema,
  skillScriptExecuteSchema
} from "@sp-agent/shared";
import { ApprovalsService } from "./approvals.service.js";
import { LocalJsonStore } from "./local-json-store.service.js";
import { MemoryService } from "./memory.service.js";
import { WorkflowsService } from "./workflows.service.js";
import { WorkspaceService } from "./workspace.service.js";
import { SkillScriptService } from "./skill-script.service.js";
import { CapabilityAuditService } from "./capability-audit.service.js";
import { McpService } from "./mcp.service.js";
import { SpeechIoService } from "./speech-io.service.js";
import { ArtifactService } from "./artifact.service.js";
import { WebService } from "./web.service.js";

type ExtensionInvocationResponse = {
  extensionId: string;
  capabilityId: string;
  permissionAudit: ExtensionInvocationAudit;
  status: "completed" | "degraded" | "pending_approval";
  result: unknown;
  degradedReason?: string;
  approval?: unknown;
};

type ExtensionHandler = {
  extensionId: string;
  capabilityId: string;
  handle: (request: InvokeExtensionInput, audit: ExtensionInvocationAudit) => Promise<ExtensionInvocationResponse>;
};

export type ExtensionInvocationContext = {
  runtimeId?: string;
  skillId?: string;
};

@Injectable()
export class ExtensionsService {
  private readonly handlers: ExtensionHandler[];

  constructor(
    @Inject(MemoryService) private readonly memoryService: MemoryService,
    @Inject(ApprovalsService) private readonly approvalsService: ApprovalsService,
    @Inject(WorkflowsService) private readonly workflowsService: WorkflowsService,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
    @Inject(SkillScriptService) private readonly skillScriptService: SkillScriptService,
    @Inject(CapabilityAuditService) private readonly capabilityAuditService: CapabilityAuditService,
    @Inject(McpService) private readonly mcpService: McpService,
    @Inject(SpeechIoService) private readonly speechIoService: SpeechIoService,
    @Inject(ArtifactService) private readonly artifactService: ArtifactService,
    @Inject(WebService) private readonly webService: WebService,
    @Inject(LocalJsonStore) private readonly store: LocalJsonStore
  ) {
    this.handlers = [
      {
        extensionId: "core.agent-shell",
        capabilityId: "extensions.inspect",
        handle: async (_request, audit) => this.completed("core.agent-shell", "extensions.inspect", audit, await this.list())
      },
      {
        extensionId: "local.memory",
        capabilityId: "memory.search",
        handle: async (request, audit) => this.completed("local.memory", "memory.search", audit, await this.memoryService.search(searchMemorySchema.parse(request.input)))
      },
      {
        extensionId: "local.memory",
        capabilityId: "memory.write_candidate",
        handle: async (request, audit) => this.completed("local.memory", "memory.write_candidate", audit, await this.memoryService.createCandidate(createMemoryCandidateSchema.parse(request.input)))
      },
      {
        extensionId: "local.memory",
        capabilityId: "memory.promote_fact",
        handle: async (request, audit) => {
          const id = requiredString(request.input.id, "id");
          return this.completed("local.memory", "memory.promote_fact", audit, await this.memoryService.promote(id, promoteMemorySchema.parse(request.input)));
        }
      },
      {
        extensionId: "local.memory",
        capabilityId: "memory.update",
        handle: async (request, audit) => {
          const id = requiredString(request.input.id, "id");
          return this.completed("local.memory", "memory.update", audit, await this.memoryService.update(id, updateMemorySchema.parse(request.input)));
        }
      },
      {
        extensionId: "local.memory",
        capabilityId: "memory.merge",
        handle: async (request, audit) => this.completed("local.memory", "memory.merge", audit, await this.memoryService.merge(mergeMemorySchema.parse(request.input)))
      },
      {
        extensionId: "local.memory",
        capabilityId: "memory.consolidate",
        handle: async (request, audit) =>
          this.completed("local.memory", "memory.consolidate", audit, await this.memoryService.consolidate(consolidateMemorySchema.parse(request.input ?? {})))
      },
      {
        extensionId: "local.memory",
        capabilityId: "memory.forget",
        handle: async (request, audit) => this.completed("local.memory", "memory.forget", audit, await this.memoryService.tombstone(requiredString(request.input.id, "id")))
      },
      {
        extensionId: "local.memory",
        capabilityId: "memory.extract_session",
        handle: async (request, audit) => this.completed("local.memory", "memory.extract_session", audit, await this.memoryService.extractFromSession(extractMemoryFromSessionSchema.parse(request.input)))
      },
      {
        extensionId: "local.memory",
        capabilityId: "memory.summarize_session",
        handle: async (request, audit) => this.completed("local.memory", "memory.summarize_session", audit, await this.memoryService.summarizeSession(summarizeMemorySessionSchema.parse(request.input)))
      },
      {
        extensionId: "local.context",
        capabilityId: "context.snapshot",
        handle: async (_request, audit) =>
          this.completed("local.context", "context.snapshot", audit, {
            now: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            runtimeProvider: process.env.AGENT_RUNTIME_PROVIDER ?? "pi",
            extensionIds: (await this.list()).extensions.map((item) => item.id)
          })
      },
      {
        extensionId: "local.workspace",
        capabilityId: "workspace.list",
        handle: async (request, audit) => this.completed("local.workspace", "workspace.list", audit, await this.workspaceService.list(...workspaceListArgs(workspaceListSchema.parse(request.input))))
      },
      {
        extensionId: "local.skill-sandbox",
        capabilityId: "skill.run_sandboxed_script",
        handle: async (request, audit) => {
          const result = await this.skillScriptService.execute(skillScriptExecuteSchema.parse(request.input));
          return result.status === "completed"
            ? this.completed("local.skill-sandbox", "skill.run_sandboxed_script", audit, result)
            : { extensionId: "local.skill-sandbox", capabilityId: "skill.run_sandboxed_script", permissionAudit: audit, status: "degraded" as const, result, degradedReason: result.degradedReason };
        }
      },
      {
        extensionId: "local.speech",
        capabilityId: "speech.transcribe",
        handle: async (request, audit) => this.completed("local.speech", "speech.transcribe", audit, await this.speechIoService.transcribe(voiceTranscribeSchema.parse(request.input)))
      },
      {
        extensionId: "local.speech",
        capabilityId: "speech.synthesize",
        handle: async (request, audit) => this.completed("local.speech", "speech.synthesize", audit, await this.speechIoService.synthesize(voiceSynthesizeSchema.parse(request.input)))
      },
      {
        extensionId: "local.workspace",
        capabilityId: "workspace.read_file",
        handle: async (request, audit) => { const input = workspaceReadFileSchema.parse(request.input); return this.completed("local.workspace", "workspace.read_file", audit, await this.workspaceService.read(input.path, input.offsetBytes, input.maxBytes)); }
      },
      {
        extensionId: "local.workspace",
        capabilityId: "workspace.search",
        handle: async (request, audit) => { const input = workspaceSearchSchema.parse(request.input); return this.completed("local.workspace", "workspace.search", audit, await this.workspaceService.search(input.query, input.path, input.maxResults)); }
      },
      {
        extensionId: "local.workspace",
        capabilityId: "workspace.write_file",
        handle: async (request, audit) => { const input = workspaceWriteFileSchema.parse(request.input); return this.completed("local.workspace", "workspace.write_file", audit, await this.workspaceService.write(input.path, input.content, input.createOnly)); }
      },
      {
        extensionId: "local.workspace",
        capabilityId: "workspace.apply_patch",
        handle: async (request, audit) => { const input = workspaceApplyPatchSchema.parse(request.input); return this.completed("local.workspace", "workspace.apply_patch", audit, await this.workspaceService.applyPatch(input.patch, input.cwd)); }
      },
      {
        extensionId: "local.workspace",
        capabilityId: "workspace.run_script",
        handle: async (request, audit) => { const input = workspaceRunScriptSchema.parse(request.input); return this.completed("local.workspace", "workspace.run_script", audit, await this.workspaceService.runScript(input.command, input.cwd, input.timeoutMs)); }
      },
      {
        extensionId: "local.workspace",
        capabilityId: "workspace.git_status",
        handle: async (request, audit) => { const input = workspaceGitSchema.parse(request.input); return this.completed("local.workspace", "workspace.git_status", audit, await this.workspaceService.gitStatus(input.cwd, input.includeDiff, input.maxBytes)); }
      },
      {
        extensionId: "local.artifacts",
        capabilityId: "artifact.write_markdown",
        handle: async (request, audit) => this.completed("local.artifacts", "artifact.write_markdown", audit, await this.artifactService.writeMarkdown(artifactWriteMarkdownSchema.parse(request.input)))
      },
      {
        extensionId: "local.artifacts",
        capabilityId: "artifact.write_csv",
        handle: async (request, audit) => this.completed("local.artifacts", "artifact.write_csv", audit, await this.artifactService.writeCsv(artifactWriteCsvSchema.parse(request.input)))
      },
      {
        extensionId: "remote.web",
        capabilityId: "web.search",
        handle: async (request, audit) => this.webResponse("remote.web", "web.search", audit, await this.webService.search(webSearchSchema.parse(request.input)))
      },
      {
        extensionId: "remote.web",
        capabilityId: "web.read_url",
        handle: async (request, audit) => this.webResponse("remote.web", "web.read_url", audit, await this.webService.read(webReadUrlSchema.parse(request.input)))
      },
      {
        extensionId: "local.context",
        capabilityId: "context.briefing",
        handle: async (request, audit) =>
          this.completed("local.context", "context.briefing", audit, await this.buildContextBriefing(contextBriefingSchema.parse(request.input ?? {})))
      },
      {
        extensionId: "local.project",
        capabilityId: "project.search_docs",
        handle: async (request, audit) =>
          this.completed(
            "local.project",
            "project.search_docs",
            audit,
            await this.workflowsService.runProjectDocSearch(projectDocSearchSchema.parse(request.input))
          )
      },
      {
        extensionId: "local.project",
        capabilityId: "project.plan",
        handle: async (request, audit) =>
          this.completed("local.project", "project.plan", audit, await this.createProjectPlan(projectPlanSchema.parse(request.input)))
      },
      {
        extensionId: "local.bookmarks",
        capabilityId: "bookmarks.search",
        handle: async (request, audit) =>
          this.completed("local.bookmarks", "bookmarks.search", audit, await this.searchLocalBookmarks(localBookmarkSearchSchema.parse(request.input)))
      },
      {
        extensionId: "local.bookmarks",
        capabilityId: "bookmarks.digest",
        handle: async (request, audit) =>
          this.completed("local.bookmarks", "bookmarks.digest", audit, await this.digestLocalBookmarks(localBookmarkDigestSchema.parse(request.input ?? {})))
      }
    ];
  }

  async list() {
    const status = getExtensionRuntimeStatus();
    const speechStatus = await getSpeechStatus();
    return {
      ...status,
      extensions: [
        ...status.extensions.map((extension) => {
        if (extension.id !== "local.speech") return extension;
        return {
          ...extension,
          status: speechStatus.ready ? "active" as const : "degraded" as const,
          degradedReason: speechStatus.ready ? undefined : speechStatus.degradedReason ?? extension.degradedReason
        };
        }),
        ...(await this.mcpService.manifests())
      ] as ExtensionManifest[]
    };
  }

  async get(id: string) {
    const extension = (await this.list()).extensions.find((item) => item.id === id);
    if (!extension) throw new NotFoundException(`Extension ${id} not found`);
    return extension;
  }

  private async resolveManifest(id: string) {
    if (!id.startsWith("mcp.")) return getExtensionManifest(id);
    return (await this.mcpService.manifests()).find((extension) => extension.id === id) as ExtensionManifest | undefined;
  }

  async getInvocationAudit(id: string, capabilityId?: string): Promise<ExtensionInvocationAudit> {
    const extension = await this.resolveManifest(id);
    if (!extension) throw new NotFoundException(`Extension ${id} not found`);
    const requestedCapabilityId = capabilityId ?? defaultCapabilityId(id);
    return buildPermissionAudit(id, requestedCapabilityId, findCapability(extension.capabilities, requestedCapabilityId));
  }

  async invoke(id: string, request: InvokeExtensionInput, context: ExtensionInvocationContext = {}) {
    const extension = await this.resolveManifest(id);
    if (!extension) throw new NotFoundException(`Extension ${id} not found`);
    const requestedCapabilityId = request.capabilityId ?? defaultCapabilityId(id);
    const audit = buildPermissionAudit(id, requestedCapabilityId, findCapability(extension.capabilities, requestedCapabilityId));
    const normalizedRequest = {
      ...request,
      input: id.startsWith("mcp.") ? request.input : parseExtensionCapabilityInput(id, requestedCapabilityId, request.input) as Record<string, unknown>
    };
    const auditContext = { sessionId: request.sessionId, ...context };
    await this.capabilityAuditService.record({
      extensionId: id,
      capabilityId: requestedCapabilityId,
      ...auditContext,
      status: "requested",
      permissionAudit: audit,
      input: normalizedRequest.input
    });

    if (!audit.allowed || audit.mode === "denied") {
      await this.capabilityAuditService.record({
        extensionId: id,
        capabilityId: requestedCapabilityId,
        ...auditContext,
        status: "denied",
        permissionAudit: audit,
        input: normalizedRequest.input,
        degradedReason: audit.reason
      });
      throw new BadRequestException("Capability is denied by its execution policy.");
    }

    const approval = await this.ensureApproved(normalizedRequest, audit, approvalReason(id, requestedCapabilityId));
    if (!approval.approved) {
      await this.capabilityAuditService.record({
        extensionId: id,
        capabilityId: requestedCapabilityId,
        ...auditContext,
        status: "pending_approval",
        permissionAudit: audit,
        input: normalizedRequest.input,
        degradedReason: approval.response.degradedReason
      });
      return approval.response;
    }

    const handler = this.handlers.find((item) => item.extensionId === id && item.capabilityId === requestedCapabilityId);
    try {
      const response = handler
        ? await handler.handle(normalizedRequest, audit)
        : id.startsWith("mcp.")
          ? this.completed(id, requestedCapabilityId, audit, await this.mcpService.invoke(id, requestedCapabilityId, normalizedRequest.input))
          : (() => { throw new BadRequestException(`Capability ${requestedCapabilityId} is not invokable for ${id}`); })();
      if (approval.approval) await this.approvalsService.consumeApproved(approval.approval.id);
      await this.capabilityAuditService.record({
        extensionId: id,
        capabilityId: requestedCapabilityId,
        ...auditContext,
        status: response.status === "completed" ? "completed" : "degraded",
        permissionAudit: audit,
        input: normalizedRequest.input,
        result: response.result,
        degradedReason: response.degradedReason
      });
      return response;
    } catch (error) {
      await this.capabilityAuditService.record({
        extensionId: id,
        capabilityId: requestedCapabilityId,
        ...auditContext,
        status: "failed",
        permissionAudit: audit,
        input: normalizedRequest.input,
        degradedReason: error instanceof Error ? error.message : "Extension invocation failed."
      });
      throw error;
    }
  }

  private completed(extensionId: string, capabilityId: string, permissionAudit: ExtensionInvocationAudit, result: unknown): ExtensionInvocationResponse {
    return {
      extensionId,
      capabilityId,
      permissionAudit,
      status: "completed",
      result
    };
  }

  private webResponse(extensionId: string, capabilityId: string, permissionAudit: ExtensionInvocationAudit, result: { degradedReason?: string }) {
    return result.degradedReason
      ? { extensionId, capabilityId, permissionAudit, status: "degraded" as const, result, degradedReason: result.degradedReason }
      : this.completed(extensionId, capabilityId, permissionAudit, result);
  }

  private async ensureApproved(request: InvokeExtensionInput, audit: ExtensionInvocationAudit, reason: string) {
    if (audit.mode === "read_only" || audit.mode === "trusted_local") return { approved: true as const, approval: undefined };
    if (request.approvalId) {
      const approved = await this.approvalsService.requireApprovedFor(request.approvalId, {
        extensionId: audit.extensionId,
        capabilityId: audit.capabilityId,
        input: request.input,
        idempotencyKey: request.idempotencyKey,
        sessionId: request.sessionId
      });
      if (approved) return { approved: true as const, approval: approved };
    }
    const approval = await this.approvalsService.create({
      extensionId: audit.extensionId,
      capabilityId: audit.capabilityId,
      action: `${audit.extensionId}.${audit.capabilityId}`,
      reason,
      permissions: audit.permissions,
      input: request.input,
      executionPolicy: audit.executionPolicy === "session_approval" ? "reusable" : "single_use",
      idempotencyKey: request.idempotencyKey,
      sessionId: request.sessionId
    });
    return {
      approved: false as const,
      response: {
        extensionId: audit.extensionId,
        capabilityId: audit.capabilityId,
        permissionAudit: audit,
        status: "pending_approval" as const,
        result: null,
        approval: approval.approval,
        degradedReason: "Capability requires explicit approval before execution."
      }
    };
  }

  private async searchLocalBookmarks(input: { query: string; limit: number }) {
    const file = localBookmarkConnectorFileSchema.parse(await this.store.read("connectors/bookmarks.json", { bookmarks: [] }));
    const terms = tokenize(input.query);
    const bookmarks = file.bookmarks
      .map((bookmark) => ({
        bookmark,
        score: scoreBookmark(bookmark, terms)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.bookmark.title.localeCompare(b.bookmark.title))
      .slice(0, input.limit)
      .map((item) => item.bookmark);
    return {
      bookmarks,
      searched: file.bookmarks.length,
      degradedReason: file.bookmarks.length === 0 ? "No local bookmark connector data is configured." : bookmarks.length === 0 ? "No configured local bookmarks matched the query." : undefined
    };
  }

  private async digestLocalBookmarks(input: { query?: string; tag?: string; limit: number }) {
    const file = localBookmarkConnectorFileSchema.parse(await this.store.read("connectors/bookmarks.json", { bookmarks: [] }));
    const terms = tokenize(input.query ?? input.tag ?? "");
    const tag = input.tag?.trim().toLowerCase();
    const filtered = file.bookmarks
      .filter((bookmark) => !tag || bookmark.tags.some((item) => item.toLowerCase() === tag))
      .map((bookmark) => ({
        bookmark,
        score: terms.length > 0 ? scoreBookmark(bookmark, terms) : 1
      }))
      .filter((item) => terms.length === 0 || item.score > 0)
      .sort((a, b) => b.score - a.score || b.bookmark.createdAt.localeCompare(a.bookmark.createdAt))
      .slice(0, input.limit)
      .map((item) => item.bookmark);
    const tagCounts = new Map<string, number>();
    for (const bookmark of filtered) {
      for (const item of bookmark.tags) {
        tagCounts.set(item, (tagCounts.get(item) ?? 0) + 1);
      }
    }
    return {
      digest: {
        query: input.query,
        tag: input.tag,
        totalConfigured: file.bookmarks.length,
        matched: filtered.length,
        topTags: [...tagCounts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 8)
          .map(([name, count]) => ({ name, count })),
        highlights: filtered.slice(0, 5).map((bookmark) => ({
          id: bookmark.id,
          title: bookmark.title,
          url: bookmark.url,
          tags: bookmark.tags,
          description: bookmark.description
        }))
      },
      bookmarks: filtered,
      degradedReason: file.bookmarks.length === 0
        ? "No local bookmark connector data is configured."
        : filtered.length === 0
          ? "No configured local bookmarks matched the digest filters."
          : undefined
    };
  }

  private async createProjectPlan(input: { goal: string; limit: number }) {
    const { workflow } = await this.workflowsService.runProjectDocSearch({ query: input.goal, limit: input.limit });
    const result = workflow.result as { hits?: Array<{ file: string; score: number; preview: string }>; searchedFiles?: string[] } | undefined;
    const hits = result?.hits ?? [];
    return {
      plan: {
        goal: input.goal,
        summary: hits.length > 0
          ? `Plan grounded in ${hits.length} allowlisted project document match${hits.length === 1 ? "" : "es"}.`
          : "No matching project documents were found; plan is limited to the requested goal and repository guardrails.",
        nextSteps: buildProjectPlanSteps(input.goal, hits),
        supportingFiles: hits.map((hit) => ({ file: hit.file, score: hit.score, preview: hit.preview })),
        searchedFiles: result?.searchedFiles ?? []
      },
      workflow,
      degradedReason: workflow.degradedReason
    };
  }

  private async buildContextBriefing(input: { includeWorkflows: boolean; workflowLimit: number }) {
    const status = await this.list();
    const extensions = status.extensions.map((extension) => ({
      id: extension.id,
      name: extension.name,
      kind: extension.kind,
      status: extension.status,
      degradedReason: extension.degradedReason,
      capabilities: extension.capabilities.map((capability) => ({
        id: capability.id,
        label: capability.label,
        permissions: capability.permissions,
        auditMode: buildPermissionAudit(extension.id, capability.id, capability).mode
      }))
    }));
    const workflowRecords = input.includeWorkflows ? await this.workflowsService.list() : [];
    const recentWorkflows = workflowRecords.slice(0, input.workflowLimit).map((workflow) => ({
      id: workflow.id,
      kind: workflow.kind,
      status: workflow.status,
      degradedReason: workflow.degradedReason,
      error: workflow.error,
      updatedAt: workflow.updatedAt,
      nodeEventCount: workflow.nodeEvents.length
    }));
    return {
      now: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      runtimeProvider: process.env.AGENT_RUNTIME_PROVIDER ?? "pi",
      safetyModel: status.safetyModel,
      extensionSummary: {
        total: extensions.length,
        active: extensions.filter((extension) => extension.status === "active").length,
        degraded: extensions.filter((extension) => extension.status === "degraded").length,
        planned: extensions.filter((extension) => extension.status === "planned").length,
        extensions
      },
      workflowSummary: input.includeWorkflows
        ? {
            total: workflowRecords.length,
            pending: workflowRecords.filter((workflow) => workflow.status === "pending").length,
            running: workflowRecords.filter((workflow) => workflow.status === "running").length,
            completed: workflowRecords.filter((workflow) => workflow.status === "completed").length,
            failed: workflowRecords.filter((workflow) => workflow.status === "failed").length,
            cancelled: workflowRecords.filter((workflow) => workflow.status === "cancelled").length,
            recent: recentWorkflows
          }
        : undefined
    };
  }
}

export function isReadOnlyExtensionCapability(audit: ExtensionInvocationAudit) {
  return audit.allowed && (audit.mode === "read_only" || audit.mode === "trusted_local");
}

function defaultCapabilityId(id: string) {
  if (id === "core.agent-shell") return "extensions.inspect";
  if (id === "local.memory") return "memory.search";
  if (id === "local.context") return "context.snapshot";
  if (id === "local.project") return "project.search_docs";
  if (id === "local.workspace") return "workspace.list";
  if (id === "local.artifacts") return "artifact.write_markdown";
  if (id === "remote.web") return "web.search";
  if (id === "local.skill-sandbox") return "skill.run_sandboxed_script";
  if (id === "local.bookmarks") return "bookmarks.search";
  if (id === "local.speech") return "speech.transcribe";
  return "extensions.inspect";
}

function buildPermissionAudit(extensionId: string, capabilityId: string, capability?: ExtensionCapability): ExtensionInvocationAudit {
  if (!capability) {
    return {
      extensionId,
      capabilityId,
      permissions: [],
      allowed: false,
      effects: [],
      riskLevel: "critical",
      executionPolicy: "always_deny",
      mode: "denied",
      reason: "Capability is not registered."
    };
  }
  const permissions = capability.permissions ?? [];
  const effects: NonNullable<ExtensionCapability["effects"]> = capability.effects?.length ? capability.effects : ["read"];
  const riskLevel = capability.riskLevel ?? "low";
  const executionPolicy = capability.executionPolicy ?? (effects.some((effect) => ["credential", "external_write", "destructive"].includes(effect)) ? "single_approval" : "auto");
  const requiresApproval = executionPolicy === "single_approval" || executionPolicy === "session_approval";
  return {
    extensionId,
    capabilityId,
    permissions,
    effects,
    riskLevel,
    executionPolicy,
    allowed: true,
    mode: executionPolicy === "always_deny" ? "denied" : requiresApproval ? "approval_required" : effects.includes("read") && effects.length === 1 ? "read_only" : "trusted_local",
    reason: executionPolicy === "always_deny" ? "Capability is explicitly denied by execution policy." : requiresApproval ? "Capability requires explicit approval under its execution policy." : "Trusted local capability is allowed to run directly and is auditable."
  };
}

function workspaceListArgs(input: { path: string; depth: number; limit: number }): [string, number, number] { return [input.path, input.depth, input.limit]; }

function approvalReason(extensionId: string, capabilityId: string) {
  return `Explicit approval is required for ${extensionId}.${capabilityId}.`;
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${name} is required`);
  return value;
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fa5._-]+/u)
        .map((term) => term.trim())
        .filter(Boolean)
    )
  );
}

function scoreBookmark(bookmark: { title: string; url: string; description?: string; tags: string[] }, terms: string[]) {
  const weightedText = [
    bookmark.title,
    bookmark.title,
    bookmark.description ?? "",
    bookmark.url,
    bookmark.tags.join(" "),
    bookmark.tags.join(" ")
  ]
    .join(" ")
    .toLowerCase();
  return terms.reduce((score, term) => score + countOccurrences(weightedText, term), 0);
}

function buildProjectPlanSteps(goal: string, hits: Array<{ file: string; preview: string }>) {
  const steps = [
    {
      id: "scope",
      title: "Confirm scope",
      detail: `Keep the work scoped to: ${goal}`
    }
  ];
  if (hits.some((hit) => hit.file === "AGENTS.md")) {
    steps.push({
      id: "rules",
      title: "Apply repository rules",
      detail: "Use AGENTS.md as the source of development conventions, safety boundaries, and active product direction."
    });
  }
  if (hits.some((hit) => hit.file === "ARCHITECTURE.md")) {
    steps.push({
      id: "architecture",
      title: "Check architecture boundaries",
      detail: "Align package boundaries, API ownership, extension permissions, memory, workflow, and speech constraints with ARCHITECTURE.md."
    });
  }
  if (hits.some((hit) => hit.file === "PROCESS.md")) {
    steps.push({
      id: "process",
      title: "Update process state",
      detail: "Record meaningful implementation progress and verification results in PROCESS.md."
    });
  }
  steps.push({
    id: "verify",
    title: "Run focused verification",
    detail: "Run the smallest smoke/typecheck set that covers the touched API, extension, workflow, memory, or renderer boundary."
  });
  return steps;
}

function countOccurrences(value: string, term: string) {
  if (!term) return 0;
  let count = 0;
  let index = value.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = value.indexOf(term, index + term.length);
  }
  return count;
}
