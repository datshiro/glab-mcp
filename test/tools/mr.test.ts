import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitLabClient } from '../../src/gitlab-client.js'
import { createMrTool, listMrsTool, commentMrTool, approveMrTool, mergeMrTool } from '../../src/tools/mr.js'

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
