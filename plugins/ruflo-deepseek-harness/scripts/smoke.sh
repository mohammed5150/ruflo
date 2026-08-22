#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json has required fields"
if node -e "
  const m = require('$ROOT/.claude-plugin/plugin.json');
  if (!m.name || !m.description || !m.version) process.exit(1);
  if (!m.author || !m.author.name) process.exit(1);
  if (m.name !== 'ruflo-deepseek-harness') process.exit(1);
" 2>/dev/null; then ok; else bad "manifest missing/invalid required fields"; fi

step "2. both skills present with valid frontmatter"
miss=""
for s in deepseek-chat deepseek-reason; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss $s(absent)"; continue; }
  head -1 "$f" | grep -q '^---$' || miss="$miss $s(no-frontmatter)"
  grep -q "^name: $s" "$f" || miss="$miss $s(name-mismatch)"
  grep -q '^allowed-tools:' "$f" || miss="$miss $s(no-allowed-tools)"
done
[[ -z "$miss" ]] && ok || bad "skills:$miss"

step "3. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

step "4. all three scripts parse (node --check)"
miss=""
for js in _deepseek.mjs chat.mjs reason.mjs; do
  node --check "$ROOT/scripts/$js" 2>/dev/null || miss="$miss $js"
done
[[ -z "$miss" ]] && ok || bad "syntax:$miss"

step "5. chat.mjs degrades gracefully without DEEPSEEK_API_KEY (exit 0, status:degraded)"
out=$(env -u DEEPSEEK_API_KEY node "$ROOT/scripts/chat.mjs" --prompt smoke 2>/dev/null)
rc=$?
if [[ $rc -eq 0 ]] && printf '%s' "$out" | grep -q '"status": "degraded"'; then ok
else bad "rc=$rc, envelope missing status:degraded"; fi

step "6. reason.mjs degrades gracefully without DEEPSEEK_API_KEY"
out=$(env -u DEEPSEEK_API_KEY node "$ROOT/scripts/reason.mjs" --prompt smoke 2>/dev/null)
rc=$?
if [[ $rc -eq 0 ]] && printf '%s' "$out" | grep -q '"status": "degraded"'; then ok
else bad "rc=$rc, envelope missing status:degraded"; fi

step "7. --alert-on-error exits 1 on degraded"
env -u DEEPSEEK_API_KEY node "$ROOT/scripts/chat.mjs" --prompt smoke --alert-on-error >/dev/null 2>&1
[[ $? -eq 1 ]] && ok || bad "expected exit 1 with --alert-on-error and no key"

step "8. agent and command docs present"
miss=""
[[ -f "$ROOT/agents/deepseek-architect.md" ]] || miss="$miss agents/deepseek-architect.md"
[[ -f "$ROOT/commands/ruflo-deepseek-harness.md" ]] || miss="$miss commands/ruflo-deepseek-harness.md"
[[ -z "$miss" ]] && ok || bad "missing:$miss"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
