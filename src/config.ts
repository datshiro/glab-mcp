export interface Config {
  url: string
  pat: string
}

export function loadConfig(): Config {
  const url = process.env.GITLAB_URL
  const pat = process.env.GITLAB_PAT

  if (!url) throw new Error('GITLAB_URL environment variable is required')
  if (!pat) throw new Error('GITLAB_PAT environment variable is required')

  return {
    url: url.replace(/\/$/, ''),
    pat,
  }
}
