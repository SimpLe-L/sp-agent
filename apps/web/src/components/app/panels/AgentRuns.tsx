import { useEffect, useMemo, useState } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiBase, fetchJson } from "@/app/api";
import type { AgentRun, AgentRunEvent } from "@/app/types";
import { cn } from "@/lib/utils";

export function AgentRuns() {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const selected = useMemo(() => runs.find((run) => run.id === selectedId) ?? runs[0], [runs, selectedId]);

  async function refresh() {
    setLoading(true);
    try {
      const next = await fetchJson<AgentRun[]>(`${apiBase}/agent/runs?limit=30`);
      setRuns(next);
      setSelectedId((current) => current && next.some((run) => run.id === current) ? current : next[0]?.id ?? null);
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Agent runs unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (open) void refresh(); }, [open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={<SheetTrigger render={<Button variant="ghost" size="icon" className="text-muted-foreground" data-testid="agent-runs-button" />} />}>
          <GitBranch size={18} />
          <span className="sr-only">Review agent runs</span>
        </TooltipTrigger>
        <TooltipContent>Review agent runs</TooltipContent>
      </Tooltip>
      <SheetContent side="right" className="w-[min(720px,96vw)] max-w-[min(720px,96vw)] gap-0 p-0" data-testid="agent-runs-panel">
        <header className="flex min-h-18 items-center justify-between border-b px-5 py-4.5">
          <div>
            <h2 className="m-0 text-lg leading-tight font-bold">Agent Runs</h2>
            <p className="m-0 text-[13px] text-muted-foreground">Trace context, tool execution, and runtime outcomes.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={loading} aria-label="Refresh agent runs"><RefreshCw size={16} /></Button>
        </header>
        {status && <p className="border-b px-5 py-2.5 text-[13px] text-muted-foreground">{status}</p>}
        <div className="grid min-h-0 grid-cols-[190px_minmax(0,1fr)] max-sm:grid-cols-1">
          <nav className="min-h-0 overflow-auto border-r max-sm:max-h-44 max-sm:border-r-0 max-sm:border-b" aria-label="Agent run list">
            {runs.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No runs recorded yet.</p> : runs.map((run) => (
              <button
                type="button"
                key={run.id}
                onClick={() => setSelectedId(run.id)}
                className={cn("grid w-full gap-1 border-b px-3 py-3 text-left hover:bg-muted/60", selected?.id === run.id && "bg-muted")}
              >
                <span className="truncate text-[12px] font-semibold">{run.id.slice(0, 18)}</span>
                <span className={cn("w-fit rounded-full border px-1.5 py-0.5 text-[10px] capitalize", runStatusClass(run.status))}>{run.status}</span>
                <time className="text-[10px] text-muted-foreground">{new Date(run.startedAt).toLocaleTimeString()}</time>
              </button>
            ))}
          </nav>
          <section className="min-h-0 overflow-auto p-4">
            {selected ? <RunDetail run={selected} /> : <div className="flex min-h-40 items-center justify-center border border-dashed text-sm text-muted-foreground">No run selected</div>}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RunDetail({ run }: { run: AgentRun }) {
  const duration = run.completedAt ? Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) : undefined;
  return (
    <div className="grid gap-5">
      <section className="grid gap-2 border-b pb-4">
        <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{run.id}</strong><span className={cn("rounded-full border px-2 py-0.5 text-[11px] capitalize", runStatusClass(run.status))}>{run.status}</span></div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          <Meta label="Runtime" value={run.runtimeId} /><Meta label="Provider" value={run.provider ?? "pending"} />
          <Meta label="Model" value={run.model ?? "pending"} /><Meta label="Duration" value={duration === undefined ? "running" : `${duration} ms`} />
        </dl>
        {run.degradedReason && <p className="m-0 border-l-2 border-amber-500 pl-2 text-[12px] text-amber-800">{run.degradedReason}</p>}
      </section>
      <section className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold">Context Manifest</h3>
        <dl className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
          <Meta label="History" value={`${run.context.conversationMessageCount} messages`} />
          <Meta label="Memory" value={`${run.context.memoryCount} entries`} />
          <Meta label="Extensions" value={String(run.context.extensionCount)} />
          <Meta label="Capabilities" value={String(run.context.capabilityCount)} />
        </dl>
        <TraceList label="Visible extensions" values={run.context.visibleExtensionIds} />
        <TraceList label="Active Skills" values={run.context.activeSkillIds} />
      </section>
      <section className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold">Event Timeline</h3>
        <div className="grid gap-2 border-l pl-3">{run.events.map((event) => <EventItem event={event} key={event.id} />)}</div>
      </section>
    </div>
  );
}

function EventItem({ event }: { event: AgentRunEvent }) {
  return <article className="grid gap-1 border-b pb-2 last:border-b-0"><div className="flex items-center justify-between gap-2"><strong className="text-[12px]">{event.kind.replaceAll("_", " ")}</strong><time className="text-[10px] text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString()}</time></div><pre className="m-0 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{JSON.stringify(event.data, null, 2)}</pre></article>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-0.5"><dt className="text-[10px] font-bold uppercase text-muted-foreground">{label}</dt><dd className="m-0 break-words text-foreground">{value}</dd></div>;
}

function TraceList({ label, values }: { label: string; values: string[] }) {
  return <div className="grid gap-1"><span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span><div className="flex flex-wrap gap-1">{values.length === 0 ? <span className="text-[12px] text-muted-foreground">None</span> : values.map((value) => <span className="rounded border px-1.5 py-0.5 font-mono text-[10px]" key={value}>{value}</span>)}</div></div>;
}

function runStatusClass(status: AgentRun["status"]) {
  if (status === "completed") return "border-emerald-300 text-emerald-700";
  if (status === "failed") return "border-red-300 text-red-700";
  if (status === "degraded") return "border-amber-300 text-amber-700";
  return "border-sky-300 text-sky-700";
}
