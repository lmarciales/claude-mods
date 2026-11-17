import type { Hud } from '../types'
import { esc, HUD_MIN_WIDTH, HUD_WIDTH } from './hud'
import type { World } from './looks'

export const HUD_SESSION_HEIGHT = 132
const k = (n: number) => n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${+(n / 1000).toFixed(1)}k`
const money = (n?: number) => n === undefined ? '–' : `$${n.toFixed(n < 10 ? 2 : 1)}`
const pct = (n?: number) => n === undefined ? '–' : `${Math.round(n)}%`
const elapsed = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
const span = (ms: number) => {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function status(h: Hud): string {
  if (h.turnId !== undefined) {
    return ['Working', h.tool, elapsed(h.now - (h.turnStartedAt ?? h.now)), `${h.tools ?? 0} tools`,
      h.agents ? `${h.agents} agents` : undefined].filter(Boolean).join(' · ')
  }
  return `Idle · ${h.turns ?? 0} messages · ${span(h.now - (h.startedAt ?? h.now))}`
}

/** Only show a plan reading when it requires attention; prefer the fuller window. */
function warning(h: Hud): { text: string; hot: boolean } | undefined {
  const windows = [{ name: '5h', value: h.session }, { name: 'week', value: h.week }]
    .filter((v): v is { name: string; value: number } => v.value !== undefined && v.value >= 70)
    .sort((a, b) => b.value - a.value)
  const v = windows[0]
  return v ? { text: `⚠ ${v.name} ${pct(v.value)}`, hot: v.value >= 90 } : undefined
}

function contextTitle(h: Hud): string {
  const b = h.breakdown
  if (!b) return 'Context breakdown unavailable'
  const lines = ['Estimated context: conversation; tools and system; memory files',
    ...b.categories.map(c => `${c.name}: ${c.tokens.toLocaleString('en-US')} tokens (${c.kind})`)]
  if (b.isAutoCompactEnabled && b.autoCompactThreshold !== undefined) {
    lines.push(`${Math.max(0, b.autoCompactThreshold - b.totalTokens).toLocaleString('en-US')} tokens before auto-compact`)
  }
  return lines.join('\n')
}

function contextGroups(h: Hud): number[] {
  const groups = [0, 0, 0]
  for (const c of h.breakdown?.categories ?? []) {
    if (c.kind !== 'used') continue
    const group = /memory|claude\.md/i.test(c.name) ? 2 : /message|conversation/i.test(c.name) ? 0 : 1
    groups[group]! += Math.max(0, c.tokens)
  }
  return groups
}

function contextSub(h: Hud): string {
  if (h.ctxTokens === undefined || h.ctxWindow === undefined) return 'waiting for context'
  const b = h.breakdown
  const compact = b?.isAutoCompactEnabled && b.autoCompactThreshold !== undefined
    ? ` · ${k(Math.max(0, b.autoCompactThreshold - b.totalTokens))} to compact` : ''
  return `${k(h.ctxTokens)} / ${k(h.ctxWindow)}${compact}`
}

type GitPart = { value: string; tone: 'text' | 'accent2' | 'hot' | 'muted' }
/** Independent readings: a failed diff must not hide a known branch. */
function gitParts(h: Hud): GitPart[] {
  if (!h.branch) return []
  const parts: GitPart[] = [{ value: `⎇ ${h.branch}`, tone: 'text' }]
  if (h.git?.added !== undefined) parts.push({ value: `   +${h.git.added}`, tone: 'accent2' })
  if (h.git?.removed !== undefined) parts.push({ value: ` −${h.git.removed}`, tone: 'hot' })
  if (h.git?.files !== undefined) parts.push({ value: ` · ${h.git.files} files`, tone: 'muted' })
  if (h.git?.ahead !== undefined) parts.push({ value: ` · ↑${h.git.ahead}`, tone: 'muted' })
  return parts
}

/** Same card, emblem and accents as classic. Pure, static SVG; no render-time I/O. */
export function hudSessionSvg(world: World, h: Hud, width = HUD_WIDTH): string {
  const w = Math.max(HUD_MIN_WIDTH, Number.isFinite(width) ? Math.round(width) : HUD_WIDTH)
  const s = world.hud
  const left = 84, right = w - 18, gap = 22
  const column = (right - left - gap * 2) / 3
  const x = (i: number) => left + i * (column + gap)
  const mono = 'font-family="Cascadia Mono, Consolas, ui-monospace, monospace"'
  const fit = (value: string, size: number, max: number, extra = '') => {
    const spacing = Number(/letter-spacing="([\d.]+)"/.exec(extra)?.[1] ?? 0)
    const measured = value.length * size * (extra.includes('Cascadia Mono') ? .6 : .57) + Math.max(0, value.length - 1) * spacing
    return measured > max ? ` textLength="${Math.max(1, max)}" lengthAdjust="spacingAndGlyphs"` : ''
  }
  const text = (value: string, at: number, y: number, size = 10, color = s.muted, max = column, extra = '') =>
    `<text x="${at}" y="${y}" font-size="${size}" fill="${color}"${fit(value, size, max, extra)} ${extra}>${esc(value)}</text>`
  const gauge = (name: string, value: string, i: number, row: number, color: string, sub: string, bar = false) => {
    const label = s.caps ? name.toUpperCase() : name
    const size = s.caps ? 10 : 11.5
    const labelWidth = label.length * size * .6 + (s.caps ? (label.length - 1) * 1.6 : 0)
    const valueWidth = value.length * 8.4
    const scale = Math.min(1, (column - 8) / (labelWidth + valueWidth))
    const y = 43 + row * 51
    return [
      text(label, x(i), y, size, s.muted, labelWidth * scale, s.caps ? 'letter-spacing="1.6"' : ''),
      text(value, x(i) + column, y, 14, color, valueWidth * scale, `text-anchor="end" font-weight="700" ${mono}`),
      bar ? '' : `<rect x="${x(i)}" y="${y + 12.5}" width="${column}" height="1" fill="${s.track}"/>`,
      sub ? text(sub, x(i), y + 27, 10.5) : '',
    ].join('')
  }
  const chip = warning(h)
  const git = gitParts(h)
  const gitText = git.map(p => p.value).join('')
  const available = right - left
  const gitWidth = git.length ? Math.min(gitText.length * 6.9, available * .43) : 0
  const chipWidth = chip ? Math.min(chip.text.length * 6.9 + 16, available * .23) : 0
  const gitLeft = right - gitWidth
  const chipRight = gitLeft - (gitWidth ? 10 : 0)
  const topRight = chipRight - chipWidth - (chip ? 10 : 0)
  const title = s.caps ? world.label.toUpperCase() : world.label
  const nameWidth = Math.min(title.length * (s.caps ? 8.6 : 6.4), (topRight - left) * .35)
  const statusX = left + nameWidth + 15
  const reply = h.lastReply
  const contextColor = h.ctx !== undefined && h.ctx >= 90 ? s.hot : h.ctx !== undefined && h.ctx >= 70 ? s.warn : s.accent
  const colors = [contextColor, s.accent2, s.warn]
  const groups = contextGroups(h)
  const sum = groups.reduce((a, b) => a + b, 0)
  const largest = groups.indexOf(Math.max(...groups))
  const mix = sum ? `${['conv', 'tools', 'memory'][largest]} ${Math.round(groups[largest]! / sum * 100)}%` : '–'
  const legend = groups.map((n, i) => `● ${['conversation', 'tools', 'memory'][i]} ${k(n)}`)
  const legendText = legend.join('  ')
  // At the width floor, three short lines stay readable without hiding a group.
  const stackedLegend = column < 220
  const fill = column * Math.max(0, Math.min(100, h.ctx ?? 0)) / 100
  let offset = x(0)
  const segments = (sum ? groups : [1, 0, 0]).map((n, i) => {
    const size = fill * n / (sum || 1)
    const rect = `<rect x="${offset}" y="52" width="${size}" height="6" fill="${colors[i]}"/>`
    offset += size
    return rect
  }).join('')
  const cacheFill = column * Math.max(0, Math.min(100, reply?.cache ?? 0)) / 100

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${HUD_SESSION_HEIGHT}" width="${w}" height="${HUD_SESSION_HEIGHT}">`,
    `<defs><linearGradient id="session-edge" x1="0" x2="1"><stop offset="0" stop-color="${s.edge}" stop-opacity=".9"/><stop offset=".5" stop-color="${s.accent2}" stop-opacity=".35"/><stop offset="1" stop-color="${s.edge}" stop-opacity=".9"/></linearGradient><clipPath id="session-context"><rect x="${x(0)}" y="52" width="${fill}" height="6" rx="3"/></clipPath></defs>`,
    `<rect x="1" y="1" width="${w - 2}" height="${HUD_SESSION_HEIGHT - 2}" rx="14" fill="${s.card}" fill-opacity="${s.cardOpacity}" stroke="url(#session-edge)" stroke-width="1.2"/>`,
    s.caps ? `<path d="M10 14 v-6 h6 M${w - 16} 8 h6 v6 M10 ${HUD_SESSION_HEIGHT - 14} v6 h6 M${w - 16} ${HUD_SESSION_HEIGHT - 8} h6 v-6" stroke="${s.accent}" stroke-width="1.5" fill="none" opacity=".8"/>` : '',
    `<g transform="translate(14 38)">${s.emblem}</g>`,
    '<g font-family="Segoe UI, system-ui, sans-serif">',
    '<g id="session-header">',
    text(title, left, 20, s.caps ? 10 : 11.5, s.muted, nameWidth, s.caps ? 'letter-spacing="2.2"' : 'font-style="italic"'),
    `<circle class="${h.turnId !== undefined ? 'working-dot' : 'idle-dot'}" cx="${statusX - 7}" cy="16.5" r="2.5" fill="${h.turnId !== undefined ? s.accent : s.muted}"/>`,
    `<g><title>${esc(status(h))}</title>${text(status(h), statusX, 20, 10, s.text, Math.max(1, topRight - statusX))}</g>`,
    chip ? `<g id="session-plan"><rect x="${chipRight - chipWidth}" y="6" width="${chipWidth}" height="20" rx="5" fill="${s.track}"/>${text(chip.text, chipRight - 8, 20, 11.5, chip.hot ? s.hot : s.warn, chipWidth - 16, `text-anchor="end" ${mono}`)}</g>` : '',
    git.length ? `<g id="session-git"><title>${esc(gitText)}</title><text x="${right}" y="20" text-anchor="end" font-size="11.5" xml:space="preserve" ${mono}${fit(gitText, 11.5, gitWidth, mono)}>${git.map(p => `<tspan fill="${s[p.tone]}">${esc(p.value)}</tspan>`).join('')}</text></g>` : '',
    '</g><g id="session-gauges">',
    `<g><title>${esc(contextTitle(h))}</title>`,
    gauge('Context', pct(h.ctx), 0, 0, contextColor, contextSub(h), true),
    `<rect x="${x(0)}" y="52" width="${column}" height="6" rx="3" fill="${s.track}"/>`,
    `<g clip-path="url(#session-context)">${segments}</g>`,
    ...[.25, .5, .75].map(tick => `<rect x="${(x(0) + column * tick).toFixed(1)}" y="52" width="1" height="6" fill="${s.card}" opacity=".7"/>`), '</g>',
    gauge('Cost', money(h.cost), 1, 0, s.accent, `last ${money(reply?.cost)} · ${money(h.cost !== undefined && h.turns ? h.cost / h.turns : undefined)} per reply`),
    gauge('Last reply', reply && reply.seconds > 0 ? `${Math.round(reply.output / reply.seconds)} tok/s` : '–', 2, 0, s.accent2, reply ? `${k(reply.input)} in · ${k(reply.output)} out · ${+reply.seconds.toFixed(1)}s` : 'waiting for a reply'),
    `<path d="M${left} 80 H${right}" stroke="${s.track}" opacity=".65"/>`,
    gauge('Context mix', mix, 0, 1, colors[largest]!, sum ? '' : 'waiting for context breakdown', stackedLegend && sum > 0),
    sum ? stackedLegend
      ? legend.map((value, i) => `<text x="${x(0)}" y="${109 + i * 9}" font-size="8.5" fill="${s.muted}"${fit(value, 8.5, column)}><tspan fill="${colors[i]}">●</tspan><tspan>${esc(value.slice(1))}</tspan></text>`).join('')
      : `<text x="${x(0)}" y="121" font-size="10.5" fill="${s.muted}"${fit(legendText, 10.5, column)}>${legend.map((value, i) => `<tspan fill="${colors[i]}">●</tspan><tspan>${esc(value.slice(1))}${i < 2 ? '  ' : ''}</tspan>`).join('')}</text>` : '',
    gauge('Cache', pct(reply?.cache), 1, 1, s.accent2, reply?.cache !== undefined ? "of the last reply's input" : 'waiting for a reply', true),
    `<rect x="${x(1)}" y="103" width="${column}" height="6" rx="3" fill="${s.track}"/><rect x="${x(1)}" y="103" width="${cacheFill}" height="6" rx="3" fill="${s.accent2}"/>`,
    gauge('Session', h.turns === undefined ? '–' : `${h.turns} msgs`, 2, 1, s.accent, [h.startedAt === undefined ? '–' : span(h.now - h.startedAt), `${h.totalTools ?? 0} tools`, h.agents === undefined ? '– agents' : `${h.agents} agents`].join(' · ')),
    '</g></g></svg>',
  ].join('')
}

export function hudSessionLine(world: World, h: Hud): string {
  const r = h.lastReply
  const groups = contextGroups(h)
  return [world.label, status(h), warning(h)?.text, `ctx ${pct(h.ctx)}`, contextSub(h),
    `cost ${money(h.cost)}`, `${money(h.cost !== undefined && h.turns ? h.cost / h.turns : undefined)} per reply`,
    r ? `last ${money(r.cost)} · cache ${pct(r.cache)} · ${k(r.input)} in · ${k(r.output)} out${r.seconds > 0 ? ` · ${Math.round(r.output / r.seconds)} tok/s` : ''} · ${+r.seconds.toFixed(1)}s` : 'last reply – · waiting for a reply',
    h.breakdown ? groups.map((n, i) => `${['conversation', 'tools', 'memory'][i]} ${k(n)}`).join(' · ') : 'context mix –',
    `${h.totalTools ?? 0} tools this session`,
    h.branch ? `Git ${gitParts(h).map(p => p.value).join('').replace(/^⎇ /, '').replace(/   /g, ' ')}` : undefined,
  ].filter(Boolean).join(' · ')
}
