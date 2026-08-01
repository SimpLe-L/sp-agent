import { Inject, Injectable } from "@nestjs/common";
import {
  getAgentRuntimeStatus,
  listRuntimeAdapters,
  runPersonalAgentTurnWithAgent,
  streamPersonalAgentTurnWithAgent
} from "@sp-agent/agent-runtime";
import type { PersonalAgentExtensionInvokeRequest, PersonalAgentTurnInput, PersonalAgentTurnResult } from "@sp-agent/agent-runtime";
import type { AgentMessageResponse, AgentShellStatus, CreateAgentMessageInput, ExtensionManifest, MemorySearchResult } from "@sp-agent/shared";
import type { LocalSkillRecord } from "@sp-agent/shared";
import { ChatService } from "./chat.service.js";
import { ExtensionsService } from "./extensions.service.js";
import { LocalSkillsService } from "./local-skills.service.js";
import { MemoryService } from "./memory.service.js";
import { AgentRunsService } from "./agent-runs.service.js";

@Injectable()
export class AgentShellService {
  constructor(
    @Inject(ExtensionsService) private readonly extensionsService: ExtensionsService,
    @Inject(LocalSkillsService) private readonly localSkillsService: LocalSkillsService,
    @Inject(ChatService) private readonly chatService: ChatService,
    @Inject(MemoryService) private readonly memoryService: MemoryService,
    @Inject(AgentRunsService) private readonly agentRunsService: AgentRunsService
  ) {}

  async getStatus(): Promise<AgentShellStatus> {
    const extensionStatus = await this.extensionsService.list();
    const localSkills = await this.localSkillsService.activeManifests();
    return {
      mode: "local_personal_agent",
      piRuntime: {
        name: "agent-runtime",
        ...(await getAgentRuntimeStatus())
      },
      runtimeAdapters: listRuntimeAdapters().map((adapter) => ({
        id: adapter.id,
        label: adapter.label,
        default: adapter.default
      })),
      safetyModel: extensionStatus.safetyModel,
      extensions: [...extensionStatus.extensions, ...localSkills.map(toLocalSkillManifest)] as unknown as AgentShellStatus["extensions"]
    };
  }

  async runMessage(input: CreateAgentMessageInput, metadata: Record<string, unknown> = { source: "agent.messages" }): Promise<AgentMessageResponse> {
    const prepared = await this.prepareTurn(input, metadata);
    let result: PersonalAgentTurnResult;
    try {
      result = await runPersonalAgentTurnWithAgent(prepared.turnInput);
    } catch (error) {
      await this.agentRunsService.finish(prepared.runId, { status: "failed", provider: process.env.AGENT_RUNTIME_PROVIDER ?? "pi", degradedReason: error instanceof Error ? error.message : "Agent runtime failed.", toolCallCount: 0, artifactCount: 0 });
      throw error;
    }
    await this.persistAssistantMessage(prepared.sessionId, result, prepared.memoryContext, metadata, prepared.runId);
    await this.finishRun(prepared.runId, result);

    return {
      sessionId: prepared.sessionId,
      runId: prepared.runId,
      role: "assistant",
      content: result.content,
      provider: result.provider,
      model: result.model,
      degradedReason: result.degradedReason,
      memoryContext: prepared.memoryContext,
      activeTools: result.activeTools ?? [],
      toolCalls: result.toolCalls ?? [],
      artifacts: result.artifacts ?? []
    };
  }

