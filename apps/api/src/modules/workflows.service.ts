import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  codeTaskWorkflowSchema,
  projectDocSearchSchema,
  type CodeTaskWorkflowInput,
  type ProjectDocSearchInput,
  type WorkflowNodeEvent,
  type WorkflowRun
} from "@sp-agent/shared";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { LocalJsonStore } from "./local-json-store.service.js";
import { WorkspaceService } from "./workspace.service.js";
import { LangGraphWorkflowEngine } from "./langgraph-workflow-engine.service.js";

type WorkflowsFile = {
  workflows: WorkflowRun[];
};

type ProjectDocHit = {
  file: string;
  score: number;
  preview: string;
};

const PROJECT_DOC_ALLOWLIST = ["AGENTS.md", "ARCHITECTURE.md", "PROCESS.md", "package.json"];
const STALE_WORKFLOW_MS = positiveNumber(process.env.SP_AGENT_WORKFLOW_STALE_MS, 5 * 60 * 1000);
const MAX_INSPECTION_BYTES = 1_000_000;

@Injectable()
export class WorkflowsService {
  constructor(
    @Inject(LocalJsonStore) private readonly store: LocalJsonStore,
    @Inject(WorkspaceService) private readonly workspace: WorkspaceService,
    @Inject(LangGraphWorkflowEngine) private readonly workflowEngine: LangGraphWorkflowEngine
  ) {}

  async list() {
    await this.recoverStaleWorkflows();
    return (await this.readFile()).workflows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string) {
    await this.recoverStaleWorkflows();
    return findWorkflow(await this.readFile(), id);
  }

  async cancel(id: string) {
    const file = await this.readFile();
    const workflow = findWorkflow(file, id);
    if (workflow.status === "completed" || workflow.status === "failed" || workflow.status === "cancelled") {
      workflow.degradedReason = `Workflow is already ${workflow.status}; cancellation was recorded as a no-op.`;
    } else {
      const now = new Date().toISOString();
      workflow.status = "cancelled";
      workflow.updatedAt = now;
      workflow.completedAt = now;
      workflow.nodeEvents.push(makeNodeEvent("cancel", "Cancellation request", "cancelled", { requestedAt: now }));
    }
    await this.writeFile(file);
    return { workflow };
  }

  async retry(id: string) {
    const workflow = await this.get(id);
    if (workflow.kind === "local.project.search_docs") {
      return this.runProjectDocSearch(projectDocSearchSchema.parse(workflow.input), { retriedFrom: id });
    }
    if (workflow.kind === "local.workspace.code_change") {
      const input = codeTaskWorkflowSchema.parse(workflow.input);
      return this.startCodeTask({ ...input, requireApproval: false }, { retriedFrom: id, attempt: (workflow.attempt ?? 0) + 1 });
    }
    throw new BadRequestException(`Workflow ${workflow.kind} is not retryable by this runner`);
  }

  async startProjectDocSearch(input: ProjectDocSearchInput) {
    const workflow = await this.createWorkflow(input, "pending");
    setImmediate(() => {
      this.executeProjectDocSearch(workflow.id).catch((error) => {
        console.error(`Project doc workflow ${workflow.id} failed`, error);
      });
    });
    return { workflow };
  }

  async runProjectDocSearch(input: ProjectDocSearchInput, metadata: Record<string, unknown> = {}) {
    const workflow = await this.createWorkflow(input, "running", metadata);
    await this.executeProjectDocSearch(workflow.id);
    return { workflow: await this.get(workflow.id) };
  }

  async startCodeTask(input: CodeTaskWorkflowInput, metadata: Record<string, unknown> = {}) {
    const workflow = await this.createWorkflow(input, "pending", metadata, "local.workspace.code_change");
    workflow.maxRetries = input.maxRetries;
    workflow.attempt = typeof metadata.attempt === "number" ? metadata.attempt : 0;
    workflow.correlationId = typeof metadata.correlationId === "string" ? metadata.correlationId : `corr_${crypto.randomUUID()}`;
    await this.replaceWorkflow(workflow);
    setImmediate(() => {
      this.executeCodeTask(workflow.id).catch((error) => console.error(`Code task workflow ${workflow.id} failed`, error));
    });
    return { workflow };
  }

