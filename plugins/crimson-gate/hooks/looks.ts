import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

/** How a world's HUD is painted. Raw hex only: the HUD is an SVG image. */
export type HudStyle = {
  /** Card fill and its opacity. */
  card: string
  cardOpacity: number
  /** Card outline. */
  edge: string
  /** Main accent, second accent, and the gauge track. */
  accent: string
  accent2: string
  track: string
  /** Strong text and quiet text. */
  text: string
  muted: string
  /** Gauge colors past 70% and 90%. */
  warn: string
  hot: string
  /** Label lettering: tracked capitals or plain words. */
  caps: boolean
  /** Adds a soft glow to accents. */
  glow: boolean
  /** A small emblem drawn in a 56×56 box, raw SVG markup. */
  emblem: string
}

export type World = {
  id: string
  label: string
  tagline: string
  build: () => ThemeSetArgs
  hud: HudStyle
}

const glass = { blur: 14, opacity: 0.55 }

const look = (id: string, colors: ThemeSetArgs['colors']): ThemeSetArgs => ({
  colors,
  backdrop: { scene: id, glass },
})

export const WORLDS: World[] = [
  {
    id: 'crimson',
    label: 'Crimson gate',
    tagline: 'A silent ring above a gothic city in red and gold.',
    build: () =>
      look(
        'crimson',
        makeColors({
          label: 'Crimson gate',
          only: 'dark',
          roles: { accent: '#ff3d52', danger: '#ff626b', success: '#65ce9c', warning: '#eeb653', pro: '#f2b84b' },
          dark: {
            gray: {
              anchors: {
                'surface-0': '#12080c',
                'surface-1': '#190d12',
                'surface-2': '#201218',
                'surface-3': '#27171e',
                'text-primary': '#f7e9ed',
                'text-secondary': '#d8bdc6',
                'text-muted': '#b99ba7',
              },
            },
          },
        }).theme,
      ),
    hud: {
      card: '#12080c', cardOpacity: 0.86, edge: '#ff3d52',
      accent: '#ff3d52', accent2: '#f2b84b', track: '#3b202b',
      text: '#f7e9ed', muted: '#b99ba7', warn: '#eeb653', hot: '#ff626b',
      caps: true, glow: false,
      emblem: '<g transform="translate(28 28)" fill="none"><circle r="18" stroke="#ff3d52" stroke-width="1.7"/><circle r="14" stroke="#f2b84b" stroke-width="1"/><path d="M-4 -18 v-5 h8 v5 M18 -4 h5 v8 h-5 M4 18 v5 h-8 v-5 M-18 4 h-5 v-8 h5 M10 -15 l4 -4 5 5 -4 4 M15 10 l4 4 -5 5 -4 -4 M-10 15 l-4 4 -5 -5 4 -4 M-15 -10 l-4 -4 5 -5 4 4" stroke="#ff3d52" stroke-width="1.3"/><path d="M0 -7 v14 M-7 0 h14" stroke="#f2b84b" stroke-width="1"/></g>',
    },
  },
]

export const DEFAULT_WORLD = 'crimson'

export const worldById = (id: string): World | undefined => WORLDS.find(world => world.id === id)
