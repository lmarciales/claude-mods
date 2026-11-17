import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit, Timer } from 'claude-code'

import type { Hud } from '../types'
import { HUD_HEIGHT, HUD_MIN_WIDTH, HUD_WIDTH, hudLine, hudSvg } from './hud'
import { HUD_SESSION_HEIGHT, hudSessionLine, hudSessionSvg } from './hud-session'
import { DEFAULT_WORLD, WORLDS, worldById } from './looks'
import * as crimson from './scenes/crimson'

const PLUGIN = 'crimson-gate'
const STORE_KEY = 'world'
const SCENES: Record<string, { svg: string; alt: string }> = { crimson }

const hud = atom({ plugin: 'crimson-gate', key: 'hud' } as const, { now: 0 })
const current = atom({ plugin: 'crimson-gate', key: 'world' } as const, 'off')

const names = () => WORLDS.map(world => world.id).join(', ')

/**
 * The band's width in CSS pixels. Remote surfaces report it only in columns, so
 * the HUD takes the columns at the desktop's cell width; a resize re-runs the hook.
 */
// Checked against the desktop window on 2026-11-16: 167 columns filled the chat at 8.
const PX_PER_COLUMN = 8
function bandWidth(columns: number): number {
  if (!Number.isFinite(columns) || columns <= 0) return HUD_WIDTH
  return Math.max(HUD_MIN_WIDTH, Math.round(columns * PX_PER_COLUMN))
}

// Performance rules for this module:
// - Every write to `hud` redraws the HUD, so figures are rounded to what the HUD shows
//   and `patch` writes only fields that changed. An idle session redraws about once a minute.
// - Nothing slow runs before `next(e)` on a tool call or a turn: the HUD never delays Claude.
// - git is two read-only calls: at start, every 30 s, when the folder changes, and shortly
//   after a tool that can change files. Calls never overlap, and an unchanged result writes nothing.
// - The 5 s timer exists only while a reply runs.

