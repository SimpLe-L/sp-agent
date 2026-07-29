import React, { useEffect, useState } from "react";
import { FolderOpen, GitBranch, Github, Plug, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiBase, fetchJson } from "@/app/api";
import { chooseSkillFolder } from "@/app/desktop";
import type { ExtensionCapability, ExtensionManifest } from "@/app/types";
import { cn } from "@/lib/utils";

const skillPillClass = "inline-flex items-center rounded-full border border-border px-2 py-1 text-[11px] leading-none capitalize";
const skillMetaLabelClass = "text-[11px] font-bold uppercase text-muted-foreground";
const skillMetaValueClass = "m-0 [overflow-wrap:anywhere] text-[13px] text-foreground";

export function SkillCatalog() {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<LocalSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repositoryRef, setRepositoryRef] = useState("main");
  const [skillPath, setSkillPath] = useState("");
  const [sourcePath, setSourcePath] = useState("");

  const extensions = skills.map(toLocalSkill);
  const grouped = groupExtensions(extensions);

  async function refreshCatalog() {
    setLoading(true);
    try {
      setSkills(await fetchJson<LocalSkill[]>(`${apiBase}/skills`));
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Skills unavailable");
    } finally {
      setLoading(false);
    }
  }

  async function importLocalSkill(path = sourcePath) {
    if (!path.trim()) return;
    setLoading(true);
    try {
      await fetchJson(`${apiBase}/skills/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourcePath: path }) });
      setSourcePath("");
      await refreshCatalog();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Skill import failed"); } finally { setLoading(false); }
  }

  async function importRepository() {
    if (!repositoryUrl.trim()) return;
    setLoading(true);
    setStatus(null);
    try {
      await fetchJson(`${apiBase}/skills/import-repository`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repositoryUrl, ref: repositoryRef || "main", skillPath })
      });
      setRepositoryUrl("");
      setRepositoryRef("main");
      setSkillPath("");
      await refreshCatalog();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Skill import failed");
    } finally {
      setLoading(false);
    }
  }

  async function chooseFolder() {
    const path = await chooseSkillFolder();
    if (path) {
      setSourcePath(path);
      await importLocalSkill(path);
    }
  }

  async function manageLocalSkill(extension: ExtensionManifest, action: "enable" | "disable" | "remove") {
    const id = extension.id.slice("local.skill.".length);
    setLoading(true);
    try {
      await fetchJson(`${apiBase}/skills/${encodeURIComponent(id)}${action === "remove" ? "" : `/${action}`}`, { method: action === "remove" ? "DELETE" : "PATCH", headers: { "content-type": "application/json" }, body: action === "remove" ? undefined : "{}" });
      await refreshCatalog();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Skill update failed"); } finally { setLoading(false); }
  }

  useEffect(() => {
    void refreshCatalog();
  }, []);

  useEffect(() => {
    if (open) void refreshCatalog();
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <SheetTrigger
              render={<Button variant="ghost" size="icon" className="relative text-muted-foreground" data-testid="skill-catalog-button" />}
            />
          }
        >
          <Plug size={18} />
          <span className="sr-only">Review skills</span>
        </TooltipTrigger>
        <TooltipContent>Review skills</TooltipContent>
      </Tooltip>
      <SheetContent side="right" className="w-[min(500px,94vw)] max-w-[min(500px,94vw)] gap-0 p-0 max-[900px]:w-[min(380px,94vw)]" data-testid="skill-catalog-panel">
        <div className="flex min-h-18 items-center justify-between border-b px-5 py-4.5">
          <div>
            <h2 className="m-0 text-lg leading-tight font-bold">Skills</h2>
          </div>
          <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={() => void refreshCatalog()} disabled={loading}>
            <RefreshCw size={16} />
          </Button>
        </div>
        <section className="grid gap-4 border-b px-5 py-4" data-testid="skill-repository-import">
          <div className="grid gap-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><Github size={16} />Import from GitHub</div>
          </div>
          <div className="grid gap-2">
            <label className="grid gap-1.5 text-xs font-medium text-muted-foreground" htmlFor="skill-repository-url">
              Repository URL
              <Input id="skill-repository-url" value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/owner/repository" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </label>
            <div className="w-full flex flex-col gap-3">
              <span>Revision</span>
              <div className="relative">
                <GitBranch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input id="skill-repository-ref" className="pl-7 w-full" value={repositoryRef} onChange={(event) => setRepositoryRef(event.target.value)} placeholder="main" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">GitHub only. The selected revision is recorded as a commit.</span>
            <Button size="sm" onClick={() => void importRepository()} disabled={loading || !repositoryUrl.trim()}><Github size={15} />Import</Button>
          </div>
          <details className="border-t pt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Import from a local folder</summary>
            <div className="mt-3 flex gap-2">
              <Input id="local-skill-path" value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="Paste local Skill folder path" aria-label="Local Skill folder path" />
              <Button variant="outline" size="sm" onClick={() => void chooseFolder()} disabled={loading} aria-label="Choose Skill folder"><FolderOpen size={15} /></Button>
              <Button variant="outline" size="sm" onClick={() => void importLocalSkill()} disabled={loading || !sourcePath.trim()}>Import</Button>
            </div>
          </details>
        </section>
        <section className="border-b px-5 py-3 text-xs leading-relaxed text-muted-foreground" data-testid="skill-safety-policy">
          Imported packages stay disabled until enabled. Instructions and references load on demand; package code never runs during import.
        </section>
        {status && <p className="border-b px-5 py-2.5 text-[13px] text-muted-foreground" data-testid="skill-catalog-status">{status}</p>}
        <div className="grid min-h-0 gap-3 overflow-auto p-3.5" data-testid="skill-catalog-list">
          {extensions.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">No skills available</div>
          ) : (
            grouped.map((group) => (
              <section className="grid gap-2" key={group.label} data-testid={`skill-group-${group.key}`}>
                <h3 className="mt-0.5 text-[11px] font-bold tracking-normal text-muted-foreground uppercase">{group.label}</h3>
                {group.extensions.map((extension) => (
                  <SkillCatalogItem extension={extension} key={extension.id} onManage={manageLocalSkill} loading={loading} />
                ))}
              </section>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SkillCatalogItem({ extension, onManage, loading }: { extension: ExtensionManifest; onManage: (extension: ExtensionManifest, action: "enable" | "disable" | "remove") => Promise<void>; loading: boolean }) {
  const [expanded, setExpanded] = useState(extension.status !== "active");
  return (
    <article className={cn("grid gap-2.5 rounded-lg border border-l-3 p-3", extensionStatusBorderClass(extension.status))}>
      <button className="grid cursor-pointer gap-1 text-left" type="button" onClick={() => setExpanded((value) => !value)} data-testid="skill-catalog-item">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <strong className="min-w-0 flex-1 truncate text-[14px] text-foreground">{extension.name}</strong>
          <span className={cn(skillPillClass, "text-foreground")}>{extension.kind}</span>
          <span className={cn(skillPillClass, "font-semibold text-muted-foreground")}>{extension.status}</span>
        </div>
        <span className="text-xs text-muted-foreground">{extension.id}</span>
      </button>
      <p className="m-0 text-[13px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{extension.description}</p>
      {extension.id.startsWith("local.skill.") && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void onManage(extension, extension.status === "active" ? "disable" : "enable")}>{extension.status === "active" ? "Disable" : "Enable"}</Button>
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => void onManage(extension, "remove")}>Remove</Button>
        </div>
      )}
      {extension.degradedReason && (
        <p className="m-0 rounded-md bg-muted/45 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {extension.degradedReason}
        </p>
      )}
      {expanded && (
        <div className="grid gap-2.5" data-testid="skill-capability-list">
          {extension.capabilities.length === 0 ? (
            <span className="text-xs text-muted-foreground">No capabilities listed</span>
          ) : (
            extension.capabilities.map((capability) => (
              <div className="grid gap-1 border-t pt-2.5" key={capability.id} data-testid="skill-capability-item">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <strong className="min-w-0 flex-1 truncate text-[13px] text-foreground">{capability.label}</strong>
                  <span className={cn(skillPillClass, capabilityAuditMode(capability) === "read_only" ? "text-emerald-700" : "text-amber-700")}>
                    {capabilityAuditMode(capability) === "read_only" ? "read only" : "approval"}
                  </span>
                </div>
                <p className="m-0 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{capability.description}</p>
                <dl className="m-0 grid gap-1 text-xs text-muted-foreground">
                  <div className="grid gap-0.5">
                    <dt className={skillMetaLabelClass}>Capability</dt>
                    <dd className={skillMetaValueClass}>{capability.id}</dd>
                  </div>
                  <div className="grid gap-0.5">
                    <dt className={skillMetaLabelClass}>Permissions</dt>
                    <dd className={skillMetaValueClass}>{capability.permissions.join(", ") || "none"}</dd>
                  </div>
                  <div className="grid gap-0.5">
                    <dt className={skillMetaLabelClass}>Effects and risk</dt>
                    <dd className={skillMetaValueClass}>{capability.effects?.join(", ") || "read"} · {capability.riskLevel ?? "low"} · {capability.executionPolicy ?? "auto"}</dd>
                  </div>
                </dl>
              </div>
            ))
          )}
        </div>
      )}
    </article>
  );
}

type LocalSkill = { id: string; name: string; description: string; status: "active" | "disabled"; version: string; requestedTools: string[] };
function toLocalSkill(skill: LocalSkill): ExtensionManifest {
  return { id: `local.skill.${skill.id}`, name: skill.name, description: skill.description, kind: "skill", phase: `local ${skill.version}`, status: skill.status, capabilities: skill.requestedTools.map((id) => ({ id, label: id, description: "Requested API tool", permissions: [] })) };
}

function groupExtensions(extensions: ExtensionManifest[]) {
  const groups = [
    { key: "active", label: "Enabled", extensions: extensions.filter((extension) => extension.status === "active") },
    { key: "disabled", label: "Disabled", extensions: extensions.filter((extension) => extension.status === "disabled") }
  ];
  return groups.filter((group) => group.extensions.length > 0);
}

function capabilityAuditMode(capability: ExtensionCapability) {
  return capability.permissions.some((permission) => {
    const normalized = permission.toLowerCase();
    return normalized.includes("write") || normalized.includes("provider") || normalized.includes("audio:") || normalized.includes("transcribe") || normalized.includes("synthesize");
  }) ? "write_or_provider" : "read_only";
}

function extensionStatusBorderClass(status: ExtensionManifest["status"]) {
  if (status === "active") return "border-l-emerald-500";
  if (status === "degraded") return "border-l-amber-500";
  if (status === "planned") return "border-l-blue-500";
  return "border-l-slate-500";
}
