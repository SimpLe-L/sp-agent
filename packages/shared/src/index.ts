import { z } from "zod";

export const providerStatusSchema = z.object({
  name: z.string(),
  configured: z.boolean(),
  reachable: z.boolean(),
  degradedReason: z.string().optional()
});
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const providerReadinessItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["ready", "missing", "degraded", "manual"]),
  capability: z.string(),
  envVars: z.array(z.string()).default([]),
  envTemplate: z.string().optional(),
  action: z.string(),
  docsHint: z.string().optional()
});
export type ProviderReadinessItem = z.infer<typeof providerReadinessItemSchema>;

export const settingsSchema = z.object({
  llmProvider: z.string().default("pi"),
  model: z.string().optional(),
  dataRetentionDays: z.number().int().positive().default(365)
});
export type AppSettings = z.infer<typeof settingsSchema>;

export const remoteResearchAccessSchema = z.object({
  enabled: z.boolean().default(false),
  updatedAt: z.string().optional(),
  approvalId: z.string().optional()
});
export type RemoteResearchAccess = z.infer<typeof remoteResearchAccessSchema>;

export const chatRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: chatRoleSchema,
  content: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string()
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(chatMessageSchema).default([])
});
export type ChatSession = z.infer<typeof chatSessionSchema>;

export const createChatSessionSchema = z.object({
  title: z.string().optional()
});
export type CreateChatSessionInput = z.infer<typeof createChatSessionSchema>;

export const updateChatSessionSchema = z.object({
  title: z.string().min(1).max(120)
});
export type UpdateChatSessionInput = z.infer<typeof updateChatSessionSchema>;

export const createChatMessageSchema = z.object({
  role: chatRoleSchema.default("user"),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).default({})
});
export type CreateChatMessageInput = z.infer<typeof createChatMessageSchema>;

export const memoryScopeSchema = z.enum(["global", "session"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryKindSchema = z.enum(["core", "journal", "summary", "procedural", "project"]);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

export const memorySensitivitySchema = z.enum(["normal", "sensitive"]);
export type MemorySensitivity = z.infer<typeof memorySensitivitySchema>;

export const memorySourceSchema = z.object({
  type: z.enum(["user", "assistant", "import", "system", "voice"]),
  id: z.string().optional(),
  label: z.string().optional()
});
export type MemorySource = z.infer<typeof memorySourceSchema>;

export const memoryEntrySchema = z.object({
  id: z.string(),
  kind: memoryKindSchema.default("core"),
  scope: memoryScopeSchema.default("global"),
  sessionId: z.string().optional(),
  content: z.string(),
  source: memorySourceSchema,
  provenance: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0.7),
  sensitivity: memorySensitivitySchema.default("normal"),
  tags: z.array(z.string()).default([]),
  status: z.enum(["candidate", "active", "tombstoned"]).default("candidate"),
  supersedes: z.array(z.string()).default([]),
  conflictsWith: z.array(z.string()).default([]),
  conflictGroupId: z.string().optional(),
  conflictReason: z.string().optional(),
  occurredAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  promotedAt: z.string().optional(),
  tombstonedAt: z.string().optional()
});
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

export const createMemoryCandidateSchema = z.object({
  content: z.string().min(1),
  kind: memoryKindSchema.default("core"),
  scope: memoryScopeSchema.default("global"),
  sessionId: z.string().optional(),
  source: memorySourceSchema.default({ type: "user" }),
  provenance: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0.7),
  sensitivity: memorySensitivitySchema.default("normal"),
  occurredAt: z.string().optional(),
  tags: z.array(z.string()).default([])
});
export type CreateMemoryCandidateInput = z.infer<typeof createMemoryCandidateSchema>;

export const extractMemoryFromSessionSchema = z.object({
  sessionId: z.string().min(1),
  includeAssistant: z.boolean().default(false),
  maxCandidates: z.coerce.number().int().positive().max(20).default(8)
});
export type ExtractMemoryFromSessionInput = z.infer<typeof extractMemoryFromSessionSchema>;

export const summarizeMemorySessionSchema = z.object({
  sessionId: z.string().min(1),
  maxMessages: z.coerce.number().int().positive().max(80).default(30)
});
export type SummarizeMemorySessionInput = z.infer<typeof summarizeMemorySessionSchema>;

