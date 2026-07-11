import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { homedir, platform } from 'os'

export interface McpClient {
  name: string
  scope: 'project' | 'global'
  configPath: string
  configFormat: 'json' | 'toml'
  detected: boolean
}

function getClaudeDesktopConfigPath(): string {
  const p = platform()
  if (p === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
  if (p === 'win32') {
    const appData = process.env.APPDATA
    if (appData) return join(appData, 'Claude', 'claude_desktop_config.json')
    return join(homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
  }
  // Linux
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json')
}

export function detectClients(cwd: string): McpClient[] {
  const home = homedir()

  const clients: McpClient[] = [
    {
      name: 'Claude Code',
      scope: 'project',
      configPath: join(cwd, '.mcp.json'),
      configFormat: 'json',
      detected: existsSync(join(home, '.claude')),
    },
    {
      name: 'Claude Desktop',
      scope: 'global',
      configPath: getClaudeDesktopConfigPath(),
      configFormat: 'json',
      detected: existsSync(dirname(getClaudeDesktopConfigPath())),
    },
    {
      name: 'Cursor',
      scope: 'project',
      configPath: join(cwd, '.cursor', 'mcp.json'),
      configFormat: 'json',
      detected: existsSync(join(home, '.cursor')),
    },
    {
      name: 'Codex',
      scope: 'global',
      configPath: join(home, '.codex', 'config.toml'),
      configFormat: 'toml',
      detected: existsSync(join(home, '.codex')),
    },
  ]

  return clients
}
