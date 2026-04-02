import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('loadConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns config when both env vars are set', async () => {
    process.env.GITLAB_URL = 'https://gitlab.example.com'
    process.env.GITLAB_PAT = 'glpat-test123'

    const { loadConfig } = await import('../src/config.js')
    const config = loadConfig()

    expect(config.url).toBe('https://gitlab.example.com')
    expect(config.pat).toBe('glpat-test123')
  })

  it('throws when GITLAB_URL is missing', async () => {
    delete process.env.GITLAB_URL
    process.env.GITLAB_PAT = 'glpat-test123'

    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow('GITLAB_URL')
  })

  it('throws when GITLAB_PAT is missing', async () => {
    process.env.GITLAB_URL = 'https://gitlab.example.com'
    delete process.env.GITLAB_PAT

    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow('GITLAB_PAT')
  })

  it('strips trailing slash from GITLAB_URL', async () => {
    process.env.GITLAB_URL = 'https://gitlab.example.com/'
    process.env.GITLAB_PAT = 'glpat-test123'

    const { loadConfig } = await import('../src/config.js')
    const config = loadConfig()

    expect(config.url).toBe('https://gitlab.example.com')
  })
})
