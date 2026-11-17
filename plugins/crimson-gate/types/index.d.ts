/** What the HUD above the prompt shows. Every figure is optional: one the engine has no reading for stays out. */
export type Hud = {
  /** Context window fill, 0 to 100. */
  ctx?: number
  /** Tokens in the window and the window's size. */
  ctxTokens?: number
  ctxWindow?: number
  /** Five-hour plan window used, 0 to 100, and when it resets (ISO). */
  session?: number
  sessionReset?: string
  /** Seven-day plan window used, 0 to 100, and when it resets (ISO). */
  week?: number
  weekReset?: string
  /** Session cost in US dollars. */
  cost?: number
  /** Current git branch of the working directory. */
  branch?: string
  /** Saved in $.store as `hud`; synchronized by the timer. */
  mode?: 'session' | 'classic'
  startedAt?: number
  turns?: number
  turnId?: string
  turnStartedAt?: number
  turnCostBefore?: number
  tools?: number
  /** Main-loop tool calls observed this session, retained across plugin reloads. */
  totalTools?: number
  tool?: string
  toolId?: string
  agents?: number
  /** Locally estimated at start and turn completion, never during render. */
  breakdown?: {
    categories: { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
    totalTokens: number
    autoCompactThreshold?: number
    isAutoCompactEnabled: boolean
  }
  lastReply?: { input: number; output: number; seconds: number; cost?: number; cache?: number }
  git?: { added?: number; removed?: number; files?: number; ahead?: number }
  gitAt?: number
  gitRefreshing?: boolean
  /** Milliseconds since the epoch at the last refresh, for the clock and countdowns. */
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'crimson-gate': {
      hud: Hud
      /** The world this session shows, or 'off'. */
      world: string
    }
  }
}
