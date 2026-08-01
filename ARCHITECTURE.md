# ARCHITECTURE.md

## Product Boundary

SP Agent is a local-first, chat-first trusted development agent. Users chat normally, install complete third-party Skill packages, and let the local API execute ordinary development work without a per-action approval queue. `personal.research` is one reusable Skill, not the product boundary.

Importing a third-party package never executes its code. In trusted local mode, ordinary package reads, workspace writes, document exports, public-web retrieval, and provider calls run directly and remain auditable. Credentials, private keys, external account actions, payments, and irreversible destructive operations stay explicitly approval-gated.

## Runtime Shape

```text
Electron desktop shell
-> React renderer using assistant-ui
-> NestJS local API gateway
-> runtime adapter registry, Pi first
-> local Skill catalog, managed MCP servers, and API-owned tool execution
-> approvals, persistence, audit, and speech
```

The API gateway is the local capability host and control plane, not a per-action approval gate. It owns Skill import, validation, enablement, managed MCP lifecycle, typed tool execution, approvals, SQLite-backed persistence, provider readiness, and persistent capability audit. Runtime adapters produce assistant turns and request typed tools; they do not execute privileged app behavior directly. This keeps a third-party Runtime, Skill, or MCP transport from silently widening its own filesystem, process, credential, or account access while ordinary trusted-local work remains frictionless.

The desktop shell generates a bearer token for its API child process. The API binds only to `127.0.0.1`, restricts CORS to the renderer origin when supplied, and rejects unauthenticated requests in desktop mode.

## Agent Run Harness

Each chat turn is an API-owned `AgentRun`, rather than an opaque model request. After the API compiles bounded conversation history, memory references, enabled Skills, and visible capabilities, it persists a context manifest and a chronological event trace. The trace records Run start, context compilation, requested and completed tools, runtime outcome, and terminal status. It stores capability names and safe summaries rather than duplicating raw conversation, credentials, or tool payloads.

```text
chat turn
-> context manifest and fixed capability grant
-> AgentRun started
-> runtime / Skill / MCP tool requests
-> tool completion events and capability audit
-> runtime result
-> completed, degraded, or failed AgentRun
```

Runs are retained locally in SQLite and exposed through the read-only Agent Runs viewer. This provides a focused debugging and interview surface for inspecting what the runtime was allowed to see, which tools it tried, and why a turn degraded, without granting a runtime ownership of tool execution or persistence.

## Workspace

- `apps/api`: NestJS gateway and control plane.
- `apps/web`: assistant-ui chat shell and small review/configuration surfaces.
- `apps/desktop`: Electron shell and local API process orchestration.
- `packages/shared`: Zod schemas and shared TypeScript contracts.
- `packages/extensions`: built-in capability registry, tool metadata, and Skill-package validation.
- `packages/agent-runtime`: replaceable runtime adapters; Pi is the default.
- `packages/speech`: STT/TTS provider contracts and adapters.

## Chat-Native Skill Contract

The normal composer is the only primary invocation surface. A model receives a compact catalog of enabled Skills: id, description, typed input schema, and whether the Skill can use any API-owned tools. It selects a Skill as part of its normal tool-use turn. This selection is implicit planning; there is no required `planner service -> Skill -> Connector` pipeline and no separate planner model call.

```text
User message
-> runtime selects an enabled Skill or answers directly
-> API validates the Skill id, input, policy, and enabled state
-> API loads that Skill's instructions and bounded tool context
-> runtime may request only those API-owned tools
-> API executes/audits each request and returns typed results
-> runtime produces the chat reply and any inspectable artifact
```

The API may use deterministic routing only as an offline fallback and test aid. It must select from the same enabled catalog and invoke the same API path as the live runtime. A Skill is never selected by an arbitrary URL, provider name, filesystem path, or raw function name supplied by the model.

For phase one, `personal.research` may be an instruction-led local research Skill over explicitly supplied content. It must say when it lacks evidence. Source collection, citations, remote retrieval, and long-running workflows are optional capabilities added only when they have a concrete typed tool and test coverage.

## Local Skill Packages

A third-party Skill is a complete local package. Importing a package makes a staged copy under the app data directory; the original directory is never executed in place. The importer validates the package, records its content hash and origin path in the audit log, then lets the user enable or disable the imported version.

Phase-one package layout:

```text
my-skill/
  SKILL.md
  assets/                 # optional static prompt/reference assets
  skill.json              # optional app-specific metadata
```

`SKILL.md` is required. Its front matter supplies `name`, `description`, and optional `version`; this makes ordinary Codex-style Skills directly importable. `skill.json` is optional app-specific metadata for structured input, requested API tools, and output artifacts. The registry validates package size, asset paths, and any requested tool allowlist before import. Users may paste a public GitHub repository URL with an optional revision and Skill subdirectory; the API resolves the revision to an immutable commit, reads only `SKILL.md` and optional `skill.json`, and records that source in the audit log. Local-folder import remains a fallback.

Imported packages are complete local packages:

- package scripts, references, templates, and static assets are retained; installation never executes them; JavaScript scripts may run only through the typed OS-sandbox capability, with network denial, package-root file scope, timeout, and output bounds;
- symlinks and paths escaping the package root are rejected;
- a Skill may read its own package references on demand and use the local capabilities exposed to it;
- importing, enabling, disabling, and removing a package are auditable local actions.

This mirrors coding-agent Skills: instructions and references are loaded only when relevant, while importing never treats a package as automatically executable code.

## Tools, Extensions, And Approval

`packages/extensions` remains the app-owned registry for executable capabilities. Each tool has a typed input/output contract, permission metadata, an API handler, and a `permissionAudit` result. A Skill may request a registered tool; it may not call a provider or connector implementation itself.

Installed Skill files, user-selected local folders, and a user-submitted public GitHub repository import execute without a second approval prompt. Trusted local capabilities, including workspace writes, document exports, public-web retrieval, and provider calls, execute directly and are audited. `pending_approval` is reserved for credentials/secrets, private keys, external account actions, payments, and irreversible destructive operations. Approval execution stays in the API and matches the same tool identity and input.

`local.artifacts` is the first-party export boundary: it generates Markdown and CSV inside the configured workspace and returns delivery metadata without an approval prompt. Complete document Skills may generate DOCX, XLSX, or PDF via their retained scripts, but those scripts run through the bounded Skill sandbox. `remote.web` is the first-party public-web boundary: it searches and reads public HTTP(S) content with URL credential rejection, private-network denial, redirect validation, timeout and response-size limits, normalized text, source identity, retrieval time, content hash, and explicit degradation. Neither capability grants arbitrary shell access, arbitrary local paths, direct MCP transport access, or credential use.

Managed MCP servers are explicit local configuration. A server starts disabled, must be enabled before API-owned stdio discovery, and exposes discovered tools as dynamic Extension capabilities. The API runs each transport without inheriting desktop-process credentials, validates the supported JSON Schema subset, applies per-tool policy, and writes the same capability audit events used by built-in tools. Runtime adapters and Skills never start or connect to an MCP server directly.

"Connector" is an implementation term, not a required product layer. Keep a connector as a separate typed tool only when an external source has independent authentication, rate/size limits, provenance, or reuse across Skills. Local parsing helpers and single-Skill adapters should stay private to that Skill handler.

## First-Phase Scope

Required:

- built-in Skill catalog, chat selection, and typed invocation;
- complete-package import, validation, enable/disable, removal, reference loading, and audit;
- lazy Skill-instruction loading and manifest-derived bounded tool context;
- clear degraded states for unavailable Skills/tools;
- deterministic routing and import/validation smoke coverage.
- bounded public-web search and page reading with provenance and explicit degradation;
- workspace-scoped Markdown and CSV artifact export without per-export approval.

Explicitly deferred:

- a dedicated planner service or provider planner;
- credentialed connectors, authenticated remote retrieval, and provider-backed research synthesis;
- a marketplace and automatic package installation hooks;
- background research and unrestricted multi-agent delegation beyond the bounded code-change workflow.

## Memory, Research, And Workflows

Memory remains app-owned and auditable. The API retrieves only active, non-sensitive memories matching global or current-session scope, applies a bounded result budget, injects those citations into the Runtime context, and records the selected references with the assistant message. Durable writes enter as candidates and are auditable; Runtime adapters never write durable memory directly.

When evidence-backed research becomes necessary, implement it as a capability of `personal.research`, not a new mandatory routing architecture:

```text
personal.research instruction
-> request approved source tools through the API
-> normalize evidence and retain provenance
-> synthesize from collected evidence
-> validate citations and persist an inspectable artifact
```

Remote data and source-specific connectors require a concrete product need, source scope, provenance contract, degraded behavior, and deterministic fixtures. Public unauthenticated web retrieval is a trusted-local capability; credentialed retrieval and external account mutations require explicit approval. The bounded code-change workflow uses a LangGraph routing adapter for Planner, Inspector, Executor, Tester, and Reviewer transitions. SQLite persists its checkpoint; stale code-change runs resume from that checkpoint after API restart, while paused approval runs remain paused. LangGraph owns graph routing only: checkpoints, approvals, artifacts, filesystem, commands, and audit remain API-owned.

## Renderer Contract

- `apps/web/src/main.tsx` stays bootstrap-only.
- App/runtime/layout code lives under `apps/web/src/app` and `apps/web/src/components/app`.
- `/` and `/chat` render the chat-first shell.
- Skill catalog and import review are secondary configuration surfaces, not a required launcher for each Skill.
- Preserve stable `data-testid` anchors for route/shell smoke coverage.

## Safety Contract

- Do not store or request private keys.
- Do not store or request private keys. Wallet transactions, transfers, posting automation, payments, credential use, and irreversible destructive actions remain approval-gated.
- Do not invent tool, provider, memory, or external-data results. Missing capability is a visible degraded state.
- Raw audio is not persisted unless a later setting and retention policy explicitly allow it.

## Verification Strategy

Default checks:

```bash
pnpm typecheck
pnpm build
```

Use `pnpm typecheck` and `pnpm build` before releasing a change.