export const consolidateMemorySchema = z.object({
  statuses: z.array(z.enum(["candidate", "active"])).default(["candidate", "active"]),
  maxSuggestions: z.coerce.number().int().positive().max(20).default(8),
  includeSensitive: z.coerce.boolean().default(false)
});
export type ConsolidateMemoryInput = z.infer<typeof consolidateMemorySchema>;

export const searchMemorySchema = z.object({
  query: z.string().min(1),
  strategy: z.enum(["auto", "core_semantic", "journal_temporal", "hybrid"]).default("auto"),
  kind: memoryKindSchema.optional(),
  scope: memoryScopeSchema.optional(),
  sessionId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  includeSensitive: z.coerce.boolean().default(false),
  statuses: z.preprocess(
    (value) => typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : value,
    z.array(z.enum(["candidate", "active", "tombstoned"])).optional()
  ),
  limit: z.coerce.number().int().positive().max(50).default(10)
});
export type SearchMemoryInput = z.infer<typeof searchMemorySchema>;

export const memorySearchResultSchema = z.object({
  entry: memoryEntrySchema,
  score: z.number(),
  matchedTerms: z.array(z.string()).default([]),
  rankingSignals: z.array(z.string()).default([]),
  sourceSnippet: z.string().optional(),
  citation: z.object({
    memoryId: z.string(),
    sourceType: z.string(),
    sourceId: z.string().optional(),
    sourceLabel: z.string().optional(),
    sessionId: z.string().optional(),
    messageId: z.string().optional(),
    occurredAt: z.string().optional(),
    createdAt: z.string(),
    snippet: z.string()
  }).optional(),
  debug: z.object({
    strategy: z.enum(["core_semantic", "journal_temporal", "hybrid"]).optional(),
    score: z.number(),
    matchedTermCount: z.number(),
    rankingSignals: z.array(z.string()).default([]),
    vectorScore: z.number().optional(),
    temporalWindow: z.boolean().optional()
  }).optional()
});
export type MemorySearchResult = z.infer<typeof memorySearchResultSchema>;

export const updateMemorySchema = z.object({
  content: z.string().min(1).optional(),
  kind: memoryKindSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  sensitivity: memorySensitivitySchema.optional(),
  tags: z.array(z.string()).optional(),
  provenance: z.record(z.unknown()).optional(),
  occurredAt: z.string().optional()
});
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;

export const promoteMemorySchema = z.object({
  reason: z.string().min(1).default("Accepted by user or API policy.")
});
export type PromoteMemoryInput = z.infer<typeof promoteMemorySchema>;

export const mergeMemorySchema = z.object({
  sourceIds: z.array(z.string()).min(1),
  content: z.string().min(1),
  kind: memoryKindSchema.default("core"),
  reason: z.string().min(1).default("Merged related memories."),
  confidence: z.number().min(0).max(1).default(0.8),
  sensitivity: memorySensitivitySchema.default("normal"),
  occurredAt: z.string().optional(),
  tags: z.array(z.string()).default([])
});
export type MergeMemoryInput = z.infer<typeof mergeMemorySchema>;

export const memoryConsolidationSuggestionSchema = z.object({
  sourceIds: z.array(z.string()).min(2),
  content: z.string().min(1),
  kind: memoryKindSchema.default("core"),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.8),
  sensitivity: memorySensitivitySchema.default("normal"),
  occurredAt: z.string().optional(),
  tags: z.array(z.string()).default([]),
  conflictReason: z.string().optional()
});
export type MemoryConsolidationSuggestion = z.infer<typeof memoryConsolidationSuggestionSchema>;

export const memoryAuditEventSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  action: z.enum(["candidate_created", "promoted", "updated", "merged", "forgotten", "conflict_detected", "conflict_resolved"]),
  reason: z.string().optional(),
  sourceMemoryIds: z.array(z.string()).default([]),
  createdAt: z.string()
});
export type MemoryAuditEvent = z.infer<typeof memoryAuditEventSchema>;

