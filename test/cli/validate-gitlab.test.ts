import { describe, it, expect, vi, afterEach } from 'vitest'
import { validateGitLabCredentials } from '../../src/cli/validate-gitlab.js'

describe('validateGitLabCredentials', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns valid with username on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ username: 'testuser' }),
    }))

    const result = await validateGitLabCredentials('https://gitlab.com', 'glpat-xxx')

    expect(result.valid).toBe(true)
    expect(result.username).toBe('testuser')
    expect(fetch).toHaveBeenCalledWith('https://gitlab.com/api/v4/user', {
      headers: { 'PRIVATE-TOKEN': 'glpat-xxx' },
      signal: expect.any(AbortSignal),
    })
  })

  it('returns invalid on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    }))

    const result = await validateGitLabCredentials('https://gitlab.com', 'bad-token')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Invalid token')
  })

  it('returns invalid on other HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }))

    const result = await validateGitLabCredentials('https://gitlab.com', 'glpat-xxx')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('500')
  })

  it('returns invalid on abort/timeout', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    const result = await validateGitLabCredentials('https://slow-host.example', 'glpat-xxx')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Could not reach')
  })

  it('passes an AbortSignal to fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ username: 'testuser' }),
    }))

    await validateGitLabCredentials('https://gitlab.com', 'glpat-xxx')

    const callArgs = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(callArgs.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns invalid on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const result = await validateGitLabCredentials('https://bad-host.example', 'glpat-xxx')

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Could not reach')
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('strips trailing slash from URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ username: 'testuser' }),
    }))

    await validateGitLabCredentials('https://gitlab.com/', 'glpat-xxx')

    expect(fetch).toHaveBeenCalledWith('https://gitlab.com/api/v4/user', expect.anything())
  })
})
