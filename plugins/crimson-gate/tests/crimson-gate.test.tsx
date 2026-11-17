import { expect, mock, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import { hudSessionSvg } from '../hooks/hud-session'
import { parseStatus } from '../hooks/register'
import { DEFAULT_WORLD, WORLDS, worldById } from '../hooks/looks'
import { checkColors } from '../hooks/make-colors.js'
import * as crimson from '../hooks/scenes/crimson'
import type { Hud } from '../types'

const BAND = {
  plugin: 'crimson-gate',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const USAGE: SessionUsage = {
  startedAt: Date.parse('2098-12-31T22:00:00Z'),
  context: { tokens: 54_000, window: 200_000, percent: 27 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 9, resetsAt: '2099-01-01T00:00:00Z' },
    { kind: 'seven_day', percentUsed: 74, resetsAt: '2099-01-03T00:00:00Z' },
  ],
  cost: { usd: 4.37 },
}

// Stands in for the engine beneath the mod; returns what theme.set was given.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Stub = (event: string, hook: (engine: unknown, e: any) => unknown) => void

let activeClock: { settle: () => Promise<void> } | undefined

function engine(on: Stub, saved: unknown, options: { hud?: string; gitFails?: boolean; noUpstream?: boolean; mockClock?: boolean } = {}) {
  const sets: unknown[] = []
  const store = new Map<string, unknown>([['world', saved]])
  if (options.hud) store.set('hud', options.hud)
  const state = { now: Date.parse('2098-12-31T22:20:00Z'), usage: structuredClone(USAGE), agents: [] as { status: string }[], processes: [] as string[][], runs: [] as { argv: string[]; env?: Record<string, string>; timeoutMs?: number }[], clears: 0, usageCalls: [] as unknown[], branch: 'main' }
  on('command.register', () => ({ value: { command: 'world' } }))
  on('theme.set', (_, e) => {
    sets.push(e)
    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  on('theme.clear', () => { state.clears++; return { value: { isDrawn: false, reason: 'cleared' } } })
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, value)
    return { value: undefined }
  })
  on('session.usage', (_, e) => { state.usageCalls.push(e); return { value: state.usage } })
  on('session.turns', () => ({ value: 3 }))
  on('agent.list', () => ({ value: state.agents }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_, e) => {
    state.processes.push(e.argv)
    state.runs.push(e)
    const args = e.argv as string[]
    // The subcommand comes after the read-only flags.
    const command = args.find(arg => ['diff', 'status'].includes(arg))
    const fails = options.gitFails
    const upstream = options.noUpstream ? '' : '# branch.upstream origin/main\0# branch.ab +2 -0\0'
    const status = `# branch.oid 0123456789abcdef\0# branch.head ${state.branch}\0${upstream}`
      + '1 .M N... 100644 100644 100644 a b one\0'
      + '1 A. N... 000000 100644 100644 a b two\0'
      + '2 R. N... 100644 100644 100644 a b R100 new\0old\0'
      + '? four\0'
    const stdout = command === 'diff' ? ' 4 files changed, 142 insertions(+), 37 deletions(-)\n' : status
    return { value: { exitCode: fails ? 1 : 0, stdout: fails ? '' : stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // Without a test's own clock, a mock one: timers run only when the test advances or settles it.
  if (!options.mockClock) activeClock = mock.clock(on, { now: state.now })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer, usage: e.usage }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('classic.CwdChanged', () => ({}))
  return { sets, store, state }
}

test('the saved world paints at start, and the HUD shows the figures on every surface', async ($, on) => {
  const { sets } = engine(on, 'crimson')
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()

  expect(JSON.stringify(sets.at(-1))).toContain('"scene":"crimson"')

  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const svg = await ui.find({ type: 'Svg' })
    expect(svg).toBeDefined()
    // Sized explicitly: an interactive SVG's frame would otherwise be 300×150.
    expect(JSON.stringify(svg)).toContain('"width":640')
    expect(JSON.stringify(svg)).toContain('27%')
    expect(JSON.stringify(svg)).toContain('main')
    await ui.unmount()
  }

  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const line = await ui.find({ type: 'Text', text: /ctx 27%/ })
    expect(line?.text).toContain('week 74%')
    await ui.unmount()
  }
})

test('the HUD follows the band width, with a floor where the gauges still fit', async ($, on) => {
  engine(on, 'crimson')
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()

  for (const [columns, width] of [[150, 1200], [40, 520]] as const) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: columns }, surface: 'desktop' })
    const svg = JSON.stringify(await ui.find({ type: 'Svg' }))
    expect(svg).toContain(`"width":${width}`)
    expect(svg).toContain(`viewBox=\\"0 0 ${width} 132\\"`)
    await ui.unmount()
  }
})

