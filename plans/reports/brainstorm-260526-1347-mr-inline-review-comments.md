# Brainstorm — MR Inline Review Comments from `/ck:code-review` Reports

**Date:** 2026-05-26 13:47 (Asia/Saigon)
**Project:** glab-mcp v1.4.2
**Status:** Design approved, ready for `/ck:plan`

---

## Problem Statement

Today `/ck:code-review` produces a markdown report; the only available glab-mcp tool to surface it on a GitLab MR is `comment_mr`, which posts ONE general note. Consequences:

- Reviewer can't resolve thread-by-thread
- No "Apply suggestion" UX
- No anchoring to the offending line — reviewer hunts for `path:line` references manually
- Re-running `/ck:code-review` after a push spams the MR with duplicated reviews

**Goal:** Ship a new MCP tool that takes structured findings (or markdown as fallback) and posts each one as an anchored GitLab discussion on the exact `file:line`, with idempotent re-run behavior.

---

## Requirements (locked)

| # | Requirement | Source |
|---|-------------|--------|
| R1 | Accept structured `findings[]` (primary) AND raw `report_markdown` (fallback) | User decision |
| R2 | Post each finding as inline GitLab discussion anchored to `new_line`/`old_line` | User decision |
| R3 | If file/line not in MR diff → fallback to general MR note (no info lost) | User decision |
| R4 | Format `suggestion` field as GitLab \`\`\`suggestion\`\`\` block (Apply-button UX) | User decision |
| R5 | Tag every comment with hidden marker; reconcile on re-run (update/skip/auto-resolve) | User decision |
| R6 | Single high-level tool `post_review_findings`, no low-level escape hatch | User decision |
| R7 | Multi-line range support — out of v1, plan for v1.1 | User decision |
| R8 | Tool only ever touches threads carrying its own marker (never human/bot comments) | Safety invariant |

---

## Evaluated Approaches

### Approach A — Low-level only (`create_mr_inline_discussion`)
**Rejected.** AI loops itself, N round-trips, no shared SHA/diff fetch, no batched summary. Cheapest MCP code, most expensive runtime.

### Approach B — Two tools (low-level + high-level)
**Rejected.** Doubles tool surface for marginal value. AI rarely needs single-comment posting.

### Approach C (chosen) — Single high-level tool `post_review_findings` with reconcile semantics
**Chosen.** One call, one outcome, matches existing `ship_mr` style. Reconcile keeps re-runs clean.

---

## Final Design

### Tool surface

```ts
post_review_findings({
  project_id: number | string,
  mr_iid: number,
  findings?: Finding[],          // primary
  report_markdown?: string,      // fallback (best-effort parse)
  dedupe?: boolean,              // default true — disables reconcile
  auto_resolve_stale?: boolean,  // default true — disables resolve step
  concurrency?: number,          // default 4
})

Finding = {
  file: string,
  severity: 'critical'|'high'|'medium'|'low'|'info',
  title: string,
  body: string,
  new_line?: number,             // added/context line
  old_line?: number,             // deleted line
  suggestion?: string,           // optional one-click patch
}
```

### Returns

```ts
{
  inline:        [{ url, file, line, hash }],
  updated:       [{ url, file, line, hash }],
  unchanged:     [{ url, file, line, hash }],
  fallback:      [{ url, file, line, reason: 'off-diff'|'400' }],
  auto_resolved: [{ url, file, line, hash }],
  failed:        [{ file, line, error }],
}
```

### Reconcile algorithm

```
1. Normalize input (findings ?? parseMarkdown(report_markdown))
   If parser yields nothing → post whole markdown as ONE general note, return.

2. Fetch shared context:
   - GET /merge_requests/:iid             → diff_refs { base_sha, start_sha, head_sha }
   - GET /merge_requests/:iid/diffs       → changed file set
   - GET /merge_requests/:iid/discussions → existing tool-tagged threads (paginated)

3. Build hash for each new finding:  hash = sha1(file + ':' + (new_line ?? old_line) + ':' + title)

4. Three-way compare against existing:
   - in new ∧ in existing ∧ body identical → unchanged
   - in new ∧ in existing ∧ body differs   → PUT note (update)
   - in new ∧ in existing ∧ resolved       → unchanged (human resolved, leave alone)
   - in new ∧ ¬existing                    → POST discussion (or fallback note)
   - ¬new   ∧ in existing ∧ ¬resolved      → PUT resolve (stale)

