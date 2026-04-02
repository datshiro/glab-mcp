export interface ValidationResult {
  valid: boolean
  username?: string
  error?: string
}

export async function validateGitLabCredentials(url: string, pat: string): Promise<ValidationResult> {
  const apiUrl = `${url.replace(/\/$/, '')}/api/v4/user`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(apiUrl, {
      headers: { 'PRIVATE-TOKEN': pat },
      signal: controller.signal,
    })

    if (response.ok) {
      const data = await response.json() as { username: string }
      return { valid: true, username: data.username }
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid token. Check that your PAT has the "api" scope.' }
    }

    return { valid: false, error: `GitLab API returned ${response.status}: ${response.statusText}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { valid: false, error: `Could not reach ${url}: ${message}` }
  } finally {
    clearTimeout(timeout)
  }
}
