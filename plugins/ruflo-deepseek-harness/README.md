# ruflo-deepseek-harness

DeepSeek model harness for ruflo — one-shot completions against DeepSeek's
OpenAI-compatible `/v1/chat/completions` endpoint, in the same
subprocess-invocation shape as the other `ruflo-*-harness` plugins.

## Skills

| Skill | Model | Use for |
|-------|-------|---------|
| `deepseek-chat` | `deepseek-chat` | Cheap, fast non-reasoning completions — summarization, extraction, quick classification |
| `deepseek-reason` | `deepseek-reasoner` (R1) | Multi-step reasoning — proofs, plans, root-cause analysis. Surfaces the chain-of-thought (`reasoning_content`) separately from the final answer |

## Setup

Export a DeepSeek API key (get one at https://platform.deepseek.com):

```bash
export DEEPSEEK_API_KEY=sk-...
```

Without the key, both scripts emit a `{ "status": "degraded", ... }` JSON
envelope and exit 0 (ADR-150-style graceful degradation) — this plugin never
becomes a hard runtime dependency of ruflo. Pass `--alert-on-error` to exit 1
on degraded/error status instead (CI-friendly).

## Usage

```bash
# Non-reasoning completion
node plugins/ruflo-deepseek-harness/scripts/chat.mjs \
  --prompt "In one sentence: what is HNSW?" --temperature 0.2

# Reasoning completion with visible chain-of-thought
node plugins/ruflo-deepseek-harness/scripts/reason.mjs \
  --prompt "Why does this deadlock?" --show-reasoning
```

`--format table` prints only the content (for piping); `--format json`
(default) returns the full envelope with usage counters. Reasoner calls
ignore `temperature`/`top_p` per DeepSeek's spec for reasoner models.

## Structure

```
.claude-plugin/plugin.json   # manifest
agents/deepseek-architect.md # agent definition
commands/ruflo-deepseek-harness.md
skills/deepseek-chat/SKILL.md
skills/deepseek-reason/SKILL.md
scripts/_deepseek.mjs        # shared API helper (60s timeout, degraded envelopes)
scripts/chat.mjs             # deepseek-chat wrapper
scripts/reason.mjs           # deepseek-reasoner wrapper
scripts/smoke.sh             # structural contract (run by all-plugins-smoke CI)
```

## License

MIT
