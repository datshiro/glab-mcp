---
status: complete
mode: fast
created: 2026-04-26
completed: 2026-04-26
work_context: /Users/lap16932/personal/mcp/glab-mcp
reports: /Users/lap16932/personal/mcp/glab-mcp/plans/reports/
plans: /Users/lap16932/personal/mcp/glab-mcp/plans/
blockedBy: []
blocks: []
---

# [Bug Fix] MCP tool schemas reject stringified integers from upstream clients

**Date:** 2026-04-26 · **Type:** Bug Fix · **Priority:** High · **Effort:** ~30 min

## Executive Summary

GitLab MCP tool input schemas use strict `z.number().int()` for fields like `mr_iid`, `page`, `per_page`. When an MCP client sends arguments before its typed-schema cache is populated (a documented behaviour for Claude Code's deferred-tools system), JSON numbers arrive at the server as strings (`"3"`) and are rejected with `"Expected number, received string"`. The tool is unusable until the client pre-fetches the schema (e.g. via Claude Code's `ToolSearch`).

Fix: switch numeric tool fields to `z.coerce.number().int(...)`. Coercion is safe — handlers already wrap consumed values with `Number(...)` defensively (see `src/tools/mr.ts:42`).

## Issue Analysis

### Symptoms
- [x] `mr_iid: 3` → `"Expected number, received string"` despite caller sending a JSON number
- [x] Identical call succeeds after client force-loads the schema
- [x] Reproduces across `merge_mr`, `get_mr_status_checks`, and any tool with strict `z.number().int()` fields

### Root Cause
`z.number()` does not accept string inputs. Some client→server transport paths stringify numeric JSON values when the tool's typed schema isn't yet known to the client. Validation rejects before reaching the handler — handlers themselves are robust (already do `Number(args.mr_iid)`).

### Evidence
- Live failure trace from Claude Code session 2026-04-26: ~5 consecutive rejections of `mr_iid: 3` until `ToolSearch select:mcp__gitlab__merge_mr` was invoked; same args then succeeded.
- Zod error shape: `{"code":"invalid_type","expected":"number","received":"string","path":["mr_iid"]}`
- Current handler defence: `${Number(args.mr_iid)}` in `src/tools/mr.ts:42` (already string-tolerant once past the schema gate).

### Affected Components
- **`src/index.ts`** — every tool input field declared with `z.number()` or `z.number().int()`. Approximate occurrences (verify before editing): `mr_iid` (~6 tools), `page` (~3 tools), `per_page` (~3 tools).
- **`src/tools/*.ts`** — no changes needed; handlers already coerce.
- **`test/tools/mr.test.ts`** — add one regression test.

## Solution Design

### Approach
Replace strict `z.number()` with `z.coerce.number()` for **input-side** numeric fields only. Keep `project_id: z.union([z.number(), z.string()])` as-is (string-as-URL-encoded-path is a semantic union, not a coercion target).

### Why `z.coerce.number()` is safe here
- It calls JS `Number(value)` then validates as number. `"3"` → `3`. `"abc"` → `NaN` → `.int()` rejects.
- Subsequent `.int()` / `.min()` / `.max()` chains continue to apply normally.
- Handlers already coerce with `Number(...)` — no behavioural drift.

### Changes Required
1. **`src/index.ts`** — for every `z.number().int()` (and bare `z.number()` if any) in tool input schemas, prepend `coerce.`. Apply consistently across `mr_iid`, `page`, `per_page`.
2. **`test/tools/mr.test.ts`** — one new test: `inputSchema.safeParse({mr_iid: "3", project_id: 4215, ...}).success === true`. Validates the schema layer directly, no MCP server spin-up required.

### Out of scope (do not change)
- `project_id: z.union([z.number(), z.string()])` — leave untouched.
- Handler-level `Number(...)` wrappers — keep as defence-in-depth.
- Adding `.min(1)` to `iid` fields — separate concern; currently `0` and negative values would be accepted by the API which itself returns 404. Not regressing today.

## Implementation Steps