export const approvalRequestSchema = z.object({
  id: z.string(),
  extensionId: z.string().optional(),
  capabilityId: z.string().optional(),
  action: z.string(),
  reason: z.string(),
  permissions: z.array(z.string()).default([]),
  input: z.record(z.unknown()).default({}),
  status: z.enum(["pending", "approved", "denied", "expired", "consumed"]).default("pending"),
  executionPolicy: z.enum(["single_use", "reusable"]).default("single_use"),
  idempotencyKey: z.string().min(1).max(128).optional(),
  sessionId: z.string().min(1).max(160).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  decidedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  consumedAt: z.string().optional()
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const createApprovalRequestSchema = z.object({
  extensionId: z.string().optional(),
  capabilityId: z.string().optional(),
  action: z.string().min(1),
  reason: z.string().min(1),
  permissions: z.array(z.string()).default([]),
  input: z.record(z.unknown()).default({}),
  executionPolicy: z.enum(["single_use", "reusable"]).default("single_use"),
  idempotencyKey: z.string().min(1).max(128).optional(),
  sessionId: z.string().min(1).max(160).optional()
});
export type CreateApprovalRequestInput = z.infer<typeof createApprovalRequestSchema>;

export const decideApprovalRequestSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  reason: z.string().optional()
});
export type DecideApprovalRequestInput = z.infer<typeof decideApprovalRequestSchema>;

export const workflowNodeEventSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  label: z.string(),
  status: z.enum(["pending", "running", "paused", "completed", "failed", "cancelled"]),
  payload: z.record(z.unknown()).default({}),
  error: z.string().optional(),
  degradedReason: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  createdAt: z.string()
});
export type WorkflowNodeEvent = z.infer<typeof workflowNodeEventSchema>;

export const workflowRunSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.enum(["pending", "running", "paused", "completed", "failed", "cancelled"]),
  input: z.record(z.unknown()).default({}),
  result: z.unknown().optional(),
  degradedReason: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  checkpoint: z.object({ nodeId: z.string(), data: z.record(z.unknown()).default({}), updatedAt: z.string() }).optional(),
  attempt: z.number().int().nonnegative().default(0),
  maxRetries: z.number().int().nonnegative().default(0),
  correlationId: z.string().optional(),
  nodeEvents: z.array(workflowNodeEventSchema).default([])
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export const startWorkflowSchema = z.object({
  kind: z.string().min(1),
  input: z.record(z.unknown()).default({})
});
export type StartWorkflowInput = z.infer<typeof startWorkflowSchema>;

export const projectDocSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.coerce.number().int().positive().max(10).default(5)
});
export type ProjectDocSearchInput = z.infer<typeof projectDocSearchSchema>;

export const projectPlanSchema = z.object({
  goal: z.string().min(1),
  limit: z.coerce.number().int().positive().max(10).default(5)
});
export type ProjectPlanInput = z.infer<typeof projectPlanSchema>;

export const contextBriefingSchema = z.object({
  includeWorkflows: z.coerce.boolean().default(true),
  workflowLimit: z.coerce.number().int().positive().max(10).default(5)
});
export type ContextBriefingInput = z.infer<typeof contextBriefingSchema>;

export const localBookmarkSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  source: z.string().default("local-json"),
  createdAt: z.string()
});
export type LocalBookmark = z.infer<typeof localBookmarkSchema>;

export const localBookmarkConnectorFileSchema = z.object({
  bookmarks: z.array(localBookmarkSchema).default([])
});
export type LocalBookmarkConnectorFile = z.infer<typeof localBookmarkConnectorFileSchema>;

export const localBookmarkSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.coerce.number().int().positive().max(20).default(5)
});
export type LocalBookmarkSearchInput = z.infer<typeof localBookmarkSearchSchema>;

export const localBookmarkDigestSchema = z.object({
  query: z.string().optional(),
  tag: z.string().optional(),
  limit: z.coerce.number().int().positive().max(20).default(10)
});
export type LocalBookmarkDigestInput = z.infer<typeof localBookmarkDigestSchema>;

export const researchSourceScopeSchema = z.enum(["local_documents", "bookmarks", "user_provided", "web"]);
export type ResearchSourceScope = z.infer<typeof researchSourceScopeSchema>;

export const researchSourceTypeSchema = z.enum(["local_document", "bookmark", "user_import", "web", "memory"]);
export type ResearchSourceType = z.infer<typeof researchSourceTypeSchema>;

export const researchRequestSchema = z.object({
  question: z.string().min(3).max(4_000),
  sessionId: z.string().min(1).max(160).optional(),
  sourceScopes: z.array(researchSourceScopeSchema).min(1).max(4).default(["local_documents", "bookmarks"]),
  sourceIds: z.array(z.string().min(1).max(240)).max(100).default([]),
  maxSources: z.coerce.number().int().positive().max(30).default(12),
  reportFormat: z.enum(["brief", "detailed"]).default("brief"),
  strategy: z.enum(["deterministic", "provider_assisted"]).default("deterministic")
});
export type ResearchRequest = z.infer<typeof researchRequestSchema>;

