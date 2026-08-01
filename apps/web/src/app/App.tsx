import React, { lazy, Suspense, useEffect, useState } from "react";
import { AssistantRuntimeProvider, ThreadListItemPrimitive, ThreadListPrimitive, useAuiState } from "@assistant-ui/react";
import { Archive, Bot, CircleAlert, Menu, MoreHorizontal, PanelLeft, Plus, Server, Share, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AssistantThread } from "@/components/app/AssistantThread";
import { useAgentAssistantRuntime, normalizeThreadTitle } from "./assistant-runtime";
import { cn } from "@/lib/utils";
import { apiBase, fetchJson } from "./api";
import type { AgentStatus } from "./types";

const SkillCatalog = lazy(() => import("@/components/app/panels/SkillCatalog").then((module) => ({ default: module.SkillCatalog })));
const WorkflowReview = lazy(() => import("@/components/app/panels/WorkflowReview").then((module) => ({ default: module.WorkflowReview })));
const MemoryReview = lazy(() => import("@/components/app/panels/MemoryReview").then((module) => ({ default: module.MemoryReview })));
const ApprovalReview = lazy(() => import("@/components/app/panels/ApprovalReview").then((module) => ({ default: module.ApprovalReview })));
const McpServers = lazy(() => import("@/components/app/panels/McpServers").then((module) => ({ default: module.McpServers })));
const AgentRuns = lazy(() => import("@/components/app/panels/AgentRuns").then((module) => ({ default: module.AgentRuns })));

export function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const runtime = useAgentAssistantRuntime();

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <main className="min-h-svh bg-background text-foreground" data-testid="app-shell">
          <section
            className={cn(
              "grid h-svh min-h-0 overflow-hidden bg-background transition-[grid-template-columns] duration-200 md:grid-cols-[260px_minmax(0,1fr)]",
              sidebarCollapsed && "md:grid-cols-[56px_minmax(0,1fr)]"
            )}
            data-testid="view-chat"
          >
            <div className="hidden" data-testid="model-tabs" aria-hidden="true" />
            <AssistantThreadSidebar collapsed={sidebarCollapsed} />
            <section className="flex min-w-0 flex-col overflow-hidden bg-background" data-testid="agent-thread-panel">
              <ChatHeader
                sidebarCollapsed={sidebarCollapsed}
                onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
              />
              <AssistantThread />
            </section>
          </section>
        </main>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

function TooltipIconButton({
  tooltip,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" className={className} {...props} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={cn("flex h-14 min-w-0 items-center gap-2.5 px-5", collapsed && "justify-center px-0")}>
      <Bot className="size-5 shrink-0" />
      <strong className={cn("truncate text-[15px] font-semibold transition-all", collapsed && "w-0 opacity-0")}>
        SP Agent
      </strong>
    </div>
  );
}

function ThreadListEntry({ groupLabel }: { groupLabel?: string }) {
  return (
    <>
      {groupLabel && <h2 className="mx-2 mt-5 mb-1 text-xs font-semibold text-muted-foreground first:mt-6">{groupLabel}</h2>}
      <ThreadListItemPrimitive.Root className="min-w-0">
        <div className="group/thread-item grid min-w-0 grid-cols-[minmax(0,1fr)_30px] items-center rounded-lg hover:bg-accent focus-within:bg-accent has-[[data-active]]:bg-accent has-[[aria-current=true]]:bg-accent">
          <ThreadListItemPrimitive.Trigger className="block min-h-8 w-full cursor-pointer overflow-hidden truncate rounded-lg bg-transparent px-2.5 py-2 text-left text-sm text-foreground">
            <ThreadListItemPrimitive.Title fallback="New Chat" />
          </ThreadListItemPrimitive.Trigger>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover/thread-item:opacity-100 data-popup-open:opacity-100" title="Thread actions" aria-label="Thread actions" data-testid="thread-actions-button">
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <ThreadListItemPrimitive.Archive
                render={
                  <DropdownMenuItem data-testid="thread-archive-action">
                    <Archive className="size-3.5" />
                    <span>Archive</span>
                  </DropdownMenuItem>
                }
              />
              <ThreadListItemPrimitive.Delete
                render={
                  <DropdownMenuItem variant="destructive" data-testid="thread-delete-action">
                    <Trash2 className="size-3.5" />
                    <span>Delete</span>
                  </DropdownMenuItem>
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ThreadListItemPrimitive.Root>
    </>
  );
}

function ThreadListContent({ collapsed = false }: { collapsed?: boolean }) {
  const threadItems = useAuiState((state) => state.threads.threadItems);
  return (
    <ThreadListPrimitive.Root className={cn("flex min-h-0 flex-1 flex-col px-3 py-2", collapsed && "items-center px-2")}>
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadListPrimitive.New
              className={cn(
                "inline-flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg bg-muted px-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent",
                collapsed && "w-10 justify-center px-0"
              )}
              data-testid="new-thread-button"
            />
          }
        >
          <Plus className="size-5 shrink-0" />
          <span className={cn(collapsed && "hidden")}>New Thread</span>
        </TooltipTrigger>
        {collapsed && <TooltipContent side="right">New Thread</TooltipContent>}
      </Tooltip>
      <div className={cn("grid min-h-0 content-start gap-1 overflow-auto", collapsed && "hidden")} data-testid="thread-list">
        <ThreadListPrimitive.Items>
          {({ threadListItem }) => {
            const index = threadItems.findIndex((item) => item.id === threadListItem.id);
            const groupLabel = threadGroupLabel(threadListItem.lastMessageAt);
            const previousGroupLabel = index > 0 ? threadGroupLabel(threadItems[index - 1]?.lastMessageAt) : undefined;
            return <ThreadListEntry groupLabel={groupLabel === previousGroupLabel ? undefined : groupLabel} />;
          }}
        </ThreadListPrimitive.Items>
      </div>
    </ThreadListPrimitive.Root>
  );
}

