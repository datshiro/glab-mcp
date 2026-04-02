import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeConfig, hasExistingGitlabEntry, ensureGitignore } from '../../src/cli/config-writer.js'
import * as fs from 'fs'
import type { McpClient } from '../../src/cli/detect-clients.js'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
    chmodSync: vi.fn(),
  }
})

describe('config-writer', () => {
  const mockExistsSync = vi.mocked(fs.existsSync)
  const mockReadFileSync = vi.mocked(fs.readFileSync)
  const mockWriteFileSync = vi.mocked(fs.writeFileSync)
  const mockMkdirSync = vi.mocked(fs.mkdirSync)
  const mockAppendFileSync = vi.mocked(fs.appendFileSync)

  const testClient: McpClient = {
    name: 'Claude Code',
    scope: 'project',
    configPath: '/projects/myapp/.mcp.json',
    detected: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('writeConfig', () => {
    it('writes new config when no file exists', () => {
      mockExistsSync.mockImplementation((p) => {
        // Directory exists, config file does not
        return String(p) === '/projects/myapp'
      })

      const result = writeConfig(testClient, 'https://gitlab.com', 'glpat-xxx', false, 'GITLAB_PAT')

      expect(result.success).toBe(true)
      expect(result.overwritten).toBe(false)
      expect(mockWriteFileSync).toHaveBeenCalledOnce()

      const writtenContent = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string)
      expect(writtenContent.mcpServers.gitlab.command).toBe('npx')
      expect(writtenContent.mcpServers.gitlab.args).toEqual(['-y', 'glab-mcp'])
      expect(writtenContent.mcpServers.gitlab.env.GITLAB_URL).toBe('https://gitlab.com')
      expect(writtenContent.mcpServers.gitlab.env.GITLAB_PAT).toBe('glpat-xxx')
    })

    it('uses env var reference when useEnvVar is true', () => {
      mockExistsSync.mockImplementation((p) => String(p) === '/projects/myapp')

      const result = writeConfig(testClient, 'https://gitlab.com', '', true, 'MY_PAT')

      expect(result.success).toBe(true)
      const writtenContent = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string)
      expect(writtenContent.mcpServers.gitlab.env.GITLAB_PAT).toBe('${MY_PAT}')
    })

    it('preserves existing MCP servers when merging', () => {
      mockExistsSync.mockImplementation((p) => {
        return String(p) === '/projects/myapp/.mcp.json' || String(p) === '/projects/myapp'
      })
      mockReadFileSync.mockReturnValue(JSON.stringify({
        mcpServers: {
          other_server: { command: 'other', args: [], env: {} },
        },
      }))

      const result = writeConfig(testClient, 'https://gitlab.com', 'glpat-xxx', false, 'GITLAB_PAT')

      expect(result.success).toBe(true)
      const writtenContent = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string)
      expect(writtenContent.mcpServers.other_server).toBeDefined()
      expect(writtenContent.mcpServers.gitlab).toBeDefined()
    })

    it('marks overwritten when gitlab entry already exists', () => {
      mockExistsSync.mockImplementation((p) => {
        return String(p) === '/projects/myapp/.mcp.json' || String(p) === '/projects/myapp'
      })
      mockReadFileSync.mockReturnValue(JSON.stringify({
        mcpServers: {
          gitlab: { command: 'old', args: [], env: {} },
        },
      }))

      const result = writeConfig(testClient, 'https://gitlab.com', 'glpat-xxx', false, 'GITLAB_PAT')

      expect(result.success).toBe(true)
      expect(result.overwritten).toBe(true)
    })

    it('creates directory when it does not exist', () => {
      mockExistsSync.mockReturnValue(false)

      writeConfig(testClient, 'https://gitlab.com', 'glpat-xxx', false, 'GITLAB_PAT')

      expect(mockMkdirSync).toHaveBeenCalledWith('/projects/myapp', { recursive: true })
    })

    it('returns error on write failure', () => {
      mockExistsSync.mockImplementation((p) => String(p) === '/projects/myapp')
      mockWriteFileSync.mockImplementation(() => { throw new Error('Permission denied') })

      const result = writeConfig(testClient, 'https://gitlab.com', 'glpat-xxx', false, 'GITLAB_PAT')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Permission denied')
    })

    it('returns error on malformed existing config', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('{ invalid json }')

      const result = writeConfig(testClient, 'https://gitlab.com', 'glpat-xxx', false, 'GITLAB_PAT')

      expect(result.success).toBe(false)
      expect(result.error).toContain('malformed JSON')
      expect(mockWriteFileSync).not.toHaveBeenCalled()
    })
  })

  describe('hasExistingGitlabEntry', () => {
    it('returns false when no config file exists', () => {
      mockExistsSync.mockReturnValue(false)
      expect(hasExistingGitlabEntry(testClient)).toBe(false)
    })

    it('returns true when gitlab entry exists', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        mcpServers: { gitlab: { command: 'npx', args: [], env: {} } },
      }))
      expect(hasExistingGitlabEntry(testClient)).toBe(true)
    })

    it('returns false when config has no gitlab entry', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        mcpServers: { other: {} },
      }))
      expect(hasExistingGitlabEntry(testClient)).toBe(false)
    })
  })

  describe('ensureGitignore', () => {
    it('appends to existing .gitignore', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('node_modules\n')

      const result = ensureGitignore('/projects/myapp', '.mcp.json')

      expect(result).toBe(true)
      expect(mockAppendFileSync).toHaveBeenCalledWith(
        '/projects/myapp/.gitignore',
        '\n.mcp.json\n',
        'utf-8',
      )
    })

    it('skips if already in .gitignore', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('node_modules\n.mcp.json\n')

      const result = ensureGitignore('/projects/myapp', '.mcp.json')

      expect(result).toBe(false)
      expect(mockAppendFileSync).not.toHaveBeenCalled()
    })

    it('does not false-positive on substring matches', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('# do not commit .mcp.json.bak\nnode_modules\n')

      const result = ensureGitignore('/projects/myapp', '.mcp.json')

      expect(result).toBe(true)
      expect(mockAppendFileSync).toHaveBeenCalled()
    })

    it('creates .gitignore when it does not exist', () => {
      mockExistsSync.mockReturnValue(false)

      const result = ensureGitignore('/projects/myapp', '.mcp.json')

      expect(result).toBe(true)
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/projects/myapp/.gitignore',
        '.mcp.json\n',
        'utf-8',
      )
    })
  })
})