export const researchSourceSchema = z.object({
  id: z.string(),
  type: researchSourceTypeSchema,
  title: z.string(),
  locator: z.string(),
  retrievedAt: z.string(),
  contentHash: z.string(),
  contentPreview: z.string().optional(),
  degradedReason: z.string().optional(),
  metadata: z.record(z.unknown()).default({})
});
export type ResearchSource = z.infer<typeof researchSourceSchema>;

export const researchEvidenceSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  excerpt: z.string().min(1),
  locator: z.string().optional(),
  relevance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  extractionMethod: z.enum(["deterministic", "provider", "manual"]),
  queryTerms: z.array(z.string()).default([]),
  createdAt: z.string()
});
export type ResearchEvidence = z.infer<typeof researchEvidenceSchema>;

export const researchClaimSchema = z.object({
  id: z.string(),
  statement: z.string().min(1),
  supportingEvidenceIds: z.array(z.string()).default([]),
  conflictingEvidenceIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  status: z.enum(["supported", "contested", "insufficient"])
});
export type ResearchClaim = z.infer<typeof researchClaimSchema>;

export const researchMetricsSchema = z.object({
  sourceCount: z.number().int().nonnegative(),
  evidenceCount: z.number().int().nonnegative(),
  citedClaimCount: z.number().int().nonnegative(),
  unsupportedClaimCount: z.number().int().nonnegative(),
  conflictingClaimCount: z.number().int().nonnegative(),
  memoryCount: z.number().int().nonnegative(),
  collectionMs: z.number().int().nonnegative(),
  analysisMs: z.number().int().nonnegative(),
  totalMs: z.number().int().nonnegative()
});
export type ResearchMetrics = z.infer<typeof researchMetricsSchema>;

export const researchConnectorStatusSchema = z.object({
  id: z.string(),
  required: z.boolean(),
  status: z.enum(["ready", "missing", "degraded"]),
  sourceCount: z.number().int().nonnegative().default(0),
  retrievedAt: z.string().optional(),
  degradedReason: z.string().optional()
});
export type ResearchConnectorStatus = z.infer<typeof researchConnectorStatusSchema>;

export const researchReportSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  request: researchRequestSchema,
  plan: z.object({
    responseMode: z.literal("evidence_research"),
    skillId: z.enum(["general.local_first", "crypto.investment"]),
    decisionType: z.string(),
    objective: z.string(),
    researchQuestions: z.array(z.string()),
    requiredDimensions: z.array(z.string()),
    sourceStrategy: z.enum(["local_only", "local_then_remote"]),
    maxSources: z.number(),
    maxWebResults: z.number(),
    freshness: z.string(),
    rationale: z.string()
  }).optional(),
  answer: z.string().min(1),
  claims: z.array(researchClaimSchema).default([]),
  sources: z.array(researchSourceSchema).default([]),
  evidence: z.array(researchEvidenceSchema).default([]),
  connectorStatuses: z.array(researchConnectorStatusSchema).default([]),
  uncertainty: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  provider: z.enum(["deterministic", "provider_assisted"]),
  degradedReason: z.string().optional(),
  metrics: researchMetricsSchema,
  createdAt: z.string(),
  completedAt: z.string()
});
export type ResearchReport = z.infer<typeof researchReportSchema>;

export const researchGetReportSchema = z.object({
  workflowId: z.string().min(1)
});
export type ResearchGetReportInput = z.infer<typeof researchGetReportSchema>;

export const researchPromoteClaimSchema = z.object({
  workflowId: z.string().min(1),
  claimId: z.string().min(1),
  reason: z.string().min(1).default("User accepted a cited research conclusion as durable memory."),
  tags: z.array(z.string()).max(12).default(["research"])
});
export type ResearchPromoteClaimInput = z.infer<typeof researchPromoteClaimSchema>;

export const researchImportSourceSchema = z.object({
  title: z.string().min(1).max(240),
  content: z.string().min(1).max(200_000),
  locator: z.string().max(2_000).optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).default([])
});
export type ResearchImportSourceInput = z.infer<typeof researchImportSourceSchema>;

