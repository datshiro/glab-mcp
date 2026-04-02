import { GitLabClient } from '../gitlab-client.js'

function encodeId(id: number | string): string {
  return typeof id === 'string' ? encodeURIComponent(id) : String(id)
}

export async function createMrTool(
  client: GitLabClient,
  args: { project_id: number | string; source_branch: string; target_branch: string; title: string; description?: string }
) {
  const mr = await client.request<{ web_url: string; iid: number }>(
    `/api/v4/projects/${encodeId(args.project_id)}/merge_requests`,
    {
      method: 'POST',
      body: JSON.stringify({
        source_branch: args.source_branch,
        target_branch: args.target_branch,
        title: args.title,
        description: args.description,
      }),
    }
  )
  return { url: mr.web_url, iid: mr.iid }
}

export async function listMrsTool(
  client: GitLabClient,
  args: { project_id: number | string; state?: string; author?: string; labels?: string; page?: number; per_page?: number }
) {
  const params = new URLSearchParams()
  if (args.state) params.set('state', args.state)
  if (args.author) params.set('author_username', args.author)
  if (args.labels) params.set('labels', args.labels)
  params.set('page', String(args.page ?? 1))
  params.set('per_page', String(args.per_page ?? 20))

  return client.request<{ iid: number; title: string; web_url: string; state: string }[]>(
    `/api/v4/projects/${encodeId(args.project_id)}/merge_requests?${params}`
  )
}

export async function commentMrTool(
  client: GitLabClient,
  args: { project_id: number | string; mr_iid: number; body: string }
) {
  return client.request<{ id: number }>(
    `/api/v4/projects/${encodeId(args.project_id)}/merge_requests/${args.mr_iid}/notes`,
    { method: 'POST', body: JSON.stringify({ body: args.body }) }
  )
}

export async function approveMrTool(
  client: GitLabClient,
  args: { project_id: number | string; mr_iid: number }
) {
  return client.request<{ approved: boolean }>(
    `/api/v4/projects/${encodeId(args.project_id)}/merge_requests/${args.mr_iid}/approve`,
    { method: 'POST' }
  )
}

export async function mergeMrTool(
  client: GitLabClient,
  args: { project_id: number | string; mr_iid: number; merge_commit_message?: string }
) {
  return client.request<{ iid: number; state: string; web_url: string }>(
    `/api/v4/projects/${encodeId(args.project_id)}/merge_requests/${args.mr_iid}/merge`,
    {
      method: 'PUT',
      body: JSON.stringify({ merge_commit_message: args.merge_commit_message }),
    }
  )
}
