import {
  artifactWriteCsvSchema,
  artifactWriteMarkdownSchema,
  consolidateMemorySchema,
  contextBriefingSchema,
  createMemoryCandidateSchema,
  extractMemoryFromSessionSchema,
  localBookmarkDigestSchema,
  localBookmarkSearchSchema,
  mergeMemorySchema,
  projectDocSearchSchema,
  projectPlanSchema,
  promoteMemorySchema,
  searchMemorySchema,
  skillScriptExecuteSchema,
  summarizeMemorySessionSchema,
  type ExtensionCapability,
  type ExtensionManifest,
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
  webSearchSchema
} from "@sp-agent/shared";

export type ExtensionRuntimeStatus = {
  mode: "local_personal_agent";
  safetyModel: {
    defaultToolPolicy: "read_only" | "trusted_local";
    disabledToolClasses: string[];
    highRiskActions: string[];
  };
  extensions: ExtensionManifest[];
};

const coreAgentShell: ExtensionManifest = {
  id: "core.agent-shell",
  name: "Local Personal Agent Shell",
  description: "Electron + Local API + runtime adapters for the single-user personal agent base.",
  kind: "core",
  phase: "phase-1",
  status: "active",
  entrypoint: "/api/agent/messages",
  capabilities: [
    {
      id: "agent.turn",
      label: "Personal agent turn",
      description: "Run one local personal-agent turn through the selected runtime adapter.",
      permissions: ["runtime:agent", "tools:read_only"],
      inputSchema: "createAgentMessageSchema",
      outputSchema: "agentMessageResponseSchema"
    },
    {
      id: "extensions.inspect",
      label: "Inspect extension registry",
      description: "Read the local extension registry and safety policy.",
      permissions: ["extensions:read"],
      outputSchema: "extensionManifestSchema[]"
    }
  ]
};

const memorySkill: ExtensionManifest = {
  id: "local.memory",
  name: "Local Memory",
  description: "App-owned Memory v2 layer for core facts, journal events, summaries, provenance, search, audit, and tombstone-based forgetting.",
  kind: "skill",
  phase: "phase-3",
  status: "active",
  entrypoint: "/api/extensions/local.memory/invoke",
  capabilities: [
    {
      id: "memory.search",
      label: "Search memory",
      description: "Search durable app-owned memory with kind, scope, session, time range, sensitivity, status, and limit filters.",
      permissions: ["memory:read"],
      inputSchema: "searchMemorySchema",
      outputSchema: "{ memories: memorySearchResult[] }"
    },
    {
      id: "memory.write_candidate",
      label: "Write memory candidate",
      description: "Create an auditable Memory v2 candidate with kind, source, provenance, sensitivity, and optional occurredAt metadata.",
      permissions: ["memory:write_candidate"],
      effects: ["local_write"],
      riskLevel: "medium",
      executionPolicy: "auto",
      inputSchema: "createMemoryCandidateSchema",
      outputSchema: "{ accepted: boolean, memoryId: string, memory: memoryEntry }"
    },
    {
      id: "memory.promote_fact",
      label: "Promote memory fact",
      description: "Promote a memory candidate into an accepted durable fact.",
      permissions: ["memory:write"],
      effects: ["local_write"],
      riskLevel: "medium",
      executionPolicy: "auto",
      inputSchema: "{ id: string, reason: string }",
      outputSchema: "{ memory: memoryEntry, auditEvents: memoryAuditEvent[] }"
    },
    {
      id: "memory.update",
      label: "Update memory",
      description: "Update an existing memory entry while preserving audit history.",
      permissions: ["memory:write"],
      effects: ["local_write"],
      riskLevel: "medium",
      executionPolicy: "auto",
      inputSchema: "{ id: string, content?: string, tags?: string[], confidence?: number, provenance?: object }",
      outputSchema: "{ memory: memoryEntry, auditEvents: memoryAuditEvent[] }"
    },
    {
      id: "memory.merge",
      label: "Merge memories",
      description: "Create a promoted memory from related source memories and tombstone the superseded entries.",
      permissions: ["memory:write"],
      effects: ["local_write"],
      riskLevel: "medium",
      executionPolicy: "auto",
      inputSchema: "mergeMemorySchema",
      outputSchema: "{ memory: memoryEntry, mergedFrom: string[], auditEvents: memoryAuditEvent[] }"
    },
    {
      id: "memory.consolidate",
      label: "Suggest memory consolidation",
      description: "Inspect active/candidate memories and suggest safe merge candidates without mutating durable memory.",
      permissions: ["memory:read"],
      inputSchema: "consolidateMemorySchema",
      outputSchema: "{ suggestions: memoryConsolidationSuggestion[], degradedReason?: string }"
    },
    {
      id: "memory.forget",
      label: "Forget memory",
      description: "Tombstone a durable memory entry while preserving its audit history.",
      permissions: ["memory:write"],
      effects: ["local_write"],
      riskLevel: "medium",
      executionPolicy: "auto",
      inputSchema: "{ id: string }",
      outputSchema: "{ memory: memoryEntry }"
    },
    {
      id: "memory.extract_session",
      label: "Extract session memory",
      description: "Extract auditable memory candidates from a chat session.",
      permissions: ["memory:write_candidate"],
      effects: ["local_write"],
      riskLevel: "medium",
      executionPolicy: "auto",
      inputSchema: "extractMemoryFromSessionSchema",
      outputSchema: "{ accepted: number }"
    },
    {
      id: "memory.summarize_session",
      label: "Summarize session memory",
      description: "Create an auditable session summary memory candidate.",
      permissions: ["memory:write_candidate"],
      effects: ["local_write"],
      riskLevel: "medium",
      executionPolicy: "auto",
      inputSchema: "summarizeMemorySessionSchema",
      outputSchema: "{ accepted: boolean }"
    }
  ]
};

