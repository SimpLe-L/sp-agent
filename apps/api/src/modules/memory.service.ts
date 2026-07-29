import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ConsolidateMemoryInput,
  CreateMemoryCandidateInput,
  ExtractMemoryFromSessionInput,
  MemoryAuditEvent,
  MemoryEntry,
  MemorySearchResult,
  MergeMemoryInput,
  PromoteMemoryInput,
  SearchMemoryInput,
  SummarizeMemorySessionInput,
  UpdateMemoryInput
} from "@sp-agent/shared";
import { ChatService } from "./chat.service.js";
import { LocalJsonStore } from "./local-json-store.service.js";
import { MemoryIntelligenceService } from "./memory-intelligence.service.js";
import { MemoryVectorService, type MemoryVectorHit } from "./memory-vector.service.js";

type MemoryFile = {
  memories: MemoryEntry[];
  auditEvents: MemoryAuditEvent[];
};

type ScoredMemory = MemorySearchResult;

const VECTOR_MATCH_THRESHOLD = 0.65;

@Injectable()
export class MemoryService {
  constructor(
    @Inject(LocalJsonStore) private readonly store: LocalJsonStore,
    @Inject(ChatService) private readonly chatService: ChatService,
    @Inject(MemoryIntelligenceService) private readonly intelligenceService: MemoryIntelligenceService,
    @Inject(MemoryVectorService) private readonly vectorService: MemoryVectorService
  ) {}

