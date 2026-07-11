import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { detectClients } from '../../src/cli/detect-clients.js'
import * as fs from 'fs'
import * as os from 'os'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs')
  return { ...actual, existsSync: vi.fn() }
})

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os')
  return { ...actual, homedir: vi.fn(), platform: vi.fn() }
})

describe('detectClients', () => {
  const mockExistsSync = vi.mocked(fs.existsSync)
  const mockHomedir = vi.mocked(os.homedir)
  const mockPlatform = vi.mocked(os.platform)

  beforeEach(() => {
    mockHomedir.mockReturnValue('/home/testuser')
    mockPlatform.mockReturnValue('darwin')
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns all supported clients', () => {
    const clients = detectClients('/projects/myapp')
    expect(clients).toHaveLength(4)
    expect(clients.map(c => c.name)).toEqual(['Claude Code', 'Claude Desktop', 'Cursor', 'Codex'])
  })

  it('detects Claude Code when ~/.claude exists', () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p) === '/home/testuser/.claude'
    })
    const clients = detectClients('/projects/myapp')
    const claudeCode = clients.find(c => c.name === 'Claude Code')!
    expect(claudeCode.detected).toBe(true)
    expect(claudeCode.scope).toBe('project')
    expect(claudeCode.configPath).toBe('/projects/myapp/.mcp.json')
    expect(claudeCode.configFormat).toBe('json')
  })

  it('detects Cursor when ~/.cursor exists', () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p) === '/home/testuser/.cursor'
    })
    const clients = detectClients('/projects/myapp')
    const cursor = clients.find(c => c.name === 'Cursor')!
    expect(cursor.detected).toBe(true)
    expect(cursor.scope).toBe('project')
    expect(cursor.configPath).toBe('/projects/myapp/.cursor/mcp.json')
    expect(cursor.configFormat).toBe('json')
  })

  it('uses macOS path for Claude Desktop on darwin', () => {
    mockPlatform.mockReturnValue('darwin')
    const clients = detectClients('/projects/myapp')
    const desktop = clients.find(c => c.name === 'Claude Desktop')!
    expect(desktop.configPath).toContain('Library/Application Support/Claude')
    expect(desktop.scope).toBe('global')
  })

  it('uses Linux path for Claude Desktop on linux', () => {
    mockPlatform.mockReturnValue('linux')
    const clients = detectClients('/projects/myapp')
    const desktop = clients.find(c => c.name === 'Claude Desktop')!
    expect(desktop.configPath).toContain('.config/Claude')
  })

  it('detects Codex and uses its global TOML configuration', () => {
    mockExistsSync.mockImplementation((p) => String(p) === '/home/testuser/.codex')

    const clients = detectClients('/projects/myapp')
    const codex = clients.find(c => c.name === 'Codex')!

    expect(codex.detected).toBe(true)
    expect(codex.scope).toBe('global')
    expect(codex.configFormat).toBe('toml')
    expect(codex.configPath).toBe('/home/testuser/.codex/config.toml')
  })

  it('marks all clients as not detected when no directories exist', () => {
    mockExistsSync.mockReturnValue(false)
    const clients = detectClients('/projects/myapp')
    expect(clients.every(c => !c.detected)).toBe(true)
  })
})
