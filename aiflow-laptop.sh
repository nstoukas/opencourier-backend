#!/usr/bin/env bash
#
# aiflow-laptop.sh — OpenCourier Co-op pipeline (Antigravity CLI edition)
#
#   PLAN     -> Claude Fable 5               : architecture & reasoning
#               (falls back to Claude Opus 5 if Fable produces no plan)
#   EXECUTE  -> agy (Antigravity CLI)        : implementation
#   EXPLAIN  -> agy                          : teaches YOU the diff
#   TEST     -> agy                          : Jest test generation + run
#   REVIEW   -> Claude (read-only)           : skeptical CROSS-MODEL review
#   FIX      -> agy                          : apply review findings
#               (--escalate -> Claude fixes instead)
#
# Antigravity CLI (agy) replaced Gemini CLI in June 2026; auth is `agy auth login`
# with your Google account (AI Pro). GEMINI_API_KEY is ignored by agy.
#
# Run from INSIDE opencourier-backend (a git repo). The workspace rulebook lives one
# level up (../CLAUDE.md), alongside ../agents.md and ../memory.md.
#
# First time: ./aiflow-laptop.sh doctor
#
set -euo pipefail

### ---- Config (override via environment) -------------------------------------
PLAN_MODEL="${PLAN_MODEL:-claude-fable-5}"       # most capable model; planning only
PLAN_FALLBACK_MODEL="${PLAN_FALLBACK_MODEL:-claude-opus-5}"  # used if PLAN_MODEL fails
REVIEW_MODEL="${REVIEW_MODEL:-claude-sonnet-4-6}"
FIX_MODEL="${FIX_MODEL:-claude-sonnet-4-6}"      # used only with --escalate
AGY_MODEL="${AGY_MODEL:-}"                       # empty = agy's default model
AGY_TIMEOUT="${AGY_TIMEOUT:-30m}"                # agy --print-timeout (its default, 5m, is too short)
TEST_CMD="${TEST_CMD:-yarn test}"                # backend uses yarn, not npm
MAX_ITERS="${MAX_ITERS:-2}"

RULES_FILE="../CLAUDE.md"                        # workspace-root rulebook
WORKDIR=".aiflow"
PLAN_FILE="plan.md"
REVIEW_FILE="$WORKDIR/review.md"
EXPLAIN_FILE="$WORKDIR/explanation.md"
DIFF_FILE="$WORKDIR/changes.diff"
TESTOUT_FILE="$WORKDIR/test-output.txt"

AUTO=0; FORCE=0; ESCALATE=0
### ---------------------------------------------------------------------------

c_info() { printf '\033[1;36m>> %s\033[0m\n' "$*"; }
c_warn() { printf '\033[1;33m!! %s\033[0m\n' "$*" >&2; }
c_err()  { printf '\033[1;31mXX %s\033[0m\n' "$*" >&2; }
need()   { command -v "$1" >/dev/null 2>&1 || { c_err "Required command not found: $1"; exit 1; }; }

confirm() {
  [ "$AUTO" = 1 ] && return 0
  read -rp "$(printf '\033[1;35m?? %s [y/N] \033[0m' "$1")" ans
  [[ "$ans" =~ ^[Yy]$ ]]
}

# agy invocations. Flag names drift between releases (--yolo -> --headless/--approve ->
# the current set below). If a call errors on a flag, run `agy --help` and adjust ONLY here.
#   -p                             non-interactive single prompt (this IS "headless")
#   --mode accept-edits | plan     accept-edits = may write; plan = read-only
#   --dangerously-skip-permissions the current spelling of the old "--approve all"
#   --print-timeout                agy defaults to 5m, too short for a multi-step plan
agy_write() {  # write-enabled agent run (execute/test/fix)
  local m=(); [ -n "$AGY_MODEL" ] && m=(--model "$AGY_MODEL")
  agy --mode accept-edits --dangerously-skip-permissions \
      --print-timeout "$AGY_TIMEOUT" "${m[@]}" -p "$1" < /dev/null
}
agy_read() {   # read-only run whose stdout we capture (explain)
  # --mode plan keeps it read-only; --dangerously-skip-permissions is still required,
  # because headless mode cannot prompt for the read/command permissions the prompt
  # needs and auto-DENIES them, which yields an empty response rather than an error.
  local m=(); [ -n "$AGY_MODEL" ] && m=(--model "$AGY_MODEL")
  agy --mode plan --dangerously-skip-permissions \
      --print-timeout "$AGY_TIMEOUT" "${m[@]}" -p "$1" < /dev/null
}