  async list() {
    return (await this.readFile()).memories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async audit(memoryId?: string) {
    const events = (await this.readFile()).auditEvents;
    return (memoryId ? events.filter((event) => event.memoryId === memoryId) : events).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createCandidate(input: CreateMemoryCandidateInput) {
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id: `mem_${crypto.randomUUID()}`,
      kind: input.kind,
      scope: input.scope,
      sessionId: input.sessionId,
      content: input.content.trim(),
      source: input.source,
      provenance: input.provenance,
      confidence: input.confidence,
      sensitivity: input.sensitivity,
      tags: input.tags,
      status: "candidate",
      supersedes: [],
      conflictsWith: [],
      occurredAt: input.occurredAt,
      createdAt: now,
      updatedAt: now
    };
    const file = await this.readFile();
    const conflicts = detectConflicts(entry, file.memories);
    if (conflicts.length > 0) {
      entry.conflictsWith = conflicts.map((conflict) => conflict.id);
      entry.conflictGroupId = `mem_conflict_${crypto.randomUUID()}`;
      entry.conflictReason = "Potential duplicate or source-conflicting memory candidate.";
    }
    file.memories.push(entry);
    file.auditEvents.push(makeAuditEvent(entry.id, "candidate_created", "Created as a memory write candidate."));
    if (conflicts.length > 0) {
      file.auditEvents.push(makeAuditEvent(entry.id, "conflict_detected", entry.conflictReason, entry.conflictsWith));
    }
    await this.writeFile(file);
    await this.vectorService.upsert(entry);
    return {
      accepted: true,
      memoryId: entry.id,
      memory: entry,
      conflicts
    };
  }

  async extractFromSession(input: ExtractMemoryFromSessionInput) {
    const session = await this.chatService.getSession(input.sessionId);
    if (!session) throw new NotFoundException(`Chat session ${input.sessionId} not found`);
    const messages = (session.messages ?? [])
      .filter((message) => message.role === "user" || (input.includeAssistant && message.role === "assistant"))
      .filter((message) => message.content.trim().length >= 8);
    const extracted = await this.intelligenceService.extractCandidates(messages, input.maxCandidates);
    const created = [];
    for (const candidate of extracted.value) {
      created.push(await this.createCandidate(candidate));
    }
    return {
      sessionId: input.sessionId,
      accepted: created.length,
      memories: created.map((item) => item.memory),
      provider: extracted.provider,
      degradedReason: extracted.degradedReason
    };
  }

  async summarizeSession(input: SummarizeMemorySessionInput) {
    const session = await this.chatService.getSession(input.sessionId);
    if (!session) throw new NotFoundException(`Chat session ${input.sessionId} not found`);
    const messages = (session.messages ?? []).slice(-input.maxMessages);
    if (messages.length === 0) {
      return {
        sessionId: input.sessionId,
        accepted: false,
        degradedReason: "Chat session has no messages to summarize."
      };
    }
    const summary = await this.intelligenceService.summarizeSession(input.sessionId, messages);
    const created = await this.createCandidate(summary.value);
    return {
      sessionId: input.sessionId,
      accepted: true,
      memoryId: created.memoryId,
      memory: created.memory,
      provider: summary.provider,
      degradedReason: summary.degradedReason
    };
  }

  async consolidate(input: ConsolidateMemoryInput) {
    const file = await this.readFile();
    const memories = file.memories
      .filter((entry) => input.statuses.includes(entry.status as "candidate" | "active"))
      .filter((entry) => input.includeSensitive || entry.sensitivity !== "sensitive");
    const suggestions = this.intelligenceService.suggestConsolidations(memories, input.maxSuggestions);
    return {
      provider: suggestions.provider,
      suggestions: suggestions.value,
      degradedReason: suggestions.degradedReason
    };
  }

  async promote(id: string, input: PromoteMemoryInput) {
    const file = await this.readFile();
    const entry = findMemory(file, id);
    const now = new Date().toISOString();
    entry.status = "active";
    entry.updatedAt = now;
    entry.promotedAt = now;
    file.auditEvents.push(makeAuditEvent(entry.id, "promoted", input.reason));
    await this.writeFile(file);
    await this.vectorService.upsert(entry);
    return { memory: entry, auditEvents: file.auditEvents.filter((event) => event.memoryId === entry.id) };
  }

  async update(id: string, input: UpdateMemoryInput) {
    const file = await this.readFile();
    const entry = findMemory(file, id);
    if (input.content !== undefined) entry.content = input.content.trim();
    if (input.kind !== undefined) entry.kind = input.kind;
    if (input.confidence !== undefined) entry.confidence = input.confidence;
    if (input.sensitivity !== undefined) entry.sensitivity = input.sensitivity;
    if (input.tags !== undefined) entry.tags = input.tags;
    if (input.provenance !== undefined) entry.provenance = { ...entry.provenance, ...input.provenance };
    if (input.occurredAt !== undefined) entry.occurredAt = input.occurredAt;
    entry.updatedAt = new Date().toISOString();
    file.auditEvents.push(makeAuditEvent(entry.id, "updated", "Updated memory fields."));
    await this.writeFile(file);
    await this.vectorService.upsert(entry);
    return { memory: entry, auditEvents: file.auditEvents.filter((event) => event.memoryId === entry.id) };
  }

  async merge(input: MergeMemoryInput) {
    const file = await this.readFile();
    const sourceMemories = input.sourceIds.map((id) => findMemory(file, id));
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id: `mem_${crypto.randomUUID()}`,
      kind: input.kind,
      scope: sourceMemories.find((memory) => memory.scope === "session")?.scope ?? "global",
      sessionId: sourceMemories.find((memory) => memory.sessionId)?.sessionId,
      content: input.content.trim(),
      source: { type: "system", label: "memory merge" },
      provenance: { reason: input.reason, mergedFrom: input.sourceIds },
      confidence: input.confidence,
      sensitivity: input.sensitivity,
      tags: input.tags,
      status: "active",
      supersedes: input.sourceIds,
      conflictsWith: [],
      occurredAt: input.occurredAt ?? latestOccurredAt(sourceMemories),
      createdAt: now,
      updatedAt: now,
      promotedAt: now
    };
    for (const source of sourceMemories) {
      source.status = "tombstoned";
      source.updatedAt = now;
      source.tombstonedAt = now;
    }
    file.memories.push(entry);
    file.auditEvents.push(makeAuditEvent(entry.id, "merged", input.reason, input.sourceIds));
    if (sourceMemories.some((memory) => (memory.conflictsWith ?? []).length > 0 || memory.conflictGroupId)) {
      file.auditEvents.push(makeAuditEvent(entry.id, "conflict_resolved", "Merged memory resolves source conflict set.", input.sourceIds));
    }
    for (const sourceId of input.sourceIds) {
      file.auditEvents.push(makeAuditEvent(sourceId, "forgotten", `Superseded by merged memory ${entry.id}.`, [entry.id]));
    }
    await this.writeFile(file);
    await Promise.all([this.vectorService.upsert(entry), ...input.sourceIds.map((sourceId) => this.vectorService.remove(sourceId))]);
    return { memory: entry, mergedFrom: input.sourceIds, auditEvents: file.auditEvents.filter((event) => event.memoryId === entry.id) };
  }

