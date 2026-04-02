import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitLabClient, GitLabError } from '../src/gitlab-client.js'

const BASE = 'https://gitlab.example.com'
const PAT = 'glpat-test123'

describe('GitLabClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('makes authenticated requests with Private-Token header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 1 }),
      text: async () => '{"id":1}',
    })
    vi.stubGlobal('fetch', mockFetch)

    const client = new GitLabClient(BASE, PAT)
    await client.request('/api/v4/user')

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/v4/user`,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Private-Token': PAT }),
      })
    )
  })

  it('throws GitLabError on 401 with redacted token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: `Invalid token ${PAT}` }),
      text: async () => `Invalid token ${PAT}`,
    }))

    const client = new GitLabClient(BASE, PAT)
    await expect(client.request('/api/v4/user')).rejects.toThrow(GitLabError)

    try {
      await client.request('/api/v4/user')
    } catch (e) {
      expect((e as GitLabError).message).not.toContain(PAT)
      expect((e as GitLabError).message).toContain('[REDACTED]')
      expect((e as GitLabError).statusCode).toBe(401)
    }
  })

  it('throws GitLabError on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: '404 Not found' }),
      text: async () => '404 Not found',
    }))

    const client = new GitLabClient(BASE, PAT)
    const err = await client.request('/api/v4/projects/999').catch(e => e)
    expect(err).toBeInstanceOf(GitLabError)
    expect(err.statusCode).toBe(404)
  })

  it('retries on 429 with exponential backoff up to 3 times', async () => {
    vi.useFakeTimers()
    let calls = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      calls++
      if (calls <= 3) return { ok: false, status: 429, json: async () => ({}), text: async () => '' }
      return { ok: true, status: 200, json: async () => ({ id: 1 }), text: async () => '{"id":1}' }
    }))

    const client = new GitLabClient(BASE, PAT)
    const promise = client.request('/api/v4/user')
    // Advance through all backoff timers
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toEqual({ id: 1 })
    expect(calls).toBe(4) // 3 retries + 1 success
    vi.useRealTimers()
  })

  it('throws after 3 failed retries on 429', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, json: async () => ({}), text: async () => ''
    }))

    const client = new GitLabClient(BASE, PAT)
    const promise = client.request('/api/v4/user').catch(e => e)
    await vi.runAllTimersAsync()
    const err = await promise
    expect(err).toBeInstanceOf(GitLabError)
    expect(err.statusCode).toBe(429)
    vi.useRealTimers()
  })

  it('throws GitLabError on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const client = new GitLabClient(BASE, PAT)
    const err = await client.request('/api/v4/user').catch(e => e)
    expect(err).toBeInstanceOf(GitLabError)
    expect(err.message).toContain('Network error')
  })

  it('uses Range header for partial log fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 206,
      text: async () => 'error: build failed\n',
      json: async () => ({}),
    })
    vi.stubGlobal('fetch', mockFetch)

    const client = new GitLabClient(BASE, PAT)
    const log = await client.getJobTrace(42, 8192)

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/v4/jobs/42/trace`,
      expect.objectContaining({
        headers: expect.objectContaining({ Range: 'bytes=-8192' }),
      })
    )
    expect(log).toContain('error: build failed')
  })
})
