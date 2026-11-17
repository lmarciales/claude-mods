import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

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

async function savedWorld($: EngineInterface): Promise<string> {
  const saved = await $.store.get(STORE_KEY)
  return typeof saved === 'string' && (saved === 'off' || worldById(saved)) ? saved : DEFAULT_WORLD
}

/** Paints a world, or clears the look for 'off'. Returns why nothing draws, if so. */
async function show($: EngineInterface, id: string): Promise<string | undefined> {
  await update($, current, () => id)
  if (id === 'off') {
    await $.theme.clear()
    return undefined
  }
  const world = worldById(id)
  if (!world) return `no world named ${id}`
  const result = await $.theme.set(world.build())
  return result.isDrawn ? undefined : result.reason
}

function figures(context: SessionContextUsage, limits: SessionRateLimit[], cost: SessionCost | undefined) {
  const five = limits.find(limit => limit.kind === 'five_hour')
  const seven = limits.find(limit => limit.kind === 'seven_day')
  const next: Partial<Hud> = {
    ctx: context.percent,
    ctxTokens: context.tokens,
    ctxWindow: context.window,
    session: five?.percentUsed,
    sessionReset: five?.resetsAt,
    week: seven?.percentUsed,
    weekReset: seven?.resetsAt,
    cost: cost?.usd,
  }
  return next
}

async function savedHud($: EngineInterface): Promise<'classic' | 'session'> {
  return (await $.store.get('hud')) === 'classic' ? 'classic' : 'session'
}

async function refreshGit($: EngineInterface, force = false): Promise<void> {
  const now = await $.clock.now()
  let refresh = false
  await update($, hud, value => {
    refresh = !value.gitRefreshing && (force || value.gitAt === undefined || now - value.gitAt >= 60_000)
    return refresh ? { ...value, gitAt: now, gitRefreshing: true } : value
  })
  if (!refresh) return
  try {
    const cwd = await $.session.cwd()
    const git = (args: string[]) => $.process.run(['git', ...args], {
      cwd, timeoutMs: 2000, env: { LC_ALL: 'C', LANG: 'C', GIT_OPTIONAL_LOCKS: '0' },
    })
    const run = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
    const branch = run.exitCode === 0 && !run.isStdoutTruncated ? run.stdout.trim() : undefined
    if (!branch) throw new Error('not a repository')
    const [diff, status, ahead] = await Promise.all([
      git(['diff', '--shortstat', 'HEAD', '--']),
      git(['status', '--porcelain=v1', '-z']),
      git(['rev-list', '--count', '@{u}..HEAD']),
    ])
    // -z avoids quoted/newline paths; a rename/copy has a second path, not a second file.
    const paths = status.stdout.split('\0').filter(Boolean)
    let files = 0
    for (let i = 0; i < paths.length; i++) {
      files++
      if (/^[RC]|^.[RC]/.test(paths[i]!)) i++
    }
    const validCount = ahead.exitCode === 0 && !ahead.isStdoutTruncated && /^\d+$/.test(ahead.stdout.trim())
    await update($, hud, value => ({ ...value, branch, gitRefreshing: false, git: {
      added: diff.exitCode === 0 && !diff.isStdoutTruncated ? Number(diff.stdout.match(/(\d+) insertion/)?.[1] ?? 0) : undefined,
      removed: diff.exitCode === 0 && !diff.isStdoutTruncated ? Number(diff.stdout.match(/(\d+) deletion/)?.[1] ?? 0) : undefined,
      files: status.exitCode === 0 && !status.isStdoutTruncated ? files : undefined,
      ahead: validCount ? Number(ahead.stdout.trim()) : undefined,
    } }))
  } catch {
    await update($, hud, value => ({ ...value, branch: undefined, git: undefined, gitRefreshing: false }))
  }
}

/** Keeps only what the HUD draws: the full breakdown carries a grid and per-file lists. */
function slim(b: SessionContextUsage['breakdown']): Hud['breakdown'] {
  if (!b) return undefined
  return {
    categories: b.categories.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
    totalTokens: b.totalTokens,
    autoCompactThreshold: b.autoCompactThreshold,
    isAutoCompactEnabled: b.isAutoCompactEnabled,
  }
}