export const researchFetchWebSourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(240).optional()
});
export type ResearchFetchWebSourceInput = z.infer<typeof researchFetchWebSourceSchema>;

export const researchWebSearchSchema = z.object({
  question: z.string().min(3).max(4_000),
  sessionId: z.string().min(1).max(160).optional(),
  maxResults: z.coerce.number().int().positive().max(8).default(5)
});
export type ResearchWebSearchInput = z.infer<typeof researchWebSearchSchema>;

export const researchPlanSchema = z.object({
  responseMode: z.literal("evidence_research"),
  skillId: z.enum(["general.local_first", "crypto.investment"]),
  decisionType: z.string().min(1).max(80),
  objective: z.string().min(3).max(1_000),
  researchQuestions: z.array(z.string().min(3).max(500)).min(1).max(8),
  requiredDimensions: z.array(z.string().min(2).max(120)).min(1).max(12),
  sourceStrategy: z.enum(["local_only", "local_then_remote"]),
  maxSources: z.coerce.number().int().positive().max(20).default(10),
  maxWebResults: z.coerce.number().int().positive().max(8).default(5),
  freshness: z.string().min(1).max(160),
  rationale: z.string().min(1).max(2_000)
});
export type ResearchPlan = z.infer<typeof researchPlanSchema>;

export const researchProviderRunSchema = z.object({
  question: z.string().min(3).max(4_000),
  sessionId: z.string().min(1).max(160).optional(),
  maxSources: z.coerce.number().int().positive().max(20).default(10),
  maxWebResults: z.coerce.number().int().positive().max(8).default(5),
  reportFormat: z.enum(["brief", "detailed"]).default("brief")
});
export type ResearchProviderRunInput = z.infer<typeof researchProviderRunSchema>;

export const researchBriefingSchema = z.object({
  limit: z.coerce.number().int().positive().max(20).default(5)
});
export type ResearchBriefingInput = z.infer<typeof researchBriefingSchema>;

export const speechProviderStatusSchema = z.object({
  name: z.string(),
  configured: z.boolean(),
  reachable: z.boolean(),
  degradedReason: z.string().optional()
});
export type SpeechProviderStatus = z.infer<typeof speechProviderStatusSchema>;

export const voiceStatusSchema = z.object({
  stt: speechProviderStatusSchema,
  tts: speechProviderStatusSchema,
  ready: z.boolean(),
  degradedReason: z.string().optional()
});
export type VoiceStatus = z.infer<typeof voiceStatusSchema>;

export const voiceTranscribeSchema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().default("audio/webm"),
  sessionId: z.string().optional()
});
export type VoiceTranscribeInput = z.infer<typeof voiceTranscribeSchema>;

export const voiceTranscribeResponseSchema = z.object({
  transcript: z.string().optional(),
  provider: z.string(),
  degradedReason: z.string().optional()
});
export type VoiceTranscribeResponse = z.infer<typeof voiceTranscribeResponseSchema>;

export const voiceSynthesizeSchema = z.object({
  text: z.string().min(1),
  voice: z.string().optional(),
  sessionId: z.string().optional()
});
export type VoiceSynthesizeInput = z.infer<typeof voiceSynthesizeSchema>;

export const voiceSynthesizeResponseSchema = z.object({
  audioBase64: z.string().optional(),
  mimeType: z.string().optional(),
  provider: z.string(),
  degradedReason: z.string().optional()
});
export type VoiceSynthesizeResponse = z.infer<typeof voiceSynthesizeResponseSchema>;

export const voiceChatSchema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().default("audio/webm"),
  sessionId: z.string().optional(),
  voice: z.string().optional()
});
export type VoiceChatInput = z.infer<typeof voiceChatSchema>;

export const voiceChatResponseSchema = z.object({
  sessionId: z.string(),
  transcript: z.string().optional(),
  assistantText: z.string(),
  audioBase64: z.string().optional(),
  mimeType: z.string().optional(),
  degradedReason: z.string().optional(),
  timing: z.object({
    sttMs: z.number().int().nonnegative(),
    agentMs: z.number().int().nonnegative(),
    ttsMs: z.number().int().nonnegative(),
    totalMs: z.number().int().nonnegative()
  }).optional()
});
export type VoiceChatResponse = z.infer<typeof voiceChatResponseSchema>;

