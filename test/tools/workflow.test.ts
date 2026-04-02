import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GitLabClient } from '../../src/gitlab-client.js'
import { shipMrTool, watchPipelineTool } from '../../src/tools/workflow.js'
import * as childProcess from 'child_process'

// Mock execFile at the module level
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>()
  return { ...actual, execFile: vi.fn() }
})

function makeExecFile(outputs: Record<string, string | Error>) {
  return vi.fn().mockImplementation(
    (_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      const key = args.join(' ')
      const val = outputs[key]
      if (val instanceof Error) cb(val, '', val.message)
      else cb(null, val ?? '', '')
    }
  )
}

function makeClient(overrides: Partial<GitLabClient> = {}) {
  return {
    request: vi.fn().mockResolvedValue({}),
    getJobTrace: vi.fn().mockResolvedValue(''),
    ...overrides,
  } as unknown as GitLabClient
}

describe('ship_mr', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('errors when working tree is clean', async () => {
    const { execFile } = await import('child_process')
    vi.mocked(execFile).mockImplementation(
      (_cmd, _args, _opts, cb: (...a: unknown[]) => void) => { cb(null, '', '') }
    )
    const client = makeClient()

    await expect(
      shipMrTool(client, { project_id: 42, target_branch: 'main', title: 'My feature' })
    ).rejects.toThrow('Nothing to commit')
  })

  it('errors when secret file detected before staging', async () => {
    const { execFile } = await import('child_process')
    vi.mocked(execFile).mockImplementation(
      (_cmd, args: string[], _opts, cb: (...a: unknown[]) => void) => {
        if (args.includes('--porcelain')) cb(null, '?? .env\nM src/index.ts\n', '')
        else cb(null, '', '')
      }
    )
    const client = makeClient()

    await expect(
      shipMrTool(client, { project_id: 42, target_branch: 'main', title: 'My feature' })
    ).rejects.toThrow('.env')
  })

  it('stages, commits, pushes, creates MR and returns url/iid/pipeline_id', async () => {
    const { execFile } = await import('child_process')
    vi.mocked(execFile).mockImplementation(
      (_cmd, args: string[], _opts, cb: (...a: unknown[]) => void) => {
        if (args.includes('--porcelain')) cb(null, 'M src/foo.ts\n', '')
        else if (args.includes('--show-current')) cb(null, 'feat/my-branch\n', '')
        else cb(null, '', '')
      }
    )

    const client = makeClient({
      request: vi.fn()
        .mockResolvedValueOnce({ web_url: 'https://gl.example.com/mr/1', iid: 1 })
        .mockResolvedValueOnce([{ id: 55 }]),
    })

    const promise = shipMrTool(client, { project_id: 42, target_branch: 'main', title: 'My feature' })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.url).toBe('https://gl.example.com/mr/1')
    expect(result.iid).toBe(1)
    expect(result.pipeline_id).toBe(55)
  })

  it('uses commit_message when provided instead of title', async () => {
    const { execFile } = await import('child_process')
    const calls: string[][] = []
    vi.mocked(execFile).mockImplementation(
      (_cmd, args: string[], _opts, cb: (...a: unknown[]) => void) => {
        calls.push(args)
        if (args.includes('--porcelain')) cb(null, 'M src/foo.ts\n', '')
        else if (args.includes('--show-current')) cb(null, 'feat/branch\n', '')
        else cb(null, '', '')
      }
    )

    const client = makeClient({
      request: vi.fn()
        .mockResolvedValueOnce({ web_url: 'u', iid: 1 })
        .mockResolvedValueOnce([{ id: 1 }]),
    })

    const promise = shipMrTool(client, {
      project_id: 42, target_branch: 'main', title: 'PR title', commit_message: 'fix: actual message'
    })
    await vi.runAllTimersAsync()
    await promise

    const commitCall = calls.find(a => a.includes('commit'))
    expect(commitCall).toContain('fix: actual message')
    expect(commitCall).not.toContain('PR title')
  })

  it('returns null pipeline_id if not found after retries', async () => {
    const { execFile } = await import('child_process')
    vi.mocked(execFile).mockImplementation(
      (_cmd, args: string[], _opts, cb: (...a: unknown[]) => void) => {
        if (args.includes('--porcelain')) cb(null, 'M src/foo.ts\n', '')
        else if (args.includes('--show-current')) cb(null, 'feat/branch\n', '')
        else cb(null, '', '')
      }
    )

    const client = makeClient({
      request: vi.fn()
        .mockResolvedValueOnce({ web_url: 'u', iid: 1 })
        .mockResolvedValue([]), // no pipelines found
    })

    const promise = shipMrTool(client, { project_id: 42, target_branch: 'main', title: 'feat' })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.pipeline_id).toBeNull()
  })
})

describe('watch_pipeline', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('returns immediately when pipeline is already succeeded', async () => {
    const client = makeClient({
      request: vi.fn().mockResolvedValue({ id: 10, status: 'success', web_url: 'u' }),
    })
    const result = await watchPipelineTool(client, { project_id: 42, pipeline_id: 10 })
    expect(result.status).toBe('success')
  })

  it('polls and returns when pipeline succeeds', async () => {
    let calls = 0
    const client = makeClient({
      request: vi.fn().mockImplementation(async () => {
        calls++
        return calls < 3
          ? { id: 10, status: 'running', web_url: 'u' }
          : { id: 10, status: 'success', web_url: 'u' }
      }),
    })

    const promise = watchPipelineTool(client, { project_id: 42, pipeline_id: 10 })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.status).toBe('success')
  })

  it('returns timeout status when pipeline still running at timeout', async () => {
    const client = makeClient({
      request: vi.fn().mockResolvedValue({ id: 10, status: 'running', web_url: 'https://gl.example.com/pipelines/10' }),
    })

    const promise = watchPipelineTool(client, { project_id: 42, pipeline_id: 10, timeout_minutes: 0.01 })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.status).toBe('timeout')
    expect(result.pipeline_id).toBe(10)
    expect(result.url).toBe('https://gl.example.com/pipelines/10')
  })

  it('returns failed status with error summary when pipeline fails', async () => {
    const client = makeClient({
      request: vi.fn()
        .mockResolvedValueOnce({ id: 10, status: 'failed', web_url: 'u' })
        .mockResolvedValue([{ id: 1, name: 'test', status: 'failed', stage: 'test' }]),
      getJobTrace: vi.fn().mockResolvedValue('Error: assertion failed\n'),
    })

    const result = await watchPipelineTool(client, { project_id: 42, pipeline_id: 10 })
    expect(result.status).toBe('failed')
    expect(result.errors).toBeDefined()
    expect(result.errors![0].log).toContain('Error: assertion failed')
  })

  it('returns error status after 3 API failures during poll', async () => {
    const { GitLabError } = await import('../../src/gitlab-client.js')
    const client = makeClient({
      request: vi.fn().mockRejectedValue(new GitLabError('Network error', 0)),
    })

    const promise = watchPipelineTool(client, { project_id: 42, pipeline_id: 10 })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.status).toBe('error')
    expect(result.message).toBeDefined()
  })
})