preflight() {
  need git; need claude; need agy
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { c_err "Not inside a git repository. cd into opencourier-backend first."; exit 1; }
  [ -f "$RULES_FILE" ] || c_warn "No $RULES_FILE found — the models lose the workspace rulebook!"
  mkdir -p "$WORKDIR"
}

### ---- doctor -----------------------------------------------------------------

do_doctor() {
  local ok=1
  c_info "Checking prerequisites..."
  for cmd in git node yarn claude agy; do
    if command -v "$cmd" >/dev/null 2>&1; then echo "  [ok] $cmd"; else echo "  [MISSING] $cmd"; ok=0; fi
  done

  c_info "Checking location..."
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "  [ok] inside a git repo"; else echo "  [FAIL] not a git repo — cd into opencourier-backend"; ok=0; fi
  [ -f "$RULES_FILE" ] && echo "  [ok] workspace rulebook at $RULES_FILE" || { echo "  [MISSING] $RULES_FILE — the merged CLAUDE.md belongs at the workspace root"; ok=0; }
  [ -f "../memory.md" ] && echo "  [ok] ../memory.md present" || echo "  [WARN] no ../memory.md cross-repo state file"
  [ -f package.json ] && echo "  [ok] package.json present" || echo "  [WARN] no package.json — is this the backend repo?"

  c_info "Checking agy responds non-interactively (stdout-drop check)..."
  local probe
  probe=$(agy -p "Reply with exactly: OK" < /dev/null 2>/dev/null || true)
  if printf '%s' "$probe" | grep -q "OK"; then
    echo "  [ok] agy -p returns output under a pipe"
  else
    echo "  [WARN] agy -p returned no usable output. Either auth is missing (run: agy auth login)"
    echo "         or this agy version drops stdout when piped — test manually: agy -p \"say OK\""
    ok=0
  fi

  if [ -n "${GEMINI_API_KEY:-}" ]; then
    echo "  [note] GEMINI_API_KEY is set but agy IGNORES it — safe to remove from your shell profile."
  fi

  c_info "Checking internet (this pipeline is cloud-only)..."
  if curl -fsS --max-time 8 https://api.anthropic.com >/dev/null 2>&1 || curl -fsS --max-time 8 https://www.google.com >/dev/null 2>&1; then
    echo "  [ok] online"
  else
    echo "  [FAIL] no internet — every phase needs connectivity"; ok=0
  fi

  if [ "$ok" = 1 ]; then c_info "All checks passed. Try:  ./aiflow-laptop.sh plan \"your first small task\""
  else c_warn "Fix the items above, then re-run:  ./aiflow-laptop.sh doctor"; fi
}

### ---- Prompt templates ---------------------------------------------------------

plan_prompt() { cat <<EOF
You are the PLANNING model for the OpenCourier Co-op backend. Do NOT write code.

Task: $1

First read ../CLAUDE.md (the workspace rulebook: co-op values, locked decisions, domain
language, commands, boundaries) and skim ../memory.md (cross-repo state: the deviation
ledger, active environment configuration, and work not yet committed). For the history
of a specific file, read git log rather than ../memory.md.

Then explore this repository as needed and produce a precise, self-contained
implementation plan that a TypeScript BEGINNER operator can read, and that a different
model (Antigravity/Gemini) will implement literally.

The plan must:
- Confirm the task complies with ../CLAUDE.md; if it conflicts with a locked decision,
  STOP and output the conflict instead of a plan.
- Number each step; keep every step small (one file / one concern where possible).
- For each step: exact file paths, the functions/symbols to add or change, intended
  behavior, and WHICH LAYER (domains/persistence/restapi/services/integrations).
- Note where a DeliveryEvent must be emitted for pay- or assignment-relevant changes.
- Keep fairness/matcher parameters in configuration, never hard-coded.
- State assumptions explicitly. Prefer pure functions the operator can read and test.
- End with "## Test Plan": specific Jest cases that must pass (run via: yarn test).
- After the Test Plan, add "## For the operator": 3-6 plain-language sentences on what
  this change does and why it's shaped this way.

Output ONLY the plan in Markdown; it will be saved as plan.md.
EOF
}

