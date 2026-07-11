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
    configFormat: 'json',
    detected: true,
  }

  const codexClient: McpClient = {
    name: 'Codex',
    scope: 'global',
    configPath: '/home/testuser/.codex/config.toml',
    configFormat: 'toml',
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
      expect(writtenContent.mcpServers.gitlab.env.GITLAB_PAT).toBeUndefined()
      expect(writtenContent.mcpServers.gitlab.env.GITLAB_PAT_ENV_VAR).toBe('MY_PAT')
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

  describe('Codex TOML config', () => {
    it('writes a Codex MCP server entry with direct credentials', () => {
      mockExistsSync.mockImplementation((p) => String(p) === '/home/testuser/.codex')

      const result = writeConfig(codexClient, 'https://gitlab.com', 'glpat-xxx', false, 'GITLAB_PAT')

      expect(result.success).toBe(true)
      const content = mockWriteFileSync.mock.calls[0][1] as string
      expect(content).toContain('[mcp_servers.gitlab]')
      expect(content).toContain('command = "npx"')
      expect(content).toContain('args = ["-y","glab-mcp"]')
      expect(content).toContain('[mcp_servers.gitlab.env]')
      expect(content).toContain('GITLAB_URL = "https://gitlab.com"')
      expect(content).toContain('GITLAB_PAT = "glpat-xxx"')
    })

    it('relies on the inherited PAT when environment-variable mode is selected', () => {
      mockExistsSync.mockImplementation((p) => String(p) === '/home/testuser/.codex')

      const result = writeConfig(codexClient, 'https://gitlab.com', '', true, 'MY_PAT')

      expect(result.success).toBe(true)
      const content = mockWriteFileSync.mock.calls[0][1] as string
      expect(content).toContain('GITLAB_URL = "https://gitlab.com"')
      expect(content).not.toMatch(/^GITLAB_PAT = /m)
      expect(content).toContain('GITLAB_PAT_ENV_VAR = "MY_PAT"')
    })

    it('replaces only the existing gitlab MCP table', () => {
      mockExistsSync.mockImplementation((p) => {
        return String(p) === '/home/testuser/.codex/config.toml' || String(p) === '/home/testuser/.codex'
      })
      mockReadFileSync.mockReturnValue([
        'model = "gpt-5"',
        '',
        '[mcp_servers.gitlab]',
        'command = "old-command"',
        '',
        '[mcp_servers.gitlab.env]',
        'GITLAB_PAT = "old-token"',
        '',
        '[mcp_servers.other]',
        'command = "other-command"',
      ].join('\n'))

      const result = writeConfig(codexClient, 'https://gitlab.com', 'glpat-new', false, 'GITLAB_PAT')

      expect(result.success).toBe(true)
      expect(result.overwritten).toBe(true)
      const content = mockWriteFileSync.mock.calls[0][1] as string
      expect(content).toContain('model = "gpt-5"')
      expect(content).toContain('[mcp_servers.other]')
      expect(content).not.toContain('old-command')
      expect(content).not.toContain('old-token')
      expect(content.match(/\[mcp_servers\.gitlab\]/g)).toHaveLength(1)
    })

    it('finds an existing Codex GitLab entry', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('[mcp_servers.gitlab]\ncommand = "npx"\n')

      expect(hasExistingGitlabEntry(codexClient)).toBe(true)
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
