import { GitLabClient } from '../gitlab-client.js'
import {
  MARKER_RE,
  computeHash,
  renderBody,
  type Finding,
} from './mr-review-helpers.js'

export interface ExistingThread {
  discussion_id: string
  note_id: number
  body: string
  resolved: boolean
}

interface DiscussionNote {
  id: number
  body: string
  resolvable: boolean
  resolved: boolean
}

interface Discussion {
  id: string
  notes: DiscussionNote[]
}

function encodeId(id: number | string): string {
  return typeof id === 'string' ? encodeURIComponent(id) : String(id)
}

export function extractToolThreads(discussions: Discussion[]): Map<string, ExistingThread> {
  const out = new Map<string, ExistingThread>()
  for (const d of discussions) {
    const root = d.notes?.[0]
    if (!root) continue
    const m = root.body.match(MARKER_RE)
    if (!m) continue
    out.set(m[1], {
      discussion_id: d.id,
      note_id: root.id,
      body: root.body,
      resolved: root.resolved,
    })
  }
  return out
}

const MAX_PAGES = 10
const PAGE_SIZE = 100

export async function fetchAllDiscussions(
  client: GitLabClient,
  projectId: number | string,
  mrIid: number,
): Promise<Discussion[]> {
  const all: Discussion[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await client.request<Discussion[]>(
      `/api/v4/projects/${encodeId(projectId)}/merge_requests/${mrIid}/discussions?page=${page}&per_page=${PAGE_SIZE}`,
    )
    all.push(...batch)
    if (batch.length < PAGE_SIZE) return all
  }
  return all
}

export async function updateDiscussionNote(
  client: GitLabClient,
  projectId: number | string,
  mrIid: number,
  discussionId: string,
  noteId: number,
  body: string,
): Promise<void> {
  await client.request(
    `/api/v4/projects/${encodeId(projectId)}/merge_requests/${mrIid}/discussions/${discussionId}/notes/${noteId}`,
    { method: 'PUT', body: JSON.stringify({ body }) },
  )
}

export async function resolveDiscussion(
  client: GitLabClient,
  projectId: number | string,
  mrIid: number,
  discussionId: string,
): Promise<void> {
  await client.request(
    `/api/v4/projects/${encodeId(projectId)}/merge_requests/${mrIid}/discussions/${discussionId}?resolved=true`,
    { method: 'PUT', body: JSON.stringify({ resolved: true }) },
  )
}

export interface ReconcileBuckets {
  unchanged: Finding[]
  updated: Array<{ f: Finding; thread: ExistingThread }>
  toPost: Finding[]
  stale: Array<{ hash: string; thread: ExistingThread }>
}

export function reconcile(
  newFindings: Finding[],
  existingByHash: Map<string, ExistingThread>,
): ReconcileBuckets {
  const buckets: ReconcileBuckets = { unchanged: [], updated: [], toPost: [], stale: [] }
  const seenHashes = new Set<string>()
  for (const f of newFindings) {
    const hash = computeHash(f)
    seenHashes.add(hash)
    const existing = existingByHash.get(hash)
    if (!existing) {
      buckets.toPost.push(f)
      continue
    }
    if (existing.resolved) {
      buckets.unchanged.push(f)
      continue
    }
    const newBody = renderBody(f, hash)
    if (existing.body === newBody) buckets.unchanged.push(f)
    else buckets.updated.push({ f, thread: existing })
  }
  for (const [hash, thread] of existingByHash) {
    if (seenHashes.has(hash)) continue
    if (thread.resolved) continue
    buckets.stale.push({ hash, thread })
  }
  return buckets
}