execute_prompt() { cat <<'EOF'
You are the EXECUTION model. Implement the plan in plan.md exactly.

Rules:
- Read ../CLAUDE.md first; it wins over the plan if they conflict — in a conflict,
  stop and report instead of improvising.
- Follow plan.md's numbered steps in order. Do NOT redesign.
- Domain language exactly: Delivery, DeliveryEvent, DeliveryQuote. Put code in the
  layer the plan names; copy patterns from a neighbouring file in that layer.
- Keep TypeScript simple: plain interfaces, small functions, no clever generics.
  One-line plain-language comment above any NestJS idiom (decorator, DTO, guard).
- If a step is impossible, make the minimal reasonable change and add a
  "// AIFLOW-NOTE:" comment explaining why.
- Do NOT write or modify tests — that happens in a separate phase.
- Respect ../CLAUDE.md Boundaries: no applied-migration edits, no Stripe pin bump,
  no env/secrets, no lockfile regeneration, no hand-edits to the generated SDK.
- When finished: print a bullet summary of every file changed and why.
- ../memory.md is NOT a changelog — git history is. Do not append a dated entry.
  Edit it only in these two cases:
    * You deviated from a locked decision in ../CLAUDE.md -> add one row to the
      "Deviation ledger" table (what / where / why). Leave the Commit column empty;
      the operator fills it in after committing.
    * You changed environment configuration -> update "Active configuration",
      recording the variable NAME and where its value lives, never the value itself.
EOF
}

explain_prompt() { cat <<'EOF'
You are the TEACHING model. The operator has general coding knowledge but does NOT
know TypeScript or NestJS. The diff of the latest implementation is in
.aiflow/changes.diff.

Read plan.md, .aiflow/changes.diff, and any files the diff touches, then write a
beginner-friendly walkthrough in Markdown:

1. "What changed and why" — 3-5 plain sentences tying the diff to the plan.
2. "File by file" — for each changed file: its role in the system, what the change
   adds, and line-by-line explanation of unfamiliar TypeScript/NestJS syntax
   (decorators, DTOs, dependency injection, async/await, Prisma calls), with analogies
   to general programming concepts.
3. "How this serves the co-op" — connect to transparency/fairness/safety values where
   relevant (e.g. where a DeliveryEvent is emitted and what members can audit).
4. "Questions to check your understanding" — 3 short questions, answers at the end.

Output ONLY the walkthrough in Markdown. Be concrete and unhurried.
EOF
}

testgen_prompt() { cat <<'EOF'
You are the TESTING model. Do NOT modify application/source code — only test files.

1. Read ../CLAUDE.md, plan.md (especially "## Test Plan"), and the implementation.
2. Write or update Jest tests covering every Test Plan case, following this repo's
   existing test conventions and placement (*.spec.ts — check a neighbouring example).
3. Cover happy paths, edge cases, and at least one failure case per feature. For pay-
   or assignment-relevant logic, assert the DeliveryEvent is emitted.
4. Keep tests readable for a beginner: descriptive names, minimal mocking magic,
   one-line comments for non-obvious setup.

Then print the list of test files created/modified and what each covers.
EOF
}