test('/hud reports, switches, saves and rejects unknown choices; classic keeps its original figures', async ($, on) => {
  const { store } = engine(on, 'crimson')
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  expect((await $.command.run(hud(''))).text).toContain('HUD: session')
  expect((await $.command.run(hud('classic'))).text).toContain('HUD: classic')
  expect(store.get('hud')).toBe('classic')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = JSON.stringify(await ui.find({ type: 'Svg' }))
  expect(svg).toContain('27%')
  expect(svg).toContain('main')
  expect(svg).toContain('"height":92')
  await ui.unmount()
  expect((await $.command.run(hud('other'))).text).toContain('Unknown HUD')
  expect(store.get('hud')).toBe('classic')
  await $.command.run(hud('session'))
  expect(store.get('hud')).toBe('session')
})

test('a saved classic choice loads at session start', async ($, on) => {
  engine(on, 'crimson', { hud: 'classic' })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  expect((await $.command.run(hud(''))).text).toContain('HUD: classic')
})

test('session HUD is idle between turns and shows the current tool, elapsed time and running agents during a call', async ($, on) => {
  const timer = mock.clock(on, { now: Date.parse('2098-12-31T22:20:00Z') })
  const { state } = engine(on, 'crimson', { mockClock: true })
  on('tool.call', async () => { await timer.sleep(1000); return { result: 'done' } })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await timer.settle()
  const idle = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await idle.find({ type: 'Text' }))?.text).toContain('Idle · 3 messages · 20m')
  await idle.unmount()
  await $.turn.start({ text: 'work', turnId: 'turn-1' })
  state.agents = [{ status: 'running' }, { status: 'pending' }, { status: 'completed' }]
  await timer.advance(42_000)
  const call = $.tool.call({ tool: 'mcp__server__tool', tool_use_id: 'tool-1' } as never)
  await timer.settle()
  const working = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = JSON.stringify(await working.find({ type: 'Svg' }))
  expect(svg).toContain('Working · server:tool · 0:42 · 1 tools · 2 agents')
  expect(svg).toContain('working-dot')
  await working.unmount()
  await timer.advance(1000)
  await call
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', reason: 'answer', isAborted: false, durationMs: 42_000 })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const line = (await ui.find({ type: 'Text' }))?.text ?? ''
  expect(line).toContain('Idle')
  expect(line.includes('server:tool')).toBe(false)
  await ui.unmount()
})

test('plan warnings appear at 70 and turn red at 90, with no normal plan readout', async ($, on) => {
  const { state } = engine(on, 'crimson')
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  for (const [five, week, expected, color] of [[69, 69, '', ''], [70, 69, '⚠ 5h 70%', '#eeb653'], [69, 74, '⚠ week 74%', '#eeb653'], [82, 90, '⚠ week 90%', '#ff626b']] as const) {
    const rateLimits = [{ kind: 'five_hour', percentUsed: five }, { kind: 'seven_day', percentUsed: week }]
    await $.session.measure({ context: state.usage.context, cost: state.usage.cost, rateLimits, changed: ['rateLimits'] } as never)
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const svg = JSON.stringify(await ui.find({ type: 'Svg' }))
    if (expected) { expect(svg).toContain(expected); expect(svg).toContain(`fill=\\"${color}\\"`) }
    else { expect(svg.includes('⚠')).toBe(false); expect(svg.includes('5h')).toBe(false); expect(svg.includes('week')).toBe(false) }
    await ui.unmount()
  }
})

test('git failures leave the header without repository text', async ($, on) => {
  engine(on, 'crimson', { gitFails: true })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = JSON.stringify(await ui.find({ type: 'Svg' }))
  expect(svg.includes('>GIT<')).toBe(false)
  expect(svg.includes('main')).toBe(false)
  await ui.unmount()
})

test('git parses rename paths once and includes staged and unstaged changes', async ($, on) => {
  const { state } = engine(on, 'crimson')
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const line = (await ui.find({ type: 'Text' }))?.text ?? ''
  expect(line).toContain('Git main +142 −37 · 4 files · ↑2')
  expect(state.processes.some(args => args.join(' ').endsWith('diff --shortstat --no-ext-diff --no-textconv --ignore-submodules=all HEAD --'))).toBe(true)
  await ui.unmount()
})