const localContextSkill: ExtensionManifest = {
  id: "local.context",
  name: "Local Context",
  description: "Read-only local context utility for basic time, runtime, and shell metadata that proves the extension path is usable.",
  kind: "skill",
  phase: "phase-4",
  status: "active",
  entrypoint: "/api/extensions/local.context/invoke",
  capabilities: [
    {
      id: "context.snapshot",
      label: "Read local context snapshot",
      description: "Return a compact read-only snapshot with server time, timezone, active runtime, and extension ids.",
      permissions: ["context:read"],
      inputSchema: "{}",
      outputSchema: "{ now: string, timezone: string, runtimeProvider: string, extensionIds: string[] }"
    },
    {
      id: "context.briefing",
      label: "Read local context briefing",
      description: "Return a read-only operational briefing with runtime, extension readiness, safety policy, and recent workflow status.",
      permissions: ["context:read", "extensions:read", "workflow:read"],
      inputSchema: "contextBriefingSchema",
      outputSchema: "{ now: string, runtimeProvider: string, extensionSummary: object, workflowSummary?: object }"
    }
  ]
};

const localProjectSkill: ExtensionManifest = {
  id: "local.project",
  name: "Local Project Knowledge",
  description: "Read-only project-document skill backed by the workflow runner and restricted to allowlisted repository docs.",
  kind: "skill",
  phase: "phase-4",
  status: "active",
  entrypoint: "/api/extensions/local.project/invoke",
  capabilities: [
    {
      id: "project.search_docs",
      label: "Search project docs",
      description: "Run a workflow that searches allowlisted local project documents for relevant context.",
      permissions: ["project_docs:read", "workflow:run"],
      inputSchema: "projectDocSearchSchema",
      outputSchema: "{ workflow: workflowRun }"
    },
    {
      id: "project.plan",
      label: "Create project plan",
      description: "Create a read-only project plan from allowlisted project docs and return the supporting workflow record.",
      permissions: ["project_docs:read", "workflow:run"],
      inputSchema: "projectPlanSchema",
      outputSchema: "{ plan: object, workflow: workflowRun }"
    }
  ]
};

