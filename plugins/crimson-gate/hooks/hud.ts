// Preserve the original import path for callers of the classic HUD.
export { HUD_HEIGHT, HUD_MIN_WIDTH, HUD_WIDTH, hudLine, hudSvg, clock, until } from './hud-classic'

export const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')