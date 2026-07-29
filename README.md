# SP Agent

SP Agent is a local-first desktop agent. It provides chat, voice, local workspace tools, document export, memory, workflows, custom Skill packages, and MCP servers through one auditable local runtime.

Normal local actions run directly in trusted-local mode. Credentials, external account changes, payments, private keys, and irreversible destructive operations require approval.

## Workspace

- `apps/api`: NestJS API and local capability host.
- `apps/web`: React chat interface.
- `apps/desktop`: Electron shell.
- `packages/extensions`: built-in tools, Skill packages, MCP metadata, and permissions.
- `packages/agent-runtime`: runtime adapters; Pi is the default.
- `packages/speech`: STT and TTS adapters.

## Start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open `http://127.0.0.1:5173`. Configure optional model and speech providers in `.env`.

## Verification

```bash
pnpm typecheck
pnpm build
```

The interview examples, including a custom Skill and weather MCP, are in [examples/INTERVIEW_DEMOS.md](examples/INTERVIEW_DEMOS.md).
