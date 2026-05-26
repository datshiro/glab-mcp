import { createHash } from 'node:crypto'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface Finding {
  file: string
  severity: Severity
  title: string
  body: string
  new_line?: number
  old_line?: number
  suggestion?: string
}

export interface DiffRefs {
  base_sha: string
  start_sha: string
  head_sha: string
}

export interface GitLabPosition extends DiffRefs {
  position_type: 'text'
  new_path?: string
  new_line?: number
  old_path?: string
  old_line?: number
}

export const MARKER_PREFIX = 'glab-mcp-finding:'
export const MARKER_RE = /<!-- glab-mcp-finding:([0-9a-f]{40}) -->/

const SEVERITY_ALIASES: Record<string, Severity> = {
  crit: 'critical',
  critical: 'critical',
  high: 'high',
  med: 'medium',
  medium: 'medium',
  low: 'low',
  info: 'info',
}

export function computeHash(f: Finding): string {
  const line = f.new_line ?? f.old_line ?? 0
  return createHash('sha1').update(`${f.file}:${line}:${f.title}`).digest('hex')
}

export function renderBody(f: Finding, hash: string): string {
  const parts = [`**[${f.severity.toUpperCase()}] ${f.title}**`, '', f.body]
  if (f.suggestion) {
    parts.push('', '```suggestion:-0+0', f.suggestion, '```')
  }
  parts.push('', `<!-- ${MARKER_PREFIX}${hash} -->`)
  return parts.join('\n')
}

export function buildPosition(f: Finding, refs: DiffRefs): GitLabPosition {
  const pos: GitLabPosition = { ...refs, position_type: 'text' }
  if (f.new_line !== undefined) {
    pos.new_path = f.file
    pos.new_line = f.new_line
  }
  if (f.old_line !== undefined) {
    pos.old_path = f.file
    pos.old_line = f.old_line
  }
  return pos
}

const HEADING_RE = /^###\s+\[(\w+)\]\s+(\S+):(\d+)\s+[‐-―\-]\s+(.+)$/gm

export function parseMarkdownReport(md: string): Finding[] {
  if (!md) return []
  const findings: Finding[] = []
  const matches = [...md.matchAll(HEADING_RE)]
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const sevKey = m[1].toLowerCase()
    const severity = SEVERITY_ALIASES[sevKey]
    if (!severity) continue
    const file = m[2]
    const line = Number(m[3])
    const title = m[4].trim()
    const bodyStart = (m.index ?? 0) + m[0].length
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].index ?? md.length : md.length
    const body = md.slice(bodyStart, bodyEnd).trim()
    findings.push({ file, new_line: line, severity, title, body })
  }
  return findings
}

export function findingLine(f: Finding): number {
  return f.new_line ?? f.old_line ?? 0
}
