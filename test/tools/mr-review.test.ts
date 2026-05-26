import { describe, it, expect, vi } from 'vitest'
import { GitLabClient, GitLabError } from '../../src/gitlab-client.js'
import {
  computeHash,
  renderBody,
  buildPosition,
  parseMarkdownReport,
  postReviewFindingsTool,
  type Finding,
  type DiffRefs,
} from '../../src/tools/mr-review.js'
import { extractToolThreads } from '../../src/tools/mr-review-reconcile.js'

function mrPayload(overrides: Record<string, unknown> = {}) {
  return {
    diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'h' },
    ...overrides,
  }
}

function diffsPayload(files: string[]) {
  return files.map(f => ({ new_path: f, old_path: f }))
}

interface RequestCall {
  path: string
  init?: { method?: string; body?: string }
}

function makeRequestSpy(handlers: Array<(call: RequestCall) => unknown | Promise<unknown>>) {
  const calls: RequestCall[] = []
  let i = 0
  const request = vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const call = { path, init }
    calls.push(call)
    const handler = handlers[i++] ?? handlers[handlers.length - 1]
    if (!handler) throw new Error(`No handler for call #${i}: ${path}`)
    return handler(call)
  })
  return {
    client: { request, getJobTrace: vi.fn() } as unknown as GitLabClient,
    calls,
  }
}

const refs: DiffRefs = {
  base_sha: 'b',
  start_sha: 's',
  head_sha: 'h',
}

