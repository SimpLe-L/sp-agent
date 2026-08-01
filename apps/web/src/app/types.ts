export type ProviderStatus = {
  configured?: boolean;
  reachable?: boolean;
  degradedReason?: string;
};

export type AgentStatus = {
  mode: "local_personal_agent";
  piRuntime?: ProviderStatus & {
    provider?: string;
    model?: string;
    selectedModel?: string;
  };
  extensions?: Array<{ id: string; name: string; status: string }>;
};

export type ExtensionCapability = {
  id: string;
  label: string;
  description: string;
  permissions: string[];
  effects?: Array<"read" | "local_write" | "provider_call" | "external_write" | "credential" | "destructive">;
  riskLevel?: "low" | "medium" | "high" | "critical";
  executionPolicy?: "auto" | "single_approval" | "session_approval" | "always_deny";
  inputSchema?: string;
  outputSchema?: string;
};

export type ExtensionManifest = {
  id: string;
  name: string;
  description: string;
  kind: "core" | "skill" | "connector" | "workflow";
  phase: string;
  status: "active" | "disabled" | "planned" | "degraded";
  entrypoint?: string;
  capabilities: ExtensionCapability[];
  degradedReason?: string;
};

export type ExtensionRuntimeCatalog = {
  safetyModel: {
    defaultToolPolicy: "read_only" | "trusted_local";
    disabledToolClasses: string[];
    highRiskActions: string[];
  };
  extensions: ExtensionManifest[];
};

export type AgentMessageResponse = {
  sessionId: string;
  role: "assistant";
  content: string;
  provider: string;
  model?: string;
  degradedReason?: string;
  activeTools?: string[];
  toolCalls?: Array<Record<string, unknown>>;
  artifacts?: AgentArtifact[];
};

export type AgentArtifact = {
  kind: "research_report";
  workflowId: string;
  report: ResearchReport;
};

export type AgentStreamEvent =
  | { type: "metadata"; sessionId: string; memoryContextCount: number }
  | { type: "text_delta"; text: string }
  | { type: "done"; sessionId: string; result: AgentMessageResponse }
  | { type: "error"; message: string };

export type VoiceStatus = {
  ready: boolean;
  degradedReason?: string;
  stt: ProviderStatus & { name: string };
  tts: ProviderStatus & { name: string };
};

export type VoiceChatResponse = {
  sessionId: string;
  transcript?: string;
  assistantText: string;
  audioBase64?: string;
  mimeType?: string;
  degradedReason?: string;
  timing?: {
    sttMs: number;
    agentMs: number;
    ttsMs: number;
    totalMs: number;
  };
};

export type AgentRunEvent = {
  id: string;
  kind: "run_started" | "context_compiled" | "tool_requested" | "tool_completed" | "runtime_completed" | "run_completed" | "run_failed";
  timestamp: string;
  data: Record<string, unknown>;
};

export type AgentRun = {
  id: string;
  sessionId: string;
  runtimeId: string;
  status: "running" | "completed" | "degraded" | "failed";
  context: {
    messageChars: number;
    conversationMessageCount: number;
    conversationChars: number;
    memoryCount: number;
    memoryIds: string[];
    extensionCount: number;
    capabilityCount: number;
    visibleExtensionIds: string[];
    activeSkillIds: string[];
  };
  provider?: string;
  model?: string;
  degradedReason?: string;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
  events: AgentRunEvent[];
};



export type ThreadRecord = {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt: string;
  messages?: Array<{ id?: string; role: string; content: string; metadata?: Record<string, unknown>; createdAt: string }>;
};

export type ApprovalRequest = {
  id: string;
  extensionId?: string;
  capabilityId?: string;
  action: string;
  reason: string;
  permissions: string[];
  input: Record<string, unknown>;
  status: "pending" | "approved" | "denied" | "expired" | "consumed";
  executionPolicy: "single_use" | "reusable";
  idempotencyKey?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  expiresAt?: string;
  consumedAt?: string;
};

export type ExtensionInvocationResponse = {
  extensionId: string;
  capabilityId: string;
  permissionAudit: {
    extensionId: string;
    capabilityId: string;
    permissions: string[];
    allowed: boolean;
    mode: "read_only" | "write_or_provider";
    reason: string;
  };
  status: "completed" | "degraded" | "pending_approval";
  result: unknown;
  degradedReason?: string;
  approval?: ApprovalRequest;
};

