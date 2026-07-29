import { useEffect, useState } from "react";
import { PlugZap, Power, RefreshCw, ServerCog, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiBase, fetchJson } from "@/app/api";

type McpServer = {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  tools: Array<{ name: string; description: string }>;
  degradedReason?: string;
};

export function McpServers() {
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState({ id: "", name: "", command: "", args: "" });

  async function refresh() {
    setLoading(true);
    try {
      setServers(await fetchJson<McpServer[]>(`${apiBase}/mcp/servers`));
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "MCP servers unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (open) void refresh(); }, [open]);

  async function addServer() {
    if (!draft.id.trim() || !draft.name.trim() || !draft.command.trim()) return;
    setLoading(true);
    try {
      await fetchJson(`${apiBase}/mcp/servers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, args: draft.args.split(/\s+/u).filter(Boolean) })
      });
      setDraft({ id: "", name: "", command: "", args: "" });
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "MCP server could not be added");
      setLoading(false);
    }
  }

  async function update(id: string, body: Record<string, unknown>) {
    setLoading(true);
    try {
      await fetchJson(`${apiBase}/mcp/servers/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      await refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "MCP server update failed"); setLoading(false); }
  }

  async function discover(id: string) {
    setLoading(true);
    try {
      await fetchJson(`${apiBase}/mcp/servers/${encodeURIComponent(id)}/discover`, { method: "POST" });
      await refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "MCP tool discovery failed"); setLoading(false); }
  }

  async function remove(id: string) {
    setLoading(true);
    try {
      await fetchJson(`${apiBase}/mcp/servers/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "MCP server removal failed"); setLoading(false); }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={<SheetTrigger render={<Button variant="ghost" size="icon" className="text-muted-foreground" data-testid="mcp-servers-button" />} />}>
          <ServerCog size={18} />
          <span className="sr-only">Manage MCP servers</span>
        </TooltipTrigger>
        <TooltipContent>Manage MCP servers</TooltipContent>
      </Tooltip>
      <SheetContent side="right" className="w-[min(500px,94vw)] max-w-[min(500px,94vw)] gap-0 p-0 max-[900px]:w-[min(380px,94vw)]" data-testid="mcp-servers-panel">
        <header className="flex min-h-18 items-center justify-between border-b px-5 py-4.5">
          <h2 className="m-0 text-lg leading-tight font-bold">MCP servers</h2>
          <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={loading} aria-label="Refresh MCP servers"><RefreshCw size={16} /></Button>
        </header>
        <section className="grid gap-2.5 border-b px-5 py-4" data-testid="mcp-server-add">
          <div className="grid grid-cols-2 gap-2">
            <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Server name" aria-label="MCP server name" />
            <Input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="server.id" aria-label="MCP server id" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </div>
          <Input value={draft.command} onChange={(event) => setDraft({ ...draft, command: event.target.value })} placeholder="Command" aria-label="MCP server command" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <div className="flex gap-2">
            <Input value={draft.args} onChange={(event) => setDraft({ ...draft, args: event.target.value })} placeholder="Arguments" aria-label="MCP server arguments" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <Button size="sm" onClick={() => void addServer()} disabled={loading || !draft.id.trim() || !draft.name.trim() || !draft.command.trim()}><PlugZap size={15} />Add</Button>
          </div>
        </section>
        {status && <p className="border-b px-5 py-2.5 text-[13px] text-muted-foreground" data-testid="mcp-servers-status">{status}</p>}
        <div className="grid min-h-0 gap-3 overflow-auto p-3.5" data-testid="mcp-server-list">
          {servers.length === 0 ? <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">No MCP servers</div> : servers.map((server) => (
            <article className="grid gap-2.5 rounded-lg border border-l-3 border-l-emerald-500 p-3" key={server.id} data-testid="mcp-server-item">
              <div className="flex min-w-0 items-center gap-2">
                <strong className="min-w-0 flex-1 truncate text-sm">{server.name}</strong>
                <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{server.enabled ? "enabled" : "disabled"}</span>
              </div>
              <p className="m-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">{server.command} {server.args.join(" ")}</p>
              {server.degradedReason && <p className="m-0 text-xs text-amber-700 [overflow-wrap:anywhere]">{server.degradedReason}</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void update(server.id, { enabled: !server.enabled })} disabled={loading}><Power size={14} />{server.enabled ? "Disable" : "Enable"}</Button>
                <Button variant="outline" size="sm" onClick={() => void discover(server.id)} disabled={loading || !server.enabled}><RefreshCw size={14} />Discover</Button>
                <Button variant="ghost" size="sm" onClick={() => void remove(server.id)} disabled={loading}><Trash2 size={14} />Remove</Button>
              </div>
              {server.tools.length > 0 && <div className="grid gap-1 border-t pt-2 text-xs text-muted-foreground">{server.tools.map((tool) => <div key={tool.name}><strong className="text-foreground">{tool.name}</strong>{tool.description ? ` - ${tool.description}` : ""}</div>)}</div>}
            </article>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
