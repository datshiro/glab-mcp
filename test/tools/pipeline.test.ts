import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitLabClient } from '../../src/gitlab-client.js'
import {
  getPipelineStatusTool,
  getPipelineErrorsTool,
  listPipelineJobsTool,
  retryPipelineTool,
} from '../../src/tools/pipeline.js'

function makeClient(overrides: Partial<GitLabClient> = {}) {
  return {
    request: vi.fn().mockResolvedValue({}),
    getJobTrace: vi.fn().mockResolvedValue(''),
    ...overrides,
  } as unknown as GitLabClient
}

describe('get_pipeline_status', () => {
  it('returns pipeline status for explicit ref', async () => {
    const pipeline = { id: 10, status: 'success', web_url: 'https://gl.example.com/pipelines/10' }
    const client = makeClient({ request: vi.fn().mockResolvedValue([pipeline]) })

    const result = await getPipelineStatusTool(client, { project_id: 42, ref: 'main' })
    expect(result.status).toBe('success')
    expect(result.id).toBe(10)
  })

  it('returns null when no pipelines found for ref', async () => {
    const client = makeClient({ request: vi.fn().mockResolvedValue([]) })
    const result = await getPipelineStatusTool(client, { project_id: 42, ref: 'main' })
    expect(result).toBeNull()
  })

  it('passes ref with slash unencoded so GitLab can match branch names', async () => {
    const client = makeClient({ request: vi.fn().mockResolvedValue([]) })
    await getPipelineStatusTool(client, { project_id: 42, ref: 'feat/my-branch' })
    const calledUrl = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('ref=feat/my-branch')
    expect(calledUrl).not.toContain('%2F')
  })
})

describe('get_pipeline_errors', () => {
  it('returns logs for failed jobs', async () => {
    const jobs = [
      { id: 1, name: 'test', status: 'failed' },
      { id: 2, name: 'build', status: 'success' },
    ]
    const client = makeClient({
      request: vi.fn().mockResolvedValue(jobs),
      getJobTrace: vi.fn().mockResolvedValue('Error: test failed\nline2\n'),
    })

    const result = await getPipelineErrorsTool(client, { project_id: 42, pipeline_id: 10 })
    expect(result).toHaveLength(1)
    expect(result[0].job).toBe('test')
    expect(result[0].log).toContain('Error: test failed')
  })

  it('returns empty array when no failed jobs', async () => {
    const jobs = [{ id: 1, name: 'test', status: 'success' }]
    const client = makeClient({ request: vi.fn().mockResolvedValue(jobs) })

    const result = await getPipelineErrorsTool(client, { project_id: 42, pipeline_id: 10 })
    expect(result).toEqual([])
  })

  it('respects tail_lines parameter', async () => {
    const jobs = [{ id: 1, name: 'test', status: 'failed' }]
    const client = makeClient({
      request: vi.fn().mockResolvedValue(jobs),
      getJobTrace: vi.fn().mockResolvedValue(Array(200).fill('log line').join('\n')),
    })

    const result = await getPipelineErrorsTool(client, { project_id: 42, pipeline_id: 10, tail_lines: 50 })
    expect(result[0].log.split('\n').length).toBeLessThanOrEqual(51) // 50 lines + possible empty
  })
})

describe('list_pipeline_jobs', () => {
  it('returns all jobs in a pipeline', async () => {
    const jobs = [
      { id: 1, name: 'test', status: 'success', stage: 'test' },
      { id: 2, name: 'build', status: 'failed', stage: 'build' },
    ]
    const client = makeClient({ request: vi.fn().mockResolvedValue(jobs) })

    const result = await listPipelineJobsTool(client, { project_id: 42, pipeline_id: 10 })
    expect(result).toHaveLength(2)
    expect(result[1].status).toBe('failed')
  })

  it('returns empty array for empty pipeline', async () => {
    const client = makeClient({ request: vi.fn().mockResolvedValue([]) })
    const result = await listPipelineJobsTool(client, { project_id: 42, pipeline_id: 10 })
    expect(result).toEqual([])
  })
})

describe('retry_pipeline', () => {
  it('retries a pipeline and returns new pipeline', async () => {
    const newPipeline = { id: 11, status: 'running', web_url: 'https://gl.example.com/pipelines/11' }
    const client = makeClient({ request: vi.fn().mockResolvedValue(newPipeline) })

    const result = await retryPipelineTool(client, { project_id: 42, pipeline_id: 10 })
    expect(result.id).toBe(11)
    expect(result.status).toBe('running')
  })
})