const workspaceSkill: ExtensionManifest = {
  id: "local.workspace",
  name: "Trusted Local Workspace",
  description: "Typed workspace operations owned by the API. Paths stay within the configured root and commands are limited to declared package scripts.",
  kind: "core",
  phase: "phase-1",
  status: "active",
  entrypoint: "/api/extensions/local.workspace/invoke",
  capabilities: [
    { id: "workspace.list", label: "List workspace files", description: "List non-symlink files under the configured workspace root.", permissions: ["workspace:read"], effects: ["read"], riskLevel: "low", executionPolicy: "auto", inputSchema: "workspaceListSchema", outputSchema: "{ entries: workspaceEntry[] }" },
    { id: "workspace.read_file", label: "Read workspace file", description: "Read a bounded regular file inside the configured workspace root. Input JSON: { path: string, offsetBytes?: number, maxBytes?: number }; use nextOffsetBytes when truncated is true to read the next page.", permissions: ["workspace:read"], effects: ["read"], riskLevel: "low", executionPolicy: "auto", inputSchema: "workspaceReadFileSchema", outputSchema: "{ path: string, content: string, size: number, offsetBytes: number, bytesRead: number, truncated: boolean, nextOffsetBytes?: number }" },
    { id: "workspace.search", label: "Search workspace text", description: "Search text in bounded regular files inside the configured workspace root. Input JSON: { query: string, path?: string, maxResults?: number }; path must name an existing directory.", permissions: ["workspace:read"], effects: ["read"], riskLevel: "low", executionPolicy: "auto", inputSchema: "workspaceSearchSchema", outputSchema: "{ results: workspaceSearchResult[] }" },
    { id: "workspace.write_file", label: "Write workspace file", description: "Create or update a regular workspace file after path and symlink checks.", permissions: ["workspace:write"], effects: ["local_write"], riskLevel: "medium", executionPolicy: "auto", inputSchema: "workspaceWriteFileSchema", outputSchema: "{ path: string, bytesWritten: number }" },
    { id: "workspace.apply_patch", label: "Apply workspace patch", description: "Apply a Git patch from a validated workspace directory.", permissions: ["workspace:write"], effects: ["local_write"], riskLevel: "medium", executionPolicy: "auto", inputSchema: "workspaceApplyPatchSchema", outputSchema: "{ cwd: string, output: string }" },
    { id: "workspace.run_script", label: "Run allowed project script", description: "Run only test, build, typecheck, lint, or smoke scripts declared by package.json.", permissions: ["workspace:execute"], effects: ["local_write"], riskLevel: "medium", executionPolicy: "auto", inputSchema: "workspaceRunScriptSchema", outputSchema: "{ exitCode: number, stdout: string, stderr: string }" },
    { id: "workspace.git_status", label: "Inspect Git status", description: "Read Git status and bounded diff for the configured workspace.", permissions: ["workspace:read"], effects: ["read"], riskLevel: "low", executionPolicy: "auto", inputSchema: "workspaceGitSchema", outputSchema: "{ status: string, diff?: string }" }
  ]
};

const localArtifactsExtension: ExtensionManifest = {
  id: "local.artifacts",
  name: "Local Document Artifacts",
  description: "Generate inspectable Markdown and CSV deliverables inside the configured workspace. Rich DOCX, PDF, and XLSX output stays a complete Skill-package concern.",
  kind: "core",
  phase: "phase-1",
  status: "active",
  entrypoint: "/api/extensions/local.artifacts/invoke",
  capabilities: [
    { id: "artifact.write_markdown", label: "Write Markdown document", description: "Create a Markdown document inside the configured workspace and return its delivery metadata.", permissions: ["artifacts:write", "workspace:write"], effects: ["local_write"], riskLevel: "medium", executionPolicy: "auto", inputSchema: "artifactWriteMarkdownSchema", outputSchema: "{ path, bytesWritten, kind: 'markdown', mimeType }" },
    { id: "artifact.write_csv", label: "Write CSV document", description: "Create a structured CSV document inside the configured workspace and return its delivery metadata.", permissions: ["artifacts:write", "workspace:write"], effects: ["local_write"], riskLevel: "medium", executionPolicy: "auto", inputSchema: "artifactWriteCsvSchema", outputSchema: "{ path, bytesWritten, kind: 'csv', mimeType, rowCount }" }
  ]
};

const remoteWebConnector: ExtensionManifest = {
  id: "remote.web",
  name: "Public Web Reader",
  description: "Search and read public web content through bounded, auditable retrieval. Private networks, URL credentials, unsupported media, and oversized responses are rejected or explicitly degraded.",
  kind: "connector",
  phase: "phase-1",
  status: "active",
  entrypoint: "/api/extensions/remote.web/invoke",
  capabilities: [
    { id: "web.search", label: "Search public web", description: "Search the configured public web backend and return bounded title, URL, and snippet results with retrieval metadata.", permissions: ["web:search", "network:public"], effects: ["provider_call"], riskLevel: "low", executionPolicy: "auto", inputSchema: "webSearchSchema", outputSchema: "{ query, provider, retrievedAt, results, degradedReason? }" },
    { id: "web.read_url", label: "Read public web page", description: "Read a public http(s) page, normalize HTML to Markdown, and return source identity, retrieval time, hash, and truncation state.", permissions: ["web:read", "network:public"], effects: ["provider_call"], riskLevel: "low", executionPolicy: "auto", inputSchema: "webReadUrlSchema", outputSchema: "{ source, content, degradedReason? }" }
  ]
};

