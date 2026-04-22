import { GitLabClient } from '../gitlab-client.js'

function encodeId(id: number | string): string {
  return typeof id === 'string' ? encodeURIComponent(id) : String(id)
}

export async function createMrTool(
  client: GitLabClient,
  args: { project_id: number | string; source_branch: string; target_branch: string; title: string; description?: string; labels?: string }
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
        labels: args.labels,
      }),
    }
  )
  return { url: mr.web_url, iid: mr.iid }
}

export async function updateMrTool(
  client: GitLabClient,
  args: { project_id: number | string; mr_iid: number; title?: string; description?: string; labels?: string; target_branch?: string }
) {
  const body: Record<string, unknown> = {}
  if (args.title !== undefined) body.title = args.title
  if (args.description !== undefined) body.description = args.description
  if (args.labels !== undefined) body.labels = args.labels
  if (args.target_branch !== undefined) body.target_branch = args.target_branch

  const mr = await client.request<{ web_url: string; iid: number; state: string }>(
    `/api/v4/projects/${encodeId(args.project_id)}/merge_requests/${Number(args.mr_iid)}`,
    { method: 'PUT', body: JSON.stringify(body) }
  )
  return { url: mr.web_url, iid: mr.iid, state: mr.state }
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

export async function listLabelsTool(
  client: GitLabClient,
  args: { project_id: number | string; search?: string; page?: number; per_page?: number }
) {
  const params = new URLSearchParams()
  if (args.search) params.set('search', args.search)
  params.set('page', String(args.page ?? 1))
  params.set('per_page', String(args.per_page ?? 20))

  return client.request<{ name: string; color: string; description: string | null }[]>(
    `/api/v4/projects/${encodeId(args.project_id)}/labels?${params}`
  )
}

export async function commentMrTool(
  client: GitLabClient,
  args: { project_id: number | string; mr_iid: number; body: string }
) {
  return client.request<{ id: number }>(
    `/api/v4/projects/${encodeId(args.project_id)}/merge_requests/${Number(args.mr_iid)}/notes`,
    { method: 'POST', body: JSON.stringify({ body: args.body }) }
  )
}

export async function approveMrTool(
  client: GitLabClient,
  args: { project_id: number | string; mr_iid: number }
) {
  return client.request<{ approved: boolean }>(
    `/api/v4/projects/${encodeId(args.project_id)}/merge_requests/${Number(args.mr_iid)}/approve`,
    { method: 'POST' }
  )
}

export async function mergeMrTool(
  client: GitLabClient,
  args: { project_id: number | string; mr_iid: number; merge_commit_message?: string }
) {
  return client.request<{ iid: number; state: string; web_url: string }>(
    `/api/v4/projects/${encodeId(args.project_id)}/merge_requests/${Number(args.mr_iid)}/merge`,
    {
      method: 'PUT',
      body: JSON.stringify({ merge_commit_message: args.merge_commit_message }),
    }
  )
}

interface DiscussionNote {
  id: number
  author: { username: string }
  body: string
  created_at: string
  resolvable: boolean
  resolved: boolean
  position?: { new_path?: string; new_line?: number; old_path?: string; old_line?: number }
}

interface Discussion {
  id: string
  notes: DiscussionNote[]
}

export async function listMrDiscussionsTool(
  client: GitLabClient,
  args: { project_id: number | string; mr_iid: number; page?: number; per_page?: number }
) {
  const params = new URLSearchParams()
  params.set('page', String(args.page ?? 1))
  params.set('per_page', String(args.per_page ?? 20))

  return client.request<Discussion[]>(
    `/api/v4/projects/${encodeId(args.project_id)}/merge_requests/${Number(args.mr_iid)}/discussions?${params}`
  )
}

interface CommitStatus {
  name: string
  status: string
  target_url: string | null
  description: string | null
  created_at: string
}

export async function getMrStatusChecksTool(
  client: GitLabClient,
  args: { project_id: number | string; mr_iid: number; name_filter?: string }
) {
  // Fetch MR to get HEAD sha
  const mr = await client.request<{ sha: string }>(
    `/api/v4/projects/${encodeId(args.project_id)}/merge_requests/${Number(args.mr_iid)}`
  )

  // Fetch commit statuses for that sha
  const statuses = await client.request<CommitStatus[]>(
    `/api/v4/projects/${encodeId(args.project_id)}/repository/commits/${mr.sha}/statuses`
  )

  if (args.name_filter) {
    const filter = args.name_filter.toLowerCase()
    return statuses.filter(s => s.name.toLowerCase().includes(filter))
  }

  return statuses
}
