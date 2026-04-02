import { relative } from 'path'
import { input, select, checkbox, confirm, password } from '@inquirer/prompts'
import { detectClients, type McpClient } from './detect-clients.js'
import { validateGitLabCredentials } from './validate-gitlab.js'
import { writeConfig, hasExistingGitlabEntry, ensureGitignore } from './config-writer.js'

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

export async function runInit(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error('Error: glab-mcp init requires an interactive terminal.')
    console.error('For non-interactive setup, configure .mcp.json manually (see README).')
    process.exit(1)
  }

  console.log()
  console.log(bold('glab-mcp setup') + ' — Connect your AI assistant to GitLab')
  console.log()

  // Step 1: GitLab URL
  const gitlabUrl = await input({
    message: 'GitLab URL:',
    default: 'https://gitlab.com',
    validate: (value) => {
      try {
        const u = new URL(value)
        if (!['http:', 'https:'].includes(u.protocol)) {
          return 'URL must use http:// or https://'
        }
        return true
      } catch {
        return 'Please enter a valid URL (e.g. https://gitlab.com)'
      }
    },
  })

  // Step 2: Credential mode
  const credentialMode = await select({
    message: 'How do you want to provide your GitLab PAT?',
    choices: [
      { value: 'direct' as const, name: 'Enter PAT directly (I\'ll paste it now)' },
      { value: 'envvar' as const, name: 'Use environment variable (I have it set in my shell)' },
    ],
  })

  let pat = ''
  let useEnvVar = false
  let envVarName = 'GITLAB_PAT'

  if (credentialMode === 'direct') {
    // Direct PAT entry with validation
    let validated = false
    while (!validated) {
      pat = await password({
        message: 'GitLab Personal Access Token:',
        mask: '*',
        validate: (value) => value.length > 0 || 'PAT cannot be empty',
      })

      console.log(dim('  Validating credentials...'))
      const result = await validateGitLabCredentials(gitlabUrl, pat)

      if (result.valid) {
        console.log(green(`  Authenticated as @${result.username}`))
        validated = true
      } else {
        console.log(red(`  ${result.error}`))
        const retry = await confirm({ message: 'Try again?', default: true })
        if (!retry) {
          console.log('Setup cancelled.')
          process.exit(0)
        }
      }
    }
  } else {
    // Environment variable mode
    envVarName = await input({
      message: 'Environment variable name:',
      default: 'GITLAB_PAT',
      validate: (value) => /^[A-Z_][A-Z0-9_]*$/i.test(value) || 'Must be a valid env var name (letters, digits, underscores)',
    })
    useEnvVar = true

    const envValue = process.env[envVarName]
    if (envValue) {
      console.log(dim('  Validating credentials from environment...'))
      const result = await validateGitLabCredentials(gitlabUrl, envValue)
      if (result.valid) {
        console.log(green(`  Authenticated as @${result.username}`))
      } else {
        console.log(red(`  Warning: ${result.error}`))
        console.log(dim('  Config will be written anyway. Fix the env var before using glab-mcp.'))
      }
    } else {
      console.log(red(`  Warning: $${envVarName} is not set in your current shell.`))
      console.log(dim(`  Set it before using glab-mcp: export ${envVarName}=glpat-xxxx`))
    }
  }

  // Step 3: Detect and select clients
  const cwd = process.cwd()
  const allClients = detectClients(cwd)
  const detectedClients = allClients.filter(c => c.detected)

  if (detectedClients.length === 0) {
    console.log(dim('  No AI clients detected. Showing all options.'))
  }

  const clientChoices = allClients.map(c => ({
    value: c,
    name: `${c.name}${c.detected ? ' (detected)' : ''}`,
    checked: c.detected,
  }))

  const selectedClients: McpClient[] = await checkbox({
    message: 'Which clients should I configure?',
    choices: clientChoices,
    validate: (choices) => choices.length > 0 || 'Select at least one client',
  })

  // Step 4: Check for existing configs and write
  console.log()
  const results = []
  const projectScopedClients: string[] = []

  for (const client of selectedClients) {
    if (hasExistingGitlabEntry(client)) {
      const overwrite = await confirm({
        message: `${client.name}: Existing gitlab config found. Overwrite?`,
        default: true,
      })
      if (!overwrite) {
        console.log(dim(`  Skipped ${client.name}`))
        continue
      }
    }

    const result = writeConfig(client, gitlabUrl, pat, useEnvVar, envVarName)
    results.push(result)

    if (result.success) {
      console.log(green(`  ✓ ${client.name}`) + dim(` → ${result.configPath}`))
      if (client.scope === 'project') {
        projectScopedClients.push(relative(cwd, client.configPath))
      }
      if (!useEnvVar && client.scope === 'global') {
        console.log(dim(`  Note: PAT written in plaintext to ${result.configPath}. Consider using env var mode.`))
      }
    } else {
      console.log(red(`  ✗ ${client.name}: ${result.error}`))
    }
  }

  // Step 5: Auto-gitignore for direct PAT + project-scoped configs
  if (!useEnvVar && projectScopedClients.length > 0) {
    for (const configFile of projectScopedClients) {
      if (configFile && ensureGitignore(cwd, configFile)) {
        console.log(dim(`  Added ${configFile} to .gitignore (contains your PAT)`))
      }
    }
  }

  // Step 6: Success message
  const successCount = results.filter(r => r.success).length
  if (successCount > 0) {
    console.log()
    console.log(green(bold('Done!')) + ` glab-mcp is configured for ${successCount} client${successCount > 1 ? 's' : ''}.`)
    console.log(dim('Restart your AI client to pick up the changes.'))
    if (useEnvVar) {
      console.log(dim(`Make sure $${envVarName} is set in your shell.`))
    }
  } else {
    console.log()
    console.log(red('No clients were configured. Run glab-mcp init again to retry.'))
  }

  console.log()
}
