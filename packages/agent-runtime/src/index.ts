import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

type AgentArtifact = { kind: string; [key: string]: unknown };
type ExtensionCapability = { id: string; label: string; description: string; inputSchema?: string };
type ExtensionManifest = { id: string; status: string; capabilities: ExtensionCapability[] };

type PiSdkModule = typeof import("@earendil-works/pi-coding-agent");
type PiModelRegistry = {
  registerProvider(provider: string, config: Record<string, unknown>): void;
  find(provider: string, modelId: string): unknown;
  getAvailable(): unknown[];
};

type PiAgentSession = {
  prompt(prompt: string, options?: Record<string, unknown>): Promise<unknown>;
  subscribe(callback: (event: unknown) => void): () => void;
  dispose(): void;
  state?: { messages?: unknown };
  messages?: unknown;
  getActiveToolNames?: () => string[];
};

export type AgentRuntimeStatus = {
  provider: string;
  configured: boolean;
  reachable: boolean;
  sdkLoaded?: boolean;
  selectedModelAvailable?: boolean;
  availableModelCount?: number;
  degradedReason?: string;
};

export type AgentRuntimeToolCallAudit = {
  toolCallId?: string;
  toolName: string;
  input?: unknown;
  isError?: boolean;
  outputPreview?: string;
};

export type PersonalAgentExtensionInvokeRequest = {
  extensionId: string;
  capabilityId: string;
  input: Record<string, unknown>;
};

export type PersonalAgentExtensionInvokeResult = {
  ok: boolean;
  status: string;
  result?: unknown;
  degradedReason?: string;
  permissionAudit?: unknown;
};

export type PersonalAgentTurnInput = {
  message: string;
  sessionId?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  memoryContext?: unknown[];
  extensionManifests?: unknown[];
  safetyModel?: unknown;
  extensionInvoker?: (request: PersonalAgentExtensionInvokeRequest) => Promise<PersonalAgentExtensionInvokeResult>;
};

export type PersonalAgentTurnResult = {
  content: string;
  provider: string;
  model?: string;
  degradedReason?: string;
  activeTools?: string[];
  toolCalls?: AgentRuntimeToolCallAudit[];
  artifacts?: AgentArtifact[];
};

export type PersonalAgentTurnStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "done"; result: PersonalAgentTurnResult };

export type RuntimeAdapter = {
  id: string;
  label: string;
  default: boolean;
  getStatus(env?: NodeJS.ProcessEnv): Promise<AgentRuntimeStatus>;
  runTurn(input: PersonalAgentTurnInput, env?: NodeJS.ProcessEnv): Promise<PersonalAgentTurnResult>;
  streamTurn?(input: PersonalAgentTurnInput, env?: NodeJS.ProcessEnv): AsyncIterable<PersonalAgentTurnStreamEvent>;
};

const piRuntimeAdapter: RuntimeAdapter = {
  id: "pi",
  label: "Pi",
  default: true,
  getStatus: getPiAgentRuntimeStatus,
  runTurn: runPiPersonalAgentTurn,
  streamTurn: streamPiPersonalAgentTurn
};

const localDeterministicRuntimeAdapter: RuntimeAdapter = {
  id: "local-deterministic",
  label: "Local Deterministic",
  default: false,
  getStatus: async () => ({
    provider: "local-deterministic",
    configured: true,
    reachable: true
  }),
  runTurn: async (input) => {
    return {
      content:
        `本地确定性 runtime 已接管本轮回复。收到用户消息：${truncateForReply(input.message)}\n` +
        "当前是离线降级模式，无法进行真实模型推理； typed chat、memory、skills 边界仍保持可用。",
      provider: "local-deterministic",
      model: "deterministic-v0",
      activeTools: createPiAgentShellTools(input).map((tool) => tool.name),
      artifacts: []
    };
  },
  streamTurn: async function* (input) {
    const result = await localDeterministicRuntimeAdapter.runTurn(input);
    for (const text of chunkText(result.content)) yield { type: "text_delta", text };
    yield { type: "done", result };
  }
};

