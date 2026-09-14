import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('MCP stdio compatibility', () => {
  it('completes initialization and exposes GitLab tools through the standard MCP transport', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(process.cwd(), 'dist/index.js')],
      cwd: process.cwd(),
      env: {
        ...process.env,
        GITLAB_URL: 'https://gitlab.example.test',
        GITLAB_PAT: 'glpat-test-token',
      },
      stderr: 'pipe',
    })
    const client = new Client({ name: 'glab-mcp-compat-test', version: '1.0.0' })

    try {
      await client.connect(transport)
      const { tools } = await client.listTools()

      expect(tools).toHaveLength(21)
      expect(tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
        'create_mr',
        'list_mrs',
        'get_pipeline_status',
        'ship_mr',
        'resolve_mr_discussion',
        'reply_mr_discussion',
      ]))
      expect(tools.every(tool => tool.inputSchema.type === 'object')).toBe(true)
    } finally {
      await client.close()
    }
  }, 15_000)
})
