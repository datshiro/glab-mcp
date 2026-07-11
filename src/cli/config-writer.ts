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
  const env: Record<string, string> = { GITLAB_URL: gitlabUrl }
  if (useEnvVar) {
    env.GITLAB_PAT_ENV_VAR = envVarName
  } else {
    env.GITLAB_PAT = pat
  }

  return {
    command: 'npx',
    args: ['-y', 'glab-mcp'],
    env,
  }
}

export class MalformedConfigError extends Error {
  constructor(configPath: string) {
    super(`Existing config file is malformed JSON: ${configPath}\nFix the file manually or delete it and re-run glab-mcp init.`)
    this.name = 'MalformedConfigError'
  }
}

function readExistingJsonConfig(configPath: string): McpConfig {
  if (!existsSync(configPath)) return {}
  const raw = readFileSync(configPath, 'utf-8')
  if (raw.trim() === '') return {}
  try {
    return JSON.parse(raw) as McpConfig
  } catch {
    throw new MalformedConfigError(configPath)
  }
}

const CODEX_GITLAB_TABLE = 'mcp_servers.gitlab'

function hasTomlTable(content: string, table: string): boolean {
  const header = new RegExp(`^\\s*\\[${table.replace('.', '\\.')}]\\s*(?:#.*)?$`, 'm')
  return header.test(content)
}

function removeTomlTable(content: string, table: string): string {
  let skipTable = false
  const retainedLines = content.split(/\r?\n/).filter((line) => {
    const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/)
    if (match) {
      skipTable = match[1] === table || match[1].startsWith(`${table}.`)
    }
    return !skipTable
  })

  return retainedLines.join('\n').trimEnd()
}

function buildCodexConfig(existingContent: string, gitlabUrl: string, pat: string, useEnvVar: boolean, envVarName: string): string {
  const entry = buildServerEntry(gitlabUrl, pat, useEnvVar, envVarName)
  const existing = removeTomlTable(existingContent, CODEX_GITLAB_TABLE)
  const lines = [
    `[${CODEX_GITLAB_TABLE}]`,
    `command = ${JSON.stringify(entry.command)}`,
    `args = ${JSON.stringify(entry.args)}`,
    '',
    `[${CODEX_GITLAB_TABLE}.env]`,
    ...Object.entries(entry.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
  ]

  return `${existing ? `${existing}\n\n` : ''}${lines.join('\n')}\n`
}

export function hasExistingGitlabEntry(client: McpClient): boolean {
  if (client.configFormat === 'toml') {
    return existsSync(client.configPath) && hasTomlTable(readFileSync(client.configPath, 'utf-8'), CODEX_GITLAB_TABLE)
  }

  const config = readExistingJsonConfig(client.configPath)
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

    let content: string
    if (client.configFormat === 'toml') {
      const existing = existsSync(client.configPath) ? readFileSync(client.configPath, 'utf-8') : ''
      result.overwritten = hasTomlTable(existing, CODEX_GITLAB_TABLE)
      content = buildCodexConfig(existing, gitlabUrl, pat, useEnvVar, envVarName)
    } else {
      const config = readExistingJsonConfig(client.configPath)
      result.overwritten = config.mcpServers?.gitlab !== undefined

      if (!config.mcpServers) {
        config.mcpServers = {}
      }
      config.mcpServers.gitlab = buildServerEntry(gitlabUrl, pat, useEnvVar, envVarName)
      content = JSON.stringify(config, null, 2) + '\n'
    }

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
