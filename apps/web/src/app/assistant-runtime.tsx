import React, { useMemo } from "react";
import {
  RuntimeAdapterProvider,
  fromThreadMessageLike,
  useAui,
  useLocalRuntime,
  useRemoteThreadListRuntime,
  type ChatModelAdapter,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
  type ThreadMessage
} from "@assistant-ui/react";
import { apiBase, apiHeaders, fetchJson } from "./api";
import { pendingVoiceResponses } from "./voice-cache";
import type { AgentStreamEvent, ThreadRecord } from "./types";

function latestUserText(messages: readonly ThreadMessage[]): string {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const textParts = lastUser?.content.filter((part) => part.type === "text").map((part) => part.text) ?? [];
  return textParts.join("\n").trim();
}

async function* streamAssistantText(text: string, abortSignal?: AbortSignal) {
  const chars = Array.from(text);
  const chunkSize = chars.length > 240 ? 4 : chars.length > 120 ? 3 : 2;
  let visible = "";
  for (let index = 0; index < chars.length; index += chunkSize) {
    if (abortSignal?.aborted) return;
    visible += chars.slice(index, index + chunkSize).join("");
    yield { content: [{ type: "text" as const, text: visible }] };
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
  if (visible !== text && !abortSignal?.aborted) {
    yield { content: [{ type: "text" as const, text }] };
  }
}

async function* readSseEvents(response: Response, abortSignal?: AbortSignal): AsyncGenerator<AgentStreamEvent> {
  if (!response.body) throw new Error("Agent stream response did not include a readable body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (abortSignal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseSseEvent(rawEvent);
        if (event) yield event;
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    const event = parseSseEvent(buffer);
    if (event) yield event;
  } finally {
    reader.releaseLock();
  }
}

function parseSseEvent(rawEvent: string): AgentStreamEvent | null {
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  return JSON.parse(data) as AgentStreamEvent;
}

function makeThreadTitle(content: string) {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "New Chat";
  return clean.length > 24 ? `${clean.slice(0, 24)}...` : clean;
}

function toThreadMetadata(thread: ThreadRecord) {
  apiSessionIdsByThreadId.set(thread.id, thread.id);
  return {
    status: "regular" as const,
    remoteId: thread.id,
    externalId: thread.id,
    title: normalizeThreadTitle(thread.title),
    lastMessageAt: new Date(thread.updatedAt)
  };
}

const sessionCache = new Map<string, ThreadRecord>();

function cacheSession(session: ThreadRecord) {
  sessionCache.set(session.id, session);
  return session;
}

async function loadSession(sessionId: string) {
  const cached = sessionCache.get(sessionId);
  if (cached?.messages) return cached;
  return cacheSession(await fetchJson<ThreadRecord>(`${apiBase}/chat/sessions/${sessionId}`));
}

function toAssistantThreadMessage(message: NonNullable<ThreadRecord["messages"]>[number], index: number) {
  if (message.role !== "user" && message.role !== "assistant" && message.role !== "system") return null;
  return fromThreadMessageLike(
    {
      id: message.id ?? `api_msg_${index}`,
      role: message.role,
      content: message.content,
      createdAt: new Date(message.createdAt),
      status: message.role === "assistant" ? { type: "complete", reason: "stop" } : undefined,
      metadata: { custom: { source: "api.chat.sessions", artifacts: message.metadata?.artifacts ?? [] } }
    },
    message.id ?? `api_msg_${index}`,
    { type: "complete", reason: "stop" }
  );
}

async function updateSessionTitle(sessionId: string, title: string) {
  await fetchJson<ThreadRecord>(`${apiBase}/chat/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title })
  }).catch(() => undefined);
}

function createTitleStream(title: string): Awaited<ReturnType<RemoteThreadListAdapter["generateTitle"]>> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "part-start", path: [0], part: { type: "text" } });
      controller.enqueue({ type: "text-delta", path: [0], textDelta: title });
      controller.enqueue({ type: "part-finish", path: [0] });
      controller.enqueue({
        type: "message-finish",
        path: [],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 }
      });
      controller.close();
    }
  }) as Awaited<ReturnType<RemoteThreadListAdapter["generateTitle"]>>;
}

function firstUserTitle(messages: readonly ThreadMessage[]) {
  const firstUser = messages.find((message) => message.role === "user");
  const text = firstUser?.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
  return makeThreadTitle(text ?? "");
}

export function normalizeThreadTitle(title: string | undefined) {
  return title?.trim() || "New Chat";
}

const apiSessionIdsByThreadId = new Map<string, string>();

function ThreadHistoryProvider({ children }: { children?: React.ReactNode }) {
  const aui = useAui();
  const history = useMemo<ThreadHistoryAdapter>(
    () => ({
      async load() {
        const { remoteId } = aui.threadListItem().getState();
        if (!remoteId) return { messages: [] };
        const session = await loadSession(remoteId);
        const messages = (session.messages ?? [])
          .map(toAssistantThreadMessage)
          .filter((message): message is ThreadMessage => Boolean(message));
        return {
          headId: messages.at(-1)?.id ?? null,
          messages: messages.map((message, index) => ({
            message,
            parentId: index === 0 ? null : messages[index - 1]?.id ?? null
          }))
        };
      },
      async append() {
        return;
      },
      async delete() {
        return;
      }
    }),
    [aui]
  );
  return <RuntimeAdapterProvider adapters={{ history }}>{children}</RuntimeAdapterProvider>;
}

const assistantThreadListAdapter: RemoteThreadListAdapter = {
  async list() {
    const data = await fetchJson<{ sessions: ThreadRecord[] }>(`${apiBase}/chat/sessions`);
    return {
      threads: data.sessions.map(toThreadMetadata)
    };
  },
  async initialize(threadId) {
    apiSessionIdsByThreadId.set(threadId, threadId);
    return { remoteId: threadId, externalId: threadId };
  },
  async rename(remoteId, newTitle) {
    await updateSessionTitle(remoteId, newTitle);
  },
  async archive() {
    return;
  },
  async unarchive() {
    return;
  },
  async delete(remoteId) {
    await fetchJson<{ deleted: boolean; sessionId: string }>(`${apiBase}/chat/sessions/${remoteId}`, {
      method: "DELETE"
    });
  },
  async fetch(threadId) {
    const thread = await loadSession(threadId);
    return toThreadMetadata(thread);
  },
  async generateTitle(remoteId, messages) {
    const title = firstUserTitle(messages);
    await updateSessionTitle(remoteId, title);
    return createTitleStream(title);
  },
  unstable_Provider: ThreadHistoryProvider
};

export function useAgentAssistantRuntime() {
  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal, unstable_threadId }) {
        const content = latestUserText(messages);
        if (!content) {
          yield { content: [{ type: "text", text: "请输入你的问题。" }] };
          return;
        }

        const apiSessionId = unstable_threadId ? apiSessionIdsByThreadId.get(unstable_threadId) ?? unstable_threadId : undefined;
        const voiceCacheKey = `${apiSessionId ?? "new"}:${content}`;
        const voiceResponse = pendingVoiceResponses.get(voiceCacheKey);
        if (voiceResponse) {
          pendingVoiceResponses.delete(voiceCacheKey);
          const degraded = voiceResponse.degradedReason ? `\n\n降级原因：${voiceResponse.degradedReason}` : "";
          yield* streamAssistantText(`${voiceResponse.assistantText}${degraded}`, abortSignal);
          return;
        }

        const res = await fetch(`${apiBase}/agent/messages/stream`, {
          method: "POST",
          headers: await apiHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ content, sessionId: apiSessionId }),
          signal: abortSignal
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Agent API returned HTTP ${res.status}`);
        }

        let visibleText = "";
        let sessionId: string | undefined;
        for await (const event of readSseEvents(res, abortSignal)) {
          if (event.type === "metadata") {
            sessionId = event.sessionId;
            await updateSessionTitle(event.sessionId, makeThreadTitle(content));
            continue;
          }
          if (event.type === "text_delta") {
            visibleText += event.text;
            yield { content: [{ type: "text", text: visibleText }] };
            continue;
          }
          if (event.type === "error") {
            throw new Error(event.message);
          }
          if (event.result.toolCalls?.some((call) => call.toolName === "personal_research_research_search_web" || call.toolName === "personal_research_research_run_provider_assisted")) {
            window.dispatchEvent(new Event("sp-agent:approval-requested"));
          }
          const degraded = event.result.degradedReason ? `\n\n降级原因：${event.result.degradedReason}` : "";
          const finalText = `${event.result.content}${degraded}`;
          const artifacts = event.result.artifacts ?? [];
          if (finalText !== visibleText || artifacts.length > 0) {
            yield {
              content: [{ type: "text", text: finalText }],
              metadata: { custom: { source: "agent.messages.stream", artifacts } }
            } as never;
          }
          if (!sessionId) await updateSessionTitle(event.sessionId, makeThreadTitle(content));
        }
      }
    }),
    []
  );
  return useRemoteThreadListRuntime({
    adapter: assistantThreadListAdapter,
    runtimeHook: () => useLocalRuntime(adapter)
  });
}