export type WorkflowNodeEvent = {
  id: string;
  nodeId: string;
  label: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  payload: Record<string, unknown>;
  error?: string;
  degradedReason?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
};

export type WorkflowRun = {
  id: string;
  kind: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  input: Record<string, unknown>;
  result?: unknown;
  degradedReason?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  checkpoint?: { nodeId: string; data: Record<string, unknown>; updatedAt: string };
  attempt?: number;
  maxRetries?: number;
  correlationId?: string;
  nodeEvents: WorkflowNodeEvent[];
};

export type ResearchSourceScope = "local_documents" | "bookmarks" | "user_provided" | "web";

export type ResearchSource = {
  id: string;
  type: "local_document" | "bookmark" | "user_import" | "web" | "memory";
  title: string;
  locator: string;
  retrievedAt: string;
  contentHash: string;
  contentPreview?: string;
  degradedReason?: string;
  metadata: Record<string, unknown>;
};

export type ResearchEvidence = {
  id: string;
  sourceId: string;
  excerpt: string;
  locator?: string;
  relevance: number;
  confidence: number;
  extractionMethod: "deterministic" | "provider" | "manual";
  queryTerms: string[];
  createdAt: string;
};

export type ResearchClaim = {
  id: string;
  statement: string;
  supportingEvidenceIds: string[];
  conflictingEvidenceIds: string[];
  confidence: number;
  status: "supported" | "contested" | "insufficient";
};

export type ResearchReport = {
  id: string;
  workflowId: string;
  request: {
    question: string;
    sessionId?: string;
    sourceScopes: ResearchSourceScope[];
    sourceIds: string[];
    maxSources: number;
    reportFormat: "brief" | "detailed";
    strategy: "deterministic" | "provider_assisted";
  };
  answer: string;
  claims: ResearchClaim[];
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  uncertainty: string[];
  openQuestions: string[];
  provider: "deterministic" | "provider_assisted";
  degradedReason?: string;
  metrics: {
    sourceCount: number;
    evidenceCount: number;
    citedClaimCount: number;
    unsupportedClaimCount: number;
    conflictingClaimCount: number;
    memoryCount: number;
    collectionMs: number;
    analysisMs: number;
    totalMs: number;
  };
  createdAt: string;
  completedAt: string;
};

export type MemoryKind = "core" | "journal" | "summary" | "procedural" | "project";
export type MemoryStatus = "candidate" | "active" | "tombstoned";

export type MemoryEntry = {
  id: string;
  kind: MemoryKind;
  scope: "global" | "session";
  sessionId?: string;
  content: string;
  source: { type: string; id?: string; label?: string };
  provenance: Record<string, unknown>;
  confidence: number;
  sensitivity: "normal" | "sensitive";
  tags: string[];
  status: MemoryStatus;
  conflictsWith: string[];
  conflictReason?: string;
  occurredAt?: string;
  createdAt: string;
  updatedAt: string;
  promotedAt?: string;
  tombstonedAt?: string;
};

export type MemorySearchResult = {
  entry: MemoryEntry;
  score: number;
  matchedTerms: string[];
  rankingSignals: string[];
  sourceSnippet?: string;
  citation?: {
    memoryId: string;
    sourceType: string;
    sourceId?: string;
    sourceLabel?: string;
    sessionId?: string;
    messageId?: string;
    occurredAt?: string;
    createdAt: string;
    snippet: string;
  };
  debug?: {
    strategy?: "core_semantic" | "journal_temporal" | "hybrid";
    score: number;
    matchedTermCount: number;
    rankingSignals: string[];
    vectorScore?: number;
    temporalWindow?: boolean;
  };
};

export type MemoryConsolidationSuggestion = {
  sourceIds: string[];
  content: string;
  kind: MemoryKind;
  reason: string;
  confidence: number;
  sensitivity: "normal" | "sensitive";
  occurredAt?: string;
  tags: string[];
  conflictReason?: string;
};

export type MemoryAuditEvent = {
  id: string;
  memoryId: string;
  action: string;
  reason?: string;
  sourceMemoryIds: string[];
  createdAt: string;
};

export type MemoryUpdatePayload = {
  content: string;
  kind: MemoryKind;
  sensitivity: "normal" | "sensitive";
  tags: string[];
  occurredAt?: string;
};