  async search(input: SearchMemoryInput) {
    const terms = tokenize(input.query);
    const relativeWindow = resolveRelativeTimeWindow(input.query);
    const fromMs = parseOptionalTime(input.from) ?? relativeWindow?.fromMs;
    const toMs = parseOptionalTime(input.to) ?? relativeWindow?.toMs;
    const statuses = input.statuses ?? ["candidate", "active"];
    const strategy = resolveSearchStrategy(input, relativeWindow !== undefined);
    const vectorHits = await this.vectorHits(input, strategy, fromMs, toMs);
    const file = await this.readFile();
    await this.store.syncMemoryFts(file.memories);
    const ftsHits = new Set(await this.store.searchMemoryFts(input.query, Math.max(input.limit * 6, 50)));
    const candidates = file.memories
      .filter((entry) => statuses.includes(entry.status))
      .filter((entry) => input.includeSensitive || entry.sensitivity !== "sensitive")
      .filter((entry) => !input.scope || entry.scope === input.scope)
      .filter((entry) => !input.sessionId || entry.scope === "global" || entry.sessionId === input.sessionId);
    const memories = rankByStrategy(candidates, input, terms, strategy, fromMs, toMs, vectorHits, ftsHits).slice(0, input.limit);
    return { memories };
  }

  private async vectorHits(input: SearchMemoryInput, strategy: ReturnType<typeof resolveSearchStrategy>, fromMs: number | undefined, toMs: number | undefined) {
    if (!this.vectorService.isEnabled()) return new Map<string, MemoryVectorHit>();
    const kinds = strategy === "core_semantic"
      ? ["core", "project", "procedural"] as const
      : strategy === "journal_temporal"
        ? ["journal", "summary"] as const
        : undefined;
    const hits = await this.vectorService.search({
      ...input,
      kinds: kinds ? [...kinds] : undefined,
      fromMs: strategy === "journal_temporal" ? fromMs : undefined,
      toMs: strategy === "journal_temporal" ? toMs : undefined,
      limit: Math.max(input.limit * 4, 20)
    });
    return new Map(hits.map((hit) => [hit.id, hit]));
  }

  async retrieveForAgent(input: Pick<SearchMemoryInput, "query" | "sessionId"> & { limit?: number }) {
    const result = await this.search({
      query: input.query,
      sessionId: input.sessionId,
      strategy: "hybrid",
      statuses: ["active"],
      includeSensitive: false,
      limit: input.limit ?? 5
    });
    return {
      memories: result.memories.filter((memory) => memory.score >= 3 || memory.rankingSignals.includes("exact_phrase"))
    };
  }

  async tombstone(id: string) {
    const file = await this.readFile();
    const entry = file.memories.find((memory) => memory.id === id);
    if (!entry) throw new NotFoundException(`Memory ${id} not found`);
    const now = new Date().toISOString();
    entry.status = "tombstoned";
    entry.updatedAt = now;
    entry.tombstonedAt = now;
    file.auditEvents.push(makeAuditEvent(entry.id, "forgotten", "Tombstoned by forget request."));
    await this.writeFile(file);
    await this.vectorService.remove(entry.id);
    return { memory: entry, auditEvents: file.auditEvents.filter((event) => event.memoryId === entry.id) };
  }

  private async readFile(): Promise<MemoryFile> {
    const file = await this.store.read<MemoryFile>("memory.json", { memories: [], auditEvents: [] });
    return { memories: (file.memories ?? []).map(normalizeMemoryEntry), auditEvents: file.auditEvents ?? [] };
  }

  private async writeFile(file: MemoryFile) {
    await this.store.write("memory.json", file);
    await this.store.syncMemoryFts(file.memories);
  }
}

function normalizeMemoryEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    kind: entry.kind ?? "core",
    sensitivity: entry.sensitivity ?? "normal",
    supersedes: entry.supersedes ?? [],
    conflictsWith: entry.conflictsWith ?? []
  };
}

function findMemory(file: MemoryFile, id: string) {
  const entry = file.memories.find((memory) => memory.id === id);
  if (!entry) throw new NotFoundException(`Memory ${id} not found`);
  return entry;
}