function threadGroupLabel(lastMessageAt: Date | undefined) {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  if (!lastMessageAt || Number.isNaN(lastMessageAt.getTime()) || lastMessageAt < sevenDaysAgo) return "Older";
  if (lastMessageAt >= today) return "Today";
  if (lastMessageAt >= yesterday) return "Yesterday";
  return "Previous 7 days";
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function AssistantThreadSidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <aside className="hidden min-w-0 flex-col overflow-hidden bg-muted/30 md:flex" data-testid="thread-sidebar">
      <Logo collapsed={collapsed} />
      <ThreadListContent collapsed={collapsed} />
    </aside>
  );
}

function MobileSidebar() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="inline-flex md:hidden" />}>
        <Menu className="size-4.5" />
        <span className="sr-only">Toggle menu</span>
      </SheetTrigger>
      <SheetContent side="left" className="w-[min(320px,86vw)] gap-0 p-0" showCloseButton={false}>
        <Logo />
        <ThreadListContent />
      </SheetContent>
    </Sheet>
  );
}

function ThreadTitle() {
  const title = useAuiState((state) => {
    const item = state.threads.threadItems.find((thread) => thread.id === state.threads.mainThreadId);
    return item?.title;
  });
  return <strong className="block max-w-[44vw] truncate text-[15px] font-semibold md:max-w-[280px]">{normalizeThreadTitle(title)}</strong>;
}

function ChatHeader({
  sidebarCollapsed,
  onToggleSidebar
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="flex h-13 items-center justify-between gap-2 px-2.5 md:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <MobileSidebar />
        <TooltipIconButton
          tooltip={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          className="hidden md:inline-flex"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        >
          <PanelLeft className="size-4.5" />
        </TooltipIconButton>
        <ThreadTitle />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <AgentStatusButton />
        <Suspense fallback={null}>
          <SkillCatalog />
          <WorkflowReview />
          <MemoryReview />
          <ApprovalReview />
          <McpServers />
          <AgentRuns />
        </Suspense>
        <TooltipIconButton tooltip="Share" className="text-muted-foreground" disabled>
          <Share className="size-4.5" />
        </TooltipIconButton>
      </div>
    </header>
  );
}

function AgentStatusButton() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    void fetchJson<AgentStatus>(`${apiBase}/agent/status`)
      .then((value) => { if (active) setStatus(value); })
      .catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; };
  }, []);
  const extensionCount = status?.extensions?.length ?? 0;
  const ready = Boolean(status?.piRuntime?.reachable) && !unavailable;
  const label = unavailable ? "Agent API unavailable" : status ? ready ? "Runtime ready" : status.piRuntime?.degradedReason ?? "Runtime degraded" : "Checking runtime";
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" className="relative text-muted-foreground" data-testid="provider-status-button" aria-label={label} />}>
        {ready ? <Server className="size-4.5" /> : <CircleAlert className="size-4.5" />}
        <span className={cn("absolute top-1 right-1 size-1.5 rounded-full", ready ? "bg-emerald-500" : "bg-amber-500")} />
        <span className="sr-only" data-testid="extension-count">{extensionCount} extensions</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