1. [x] In `src/index.ts`, scan for `z\.number\(` and replace each occurrence on tool input schemas with `z.coerce.number(`. Verify each via diff that it's a tool-input field, not internal type-narrowing.
2. [x] In `test/tools/mr.test.ts`, add:
   ```ts
   describe('schema coercion (issue: stringified integers from MCP transport)', () => {
     it('accepts mr_iid as a string', () => {
       const result = mergeMrInputSchema.safeParse({ project_id: 4215, mr_iid: '3' })
       expect(result.success).toBe(true)
       if (result.success) expect(result.data.mr_iid).toBe(3)
     })
     it('still rejects non-numeric strings', () => {
       const result = mergeMrInputSchema.safeParse({ project_id: 4215, mr_iid: 'abc' })
       expect(result.success).toBe(false)
     })
   })
   ```
   *(If schemas aren't currently exported from `index.ts`, hoist them into `src/schemas.ts` first — single small refactor.)*
3. [x] `npm test` — all green (82/82 in `test/`).
4. [x] `npm run build` — zero TS errors.
5. [x] Bump version in `package.json` (patch). Update `CHANGELOG.md` if present. *(1.4.0 → 1.4.1; no CHANGELOG.md in repo.)*

**Note on test approach:** Skipped extracting schemas to `src/schemas.ts` (YAGNI). Instead added a meta-test that scans `src/index.ts` for bare `z.number()` outside `z.union(...)` — directly catches a revert of the fix without invasive refactor.

## Verification Plan

### Test Cases
- [x] `z.coerce.number().int()` accepts `"3"` → `3` (covered)
- [x] `z.coerce.number().int()` accepts `3` → `3` (covered)
- [x] `z.coerce.number().int()` rejects `"abc"` (covered)
- [x] `z.coerce.number().int()` rejects `3.5` (covered)
- [x] Meta-test: `src/index.ts` contains no bare `z.number()` outside unions (covered — fails on revert)
- [ ] **Manual end-to-end:** publish a local build, invoke from a fresh Claude Code session without `ToolSearch` priming — first call should succeed. *(deferred — requires fresh client session)*

### Rollback
Single-file primary change. `git revert <sha>` is sufficient. No data, no API contract changes.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| `Number(true)===1`, `Number(null)===0` — coerce admits booleans/null | Very low — tool fields semantically are integers; clients sending `true` for an iid is a client bug, not a server concern | `.int()` admits but downstream `Number()` is no-op; if this becomes a real issue, replace coerce with explicit `z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)])` |
| Schemas extracted to a new `src/schemas.ts` file might be unwanted churn | Low | If TS-export hoisting is undesired, write the test by importing the tool registration object via the MCP SDK's `_meta.inputSchema` field — slightly more verbose but zero new files |
| Downstream tools with version pinning break on patch bump | None — bug fix, fully backward compatible (numbers still work) | None needed |

## Unresolved Questions

1. Is there an upstream MCP TS SDK feature (transport-level coercion) that would solve this once for all MCP servers, making this patch redundant? Worth a quick check before merging.
2. Should `iid` fields gain `.min(1)` while we're here? Out of scope for this patch unless trivially extended.

## TODO Checklist
- [x] Implement coerce switch in `src/index.ts` (23 fields + 2 timeout_minutes)
- [x] Add string-input regression test (Zod behavior + meta-test on src)
- [x] `npm test` clean (82/82)
- [x] `npm run build` clean
- [x] Patch version + changelog (1.4.0 → 1.4.1; no changelog file)
- [ ] Manual end-to-end verification with a fresh Claude Code session *(deferred to user)*

---

**Work context:** `/Users/lap16932/personal/mcp/glab-mcp`
**Reports:** `/Users/lap16932/personal/mcp/glab-mcp/plans/reports/`
**Plans:** `/Users/lap16932/personal/mcp/glab-mcp/plans/`

**Cook handoff:**
```
/ck:cook /Users/lap16932/personal/mcp/glab-mcp/plans/260426-1520-mcp-int-coercion/plan.md
```
