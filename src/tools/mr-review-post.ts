import { GitLabClient, GitLabError } from '../gitlab-client.js'
import {
  buildPosition,
  computeHash,
  findingLine,
  renderBody,
  type DiffRefs,
  type Finding,
} from './mr-review-helpers.js'

export interface FindingResult {
  file: string
  line: number
  hash: string
}

export interface FallbackResult {
  file: string
  line: number
  reason: 'off-diff' | '400' | 'unparseable-markdown'
}

export interface FailedResult {
  file: string
  line: number
  error: string
}

export type Outcome =
  | { kind: 'inline'; result: FindingResult }
  | { kind: 'fallback'; result: FallbackResult }
  | { kind: 'failed'; result: FailedResult }

function encodeId(id: number | string): string {
  return typeof id === 'string' ? encodeURIComponent(id) : String(id)
}

export async function postNote(
  client: GitLabClient,
  projectId: number | string,
  mrIid: number,
  body: string,
): Promise<{ id: number }> {
  return client.request<{ id: number }>(
    `/api/v4/projects/${encodeId(projectId)}/merge_requests/${mrIid}/notes`,
    { method: 'POST', body: JSON.stringify({ body }) },
  )
}

function fallbackBody(f: Finding, hash: string): string {
  return `📌 \`${f.file}:${findingLine(f)}\` (not in diff)\n\n${renderBody(f, hash)}`
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

export async function postOneFinding(
  client: GitLabClient,
  projectId: number | string,
  mrIid: number,
  f: Finding,
  refs: DiffRefs,
  diffFiles: Set<string>,
): Promise<Outcome> {
  const hash = computeHash(f)
  const line = findingLine(f)
  if (diffFiles.has(f.file)) {
    try {
      await client.request(
        `/api/v4/projects/${encodeId(projectId)}/merge_requests/${mrIid}/discussions`,
        { method: 'POST', body: JSON.stringify({ body: renderBody(f, hash), position: buildPosition(f, refs) }) },
      )
      return { kind: 'inline', result: { file: f.file, line, hash } }
    } catch (e) {
      if (e instanceof GitLabError && e.statusCode === 400) {
        try {
          await postNote(client, projectId, mrIid, fallbackBody(f, hash))
          return { kind: 'fallback', result: { file: f.file, line, reason: '400' } }
        } catch (e2) {
          return { kind: 'failed', result: { file: f.file, line, error: (e2 as Error).message } }
        }
      }
      return { kind: 'failed', result: { file: f.file, line, error: (e as Error).message } }
    }
  }
  try {
    await postNote(client, projectId, mrIid, fallbackBody(f, hash))
    return { kind: 'fallback', result: { file: f.file, line, reason: 'off-diff' } }
  } catch (e) {
    return { kind: 'failed', result: { file: f.file, line, error: (e as Error).message } }
  }
}