  async *streamMessage(input: CreateAgentMessageInput, metadata: Record<string, unknown> = { source: "agent.messages.stream" }) {
    const prepared = await this.prepareTurn(input, metadata);
    yield {
      type: "metadata",
      sessionId: prepared.sessionId,
      runId: prepared.runId,
      memoryContextCount: prepared.memoryContext.length
    };
    try {
      for await (const event of streamPersonalAgentTurnWithAgent(prepared.turnInput)) {
        if (event.type === "text_delta") {
          yield event;
          continue;
        }
        await this.persistAssistantMessage(prepared.sessionId, event.result, prepared.memoryContext, metadata, prepared.runId);
        await this.finishRun(prepared.runId, event.result);
        yield {
          type: "done",
          sessionId: prepared.sessionId,
          result: {
            sessionId: prepared.sessionId,
            runId: prepared.runId,
            role: "assistant",
            content: event.result.content,
            provider: event.result.provider,
            model: event.result.model,
            degradedReason: event.result.degradedReason,
            memoryContext: prepared.memoryContext,
            activeTools: event.result.activeTools ?? [],
            toolCalls: event.result.toolCalls ?? [],
            artifacts: event.result.artifacts ?? []
          }
        };
      }
    } catch (error) {
      await this.agentRunsService.finish(prepared.runId, { status: "failed", provider: process.env.AGENT_RUNTIME_PROVIDER ?? "pi", degradedReason: error instanceof Error ? error.message : "Agent stream failed.", toolCallCount: 0, artifactCount: 0 });
      throw error;
    }
  }

  private async prepareTurn(input: CreateAgentMessageInput, metadata: Record<string, unknown>) {
    const extensionStatus = await this.extensionsService.list();
    const localSkills = await this.localSkillsService.activeManifests();
    const session = await this.chatService.getOrCreateSession(input.sessionId, { title: makeSessionTitle(input.content) });
    await this.chatService.createMessage(session.id, {
      role: "user",
      content: input.content,
      metadata
    });
    const memoryContext = (await this.memoryService.retrieveForAgent({ query: input.content, sessionId: session.id, limit: 8 })).memories;
    const conversationHistory = boundedConversationHistory(session.messages ?? []);
    const allowedExtensions: ExtensionManifest[] =
      input.extensionIds.length > 0
        ? extensionStatus.extensions.filter((extension) => input.extensionIds.includes(extension.id))
        : [...extensionStatus.extensions, ...localSkills.map(toLocalSkillManifest)];
    const agentVisibleExtensions = (
      await Promise.all(
        allowedExtensions.filter((extension) => extension.status === "active").map(async (extension) => {
          const capabilities = (
            await Promise.all(
              extension.capabilities.map(async (capability) => ({
                capability,
                audit: extension.id.startsWith("local.skill.") ? undefined : await this.extensionsService.getInvocationAudit(extension.id, capability.id)
              }))
            )
          )
            .filter(({ audit }) => !audit || audit.allowed)
            .map(({ capability }) => capability);
          return { ...extension, capabilities };
        })
      )
    ).filter((extension) => extension.capabilities.length > 0) as unknown as ExtensionManifest[];
    // This grant is fixed for the whole turn. Later Skill selection narrows it;
    // it can never make an undisclosed capability available.
    const turnGrant = createTurnCapabilityGrant(agentVisibleExtensions, localSkills);
    const runtimeId = process.env.AGENT_RUNTIME_PROVIDER ?? "pi";
    const run = await this.agentRunsService.start({
      sessionId: session.id,
      runtimeId,
      context: {
        messageChars: input.content.length,
        conversationMessageCount: conversationHistory.length,
        conversationChars: conversationHistory.reduce((total, message) => total + message.content.length, 0),
        memoryCount: memoryContext.length,
        memoryIds: memoryContext.map((memory) => memory.entry.id),
        extensionCount: agentVisibleExtensions.length,
        capabilityCount: agentVisibleExtensions.reduce((total, extension) => total + extension.capabilities.length, 0),
        visibleExtensionIds: agentVisibleExtensions.map((extension) => extension.id),
        activeSkillIds: localSkills.filter((skill) => skill.status === "active").map((skill) => skill.id)
      }
    });
    const turnInput: PersonalAgentTurnInput = {
      message: input.content,
      sessionId: session.id,
      conversationHistory,
      memoryContext,
      extensionManifests: agentVisibleExtensions,
      safetyModel: extensionStatus.safetyModel,
      extensionInvoker: async (request) => {
        const skillId = request.extensionId.startsWith("local.skill.") ? request.extensionId.slice("local.skill.".length) : undefined;
        await this.agentRunsService.record(run.id, "tool_requested", {
          extensionId: request.extensionId,
          capabilityId: request.capabilityId,
          skillId,
          inputKeys: Object.keys(request.input).sort()
        });
        const requestedTool = `${request.extensionId}.${request.capabilityId}`;
        if (!turnGrant.visible.has(requestedTool)) {
          const response = { ok: false, status: "denied", degradedReason: "This capability was not granted for the current agent turn." };
          await this.agentRunsService.record(run.id, "tool_completed", { extensionId: request.extensionId, capabilityId: request.capabilityId, status: response.status, degradedReason: response.degradedReason });
          return response;
        }
        let response;
        if (request.extensionId.startsWith("local.skill.")) {
          if (!turnGrant.skills.has(skillId!)) {
            response = { ok: false, status: "denied", degradedReason: "This Skill was not granted for the current agent turn." };
          } else {
            const target = turnGrant.skills.get(skillId!)?.targets.get(request.capabilityId);
            if (target) {
              response = await this.invokeAgentExtension(
                { extensionId: target.extensionId, capabilityId: target.capabilityId, input: request.input },
                { sessionId: session.id, runtimeId, skillId }
              );
            }
          }
        }
        response ??= await this.invokeAgentExtension(request, { sessionId: session.id, runtimeId, skillId });
        await this.agentRunsService.record(run.id, "tool_completed", {
          extensionId: request.extensionId,
          capabilityId: request.capabilityId,
          status: response.status,
          permissionMode: response.permissionAudit?.mode,
          degradedReason: response.degradedReason
        });
        return response;
      }
    };
    return { sessionId: session.id, runId: run.id, memoryContext, turnInput };
  }