review_prompt() { cat <<'EOF'
You are an INDEPENDENT REVIEWER from a different model family than the one that wrote
this code (Antigravity/Gemini implemented it; you are Claude). Be skeptical and
specific — your value is catching what the executor's own checks would miss.

Read:
- ../CLAUDE.md            (binding workspace rules and co-op values)
- .aiflow/changes.diff    (the implementation diff)
- .aiflow/test-output.txt (test run output, if present)
- plan.md                 (intended behavior)

Produce a Markdown review:
1. Correctness — does the diff satisfy plan.md? List any planned step not met.
2. CLAUDE.md compliance — flag ANY violation: wrong domain language, hard-coded
   fairness parameters, missing DeliveryEvent for pay-relevant changes, edits to
   applied migrations / Stripe pin / secrets / generated SDK / lockfiles, code in the
   wrong layer, or needlessly clever TypeScript a beginner can't read.
3. Bugs & risks — concrete issues with file:line and a suggested fix.
4. Test gaps — Test Plan cases or edge cases not covered; flag any test written to
   pass rather than to verify behavior.
5. Verdict — SHIP or FIX-NEEDED, plus the top 3 must-fix items (if any).

Do not rewrite the code; just review.
EOF
}

fix_prompt() { cat <<'EOF'
You are the FIX model. Address the review findings without scope creep.

Read:
- ../CLAUDE.md       (binding rules — violations flagged in the review MUST be fixed)
- .aiflow/review.md  (issues to fix, in priority order)
- plan.md            (original intent — do not deviate)

For each must-fix item: apply the smallest change that resolves it; do NOT refactor
unrelated code. If the reviewer is mistaken, leave the code as-is and add a one-line
"// AIFLOW-NOTE:" explaining why.

When done: print a bullet list mapping each review item to the fix made (or why
skipped). Do not append a dated entry to ../memory.md — git history is the changelog.
Touch ../memory.md only if a fix introduced a new deviation from ../CLAUDE.md (add a
row to the "Deviation ledger") or changed environment configuration.
EOF
}

### ---- Phases --------------------------------------------------------------------

# Capture the working diff for the explain/review phases.
# `git diff` only shows TRACKED files, so brand-new files — often the most important
# ones — would be invisible to the reviewer. Append each untracked file as a diff
# against /dev/null. Uses --no-index so the index is never touched (staging new files
# here would risk them being committed empty).
capture_diff() {
  git diff > "$DIFF_FILE"
  local f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    git diff --no-index -- /dev/null "$f" >> "$DIFF_FILE" 2>/dev/null || true
  done < <(git ls-files --others --exclude-standard)
}

# Print whatever the failed call told us. The CLI reports some errors (bad model,
# quota) on stdout rather than stderr, so fall back to stdout when stderr is empty.
show_failure() {
  local out="$1" err="$2"
  if [ -s "$err" ]; then sed 's/^/    /' "$err" >&2
  elif [ -s "$out" ]; then head -20 "$out" | sed 's/^/    /' >&2
  else printf '    (no output on stdout or stderr)\n' >&2
  fi
}

# Run the planner on one model. stdout -> $2, stderr -> $3, returns claude's exit code.
run_planner() {
  local model="$1" out="$2" err="$3"
  claude -p "$(plan_prompt "$TASK")" \
    --model "$model" \
    --permission-mode plan > "$out" 2> "$err"
}

do_plan() {
  [ -n "${TASK:-}" ] || { c_err "Provide a task, e.g.:  ./aiflow-laptop.sh plan \"add a GET /courier/earnings-summary endpoint\""; exit 1; }
  local tmp_out="$WORKDIR/plan.out" tmp_err="$WORKDIR/plan.err" rc

  c_info "PLAN — Claude ($PLAN_MODEL, read-only plan mode)"
  set +e; run_planner "$PLAN_MODEL" "$tmp_out" "$tmp_err"; rc=$?; set -e

  # Any failure falls back — we can't reliably tell "out of credits" from an auth
  # or network error without guessing at the CLI's error strings, so the error is
  # printed and the fallback model gets a turn regardless of cause.
  if [ "$rc" -ne 0 ] || [ ! -s "$tmp_out" ]; then
    c_warn "$PLAN_MODEL produced no plan (exit $rc). Error was:"
    show_failure "$tmp_out" "$tmp_err"
    c_warn "Falling back to $PLAN_FALLBACK_MODEL."
    set +e; run_planner "$PLAN_FALLBACK_MODEL" "$tmp_out" "$tmp_err"; rc=$?; set -e
    if [ "$rc" -ne 0 ] || [ ! -s "$tmp_out" ]; then
      c_err "$PLAN_FALLBACK_MODEL also failed (exit $rc):"
      show_failure "$tmp_out" "$tmp_err"
      c_err "No plan written — $PLAN_FILE left as it was."
      exit 1
    fi
    c_info "Plan produced by fallback model $PLAN_FALLBACK_MODEL."
  fi

  # Only overwrite plan.md once we have a non-empty plan in hand.
  mv "$tmp_out" "$PLAN_FILE"
  rm -f "$tmp_err"
  c_info "Plan written to $PLAN_FILE"
  c_info "READ IT — especially '## For the operator'. Edit anything unclear before executing."
}