test('no upstream omits ahead count', async ($, on) => {
  engine(on, 'crimson', { noUpstream: true })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const line = (await ui.find({ type: 'Text' }))?.text ?? ''
  expect(line).toContain('Git main')
  expect(line.includes('↑')).toBe(false)
  await ui.unmount()
})

test('reply metrics use cost difference, all input tokens, cache ratio and completed turn duration', async ($, on) => {
  const { state } = engine(on, 'crimson')
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  await $.turn.start({ text: 'work', turnId: 'turn-1' })
  state.usage.cost = { usd: 4.79 } as SessionUsage['cost']
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', reason: 'answer', isAborted: false, durationMs: 20_000,
    usage: { input_tokens: 500, output_tokens: 2000, cache_read_input_tokens: 9400, cache_creation_input_tokens: 100, model: 'test' } })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const line = (await ui.find({ type: 'Text' }))?.text ?? ''
  expect(line).toContain('last $0.42 · cache 94% · 10k in · 2k out · 100 tok/s')
  expect(state.usageCalls.filter(e => (e as { breakdown?: string }).breakdown === 'summary').length).toBe(2)
  await ui.unmount()
})

test('the 20-second poll synchronizes the HUD choice; git reads twice every 30 s and drawing runs nothing', async ($, on) => {
  const timer = mock.clock(on, { now: Date.parse('2098-12-31T22:20:00Z') })
  const { state, store } = engine(on, 'crimson', { mockClock: true })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await timer.settle()
  expect(state.processes.length).toBe(2)
  store.set('hud', 'classic')
  await timer.advance(20_000)
  expect((await $.command.run(hud(''))).text).toContain('HUD: classic')
  expect(state.processes.length).toBe(2)
  store.set('hud', 'session')
  await timer.advance(20_000)
  expect((await $.command.run(hud(''))).text).toContain('HUD: session')
  expect(state.processes.length).toBe(4)
  await timer.advance(20_000)
  expect(state.processes.length).toBe(6)
  const reads = state.usageCalls.length
  const runs = state.processes.length
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.unmount()
  }
  expect(state.usageCalls.length).toBe(reads)
  expect(state.processes.length).toBe(runs)
  expect(state.usageCalls.length).toBe(1)
})

test('context tooltip includes all categories and auto-compact room, with deferred schemas outside the segments', async ($, on) => {
  const { state } = engine(on, 'crimson')
  state.usage.context.breakdown = {
    categories: [
      { name: 'Messages', tokens: 40_000, kind: 'used', color: 'promptBorder', isDeferred: false },
      { name: 'System prompt', tokens: 8000, kind: 'used', color: 'promptBorder', isDeferred: false },
      { name: 'Memory files <CLAUDE.md>', tokens: 6000, kind: 'used', color: 'promptBorder', isDeferred: false },
      { name: 'Free space', tokens: 126_000, kind: 'free', color: 'inactive', isDeferred: false },
      { name: 'Autocompact buffer', tokens: 20_000, kind: 'buffer', color: 'inactive', isDeferred: false },
      { name: 'Deferred tools', tokens: 9000, kind: 'deferred', color: 'inactive', isDeferred: true },
    ],
    totalTokens: 54_000, rawMaxTokens: 200_000, maxTokens: 200_000, percentage: 27,
    autocompactSource: 'model-default', gridRows: [], model: 'test', memoryFiles: [], mcpTools: [], agents: [],
    autoCompactThreshold: 180_000, isAutoCompactEnabled: true, apiUsage: null,
  }
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = JSON.stringify(await ui.find({ type: 'Svg' }))
  expect(svg).toContain('Messages: 40,000 tokens (used)')
  expect(svg).toContain('Memory files &lt;CLAUDE.md&gt;: 6,000 tokens (used)')
  expect(svg).toContain('Deferred tools: 9,000 tokens (deferred)')
  expect(svg).toContain('126,000 tokens before auto-compact')
  expect(svg).toContain('54k / 200k · 126k to compact')
  expect(svg).toContain('conv 74%')
  expect(svg).toContain(' conversation 40k')
  expect(svg).toContain(' tools 8k')
  expect(svg).toContain(' memory 6k')
  expect(state.usageCalls.length).toBe(1)
  await ui.unmount()
})