export const voiceAuditEventSchema = z.object({
  id: z.string(),
  action: z.enum([
    "voice.transcribe_requested",
    "voice.transcribe_completed",
    "voice.synthesize_requested",
    "voice.synthesize_completed",
    "voice.degraded"
  ]),
  sessionId: z.string().optional(),
  provider: z.string().optional(),
  status: z.enum(["requested", "completed", "degraded"]),
  degradedReason: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string()
});
export type VoiceAuditEvent = z.infer<typeof voiceAuditEventSchema>;

export const extensionCapabilitySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  permissions: z.array(z.string()).default([]),
  effects: z.array(z.enum(["read", "local_write", "provider_call", "external_write", "credential", "destructive"])).default(["read"]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
  executionPolicy: z.enum(["auto", "single_approval", "session_approval", "always_deny"]).default("auto"),
  inputSchema: z.string().optional(),
  outputSchema: z.string().optional()
});
// Registry declarations may omit defaulted policy fields; parsed API payloads receive defaults.
export type ExtensionCapability = z.input<typeof extensionCapabilitySchema>;

export const extensionManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  kind: z.enum(["core", "skill", "connector", "workflow"]),
  phase: z.string(),
  status: z.enum(["active", "disabled", "planned", "degraded"]),
  entrypoint: z.string().optional(),
  capabilities: z.array(extensionCapabilitySchema),
  degradedReason: z.string().optional()
});
export type ExtensionManifest = z.input<typeof extensionManifestSchema>;

export const extensionInvocationAuditSchema = z.object({
  extensionId: z.string(),
  capabilityId: z.string(),
  permissions: z.array(z.string()).default([]),
  allowed: z.boolean(),
  effects: z.array(z.enum(["read", "local_write", "provider_call", "external_write", "credential", "destructive"])).default(["read"]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
  executionPolicy: z.enum(["auto", "single_approval", "session_approval", "always_deny"]).default("auto"),
  mode: z.enum(["read_only", "trusted_local", "approval_required", "denied"]),
  reason: z.string()
});
export type ExtensionInvocationAudit = z.infer<typeof extensionInvocationAuditSchema>;

export const capabilityAuditEventSchema = z.object({
  id: z.string(),
  extensionId: z.string(),
  capabilityId: z.string(),
  sessionId: z.string().optional(),
  runtimeId: z.string().optional(),
  skillId: z.string().optional(),
  status: z.enum(["requested", "pending_approval", "completed", "degraded", "denied", "failed"]),
  permissionAudit: extensionInvocationAuditSchema,
  inputDigest: z.string(),
  inputSummary: z.record(z.unknown()),
  scope: z.record(z.unknown()),
  resultSummary: z.record(z.unknown()).optional(),
  degradedReason: z.string().optional(),
  createdAt: z.string()
});
export type CapabilityAuditEvent = z.infer<typeof capabilityAuditEventSchema>;

export const invokeExtensionSchema = z.object({
  capabilityId: z.string().optional(),
  input: z.record(z.unknown()).default({}),
  approvalId: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  sessionId: z.string().min(1).max(160).optional()
});
export type InvokeExtensionInput = z.infer<typeof invokeExtensionSchema>;

export const workspacePathSchema = z.string().min(1).max(4_000);
export const workspaceListSchema = z.object({ path: workspacePathSchema.default("."), depth: z.coerce.number().int().min(0).max(8).default(2), limit: z.coerce.number().int().positive().max(1_000).default(200) });
export const workspaceReadFileSchema = z.object({
  path: workspacePathSchema,
  offsetBytes: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  maxBytes: z.coerce.number().int().positive().max(1_000_000).default(200_000)
});
export const workspaceSearchSchema = z.object({ query: z.string().min(1).max(500), path: workspacePathSchema.default("."), maxResults: z.coerce.number().int().positive().max(200).default(50) });
export const workspaceWriteFileSchema = z.object({ path: workspacePathSchema, content: z.string().max(2_000_000), createOnly: z.coerce.boolean().default(false) });
export const workspaceApplyPatchSchema = z.object({ patch: z.string().min(1).max(2_000_000), cwd: workspacePathSchema.default(".") });
export const workspaceRunScriptSchema = z.object({ command: z.enum(["test", "build", "typecheck", "lint", "smoke"]), cwd: workspacePathSchema.default("."), timeoutMs: z.coerce.number().int().positive().max(300_000).default(120_000) });
export const workspaceGitSchema = z.object({ cwd: workspacePathSchema.default("."), includeDiff: z.coerce.boolean().default(true), maxBytes: z.coerce.number().int().positive().max(500_000).default(120_000) });
export const artifactWriteMarkdownSchema = z.object({
  path: workspacePathSchema,
  title: z.string().min(1).max(240).optional(),
  content: z.string().min(1).max(1_000_000),
  createOnly: z.coerce.boolean().default(false)
});
export type ArtifactWriteMarkdownInput = z.infer<typeof artifactWriteMarkdownSchema>;

export const artifactWriteCsvSchema = z.object({
  path: workspacePathSchema,
  columns: z.array(z.string().min(1).max(240)).min(1).max(80),
  rows: z.array(z.array(z.union([z.string().max(20_000), z.number(), z.boolean(), z.null()])).max(80)).max(10_000),
  createOnly: z.coerce.boolean().default(false)
});
export type ArtifactWriteCsvInput = z.infer<typeof artifactWriteCsvSchema>;

export const webReadUrlSchema = z.object({
  url: z.string().url().max(2_000),
  maxBytes: z.coerce.number().int().positive().max(1_000_000).default(400_000)
});
export type WebReadUrlInput = z.infer<typeof webReadUrlSchema>;

export const webSearchSchema = z.object({
  query: z.string().min(2).max(500),
  maxResults: z.coerce.number().int().positive().max(8).default(5)
});
export type WebSearchInput = z.infer<typeof webSearchSchema>;
export const skillScriptExecuteSchema = z.object({
  skillId: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(120),
  version: z.string().min(1).max(80).optional(),
  scriptPath: workspacePathSchema,
  args: z.array(z.string().max(1_000)).max(20).default([]),
  timeoutMs: z.coerce.number().int().positive().max(60_000).default(15_000),
  maxOutputBytes: z.coerce.number().int().positive().max(200_000).default(50_000)
});
export type SkillScriptExecuteInput = z.infer<typeof skillScriptExecuteSchema>;

export const mcpToolPolicySchema = z.object({
  effects: z.array(z.enum(["read", "local_write", "provider_call", "external_write", "credential", "destructive"])).min(1).default(["provider_call"]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  executionPolicy: z.enum(["auto", "single_approval", "session_approval", "always_deny"]).default("auto")
});

export const mcpToolSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(4_000).default(""),
  inputSchema: z.record(z.unknown()).default({}),
  discoveredAt: z.string()
});
export type McpTool = z.infer<typeof mcpToolSchema>;