do_execute() {
  [ -f "$PLAN_FILE" ] || { c_err "No $PLAN_FILE found. Run:  ./aiflow-laptop.sh plan \"...\"  first."; exit 1; }
  if ! { git diff --quiet && git diff --cached --quiet; }; then
    c_warn "Working tree is not clean — commit or stash so AI changes are reviewable via 'git diff'."
    [ "$FORCE" = 1 ] || { c_err "Or pass --force to override."; exit 1; }
  fi
  c_info "EXECUTE — agy implements plan.md (auto-approved writes; clean git tree is your undo)"
  agy_write "$(execute_prompt)"
  capture_diff
  c_info "Execution complete. Inspect with:  git diff   (also saved to $DIFF_FILE)"
}

do_explain() {
  capture_diff
  [ -s "$DIFF_FILE" ] || { c_err "No changes to explain — run the execute phase first."; exit 1; }
  c_info "EXPLAIN — agy writes a beginner walkthrough of the diff"
  agy_read "$(explain_prompt)" > "$EXPLAIN_FILE" || true
  if [ -s "$EXPLAIN_FILE" ]; then
    c_info "Walkthrough written to $EXPLAIN_FILE — your learning material. Read it before tests."
  else
    c_warn "agy returned no output — read ITS error above, don't assume a cause."
    c_warn "Common ones: a tool permission was auto-denied in headless mode (add"
    c_warn "--dangerously-skip-permissions to agy_read), or this version drops stdout"
    c_warn "under a pipe. To check the latter:  agy -p \"say OK\" | cat"
  fi
}

run_suite() {
  c_info "Running test suite: $TEST_CMD"
  set +e
  eval "$TEST_CMD" 2>&1 | tee "$TESTOUT_FILE"
  local rc=${PIPESTATUS[0]}
  set -e
  c_info "Test command exit code: $rc"
  return 0
}

do_test() {
  c_info "TEST — agy writes Jest tests (auto-approved writes)"
  agy_write "$(testgen_prompt)"
  run_suite
}

do_review() {
  c_info "REVIEW — Claude ($REVIEW_MODEL) cross-model pass, read-only"
  capture_diff
  [ -f "$TESTOUT_FILE" ] || echo "(no test output captured)" > "$TESTOUT_FILE"
  claude -p "$(review_prompt)" \
    --model "$REVIEW_MODEL" \
    --permission-mode plan > "$REVIEW_FILE"
  c_info "Review written to $REVIEW_FILE"
  echo "----------------------------------------------------------------------"
  cat "$REVIEW_FILE"
  echo "----------------------------------------------------------------------"
}

do_fix() {
  [ -f "$REVIEW_FILE" ] || { c_err "No $REVIEW_FILE found. Run the review phase first."; exit 1; }
  if [ "$ESCALATE" = 1 ]; then
    c_info "FIX — escalated to Claude ($FIX_MODEL)"
    claude -p "$(fix_prompt)" --model "$FIX_MODEL" --permission-mode acceptEdits
  else
    c_info "FIX — agy applies the review findings"
    agy_write "$(fix_prompt)"
  fi
  c_info "Fix pass complete. Inspect with:  git diff"
}

verdict_fix_needed() { grep -qi 'FIX-NEEDED' "$REVIEW_FILE" 2>/dev/null; }