const runtimeAdapters: RuntimeAdapter[] = [piRuntimeAdapter, localDeterministicRuntimeAdapter];

export function listRuntimeAdapters(): RuntimeAdapter[] {
  return runtimeAdapters;
}

export function getRuntimeAdapter(id: string): RuntimeAdapter | undefined {
  return runtimeAdapters.find((adapter) => adapter.id === id);
}

export function getSelectedRuntimeAdapter(env: NodeJS.ProcessEnv = process.env): RuntimeAdapter {
  const selected = env.AGENT_RUNTIME_PROVIDER || runtimeAdapters.find((adapter) => adapter.default)?.id || "pi";
  return getRuntimeAdapter(selected) ?? piRuntimeAdapter;
}

function truncateForReply(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 80)}...` : clean;
}

function sanitizeVisibleAgentContent(content: string): string {
  const lines = content.split(/\r?\n/);
  const cleaned: string[] = [];
  let isLeadingBlock = true;
  for (const line of lines) {
    const trimmed = line.trim();
    if (isLeadingBlock && isInternalProcessLine(trimmed)) continue;
    if (isToolCountLine(trimmed)) continue;
    if (trimmed) isLeadingBlock = false;
    cleaned.push(line);
  }
  return cleaned.join("\n").replace(/^\s+/, "").trim();
}

function isInternalProcessLine(line: string): boolean {
  if (!line) return false;
  return [
    /^我(?:先|会|将|来)?(?:搜索|检索|查看|检查|查询).*(?:本地记忆|记忆|扩展|书签|工具|registry)/,
    /^让我(?:先|来)?(?:搜索|检索|查看|检查|查询).*(?:本地记忆|记忆|扩展|书签|工具|registry)/,
    /^正在(?:搜索|检索|查看|检查|查询).*(?:本地记忆|记忆|扩展|书签|工具|registry)/,
    /^已(?:搜索|检索|查看|检查|查询).*(?:本地记忆|记忆|扩展|书签|工具|registry)/,
    /^本地记忆和书签中(?:没有|未找到)/,
    /^我(?:没有|未)(?:在)?(?:本地记忆|记忆|书签|扩展).*(?:找到|检索到|搜索到)/
  ].some((pattern) => pattern.test(line));
}

function isToolCountLine(line: string): boolean {
  return /^工具调用[:：]\s*\d+\s*$/.test(line);
}

async function* streamFromNonStreamingTurn(
  adapter: RuntimeAdapter,
  input: PersonalAgentTurnInput,
  env: NodeJS.ProcessEnv
): AsyncIterable<PersonalAgentTurnStreamEvent> {
  const result = await adapter.runTurn(input, env);
  for (const text of chunkText(result.content)) yield { type: "text_delta", text };
  yield { type: "done", result };
}

function chunkText(text: string): string[] {
  const chars = Array.from(text);
  const chunkSize = chars.length > 240 ? 4 : chars.length > 120 ? 3 : 2;
  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += chunkSize) {
    chunks.push(chars.slice(index, index + chunkSize).join(""));
  }
  return chunks;
}

function createAsyncQueue<T>() {
  const values: T[] = [];
  const waiters: Array<{ resolve: (value: IteratorResult<T>) => void; reject: (error: unknown) => void }> = [];
  let ended = false;
  let failure: unknown;

  return {
    push(value: T) {
      if (ended) return;
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve({ value, done: false });
        return;
      }
      values.push(value);
    },
    end() {
      ended = true;
      while (waiters.length > 0) waiters.shift()?.resolve({ value: undefined as T, done: true });
    },
    fail(error: unknown) {
      failure = error;
      ended = true;
      while (waiters.length > 0) waiters.shift()?.reject(error);
    },
    async *iterate(): AsyncIterable<T> {
      while (true) {
        if (values.length > 0) {
          yield values.shift() as T;
          continue;
        }
        if (failure) throw failure;
        if (ended) return;
        const next = await new Promise<IteratorResult<T>>((resolve, reject) => waiters.push({ resolve, reject }));
        if (next.done) return;
        yield next.value;
      }
    }
  };
}

const inspectExtensionRegistryParams = Type.Object({
  maxChars: Type.Optional(Type.Number({ description: "Maximum JSON characters to return. Default 12000." }))
});

const invokeExtensionCapabilityParams = Type.Object({
  extensionId: Type.String({ description: "Registered extension id." }),
  capabilityId: Type.String({ description: "Registered capability id." }),
  inputJson: Type.Optional(Type.String({ description: "Optional JSON object string for the capability input." }))
});

export async function getAgentRuntimeStatus(env: NodeJS.ProcessEnv = process.env): Promise<AgentRuntimeStatus> {
  return getSelectedRuntimeAdapter(env).getStatus(env);
}

export async function runPersonalAgentTurnWithAgent(
  input: PersonalAgentTurnInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<PersonalAgentTurnResult> {
  return getSelectedRuntimeAdapter(env).runTurn(input, env);
}

export function streamPersonalAgentTurnWithAgent(
  input: PersonalAgentTurnInput,
  env: NodeJS.ProcessEnv = process.env
): AsyncIterable<PersonalAgentTurnStreamEvent> {
  const adapter = getSelectedRuntimeAdapter(env);
  return adapter.streamTurn ? adapter.streamTurn(input, env) : streamFromNonStreamingTurn(adapter, input, env);
}

async function getPiAgentRuntimeStatus(env: NodeJS.ProcessEnv = process.env): Promise<AgentRuntimeStatus> {
  const provider = piModelProvider(env);
  const modelId = piModelId(env);
  const hasConfig = piHasApiKey(provider, env);

  try {
    const pi = await loadPiSdk();
    const authStorage = pi.AuthStorage.inMemory();
    const apiKey = piApiKey(provider, env);
    if (apiKey) authStorage.setRuntimeApiKey(provider, apiKey);
    const modelRegistry = pi.ModelRegistry.inMemory(authStorage);
    registerSiliconFlowPiProvider(modelRegistry, env);
    const selectedModel = modelRegistry.find(provider, modelId);
    const availableModelCount = modelRegistry.getAvailable().length;

    if (!hasConfig) {
      return {
        provider: "pi",
        configured: false,
        reachable: false,
        sdkLoaded: true,
        selectedModelAvailable: Boolean(selectedModel),
        availableModelCount,
        degradedReason: `AGENT_RUNTIME_PROVIDER=pi requires SILICONFLOW_API_KEY for the configured Pi model provider (${provider}).`
      };
    }

    if (!selectedModel) {
      return {
        provider: "pi",
        configured: true,
        reachable: false,
        sdkLoaded: true,
        selectedModelAvailable: false,
        availableModelCount,
        degradedReason: `Pi SDK loaded, but model ${provider}/${modelId} was not found in the Pi model registry.`
      };
    }

    return {
      provider: "pi",
      configured: true,
      reachable: true,
      sdkLoaded: true,
      selectedModelAvailable: true,
      availableModelCount
    };
  } catch (error) {
    return {
      provider: "pi",
      configured: hasConfig,
      reachable: false,
      sdkLoaded: false,
      degradedReason: error instanceof Error ? `Pi SDK could not be loaded: ${error.message}` : "Pi SDK could not be loaded."
    };
  }
}

async function runPiPersonalAgentTurn(
  input: PersonalAgentTurnInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<PersonalAgentTurnResult> {
  const provider = piModelProvider(env);
  const modelId = piModelId(env);
  const modelLabel = `${provider}/${modelId}`;

  if (!piHasApiKey(provider, env)) {
    return {
      content:
        "本地个人 agent 基座已启动。当前缺少 Pi 模型密钥，所以这次使用确定性降级回复；你仍然可以继续搭建 memory、speech 和 skills 边界。",
      provider: "pi",
      model: modelLabel,
      degradedReason: `AGENT_RUNTIME_PROVIDER=pi requires SILICONFLOW_API_KEY for the configured Pi model provider (${provider}).`,
      activeTools: createPiAgentShellTools(input).map((tool) => tool.name),
      toolCalls: []
    };
  }

  try {
    const { pi, authStorage, modelRegistry, model } = await createPiModelContext(env, provider, modelId);
    if (!model) {
      return {
        content: "Pi runtime 已选择，但当前模型不在 Pi model registry 中。本地 agent shell 保持降级可用。",
        provider: "pi",
        model: modelLabel,
        degradedReason: `Pi model ${provider}/${modelId} was not found in the Pi model registry.`
      };
    }

    const chunks: string[] = [];
    const toolCalls: AgentRuntimeToolCallAudit[] = [];
    const artifacts: AgentArtifact[] = [];
    let finalAssistantText = "";
    let finalMessages: unknown;
    const customTools = createPiAgentShellTools(input, artifacts);
    const appToolNames = customTools.map((tool) => tool.name);
    const { session, modelFallbackMessage } = await pi.createAgentSession({
      cwd: env.PI_WORKING_DIR || process.cwd(),
      authStorage,
      modelRegistry,
      model,
      thinkingLevel: parsePiThinkingLevel(env.PI_THINKING_LEVEL),
      noTools: "builtin",
      tools: appToolNames,
      excludeTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
      customTools,
      sessionManager: pi.SessionManager.inMemory(env.PI_WORKING_DIR || process.cwd())
    });

    const unsubscribe = session.subscribe((event) => {
      const delta = extractPiTextDelta(event);
      if (delta) chunks.push(delta);
      const finalText = extractPiFinalAssistantText(event);
      if (finalText) finalAssistantText = finalText;
      const toolAudit = extractPiToolAudit(event);
      if (toolAudit) mergePiToolAudit(toolCalls, toolAudit);
    });
    const activeTools = session.getActiveToolNames?.() ?? appToolNames;

    try {
      await withTimeout(
        (async () => {
          await session.prompt(buildPiAgentShellPrompt(input), {
            expandPromptTemplates: false
          });
        })(),
        piRequestTimeoutMs(env),
        "Pi SDK personal agent turn timed out."
      );
    } finally {
      finalMessages = session.state?.messages ?? session.messages;
      unsubscribe();
      session.dispose();
    }

    const content = sanitizeVisibleAgentContent((chunks.join("").trim() || finalAssistantText || extractLastAssistantText(finalMessages) || "").trim());
    if (!content) {
      return {
        content: "Pi runtime 已返回空输出。本地 agent shell 保持降级可用。",
        provider: "pi",
        model: modelLabel,
        degradedReason: modelFallbackMessage ? `Pi SDK returned no assistant text. ${modelFallbackMessage}` : "Pi SDK returned no assistant text.",
        activeTools,
        toolCalls,
        artifacts
      };
    }

    return {
      content,
      provider: "pi",
      model: modelLabel,
      degradedReason: modelFallbackMessage,
      activeTools,
      toolCalls,
      artifacts
    };
  } catch (error) {
    return {
      content: "Pi runtime 调用失败。本地 agent shell 保持降级可用，后续可以继续走确定性本地能力。",
      provider: "pi",
      model: modelLabel,
      degradedReason: error instanceof Error ? error.message : "Pi SDK personal agent turn failed.",
      activeTools: createPiAgentShellTools(input).map((tool) => tool.name),
      toolCalls: []
    };
  }
}

async function* streamPiPersonalAgentTurn(
  input: PersonalAgentTurnInput,
  env: NodeJS.ProcessEnv = process.env
): AsyncIterable<PersonalAgentTurnStreamEvent> {
  const provider = piModelProvider(env);
  const modelId = piModelId(env);
  const modelLabel = `${provider}/${modelId}`;

  if (!piHasApiKey(provider, env)) {
    const result: PersonalAgentTurnResult = {
      content: "本地个人 agent 基座已启动。当前缺少 Pi 模型密钥，所以这次使用确定性降级回复；你仍然可以继续搭建 memory、speech 和 skills 边界。",
      provider: "pi",
      model: modelLabel,
      degradedReason: `AGENT_RUNTIME_PROVIDER=pi requires SILICONFLOW_API_KEY for the configured Pi model provider (${provider}).`,
      activeTools: createPiAgentShellTools(input).map((tool) => tool.name),
      toolCalls: []
    };
    for (const text of chunkText(result.content)) yield { type: "text_delta", text };
    yield { type: "done", result };
    return;
  }

  const queue = createAsyncQueue<PersonalAgentTurnStreamEvent>();
  void (async () => {
    let unsubscribe: (() => void) | undefined;
    let session: PiAgentSession | undefined;
    try {
      const { pi, authStorage, modelRegistry, model } = await createPiModelContext(env, provider, modelId);
      if (!model) {
        const result: PersonalAgentTurnResult = {
          content: "Pi runtime 已选择，但当前模型不在 Pi model registry 中。本地 agent shell 保持降级可用。",
          provider: "pi",
          model: modelLabel,
          degradedReason: `Pi model ${provider}/${modelId} was not found in the Pi model registry.`
        };
        for (const text of chunkText(result.content)) queue.push({ type: "text_delta", text });
        queue.push({ type: "done", result });
        return;
      }

      const chunks: string[] = [];
      const toolCalls: AgentRuntimeToolCallAudit[] = [];
      const artifacts: AgentArtifact[] = [];
      let finalAssistantText = "";
      let finalMessages: unknown;
      const customTools = createPiAgentShellTools(input, artifacts);
      const appToolNames = customTools.map((tool) => tool.name);
      const created = await pi.createAgentSession({
        cwd: env.PI_WORKING_DIR || process.cwd(),
        authStorage,
        modelRegistry,
        model,
        thinkingLevel: parsePiThinkingLevel(env.PI_THINKING_LEVEL),
        noTools: "builtin",
        tools: appToolNames,
        excludeTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
        customTools,
        sessionManager: pi.SessionManager.inMemory(env.PI_WORKING_DIR || process.cwd())
      });
      session = created.session as PiAgentSession;
      const modelFallbackMessage = created.modelFallbackMessage;

      unsubscribe = session.subscribe((event: unknown) => {
        const delta = extractPiStreamingTextDelta(event);
        if (delta) {
          chunks.push(delta);
          queue.push({ type: "text_delta", text: delta });
        }
        const finalText = extractPiFinalAssistantText(event);
        if (finalText) finalAssistantText = finalText;
        const toolAudit = extractPiToolAudit(event);
        if (toolAudit) mergePiToolAudit(toolCalls, toolAudit);
      });
      const activeTools = session.getActiveToolNames?.() ?? appToolNames;

      await withTimeout(
        (async () => {
          await session.prompt(buildPiAgentShellPrompt(input), {
            expandPromptTemplates: false
          });
        })(),
        piRequestTimeoutMs(env),
        "Pi SDK personal agent stream timed out."
      );
      finalMessages = session.state?.messages ?? session.messages;
      const content = sanitizeVisibleAgentContent((chunks.join("").trim() || finalAssistantText || extractLastAssistantText(finalMessages) || "").trim());
      if (!chunks.join("").trim() && content) {
        for (const text of chunkText(content)) queue.push({ type: "text_delta", text });
      }
      const result: PersonalAgentTurnResult = content
        ? {
            content,
            provider: "pi",
            model: modelLabel,
            degradedReason: modelFallbackMessage,
            activeTools,
            toolCalls,
            artifacts
          }
        : {
            content: "Pi runtime 已返回空输出。本地 agent shell 保持降级可用。",
            provider: "pi",
            model: modelLabel,
            degradedReason: modelFallbackMessage ? `Pi SDK returned no assistant text. ${modelFallbackMessage}` : "Pi SDK returned no assistant text.",
            activeTools,
            toolCalls,
            artifacts
          };
      if (!content) queue.push({ type: "text_delta", text: result.content });
      queue.push({ type: "done", result });
    } catch (error) {
      const result: PersonalAgentTurnResult = {
        content: "Pi runtime 调用失败。本地 agent shell 保持降级可用，后续可以继续走确定性本地能力。",
        provider: "pi",
        model: modelLabel,
        degradedReason: error instanceof Error ? error.message : "Pi SDK personal agent stream failed.",
        activeTools: createPiAgentShellTools(input).map((tool) => tool.name),
        toolCalls: []
      };
      for (const text of chunkText(result.content)) queue.push({ type: "text_delta", text });
      queue.push({ type: "done", result });
    } finally {
      unsubscribe?.();
      session?.dispose();
      queue.end();
    }
  })();

  yield* queue.iterate();
}

async function createPiModelContext(env: NodeJS.ProcessEnv, provider: string, modelId: string) {
  const pi = await loadPiSdk();
  const authStorage = pi.AuthStorage.inMemory();
  const apiKey = piApiKey(provider, env);
  if (apiKey) authStorage.setRuntimeApiKey(provider, apiKey);
  const modelRegistry = pi.ModelRegistry.inMemory(authStorage);
  registerSiliconFlowPiProvider(modelRegistry, env);
  const model = modelRegistry.find(provider, modelId);
  return { pi, authStorage, modelRegistry, model };
}

async function loadPiSdk(): Promise<PiSdkModule> {
  return (await import("@earendil-works/pi-coding-agent")) as PiSdkModule;
}

function createPiAgentShellTools(input: PersonalAgentTurnInput, artifacts: AgentArtifact[] = []): ToolDefinition[] {
  return [
    {
      name: "inspect_extension_registry",
      label: "Inspect extension registry",
      description: "Read the local app extension registry and safety policy. This tool is read-only.",
      promptSnippet: "Inspect local agent extensions and safety policy",
      promptGuidelines: ["Use this tool to explain available local skills.", "Do not claim an extension was executed."],
      parameters: inspectExtensionRegistryParams,
      async execute(_toolCallId, params) {
        const toolParams = params as { maxChars?: number };
        const maxChars = Number.isFinite(toolParams.maxChars) && toolParams.maxChars && toolParams.maxChars > 0 ? Math.min(toolParams.maxChars, 24000) : 12000;
        return {
          content: [
            {
              type: "text",
              text: truncateJson({ safetyModel: input.safetyModel, extensions: input.extensionManifests ?? [] }, maxChars)
            }
          ],
          details: { maxChars }
        };
      }
    },
    ...createCapabilityTools(input, artifacts)
  ];
}

function createCapabilityTools(input: PersonalAgentTurnInput, artifacts: AgentArtifact[]): ToolDefinition[] {
  return readOnlyCapabilities(input.extensionManifests).map(({ manifest, capability }) => ({
    name: capabilityToolName(manifest.id, capability.id),
    label: capability.label,
    description: capability.description,
    promptSnippet: `${capability.label}: ${capability.description}`,
    promptGuidelines: [
      "Use this capability only when it materially grounds or completes the user's request.",
      "Supply a JSON object in inputJson that follows the documented input schema.",
      "Do not claim results that are absent from the capability response."
    ],
    parameters: invokeExtensionCapabilityParams,
    async execute(_toolCallId, params) {
      const extensionInput = parseOptionalJsonObject((params as { inputJson?: string }).inputJson);
      if (!extensionInput.ok) return toolFailure(extensionInput);
      if (!input.extensionInvoker) {
        return toolFailure({ ok: false, status: "denied", degradedReason: "The API shell did not provide an extension invoker." });
      }
      const result = await input.extensionInvoker({ extensionId: manifest.id, capabilityId: capability.id, input: extensionInput.value });
      return {
        content: [{ type: "text", text: truncateJson(redactLargeExtensionResult(result), 12000) }],
        details: { ok: result.ok, status: result.status, extensionId: manifest.id, capabilityId: capability.id }
      };
    }
  }));
}

function toolFailure(value: { ok: false; status: string; degradedReason: string }) {
  return {
    content: [{ type: "text" as const, text: truncateJson(value, 4000) }],
    details: { ok: false, status: value.status }
  };
}

function readOnlyCapabilities(manifests: unknown[] | undefined): Array<{ manifest: ExtensionManifest; capability: ExtensionCapability }> {
  return (manifests ?? []).flatMap((candidate) => {
    const manifest = candidate as ExtensionManifest;
    if (manifest.status !== "active" || !manifest.id || !Array.isArray(manifest.capabilities)) return [];
    return manifest.capabilities.map((capability) => ({ manifest, capability }));
  });
}

function capabilityToolName(extensionId: string, capabilityId: string) {
  return `${extensionId}_${capabilityId}`.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}

function buildPiAgentShellPrompt(input: PersonalAgentTurnInput): string {
  const capabilities = readOnlyCapabilities(input.extensionManifests).map(({ manifest, capability }) => ({
    toolName: capabilityToolName(manifest.id, capability.id),
    extensionId: manifest.id,
    capabilityId: capability.id,
    label: capability.label,
    description: capability.description,
    inputSchema: capability.inputSchema ?? "{}"
  }));
  return JSON.stringify({
    instruction:
      "You are the Pi runtime for a trusted local development agent. Reply in concise Chinese. Select an available Skill only when it materially helps the request; otherwise answer directly. For a local.skill capability, load its instructions before following it, then read package references only when needed. Treat declared API tools as the Skill's allowlist. Do not claim unavailable tool results, external data, or memory. Do not mention internal tools unless asked. Keep the response under 10 lines.",
    userMessage: input.message,
    sessionId: input.sessionId,
    conversationHistory: (input.conversationHistory ?? []).slice(-12).map((message) => ({ role: message.role, content: message.content.slice(0, 2_000) })),
    memoryContext: (input.memoryContext ?? []).slice(0, 8),
    availableAppTools: ["inspect_extension_registry: read local extensions and safety policy only", ...capabilities.map((item) => `${item.toolName}: ${item.label}`)],
    availableCapabilities: capabilities,
    extensionInvocationPolicy:
      "Use only the capabilities exposed by the local API. Sensitive credentials, external account actions, and destructive operations remain approval-gated.",
    extensionCount: input.extensionManifests?.length ?? 0
  });
}

function parseOptionalJsonObject(inputJson: string | undefined): { ok: true; value: Record<string, unknown> } | { ok: false; status: "denied"; degradedReason: string } {
  if (!inputJson || !inputJson.trim()) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(inputJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, status: "denied", degradedReason: "inputJson must decode to a JSON object." };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      ok: false,
      status: "denied",
      degradedReason: error instanceof Error ? `inputJson parse failed: ${error.message}` : "inputJson parse failed."
    };
  }
}

function redactLargeExtensionResult(result: PersonalAgentExtensionInvokeResult): PersonalAgentExtensionInvokeResult {
  return {
    ...result,
    result: truncateDeepStrings(result.result, 1200)
  };
}

function truncateDeepStrings(value: unknown, maxChars: number): unknown {
  if (typeof value === "string") return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => truncateDeepStrings(item, maxChars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, truncateDeepStrings(nested, maxChars)]));
  }
  return value;
}

function truncateJson(value: unknown, maxChars: number): string {
  const text = JSON.stringify(value, null, 2);
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function extractPiTextDelta(event: unknown): string | undefined {
  const record = event as Record<string, unknown>;
  const assistantMessageEvent = record.assistantMessageEvent as Record<string, unknown> | undefined;
  if (record.type === "message_update" && assistantMessageEvent?.type === "text_delta" && typeof assistantMessageEvent.delta === "string") {
    return assistantMessageEvent.delta;
  }
  const delta = record.delta ?? record.textDelta ?? record.contentDelta;
  if (typeof delta === "string") return delta;
  const message = record.message as Record<string, unknown> | undefined;
  const content = message?.content ?? record.content;
  return typeof content === "string" ? content : undefined;
}

function extractPiStreamingTextDelta(event: unknown): string | undefined {
  const record = event as Record<string, unknown>;
  const assistantMessageEvent = record.assistantMessageEvent as Record<string, unknown> | undefined;
  if (record.type === "message_update" && assistantMessageEvent?.type === "text_delta" && typeof assistantMessageEvent.delta === "string") {
    return assistantMessageEvent.delta;
  }
  const delta = record.delta ?? record.textDelta ?? record.contentDelta;
  return typeof delta === "string" ? delta : undefined;
}

function extractPiFinalAssistantText(event: unknown): string | undefined {
  const record = event as Record<string, unknown>;
  if (record.type === "agent_end" && Array.isArray(record.messages)) {
    return extractLastAssistantText(record.messages);
  }
  if (record.type === "message_end") {
    return extractMessageText(record.message);
  }
  return undefined;
}

function extractPiToolAudit(event: unknown): AgentRuntimeToolCallAudit | undefined {
  const record = event as Record<string, unknown>;
  const toolExecution = (record.toolExecution ?? record.toolCall ?? record.tool) as Record<string, unknown> | undefined;
  const toolName = record.toolName ?? toolExecution?.toolName ?? toolExecution?.name ?? record.name;
  if (typeof toolName !== "string") return undefined;
  return {
    toolCallId: typeof record.toolCallId === "string" ? record.toolCallId : undefined,
    toolName,
    input: record.input,
    isError: Boolean(record.isError),
    outputPreview: extractPiToolResultPreview(record.content)
  };
}

function extractLastAssistantText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (const item of [...messages].reverse()) {
    const text = extractMessageText(item);
    if (text) return text;
  }
  return undefined;
}

function extractMessageText(message: unknown): string | undefined {
  const record = message as Record<string, unknown> | undefined;
  if (!record || record.role !== "assistant") return undefined;
  const content = record.content;
  if (typeof content === "string") return content.trim() || undefined;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") return part;
        const partRecord = part as Record<string, unknown>;
        return typeof partRecord.text === "string" ? partRecord.text : "";
      })
      .join("")
      .trim();
    return text || undefined;
  }
  return undefined;
}


function mergePiToolAudit(toolCalls: AgentRuntimeToolCallAudit[], audit: AgentRuntimeToolCallAudit): void {
  const index = toolCalls.findIndex((item) => item.toolCallId && item.toolCallId === audit.toolCallId);
  if (index >= 0) {
    toolCalls[index] = { ...toolCalls[index], ...audit };
    return;
  }
  toolCalls.push(audit);
}

function extractPiToolResultPreview(content: unknown): string | undefined {
  if (typeof content === "string") return content.slice(0, 500);
  if (content === undefined) return undefined;
  return JSON.stringify(content).slice(0, 500);
}

function piRequestTimeoutMs(env: NodeJS.ProcessEnv): number {
  const value = Number(env.PI_AGENT_RUNTIME_TIMEOUT_MS);
  if (Number.isFinite(value) && value > 0) return value;
  return 120000;
}

function piModelProvider(env: NodeJS.ProcessEnv): string {
  return env.PI_MODEL_PROVIDER || "siliconflow";
}

function piModelId(env: NodeJS.ProcessEnv): string {
  return env.PI_MODEL_ID || env.PI_SILICONFLOW_MODEL || "deepseek-ai/DeepSeek-V4-Flash";
}

function piApiKey(provider: string, env: NodeJS.ProcessEnv): string | undefined {
  if (provider.toLowerCase() === "siliconflow") return env.SILICONFLOW_API_KEY;
  return undefined;
}

function piHasApiKey(provider: string, env: NodeJS.ProcessEnv): boolean {
  return Boolean(piApiKey(provider, env));
}

function registerSiliconFlowPiProvider(modelRegistry: PiModelRegistry, env: NodeJS.ProcessEnv): void {
  modelRegistry.registerProvider("siliconflow", {
    name: "SiliconFlow",
    baseUrl: env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1",
    apiKey: env.SILICONFLOW_API_KEY || "$SILICONFLOW_API_KEY",
    api: "openai-completions",
    authHeader: true,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens"
    },
    models: [
      {
        id: "deepseek-ai/DeepSeek-V4-Flash",
        name: "DeepSeek V4 Flash (SiliconFlow)",
        reasoning: false,
        input: ["text"],
        contextWindow: 64000,
        maxTokens: 2048,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0
        }
      }
    ]
  });
}

function parsePiThinkingLevel(value: string | undefined): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" {
  if (value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  return "off";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
