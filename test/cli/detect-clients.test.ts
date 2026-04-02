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

  it('returns all three clients', () => {
    const clients = detectClients('/projects/myapp')
    expect(clients).toHaveLength(3)
    expect(clients.map(c => c.name)).toEqual(['Claude Code', 'Claude Desktop', 'Cursor'])
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

  it('marks all clients as not detected when no directories exist', () => {
    mockExistsSync.mockReturnValue(false)
    const clients = detectClients('/projects/myapp')
    expect(clients.every(c => !c.detected)).toBe(true)
  })
})