5. Render body = title + body + optional ```suggestion``` block + <!-- marker -->
6. Run network ops with bounded concurrency (default 4); rely on existing GitLabClient 429 backoff
7. Return summary
```

### Safety invariants

- Tool only inspects/modifies threads whose root note body contains `<!-- glab-mcp-finding:HASH -->`. Human comments and third-party bots are untouchable.
- `dedupe=false` disables reconcile entirely (always-fresh mode for forced re-reviews).
- `auto_resolve_stale=false` disables resolve step independently (useful when user wants update-only behavior).

### File layout

```
src/tools/mr-review.ts            NEW    ~190 LOC
  ├─ postReviewFindingsTool()           orchestrator
  ├─ renderBody()                       suggestion + marker formatting
  ├─ buildPosition()                    single-line position payload
  ├─ parseMarkdownReport()              heuristic fallback parser
  ├─ extractToolThreads()               existing thread index by hash
  └─ reconcile()                        three-way compare
src/index.ts                      MODIFY +15 LOC (tool registration)
test/tools/mr-review.test.ts      NEW    ~180 LOC
README.md                         MODIFY (tool table + reference section)
```

All files stay under the 200 LOC rule.

### GitLab endpoints used

| Op | Endpoint | Purpose |
|----|----------|---------|
| GET | `/merge_requests/:iid` | base/start/head SHAs |
| GET | `/merge_requests/:iid/diffs` | changed-file set |
| GET | `/merge_requests/:iid/discussions` | reconcile baseline |
| POST | `/merge_requests/:iid/discussions` | inline comment |
| POST | `/merge_requests/:iid/notes` | fallback note |
| PUT | `/merge_requests/:iid/discussions/:id/notes/:note_id` | update body |
| PUT | `/merge_requests/:iid/discussions/:id` | resolve thread |

---

## Implementation Considerations

- **No new deps.** sha1 via `node:crypto`. Reuse `GitLabClient` (auth, redaction, 429 backoff already in place).
- **Markdown parser is heuristic, not a contract.** If `/ck:code-review` output format drifts, parser may fail → falls back to single general note. No silent loss.
- **Off-diff detection:** primary check via `/diffs` file set. Secondary defense: catch 400 from POST discussions and retry as note.
- **Hash stability:** `file:line:title`. Title rephrasing between runs causes one stale-resolve + one new-post on same line. Accepted as KISS trade-off; not catastrophic.

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| GitLab "not in diff" error string varies by version | Medium | Test against actual instance; fallback on any 400 with `position` in payload |
| Title rephrasing → duplicate (stale+new) threads on same line | Low | Documented behavior; can revisit hash strategy in v1.1 |
| Markdown parser brittleness | Low | Single-note fallback preserves info |
| 100+ findings = 100+ API calls | Low | `concurrency=4` + existing 429 backoff |
| Auto-resolve closes a thread the human wanted to keep | Low | Only resolves tool-tagged threads, never human comments; `auto_resolve_stale=false` opt-out |

---

## Success Metrics

1. `post_review_findings` posts N inline discussions for N anchorable findings on a real MR
2. Re-running with identical findings → all `unchanged[]`, zero new posts
3. Re-running with subset of findings → missing ones move to `auto_resolved[]`
4. Off-diff finding → posted as fallback general note, surfaced in `fallback[]`
5. Finding with `suggestion` → GitLab renders "Apply suggestion" button
6. vitest suite: all reconcile branches covered (new / updated / unchanged / resolved / fallback / failed)

---

## Out of Scope (v1)

- Multi-line range comments (`line_range` / `line_code`) — planned for v1.1
- Replying within existing threads
- GraphQL endpoints
- Cross-project finding routing
- Editing prior runs' suggestion blocks individually

---

## Next Steps

1. `/ck:plan` to generate phased implementation plan
2. Phase suggestion:
   - Phase 1: Schema + core POST inline path (no reconcile, no parser, no suggestion) — prove SHA/position assembly works against live GitLab
   - Phase 2: Suggestion block + marker tag
   - Phase 3: Reconcile (existing index + update + auto-resolve)
   - Phase 4: Off-diff fallback
   - Phase 5: Markdown parser fallback
   - Phase 6: Tests + README

---

## Unresolved Questions

- GitLab self-hosted version target — need to confirm the instance supports `position_type: 'text'` discussions + `resolved` PUT (both stable since GL 11.x, so probably non-issue)
- Should `concurrency` cap be configurable per-user, or hard-coded? (Currently proposed: arg with default 4)
- README placement: extend existing tool table or add a dedicated "Code review integration" section?
