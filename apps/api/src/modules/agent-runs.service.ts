import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AgentRun, AgentRunContextManifest, AgentRunEvent, AgentRunStatus } from "@sp-agent/shared";
import { LocalJsonStore } from "./local-json-store.service.js";

type AgentRunsFile = { runs: AgentRun[] };

@Injectable()
export class AgentRunsService {
  constructor(@Inject(LocalJsonStore) private readonly store: LocalJsonStore) {}

  async list(limit = 30) {
    const runs = (await this.store.read<AgentRunsFile>("agent-runs.json", { runs: [] })).runs ?? [];
    return [...runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, limit);
  }

  async get(id: string) {
    const run = (await this.store.read<AgentRunsFile>("agent-runs.json", { runs: [] })).runs.find((item) => item.id === id);
    if (!run) throw new NotFoundException(`Agent run ${id} was not found.`);
    return run;
  }

  async start(input: { sessionId: string; runtimeId: string; context: AgentRunContextManifest }) {
    const now = new Date().toISOString();
    const run: AgentRun = {
      id: `run_${crypto.randomUUID()}`,
      sessionId: input.sessionId,
      runtimeId: input.runtimeId,
      status: "running",
      context: input.context,
      startedAt: now,
      updatedAt: now,
      events: [
        event("run_started", { sessionId: input.sessionId, runtimeId: input.runtimeId }, now),
        event("context_compiled", input.context, now)
      ]
    };
    await this.store.mutate<AgentRunsFile, void>("agent-runs.json", { runs: [] }, (file) => {
      file.runs.push(run);
      if (file.runs.length > 200) file.runs.splice(0, file.runs.length - 200);
    });
    return run;
  }

  async record(id: string, kind: AgentRunEvent["kind"], data: Record<string, unknown>) {
    return this.mutate(id, (run) => {
      run.events.push(event(kind, data));
      if (run.events.length > 200) run.events.splice(0, run.events.length - 200);
    });
  }

  async finish(id: string, input: { status: Exclude<AgentRunStatus, "running">; provider: string; model?: string; degradedReason?: string; toolCallCount: number; artifactCount: number }) {
    return this.mutate(id, (run) => {
      const now = new Date().toISOString();
      run.status = input.status;
      run.provider = input.provider;
      run.model = input.model;
      run.degradedReason = input.degradedReason;
      run.completedAt = now;
      run.events.push(event("runtime_completed", { provider: input.provider, model: input.model, toolCallCount: input.toolCallCount, artifactCount: input.artifactCount, degradedReason: input.degradedReason }, now));
      run.events.push(event(input.status === "failed" ? "run_failed" : "run_completed", { status: input.status }, now));
    });
  }

  private async mutate(id: string, mutation: (run: AgentRun) => void) {
    return this.store.mutate<AgentRunsFile, AgentRun>("agent-runs.json", { runs: [] }, (file) => {
      const run = file.runs.find((item) => item.id === id);
      if (!run) throw new NotFoundException(`Agent run ${id} was not found.`);
      mutation(run);
      run.updatedAt = new Date().toISOString();
      return run;
    });
  }
}

function event(kind: AgentRunEvent["kind"], data: Record<string, unknown>, timestamp = new Date().toISOString()): AgentRunEvent {
  return { id: `run_event_${crypto.randomUUID()}`, kind, data, timestamp };
}
