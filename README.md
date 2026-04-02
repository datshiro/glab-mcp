# glab-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that connects AI coding assistants (Claude Code, Claude Desktop, Cursor) to GitLab. Create MRs, watch pipelines, and ship code without ever leaving your AI session.

```
AI assistant → glab-mcp → GitLab API
```

---

## Quick Start

```bash
npx glab-mcp init
```

The setup wizard will:
1. Ask for your GitLab URL and Personal Access Token
2. Validate your credentials against the GitLab API
3. Auto-detect your installed AI clients (Claude Code, Claude Desktop, Cursor)
4. Write the correct config file for each client

That's it. Restart your AI client and start using GitLab tools.

---

## What it does

| Tool | What it does |
|------|-------------|
| `ship_mr` | Stage everything, commit, push, open MR — one call |
| `watch_pipeline` | Poll a pipeline until done; returns error logs on failure |
| `create_mr` | Create a merge request |
| `list_mrs` | List / filter MRs by state, author, or label |
| `comment_mr` | Post a comment on an MR |
| `approve_mr` | Approve an MR |
| `merge_mr` | Merge an MR |
| `get_pipeline_status` | Get the latest pipeline for a branch |
| `get_pipeline_errors` | Fetch logs from failed jobs |
| `list_pipeline_jobs` | List all jobs in a pipeline |
| `retry_pipeline` | Retry a failed pipeline |

---

## Requirements

- Node.js 18+
- A GitLab Personal Access Token with `api` scope

---

## Manual Setup

If you prefer to configure manually instead of using `npx glab-mcp init`:

### Environment variables

| Variable | Required | Example |
|----------|----------|---------|
| `GITLAB_URL` | Yes | `https://gitlab.com` or your self-hosted URL |
| `GITLAB_PAT` | Yes | `glpat-xxxxxxxxxxxxxxxxxxxx` |

### Creating a PAT

1. GitLab → **User Settings** → **Access Tokens**
2. Scopes: check **api**
3. Copy the token — you only see it once

### Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "glab-mcp"],
      "env": {
        "GITLAB_URL": "https://gitlab.com",
        "GITLAB_PAT": "glpat-xxxx"
      }
    }
  }
}
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) and add the same `"mcpServers"` block above.

### Cursor

Add to `.cursor/mcp.json` in your project root, same `"mcpServers"` block.

### Other MCP clients

Follow your client's MCP server configuration guide and point it at the same command + env vars.

---

## Usage examples

Once configured, ask your AI assistant naturally:

**Ship changes and open an MR:**
> "Commit my changes and open an MR against main titled 'feat: add user auth'"

**Watch a pipeline:**
> "Watch pipeline 12345 in project 99 and tell me if it fails"

**Check CI status on a branch:**
> "What's the pipeline status on feat/my-feature in project 99?"

**Read failure logs:**
> "Get the error logs from the failed pipeline 12345 in project 99"

**Review open MRs:**
> "List all open MRs in project 99 assigned to me"

The AI will call the right tools automatically. You never touch the browser.

---

## Tool reference

All tools accept `project_id` as either a numeric ID (`42`) or a URL-encoded path (`"mygroup%2Fmyrepo"`).

### `ship_mr`

Stage all changes, commit, push the current branch, and open an MR.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project_id` | number \| string | Yes | — | GitLab project ID or path |
| `target_branch` | string | Yes | — | Branch to merge into (e.g. `main`) |
| `title` | string | Yes | — | MR title (also used as commit message) |
| `commit_message` | string | No | `title` | Override the commit message |
| `description` | string | No | — | MR description / body |
| `working_dir` | string | No | `cwd` | Path to the git repo |

Returns `{ url, iid, pipeline_id }`. `pipeline_id` is `null` if no pipeline starts within ~10 seconds.

**Security:** aborts if any staged or unstaged file matches a secret pattern (`.env`, `*.pem`, `*.key`, `id_rsa`, `credentials.json`, `*.p12`).

---

### `watch_pipeline`

Poll a pipeline until it reaches a terminal state.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project_id` | number \| string | Yes | — | GitLab project ID or path |
| `pipeline_id` | number | Yes | — | Pipeline ID to watch |
| `timeout_minutes` | number | No | `30` | Stop watching after this many minutes |

