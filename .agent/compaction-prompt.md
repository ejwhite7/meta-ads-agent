# Compaction prompt — meta-ads-agent

Paste the block below into a new Claude Code (or Cursor / Codex / Aider) session to bootstrap context. The prompt is self-contained — it doesn't assume the new session has any prior memory of this codebase.

After pasting, the new session should:

1. Read the four docs it names, **in the order given**.
2. Run `git log --oneline -5` and `gh pr list --state open` to see what's actually current.
3. Confirm understanding by summarizing back what it found, *before* proposing any change.

Update the "currently in flight" section before starting a session if there are open PRs or branches you want the new session to resume.

---

## The prompt

```
You're picking up work on the meta-ads-agent project at
/Users/ejwhite/Documents/code/meta-ads-agent — an open-source autonomous
agent that manages Meta (Facebook/Instagram) ad campaigns.

Pull the latest main before doing anything:

  cd /Users/ejwhite/Documents/code/meta-ads-agent
  git fetch origin && git checkout main && git pull

================================================================
LOAD CONTEXT IN THIS ORDER (do not skip):
================================================================

  1. AGENTS.md   — fast orientation. Project shape, common commands,
                   code conventions, gotcha table, what NOT to change.
                   Optimized for fresh threads. Read it carefully;
                   it's compact on purpose.

  2. SKILL.md    — skill manifest. Triggers when working on this
                   codebase. Compressed must-knows.

  3. CLAUDE.md   — exhaustive architectural reference (1200+ lines).
                   Don't read end-to-end up front. Use the table of
                   contents and §13 ("Known Agent Failure Patterns")
                   as a lookup. Section 13 is a 19-item index of
                   real bugs we've hit, organized by subsystem.

  4. DESIGN.md   — *why* the codebase is shaped this way. 11
                   architectural decisions with rejected alternatives.
                   Read this BEFORE proposing any structural change —
                   the rationale is almost certainly captured.

After reading, run:

  git log --oneline -10
  gh pr list --state open --json number,title,headRefName,mergeable
  ls -la ~/.meta-ads-agent/ 2>/dev/null || echo "(no local agent state)"
  pnpm --version && node --version
  cat packages/cli/package.json | grep '"version"'

So you know exactly where main is, what's open, and what local
state exists.

================================================================
PROJECT SHAPE (skim before touching code)
================================================================

  - TypeScript pnpm/Turborepo monorepo. Four packages:
      core/        Agent loop, decision engine, audit logger,
                   per-campaign goals, snapshot writer, backfill
                   engine, Drizzle SQLite/Postgres schema, LLM
                   adapters. Bundled into CLI; not published.
      meta-client/ Direct Marketing API client (axios to
                   graph.facebook.com/v21.0). NO Python CLI wrapper
                   (deprecated; see DESIGN.md §1). Bundled into CLI.
      cli/         The publishable `meta-ads-agent` binary.
                   tsup bundles core+meta-client; ships dashboard
                   static assets in the same tarball.
      dashboard/   React 18 + Vite + Tailwind SPA. Build copies
                   into cli/dashboard-static/ on `pnpm build`.
      tsconfig/    Shared TS config.

  - Per-user state lives at ~/.meta-ads-agent/ (config.json,
    agent.db, agent.sock, daemon.json). Outside the repo.

  - Audit log (agent_decisions) is the system of record.
    Append-only. Three consecutive insert failures → session halts.

  - Per-campaign goals (campaign_goals): the agent REFUSES to act
    on campaigns without an active goal. They show up as
    `_pending_guidance` audit rows. Configure via
    `meta-ads-agent guidance` or the dashboard.

  - Outcome backfill: every successful decision gets graded one
    tick later. `actual_outcome` and `performance_delta` are
    populated by BackfillEngine before each OODA loop.

================================================================
CONVENTIONS YOU MUST FOLLOW
================================================================

Build / test / lint pipeline (run all five before pushing):

  pnpm format && pnpm typecheck && pnpm test && pnpm lint && pnpm build

CI runs the equivalents; any single failure blocks merge.

Tools follow a factory + TypeBox pattern. They accept an optional
`MetaClient | null` and resolve from `context.metaClient` if not
pre-bound. NEVER use `{} as MetaClient` placeholder casts — every
method call explodes at runtime (PR #8 fixed exactly that).

Schema changes require updating FOUR places:
  1. packages/core/src/db/schema.ts             (Drizzle schema)
  2. packages/core/src/db/bootstrap.ts          (inlined SQL — published
                                                 CLI ships no .sql files)
  3. packages/core/src/db/migrations/*.sql      (drizzle-kit users)
  4. If new column referenced by a new index: column goes in
     SQLITE_BOOTSTRAP_ALTERS, index goes in SQLITE_BOOTSTRAP_INDEXES_SQL.
     Indexes that reference newly-added columns MUST run AFTER the
     ALTERs (three-phase bootstrap; see DESIGN.md §8).

`AuditRecord` field names match the Drizzle schema's TS field names
EXACTLY (reasoning, params, expectedOutcome, success, riskLevel —
NOT the legacy llmReasoning/toolParams/status). The dashboard
frontend reads them verbatim. Three different scaffold bugs (PRs
#18, #20, #21) traced back to field-shape drift.

PR conventions:
  - Branch from main: feat/... | fix/... | chore/... | refactor/...
                    | docs/...
  - Commit messages: imperative subject; body explains *why*; match
    the level of detail in PRs #19, #21, #22, #23, #24.
  - Bump packages/cli/package.json:version on user-visible changes.
    Version sequence is canonical; don't reuse a version even if a
    prior PR claimed one and was replaced.
  - PR description should include: what broke or what's new, why
    this approach, what was rejected, verification (typecheck/test/
    lint/build all pass), and a "for users mid-thread" upgrade note
    if relevant.

================================================================
DON'T-DO LIST (high-cost mistakes)
================================================================

  - Don't add an account-wide ROAS or CPA target as a NEW source
    of truth. Goals are PER-CAMPAIGN. Legacy AgentGoal.roasTarget
    / cpaCap exist for backwards compat only.

  - Don't replace `timingSafeEqual` with `!==` for the dashboard
    API key. Auth fails closed by design.

  - Don't `writeFileSync` a secrets file without `mode: 0o600`
    AND `unlinkSync` first if the file exists (mode is ignored on
    existing files; see init.ts).

  - Don't log access tokens, API keys, or anything that ends up
    in the audit log's `params` field as a secret.

  - Don't filter out `_pending_*` synthetic tool names without a
    reason. They're audit-log records of "what the agent wanted
    to do but didn't" — meaningful for the operator.

  - Don't bypass `CampaignGoalRepository.getActive` with a
    naive `WHERE deletedAt IS NULL ORDER BY ... LIMIT 1`. The
    soft-delete tombstone semantics are subtle (DESIGN.md §3).
    The naive query returns the wrong row.

  - Don't reorder the three-phase schema bootstrap. Tables →
    ALTER → indexes. Putting an index that references a new
    column in the TABLES block breaks legacy DBs (caught in PR #19).

  - Don't propose a refactor without checking DESIGN.md first —
    there's almost certainly a section explaining why it's not
    that way already.

================================================================
QUICK COMMAND REFERENCE
================================================================

  pnpm cli init                # interactive setup wizard
  pnpm cli run --dry-run --interval 5
                               # safe loop, 5min ticks, no real changes
  pnpm cli run-once --dry-run  # one OODA tick + exit
  pnpm cli decisions --limit 20
                               # audit log table view
  pnpm cli guidance            # configure per-campaign goals
  pnpm cli guidance --list     # show all configured goals
  pnpm cli dashboard           # web UI on :3001 (needs DASHBOARD_API_KEY)
  pnpm cli status              # agent state snapshot
  pnpm cli pause / resume      # daemon control

  # Database inspection (after a tick has run):
  sqlite3 ~/.meta-ads-agent/agent.db ".tables"
  sqlite3 ~/.meta-ads-agent/agent.db \
    "SELECT tool_name, success, expected_outcome, actual_outcome
     FROM agent_decisions ORDER BY timestamp DESC LIMIT 5"

================================================================
CURRENTLY IN FLIGHT (UPDATE THIS BEFORE STARTING A SESSION)
================================================================

  Latest main:        v0.2.0 (PR #24 docs rewrite, merged)
  Open PRs:           none at the time of this prompt being written
  In-flight branches: feat/dashboard-goal-management
                      (started; mounting Goals page in dashboard
                       so operators can configure goals from the UI
                       instead of the `guidance` CLI. Backend
                       endpoints + frontend page not yet wired.)

  Recently shipped (oldest → newest):
    #8   Code-review batch (auth bypass fail-closed, broken budget
         tool client resolution, CLI daemon wired to AgentSession,
         init schema alignment, decisions command, JSON extraction
         engine, ToolContext typing, more)
    #9   pnpm cli builds workspace deps first
    #10  init suggests dev vs global next-step
    #11  init validates token via Graph API
    #12  Drop Python CLI wrapper (Marketing API direct)
    #13  Drop Python CLI wrapper finalization
    #14  Bundle workspace deps for npm publish
    #15  decisions command, splat fix, audit filters
    #16  Bundle dashboard into CLI
    #17  Default sqlitePath to ~/.meta-ads-agent/agent.db
    #18  Auto-inject API key into served HTML
    #19  Auto-bootstrap SQLite schema (three-phase)
    #20  Tailwind CSS emit (was rendering unstyled)
    #21  Dashboard AuditRecord shape match
    #22  Header date-range picker
    #23  Per-campaign goals + outcome backfill + snapshot writer
    #24  Docs rewrite (README, CLAUDE, DESIGN, AGENTS, SKILL)

================================================================
FIRST-ACTION PROTOCOL
================================================================

Before proposing any change:

  1. State what I just asked you to do, in your own words.

  2. Identify which files / packages will likely change.

  3. Check the relevant DESIGN.md section to see if the approach
     you're considering was already considered + rejected.

  4. If the change touches the schema OR an audit-log field OR
     a tool's parameter shape OR a public type in core/index.ts,
     pause and confirm the contract before writing code. Three
     different scaffold bugs in this codebase traced back to
     skipping this step.

  5. Open a PR via:
       git checkout -b <type>/<short-description>
       (work)
       git add -A && git commit -m "..."
       git push -u origin HEAD
       gh pr create --base main --head <branch> --title "..." \
                    --body-file /tmp/pr-body.md

If anything in this prompt conflicts with what you find in
AGENTS.md / CLAUDE.md / DESIGN.md, the docs win — they're version-
controlled and updated alongside the code; this prompt is best-
effort context.

Now: pull latest, read the four docs in order, run the orientation
commands, and tell me what state the project is in. I'll tell you
what to work on next.
```

---

## Tips for keeping the prompt accurate

The prompt is best-effort and will go stale. Two ways to mitigate:

1. **Update the "currently in flight" section** before starting any new session so the new agent knows the open work. The merged-PRs list lower down is informational — it's already in `git log` and the AGENTS/CLAUDE docs.

2. **When you make an architectural decision worth defending**, add a section to `DESIGN.md` alongside the implementation PR. That's the canonical place that survives session changes. This prompt should never become the system of record for decisions — it's a launcher.

3. **The prompt should shrink over time, not grow.** If you find yourself adding a new bullet here, ask whether it really belongs in `AGENTS.md` (general convention) or `DESIGN.md` (rationale) or `CLAUDE.md` (architecture) instead. Compaction prompts are best when they're a thin pointer to durable docs, not a copy of them.

## When to regenerate this prompt

- After a meaningful architectural change (new section in DESIGN.md, new failure pattern in CLAUDE.md §13).
- When the version sequence resets (e.g. crossing 0.x → 1.0).
- When a long-running branch lands or a new one starts.
- Quarterly, even if nothing big changed — the "currently in flight" section ages fastest.
