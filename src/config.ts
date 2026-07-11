export interface Config {
  url: string
  pat: string
}

export function loadConfig(): Config {
  const url = process.env.GITLAB_URL
  const patEnvVarName = process.env.GITLAB_PAT_ENV_VAR
  const pat = process.env.GITLAB_PAT ?? (patEnvVarName ? process.env[patEnvVarName] : undefined)

  if (!url) throw new Error('GITLAB_URL environment variable is required')
  if (!pat) {
    const variableName = patEnvVarName ?? 'GITLAB_PAT'
    throw new Error(`${variableName} environment variable is required`)
  }

  return {
    url: url.replace(/\/$/, ''),
    pat,
  }
}