  private async invokeAgentExtension(request: PersonalAgentExtensionInvokeRequest, context: { sessionId: string; runtimeId: string; skillId?: string }) {
    if (request.extensionId.startsWith("local.skill.")) {
      try {
        const skillId = request.extensionId.slice("local.skill.".length);
        if (request.capabilityId === "skill.load_instructions") {
          return { ok: true, status: "completed", result: await this.localSkillsService.loadInstructions(skillId) };
        }
        if (request.capabilityId === "skill.read_reference") {
          const path = request.input.path;
          if (typeof path !== "string" || !path.trim()) return { ok: false, status: "denied", degradedReason: "Reference path is required." };
          return { ok: true, status: "completed", result: await this.localSkillsService.loadReference(skillId, path) };
        }
        return { ok: false, status: "denied", degradedReason: `Local Skill capability ${request.capabilityId} is not available.` };
      } catch (error) {
        return { ok: false, status: "failed", degradedReason: error instanceof Error ? error.message : "Local Skill could not be loaded." };
      }
    }
    const audit = await this.extensionsService.getInvocationAudit(request.extensionId, request.capabilityId);
    if (!audit.allowed) {
      return {
        ok: false,
        status: "denied",
        permissionAudit: audit,
        degradedReason: "This agent turn requested an unavailable capability."
      };
    }
    try {
      const response = await this.extensionsService.invoke(request.extensionId, {
        capabilityId: request.capabilityId,
        input: request.input,
        sessionId: context.sessionId
      }, context);
      return {
        ok: !response.degradedReason,
        status: response.status,
        result: response.result,
        degradedReason: response.degradedReason,
        permissionAudit: response.permissionAudit
      };
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        permissionAudit: audit,
        degradedReason: error instanceof Error ? error.message : "Extension invocation failed."
      };
    }
  }

  private async persistAssistantMessage(sessionId: string, result: PersonalAgentTurnResult, memoryContext: MemorySearchResult[], metadata: Record<string, unknown>, runId: string) {
    await this.chatService.createMessage(sessionId, {
      role: "assistant",
      content: result.content,
      metadata: {
        ...metadata,
        runId,
        provider: result.provider,
        model: result.model,
        degradedReason: result.degradedReason,
        memoryContextCount: memoryContext.length,
        memoryContextDebug: memoryContext.map(toMemoryContextDebug),
        activeTools: result.activeTools ?? [],
        toolCalls: result.toolCalls ?? [],
        artifacts: result.artifacts ?? []
      }
    });
  }

  private async finishRun(runId: string, result: PersonalAgentTurnResult) {
    await this.agentRunsService.finish(runId, {
      status: result.degradedReason ? "degraded" : "completed",
      provider: result.provider,
      model: result.model,
      degradedReason: result.degradedReason,
      toolCallCount: result.toolCalls?.length ?? 0,
      artifactCount: result.artifacts?.length ?? 0
    });
  }
}