export const createMcpServerSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(80),
  name: z.string().min(1).max(120),
  command: z.string().min(1).max(1_000),
  args: z.array(z.string().max(2_000)).max(40).default([]),
  cwd: z.string().max(4_000).optional(),
  toolPolicies: z.record(mcpToolPolicySchema).default({})
});
export type CreateMcpServerInput = z.infer<typeof createMcpServerSchema>;

export const updateMcpServerSchema = createMcpServerSchema.partial().omit({ id: true }).extend({ enabled: z.boolean().optional() });
export type UpdateMcpServerInput = z.infer<typeof updateMcpServerSchema>;

export const mcpServerSchema = createMcpServerSchema.extend({
  enabled: z.boolean(),
  tools: z.array(mcpToolSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastDiscoveredAt: z.string().optional(),
  degradedReason: z.string().optional()
});
export type McpServer = z.infer<typeof mcpServerSchema>;

export const codeTaskWorkflowSchema = z.object({
  goal: z.string().min(3).max(4_000),
  cwd: workspacePathSchema.default("."),
  files: z.array(workspacePathSchema).max(30).default([]),
  patch: z.string().min(1).max(2_000_000).optional(),
  testCommand: z.enum(["test", "build", "typecheck", "lint", "smoke"]).optional(),
  requireApproval: z.coerce.boolean().default(false),
  maxRetries: z.coerce.number().int().min(0).max(3).default(1)
});
export type CodeTaskWorkflowInput = z.infer<typeof codeTaskWorkflowSchema>;

export const localSkillManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(120),
  version: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  inputSchema: z.record(z.unknown()).default({}),
  requestedTools: z.array(z.string().min(1).max(180)).max(20).default([]),
  outputArtifact: z.string().min(1).max(120).optional()
});
export type LocalSkillManifest = z.infer<typeof localSkillManifestSchema>;