test('subagent turns leave the main turn and last reply intact', async ($, on) => {
  engine(on, 'crimson')
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  await $.turn.start({ text: 'main', turnId: 'main' })
  await $.turn.start({ text: 'child', turnId: 'child', agentId: 'agent-1' })
  await $.turn.complete({ turnId: 'child', agentId: 'agent-1', answer: 'done', reason: 'answer', isAborted: false, durationMs: 1000,
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'test' } })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const line = (await ui.find({ type: 'Text' }))?.text ?? ''
  expect(line).toContain('Working')
  expect(line).toContain('last reply –')
  expect(line.includes('0 agents')).toBe(false)
  await ui.unmount()
})

function hud(args: string) {
  return { command: 'hud', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never
}

// A /world run as the person's Enter would send it.
function world(args: string) {
  return { command: 'world', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never
}

test('session HUD has six gauges, header-only git and no motion in every world', () => {
  const h: Hud = { now: 78_240_000, startedAt: 0, ctx: 38, ctxTokens: 384_700, ctxWindow: 1_000_000,
    cost: 47.5, turns: 74, totalTools: 412, agents: 2, session: 74,
    turnId: 'main', turnStartedAt: 78_198_000, tool: 'Bash', tools: 6,
    branch: 'main', git: { added: 142, removed: 37, files: 3, ahead: 1 },
    lastReply: { input: 12_400, output: 2050, seconds: 24, cost: .42, cache: 94 },
    breakdown: { totalTokens: 384_700, autoCompactThreshold: 900_000, isAutoCompactEnabled: true,
      categories: [{ name: 'Messages', tokens: 320_000, kind: 'used' },
        { name: 'Tools', tokens: 51_000, kind: 'used' }, { name: 'Memory files', tokens: 6000, kind: 'used' }] } }
  for (const world of WORLDS) {
    const svg = hudSessionSvg(world, h, 1336)
    expect(/animation|@keyframes|<animate/i.test(svg)).toBe(false)
    expect(svg).toContain('viewBox="0 0 1336 132"')
  }
  const svg = hudSessionSvg(worldById('crimson')!, h, 1336)
  const [header, body] = svg.split('<g id="session-gauges">')
  expect(header!).toContain('id="session-header"')
  expect(header!).toContain('id="session-git"')
  expect(header!).toContain('⎇ main   +142 −37 · 3 files · ↑1')
  expect(header!).toContain('<tspan fill="#f7e9ed">⎇ main</tspan>')
  expect(header!).toContain('<tspan fill="#f2b84b">   +142</tspan>')
  expect(header!).toContain('<tspan fill="#ff626b"> −37</tspan>')
  expect(header!).toContain('id="session-plan"')
  expect(body!.includes('main')).toBe(false)
  expect(body!.includes('>GIT<')).toBe(false)
  for (const label of ['CONTEXT', 'COST', 'LAST REPLY', 'CONTEXT MIX', 'CACHE', 'SESSION']) expect(body!).toContain(`>${label}</text>`)
  for (const value of ['38%', '$47.5', '85 tok/s', 'conv 85%', '94%', '74 msgs',
    '384.7k / 1M · 515.3k to compact', 'last $0.42 · $0.64 per reply', '12.4k in · 2k out · 24s',
    '21h 44m · 412 tools · 2 agents']) expect(body!).toContain(value)
})

test('session HUD placeholders, escaping, partial git readings and width floor stay quiet and finite', () => {
  const world = worldById('crimson')!
  const empty = hudSessionSvg(world, { now: 0 }, 10)
  expect(empty).toContain('viewBox="0 0 520 132"')
  expect(empty).toContain('waiting for a reply')
  expect(empty).toContain('waiting for context breakdown')
  expect(empty).toContain('>–</text>')
  expect(empty).toContain('class="idle-dot"')
  expect(empty.includes('session-git')).toBe(false)
  expect(/NaN|Infinity|undefined/.test(empty)).toBe(false)
  const svg = hudSessionSvg(world, { now: 0, cost: 0, turns: 0, branch: '<main&"', git: { removed: 7 }, tool: '<Bash>', turnId: 'main' }, 520)
  expect(svg).toContain('⎇ &lt;main&amp;&quot;')
  expect(svg).toContain('&lt;Bash&gt;')
  expect(svg).toContain(' −7')
  expect(svg.includes('+undefined')).toBe(false)
  expect(svg.includes('to compact')).toBe(false)
  expect(/NaN|Infinity/.test(svg)).toBe(false)
})

test('crimson is static vector art with a desktop-safe palette and is the default world', () => {
  expect(crimson.svg).toContain('viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"')
  expect(crimson.svg.length).toBeLessThan(60_000)
  expect(/animation|@keyframes|<animate|<filter|<image|data:|https?:\/\/(?!www.w3.org)/i.test(crimson.svg)).toBe(false)
  const world = worldById('crimson')!
  const theme = world.build()
  expect(checkColors(theme.colors).filter(p => p.startsWith("Desktop won't paint")).length).toBe(0)
  expect(JSON.stringify(theme.backdrop)).toBe('{"scene":"crimson","glass":{"blur":14,"opacity":0.55}}')
  expect(world.hud.caps).toBe(true)
  expect(world.hud.glow).toBe(false)
  expect(DEFAULT_WORLD).toBe('crimson')
})

test('/world crimson saves, sets its scene and serves the original SVG', async ($, on) => {
  const { sets, store } = engine(on, 'crimson')
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  expect((await $.command.run(world('crimson'))).text).toContain('Crimson gate')
  expect(store.get('world')).toBe('crimson')
  expect(JSON.stringify(sets.at(-1))).toContain('"scene":"crimson"')
  const ui = await $.ui.mount({ plugin: 'crimson-gate', component: 'Backdrop', surface: 'desktop', props: { plugin: 'crimson-gate', scene: 'crimson' } } as never)
  expect(JSON.stringify(await ui.find({ type: 'Svg' }))).toContain('Crimson gate:')
  await ui.unmount()
})

test('session tool totals retain existing atom state, span turns and exclude subagent calls', async ($, on) => {
  engine(on, 'crimson')
  on('tool.call', () => ({ result: 'done' }))
  // Simulate the host retaining the atom from the previous plugin environment.
  let snapshot: Hud = { now: 0, totalTools: 410 }
  let version = 1
  on('state.get', (_, e, next) => e.key === 'hud' ? { value: { value: snapshot, version } } : next(e))
  on('state.set', (_, e, next) => {
    if (e.key !== 'hud') return next(e)
    snapshot = e.value as Hud
    return { value: { isSet: true, version: ++version } }
  })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  for (const id of ['one', 'two']) {
    await $.turn.start({ text: 'work', turnId: id })
    await $.tool.call({ tool: 'Bash', tool_use_id: id } as never)
    await $.tool.call({ tool: 'Bash', tool_use_id: `child-${id}`, agentId: 'child' } as never)
    await $.turn.complete({ turnId: id, answer: 'done', reason: 'answer', isAborted: false, durationMs: 1000 })
  }
  expect(snapshot.totalTools).toBe(412)
  expect(snapshot.tools).toBe(1)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  expect(snapshot.totalTools).toBe(412)
})

test('the five-second tick runs only during a main turn, and the idle clock keeps to the minute', async ($, on) => {
  const timer = mock.clock(on, { now: Date.parse('2098-12-31T22:20:00Z') })
  engine(on, 'crimson', { mockClock: true })
  let snapshot: Hud = { now: 0 }
  on('state.set', (_, e, next) => {
    if (e.key === 'hud') snapshot = e.value as Hud
    return next(e)
  })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await timer.settle()
  const initial = snapshot.now
  await timer.advance(5000)
  expect(snapshot.now).toBe(initial)
  await $.turn.start({ text: 'work', turnId: 'main' })
  await timer.advance(5000)
  expect(snapshot.now).toBe(initial + 10_000)
  await $.turn.complete({ turnId: 'main', answer: 'done', reason: 'answer', isAborted: false, durationMs: 5000 })
  expect(snapshot.now).toBe(initial)
  const writes = snapshot
  await timer.advance(15_000)
  expect(snapshot).toBe(writes)
})

test('an idle session writes nothing while nothing visible changes', async ($, on) => {
  const timer = mock.clock(on, { now: Date.parse('2098-12-31T22:20:00Z') })
  engine(on, 'crimson', { mockClock: true })
  let writes = 0
  on('state.set', (_, e, next) => {
    if (e.key === 'hud') writes++
    return next(e)
  })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await timer.settle()
  const settled = writes
  // Three 20 s polls inside the same minute: no write, so no redraw.
  await timer.advance(40_000)
  expect(writes).toBe(settled)
  // The minute turns: one write for the clock.
  await timer.advance(20_000)
  expect(writes).toBe(settled + 1)
})

test('the HUD is an image, not an interactive frame, and carries no animation', async ($, on) => {
  engine(on, 'crimson')
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  for (const mode of ['session', 'classic'] as const) {
    await $.command.run(hud(mode))
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const svg = await ui.find({ type: 'Svg' })
    expect(JSON.stringify(svg)).not.toContain('isInteractive')
    expect(/animation|@keyframes|<animate/.test(JSON.stringify(svg))).toBe(false)
    await ui.unmount()
  }
})

test('git only reads: no locks, no fsmonitor, no lazy fetch, no prompts, 2 s cap', async ($, on) => {
  const { state } = engine(on, 'crimson')
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  expect(state.processes.length).toBe(2)
  for (const run of state.runs) {
    expect(run.argv.slice(0, 7)).toEqual(['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c'])
    expect(JSON.stringify(run)).toContain('"GIT_NO_LAZY_FETCH":"1"')
    expect(JSON.stringify(run)).toContain('"GIT_TERMINAL_PROMPT":"0"')
    expect(JSON.stringify(run)).toContain('"timeoutMs":2000')
    expect(run.argv.some(arg => ['fetch', 'pull', 'push', 'commit', 'checkout', 'reset', 'add', 'gc'].includes(arg))).toBe(false)
  }
})

test('a saved off choice never clears another plugin theme at start', async ($, on) => {
  const { state } = engine(on, 'off')
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await activeClock!.settle()
  expect(state.clears).toBe(0)
})

test('git status parsing: detached heads show the short commit, a new repository has no branch yet', () => {
  expect(parseStatus('# branch.oid 0123456789abcdef # branch.head (detached) # branch.upstream origin/main # branch.ab +3 -0 ').ahead).toBe(undefined)
  expect(parseStatus('# branch.oid 0123456789abcdef\0# branch.head (detached)\0')).toEqual({ branch: '0123456', ahead: undefined, files: 0 })
  expect(parseStatus('# branch.oid (initial)\0# branch.head (detached)\0').branch).toBe(undefined)
  expect(parseStatus('# branch.oid (initial)\0# branch.head main\0? a\0').files).toBe(1)
  expect(parseStatus('# branch.head main\0# branch.ab +0 -3\0u UU N... 1 2 3 4 a b c x\0').ahead).toBe(0)
})

test('the branch follows a switch made by a tool, a moment after the tool, in one read', async ($, on) => {
  const timer = mock.clock(on, { now: Date.parse('2098-12-31T22:20:00Z') })
  const { state } = engine(on, 'crimson', { mockClock: true })
  on('tool.call', () => ({ result: 'done' }))
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await timer.settle()
  expect(state.processes.length).toBe(2)
  await $.turn.start({ text: 'switch', turnId: 'main' })
  state.branch = 'feature'
  await $.tool.call({ tool: 'Bash', tool_use_id: 'one' } as never)
  await $.tool.call({ tool: 'Edit', tool_use_id: 'two' } as never)
  await $.tool.call({ tool: 'Read', tool_use_id: 'three' } as never)
  // Nothing runs before or during the calls themselves.
  expect(state.processes.length).toBe(2)
  await timer.advance(1_500)
  expect(state.processes.length).toBe(4)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toContain('Git feature')
  await ui.unmount()
})

test('a new working folder and the end of a reply read git right away; idle, the 30 s poll catches outside changes', async ($, on) => {
  const timer = mock.clock(on, { now: Date.parse('2098-12-31T22:20:00Z') })
  const { state } = engine(on, 'crimson', { mockClock: true })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await timer.settle()
  state.branch = 'worktree-a'
  await $.classic.CwdChanged({ old_cwd: '/repo', new_cwd: '/repo/.worktrees/a' })
  await timer.settle()
  expect(state.processes.length).toBe(4)
  await $.turn.start({ text: 'work', turnId: 'main' })
  await $.turn.complete({ turnId: 'main', answer: 'done', reason: 'answer', isAborted: false, durationMs: 1000 })
  await timer.settle()
  expect(state.processes.length).toBe(6)
  state.branch = 'switched-outside'
  await timer.advance(30_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toContain('Git switched-outside')
  await ui.unmount()
})