function makeAuditEvent(memoryId: string, action: MemoryAuditEvent["action"], reason?: string, sourceMemoryIds: string[] = []): MemoryAuditEvent {
  return {
    id: `mem_audit_${crypto.randomUUID()}`,
    memoryId,
    action,
    reason,
    sourceMemoryIds,
    createdAt: new Date().toISOString()
  };
}

function resolveSearchStrategy(input: SearchMemoryInput, hasRelativeTimeWindow = false) {
  if (input.strategy !== "auto") return input.strategy;
  if (input.kind === "journal" || input.from || input.to || hasRelativeTimeWindow) return "journal_temporal";
  if (input.kind === "core") return "core_semantic";
  return "hybrid";
}

function rankByStrategy(
  entries: MemoryEntry[],
  input: SearchMemoryInput,
  terms: string[],
  strategy: "core_semantic" | "journal_temporal" | "hybrid",
  fromMs: number | undefined,
  toMs: number | undefined,
  vectorHits: Map<string, MemoryVectorHit>,
  ftsHits: Set<string>
) {
  if (strategy === "core_semantic") {
    return rankEntries(
      entries.filter((entry) => matchesKind(entry, input.kind, ["core", "project", "procedural"])),
      terms,
      input.query,
      false,
      vectorHits,
      "core_semantic",
      ftsHits
    );
  }

  if (strategy === "journal_temporal") {
    return rankEntries(
      entries
        .filter((entry) => matchesKind(entry, input.kind, ["journal", "summary"]))
        .filter((entry) => isInsideTimeRange(entry, fromMs, toMs)),
      terms,
      input.query,
      true,
      vectorHits,
      "journal_temporal",
      ftsHits
    );
  }

  const core = rankEntries(
    entries.filter((entry) => matchesKind(entry, input.kind, ["core", "project", "procedural"])),
    terms,
    input.query,
    false,
    vectorHits,
    "hybrid",
    ftsHits
  );
  const journal = rankEntries(
    entries.filter((entry) => matchesKind(entry, input.kind, ["journal", "summary"])),
    terms,
    input.query,
    false,
    vectorHits,
    "hybrid",
    ftsHits
  );
  return mergeRankedByQuota(core, journal, input.limit);
}

function rankEntries(
  entries: MemoryEntry[],
  terms: string[],
  query: string,
  temporalSearch: boolean,
  vectorHits: Map<string, MemoryVectorHit>,
  strategy: "core_semantic" | "journal_temporal" | "hybrid",
  ftsHits: Set<string>
) {
  return entries
    .map((entry) => scoreMemory(entry, terms, query, temporalSearch, vectorHits.get(entry.id), strategy, ftsHits.has(entry.id)))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt));
}

function matchesKind(entry: MemoryEntry, requestedKind: MemoryEntry["kind"] | undefined, allowedKinds: MemoryEntry["kind"][]) {
  if (requestedKind) return entry.kind === requestedKind;
  return allowedKinds.includes(entry.kind);
}

function mergeRankedByQuota(core: ScoredMemory[], journal: ScoredMemory[], limit: number) {
  const result: ScoredMemory[] = [];
  const seen = new Set<string>();
  const coreQuota = Math.min(core.length, Math.max(1, Math.ceil(limit * 0.6)));
  const journalQuota = Math.min(journal.length, Math.max(1, limit - coreQuota));
  pushRanked(result, seen, core.slice(0, coreQuota));
  pushRanked(result, seen, journal.slice(0, journalQuota));
  pushRanked(result, seen, [...core.slice(coreQuota), ...journal.slice(journalQuota)].sort((a, b) => b.score - a.score));
  return result.slice(0, limit);
}

function pushRanked(target: ScoredMemory[], seen: Set<string>, items: ScoredMemory[]) {
  for (const item of items) {
    if (seen.has(item.entry.id)) continue;
    seen.add(item.entry.id);
    target.push(item);
  }
}

