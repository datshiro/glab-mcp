#!/usr/bin/env node

// Subcommand routing — must run before the TTY check
if (process.argv[2] === 'init') {
  const { runInit } = await import('./cli/init.js')
  await runInit()
  process.exit(0)
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { loadConfig } from './config.js'
import { GitLabClient } from './gitlab-client.js'
import { createMrTool, updateMrTool, listMrsTool, listLabelsTool, commentMrTool, approveMrTool, mergeMrTool, listMrDiscussionsTool, getMrStatusChecksTool } from './tools/mr.js'
import { getPipelineStatusTool, getPipelineErrorsTool, listPipelineJobsTool, retryPipelineTool, getJobDetailTool, playJobTool, watchJobTool } from './tools/pipeline.js'
import { shipMrTool, watchPipelineTool } from './tools/workflow.js'

// When run directly in a terminal (not piped by an MCP client), explain how to use it.
if (process.stdin.isTTY) {
  console.log(`glab-mcp — GitLab MCP server

This process communicates over stdin/stdout using the MCP protocol.
It is meant to be launched by an MCP client (Claude Code, Claude Desktop, Cursor),
not run directly in a terminal.

Quick setup:

  npx glab-mcp init

Or add it to your MCP client config manually:

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

Required environment variables:
  GITLAB_URL   Your GitLab instance URL (e.g. https://gitlab.com)
  GITLAB_PAT   Personal Access Token with api scope
`)
  process.exit(0)
}

const config = loadConfig()
const client = new GitLabClient(config.url, config.pat)

const server = new McpServer({
  name: 'glab-mcp',
  version: '1.0.0',
})

// ── MR tools ──────────────────────────────────────────────────────────────────

server.registerTool('create_mr', {
  description: 'Create a GitLab merge request',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    source_branch: z.string().describe('Source branch name'),
    target_branch: z.string().describe('Target branch name'),
    title: z.string().describe('MR title'),
    description: z.string().optional().describe('MR description'),
    labels: z.string().optional().describe('Comma-separated labels'),
  },
}, async (args) => {
  const result = await createMrTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('update_mr', {
  description: 'Update a GitLab merge request',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    mr_iid: z.coerce.number().int().describe('MR internal ID'),
    title: z.string().optional().describe('New MR title'),
    description: z.string().optional().describe('New MR description'),
    labels: z.string().optional().describe('Comma-separated labels'),
    target_branch: z.string().optional().describe('New target branch'),
  },
}, async (args) => {
  const result = await updateMrTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('list_mrs', {
  description: 'List merge requests for a project',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    state: z.enum(['opened', 'closed', 'merged', 'all']).optional().describe('Filter by state'),
    author: z.string().optional().describe('Filter by author username'),
    labels: z.string().optional().describe('Filter by labels (comma-separated)'),
    page: z.coerce.number().int().min(1).optional().describe('Page number'),
    per_page: z.coerce.number().int().min(1).max(100).optional().describe('Items per page'),
  },
}, async (args) => {
  const result = await listMrsTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('list_labels', {
  description: 'List labels for a GitLab project',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    search: z.string().optional().describe('Filter labels by name'),
    page: z.coerce.number().int().min(1).optional().describe('Page number'),
    per_page: z.coerce.number().int().min(1).max(100).optional().describe('Items per page'),
  },
}, async (args) => {
  const result = await listLabelsTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('comment_mr', {
  description: 'Post a comment on a merge request',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    mr_iid: z.coerce.number().int().describe('MR internal ID'),
    body: z.string().describe('Comment body'),
  },
}, async (args) => {
  const result = await commentMrTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('approve_mr', {
  description: 'Approve a merge request',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    mr_iid: z.coerce.number().int().describe('MR internal ID'),
  },
}, async (args) => {
  const result = await approveMrTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('merge_mr', {
  description: 'Merge a merge request',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    mr_iid: z.coerce.number().int().describe('MR internal ID'),
    merge_commit_message: z.string().optional().describe('Custom merge commit message'),
  },
}, async (args) => {
  const result = await mergeMrTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('list_mr_discussions', {
  description: 'List discussion threads on a merge request (includes inline code comments and resolve status)',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    mr_iid: z.coerce.number().int().describe('MR internal ID'),
    page: z.coerce.number().int().min(1).optional().describe('Page number'),
    per_page: z.coerce.number().int().min(1).max(100).optional().describe('Items per page'),
  },
}, async (args) => {
  const result = await listMrDiscussionsTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('get_mr_status_checks', {
  description: 'Get external status checks (SonarQube, coverage, security scanners) for a merge request. Returns status name, state, and report URL.',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    mr_iid: z.coerce.number().int().describe('MR internal ID'),
    name_filter: z.string().optional().describe('Case-insensitive filter on status name (e.g. "sonar")'),
  },
}, async (args) => {
  const result = await getMrStatusChecksTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

// ── Pipeline tools ─────────────────────────────────────────────────────────────

server.registerTool('get_pipeline_status', {
  description: 'Get the latest pipeline status for a branch',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    ref: z.string().optional().describe('Branch/tag name (defaults to current git branch in working_dir)'),
    working_dir: z.string().optional().describe('Path to git repo for auto-detecting current branch'),
  },
}, async (args) => {
  const result = await getPipelineStatusTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('get_pipeline_errors', {
  description: 'Get error logs from failed pipeline jobs',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    pipeline_id: z.coerce.number().int().describe('Pipeline ID'),
    tail_lines: z.coerce.number().int().min(1).max(500).optional().describe('Number of log lines to return per job (default: 100)'),
  },
}, async (args) => {
  const result = await getPipelineErrorsTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('list_pipeline_jobs', {
  description: 'List all jobs in a pipeline',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    pipeline_id: z.coerce.number().int().describe('Pipeline ID'),
  },
}, async (args) => {
  const result = await listPipelineJobsTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('retry_pipeline', {
  description: 'Retry a failed pipeline',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    pipeline_id: z.coerce.number().int().describe('Pipeline ID'),
  },
}, async (args) => {
  const result = await retryPipelineTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('get_job_detail', {
  description: 'Get full details of a pipeline job including status, duration, runner, coverage, artifacts, and optionally the trace log',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    job_id: z.coerce.number().int().describe('Job ID'),
    include_trace: z.boolean().optional().describe('Include the job trace/log (default: false)'),
    tail_lines: z.coerce.number().int().min(1).max(500).optional().describe('Number of log lines to return (default: 100, requires include_trace)'),
  },
}, async (args) => {
  const result = await getJobDetailTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('play_job', {
  description: 'Trigger a manual pipeline job (e.g. deploy-stag-sea, deploy-service-on-test)',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    job_id: z.coerce.number().int().describe('Job ID to trigger'),
  },
}, async (args) => {
  const result = await playJobTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('watch_job', {
  description: 'Poll a single job until it reaches a terminal state (success/failed/canceled) or times out. Returns trace log on failure.',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    job_id: z.coerce.number().int().describe('Job ID to watch'),
    timeout_minutes: z.coerce.number().min(0.1).max(120).optional().describe('Max minutes to wait (default: 30)'),
    include_trace_on_failure: z.boolean().optional().describe('Include job trace log on failure (default: true)'),
  },
}, async (args) => {
  const result = await watchJobTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

// ── Workflow tools ─────────────────────────────────────────────────────────────

server.registerTool('ship_mr', {
  description: 'Stage all changes, commit, push, and create a GitLab MR in one step. Aborts if secret files (.env, *.pem, etc.) are detected.',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    target_branch: z.string().describe('Target branch for the MR (e.g. main)'),
    title: z.string().describe('MR title (also used as commit message if commit_message is not set)'),
    commit_message: z.string().optional().describe('Commit message (overrides title for the commit)'),
    description: z.string().optional().describe('MR description'),
    working_dir: z.string().optional().describe('Path to git repo (defaults to process.cwd())'),
  },
}, async (args) => {
  const result = await shipMrTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

server.registerTool('watch_pipeline', {
  description: 'Poll a pipeline until it reaches a terminal state (success/failed/canceled) or times out. Returns error logs on failure.',
  inputSchema: {
    project_id: z.union([z.number(), z.string()]).describe('Project ID or URL-encoded path'),
    pipeline_id: z.coerce.number().int().describe('Pipeline ID to watch'),
    timeout_minutes: z.coerce.number().min(0.1).max(120).optional().describe('Max minutes to wait (default: 30)'),
  },
}, async (args) => {
  const result = await watchPipelineTool(client, args)
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

// ── Start ──────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write(`glab-mcp: connected to ${config.url}\n`)