Returns:

```ts
// success / canceled / skipped
{ status: 'success', pipeline_id: number, url: string }

// failed — includes per-job error logs
{ status: 'failed', pipeline_id: number, url: string, errors: [{ job, stage, log }] }

// timed out
{ status: 'timeout', pipeline_id: number, url: string }

// API unreachable after 3 retries
{ status: 'error', message: string }
```

---

### `create_mr`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | number \| string | Yes | |
| `source_branch` | string | Yes | Branch to merge from |
| `target_branch` | string | Yes | Branch to merge into |
| `title` | string | Yes | |
| `description` | string | No | |

Returns `{ url, iid }`.

---

### `list_mrs`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project_id` | number \| string | Yes | | |
| `state` | `opened\|closed\|merged\|all` | No | `opened` | |
| `author` | string | No | | Filter by GitLab username |
| `labels` | string | No | | Comma-separated label names |
| `page` | number | No | `1` | |
| `per_page` | number | No | `20` | Max `100` |

---

### `get_pipeline_status`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | number \| string | Yes | |
| `ref` | string | No | Branch or tag. Omit to use the current branch (requires `working_dir`) |
| `working_dir` | string | No | Path to the git repo for auto-detecting the current branch |

Returns the latest pipeline object or `null` if none found.

---

### `get_pipeline_errors`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project_id` | number \| string | Yes | | |
| `pipeline_id` | number | Yes | | |
| `tail_lines` | number | No | `100` | Log lines to return per failed job (max `500`) |

Returns an array of `{ job, stage, log }` for each failed job.

---

## Security

- **PAT token** — stored only in your MCP client config, never logged or transmitted beyond the GitLab API. Accidentally leaked tokens are redacted to `[REDACTED]` in all error messages.
- **Shell injection** — all git operations use `execFile` with argv arrays, never `exec` with string interpolation.
- **Secret file detection** — `ship_mr` scans the working tree before staging. If it finds a file matching a secret pattern it aborts and lists the offending files.
- **Auto-gitignore** — when `glab-mcp init` stores a PAT directly in `.mcp.json`, it automatically adds the file to `.gitignore` to prevent accidental commits.
- **Local only** — the server runs as a local process on your machine. No data is sent anywhere except your configured `GITLAB_URL`.
- **Rate limiting** — the HTTP client backs off automatically on `429` responses (1 s → 2 s → 4 s, then throws).

---

## Development

```bash
git clone https://github.com/datshiro/glab-mcp
cd glab-mcp
npm install

# Run tests
npm test

# Watch mode
npm run test:watch

# Build
npm run build

# Run directly (for local MCP wiring)
GITLAB_URL=https://gitlab.com GITLAB_PAT=glpat-xxx npm run dev
```

### Project structure

```
src/
  config.ts          # Load and validate env vars
  gitlab-client.ts   # HTTP client (auth, retries, redaction, job trace)
  index.ts           # MCP server entry point — tool registration + CLI routing
  cli/
    init.ts          # Interactive setup wizard
    config-writer.ts # Read/merge/write MCP config files
    detect-clients.ts # Auto-detect installed AI clients
    validate-gitlab.ts # Validate GitLab credentials against API
  tools/
    mr.ts            # MR tools (create, list, comment, approve, merge)
    pipeline.ts      # Pipeline tools (status, errors, jobs, retry)
    workflow.ts      # Workflow combos (ship_mr, watch_pipeline)
test/
  config.test.ts
  gitlab-client.test.ts
  cli/
    config-writer.test.ts
    detect-clients.test.ts
    validate-gitlab.test.ts
  tools/
    mr.test.ts
    pipeline.test.ts
    workflow.test.ts
```

---

## Publishing (maintainers)

CI publishes to npm automatically when you push a version tag:

```bash
npm version patch   # or minor / major
git push --follow-tags
```

Requires `NPM_TOKEN` set as a CI/CD variable.

---

## License

MIT
