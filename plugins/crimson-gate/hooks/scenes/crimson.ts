/** Original vector art. Geometry is assembled once on import; the scene never ticks. */
export const alt = 'Crimson gate: a thin toothed ring in a maroon night, a diagonal red light band, gothic towers at the lower corners, edge glyphs, violet orbs and two small wheels. The centre stays dark and quiet.'

const point = (r: number, a: number) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`
const gear = (r: number, teeth: number, depth: number) => Array.from({ length: teeth * 4 }, (_, i) =>
  `${i ? 'L' : 'M'}${point(r + (i % 4 === 1 || i % 4 === 2 ? depth : 0), i * Math.PI / (teeth * 2))}`).join(' ') + ' Z'
const ticks = Array.from({ length: 72 }, (_, i) => `<path d="M0 -506 v${i % 6 ? 6 : 14}" transform="rotate(${i * 5})"/>`).join('')
const glyphs = [
  'M-5 -8 L4 0 -3 8 M-6 0 h11', 'M-5 7 V-7 L6 -2 -4 2',
  'M-6 -6 L5 6 M-6 3 L5 -3 M1 -8 v16', 'M-6 -5 h11 L-2 2 5 7',
  'M-4 -8 v16 M-4 -2 h9 M3 -6 v11', 'M-6 6 L0 -7 6 6 M-3 1 h7',
  'M-5 -7 L5 0 -5 7 M5 -7 v14', 'M-5 -6 v12 L5 1 M0 -7 L6 -3',
]
const edges = [38, 1562].map((x, side) => `<g transform="translate(${x} 0)" stroke="#e15a70" stroke-width="1.4" opacity=".42" fill="none" stroke-linecap="round">${Array.from({ length: 19 }, (_, i) => `<path d="${glyphs[(i * 3 + side) % glyphs.length]}" transform="translate(${i % 3 * 3} ${40 + i * 43}) rotate(${(i % 3 - 1) * 13})"/>`).join('')}</g>`).join('')

/** A few asymmetric towers: gables, lancet windows and fine masonry strokes. */
function city(side: number): string {
  const towers = [[18, 128, 760], [87, 68, 615], [162, 112, 725], [267, 62, 652], [328, 58, 803]]
  return `<g transform="${side ? 'translate(1600 0) scale(-1 1)' : 'translate(0 0)'}" stroke-linejoin="round">${towers.map(([x, width, top], i) => {
    const base = top! + 55
    const mid = x! + width! / 2
    const spire = i % 2 ? `M${mid - 5} ${top} V${top! - 46} L${mid} ${top! - 87} L${mid + 5} ${top! - 46} V${top}` : ''
    const windows = Array.from({ length: i % 2 ? 2 : 3 }, (_, j) => `<path d="M${x! + 18 + j * 19} 858 v-20 q3 -10 6 0 v20 Z" fill="#e9b355" fill-opacity="${j % 2 ? '.28' : '.5'}" stroke="none"/>`).join('')
    return `<path d="M${x} 906 V${base} L${mid} ${top} L${x! + width!} ${base} V906 Z" fill="#120a10" stroke="#963446" stroke-width="1.4"/><path d="${spire} M${x! + 7} ${base! + 8} L${mid} ${top! + 14} L${x! + width! - 7} ${base! + 8} M${x! + 8} 895 V${base! + 17} M${x! + width! - 8} 895 V${base! + 17}" fill="none" stroke="#b14757" stroke-opacity=".47" stroke-width=".8"/>${i % 2 ? `<path d="M${mid - 4} ${base! + 48} v-25 q4 -15 8 0 v25 Z" fill="#e9b355" fill-opacity=".34" stroke="none"/>` : ''}${windows}<path d="M${x! + 5} 818 h${width! - 10} M${x! + 5} 882 h${width! - 10}" fill="none" stroke="#963446" stroke-width=".6" opacity=".5"/>`
  }).join('')}</g>`
}
const orbs = [[133, 169, 14], [303, 470, 9], [1457, 126, 16], [1314, 438, 10], [1495, 580, 12]]
const ornaments = [[109, 90, 13, 16], [259, 212, 10, 45], [1371, 239, 9, 22], [1481, 334, 11, 45], [118, 532, 8, 30], [1428, 678, 13, 17], [348, 360, 7, 45]]

export const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
<defs>
  <linearGradient id="crimson-night" x2="1" y2=".7"><stop stop-color="#130a13"/><stop offset=".45" stop-color="#0d080e"/><stop offset="1" stop-color="#260c15"/></linearGradient>
  <radialGradient id="crimson-horizon"><stop stop-color="#d72947" stop-opacity=".2"/><stop offset="1" stop-color="#b71838" stop-opacity="0"/></radialGradient>
  <linearGradient id="crimson-band" x1="0" y1="1" x2=".8" y2="0"><stop stop-color="#ff3d52" stop-opacity=".3"/><stop offset=".6" stop-color="#c72b49" stop-opacity=".12"/><stop offset="1" stop-color="#bd2443" stop-opacity="0"/></linearGradient>
  <linearGradient id="crimson-ring" x1="0" y1="0" x2=".3" y2="1"><stop stop-color="#e07585" stop-opacity=".38"/><stop offset=".65" stop-color="#bc4c60" stop-opacity=".22"/><stop offset="1" stop-color="#bc4c60" stop-opacity="0"/></linearGradient>
  <radialGradient id="crimson-violet"><stop stop-color="#a35eff" stop-opacity=".4"/><stop offset=".4" stop-color="#8245d8" stop-opacity=".18"/><stop offset="1" stop-color="#8245d8" stop-opacity="0"/></radialGradient>
  <radialGradient id="crimson-wheel"><stop stop-color="#ff6172" stop-opacity=".3"/><stop offset="1" stop-color="#ff3d52" stop-opacity="0"/></radialGradient>
  <radialGradient id="crimson-quiet"><stop offset=".25" stop-color="#0e090e" stop-opacity=".82"/><stop offset="1" stop-color="#0e090e" stop-opacity="0"/></radialGradient>
</defs>
<path d="M0 0 H1600 V900 H0 Z" fill="url(#crimson-night)"/>
<ellipse cx="1530" cy="285" rx="540" ry="540" fill="url(#crimson-horizon)"/>
<ellipse cx="70" cy="830" rx="480" ry="400" fill="url(#crimson-horizon)"/>
<path d="M-80 922 C89 590 248 470 515 374 C300 545 272 722 245 940 Z" fill="url(#crimson-band)"/>
<path d="M-55 874 C122 584 290 452 492 391" fill="none" stroke="#e14c64" stroke-width="1.2" opacity=".35"/>
<path d="M0 160 Q780 38 1600 114 M0 296 Q846 204 1600 254" fill="none" stroke="#59304c" stroke-width="40" opacity=".065"/>
<g transform="translate(800 395)" fill="none" stroke="url(#crimson-ring)">
  <path d="${gear(522, 54, 13)}" stroke-width="1.6"/>
  <circle r="514" stroke-width="1"/><circle r="496" stroke-width=".7"/>
  <path d="M-482 -54 A485 485 0 0 1 240 -422 M482 54 A485 485 0 0 1 385 294" stroke="#ed485f" stroke-width="3" opacity=".24"/>
  <g stroke-width=".8">${ticks}</g>
</g>
<ellipse cx="800" cy="480" rx="540" ry="460" fill="url(#crimson-quiet)"/>
${edges}
<g fill="none" stroke="#b87283" stroke-width="1.2" opacity=".5">${ornaments.map(([x, y, r, a]) => `<rect x="${x! - r! / 2}" y="${y! - r! / 2}" width="${r}" height="${r}" transform="rotate(${a} ${x} ${y})"/>`).join('')}</g>
${orbs.map(([x, y, r]) => `<g><circle cx="${x}" cy="${y}" r="${r! * 3.4}" fill="url(#crimson-violet)"/><circle cx="${x}" cy="${y}" r="${r}" fill="#120919" stroke="#9560ea" stroke-width="1.6"/><circle cx="${x! - r! * .32}" cy="${y! - r! * .35}" r="${r! * .19}" fill="#c49aff" opacity=".8"/></g>`).join('')}
<g opacity=".78">${city(0)}${city(1)}</g>
<g transform="translate(213 791)"><circle r="54" fill="url(#crimson-wheel)"/><g fill="none" stroke="#e46777"><circle r="28" stroke-width="1.4"/><circle r="23" stroke-width=".7"/>${Array.from({ length: 10 }, (_, i) => `<path d="M0 -25 V-5" transform="rotate(${i * 36})" stroke-width="1.3"/>`).join('')}<circle r="4" stroke-width="1.2"/></g></g>
<g transform="translate(1368 771) rotate(17)" fill="none" stroke="#e7b957" opacity=".75"><path d="${gear(29, 12, 6)}" stroke-width="1.5"/><circle r="22" stroke-width=".9"/><circle r="9" stroke-width="1.2"/><path d="M0 -27 V27 M-27 0 H27" stroke-width="1"/></g>
<g fill="#e9b355" opacity=".26"><circle cx="224" cy="55" r="1.2"/><circle cx="1394" cy="58" r="1.2"/><circle cx="117" cy="318" r="1"/><circle cx="1518" cy="472" r="1.3"/><circle cx="240" cy="411" r="1"/><circle cx="1359" cy="523" r="1.1"/></g>
</svg>`