describe('computeHash', () => {
  it('is deterministic for identical inputs', () => {
    const f: Finding = { file: 'src/a.ts', new_line: 10, severity: 'high', title: 'X', body: 'b' }
    expect(computeHash(f)).toBe(computeHash(f))
  })

  it('differs when line differs', () => {
    const a: Finding = { file: 'src/a.ts', new_line: 10, severity: 'high', title: 'X', body: 'b' }
    const b: Finding = { file: 'src/a.ts', new_line: 11, severity: 'high', title: 'X', body: 'b' }
    expect(computeHash(a)).not.toBe(computeHash(b))
  })

  it('differs when title differs', () => {
    const a: Finding = { file: 'src/a.ts', new_line: 10, severity: 'high', title: 'X', body: 'b' }
    const b: Finding = { file: 'src/a.ts', new_line: 10, severity: 'high', title: 'Y', body: 'b' }
    expect(computeHash(a)).not.toBe(computeHash(b))
  })

  it('uses old_line when new_line absent', () => {
    const a: Finding = { file: 'src/a.ts', old_line: 5, severity: 'low', title: 'T', body: 'b' }
    const b: Finding = { file: 'src/a.ts', old_line: 6, severity: 'low', title: 'T', body: 'b' }
    expect(computeHash(a)).not.toBe(computeHash(b))
  })

  it('returns hex string of expected sha1 length', () => {
    const f: Finding = { file: 'a', new_line: 1, severity: 'info', title: 't', body: 'b' }
    expect(computeHash(f)).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('renderBody', () => {
  it('contains title, body, severity, and marker', () => {
    const f: Finding = { file: 'src/a.ts', new_line: 1, severity: 'high', title: 'Null deref', body: 'user is undefined' }
    const out = renderBody(f, 'abc123')
    expect(out).toContain('Null deref')
    expect(out).toContain('user is undefined')
    expect(out.toLowerCase()).toContain('high')
    expect(out).toContain('<!-- glab-mcp-finding:abc123 -->')
  })

  it('includes ```suggestion``` block when suggestion present', () => {
    const f: Finding = { file: 'a', new_line: 1, severity: 'low', title: 't', body: 'b', suggestion: 'if (!u) throw' }
    const out = renderBody(f, 'h')
    expect(out).toContain('```suggestion:-0+0')
    expect(out).toContain('if (!u) throw')
    expect(out).toContain('```')
  })

  it('omits suggestion block when suggestion absent', () => {
    const f: Finding = { file: 'a', new_line: 1, severity: 'low', title: 't', body: 'b' }
    const out = renderBody(f, 'h')
    expect(out).not.toContain('```suggestion')
  })
})

describe('buildPosition', () => {
  it('returns new_path + new_line for added/context lines', () => {
    const f: Finding = { file: 'src/a.ts', new_line: 42, severity: 'high', title: 't', body: 'b' }
    const pos = buildPosition(f, refs)
    expect(pos).toMatchObject({
      base_sha: 'b',
      start_sha: 's',
      head_sha: 'h',
      position_type: 'text',
      new_path: 'src/a.ts',
      new_line: 42,
    })
    expect(pos.old_line).toBeUndefined()
  })

  it('returns old_path + old_line for deleted lines', () => {
    const f: Finding = { file: 'src/a.ts', old_line: 5, severity: 'high', title: 't', body: 'b' }
    const pos = buildPosition(f, refs)
    expect(pos).toMatchObject({
      position_type: 'text',
      old_path: 'src/a.ts',
      old_line: 5,
    })
    expect(pos.new_line).toBeUndefined()
  })

  it('includes both new_path/new_line and old_path/old_line when both given (context line)', () => {
    const f: Finding = { file: 'src/a.ts', new_line: 10, old_line: 10, severity: 'low', title: 't', body: 'b' }
    const pos = buildPosition(f, refs)
    expect(pos.new_path).toBe('src/a.ts')
    expect(pos.new_line).toBe(10)
    expect(pos.old_path).toBe('src/a.ts')
    expect(pos.old_line).toBe(10)
  })
})

describe('parseMarkdownReport', () => {
  it('extracts heading-shaped findings', () => {
    const md = [
      '# Review',
      '',
      '### [HIGH] src/auth.ts:47 — Missing null check',
      '`user` can be undefined when token is malformed.',
      '',
      '### [MED] src/auth.ts:120 — Loose comparison',
      'Use === here.',
      '',
    ].join('\n')
    const out = parseMarkdownReport(md)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      file: 'src/auth.ts',
      new_line: 47,
      severity: 'high',
      title: 'Missing null check',
    })
    expect(out[0].body).toContain('user')
    expect(out[1].severity).toBe('medium')
    expect(out[1].new_line).toBe(120)
  })

  it('returns empty array on free-form markdown', () => {
    const md = '# Some review\nThis is just prose without our heading shape.\n'
    expect(parseMarkdownReport(md)).toEqual([])
  })

  it('returns empty array on empty input', () => {
    expect(parseMarkdownReport('')).toEqual([])
  })

  it('accepts both em-dash and regular dash as title separator', () => {
    const md = '### [LOW] foo.ts:1 - Trivial issue\nbody\n'
    const out = parseMarkdownReport(md)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Trivial issue')
  })

  it('accepts en-dash and figure-dash separators (regression for unicode dash variants)', () => {
    const md = ['### [LOW] a.ts:1 – En', 'b', '', '### [LOW] b.ts:2 ― Horizontal', 'b'].join('\n')
    const out = parseMarkdownReport(md)
    expect(out).toHaveLength(2)
    expect(out[0].title).toBe('En')
    expect(out[1].title).toBe('Horizontal')
  })

  it('normalizes severity aliases (CRITICAL, CRIT, HIGH, MED, LOW, INFO)', () => {
    const md = [
      '### [CRIT] a.ts:1 — t',
      'b',
      '',
      '### [CRITICAL] b.ts:1 — t',
      'b',
      '',
      '### [HIGH] c.ts:1 — t',
      'b',
      '',
      '### [MED] d.ts:1 — t',
      'b',
      '',
      '### [LOW] e.ts:1 — t',
      'b',
      '',
      '### [INFO] f.ts:1 — t',
      'b',
      '',
    ].join('\n')
    const out = parseMarkdownReport(md)
    expect(out.map(f => f.severity)).toEqual(['critical', 'critical', 'high', 'medium', 'low', 'info'])
  })
})

describe('postReviewFindingsTool — core POST + fallback', () => {
  const baseArgs = { project_id: 42, mr_iid: 1 }

  function defaultHandlers(diffFiles: string[]) {
    return [
      () => mrPayload(),
      () => diffsPayload(diffFiles),
      () => [], // GET /discussions baseline — empty so reconcile becomes a pure POST path
    ]
  }

  it('posts inline discussions for findings whose files are in the diff', async () => {
    const findings: Finding[] = [
      { file: 'src/a.ts', new_line: 10, severity: 'high', title: 'X', body: 'b' },
      { file: 'src/b.ts', new_line: 20, severity: 'medium', title: 'Y', body: 'b' },
    ]
    let discussionCount = 0
    const { client, calls } = makeRequestSpy([
      ...defaultHandlers(['src/a.ts', 'src/b.ts']),
      () => ({ id: 'd1', notes: [{ id: 100 + discussionCount++ }] }),
      () => ({ id: 'd2', notes: [{ id: 101 }] }),
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings })
    expect(r.inline).toHaveLength(2)
    expect(r.fallback).toHaveLength(0)
    expect(r.failed).toHaveLength(0)
    const postCalls = calls.filter(c => c.init?.method === 'POST' && c.path.includes('/discussions'))
    expect(postCalls).toHaveLength(2)
    const body0 = JSON.parse(postCalls[0].init!.body!)
    expect(body0.position).toMatchObject({ new_path: 'src/a.ts', new_line: 10, position_type: 'text', base_sha: 'b' })
  })

  it('falls back to general note when file is off-diff', async () => {
    const findings: Finding[] = [
      { file: 'src/not-in-diff.ts', new_line: 5, severity: 'low', title: 'Z', body: 'b' },
    ]
    const { client, calls } = makeRequestSpy([
      ...defaultHandlers(['src/other.ts']),
      () => ({ id: 999 }),
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings })
    expect(r.inline).toHaveLength(0)
    expect(r.fallback).toHaveLength(1)
    expect(r.fallback[0].reason).toBe('off-diff')
    const notesPost = calls.find(c => c.path.includes('/notes') && c.init?.method === 'POST')
    expect(notesPost).toBeDefined()
    expect(notesPost!.init!.body).toContain('not in diff')
  })

  it('falls back to note when POST /discussions returns 400', async () => {
    const findings: Finding[] = [
      { file: 'src/a.ts', new_line: 10, severity: 'high', title: 'X', body: 'b' },
    ]
    const { client } = makeRequestSpy([
      ...defaultHandlers(['src/a.ts']),
      () => { throw new GitLabError('GitLab API error 400: line not in diff', 400) },
      () => ({ id: 42 }),
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings })
    expect(r.inline).toHaveLength(0)
    expect(r.fallback).toHaveLength(1)
    expect(r.fallback[0].reason).toBe('400')
  })

  it('posts whole markdown as a single note when nothing parses', async () => {
    const md = 'Free-form review with no headings.\n\nJust prose.'
    const { client, calls } = makeRequestSpy([
      () => ({ id: 7 }),
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, report_markdown: md })
    expect(r.fallback).toHaveLength(1)
    expect(r.fallback[0].reason).toBe('unparseable-markdown')
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toContain('/notes')
    expect(calls[0].init!.body).toContain('Free-form review')
  })

  it('returns empty result without API calls when findings is [], no markdown, dedupe=false', async () => {
    const { client, calls } = makeRequestSpy([])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings: [], dedupe: false })
    expect(r.inline).toEqual([])
    expect(r.fallback).toEqual([])
    expect(r.failed).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('records failures on non-400 errors', async () => {
    const findings: Finding[] = [
      { file: 'src/a.ts', new_line: 10, severity: 'high', title: 'X', body: 'b' },
    ]
    const { client } = makeRequestSpy([
      ...defaultHandlers(['src/a.ts']),
      () => { throw new GitLabError('boom', 500) },
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings })
    expect(r.failed).toHaveLength(1)
    expect(r.inline).toHaveLength(0)
    expect(r.fallback).toHaveLength(0)
  })
})

describe('extractToolThreads', () => {
  it('indexes tool-tagged threads by hash', () => {
    const h = computeHash({ file: 'a.ts', new_line: 1, severity: 'high', title: 't', body: 'b' })
    const discussions = [
      {
        id: 'd1',
        notes: [
          { id: 100, body: `Some body\n<!-- glab-mcp-finding:${h} -->`, resolvable: true, resolved: false },
        ],
      },
    ]
    const m = extractToolThreads(discussions)
    expect(m.size).toBe(1)
    expect(m.get(h)).toMatchObject({ discussion_id: 'd1', note_id: 100, resolved: false })
  })

  it('ignores threads without our marker', () => {
    const discussions = [
      { id: 'd1', notes: [{ id: 1, body: 'human comment', resolvable: false, resolved: false }] },
      { id: 'd2', notes: [{ id: 2, body: '<!-- some-other-tool:abc -->', resolvable: false, resolved: false }] },
    ]
    expect(extractToolThreads(discussions).size).toBe(0)
  })

  it('preserves resolved flag', () => {
    const h = computeHash({ file: 'a.ts', new_line: 1, severity: 'low', title: 't', body: 'b' })
    const m = extractToolThreads([
      { id: 'd1', notes: [{ id: 1, body: `x\n<!-- glab-mcp-finding:${h} -->`, resolvable: true, resolved: true }] },
    ])
    expect(m.get(h)?.resolved).toBe(true)
  })
})

describe('postReviewFindingsTool — reconcile', () => {
  const baseArgs = { project_id: 42, mr_iid: 1 }
  const finding: Finding = { file: 'src/a.ts', new_line: 10, severity: 'high', title: 'X', body: 'b' }
  const findingHash = computeHash(finding)
  const findingBody = renderBody(finding, findingHash)

  function discussionsHandlerOnce(items: unknown[]) {
    let served = false
    return () => {
      if (served) return []
      served = true
      return items
    }
  }

  it('marks identical-body finding as unchanged (no PUT, no POST)', async () => {
    const existing = [
      { id: 'd1', notes: [{ id: 100, body: findingBody, resolvable: true, resolved: false }] },
    ]
    const { client, calls } = makeRequestSpy([
      () => mrPayload(),
      () => diffsPayload(['src/a.ts']),
      discussionsHandlerOnce(existing),
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings: [finding] })
    expect(r.unchanged).toHaveLength(1)
    expect(r.inline).toHaveLength(0)
    expect(r.updated).toHaveLength(0)
    expect(calls.filter(c => c.init?.method === 'POST')).toHaveLength(0)
    expect(calls.filter(c => c.init?.method === 'PUT')).toHaveLength(0)
  })

  it('updates differing body via PUT to existing note', async () => {
    const existing = [
      { id: 'd1', notes: [{ id: 100, body: `old body\n<!-- glab-mcp-finding:${findingHash} -->`, resolvable: true, resolved: false }] },
    ]
    const { client, calls } = makeRequestSpy([
      () => mrPayload(),
      () => diffsPayload(['src/a.ts']),
      discussionsHandlerOnce(existing),
      () => ({ id: 100 }),
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings: [finding] })
    expect(r.updated).toHaveLength(1)
    expect(r.inline).toHaveLength(0)
    const puts = calls.filter(c => c.init?.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0].path).toContain('/discussions/d1/notes/100')
  })

  it('leaves resolved threads alone (treated as unchanged)', async () => {
    const existing = [
      { id: 'd1', notes: [{ id: 100, body: `old\n<!-- glab-mcp-finding:${findingHash} -->`, resolvable: true, resolved: true }] },
    ]
    const { client, calls } = makeRequestSpy([
      () => mrPayload(),
      () => diffsPayload(['src/a.ts']),
      discussionsHandlerOnce(existing),
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings: [finding] })
    expect(r.unchanged).toHaveLength(1)
    expect(calls.filter(c => c.init?.method !== undefined && c.init.method !== 'GET')).toHaveLength(0)
  })

  it('auto-resolves stale findings (in existing, not in new)', async () => {
    const staleHash = computeHash({ file: 'src/stale.ts', new_line: 5, severity: 'low', title: 'gone', body: 'b' })
    const existing = [
      { id: 'd-stale', notes: [{ id: 99, body: `<!-- glab-mcp-finding:${staleHash} -->`, resolvable: true, resolved: false }] },
    ]
    const { client, calls } = makeRequestSpy([
      () => mrPayload(),
      () => diffsPayload(['src/a.ts']),
      discussionsHandlerOnce(existing),
      () => ({ id: 'd-stale', resolved: true }),
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings: [] })
    expect(r.auto_resolved).toHaveLength(1)
    const puts = calls.filter(c => c.init?.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0].path).toContain('/discussions/d-stale')
    expect(puts[0].init!.body).toContain('"resolved":true')
  })

  it('dedupe=false skips reconcile: no GET /discussions, posts fresh', async () => {
    const { client, calls } = makeRequestSpy([
      () => mrPayload(),
      () => diffsPayload(['src/a.ts']),
      () => ({ id: 'd-new' }),
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings: [finding], dedupe: false })
    expect(r.inline).toHaveLength(1)
    expect(calls.find(c => c.path.includes('/discussions?'))).toBeUndefined()
  })

  it('auto_resolve_stale=false keeps stale threads open', async () => {
    const staleHash = computeHash({ file: 'src/stale.ts', new_line: 5, severity: 'low', title: 'gone', body: 'b' })
    const existing = [
      { id: 'd-stale', notes: [{ id: 99, body: `<!-- glab-mcp-finding:${staleHash} -->`, resolvable: true, resolved: false }] },
    ]
    const { client, calls } = makeRequestSpy([
      () => mrPayload(),
      () => diffsPayload(['src/a.ts']),
      discussionsHandlerOnce(existing),
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings: [], auto_resolve_stale: false })
    expect(r.auto_resolved).toHaveLength(0)
    expect(calls.filter(c => c.init?.method === 'PUT')).toHaveLength(0)
  })

  it('paginates /discussions across multiple pages', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `d${i}`,
      notes: [{ id: i, body: `<!-- glab-mcp-finding:${'a'.repeat(40)} -->`, resolvable: true, resolved: false }],
    }))
    const page2 = Array.from({ length: 30 }, (_, i) => ({
      id: `e${i}`,
      notes: [{ id: 1000 + i, body: `<!-- glab-mcp-finding:${'b'.repeat(40)} -->`, resolvable: true, resolved: false }],
    }))
    const discussionsCalls: RequestCall[] = []
    const { client } = makeRequestSpy([
      () => mrPayload(),
      () => diffsPayload(['src/a.ts']),
      (call) => { discussionsCalls.push(call); return page1 },
      (call) => { discussionsCalls.push(call); return page2 },
    ])
    await postReviewFindingsTool(client, { ...baseArgs, findings: [], auto_resolve_stale: false })
    expect(discussionsCalls.length).toBe(2)
    expect(discussionsCalls[0].path).toContain('page=1')
    expect(discussionsCalls[1].path).toContain('page=2')
  })

  it('does not touch threads lacking our marker', async () => {
    const existing = [
      { id: 'd-human', notes: [{ id: 1, body: 'pure human comment', resolvable: true, resolved: false }] },
    ]
    const { client, calls } = makeRequestSpy([
      () => mrPayload(),
      () => diffsPayload(['src/a.ts']),
      discussionsHandlerOnce(existing),
      () => ({ id: 'd-new' }),
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings: [finding] })
    expect(r.inline).toHaveLength(1)
    expect(r.auto_resolved).toHaveLength(0)
    expect(calls.filter(c => c.init?.method === 'PUT')).toHaveLength(0)
  })

  it('stale-resolve only touches marker-tagged threads, never human comments', async () => {
    const staleHash = computeHash({ file: 'src/old.ts', new_line: 5, severity: 'low', title: 'gone', body: 'b' })
    const existing = [
      { id: 'd-human', notes: [{ id: 1, body: 'WIP do not resolve', resolvable: true, resolved: false }] },
      { id: 'd-stale', notes: [{ id: 99, body: `<!-- glab-mcp-finding:${staleHash} -->`, resolvable: true, resolved: false }] },
    ]
    const { client, calls } = makeRequestSpy([
      () => mrPayload(),
      () => diffsPayload(['src/a.ts']),
      discussionsHandlerOnce(existing),
      () => ({ id: 'd-stale', resolved: true }),
    ])
    const r = await postReviewFindingsTool(client, { ...baseArgs, findings: [] })
    expect(r.auto_resolved).toHaveLength(1)
    const puts = calls.filter(c => c.init?.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0].path).toContain('/discussions/d-stale')
    expect(puts[0].path).not.toContain('d-human')
  })
})