  async resume(id: string) {
    const workflow = await this.get(id);
    if (workflow.kind !== "local.workspace.code_change") throw new BadRequestException(`Workflow ${workflow.kind} cannot be resumed`);
    if (workflow.status !== "paused") throw new BadRequestException(`Workflow ${id} is ${workflow.status}, not paused`);
    workflow.status = "pending";
    workflow.updatedAt = new Date().toISOString();
    workflow.checkpoint = { nodeId: "executor", data: { ...(workflow.checkpoint?.data ?? {}), approvedAt: workflow.updatedAt }, updatedAt: workflow.updatedAt };
    workflow.nodeEvents.push(makeNodeEvent("approval", "Resume after human approval", "completed", { resumedAt: workflow.updatedAt }));
    await this.replaceWorkflow(workflow);
    setImmediate(() => { this.executeCodeTask(id).catch((error) => console.error(`Code task workflow ${id} resume failed`, error)); });
    return { workflow };
  }


  private async createWorkflow(
    input: Record<string, unknown>,
    status: WorkflowRun["status"],
    metadata: Record<string, unknown> = {},
    kind = "local.project.search_docs"
  ) {
    const now = new Date().toISOString();
    const workflow: WorkflowRun = {
      id: `workflow_${crypto.randomUUID()}`,
      kind,
      status,
      input,
      createdAt: now,
      updatedAt: now,
      startedAt: status === "running" ? now : undefined,
      attempt: 0,
      maxRetries: 0,
      nodeEvents: [
        makeNodeEvent(
          "start",
          status === "pending"
            ? kind === "personal.research.run" ? "Queue research workflow" : "Queue project document search"
            : kind === "personal.research.run" ? "Start research workflow" : "Start project document search",
          status === "pending" ? "pending" : "completed",
          { input, ...metadata },
          status === "running" ? now : undefined,
          status === "running" ? now : undefined
        )
      ]
    };
    const file = await this.readFile();
    file.workflows.push(workflow);
    await this.writeFile(file);
    return workflow;
  }