const MINUTE = 60_000
/** Session-module variables: lost on a plugin reload, which costs at most one extra refresh. */
let gitBusy = false
let gitAgain = false
let gitTimer: Timer | undefined
let replyTimer: Timer | undefined
/** Tools that can change files or the branch: git looks again shortly after one of them. */
const CHANGES_FILES = new Set(['Bash', 'PowerShell', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const GIT_SETTLE_MS = 1_500
const GIT_POLL_MS = 30_000

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** Writes the given fields only where they differ from what the HUD holds. */
async function patch($: EngineInterface, fields: Partial<Hud>): Promise<void> {
  const value = await read($, hud)
  const changed = (Object.keys(fields) as (keyof Hud)[]).filter(key => !same(fields[key], value[key]))
  if (changed.length === 0) return
  await update($, hud, latest => ({ ...latest, ...fields }))
}

async function savedWorld($: EngineInterface): Promise<string> {
  const saved = await $.store.get(STORE_KEY)
  return typeof saved === 'string' && (saved === 'off' || worldById(saved)) ? saved : DEFAULT_WORLD
}

/**
 * Paints a world, or clears the look for 'off'. Returns why nothing draws, if so.
 * 'off' clears only a look this mod painted: `$.theme.clear` clears whatever theme stands,
 * so clearing at start would wipe another plugin's.
 */
async function show($: EngineInterface, id: string): Promise<string | undefined> {
  const before = await read($, current)
  await update($, current, () => id)
  if (id === 'off') {
    if (before !== 'off') await $.theme.clear()
    return undefined
  }
  const world = worldById(id)
  if (!world) return `no world named ${id}`
  const result = await $.theme.set(world.build())
  return result.isDrawn ? undefined : result.reason
}

const round = (value: number | undefined, step: number) => (value === undefined ? undefined : Math.round(value / step) * step)

/** The figures as the HUD shows them: rounded, so a change too small to see writes nothing. */
function figures(context: SessionContextUsage, limits: SessionRateLimit[], cost: SessionCost | undefined) {
  const five = limits.find(limit => limit.kind === 'five_hour')
  const seven = limits.find(limit => limit.kind === 'seven_day')
  const next: Partial<Hud> = {
    ctx: round(context.percent, 1),
    ctxTokens: round(context.tokens, 100),
    ctxWindow: context.window,
    session: round(five?.percentUsed, 1),
    sessionReset: five?.resetsAt,
    week: round(seven?.percentUsed, 1),
    weekReset: seven?.resetsAt,
    cost: round(cost?.usd, 0.01),
  }
  return next
}

async function savedHud($: EngineInterface): Promise<'classic' | 'session'> {
  return (await $.store.get('hud')) === 'classic' ? 'classic' : 'session'
}

/**
 * Git that only reads: no optional locks, no fsmonitor or untracked-cache helpers, no lazy
 * fetch in a partial clone, no prompts, submodules left alone, and a 2 s cap per call.
 */
const GIT_READ_ONLY = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'submodule.recurse=false']
const GIT_ENV = { LC_ALL: 'C', LANG: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' }

/**
 * Reads `git status --porcelain=v2 --branch -z`: the branch (or the short commit when
 * detached), commits ahead of the upstream (none without one) and changed files. Exported for tests.
 */
export function parseStatus(out: string): { branch?: string; ahead?: number; files: number } {
  const fields = out.split('\0')
  let head: string | undefined
  let oid: string | undefined
  let ahead: number | undefined
  let files = 0
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    if (field.startsWith('# branch.head ')) head = field.slice(14)
    else if (field.startsWith('# branch.oid ')) oid = field.slice(13)
    else if (field.startsWith('# branch.ab ')) {
      const n = Number(/^\+(\d+)/.exec(field.slice(12))?.[1])
      ahead = Number.isFinite(n) ? n : undefined
    } else if (field[0] === '1' || field[0] === 'u' || field[0] === '?') files++
    else if (field[0] === '2') {
      files++
      i++ // A rename or copy carries its old path in the next field: a second path, not a second file.
    }
  }
  // Detached, git may still report the tracking of the branch HEAD left: that count is not this commit's.
  if (head === '(detached)') return { branch: oid && oid !== '(initial)' ? oid.slice(0, 7) : undefined, ahead: undefined, files }
  return { branch: head, ahead, files }
}

/** Branch, diff size, changed files and unpushed commits: two read-only git calls, in parallel. */
async function readGit($: EngineInterface): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    const git = (args: string[]) => $.process.run(['git', ...GIT_READ_ONLY, ...args], { cwd, timeoutMs: 2000, env: GIT_ENV })
    // allSettled, so both processes are done before the next read may start.
    const [statusRun, diffRun] = await Promise.allSettled([
      git(['status', '--porcelain=v2', '--branch', '-z', '--ignore-submodules=all']),
      git(['diff', '--shortstat', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', 'HEAD', '--']),
    ])
    if (statusRun.status === 'rejected') throw statusRun.reason
    const status = statusRun.value
    const diff = diffRun.status === 'fulfilled' ? diffRun.value : { exitCode: 1, stdout: '', isStdoutTruncated: false }
    if (status.exitCode !== 0) throw new Error('not a repository')
    const read = parseStatus(status.stdout)
    if (!read.branch) throw new Error('no branch')
    const lines = diff.exitCode === 0 && !diff.isStdoutTruncated
    await patch($, { branch: read.branch, git: {
      added: lines ? Number(diff.stdout.match(/(\d+) insertion/)?.[1] ?? 0) : undefined,
      removed: lines ? Number(diff.stdout.match(/(\d+) deletion/)?.[1] ?? 0) : undefined,
      files: status.isStdoutTruncated ? undefined : read.files,
      ahead: read.ahead,
    } })
  } catch {
    await patch($, { branch: undefined, git: undefined })
  }
}

/** One git read at a time; a request that lands during a read runs once more after it. */
async function refreshGit($: EngineInterface): Promise<void> {
  if (gitBusy) {
    gitAgain = true
    return
  }
  gitBusy = true
  try {
    do {
      gitAgain = false
      await readGit($)
    } while (gitAgain)
  } finally {
    gitBusy = false
  }
}

/** git a moment from now, off the caller's path; repeated requests fold into one read. */
function gitSoon($: EngineInterface, ms = GIT_SETTLE_MS): void {
  gitTimer?.cancel()
  gitTimer = $.clock.after(ms, async () => {
    gitTimer = undefined
    await refreshGit($)
  })
}

/** Keeps only what the HUD draws: the full breakdown carries a grid and per-file lists. */
function slim(b: SessionContextUsage['breakdown']): Hud['breakdown'] {
  if (!b) return undefined
  return {
    categories: b.categories.map(c => ({ name: c.name, tokens: round(c.tokens, 100) ?? 0, kind: c.kind })),
    totalTokens: round(b.totalTokens, 100) ?? 0,
    autoCompactThreshold: b.autoCompactThreshold,
    isAutoCompactEnabled: b.isAutoCompactEnabled,
  }
}

/**
 * The figures and the context breakdown (estimated locally: no request is sent), and the
 * exact cost, for differences taken before rounding.
 */
async function usageFields($: EngineInterface): Promise<{ fields: Partial<Hud>; exactCost?: number }> {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    return {
      fields: { ...figures(usage.context, usage.rateLimits, usage.cost), startedAt: usage.startedAt, breakdown: slim(usage.context.breakdown) },
      exactCost: usage.cost?.usd,
    }
  } catch {
    return { fields: {} }
  }
}