function scoreMemory(
  entry: MemoryEntry,
  terms: string[],
  query: string,
  temporalSearch = false,
  vectorHit: MemoryVectorHit | undefined,
  strategy: "core_semantic" | "journal_temporal" | "hybrid",
  ftsHit: boolean
): ScoredMemory {
  const haystack = `${entry.content} ${entry.tags.join(" ")} ${entry.source.label ?? ""}`.toLowerCase();
  const content = entry.content.toLowerCase();
  const tags = entry.tags.map((tag) => tag.toLowerCase());
  const sourceLabel = entry.source.label?.toLowerCase() ?? "";
  const normalizedQuery = query.toLowerCase().trim();
  const matchedTerms = terms.filter((term) => haystack.includes(term));
  const strongVectorHit = vectorHit && (vectorHit.score >= VECTOR_MATCH_THRESHOLD || matchedTerms.length > 0 || temporalSearch) ? vectorHit : undefined;
  if (matchedTerms.length === 0 && !temporalSearch && !strongVectorHit) {
    return hydrateSearchResult(entry, 0, [], [], terms, strategy, vectorHit, temporalSearch);
  }

  const rankingSignals: string[] = [];
  let score = temporalSearch ? 1.5 : 0;

  if (temporalSearch) rankingSignals.push("temporal_window");

  if (strongVectorHit) {
    score += strongVectorHit.score * 6;
    rankingSignals.push("vector_match");
  }

  if (ftsHit) {
    score += 4;
    rankingSignals.push("sqlite_fts");
  }

  if (normalizedQuery && content.includes(normalizedQuery)) {
    score += 8;
    rankingSignals.push("exact_phrase");
  }

  for (const term of matchedTerms) {
    const contentHits = countOccurrences(content, term);
    const tagHits = tags.filter((tag) => tag.includes(term)).length;
    const sourceHits = sourceLabel.includes(term) ? 1 : 0;
    if (contentHits > 0) {
      score += Math.min(contentHits, 6) * 2;
      rankingSignals.push("content_match");
    }
    if (tagHits > 0) {
      score += tagHits * 3;
      rankingSignals.push("tag_match");
    }
    if (sourceHits > 0) {
      score += sourceHits;
      rankingSignals.push("source_match");
    }
  }

  if (entry.status === "active") {
    score += 3;
    rankingSignals.push("accepted_fact");
  } else if (entry.status === "candidate") {
    score += 0.5;
    rankingSignals.push("candidate");
  }

  if (entry.kind === "core") {
    score += 1.5;
    rankingSignals.push("core_semantic");
  } else if (entry.kind === "journal") {
    score += temporalSearch ? 2 : 0.5;
    rankingSignals.push(temporalSearch ? "journal_temporal" : "journal_memory");
  } else if (entry.kind === "summary") {
    score += 1;
    rankingSignals.push("summary_memory");
  }

  score += entry.confidence * 2;
  const ageMs = Date.now() - Date.parse(entry.updatedAt);
  if (Number.isFinite(ageMs) && ageMs >= 0) {
    score += Math.max(0, 1 - ageMs / (1000 * 60 * 60 * 24 * 30));
    rankingSignals.push("recency");
  }

  return hydrateSearchResult(
    entry,
    Number(score.toFixed(4)),
    Array.from(new Set(matchedTerms)),
    Array.from(new Set(rankingSignals)),
    terms,
    strategy,
    strongVectorHit,
    temporalSearch
  );
}

function hydrateSearchResult(
  entry: MemoryEntry,
  score: number,
  matchedTerms: string[],
  rankingSignals: string[],
  queryTerms: string[],
  strategy: "core_semantic" | "journal_temporal" | "hybrid",
  vectorHit: MemoryVectorHit | undefined,
  temporalSearch: boolean
): ScoredMemory {
  const sourceSnippet = buildSourceSnippet(entry.content, matchedTerms.length > 0 ? matchedTerms : queryTerms);
  return {
    entry,
    score,
    matchedTerms,
    rankingSignals,
    sourceSnippet,
    citation: buildMemoryCitation(entry, sourceSnippet),
    debug: {
      strategy,
      score,
      matchedTermCount: matchedTerms.length,
      rankingSignals,
      vectorScore: vectorHit?.score,
      temporalWindow: temporalSearch || undefined
    }
  };
}

function buildMemoryCitation(entry: MemoryEntry, snippet: string) {
  return {
    memoryId: entry.id,
    sourceType: entry.source.type,
    sourceId: entry.source.id,
    sourceLabel: entry.source.label,
    sessionId: entry.sessionId ?? stringFromRecord(entry.provenance, "sessionId"),
    messageId: stringFromRecord(entry.provenance, "messageId"),
    occurredAt: entry.occurredAt,
    createdAt: entry.createdAt,
    snippet
  };
}