async function refreshUsage($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    await update($, hud, value => ({ ...value, ...figures(usage.context, usage.rateLimits, usage.cost),
      startedAt: usage.startedAt, breakdown: slim(usage.context.breakdown) }))
  } catch { /* Preserve the latest measurement if usage is unavailable. */ }
}

async function refreshActivity($: EngineInterface): Promise<void> {
  try {
    const agents = (await $.agent.list()).filter(a => a.status === 'running' || a.status === 'pending').length
    await update($, hud, value => ({ ...value, agents }))
  } catch { /* Hosts may withhold the agent roster. */ }
  try {
    const turns = await $.session.turns()
    await update($, hud, value => ({ ...value, turns }))
  } catch { /* Keep the last count. */ }
}

async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, hud, value => ({ ...value, now }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'world',
      description: 'Turn the Crimson gate backdrop on or off',
      argumentHint: '[crimson|off]',
    })
    await $.command.register({ name: 'hud', description: 'Choose the session or classic HUD', argumentHint: '[session|classic]' })
    const mode = await savedHud($)
    await update($, hud, value => ({ ...value, mode }))

    const id = await savedWorld($)
    await show($, id)

    await tick($)
    await refreshUsage($)
    await refreshActivity($)
    await refreshGit($, true)

    // The clock and countdowns, and keeping every open session on the same world.
    $.clock.every(20_000, async () => {
      await tick($)
      const mode = await savedHud($)
      await update($, hud, value => value.mode === mode ? value : { ...value, mode })
      const want = await savedWorld($)
      if (want !== (await read($, current))) await show($, want)
      await refreshActivity($)
      await refreshGit($)
    })
    // The reply timer: a light tick while a turn runs, nothing while idle.
    $.clock.every(5_000, async () => {
      if ((await read($, hud)).turnId !== undefined) await tick($)
    })

    return next(e)
  })

  // Context, plan limits and cost, pushed by the engine when a figure moves.
  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, hud, value => ({ ...value, ...figures(e.context, e.rateLimits, e.cost), now }))
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
    await refreshActivity($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const now = await $.clock.now()
    const tool = e.tool.replace(/^mcp__(.+?)__(.+)$/, '$1:$2')
    await update($, hud, value => ({ ...value, now, totalTools: (value.totalTools ?? 0) + 1,
      ...(value.turnId === undefined ? {} : { tools: (value.tools ?? 0) + 1, tool, toolId: e.tool_use_id }) }))
    await refreshActivity($)
    try { return await next(e) } finally {
      await update($, hud, value => value.toolId === e.tool_use_id ? { ...value, tool: undefined, toolId: undefined } : value)
      await refreshActivity($)
    }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      await refreshActivity($)
      return result
    }
    const before = await read($, hud)
    await refreshUsage($)
    const now = await $.clock.now()
    const usage = result.usage ?? e.usage
    await update($, hud, value => {
      const input = usage ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens : 0
      return { ...value, now, turnId: undefined, turnStartedAt: undefined, tool: undefined, toolId: undefined,
        turnCostBefore: undefined,
        lastReply: usage ? { input, output: usage.output_tokens, seconds: Math.max(0, e.durationMs / 1000),
          cost: value.cost !== undefined && before.turnCostBefore !== undefined ? Math.max(0, value.cost - before.turnCostBefore) : undefined,
          cache: input > 0 ? usage.cache_read_input_tokens / input * 100 : undefined } : value.lastReply }
    })
    await refreshActivity($)
    await refreshGit($, true)
    return result
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const mode = (await read($, hud)).mode ?? 'session'
    if (!arg) return { text: `HUD: ${mode}. Choices: /hud session or /hud classic.` }
    if (arg !== 'session' && arg !== 'classic') return { text: `Unknown HUD "${arg}". Choices: /hud session or /hud classic.` }
    const selected: 'session' | 'classic' = arg
    await $.store.set('hud', selected)
    await update($, hud, value => ({ ...value, mode: selected }))
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
      return (
        <Svg
          source={classic ? hudSvg(world, snapshot, e.props.isWorking, width) : hudSessionSvg(world, snapshot, width)}
          alt={line}
          // An interactive SVG sits in a frame, and a frame with no size is 300×150.
          width={width}
          height={classic ? HUD_HEIGHT : HUD_SESSION_HEIGHT}
          isInteractive
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