do_all() {
  do_plan
  confirm "Plan looks good — proceed to EXECUTE with agy?" || { c_info "Stopped after planning."; exit 0; }
  do_execute
  do_explain
  confirm "Read $EXPLAIN_FILE? Proceed to TEST (agy writes tests, then '$TEST_CMD')?" || { c_info "Stopped after explain."; exit 0; }
  do_test
  do_review

  local iter=1
  while verdict_fix_needed; do
    if [ "$iter" -gt "$MAX_ITERS" ]; then
      c_warn "Still FIX-NEEDED after $MAX_ITERS automatic cycle(s). Stopping — read $REVIEW_FILE and decide."
      break
    fi
    c_warn "Verdict: FIX-NEEDED (auto-fix cycle $iter/$MAX_ITERS)"
    confirm "Run an automatic fix pass and re-check?" || { c_info "Stopped before fix cycle $iter."; break; }
    do_fix
    run_suite
    do_review
    iter=$((iter+1))
  done

  if verdict_fix_needed; then c_warn "Final verdict: FIX-NEEDED — see $REVIEW_FILE"
  else c_info "Final verdict: SHIP (or no blocking issues). Commit when you've read the diff and $EXPLAIN_FILE."; fi
}

usage() { cat <<EOF
aiflow-laptop.sh — OpenCourier Co-op pipeline (Antigravity CLI edition)
  plan+review: Claude · execute+explain+test+fix: agy (Antigravity, AI Pro account)

USAGE:
  ./aiflow-laptop.sh <phase> [task] [flags]

PHASES:
  doctor          Check the setup (run this first!)
  plan "<task>"   Claude produces plan.md (read-only; plain-language summary included)
  execute         agy implements plan.md
  explain         agy writes a beginner walkthrough -> .aiflow/explanation.md
  test            agy writes Jest tests, then runs \$TEST_CMD (yarn test)
  review          Claude cross-model review vs ../CLAUDE.md -> .aiflow/review.md
  fix             agy applies review findings (--escalate: Claude fixes)
  all "<task>"    Full loop: plan -> execute -> explain -> test -> review -> auto-fix

FLAGS:
  --auto          Skip confirmations          --force        Allow dirty working tree
  --escalate      Fixes on Claude             --max-iters N  Max auto fix cycles ($MAX_ITERS)
  --test-cmd "X"  Override test command

EXAMPLES:
  ./aiflow-laptop.sh doctor
  ./aiflow-laptop.sh all "add GET /courier/earnings-summary returning per-day piece-rate totals"
  ./aiflow-laptop.sh fix --escalate

Notes:
  - Run from inside opencourier-backend; the rulebook is ../CLAUDE.md (workspace root).
  - Cross-model integrity: agy writes, Claude reviews. Keep it that way.
  - agy flags drift between releases (--yolo -> --headless/--approve). If a call errors,
    check 'agy --help' and adjust ONLY the agy_write/agy_read helpers near the top.
EOF
}

### ---- Dispatch --------------------------------------------------------------------

CMD="${1:-help}"; shift || true
TASK=""
while [ $# -gt 0 ]; do
  case "$1" in
    --auto)      AUTO=1 ;;
    --force)     FORCE=1 ;;
    --escalate)  ESCALATE=1 ;;
    --max-iters) MAX_ITERS="${2:-2}"; shift ;;
    --test-cmd)  TEST_CMD="${2:-}"; shift ;;
    -h|--help)   usage; exit 0 ;;
    *)           TASK="${TASK:+$TASK }$1" ;;
  esac
  shift
done

case "$CMD" in
  doctor)  do_doctor ;;
  plan)    preflight; do_plan ;;
  execute) preflight; do_execute ;;
  explain) preflight; do_explain ;;
  test)    preflight; do_test ;;
  review)  preflight; do_review ;;
  fix)     preflight; do_fix ;;
  all)     preflight; do_all ;;
  help|-h|--help) usage ;;
  *)       c_err "Unknown phase: $CMD"; echo; usage; exit 1 ;;
esac