function buildSourceSnippet(content: string, terms: string[]) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) return normalized;
  const lower = normalized.toLowerCase();
  const firstHit = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)
    .at(0);
  const center = firstHit ?? 0;
  const start = Math.max(0, center - 70);
  const end = Math.min(normalized.length, start + 180);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function parseOptionalTime(value: string | undefined) {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function memoryTimeMs(entry: MemoryEntry) {
  const value = entry.occurredAt ?? entry.createdAt;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function isInsideTimeRange(entry: MemoryEntry, fromMs: number | undefined, toMs: number | undefined) {
  if (fromMs === undefined && toMs === undefined) return true;
  const ms = memoryTimeMs(entry);
  if (ms === undefined) return false;
  if (fromMs !== undefined && ms < fromMs) return false;
  if (toMs !== undefined && ms > toMs) return false;
  return true;
}

function latestOccurredAt(memories: MemoryEntry[]) {
  return memories
    .map((memory) => memory.occurredAt ?? memory.createdAt)
    .filter(Boolean)
    .sort()
    .at(-1);
}

function tokenize(value: string) {
  const terms = value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/u)
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => !MEMORY_STOP_WORDS.has(term));
  const expanded = new Set<string>();
  for (const term of terms.length > 0 ? terms : [value.toLowerCase()]) {
    expanded.add(term);
    if (/[\u4e00-\u9fa5]/u.test(term)) {
      for (let index = 0; index < term.length - 1; index += 1) {
        expanded.add(term.slice(index, index + 2));
      }
    }
  }
  return Array.from(expanded);
}

const MEMORY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "does", "for", "from", "how", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "what", "when", "where", "which", "who", "with"
]);

function detectConflicts(candidate: MemoryEntry, memories: MemoryEntry[]) {
  const candidateTerms = new Set(tokenize(candidate.content));
  return memories
    .filter((entry) => entry.status !== "tombstoned")
    .filter((entry) => entry.id !== candidate.id)
    .filter((entry) => entry.scope === "global" || candidate.scope === "global" || entry.sessionId === candidate.sessionId)
    .filter((entry) => {
      const contentSimilarity = jaccard(candidateTerms, new Set(tokenize(entry.content)));
      const tagOverlap = candidate.tags.some((tag) => entry.tags.includes(tag));
      const sourceConflict = candidate.source.type !== entry.source.type || (candidate.source.id && entry.source.id && candidate.source.id !== entry.source.id);
      return contentSimilarity >= 0.45 || (tagOverlap && contentSimilarity >= 0.25) || (sourceConflict && contentSimilarity >= 0.3);
    })
    .map((entry) => ({
      id: entry.id,
      status: entry.status,
      content: entry.content,
      source: entry.source,
      confidence: entry.confidence,
      tags: entry.tags
    }));
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (left.size === 0 && right.size === 0) return 0;
  const intersection = [...left].filter((term) => right.has(term)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
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

function resolveRelativeTimeWindow(query: string) {
  const normalized = query.toLowerCase();
  const now = new Date();
  if (/昨天|yesterday/.test(normalized)) return dayWindow(addDays(startOfLocalDay(now), -1));
  if (/今天|today/.test(normalized)) return dayWindow(startOfLocalDay(now));
  if (/前天|day before yesterday/.test(normalized)) return dayWindow(addDays(startOfLocalDay(now), -2));
  if (/上周|last week/.test(normalized)) {
    const startThisWeek = startOfLocalWeek(now);
    return { fromMs: addDays(startThisWeek, -7).getTime(), toMs: startThisWeek.getTime() - 1 };
  }
  if (/本周|this week/.test(normalized)) {
    const startThisWeek = startOfLocalWeek(now);
    return { fromMs: startThisWeek.getTime(), toMs: addDays(startThisWeek, 7).getTime() - 1 };
  }
  return undefined;
}

function dayWindow(dayStart: Date) {
  return {
    fromMs: dayStart.getTime(),
    toMs: addDays(dayStart, 1).getTime() - 1
  };
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function startOfLocalWeek(value: Date) {
  const day = startOfLocalDay(value);
  const mondayOffset = (day.getDay() + 6) % 7;
  return addDays(day, -mondayOffset);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}
