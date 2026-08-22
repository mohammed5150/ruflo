---
name: dual-mode
description: Orchestrate Claude Code and headless OpenAI Codex workers together on one task with shared memory coordination. Use when spawning parallel Codex workers from Claude Code, coordinating hybrid Claude+Codex pipelines (architect/coder/tester/reviewer across both platforms), or collecting results from background Codex workers. Covers the dual-spawn, dual-coordinate, and dual-collect workflows and the claude-flow-codex CLI.
---

# Dual-Mode Orchestration (Claude Code + Codex)

Run Claude Code (interactive) and OpenAI Codex (headless) workers in parallel on
one task, coordinated through a shared memory namespace. Claude typically takes
architecture, security, and testing roles; Codex takes implementation and
optimization roles.

## Workflows

Each workflow has a detailed reference file in this directory. Read the one that
matches the task:

| Workflow | File | Purpose |
|----------|------|---------|
| Spawn | [dual-spawn.md](./dual-spawn.md) | Spawn headless Codex workers from Claude Code |
| Coordinate | [dual-coordinate.md](./dual-coordinate.md) | Coordinate hybrid Claude+Codex pipelines with dependency levels |
| Collect | [dual-collect.md](./dual-collect.md) | Collect results from headless workers |

## Quick start

```bash
# Spawn 3 headless Codex workers in the background
npx claude-flow-codex dual run --worker 'codex:coder:Implement the auth module' --namespace collaboration

# Run a pre-built collaboration template
npx claude-flow-codex dual run feature --task "Add user authentication with OAuth"

# Check collaboration status
npx claude-flow-codex dual status
```

Workers share state via the `collaboration` memory namespace:

```bash
npx claude-flow@latest memory store --namespace collaboration --key 'task-context' --value '[task]'
npx claude-flow@latest memory search --namespace collaboration --query 'authentication patterns'
```

See the repository `CLAUDE.md` section "Dual-Mode Collaboration" for the full
protocol, collaboration templates, and the programmatic `DualModeOrchestrator`
API in `@claude-flow/codex`.
