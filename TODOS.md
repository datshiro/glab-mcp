# TODOS — glab-mcp

## v1.1

### get_mr tool
Add `get_mr(project_id, mr_iid)` tool that fetches a single MR by IID.
**Why:** AI needs to inspect a specific MR before commenting or merging. Using `list_mrs`
filtered to one result is awkward and wastes a tool call.
**Start:** Add to `src/tools/mr.ts`, register in `index.ts`. Mirrors `GET /projects/:id/merge_requests/:mr_iid`.
