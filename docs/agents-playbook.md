# Pyper — Multi-Agent Playbook

Practices and Claude Code configuration for running a fleet of parallel agents on this repo. The
*operational* rules live in the root [CLAUDE.md](../CLAUDE.md); this doc is the **why** behind them
plus the deeper practices.

Sources: Anthropic *Building Effective Agents* **[BEA]**, *How we built our multi-agent research
system* **[MAR]**, *Claude Code best practices* **[CCBP]**, Claude Code *subagents* **[SUB]** and
*worktrees* **[WT]** docs (links at the bottom).

## Rule zero

Build the simplest system that works; add agents/orchestration only when it demonstrably improves
outcomes. Multi-agent trades latency and cost (≈**15×** the tokens of a single chat [MAR]) for
capability — spend it only on work that is genuinely parallel, high-value, or exceeds one context
window. [BEA][MAR]

## Orchestration patterns — pick the most constrained that fits [BEA]

| Pattern | Use when |
|---|---|
| **Prompt chaining** (sequential steps + gates) | task decomposes cleanly into fixed subtasks |
| **Routing** (classify → dispatch) | distinct categories; route easy→Haiku, hard→Opus |
| **Parallelization / sectioning** | independent subtasks, run concurrently (one agent per module) |
| **Parallelization / voting** | same task N times, aggregate — high-stakes review (security) |
| **Orchestrator-workers** | lead dynamically splits/delegates/integrates — multi-file & open-ended |
| **Evaluator-optimizer** | a real check exists; generate → critique → loop |

**Our default:** orchestrator plans → independent slices → workers in parallel → lead integrates.
Reserve voting for correctness/security review, and keep tightly-coupled logic in **one** agent —
most coding parallelizes worse than research. [MAR]

## Context isolation [SUB][MAR]

Each subagent has its own context window, prompt, and tools. This compresses big problems (parallel
windows), reduces path-dependency (a fresh reviewer isn't biased toward code it just wrote), and
keeps verbose output (logs, test runs, exploration) out of the main window.

- One responsibility per subagent.
- A subagent does **not** see your history or CLAUDE.md — make the delegation prompt self-contained
  (restate constraints, name files, state what's out of scope).
- Return **summaries, not dumps** — specify the output contract.

## Verification — verify before you trust [CCBP]

> "Claude stops when the work looks done. Without a check it can run, 'looks done' is the only signal."

- Every worker gets a runnable check → the **`/verify`** skill (typecheck + lint + scoped desktop
  tests + renderer build). Never gate on root `npm run build` (that's electron-builder packaging).
- **Independent reviewer** on the diff in a fresh context → the **`reviewer`** subagent, scoped to
  correctness + stated requirements only (a reviewer told to find gaps invents them).
- Tests as ground truth: reproduce a bug with a failing test, fix the **root cause**, don't suppress.
- Show evidence (actual output), don't assert success.

## Task decomposition — contract first [CCBP][MAR]

The #1 lever against duplicated/colliding work is detailed, disjoint task boundaries. Before fanning
out, write a self-contained spec that **names the files/interfaces**, states what's **out of scope**,
and ends with a **verification step**. Give each worker an objective, output format, tools/sources,
and clear boundaries. Scale agent count to complexity — don't spawn a fleet for a one-line change.

## Filesystem isolation [WT]

One git worktree/branch per agent (we already do this: `claude/<task-slug>` branches). The harness
blocks edits/commands that target another checkout. Integrate to `main` via the verified push flow
(**`/sync-main`**).

## Failure modes → mitigations [MAR][CCBP][WT]

| Failure mode | Mitigation |
|---|---|
| Over-spawning / runaway cost | effort-scale agent count; cap concurrency & nesting |
| Duplicated work / context clash | disjoint task boundaries + per-worker output contract |
| Agents stepping on each other's files | one worktree per agent |
| Trust-then-verify gap (plausible-but-wrong) | always provide a check; independent reviewer on the diff |
| Context pollution | `/clear` between unrelated tasks; after 2 failed corrections, `/clear` + rewrite the prompt |
| Prompt-injection via tool output | scope each worker's tools/permissions; treat fetched content as data |

## Token economics [MAR][BEA][SUB]

Multi-agent ≈ 15× chat tokens, and token spend explains ~80% of the variance in performance. Stay
efficient: route cheap work to Haiku and hard work to Opus; parallelize independent tool calls;
`/clear` and targeted `/compact` to keep windows small; prefer CLI tools; scope MCP servers to the
agent that needs them.

## When multi-agent is NOT worth it [MAR][BEA]

Skip it when tasks share one context or are tightly interdependent, when latency matters, or for
quick targeted changes. Optimizing a single tool-using agent is usually enough; reach for a fleet
only for independent, high-value, context-exceeding work.

## How this repo is wired

- **Root [CLAUDE.md](../CLAUDE.md)** — operational playbook (sync / branch / verify / push).
- **[apps/desktop/CLAUDE.md](../apps/desktop/CLAUDE.md)** — architecture (loads on demand in that dir).
- **Skills** (`.claude/skills/`): `/verify` (fast push gate), `/sync-main` (pull + deliver flow).
- **Subagents** (`.claude/agents/`): `reviewer` (independent diff review, correctness-scoped).
- **Settings** (`.claude/settings.json`): permission allowlist (fewer prompts) + a PreToolUse hook
  that typechecks before a push to `main` (fails open if deps aren't installed).
- **Task board** (`tasks/BOARD.md` + the `/task` skill): a one-file git-native cross-team queue —
  add work any agent can pick up. Edit, commit, push.

## Sources

- Building Effective Agents — https://www.anthropic.com/engineering/building-effective-agents
- How we built our multi-agent research system — https://www.anthropic.com/engineering/built-multi-agent-research-system
- Claude Code best practices — https://code.claude.com/docs/en/best-practices
- Subagents — https://code.claude.com/docs/en/sub-agents
- Worktrees — https://code.claude.com/docs/en/worktrees
