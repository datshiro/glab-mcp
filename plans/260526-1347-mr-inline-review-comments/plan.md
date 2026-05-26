---
title: 'MR inline review comments from /ck:code-review reports'
description: >-
  New MCP tool post_review_findings: anchored GitLab MR discussions from
  structured code-review findings, with reconcile + auto-resolve on re-runs
status: completed
priority: P2
branch: master
tags:
  - mcp
  - gitlab
  - code-review
  - mr-discussions
blockedBy: []
blocks: []
created: '2026-05-26T06:53:22.263Z'
createdBy: 'ck:plan'
source: skill
brainstorm: plans/reports/brainstorm-260526-1347-mr-inline-review-comments.md
mode: fast+tdd
---

# MR inline review comments from /ck:code-review reports

## Overview

Add `post_review_findings` MCP tool. Takes structured findings (or markdown fallback) from `/ck:code-review` output and posts each as an anchored inline GitLab MR discussion. Reconcile semantics: re-runs update existing tool-tagged threads, auto-resolve stale ones, and never touch human comments. Off-diff findings fall back to general MR notes. Single-line anchoring in v1; multi-line ranges planned for v1.1.

Design source: [`brainstorm-260526-1347-mr-inline-review-comments.md`](../reports/brainstorm-260526-1347-mr-inline-review-comments.md)

## Runtime flow

```mermaid
flowchart TD
    A[post_review_findings call] --> B{findings provided?}
    B -->|yes| D[Fetch MR + diffs + existing discussions]
    B -->|no, markdown only| C[parseMarkdownReport]
    C -->|extracted| D
    C -->|nothing parsed| Z[Post whole markdown<br/>as ONE general note]
    D --> E[Index existing tool-tagged threads by hash]
    E --> F[For each finding: hash = sha1 file:line:title]
    F --> G{hash in existing?}
    G -->|yes, body same| H[unchanged]
    G -->|yes, body differs| I[PUT update note]
    G -->|yes, resolved| H
    G -->|no| J{file in diff?}
    J -->|yes| K[POST inline discussion]
    J -->|no| L[POST general note - fallback]
    K -.->|400 not in diff| L
    M[For each existing hash NOT in new findings] --> N{resolved?}
    N -->|no| O[PUT resolve thread]
    N -->|yes| H
    H --> R[Return summary]
    I --> R
    K --> R
    L --> R
    O --> R
    Z --> R
```

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Scaffolding & helpers (TDD)](./phase-01-scaffolding-helpers-tdd.md) | Completed |
| 2 | [Core inline post & fallback (TDD)](./phase-02-core-inline-post-fallback-tdd.md) | Completed |
| 3 | [Reconcile pass (TDD)](./phase-03-reconcile-pass-tdd.md) | Completed |
| 4 | [Tool registration & docs](./phase-04-tool-registration-docs.md) | Completed |

## Key Dependencies

- GitLab REST v4: `/merge_requests/:iid`, `/merge_requests/:iid/diffs`, `/merge_requests/:iid/discussions`, `/merge_requests/:iid/notes`
- `GitLabClient` (existing, reused — no changes)
- `node:crypto` for sha1
- vitest (existing)
- No new npm dependencies

## TDD Discipline

Every phase: write failing test → minimal implementation → green → refactor. Tests use mocked `GitLabClient.request` (`vi.fn()`) following the pattern already in `test/tools/mr.test.ts`. No live GitLab calls in unit tests.

## Constraints

- TypeScript, ≤200 LOC per file, kebab-case filenames
- Follows existing tool pattern: function in `src/tools/`, registered in `src/index.ts` with zod schema + descriptive `description`
- All responses returned as `JSON.stringify(...)` text content (matches existing tools)
- Zero new npm deps

## Out of Scope

- Multi-line range comments (`line_range` / `line_code`) — v1.1
- Replying within threads
- GraphQL endpoints
- Cross-project finding routing

## Dependencies

<!-- No cross-plan dependencies. Previous plan (260426-1520-mcp-int-coercion) complete. -->
