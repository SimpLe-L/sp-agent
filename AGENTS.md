# AGENTS.md

## Product Boundary

This repository is a local-first, chat-first personal agent platform. Its default product mode is a trusted local development agent: users can install complete third-party Skill packages, inspect and use their references, and let the agent perform ordinary local development work without repeated approval prompts.

The extension/runtime architecture remains general-purpose. `personal.research` is a supported Skill rather than the product boundary. Old Web3 surfaces remain out of scope.

## Active Workspace

- `apps/api`: NestJS local API gateway and control plane.
- `apps/web`: React/assistant-ui renderer.
- `apps/desktop`: Electron shell and API child process orchestration.
- `packages/shared`: shared Zod schemas and TypeScript contracts.
- `packages/extensions`: local skill/connector registry and permission metadata.
- `packages/agent-runtime`: runtime adapter registry; Pi is the default adapter.
- `packages/speech`: STT/TTS provider contracts and adapters.

## Architecture Rules

- The local API gateway owns permissions, persistence, audit events, provider readiness, approval execution, memory, workflows, and tool execution.
- Agent runtimes may propose or request tool calls; they must not own privileged app behavior.
- Skill packages may contain scripts, references, templates, and static assets. Importing a package never executes it; subsequent execution must use an explicit local capability.
- All capabilities enter through `packages/extensions`, declare typed input/output, return `permissionAudit`, and degrade explicitly when unavailable.
- Normal local reads, writes, provider calls, and package operations execute directly and remain auditable. Approval is reserved for credentials/secrets, private keys, external account actions, payments, and irreversible destructive operations.
- Memory is app-owned, searchable, auditable, and reversible. Trusted local mode permits ordinary memory writes without a per-operation approval.
- Research claims must be evidence-backed. Preserve source identity, source type, excerpt or locator, retrieval time, and confidence; surface insufficient or conflicting evidence instead of inventing a conclusion.
- Research workflows execute in the API control plane. A runtime may request a scoped research capability, but it must not fetch sources, persist reports, or promote research findings by itself.
- Remote retrieval and provider calls are allowed in trusted local mode and must retain an audit record. Credentialed connectors and external account mutations remain approval-gated.
- Voice is a chat interaction layer: microphone capture -> STT -> normal agent turn with memory/tools -> TTS -> playback. Do not place speech provider logic inside runtime adapters.
- LangGraph may be introduced later inside a skill/workflow adapter, but it must not bypass the API gateway, permission model, memory layer, or extension registry.

## Renderer Rules

- Keep `apps/web/src/main.tsx` bootstrap-only: router creation, root render, and global style import.
- Put shell/runtime/panel code under `apps/web/src/app` and `apps/web/src/components/app`.
- Use assistant-ui primitives for chat state where possible.
- Use shadcn/base UI and Tailwind utility classes before adding custom CSS.
- Keep the first screen compact and chat-first; Agent-selected Skills run from normal conversation. Memory, approvals, skills, workflows, and voice remain small review/configuration surfaces, not per-Skill launch flows or a separate dashboard.
- Preserve stable `data-testid` anchors when changing shell navigation or core review panels.

## Safety Rules

- Do not store or request private keys.
- Do not store or request private keys. Wallet transactions, swaps, transfers, posting automation, payments, credential use, and irreversible destructive actions remain approval-gated.
- Do not invent provider results, personal memory, or external data. Missing data must be surfaced as a degraded reason.
- Memory entries must preserve provenance when available. Durable preferences, identity facts, project facts, promotion/update/merge/forget, and conflict resolution must be auditable.
- Raw audio is not persisted unless the product explicitly adds a setting and retention policy.

## Development Rules

- Prefer small typed modules and shared schemas in `packages/shared`.
- Keep `ARCHITECTURE.md` focused on boundaries and contracts, not implementation history.
- When adding a capability, register it in `packages/extensions` before making it a first-class agent skill.
- Expand project access through typed trusted-local workspace capabilities rather than a static allowlist.
- Keep research evidence-backed when it makes factual claims, while allowing trusted-local Skills to use their configured local and remote capabilities.
- Run `pnpm typecheck` and `pnpm build` before handing off a broad change.

## Priority Order

1. Deliver a capable trusted-local development agent with complete third-party Skill packages.
2. Keep credentials, external account actions, destructive operations, and audit history explicit.
3. Expand skills and workflows through typed local capabilities without per-action friction.
4. Keep research and voice as useful Skills, not gating architecture.