function createTurnCapabilityGrant(extensions: ExtensionManifest[], localSkills: LocalSkillRecord[]) {
  const visibleTargets = new Map<string, { extensionId: string; capabilityId: string }>(
    extensions
      .filter((extension) => !extension.id.startsWith("local.skill."))
      .flatMap((extension) => extension.capabilities.map((capability) => [`${extension.id}.${capability.id}`, { extensionId: extension.id, capabilityId: capability.id }] as const))
  );
  return {
    visible: new Set(extensions.flatMap((extension) => extension.capabilities.map((capability) => `${extension.id}.${capability.id}`))),
    skills: new Map(
      localSkills
        .filter((skill) => skill.status === "active")
        .map((skill) => [
          skill.id,
          {
            targets: new Map(
              skill.requestedTools.flatMap((requestedTool, index) => {
                const target = visibleTargets.get(requestedTool);
                return target ? [[scopedSkillCapabilityId(index), target] as const] : [];
              })
            )
          }
        ])
    )
  };
}

function makeSessionTitle(content: string) {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "New Chat";
  return clean.length > 40 ? `${clean.slice(0, 40)}...` : clean;
}

function boundedConversationHistory(messages: Array<{ role: string; content: string }>) {
  const budget = Number(process.env.SP_AGENT_RUNTIME_HISTORY_CHARS ?? 12_000);
  const selected: Array<{ role: "user" | "assistant"; content: string }> = [];
  let used = 0;
  for (const message of [...messages].reverse()) {
    if ((message.role !== "user" && message.role !== "assistant") || !message.content.trim()) continue;
    const content = message.content.slice(0, 2_000);
    if (used + content.length > budget) break;
    selected.push({ role: message.role, content });
    used += content.length;
  }
  return selected.reverse();
}

function toMemoryContextDebug(memory: MemorySearchResult) {
  return {
    memoryId: memory.entry.id,
    kind: memory.entry.kind,
    score: memory.score,
    matchedTerms: memory.matchedTerms,
    rankingSignals: memory.rankingSignals,
    citation: memory.citation,
    debug: memory.debug
  };
}

function toLocalSkillManifest(skill: LocalSkillRecord): ExtensionManifest {
  return {
    id: `local.skill.${skill.id}`,
    name: skill.name,
    description: skill.description,
    kind: "skill",
    phase: "local-import",
    status: skill.status,
    capabilities: [
      {
        id: "skill.load_instructions",
        label: "Load Skill instructions",
        description: "Load this local Skill's instructions and declared API tools for the current turn.",
        permissions: ["skills:read"],
        inputSchema: "{}",
        outputSchema: "{ instructions: string, requestedTools: string[] }"
      },
      {
        id: "skill.read_reference",
        label: "Read Skill reference",
        description: "Read one file from this installed Skill package by its relative path.",
        permissions: ["skills:read"],
        inputSchema: "{ path: string }",
        outputSchema: "{ path: string, content: string }"
      },
      ...skill.requestedTools.map((tool, index) => ({
        id: scopedSkillCapabilityId(index),
        label: tool,
        description: `Invoke declared API capability ${tool} through ${skill.name}.`,
        permissions: ["skills:invoke"],
        inputSchema: "record",
        outputSchema: "extension invocation result"
      }))
    ]
  };
}

function scopedSkillCapabilityId(index: number) {
  return `skill.invoke.${index}`;
}
