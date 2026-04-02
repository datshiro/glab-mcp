import { execFile as _execFile } from 'child_process'
import { GitLabClient, GitLabError } from '../gitlab-client.js'

const SECRET_PATTERNS = [
  /^\.env$/,
  /^\.env\./,
  /\.pem$/,
  /\.key$/,
  /^id_rsa/,
  /credentials\.json$/,
  /\.p12$/,
]

function isSecretFile(filename: string): boolean {
  const base = filename.split('/').pop() ?? filename
  return SECRET_PATTERNS.some(p => p.test(base))
}

function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    _execFile('git', args, { cwd }, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

function encodeId(id: number | string): string {
  return typeof id === 'string' ? encodeURIComponent(id) : String(id)
}

export async function shipMrTool(
  client: GitLabClient,
  args: {
    project_id: number | string
    target_branch: string
    title: string
    commit_message?: string
    description?: string
    working_dir?: string
  }
): Promise<{ url: string; iid: number; pipeline_id: number | null }> {
  const cwd = args.working_dir ?? process.cwd()

  // Check working tree
  const { stdout: statusOut } = await git(['status', '--porcelain'], cwd)
  if (!statusOut.trim()) {
    throw new Error('Nothing to commit — working tree is clean')
  }

  // Check for secret files before staging
  const lines = statusOut.trim().split('\n')
  const suspiciousFiles: string[] = []
  for (const line of lines) {
    const filepath = line.slice(3).trim()
    if (isSecretFile(filepath)) {
      suspiciousFiles.push(filepath)
    }
  }
  if (suspiciousFiles.length > 0) {
    throw new Error(
      `Aborting: suspicious files detected before staging: ${suspiciousFiles.join(', ')}`
    )
  }

  // Stage all changes
  await git(['add', '-A'], cwd)

  // Get current branch name
  const { stdout: branchOut } = await git(['branch', '--show-current'], cwd)
  const branch = branchOut.trim()

  // Commit
  const message = args.commit_message ?? args.title
  await git(['commit', '-m', message], cwd)

  // Push
  await git(['push', '-u', 'origin', branch], cwd)

  // Create MR
  const mr = await client.request<{ web_url: string; iid: number }>(
    `/api/v4/projects/${encodeId(args.project_id)}/merge_requests`,
    {
      method: 'POST',
      body: JSON.stringify({
        source_branch: branch,
        target_branch: args.target_branch,
        title: args.title,
        description: args.description,
      }),
    }
  )

  // Wait for pipeline to appear (retry up to 5 times with 2s delay)
  const pipeline_id = await pollForPipeline(client, args.project_id, mr.iid)

  return { url: mr.web_url, iid: mr.iid, pipeline_id }
}

async function pollForPipeline(
  client: GitLabClient,
  projectId: number | string,
  mrIid: number,
  maxAttempts = 5,
  delayMs = 2000
): Promise<number | null> {
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) {
      await new Promise(r => setTimeout(r, delayMs))
    }
    const pipelines = await client.request<{ id: number }[]>(
      `/api/v4/projects/${encodeId(projectId)}/merge_requests/${mrIid}/pipelines`
    )
    if (pipelines.length > 0) {
      return pipelines[0].id
    }
  }
  return null
}

interface PipelineResult {
  status: string
  pipeline_id?: number
  url?: string
  errors?: { job: string; stage: string; log: string }[]
  message?: string
}

export async function watchPipelineTool(
  client: GitLabClient,
  args: { project_id: number | string; pipeline_id: number; timeout_minutes?: number }
): Promise<PipelineResult> {
  const timeoutMs = (args.timeout_minutes ?? 30) * 60 * 1000
  const pollIntervalMs = 10_000
  const deadline = Date.now() + timeoutMs
  const maxApiErrors = 3
  let apiErrors = 0

  const TERMINAL = ['success', 'failed', 'canceled', 'skipped']

  while (true) {
    try {
      const pipeline = await client.request<{ id: number; status: string; web_url: string }>(
        `/api/v4/projects/${encodeId(args.project_id)}/pipelines/${args.pipeline_id}`
      )

      if (TERMINAL.includes(pipeline.status)) {
        if (pipeline.status === 'failed') {
          const errors = await getFailedJobErrors(client, args.project_id, args.pipeline_id)
          return { status: 'failed', pipeline_id: pipeline.id, url: pipeline.web_url, errors }
        }
        return { status: pipeline.status, pipeline_id: pipeline.id, url: pipeline.web_url }
      }

      // Reset error count on success
      apiErrors = 0
    } catch (err) {
      apiErrors++
      if (apiErrors >= maxApiErrors) {
        const msg = err instanceof Error ? err.message : String(err)
        return { status: 'error', message: msg }
      }
    }

    if (Date.now() >= deadline) {
      // Fetch current state for timeout response
      try {
        const pipeline = await client.request<{ id: number; status: string; web_url: string }>(
          `/api/v4/projects/${encodeId(args.project_id)}/pipelines/${args.pipeline_id}`
        )
        return { status: 'timeout', pipeline_id: pipeline.id, url: pipeline.web_url }
      } catch {
        return { status: 'timeout', pipeline_id: args.pipeline_id }
      }
    }

    await new Promise(r => setTimeout(r, pollIntervalMs))
  }
}

async function getFailedJobErrors(
  client: GitLabClient,
  projectId: number | string,
  pipelineId: number
) {
  const jobs = await client.request<{ id: number; name: string; status: string; stage: string }[]>(
    `/api/v4/projects/${encodeId(projectId)}/pipelines/${pipelineId}/jobs`
  )
  const failed = jobs.filter(j => j.status === 'failed')
  return Promise.all(
    failed.map(async job => {
      const log = await client.getJobTrace(projectId, job.id)
      return { job: job.name, stage: job.stage, log }
    })
  )
}