const skillSandboxExtension: ExtensionManifest = {
  id: "local.skill-sandbox",
  name: "Skill Script Sandbox",
  description: "Runs an explicitly requested active Skill JavaScript file in an OS sandbox with network denial, package-root reads, bounded output, and a timeout.",
  kind: "core",
  phase: "phase-1",
  status: "active",
  entrypoint: "/api/extensions/local.skill-sandbox/invoke",
  capabilities: [
    { id: "skill.run_sandboxed_script", label: "Run sandboxed Skill script", description: "Execute an active Skill JavaScript file only through the OS sandbox.", permissions: ["skills:script"], effects: ["local_write"], riskLevel: "high", executionPolicy: "auto", inputSchema: "skillScriptExecuteSchema", outputSchema: "{ status, stdout, stderr, exitCode, degradedReason? }" }
  ]
};

const personalResearchSkill: ExtensionManifest = {
  id: "personal.research",
  name: "Research and Decision Agent",
  description: "Structure explicitly supplied material and state uncertainty when the supplied context is insufficient.",
  kind: "skill",
  phase: "phase-5",
  status: "active",
  entrypoint: "/api/extensions/personal.research/invoke",
  capabilities: [
    {
      id: "research.summarize_supplied_text",
      label: "Structure supplied research material",
      description: "Summarize user-supplied material, separate claims from uncertainty, and do not retrieve data.",
      permissions: ["research:read"],
      inputSchema: "{ content: string }",
      outputSchema: "{ summary: string, uncertainty: string[] }"
    }
  ]
};

const localBookmarksConnector: ExtensionManifest = {
  id: "local.bookmarks",
  name: "Local Bookmarks Connector",
  description: "Read-only connector for user-supplied local bookmark data stored under the app data directory.",
  kind: "connector",
  phase: "phase-4",
  status: "active",
  entrypoint: "/api/extensions/local.bookmarks/invoke",
  capabilities: [
    {
      id: "bookmarks.search",
      label: "Search local bookmarks",
      description: "Search configured local bookmark records without calling external services or mutating state.",
      permissions: ["bookmarks:read", "connector:read"],
      inputSchema: "localBookmarkSearchSchema",
      outputSchema: "{ bookmarks: localBookmark[], degradedReason?: string }"
    },
    {
      id: "bookmarks.digest",
      label: "Digest local bookmarks",
      description: "Create a read-only digest of configured local bookmarks grouped by tags and filtered by optional query or tag.",
      permissions: ["bookmarks:read", "connector:read"],
      inputSchema: "localBookmarkDigestSchema",
      outputSchema: "{ digest: object, bookmarks: localBookmark[], degradedReason?: string }"
    }
  ]
};

const personalBriefingSkill: ExtensionManifest = {
  id: "personal.briefing",
  name: "Personal Research Briefing",
  description: "Small read-only reference skill that reuses the workflow and evidence conventions to summarize recent research runs.",
  kind: "skill",
  phase: "phase-6",
  status: "active",
  entrypoint: "/api/extensions/personal.briefing/invoke",
  capabilities: [{
    id: "briefing.recent_research",
    label: "Read recent research briefing",
    description: "Return recent research questions, conclusions, status, and degraded states without changing durable data.",
    permissions: ["research:read", "workflow:read"],
    inputSchema: "researchBriefingSchema",
    outputSchema: "{ runs: researchBriefingRun[] }"
  }]
};

const speechSkill: ExtensionManifest = {
  id: "local.speech",
  name: "Speech I/O",
  description: "STT/TTS provider boundary for voice chat. Readiness is reported from configured local speech providers.",
  kind: "skill",
  phase: "phase-4",
  status: "degraded",
  entrypoint: "/api/voice",
  capabilities: [
    {
      id: "speech.transcribe",
      label: "Transcribe audio",
      description: "Convert recorded audio to text through a configured STT provider.",
      permissions: ["audio:transcribe"],
      effects: ["provider_call"],
      riskLevel: "low",
      executionPolicy: "auto",
      inputSchema: "voiceTranscribeSchema",
      outputSchema: "{ transcript: string, degradedReason?: string }"
    },
    {
      id: "speech.synthesize",
      label: "Synthesize speech",
      description: "Convert assistant text to playable audio through a configured TTS provider.",
      permissions: ["audio:synthesize"],
      effects: ["provider_call"],
      riskLevel: "low",
      executionPolicy: "auto",
      inputSchema: "voiceSynthesizeSchema",
      outputSchema: "voiceSynthesizeResponseSchema"
    }
  ],
  degradedReason: "No configured speech provider is ready."
};

