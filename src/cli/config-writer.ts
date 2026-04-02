import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs'
import { dirname, join } from 'path'
import type { McpClient } from './detect-clients.js'

interface McpServerEntry {
  command: string
  args: string[]
  env: Record<string, string>
}

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>
  [key: string]: unknown
}

export interface WriteResult {
  client: string
  configPath: string
  success: boolean
  error?: string
  overwritten: boolean
}

function buildServerEntry(gitlabUrl: string, pat: string, useEnvVar: boolean, envVarName: string): McpServerEntry {
  return {
    command: 'npx',
    args: ['-y', 'glab-mcp'],
    env: {
      GITLAB_URL: gitlabUrl,
      GITLAB_PAT: useEnvVar ? `\${${envVarName}}` : pat,
    },
  }
}

function readExistingConfig(configPath: string): McpConfig {
  if (!existsSync(configPath)) return {}
  try {
    const raw = readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as McpConfig
  } catch {
    return {}
  }
}

export function hasExistingGitlabEntry(client: McpClient): boolean {
  const config = readExistingConfig(client.configPath)
  return config.mcpServers?.gitlab !== undefined
}

export function writeConfig(
  client: McpClient,
  gitlabUrl: string,
  pat: string,
  useEnvVar: boolean,
  envVarName: string,
): WriteResult {
  const result: WriteResult = {
    client: client.name,
    configPath: client.configPath,
    success: false,
    overwritten: false,
  }

  try {
    // Create directory if needed
    const dir = dirname(client.configPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const config = readExistingConfig(client.configPath)
    result.overwritten = config.mcpServers?.gitlab !== undefined

    if (!config.mcpServers) {
      config.mcpServers = {}
    }
    config.mcpServers.gitlab = buildServerEntry(gitlabUrl, pat, useEnvVar, envVarName)

    writeFileSync(client.configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    result.success = true
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }

  return result
}

export function ensureGitignore(cwd: string, configFileName: string): boolean {
  const gitignorePath = join(cwd, '.gitignore')

  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8')
      const lines = content.split('\n').map(l => l.trim())
      if (lines.includes(configFileName)) return false // already present
      appendFileSync(gitignorePath, `\n${configFileName}\n`, 'utf-8')
    } else {
      writeFileSync(gitignorePath, `${configFileName}\n`, 'utf-8')
    }
    return true
  } catch {
    return false
  }
}
