import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, chmodSync } from 'fs'
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

export class MalformedConfigError extends Error {
  constructor(configPath: string) {
    super(`Existing config file is malformed JSON: ${configPath}\nFix the file manually or delete it and re-run glab-mcp init.`)
    this.name = 'MalformedConfigError'
  }
}

function readExistingConfig(configPath: string): McpConfig {
  if (!existsSync(configPath)) return {}
  const raw = readFileSync(configPath, 'utf-8')
  if (raw.trim() === '') return {}
  try {
    return JSON.parse(raw) as McpConfig
  } catch {
    throw new MalformedConfigError(configPath)
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

    const content = JSON.stringify(config, null, 2) + '\n'
    writeFileSync(client.configPath, content, { encoding: 'utf-8', mode: useEnvVar ? 0o644 : 0o600 })
    if (!useEnvVar) {
      // Ensure restrictive permissions even if file already existed
      chmodSync(client.configPath, 0o600)
    }
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