const manifests: ExtensionManifest[] = [coreAgentShell, memorySkill, localContextSkill, localProjectSkill, workspaceSkill, localArtifactsExtension, remoteWebConnector, skillSandboxExtension, personalResearchSkill, localBookmarksConnector, speechSkill];

type InputContract = { input: { parse(value: unknown): unknown } };
const recordInput: InputContract = { input: { parse: requireRecord } };
const memoryIdInput: InputContract = { input: { parse(value: unknown) { const input = requireRecord(value); return { ...input, id: requireId(input) }; } } };
const promoteMemoryInput: InputContract = { input: { parse(value: unknown) { const input = requireRecord(value); return { ...promoteMemorySchema.parse(input), id: requireId(input) }; } } };
const updateMemoryInput: InputContract = { input: { parse(value: unknown) { const input = requireRecord(value); return { ...updateMemorySchema.parse(input), id: requireId(input) }; } } };

// This is the executable counterpart of the manifest's schema label. A
// capability cannot become invokable without a parser at this boundary.
const executableCapabilityContracts: Record<string, InputContract> = {
  "core.agent-shell.extensions.inspect": recordInput,
  "local.memory.memory.search": { input: searchMemorySchema },
  "local.memory.memory.write_candidate": { input: createMemoryCandidateSchema },
  "local.memory.memory.promote_fact": promoteMemoryInput,
  "local.memory.memory.update": updateMemoryInput,
  "local.memory.memory.merge": { input: mergeMemorySchema },
  "local.memory.memory.consolidate": { input: consolidateMemorySchema },
  "local.memory.memory.forget": memoryIdInput,
  "local.memory.memory.extract_session": { input: extractMemoryFromSessionSchema },
  "local.memory.memory.summarize_session": { input: summarizeMemorySessionSchema },
  "local.context.context.snapshot": recordInput,
  "local.context.context.briefing": { input: contextBriefingSchema },
  "local.project.project.search_docs": { input: projectDocSearchSchema },
  "local.project.project.plan": { input: projectPlanSchema },
  "local.workspace.workspace.list": { input: workspaceListSchema },
  "local.workspace.workspace.read_file": { input: workspaceReadFileSchema },
  "local.workspace.workspace.search": { input: workspaceSearchSchema },
  "local.workspace.workspace.write_file": { input: workspaceWriteFileSchema },
  "local.workspace.workspace.apply_patch": { input: workspaceApplyPatchSchema },
  "local.workspace.workspace.run_script": { input: workspaceRunScriptSchema },
  "local.workspace.workspace.git_status": { input: workspaceGitSchema },
  "local.artifacts.artifact.write_markdown": { input: artifactWriteMarkdownSchema },
  "local.artifacts.artifact.write_csv": { input: artifactWriteCsvSchema },
  "remote.web.web.search": { input: webSearchSchema },
  "remote.web.web.read_url": { input: webReadUrlSchema },
  "local.skill-sandbox.skill.run_sandboxed_script": { input: skillScriptExecuteSchema },
  "local.speech.speech.transcribe": { input: voiceTranscribeSchema },
  "local.speech.speech.synthesize": { input: voiceSynthesizeSchema },
  "local.bookmarks.bookmarks.search": { input: localBookmarkSearchSchema },
  "local.bookmarks.bookmarks.digest": { input: localBookmarkDigestSchema }
};

export function getExtensionRuntimeStatus(): ExtensionRuntimeStatus {
  return {
    mode: "local_personal_agent",
    safetyModel: {
      defaultToolPolicy: "trusted_local",
      disabledToolClasses: ["private_key", "wallet_transaction", "external_account_mutation"],
      highRiskActions: ["payments", "external_posting", "destructive_operation", "credential_access"]
    },
    extensions: manifests
  };
}

export function listExtensionManifests(): ExtensionManifest[] {
  return manifests;
}

export function getExtensionManifest(id: string): ExtensionManifest | undefined {
  return manifests.find((extension) => extension.id === id);
}

export function findCapability(capabilities: ExtensionCapability[], capabilityId: string): ExtensionCapability | undefined {
  return capabilities.find((capability) => capability.id === capabilityId);
}

export function parseExtensionCapabilityInput(extensionId: string, capabilityId: string, input: Record<string, unknown>) {
  const key = `${extensionId}.${capabilityId}`;
  const contract = executableCapabilityContracts[key];
  return contract ? contract.input.parse(input) : input;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Capability input must be an object.");
  return value as Record<string, unknown>;
}

function requireId(value: Record<string, unknown>) {
  if (typeof value.id !== "string" || !value.id.trim()) throw new Error("Capability input requires id.");
  return value.id;
}
