export class GitLabError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message)
    this.name = 'GitLabError'
  }
}

function redact(text: string, pat: string): string {
  return text.replace(new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[REDACTED]')
}

const BACKOFF_MS = [1000, 2000, 4000]

export class GitLabClient {
  constructor(
    private readonly baseUrl: string,
    private readonly pat: string
  ) {}

  async request<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers = {
      'Private-Token': this.pat,
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string> ?? {}),
    }

    for (let attempt = 0; attempt <= 3; attempt++) {
      let response: Response
      try {
        response = await fetch(url, { ...opts, headers })
      } catch (e) {
        throw new GitLabError(`Network error: ${(e as Error).message}`, 0)
      }

      if (response.status === 429 && attempt < 3) {
        await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]))
        continue
      }

      if (!response.ok) {
        let message: string
        try {
          const body = await response.json() as { message?: string }
          message = body.message ?? `HTTP ${response.status}`
        } catch {
          message = `HTTP ${response.status}`
        }
        throw new GitLabError(
          redact(`GitLab API error ${response.status}: ${message}`, this.pat),
          response.status
        )
      }

      return response.json() as Promise<T>
    }

    throw new GitLabError('GitLab API error 429: Rate limit exceeded after 3 retries', 429)
  }

  async getJobTrace(jobId: number, tailBytes = 8192): Promise<string> {
    const url = `${this.baseUrl}/api/v4/jobs/${jobId}/trace`
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          'Private-Token': this.pat,
          Range: `bytes=-${tailBytes}`,
        },
      })
    } catch (e) {
      throw new GitLabError(`Network error: ${(e as Error).message}`, 0)
    }

    if (!response.ok && response.status !== 206) {
      throw new GitLabError(`GitLab API error ${response.status}: failed to fetch job trace`, response.status)
    }

    return response.text()
  }
}