export const importLocalSkillSchema = z.object({ sourcePath: z.string().min(1).max(4_000) });
export type ImportLocalSkillInput = z.infer<typeof importLocalSkillSchema>;

export const importRepositorySkillSchema = z.object({
  repositoryUrl: z.string().url().max(2_000),
  ref: z.string().trim().min(1).max(160).default("main"),
  skillPath: z.string().trim().max(1_000).default("")
});
export type ImportRepositorySkillInput = z.infer<typeof importRepositorySkillSchema>;

export const localSkillRecordSchema = localSkillManifestSchema.extend({
  status: z.enum(["active", "disabled"]),
  sourcePath: z.string(),
  contentHash: z.string(),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
  validation: z.object({ fileCount: z.number().int().nonnegative(), totalBytes: z.number().int().nonnegative(), validatedAt: z.string() }).optional(),
  installedAt: z.string(),
  enabledAt: z.string().optional()
});
export type LocalSkillRecord = z.infer<typeof localSkillRecordSchema>;

export const agentShellStatusSchema = z.object({
  mode: z.literal("local_personal_agent"),
  piRuntime: providerStatusSchema.extend({
    provider: z.string().optional(),
    sdkLoaded: z.boolean().optional(),
    selectedModelAvailable: z.boolean().optional(),
    availableModelCount: z.number().optional()
  }),
  runtimeAdapters: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      default: z.boolean()
    })
  ).default([]),
  safetyModel: z.object({
    defaultToolPolicy: z.enum(["read_only", "trusted_local"]),
    disabledToolClasses: z.array(z.string()).default([]),
    highRiskActions: z.array(z.string()).default([])
  }),
  extensions: z.array(extensionManifestSchema).default([])
});
export type AgentShellStatus = z.infer<typeof agentShellStatusSchema>;

export const createAgentMessageSchema = z.object({
  content: z.string().min(1),
  sessionId: z.string().optional(),
  extensionIds: z.array(z.string()).default([])
});
export type CreateAgentMessageInput = z.infer<typeof createAgentMessageSchema>;

export const agentArtifactSchema = z.object({
  kind: z.string(),
  payload: z.unknown().optional()
}).passthrough();
export type AgentArtifact = z.infer<typeof agentArtifactSchema>;

export const agentMessageResponseSchema = z.object({
  sessionId: z.string(),
  runId: z.string().optional(),
  role: z.literal("assistant"),
  content: z.string(),
  provider: z.string(),
  model: z.string().optional(),
  degradedReason: z.string().optional(),
  memoryContext: z.array(memorySearchResultSchema).default([]),
  activeTools: z.array(z.string()).default([]),
  toolCalls: z.array(z.record(z.unknown())).default([]),
  artifacts: z.array(agentArtifactSchema).default([])
});
export type AgentMessageResponse = z.infer<typeof agentMessageResponseSchema>;

export const agentRunContextManifestSchema = z.object({
  messageChars: z.number().int().nonnegative(),
  conversationMessageCount: z.number().int().nonnegative(),
  conversationChars: z.number().int().nonnegative(),
  memoryCount: z.number().int().nonnegative(),
  memoryIds: z.array(z.string()).default([]),
  extensionCount: z.number().int().nonnegative(),
  capabilityCount: z.number().int().nonnegative(),
  visibleExtensionIds: z.array(z.string()).default([]),
  activeSkillIds: z.array(z.string()).default([])
});
export type AgentRunContextManifest = z.infer<typeof agentRunContextManifestSchema>;

export const agentRunEventSchema = z.object({
  id: z.string(),
  kind: z.enum(["run_started", "context_compiled", "tool_requested", "tool_completed", "runtime_completed", "run_completed", "run_failed"]),
  timestamp: z.string(),
  data: z.record(z.unknown()).default({})
});
export type AgentRunEvent = z.infer<typeof agentRunEventSchema>;

export type AgentRunStatus = "running" | "completed" | "degraded" | "failed";

export const agentRunSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  runtimeId: z.string(),
  status: z.enum(["running", "completed", "degraded", "failed"]),
  context: agentRunContextManifestSchema,
  provider: z.string().optional(),
  model: z.string().optional(),
  degradedReason: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  updatedAt: z.string(),
  events: z.array(agentRunEventSchema).default([])
});
export type AgentRun = z.infer<typeof agentRunSchema>;
