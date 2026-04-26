import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { GitLabClient } from '../../src/gitlab-client.js'
import { createMrTool, updateMrTool, listMrsTool, listLabelsTool, commentMrTool, approveMrTool, mergeMrTool, listMrDiscussionsTool, getMrStatusChecksTool } from '../../src/tools/mr.js'

function makeClient(responses: Record<string, unknown> = {}) {
  return {
    request: vi.fn().mockImplementation(async (path: string) => {
      for (const [key, val] of Object.entries(responses)) {
        if (path.includes(key)) return val
      }
      return {}
    }),
    getJobTrace: vi.fn(),
  } as unknown as GitLabClient
}

describe('create_mr', () => {
  it('creates an MR and returns url and iid', async () => {
    const client = makeClient({ 'merge_requests': { web_url: 'https://gl.example.com/mr/1', iid: 1 } })
    const result = await createMrTool(client, {
      project_id: 42,
      source_branch: 'feat/thing',
      target_branch: 'main',
      title: 'My MR',
    })
    expect(result.url).toBe('https://gl.example.com/mr/1')
    expect(result.iid).toBe(1)
  })

  it('passes labels when provided', async () => {
    const client = makeClient({ 'merge_requests': { web_url: 'https://gl.example.com/mr/1', iid: 1 } })
    await createMrTool(client, {
      project_id: 42,
      source_branch: 'feat/thing',
      target_branch: 'main',
      title: 'My MR',
      labels: 'bug,urgent',
    })
    expect(client.request).toHaveBeenCalledWith(
      expect.stringContaining('merge_requests'),
      expect.objectContaining({ body: expect.stringContaining('bug,urgent') })
    )
  })

  it('passes description when provided', async () => {
    const client = makeClient({ 'merge_requests': { web_url: 'https://gl.example.com/mr/1', iid: 1 } })
    await createMrTool(client, {
      project_id: 42,
      source_branch: 'feat/thing',
      target_branch: 'main',
      title: 'My MR',
      description: 'Some details',
    })
    expect(client.request).toHaveBeenCalledWith(
      expect.stringContaining('merge_requests'),
      expect.objectContaining({ body: expect.stringContaining('Some details') })
    )
  })
})

describe('update_mr', () => {
  it('sends PUT with provided fields', async () => {
    const client = makeClient({ 'merge_requests': { web_url: 'https://gl.example.com/mr/1', iid: 1, state: 'opened' } })
    const result = await updateMrTool(client, {
      project_id: 42,
      mr_iid: 1,
      title: 'Updated title',
      labels: 'bug,critical',
    })
    expect(result.url).toBe('https://gl.example.com/mr/1')
    expect(result.state).toBe('opened')
    expect(client.request).toHaveBeenCalledWith(
      expect.stringContaining('merge_requests/1'),
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('Updated title'),
      })
    )
  })

  it('only includes defined fields in body', async () => {
    const client = makeClient({ 'merge_requests': { web_url: 'u', iid: 1, state: 'opened' } })
    await updateMrTool(client, { project_id: 42, mr_iid: 1, labels: 'docs' })
    const body = JSON.parse((client.request as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body).toEqual({ labels: 'docs' })
  })
})

describe('list_mrs', () => {
  it('returns array of MRs', async () => {
    const mrs = [{ iid: 1, title: 'Fix bug', web_url: 'https://gl.example.com/mr/1', state: 'opened' }]
    const client = makeClient({ 'merge_requests': mrs })
    const result = await listMrsTool(client, { project_id: 42 })
    expect(result).toHaveLength(1)
    expect(result[0].iid).toBe(1)
  })

  it('returns empty array when no MRs', async () => {
    const client = makeClient({ 'merge_requests': [] })
    const result = await listMrsTool(client, { project_id: 42 })
    expect(result).toEqual([])
  })

  it('passes state filter to API', async () => {
    const client = makeClient({ 'merge_requests': [] })
    await listMrsTool(client, { project_id: 42, state: 'merged' })
    const calledUrl = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('state=merged')
  })
})

describe('list_labels', () => {
  it('returns array of labels', async () => {
    const labels = [{ name: 'bug', color: '#d9534f', description: 'Bug reports' }]
    const client = makeClient({ 'labels': labels })
    const result = await listLabelsTool(client, { project_id: 42 })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('bug')
  })

  it('passes search filter to API', async () => {
    const client = makeClient({ 'labels': [] })
    await listLabelsTool(client, { project_id: 42, search: 'bug' })
    const calledUrl = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('search=bug')
  })
})

describe('comment_mr', () => {
  it('posts a comment and returns the note id', async () => {
    const client = makeClient({ 'notes': { id: 99 } })
    const result = await commentMrTool(client, { project_id: 42, mr_iid: 1, body: 'LGTM' })
    expect(result.id).toBe(99)
  })
})

describe('approve_mr', () => {
  it('approves an MR', async () => {
    const client = makeClient({ 'approve': { approved: true } })
    const result = await approveMrTool(client, { project_id: 42, mr_iid: 1 })
    expect(result.approved).toBe(true)
  })
})

