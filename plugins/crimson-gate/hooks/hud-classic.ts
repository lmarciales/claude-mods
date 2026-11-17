import type { Hud } from '../types'
import type { HudStyle, World } from './looks'

export const HUD_WIDTH = 760
export const HUD_HEIGHT = 92
/** Below this the four gauges no longer fit their words. */
export const HUD_MIN_WIDTH = 520

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const pct = (value: number | undefined) => (value === undefined ? '–' : `${Math.round(value)}%`)

/** "3d 5h", "1h 40m" or "12m" until an ISO time; undefined when unknown or past. */
export function until(iso: string | undefined, now: number): string | undefined {
  if (iso === undefined) return undefined
  const at = Date.parse(iso)
  if (Number.isNaN(at) || at <= now) return undefined
  const minutes = Math.round((at - now) / 60000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function clock(now: number): string {
  const date = new Date(now)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : `${Math.round(n / 1000)}k`)

/** "54k / 200k tokens", or a quiet fallback before the first reading. */
const tokens = (used: number | undefined, window: number | undefined) =>
  used !== undefined && window !== undefined ? `${k(used)} / ${k(window)} tokens` : 'of the window'

const money =(usd: number | undefined) => (usd === undefined ? '–' : `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`)

function fillColor(style: HudStyle, value: number | undefined, base: string): string {
  if (value === undefined) return base
  if (value >= 90) return style.hot
  if (value >= 70) return style.warn
  return base
}

const label = (style: HudStyle, text: string) => (style.caps ? text.toUpperCase() : text)

type Gauge = { name: string; value?: number; text: string; sub?: string; color: string; bar: boolean }

function gauge(style: HudStyle, g: Gauge, x: number, width: number, index: number): string {
  const nameAttrs = style.caps ? 'font-size="10" letter-spacing="1.6"' : 'font-size="11.5"'
  const parts = [
    `<text x="${x}" y="40" ${nameAttrs} fill="${style.muted}" font-family="Segoe UI, system-ui, sans-serif">${esc(label(style, g.name))}</text>`,
    `<text x="${x + width}" y="40" text-anchor="end" font-size="14" font-weight="700" fill="${g.color}" font-family="Cascadia Mono, Consolas, ui-monospace, monospace"${style.glow ? ' filter="url(#glow)"' : ''}>${esc(g.text)}</text>`,
  ]
  if (g.bar) {
    const value = Math.max(0, Math.min(100, g.value ?? 0))
    const fill = Math.max(value > 0 ? 4 : 0, (width * value) / 100)
    parts.push(
      `<rect x="${x}" y="50" width="${width}" height="6" rx="3" fill="${style.track}"/>`,
      `<rect class="bar b${index}" x="${x}" y="50" width="${fill.toFixed(1)}" height="6" rx="3" fill="${g.color}"${style.glow ? ' filter="url(#glow)"' : ''}/>`,
    )
    // Quarter ticks, so the eye reads the fill without the number.
    for (const tick of [0.25, 0.5, 0.75]) {
      parts.push(`<rect x="${(x + width * tick).toFixed(1)}" y="50" width="1" height="6" fill="${style.card}" opacity=".7"/>`)
    }
  } else {
    parts.push(`<rect x="${x}" y="52.5" width="${width}" height="1" fill="${style.track}"/>`)
  }
  if (g.sub !== undefined) {
    parts.push(
      `<text x="${x}" y="74" font-size="10.5" fill="${style.muted}" font-family="Segoe UI, system-ui, sans-serif">${esc(g.sub)}</text>`,
    )
  }
  return parts.join('')
}

/** The HUD as one SVG document, `width` × HUD_HEIGHT: the layout follows the width it is given. */
export function hudSvg(world: World, hud: Hud, isWorking: boolean, width = HUD_WIDTH): string {
  const w = Math.max(HUD_MIN_WIDTH, Math.round(width))
  const s = world.hud
  const now = hud.now
  const sessionLeft = until(hud.sessionReset, now)
  const weekLeft = until(hud.weekReset, now)

  const gauges: Gauge[] = [
    { name: 'Context', value: hud.ctx, text: pct(hud.ctx), sub: hud.ctx !== undefined && hud.ctx >= 70 ? 'consider /compact' : tokens(hud.ctxTokens, hud.ctxWindow), color: fillColor(s, hud.ctx, s.accent), bar: true },
    { name: 'Session', value: hud.session, text: pct(hud.session), sub: sessionLeft ? `resets in ${sessionLeft}` : '5-hour window', color: fillColor(s, hud.session, s.accent2), bar: true },
    { name: 'Week', value: hud.week, text: pct(hud.week), sub: weekLeft ? `resets in ${weekLeft}` : '7-day window', color: fillColor(s, hud.week, s.accent2), bar: true },
    { name: 'Cost', text: money(hud.cost), sub: 'this session', color: s.accent, bar: false },
  ]

  const left = 84
  const right = w - 18
  const gap = 22
  const column = (right - left - gap * (gauges.length - 1)) / gauges.length
  const body = gauges.map((g, i) => gauge(s, g, left + i * (column + gap), column, i)).join('')

  const title = s.caps ? world.label.toUpperCase() : world.label
  const titleAttrs = s.caps ? 'font-size="10" letter-spacing="2.2"' : 'font-size="11.5" font-style="italic"'
  const branch = hud.branch ? `⎇ ${hud.branch}` : ''
  const status = isWorking ? (s.caps ? '● WORKING' : '● working') : ''

  const anim = s.glow
    ? `.bar{animation:breathe 4.5s ease-in-out infinite}.b1{animation-delay:-1.1s}.b2{animation-delay:-2.2s}.dot{animation:blink 1.4s steps(2) infinite}@keyframes breathe{50%{opacity:.72}}@keyframes blink{50%{opacity:.25}}`
    : `.dot{animation:blink 1.6s ease-in-out infinite}@keyframes blink{50%{opacity:.35}}`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${HUD_HEIGHT}" width="${w}" height="${HUD_HEIGHT}">`,
    `<style>${anim}@media (prefers-reduced-motion: reduce){*{animation:none!important}}</style>`,
    `<defs><filter id="glow" x="-20%" y="-80%" width="140%" height="260%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    `<linearGradient id="edge" x1="0" x2="1"><stop offset="0" stop-color="${s.edge}" stop-opacity=".9"/><stop offset=".5" stop-color="${s.accent2}" stop-opacity=".35"/><stop offset="1" stop-color="${s.edge}" stop-opacity=".9"/></linearGradient></defs>`,
    `<rect x="1" y="1" width="${w - 2}" height="${HUD_HEIGHT - 2}" rx="14" fill="${s.card}" fill-opacity="${s.cardOpacity}" stroke="url(#edge)" stroke-width="1.2"/>`,
    s.caps
      ? `<path d="M10 14 v-6 h6 M${w - 16} 8 h6 v6 M10 ${HUD_HEIGHT - 14} v6 h6 M${w - 16} ${HUD_HEIGHT - 8} h6 v-6" stroke="${s.accent}" stroke-width="1.5" fill="none" opacity=".8"/>`
      : '',
    `<g transform="translate(14 18)">${s.emblem}</g>`,
    `<text x="${left}" y="20" ${titleAttrs} fill="${s.muted}" font-family="Segoe UI, system-ui, sans-serif">${esc(title)}</text>`,
    status
      ? `<text class="dot" x="${left + (s.caps ? title.length * 8.6 : title.length * 6.4) + 14}" y="20" font-size="10" fill="${s.accent}" font-family="Segoe UI, system-ui, sans-serif"${s.glow ? ' filter="url(#glow)"' : ''}>${status}</text>`
      : '',
    `<text x="${right}" y="20" text-anchor="end" font-size="11.5" fill="${s.text}" font-family="Cascadia Mono, Consolas, ui-monospace, monospace">${esc(branch)}${branch ? '   ' : ''}<tspan fill="${s.accent}" font-weight="700">${clock(now)}</tspan></text>`,
    body,
    `</svg>`,
  ].join('')
}

/** One line for surfaces that draw no SVG, such as the terminal. */
export function hudLine(world: World, hud: Hud): string {
  const parts = [
    world.label,
    `ctx ${pct(hud.ctx)}`,
    `5h ${pct(hud.session)}`,
    `week ${pct(hud.week)}`,
    money(hud.cost),
  ]
  if (hud.branch) parts.push(hud.branch)
  parts.push(clock(hud.now))
  return parts.join('  ·  ')
}
