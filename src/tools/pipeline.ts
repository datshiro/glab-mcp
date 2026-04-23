import { GitLabClient } from '../gitlab-client.js'

function encodeId(id: number | string): string {
  return typeof id === 'string' ? encodeURIComponent(id) : String(id)
}

interface Pipeline {
  id: number
  status: string
  web_url: string
}

interface Job {
  id: number
  name: string
  status: string
  stage: string
}

export async function getPipelineStatusTool(
  client: GitLabClient,
  args: { project_id: number | string; ref?: string; working_dir?: string }
): Promise<Pipeline | null> {
  let ref = args.ref
  if (!ref && args.working_dir) {
    // Caller passes working_dir for auto-detect; actual git call is done in workflow layer
    // For pure API tools, ref is required when working_dir git detection is not possible
  }
  const params = new URLSearchParams({ per_page: '1', order_by: 'id', sort: 'desc' })
  // Append ref without encoding slashes — GitLab matches branch names literally
  // and some instances don't decode %2F in query params, causing null results.
  const refSuffix = ref ? `&ref=${ref.split('/').map(encodeURIComponent).join('/')}` : ''

  const pipelines = await client.request<Pipeline[]>(
    `/api/v4/projects/${encodeId(args.project_id)}/pipelines?${params}${refSuffix}`
  )
  return pipelines[0] ?? null
}

export async function getPipelineErrorsTool(
  client: GitLabClient,
  args: { project_id: number | string; pipeline_id: number; tail_lines?: number }
) {
  const tailLines = args.tail_lines ?? 100
  const jobs = await client.request<Job[]>(
    `/api/v4/projects/${encodeId(args.project_id)}/pipelines/${args.pipeline_id}/jobs`
  )

  const failedJobs = jobs.filter(j => j.status === 'failed')
  const results = await Promise.all(
    failedJobs.map(async job => {
      const rawLog = await client.getJobTrace(args.project_id, job.id)
      const lines = rawLog.split('\n')
      const log = lines.slice(-tailLines).join('\n')
      return { job: job.name, stage: job.stage, log }
    })
  )
  return results
}

export async function listPipelineJobsTool(
  client: GitLabClient,
  args: { project_id: number | string; pipeline_id: number }
) {
  return client.request<Job[]>(
    `/api/v4/projects/${encodeId(args.project_id)}/pipelines/${args.pipeline_id}/jobs`
  )
}

export async function retryPipelineTool(
  client: GitLabClient,
  args: { project_id: number | string; pipeline_id: number }
) {
  return client.request<Pipeline>(
    `/api/v4/projects/${encodeId(args.project_id)}/pipelines/${args.pipeline_id}/retry`,
    { method: 'POST' }
  )
}

interface JobDetail {
  id: number
  name: string
  status: string
  stage: string
  duration: number | null
  started_at: string | null
  finished_at: string | null
  coverage: number | null
  web_url: string
  runner: { id: number; description: string } | null
  artifacts_file: { filename: string; size: number } | null
}

export async function getJobDetailTool(
  client: GitLabClient,
  args: { project_id: number | string; job_id: number; include_trace?: boolean; tail_lines?: number }
) {
  const job = await client.request<JobDetail>(
    `/api/v4/projects/${encodeId(args.project_id)}/jobs/${args.job_id}`
  )

  if (args.include_trace) {
    const tailLines = args.tail_lines ?? 100
    const rawLog = await client.getJobTrace(args.project_id, args.job_id)
    const lines = rawLog.split('\n')
    const trace = lines.slice(-tailLines).join('\n')
    return { ...job, trace }
  }

  return job
}

// Trigger a manual job (e.g. deploy-stag-sea)
export async function playJobTool(
  client: GitLabClient,
  args: { project_id: number | string; job_id: number }
) {
  return client.request<JobDetail>(
    `/api/v4/projects/${encodeId(args.project_id)}/jobs/${args.job_id}/play`,
    { method: 'POST' }
  )
}

// Poll a single job until it reaches a terminal state
interface WatchJobResult {
  status: string
  job_id: number
  name?: string
  stage?: string
  web_url?: string
  duration?: number | null
  trace?: string
  message?: string
}

export async function watchJobTool(
  client: GitLabClient,
  args: { project_id: number | string; job_id: number; timeout_minutes?: number; include_trace_on_failure?: boolean }
): Promise<WatchJobResult> {
  const timeoutMs = (args.timeout_minutes ?? 30) * 60 * 1000
  const pollIntervalMs = 10_000
  const deadline = Date.now() + timeoutMs
  const maxApiErrors = 3
  let apiErrors = 0

  const TERMINAL = ['success', 'failed', 'canceled', 'skipped']

  while (true) {
    try {
      const job = await client.request<JobDetail>(
        `/api/v4/projects/${encodeId(args.project_id)}/jobs/${args.job_id}`
      )

      if (TERMINAL.includes(job.status)) {
        const result: WatchJobResult = {
          status: job.status,
          job_id: job.id,
          name: job.name,
          stage: job.stage,
          web_url: job.web_url,
          duration: job.duration,
        }

        if (job.status === 'failed' && args.include_trace_on_failure !== false) {
          const rawLog = await client.getJobTrace(args.project_id, args.job_id)
          const lines = rawLog.split('\n')
          result.trace = lines.slice(-100).join('\n')
        }

        return result
      }

      apiErrors = 0
    } catch (err) {
      apiErrors++
      if (apiErrors >= maxApiErrors) {
        const msg = err instanceof Error ? err.message : String(err)
        return { status: 'error', job_id: args.job_id, message: msg }
      }
    }

    if (Date.now() >= deadline) {
      try {
        const job = await client.request<JobDetail>(
          `/api/v4/projects/${encodeId(args.project_id)}/jobs/${args.job_id}`
        )
        return {
          status: 'timeout', job_id: job.id, name: job.name, stage: job.stage,
          web_url: job.web_url,
          message: `Timed out after ${args.timeout_minutes ?? 30} minutes (last status: ${job.status})`,
        }
      } catch {
        return { status: 'timeout', job_id: args.job_id, message: `Timed out after ${args.timeout_minutes ?? 30} minutes` }
      }
    }

    await new Promise(r => setTimeout(r, pollIntervalMs))
  }
}
