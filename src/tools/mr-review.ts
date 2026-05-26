import { GitLabClient } from '../gitlab-client.js'
import {
  computeHash,
  findingLine,
  parseMarkdownReport,
  renderBody,
  type DiffRefs,
  type Finding,
} from './mr-review-helpers.js'
import {
  extractToolThreads,
  fetchAllDiscussions,
  reconcile,
  resolveDiscussion,
  updateDiscussionNote,
} from './mr-review-reconcile.js'
import {
  postNote,
  postOneFinding,
  runWithConcurrency,
  type FailedResult,
  type FallbackResult,
  type FindingResult,
} from './mr-review-post.js'

export * from './mr-review-helpers.js'
export type { FailedResult, FallbackResult, FindingResult } from './mr-review-post.js'

function encodeId(id: number | string): string {
  return typeof id === 'string' ? encodeURIComponent(id) : String(id)
}

export interface PostReviewFindingsArgs {
  project_id: number | string
  mr_iid: number
  findings?: Finding[]
  report_markdown?: string
  dedupe?: boolean
  auto_resolve_stale?: boolean
  concurrency?: number
}

export interface PostReviewFindingsResult {
  inline: FindingResult[]
  updated: FindingResult[]
  unchanged: FindingResult[]
  fallback: FallbackResult[]
  auto_resolved: FindingResult[]
  failed: FailedResult[]
}

interface MrPayload {
  diff_refs: DiffRefs
}

interface DiffEntry {
  new_path?: string
  old_path?: string
}

function emptyResult(): PostReviewFindingsResult {
  return { inline: [], updated: [], unchanged: [], fallback: [], auto_resolved: [], failed: [] }
}

function diffFileSet(diffs: DiffEntry[]): Set<string> {
  const s = new Set<string>()
  for (const d of diffs) {
    if (d.new_path) s.add(d.new_path)
    if (d.old_path) s.add(d.old_path)
  }
  return s
}

export async function postReviewFindingsTool(
  client: GitLabClient,
  args: PostReviewFindingsArgs,
): Promise<PostReviewFindingsResult> {
  const projectId = args.project_id
  const mrIid = Number(args.mr_iid)
  const result = emptyResult()

  let findings = args.findings ?? []
  if (findings.length === 0 && args.report_markdown) {
    findings = parseMarkdownReport(args.report_markdown)
    if (findings.length === 0) {
      await postNote(client, projectId, mrIid, args.report_markdown)
      result.fallback.push({ url: '', file: '(report)', line: 0, reason: 'unparseable-markdown' })
      return result
    }
  }
  const dedupe = args.dedupe !== false
  const autoResolveStale = args.auto_resolve_stale !== false
  if (findings.length === 0 && !dedupe) return result

  const [mr, diffs, existingDiscussions] = await Promise.all([
    client.request<MrPayload>(`/api/v4/projects/${encodeId(projectId)}/merge_requests/${mrIid}`),
    client.request<DiffEntry[]>(`/api/v4/projects/${encodeId(projectId)}/merge_requests/${mrIid}/diffs`),
    dedupe ? fetchAllDiscussions(client, projectId, mrIid) : Promise.resolve([]),
  ])
  const diffFiles = diffFileSet(diffs)
  const existingByHash = dedupe ? extractToolThreads(existingDiscussions) : new Map()
  const buckets = dedupe
    ? reconcile(findings, existingByHash)
    : { unchanged: [] as Finding[], updated: [], toPost: findings, stale: [] }

  for (const f of buckets.unchanged) {
    result.unchanged.push({ url: '', file: f.file, line: findingLine(f), hash: computeHash(f) })
  }

  const concurrency = args.concurrency ?? 4
  await runWithConcurrency(buckets.updated, concurrency, async ({ f, thread }) => {
    const hash = computeHash(f)
    try {
      await updateDiscussionNote(client, projectId, mrIid, thread.discussion_id, thread.note_id, renderBody(f, hash))
      result.updated.push({ url: '', file: f.file, line: findingLine(f), hash })
    } catch (e) {
      result.failed.push({ file: f.file, line: findingLine(f), error: (e as Error).message })
    }
  })

  const outcomes = await runWithConcurrency(buckets.toPost, concurrency, f =>
    postOneFinding(client, projectId, mrIid, f, mr.diff_refs, diffFiles),
  )
  for (const o of outcomes) {
    if (o.kind === 'inline') result.inline.push(o.result)
    else if (o.kind === 'fallback') result.fallback.push(o.result)
    else result.failed.push(o.result)
  }

  if (autoResolveStale) {
    await runWithConcurrency(buckets.stale, concurrency, async ({ hash, thread }) => {
      try {
        await resolveDiscussion(client, projectId, mrIid, thread.discussion_id)
        result.auto_resolved.push({ url: '', file: '(stale)', line: 0, hash })
      } catch (e) {
        result.failed.push({ file: '(stale)', line: 0, error: (e as Error).message })
      }
    })
  }
  return result
}
