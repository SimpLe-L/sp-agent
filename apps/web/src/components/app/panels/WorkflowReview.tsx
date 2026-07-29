import React, { useEffect, useMemo, useState } from "react";
import { Activity, Play, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiBase, fetchJson } from "@/app/api";
import type { WorkflowNodeEvent, WorkflowRun } from "@/app/types";
import { cn } from "@/lib/utils";

const workflowPillClass = "inline-flex items-center rounded-full border border-border px-2 py-1 text-[11px] leading-none capitalize";
const workflowMetaLabelClass = "text-[11px] font-bold uppercase text-muted-foreground";
const workflowMetaValueClass = "m-0 [overflow-wrap:anywhere] text-[13px] text-foreground";

export function WorkflowReview() {
  const [open, setOpen] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const activeCount = workflows.filter((workflow) => workflow.status === "pending" || workflow.status === "running").length;
  const failedCount = workflows.filter((workflow) => workflow.status === "failed").length;
  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedId) ?? workflows[0],
    [selectedId, workflows]
  );

  async function refreshWorkflows() {
    setLoading(true);
    try {
      const data = await fetchJson<{ workflows: WorkflowRun[] }>(`${apiBase}/workflows`);
      setWorkflows(data.workflows);
      setSelectedId((current) => current && data.workflows.some((workflow) => workflow.id === current) ? current : data.workflows[0]?.id ?? null);
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Workflows unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshWorkflows();
  }, []);

  useEffect(() => {
    if (open) void refreshWorkflows();
  }, [open]);

  async function cancelWorkflow(workflow: WorkflowRun) {
    setStatus("Cancelling workflow");
    try {
      const data = await fetchJson<{ workflow: WorkflowRun }>(`${apiBase}/workflows/${workflow.id}/cancel`, { method: "POST" });
      upsertWorkflow(data.workflow);
      setStatus(data.workflow.degradedReason ?? "Cancelled");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Cancel failed");
    }
  }

  async function retryWorkflow(workflow: WorkflowRun) {
    setStatus("Retrying workflow");
    try {
      const data = await fetchJson<{ workflow: WorkflowRun }>(`${apiBase}/workflows/${workflow.id}/retry`, { method: "POST" });
      setWorkflows((current) => [data.workflow, ...current.filter((item) => item.id !== data.workflow.id)]);
      setSelectedId(data.workflow.id);
      setStatus("Retry started");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Retry failed");
    }
  }

  async function resumeWorkflow(workflow: WorkflowRun) {
    setStatus("Resuming workflow");
    try {
      const data = await fetchJson<{ workflow: WorkflowRun }>(`${apiBase}/workflows/${workflow.id}/resume`, { method: "POST" });
      upsertWorkflow(data.workflow);
      setStatus("Workflow resumed");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Resume failed");
    }
  }

  function upsertWorkflow(workflow: WorkflowRun) {
    setWorkflows((current) => current.map((item) => item.id === workflow.id ? workflow : item));
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <SheetTrigger
              render={<Button variant="ghost" size="icon" className="relative text-muted-foreground" data-testid="workflow-review-button" />}
            />
          }
        >
          <Activity size={18} />
          {(activeCount > 0 || failedCount > 0) && (
            <span
              className={cn(
                "absolute top-0.5 right-0.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-background px-1 text-[10px] leading-none font-bold text-white",
                failedCount > 0 ? "bg-red-600" : "bg-emerald-600"
              )}
              data-testid="workflow-active-count"
            >
              {activeCount || failedCount}
            </span>
          )}
          <span className="sr-only">Review workflows</span>
        </TooltipTrigger>
        <TooltipContent>Review workflows</TooltipContent>
      </Tooltip>
      <SheetContent side="right" className="w-[min(540px,94vw)] max-w-[min(540px,94vw)] gap-0 p-0 max-[900px]:w-[min(390px,94vw)]" data-testid="workflow-review-panel">
        <div className="flex min-h-18 items-center justify-between border-b px-5 py-4.5">
          <div>
            <h2 className="m-0 text-lg leading-tight font-bold">Workflows</h2>
            <p className="text-[13px] text-muted-foreground">{workflows.length} run{workflows.length === 1 ? "" : "s"} tracked</p>
          </div>
          <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={() => void refreshWorkflows()} disabled={loading}>
            <RefreshCw size={16} />
          </Button>
        </div>
        {status && <p className="border-b px-5 py-2.5 text-[13px] text-muted-foreground" data-testid="workflow-review-status">{status}</p>}
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <div className="flex gap-2 overflow-x-auto border-b px-4 py-3" data-testid="workflow-list">
            {workflows.length === 0 ? (
              <span className="text-sm text-muted-foreground">No workflow runs yet</span>
            ) : (
              workflows.slice(0, 12).map((workflow) => (
                <button
                  type="button"
                  className={cn(
                    "grid min-w-44 gap-1 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/60",
                    selectedWorkflow?.id === workflow.id && "bg-muted"
                  )}
                  key={workflow.id}
                  onClick={() => setSelectedId(workflow.id)}
                  data-testid="workflow-list-item"
                >
                  <span className="truncate text-[13px] font-semibold text-foreground">{workflow.kind}</span>
                  <span className={cn(workflowPillClass, workflowStatusTextClass(workflow.status))}>{workflow.status}</span>
                  <time className="text-[11px] text-muted-foreground">{new Date(workflow.updatedAt).toLocaleString()}</time>
                </button>
              ))
            )}
          </div>
          <div className="min-h-0 overflow-auto p-4" data-testid="workflow-detail">
            {selectedWorkflow ? (
              <WorkflowDetail workflow={selectedWorkflow} onCancel={() => void cancelWorkflow(selectedWorkflow)} onRetry={() => void retryWorkflow(selectedWorkflow)} onResume={() => void resumeWorkflow(selectedWorkflow)} />
            ) : (
              <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">No workflow selected</div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function WorkflowDetail({ workflow, onCancel, onRetry, onResume }: { workflow: WorkflowRun; onCancel: () => void; onRetry: () => void; onResume: () => void }) {
  const canCancel = workflow.status === "pending" || workflow.status === "running";
  const canRetry = workflow.status === "completed" || workflow.status === "failed" || workflow.status === "cancelled";
  const canResume = workflow.status === "paused";
  return (
    <article className="grid gap-4">
      <header className={cn("grid gap-2 rounded-lg border border-l-3 p-3", workflowStatusBorderClass(workflow.status))}>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <strong className="min-w-0 flex-1 truncate text-[14px] text-foreground">{workflow.kind}</strong>
          <span className={cn(workflowPillClass, workflowStatusTextClass(workflow.status))}>{workflow.status}</span>
        </div>
        <dl className="m-0 grid gap-1.5">
          <WorkflowMeta label="Run" value={workflow.id} />
          <WorkflowMeta label="Created" value={new Date(workflow.createdAt).toLocaleString()} />
          <WorkflowMeta label="Updated" value={new Date(workflow.updatedAt).toLocaleString()} />
          {workflow.completedAt && <WorkflowMeta label="Completed" value={new Date(workflow.completedAt).toLocaleString()} />}
        </dl>
        {(workflow.degradedReason || workflow.error) && (
          <p className="m-0 rounded-md bg-muted/45 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {workflow.degradedReason ?? workflow.error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onRetry} disabled={!canRetry}>
            <RotateCcw size={14} />
            Retry
          </Button>
          <Button variant="outline" size="sm" onClick={onResume} disabled={!canResume}>
            <Play size={14} />
            Resume
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={!canCancel}>
            <XCircle size={14} />
            Cancel
          </Button>
        </div>
      </header>

      <section className="grid gap-2" data-testid="workflow-node-events">
        <h3 className="text-[11px] font-bold tracking-normal text-muted-foreground uppercase">Node events</h3>
        {workflow.nodeEvents.length === 0 ? (
          <span className="text-sm text-muted-foreground">No node events recorded</span>
        ) : (
          workflow.nodeEvents.map((event) => <WorkflowNodeEventItem event={event} key={event.id} />)
        )}
      </section>

      <section className="grid gap-2">
        <h3 className="text-[11px] font-bold tracking-normal text-muted-foreground uppercase">Input</h3>
        <pre className="m-0 max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/25 p-2.5 text-xs leading-relaxed text-foreground">{JSON.stringify(workflow.input, null, 2)}</pre>
      </section>

      {workflow.result !== undefined && (
        <section className="grid gap-2">
          <h3 className="text-[11px] font-bold tracking-normal text-muted-foreground uppercase">Result</h3>
          <pre className="m-0 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/25 p-2.5 text-xs leading-relaxed text-foreground">{JSON.stringify(workflow.result, null, 2)}</pre>
        </section>
      )}
    </article>
  );
}

function WorkflowNodeEventItem({ event }: { event: WorkflowNodeEvent }) {
  return (
    <div className={cn("grid gap-1 border-l-2 py-1.5 pl-3", workflowStatusBorderClass(event.status).replace("border-l-", "border-l-"))} data-testid="workflow-node-event">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <strong className="min-w-0 flex-1 truncate text-[13px] text-foreground">{event.label}</strong>
        <span className={cn(workflowPillClass, workflowStatusTextClass(event.status))}>{event.status}</span>
      </div>
      <dl className="m-0 grid gap-1">
        <WorkflowMeta label="Node" value={event.nodeId} />
        {event.completedAt && <WorkflowMeta label="Completed" value={new Date(event.completedAt).toLocaleString()} />}
        {event.degradedReason && <WorkflowMeta label="Degraded" value={event.degradedReason} />}
        {event.error && <WorkflowMeta label="Error" value={event.error} />}
      </dl>
      {Object.keys(event.payload ?? {}).length > 0 && (
        <pre className="m-0 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted/35 p-2 text-xs leading-relaxed text-foreground">{JSON.stringify(event.payload, null, 2)}</pre>
      )}
    </div>
  );
}

function WorkflowMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className={workflowMetaLabelClass}>{label}</dt>
      <dd className={workflowMetaValueClass}>{value}</dd>
    </div>
  );
}

function workflowStatusBorderClass(status: WorkflowRun["status"] | WorkflowNodeEvent["status"]) {
  if (status === "completed") return "border-l-emerald-500";
  if (status === "running") return "border-l-blue-500";
  if (status === "pending") return "border-l-amber-500";
  if (status === "paused") return "border-l-violet-500";
  if (status === "failed") return "border-l-red-500";
  return "border-l-slate-500";
}

function workflowStatusTextClass(status: WorkflowRun["status"] | WorkflowNodeEvent["status"]) {
  if (status === "completed") return "text-emerald-700";
  if (status === "running") return "text-blue-700";
  if (status === "pending") return "text-amber-700";
  if (status === "paused") return "text-violet-700";
  if (status === "failed") return "text-red-700";
  return "text-muted-foreground";
}
