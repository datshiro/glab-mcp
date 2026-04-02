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
  if (ref) params.set('ref', ref)

  const pipelines = await client.request<Pipeline[]>(
    `/api/v4/projects/${encodeId(args.project_id)}/pipelines?${params}`
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
      const rawLog = await client.getJobTrace(job.id)
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