describe('merge_mr', () => {
  it('merges an MR and returns the merged MR', async () => {
    const client = makeClient({ 'merge': { iid: 1, state: 'merged', web_url: 'https://gl.example.com/mr/1' } })
    const result = await mergeMrTool(client, { project_id: 42, mr_iid: 1 })
    expect(result.state).toBe('merged')
  })

  it('passes merge_commit_message when provided', async () => {
    const client = makeClient({ 'merge': { iid: 1, state: 'merged', web_url: 'u' } })
    await mergeMrTool(client, { project_id: 42, mr_iid: 1, merge_commit_message: 'Merging feat/x' })
    expect(client.request).toHaveBeenCalledWith(
      expect.stringContaining('merge'),
      expect.objectContaining({ body: expect.stringContaining('Merging feat/x') })
    )
  })
})

describe('list_mr_discussions', () => {
  it('returns discussion threads', async () => {
    const discussions = [
      { id: 'abc', notes: [{ id: 1, author: { username: 'dev' }, body: 'LGTM', created_at: '2026-01-01', resolvable: false, resolved: false }] },
    ]
    const client = makeClient({ 'discussions': discussions })
    const result = await listMrDiscussionsTool(client, { project_id: 42, mr_iid: 1 })
    expect(result).toHaveLength(1)
    expect(result[0].notes[0].body).toBe('LGTM')
  })

  it('returns empty array when no discussions', async () => {
    const client = makeClient({ 'discussions': [] })
    const result = await listMrDiscussionsTool(client, { project_id: 42, mr_iid: 1 })
    expect(result).toEqual([])
  })

  it('passes pagination params', async () => {
    const client = makeClient({ 'discussions': [] })
    await listMrDiscussionsTool(client, { project_id: 42, mr_iid: 1, page: 2, per_page: 50 })
    const calledUrl = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('page=2')
    expect(calledUrl).toContain('per_page=50')
  })
})

// Regression test for stringified-integer rejection from MCP transport
// (see plans/260426-1520-mcp-int-coercion). Some MCP clients send numeric
// JSON values as strings before their typed-schema cache is warm. All numeric
// input fields must use z.coerce.number() so the schema accepts "3" as 3.
describe('schema coercion (issue: stringified integers from MCP transport)', () => {
  it('z.coerce.number().int() coerces string inputs and still rejects non-numeric/floats', () => {
    const schema = z.coerce.number().int()
    expect(schema.safeParse('3').success).toBe(true)
    expect(schema.parse('3')).toBe(3)
    expect(schema.safeParse(3).success).toBe(true)
    expect(schema.safeParse('abc').success).toBe(false)
    expect(schema.safeParse(3.5).success).toBe(false)
  })

  it('src/index.ts: every numeric input field uses z.coerce.number() (no bare z.number() outside unions)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8')
    // The only legitimate bare z.number() is inside the project_id union.
    const stripped = src.replace(/z\.union\(\[z\.number\(\), z\.string\(\)\]\)/g, '__UNION__')
    const remaining = stripped.match(/z\.number\(/g)
    expect(
      remaining,
      'bare z.number() must be z.coerce.number() — see plans/260426-1520-mcp-int-coercion',
    ).toBeNull()
  })
})

describe('get_mr_status_checks', () => {
  it('fetches MR sha then returns commit statuses', async () => {
    const client = {
      request: vi.fn()
        .mockResolvedValueOnce({ sha: 'abc123' })
        .mockResolvedValueOnce([
          { name: 'sonarqube', status: 'success', target_url: 'https://sonar.example.com/report', description: 'Passed', created_at: '2026-01-01' },
        ]),
      getJobTrace: vi.fn(),
    } as unknown as GitLabClient
    const result = await getMrStatusChecksTool(client, { project_id: 42, mr_iid: 1 })
    expect(result).toHaveLength(1)
    expect(result[0].target_url).toBe('https://sonar.example.com/report')
  })

  it('filters statuses by name_filter (case-insensitive)', async () => {
    const client = {
      request: vi.fn()
        .mockResolvedValueOnce({ sha: 'abc123' })
        .mockResolvedValueOnce([
          { name: 'SonarQube', status: 'success', target_url: 'https://sonar.example.com', description: null, created_at: '2026-01-01' },
          { name: 'coverage', status: 'success', target_url: 'https://cov.example.com', description: null, created_at: '2026-01-01' },
        ]),
      getJobTrace: vi.fn(),
    } as unknown as GitLabClient
    const result = await getMrStatusChecksTool(client, { project_id: 42, mr_iid: 1, name_filter: 'sonar' })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('SonarQube')
  })

  it('returns all statuses when no name_filter', async () => {
    const client = {
      request: vi.fn()
        .mockResolvedValueOnce({ sha: 'abc123' })
        .mockResolvedValueOnce([
          { name: 'sonar', status: 'success', target_url: null, description: null, created_at: '2026-01-01' },
          { name: 'coverage', status: 'failed', target_url: null, description: null, created_at: '2026-01-01' },
        ]),
      getJobTrace: vi.fn(),
    } as unknown as GitLabClient
    const result = await getMrStatusChecksTool(client, { project_id: 42, mr_iid: 1 })
    expect(result).toHaveLength(2)
  })
})