async function refreshActivity($: EngineInterface): Promise<void> {
  const fields: Partial<Hud> = {}
  try {
    fields.agents = (await $.agent.list()).filter(a => a.status === 'running' || a.status === 'pending').length
  } catch { /* Hosts may withhold the agent roster. */ }
  try {
    fields.turns = await $.session.turns()
  } catch { /* Keep the last count. */ }
  await patch($, fields)
}

/**
 * The HUD's clock: to the second while a reply runs in the session HUD (its reply timer
 * shows seconds), to the minute otherwise (the classic HUD's clock shows minutes).
 */
async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const value = await read($, hud)
  const seconds = value.turnId !== undefined && value.mode !== 'classic'
  await patch($, { now: seconds ? now : Math.floor(now / MINUTE) * MINUTE })
}

function stopReplyTimer(): void {
  replyTimer?.cancel()
  replyTimer = undefined
}

/** The reply timer: elapsed time and running subagents every 5 s, only while a reply runs. */
function startReplyTimer($: EngineInterface): void {
  stopReplyTimer()
  replyTimer = $.clock.every(5_000, async () => {
    if ((await read($, hud)).turnId === undefined) return stopReplyTimer()
    await tick($)
    await refreshActivity($)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'world',
      description: 'Turn the Crimson gate backdrop on or off',
      argumentHint: '[crimson|off]',
    })
    await $.command.register({ name: 'hud', description: 'Choose the session or classic HUD', argumentHint: '[session|classic]' })

    const id = await savedWorld($)
    await show($, id)
    const now = await $.clock.now()
    await patch($, { mode: await savedHud($), now: Math.floor(now / MINUTE) * MINUTE, ...(await usageFields($)).fields })
    // A reload mid-reply keeps the reply in state but drops its timer: start it again.
    if ((await read($, hud)).turnId !== undefined) startReplyTimer($)

    // Every 20 s: the minute clock, and keeping every open session on the same world and HUD.
    // Each step writes only when something changed, so a quiet session redraws once a minute.
    $.clock.every(20_000, async () => {
      await tick($)
      await patch($, { mode: await savedHud($) })
      const want = await savedWorld($)
      if (want !== (await read($, current))) await show($, want)
      await refreshActivity($)
    })

    // Every 30 s: git, so a branch switched or a file edited outside Claude shows up while idle.
    $.clock.every(GIT_POLL_MS, () => refreshGit($))

    // The engine waits for this whole hook before the first prompt, so git and the agent
    // roster run on their own timer, after it: a slow repository never delays the session.
    $.clock.after(0, () => refreshActivity($))
    gitSoon($, 0)
    return next(e)
  })

  // Context, plan limits and cost, pushed by the engine when a figure moves.
  on('session.measure', async ($, e, next) => {
    await patch($, figures(e.context, e.rateLimits, e.cost))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const now = await $.clock.now()
    // The plain call reads the cost ledger without recomputing the breakdown.
    let cost: number | undefined
    try { cost = (await $.session.usage()).cost?.usd } catch { cost = (await read($, hud)).cost }
    await update($, hud, value => ({ ...value, now, turnId: e.turnId, turnStartedAt: now,
      turnCostBefore: cost, tools: 0, tool: undefined, toolId: undefined }))
    startReplyTimer($)
    return next(e)
  })

  // One write per call, before the tool runs and nothing slow: the HUD never delays a tool.
  // The last tool stays named until the next one or the end of the reply.
  // After a tool that can change files (a subagent's too), git looks again once things settle.
  on('tool.call', async ($, e, next) => {
    // The HUD's own work never fails the call: errors stay on the HUD's side.
    if (e.agentId === undefined) {
      try {
        const tool = e.tool.replace(/^mcp__(.+?)__(.+)$/, '$1:$2')
        const now = await $.clock.now()
        await update($, hud, value => ({ ...value, totalTools: (value.totalTools ?? 0) + 1,
          ...(value.turnId === undefined ? {} : { now, tools: (value.tools ?? 0) + 1, tool, toolId: e.tool_use_id }) }))
      } catch { /* The count misses one call. */ }
    }
    const result = await next(e)
    try {
      if (CHANGES_FILES.has(e.tool)) gitSoon($)
    } catch { /* The 30 s poll catches up. */ }
    return result
  })

  // A new working folder (a worktree, a cd): read its repository right away.
  on('classic.CwdChanged', async ($, e, next) => {
    try { gitSoon($, 0) } catch { /* The 30 s poll catches up. */ }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      await refreshActivity($)
      return result
    }
    stopReplyTimer()
    const before = await read($, hud)
    const { fields, exactCost } = await usageFields($)
    const now = await $.clock.now()
    const usage = result.usage ?? e.usage
    // The reply's cost from exact totals, rounded once at the end.
    const replyCost = exactCost !== undefined && before.turnCostBefore !== undefined
      ? round(Math.max(0, exactCost - before.turnCostBefore), 0.01)
      : undefined
    await update($, hud, value => {
      const input = usage ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens : 0
      return { ...value, ...fields, now: Math.floor(now / MINUTE) * MINUTE, turnId: undefined, turnStartedAt: undefined,
        tool: undefined, toolId: undefined, turnCostBefore: undefined,
        lastReply: usage ? { input, output: usage.output_tokens, seconds: Math.max(0, e.durationMs / 1000),
          cost: replyCost,
          cache: input > 0 ? usage.cache_read_input_tokens / input * 100 : undefined } : value.lastReply }
    })
    await refreshActivity($)
    gitSoon($, 0)
    return result
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const mode = (await read($, hud)).mode ?? 'session'
    if (!arg) return { text: `HUD: ${mode}. Choices: /hud session or /hud classic.` }
    if (arg !== 'session' && arg !== 'classic') return { text: `Unknown HUD "${arg}". Choices: /hud session or /hud classic.` }
    const selected: 'session' | 'classic' = arg
    await $.store.set('hud', selected)
    await patch($, { mode: selected })
    return { text: `HUD: ${selected}.` }
  })

  on('command.run', { command: 'world' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const active = await read($, current)

    if (arg === '') {
      const width = Math.max(...WORLDS.map(world => world.id.length))
      const list = WORLDS.map(world => `${world.id === active ? '▸' : ' '} ${world.id.padEnd(width)} ${world.label}: ${world.tagline}`)
      return { text: [`World: ${active}`, ...list, '', 'Use /world <name>, /world next or /world off.'].join('\n') }
    }

    let id = arg
    if (arg === 'next') {
      const at = WORLDS.findIndex(world => world.id === active)
      id = WORLDS[(at + 1) % WORLDS.length]?.id ?? DEFAULT_WORLD
    }
    if (id !== 'off' && !worldById(id)) {
      return { text: `No world named "${arg}". Choices: ${names()}, next or off.` }
    }

    await $.store.set(STORE_KEY, id)
    const why = await show($, id)
    if (id === 'off') return { text: 'World off: back to the app’s own look. /world brings it back.' }
    const world = worldById(id)
    if (why) return { text: `Saved ${world?.label}, but nothing draws it here: ${why}` }
    return { text: `${world?.label}. ${world?.tagline}` }
  })

  // The scene never changes once drawn, so this renders once per world switch.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== PLUGIN) return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const scene = SCENES[e.props.scene]
    if (!scene) return next(e)
    const { Svg } = $.ui.resolve(e)

    return <Svg source={scene.svg} alt={scene.alt} isInteractive />
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const world = worldById(await read($, current))
    if (!world) return next(e)
    const value = await read($, hud)
    const snapshot: Hud = value.now === 0 ? { ...value, now: Date.now() } : value
    const classic = snapshot.mode === 'classic'
    const line = classic ? hudLine(world, snapshot) : hudSessionLine(world, snapshot)

    if (e.surface === 'desktop' || e.surface === 'mobile') {
      const { Svg } = $.ui.resolve(e)
      const width = bandWidth(e.props.bodyColumns)
      // An image, not an interactive frame: a frame reloads its whole document on every
      // redraw and blinks; an image swaps in place. The HUD needs no hover or script.
      return (
        <Svg
          source={classic ? hudSvg(world, snapshot, e.props.isWorking, width) : hudSessionSvg(world, snapshot, width)}
          alt={line}
          width={width}
          height={classic ? HUD_HEIGHT : HUD_SESSION_HEIGHT}
        />
      )
    }

    const { Text } = $.ui.resolve(e)
    return (
      <Text dimColor wrap="truncate">
        {line}
      </Text>
    )
  })
}