  private async executeProjectDocSearch(id: string) {
    const file = await this.readFile();
    const workflow = findWorkflow(file, id);
    if (workflow.status === "cancelled") return;
    if (workflow.status === "pending") {
      const now = new Date().toISOString();
      workflow.status = "running";
      workflow.startedAt = now;
      workflow.updatedAt = now;
      workflow.nodeEvents.push(makeNodeEvent("run", "Run queued project document search", "running", {}, now));
      await this.replaceWorkflow(workflow);
    }
    try {
      const input = projectDocSearchSchema.parse(workflow.input);
      const docs = await this.readProjectDocs();
      workflow.nodeEvents.push(makeNodeEvent("read_docs", "Read allowlisted project docs", "completed", { files: docs.map((doc) => doc.file) }));
      const terms = tokenize(input.query);
      const hits = docs
        .map((doc) => ({ file: doc.file, score: scoreText(doc.content, terms), preview: makePreview(doc.content, terms) }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
        .slice(0, input.limit);
      workflow.nodeEvents.push(makeNodeEvent("rank", "Rank document matches", "completed", { hitCount: hits.length, terms }));
      workflow.result = {
        query: input.query,
        hits,
        searchedFiles: docs.map((doc) => doc.file)
      };
      if (hits.length === 0) workflow.degradedReason = "No allowlisted project documents matched the query.";
      const completedAt = new Date().toISOString();
      workflow.status = "completed";
      workflow.updatedAt = completedAt;
      workflow.completedAt = completedAt;
    } catch (error) {
      const completedAt = new Date().toISOString();
      workflow.status = "failed";
      workflow.updatedAt = completedAt;
      workflow.completedAt = completedAt;
      workflow.error = error instanceof Error ? error.message : "Project document workflow failed.";
      workflow.nodeEvents.push(makeNodeEvent("error", "Workflow failed", "failed", {}, undefined, completedAt, workflow.error));
    }

    await this.replaceWorkflow(workflow);
  }

  private async executeCodeTask(id: string) {
    const workflow = await this.get(id);
    if (workflow.status === "cancelled" || workflow.status === "completed") return;
    const input = codeTaskWorkflowSchema.parse(workflow.input);
    const checkpoint = workflow.checkpoint?.nodeId ?? "planner";
    workflow.status = "running";
    workflow.startedAt ??= new Date().toISOString();
    workflow.updatedAt = new Date().toISOString();
    await this.replaceWorkflow(workflow);
    try {
      if (checkpoint === "planner") {
        await this.completeNode(workflow, "planner", "Planner: create bounded code-change plan", { goal: input.goal, files: input.files, cwd: input.cwd });
        await this.setCheckpoint(workflow, await this.workflowEngine.next("planner", input.requireApproval), { plannedFiles: input.files });
      }
      if ((workflow.checkpoint?.nodeId ?? "") === "inspector") {
        // Independent reads are parallel, while all writes remain serial through the executor.
        const inspected = await Promise.all(input.files.map((path) => this.workspace.read(path, 200_000)));
        const inspectedBytes = inspected.reduce((total, item) => total + item.size, 0);
        if (inspectedBytes > MAX_INSPECTION_BYTES) {
          throw new Error(`Inspector budget exceeded: ${inspectedBytes} bytes exceeds ${MAX_INSPECTION_BYTES} bytes.`);
        }
        const git = await this.workspace.gitStatus(input.cwd, true, 120_000);
        await this.completeNode(workflow, "inspector", "Inspector: collect scoped source and baseline diff", { files: inspected.map((item) => ({ path: item.path, size: item.size })), inspectedBytes, maxInspectionBytes: MAX_INSPECTION_BYTES, parallel: input.files.length > 1, baselineStatus: git.status, baselineDiff: git.diff });
        await this.setCheckpoint(workflow, await this.workflowEngine.next("inspector", input.requireApproval), { inspectedFiles: inspected.map((item) => item.path) });
      }
      if ((workflow.checkpoint?.nodeId ?? "") === "approval") {
        workflow.status = "paused";
        workflow.updatedAt = new Date().toISOString();
        workflow.nodeEvents.push(makeNodeEvent("approval", "Pause for human approval", "paused", { goal: input.goal, effects: ["local_write"] }));
        await this.replaceWorkflow(workflow);
        return;
      }
      if ((workflow.checkpoint?.nodeId ?? "") === "executor") {
        const execution = input.patch ? await this.workspace.applyPatch(input.patch, input.cwd) : { cwd: input.cwd, output: "No patch was supplied; executor produced an inspectable plan only." };
        await this.completeNode(workflow, "executor", "Executor: apply scoped patch", execution);
        await this.setCheckpoint(workflow, await this.workflowEngine.next("executor", input.requireApproval), { patchApplied: Boolean(input.patch) });
      }
      if ((workflow.checkpoint?.nodeId ?? "") === "tester") {
        const test = input.testCommand ? await this.workspace.runScript(input.testCommand, input.cwd, 120_000) : { command: "none", exitCode: 0, stdout: "No test command requested.", stderr: "", timedOut: false };
        if (test.exitCode !== 0) throw new Error(`Tester failed (${test.command}): ${test.stderr || test.stdout}`);
        await this.completeNode(workflow, "tester", "Tester: run allowed project script", test);
        await this.setCheckpoint(workflow, await this.workflowEngine.next("tester", input.requireApproval), { testCommand: input.testCommand ?? "none", testExitCode: test.exitCode });
      }
      if ((workflow.checkpoint?.nodeId ?? "") === "reviewer") {
        const git = await this.workspace.gitStatus(input.cwd, true, 200_000);
        await this.completeNode(workflow, "reviewer", "Reviewer: inspect resulting Git diff and test evidence", { status: git.status, diff: git.diff, truncated: git.truncated });
        workflow.result = { goal: input.goal, status: git.status, diff: git.diff, checkpoint: workflow.checkpoint, correlationId: workflow.correlationId };
        workflow.status = "completed";
        workflow.completedAt = new Date().toISOString();
        workflow.updatedAt = workflow.completedAt;
        await this.replaceWorkflow(workflow);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Code task workflow failed.";
      const retryable = workflow.checkpoint?.nodeId === "tester" && workflow.attempt < workflow.maxRetries;
      if (retryable) {
        workflow.attempt += 1;
        workflow.status = "pending";
        workflow.error = undefined;
        workflow.updatedAt = new Date().toISOString();
        workflow.nodeEvents.push(makeNodeEvent("retry", "Retry tester from durable checkpoint", "pending", { attempt: workflow.attempt, maxRetries: workflow.maxRetries, checkpoint: workflow.checkpoint?.nodeId }, undefined, undefined, message));
        await this.replaceWorkflow(workflow);
        setImmediate(() => { this.executeCodeTask(id).catch((retryError) => console.error(`Retried code workflow ${id} failed`, retryError)); });
        return;
      }
      workflow.status = "failed";
      workflow.error = message;
      workflow.completedAt = new Date().toISOString();
      workflow.updatedAt = workflow.completedAt;
      workflow.nodeEvents.push(makeNodeEvent("error", "Code workflow failed", "failed", { checkpoint: workflow.checkpoint?.nodeId }, undefined, workflow.completedAt, message));
      await this.replaceWorkflow(workflow);
    }
  }

  private async completeNode(workflow: WorkflowRun, nodeId: string, label: string, payload: Record<string, unknown>) {
    workflow.nodeEvents.push(makeNodeEvent(nodeId, label, "completed", payload));
    workflow.updatedAt = new Date().toISOString();
    await this.replaceWorkflow(workflow);
  }

  private async setCheckpoint(workflow: WorkflowRun, nodeId: string, data: Record<string, unknown>) {
    workflow.checkpoint = { nodeId, data, updatedAt: new Date().toISOString() };
    workflow.updatedAt = workflow.checkpoint.updatedAt;
    await this.replaceWorkflow(workflow);
  }

  private async recoverStaleWorkflows() {
    const file = await this.readFile();
    const nowMs = Date.now();
    let changed = false;
    const resumable: string[] = [];
    for (const workflow of file.workflows) {
      if (workflow.status !== "pending" && workflow.status !== "running") continue;
      const reference = Date.parse(workflow.updatedAt || workflow.createdAt);
      if (!Number.isFinite(reference) || nowMs - reference < STALE_WORKFLOW_MS) continue;
      if (workflow.kind === "local.workspace.code_change" && workflow.checkpoint?.nodeId && workflow.checkpoint.nodeId !== "approval") {
        const recoveredAt = new Date().toISOString();
        workflow.status = "pending";
        workflow.updatedAt = recoveredAt;
        workflow.degradedReason = "Workflow recovered after API restart and queued from its durable checkpoint.";
        workflow.nodeEvents.push(makeNodeEvent("recover", "Resume from durable checkpoint", "pending", { checkpoint: workflow.checkpoint.nodeId, staleAfterMs: STALE_WORKFLOW_MS }, recoveredAt));
        resumable.push(workflow.id);
        changed = true;
        continue;
      }
      const completedAt = new Date().toISOString();
      workflow.status = "failed";
      workflow.updatedAt = completedAt;
      workflow.completedAt = completedAt;
      workflow.degradedReason = "Workflow was recovered after API restart or stalled execution and marked failed.";
      workflow.error = "Workflow did not complete inside the local recovery window.";
      workflow.nodeEvents.push(
        makeNodeEvent("recover_stale", "Recover stale workflow", "failed", { staleAfterMs: STALE_WORKFLOW_MS }, undefined, completedAt, workflow.error)
      );
      changed = true;
    }
    if (changed) await this.writeFile(file);
    for (const id of resumable) setImmediate(() => { this.executeCodeTask(id).catch((error) => console.error(`Recovered workflow ${id} failed`, error)); });
  }

  private async readProjectDocs() {
    const root = resolve(process.env.SP_AGENT_PROJECT_ROOT ?? process.cwd());
    const docs = await Promise.all(
      PROJECT_DOC_ALLOWLIST.map(async (file) => {
        const absolutePath = resolve(root, file);
        const content = await readFile(absolutePath, "utf8");
        return { file: basename(absolutePath), content };
      })
    );
    return docs;
  }

  private async replaceWorkflow(workflow: WorkflowRun) {
    const file = await this.readFile();
    const index = file.workflows.findIndex((item) => item.id === workflow.id);
    if (index >= 0) file.workflows[index] = workflow;
    else file.workflows.push(workflow);
    await this.writeFile(file);
  }

  private async readFile(): Promise<WorkflowsFile> {
    const file = await this.store.read<WorkflowsFile>("workflows.json", { workflows: [] });
    return { workflows: file.workflows ?? [] };
  }

  private async writeFile(file: WorkflowsFile) {
    await this.store.write("workflows.json", file);
  }
}

function findWorkflow(file: WorkflowsFile, id: string) {
  const workflow = file.workflows.find((item) => item.id === id);
  if (!workflow) throw new NotFoundException(`Workflow ${id} not found`);
  return workflow;
}

function makeNodeEvent(
  nodeId: string,
  label: string,
  status: WorkflowNodeEvent["status"],
  payload: Record<string, unknown> = {},
  startedAt?: string,
  completedAt?: string,
  error?: string,
  degradedReason?: string
): WorkflowNodeEvent {
  const now = new Date().toISOString();
  return {
    id: `workflow_node_${crypto.randomUUID()}`,
    nodeId,
    label,
    status,
    payload,
    error,
    degradedReason,
    createdAt: now,
    startedAt: startedAt ?? now,
    completedAt: completedAt ?? now
  };
}

function scoreText(content: string, terms: string[]) {
  const haystack = content.toLowerCase();
  return terms.reduce((score, term) => score + countOccurrences(haystack, term), 0);
}

function makePreview(content: string, terms: string[]) {
  const lower = content.toLowerCase();
  const firstIndex = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstIndex - 120);
  return content.slice(start, start + 360).replace(/\s+/g, " ").trim();
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

function tokenize(value: string) {
  const terms = value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5._-]+/u)
    .map((term) => term.trim())
    .filter(Boolean);
  return Array.from(new Set(terms.length > 0 ? terms : [value.toLowerCase()]));
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
