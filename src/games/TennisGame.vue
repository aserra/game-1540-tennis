<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createGame, clamp, SWING_TIME } from '../game/core.js'
import '@fontsource/bebas-neue/latin-400.css'

// 8-bit tennis, Game Boy style: the court is taller than the screen and a camera
// follows the action; the characters are big-headed 1px sprites. You steer your
// player with the stick and swing with the button yourself: timing decides how
// clean the shot is, the stick (left/right) at the moment of the hit its direction. The
// right pad: hold it to charge a harder shot; where you drag it decides the shot at release
// (left/right = direction, up = lob, down = drop shot); a quick tap is a plain shot.
// Coordinates: x in [-1, 1] across the singles court, y in [0, 1] from the far
// baseline to the near one, z is height. Prototype: best streak in localStorage.
const W = 144
const H = 240
const CX = 72
const HWF = 41 // half singles-court width in px at the far / near baseline
const HWN = 52
const ALLEY = 1.25 // doubles line, in singles half-widths
const L = 172 // court length in px
const TOP = -90 // world y of the first row of the background
const BOTTOM = L + 70
const ZS = 150
const STREAK_KEY = 'tennis-best-streak'

// UI strings: English by default, Catalan when the browser is set to it.
const MESSAGES = {
  en: {
    title: 'Tennis',
    streak: 'Streak',
    best: 'Best',
    win: 'You won!',
    lose: 'You lost',
    howTo2: 'Move your player with the left stick. On the right, hold SWING to charge power and drag before releasing: left/right picks the direction, up is a lob, down is a drop shot.',
    lob: 'LOB',
    drop: 'DROP',
    swing: 'SWING',
    serveHint2: 'Press SWING to serve',
    retry: 'Tap to try again',
    tapToStart: 'Tap to start'
  },
  ca: {
    title: 'Tennis',
    streak: 'Ratxa',
    best: 'Rècord',
    win: 'Has guanyat!',
    lose: 'Has perdut',
    howTo2: 'Mou el jugador amb el joystick esquerre. A la dreta, mantén premut COP per carregar força i arrossega abans de deixar-lo anar: esquerra/dreta tria cap a on va, amunt fa un globus i avall una deixada.',
    lob: 'GLOBUS',
    drop: 'DEIXADA',
    swing: 'COP',
    serveHint2: 'Prem COP per servir',
    retry: 'Toca per tornar-hi',
    tapToStart: 'Toca per començar'
  }
}
const lang = navigator.language?.toLowerCase().startsWith('ca') ? 'ca' : 'en'
const tr = (key) => MESSAGES[lang][key]

// Court surfaces: the playing area and what surrounds it. Change SURFACE to switch.
const SURFACES = {
  clay: { court: '#C8683A', around: '#2F6B3A', net: '#9AA0A6' },
  greenset: { court: '#2F8F5B', around: '#1F5C3C', net: '#8FB09A' }
}
const SURFACE = 'clay'
const S = SURFACES[SURFACE]

const C = {
  line: '#FCF9EF',
  navy: '#00326A',
  blue: '#0B5CAB',
  yellow: '#FBC101',
  dark: '#1C1C1C'
}

const canvas = ref(null)
const stage = ref(null)
// Two renderers over the same simulation: the 2D canvas and the Three.js one (src/game/render3d.js).
// Order of precedence: ?2d / ?3d in the URL, then the choice remembered in this browser, then DEFAULT_MODE.
const MODE_KEY = 'tennis-render-mode'
const DEFAULT_MODE = '3d'
const readMode = () => {
  const q = new URLSearchParams(window.location.search)
  if (q.has('2d')) return '2d'
  if (q.has('3d')) return '3d'
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === '2d' || saved === '3d') return saved
  } catch {
    // storage blocked: fall back to the default
  }
  return DEFAULT_MODE
}
const renderMode = readMode()
const use3d = renderMode === '3d'
// Switching reloads the page (the renderers are not hot-swappable), so it is only offered between matches.
const switchMode = () => {
  const next = use3d ? '2d' : '3d'
  try {
    localStorage.setItem(MODE_KEY, next)
  } catch {
    // the URL parameter below still carries the choice
  }
  window.location.search = `?${next}`
}
let r3d = null
const phase = ref('title') // title | playing | over
const won = ref(false)
const streak = ref(0)
const bestStreak = ref(Number(localStorage.getItem(STREAK_KEY)) || 0)
const serveHint = ref(false)
const scoreP = ref('0')
const scoreC = ref('0')
const knob = ref({ x: 0, y: 0 })
const chargeUi = ref(0)
const padKnob = ref({ x: 0, y: 0 })

// ---- 3x5 pixel font -------------------------------------------------------
const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', I: '111010010010111', K: '101101110101101',
  L: '100100100100111', P: '110101110100100', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111',
  W: '101101111111101', Y: '101101010010010', 0: '111101101101111', 1: '010110010010111',
  2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110',
  6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110',
  '!': '010010010000010', '/': '001001010100100', '-': '000000111000000'
}

const rect = (g, x, y, w, h, col) => {
  const x0 = Math.round(x)
  const y0 = Math.round(y)
  const w0 = Math.round(x + w) - x0
  const h0 = Math.round(y + h) - y0
  if (w0 <= 0 || h0 <= 0) return
  g.fillStyle = col
  g.fillRect(x0, y0, w0, h0)
}
const textWidth = (str, s) => str.length * 4 * s - s
const drawText = (g, str, x, y, s, col) => {
  for (let i = 0; i < str.length; i++) {
    const bits = GLYPHS[str[i]]
    if (!bits) continue
    for (let k = 0; k < 15; k++) {
      if (bits[k] === '1') rect(g, x + (i * 4 + (k % 3)) * s, y + Math.floor(k / 3) * s, s, s, col)
    }
  }
}

// ---- world -> screen ------------------------------------------------------
let camY = TOP
const hwAt = (y) => HWF + (HWN - HWF) * Math.min(1.3, Math.max(-0.3, y))
const wy = (y) => y * L - camY
const screen = (x, y, z = 0) => [CX + x * hwAt(y), wy(y) - z * ZS]

// ---- static world background ---------------------------------------------
let bg = null
const buildBackground = () => {
  const el = document.createElement('canvas')
  el.width = W
  el.height = BOTTOM - TOP
  const g = el.getContext('2d')
  const Y = (y) => y - TOP // world px -> canvas px
  rect(g, 0, 0, W, el.height, S.around)

  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const crowd = ['#BFD7F2', C.line, C.yellow, '#7FA8DA', C.navy]
  const stand = (y0, y1) => {
    rect(g, 0, Y(y0), W, y1 - y0, C.blue)
    for (let y = y0 + 1; y < y1 - 1; y += 2) {
      for (let x = (y / 2) % 2 ? 1 : 0; x < W; x += 3) rect(g, x, Y(y), 2, 1, crowd[Math.floor(rnd() * crowd.length)])
    }
  }
  stand(TOP, -50)
  rect(g, 0, Y(-50), W, 16, C.navy)
  drawText(g, 'NOLATOKEM', (W - textWidth('NOLATOKEM', 2)) / 2, Y(-47), 2, C.line)

  // court: a trapezoid (the far side is narrower), singles lines plus the doubles alleys
  const lineAt = (x, row, w = 1) => rect(g, x, Y(row), w, 1, C.line)
  for (let row = 0; row < L; row++) {
    const hw = hwAt(row / L)
    rect(g, CX - hw * ALLEY, Y(row), hw * ALLEY * 2, 1, S.court)
    lineAt(CX - hw * ALLEY, row)
    lineAt(CX + hw * ALLEY - 1, row)
    lineAt(CX - hw, row)
    lineAt(CX + hw - 1, row)
  }
  for (const [row, span, thick] of [[0, ALLEY, 2], [L - 1, ALLEY, 2], [L * 0.25, 1, 1], [L * 0.75, 1, 1]]) {
    const hw = hwAt(row / L) * span
    rect(g, CX - hw, Y(row), hw * 2, thick, C.line)
  }
  rect(g, CX, Y(L * 0.25), 1, L * 0.5, C.line)

  // umpire chair, next to the net
  const ux = 138
  const uy = Y(L / 2) + 12
  rect(g, ux - 3, uy - 12, 1, 12, C.line)
  rect(g, ux + 2, uy - 12, 1, 12, C.line)
  rect(g, ux - 3, uy - 6, 6, 1, C.line)
  rect(g, ux - 4, uy - 13, 8, 1, C.line)
  rect(g, ux - 2, uy - 18, 4, 5, '#2B2B2B')
  rect(g, ux - 1, uy - 21, 3, 3, '#E3A672')
  rect(g, ux - 2, uy - 22, 5, 1, C.line)
  bg = el
}

// ---- sprites (1px, outlined, big head) ------------------------------------
const PAL = {
  K: C.dark, S: '#E3A672', s: '#C98650', W: '#FCF9EF', R: '#C62828', r: '#8E1B1B',
  B: '#6FB1E8', b: '#3C7FC0', N: '#00326A', G: '#9AA0A6', H: '#6B3E1E'
}
const HEAD = {
  front: [
    '..K.KK.K..', '.KKKKKKKK.', 'KKKKKKKKKK', 'KKSSSSSSKK', 'KSSSSSSSSK',
    'KSKKSSKKSK', 'KSSSSSSSSK', '.KSWWWWSK.', '..KSSSSK..', '...KKKK...'
  ],
  back: [
    '...KKKK...', '..KWWWWK..', '.KWWWWWWK.', '.KWWKKWWK.', '.KWWWWWWK.',
    '.KHHHHHHK.', '.KHHHHHHK.', '..KHHHHK..', '...KSSK...', '...KKKK...'
  ]
}
const TORSO = {
  front: ['.KRRRRK.', 'KRRRRRRK', 'KRRWWRRK', 'KRRWWRRK', 'KRRRRRRK', 'KWWWWWWK', '.KWWWWK.'],
  back: ['.KBBBBK.', 'KBBBBBBK', 'KBBbbBBK', 'KBBbbBBK', 'KBBBBBBK', 'KNNNNNNK', '.KNNNNK.']
}
const LEGS_A = ['.KSKKSK.', '.KSK.KSK', 'KSK..KSK', 'KWK..KWK', 'GGK..KGG', 'KKK..KKK']
const LEGS = {
  idle: ['.KSKKSK.', '.KSKKSK.', '.KSKKSK.', '.KWKKWK.', 'KGGKKGGK', 'KKK..KKK'],
  a: LEGS_A,
  b: LEGS_A.map((r) => [...r].reverse().join(''))
}

const drawGrid = (g, grid, x, y) => {
  grid.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] !== '.') rect(g, x + c, y + r, 1, 1, PAL[row[c]])
  })
}

const drawRacket = (g, hx, hy, ang) => {
  const dx = Math.cos(ang)
  const dy = Math.sin(ang)
  for (let i = 0; i < 4; i++) rect(g, hx + dx * i, hy + dy * i, 1, 1, C.dark)
  const cx = hx + dx * 8.5
  const cy = hy + dy * 8.5
  for (let v = -5; v <= 5; v += 0.5) {
    for (let u = -6; u <= 6; u += 0.5) {
      const e = (u * u) / 25 + (v * v) / 12.25
      if (e > 1) continue
      const mesh = (Math.round(u) + Math.round(v)) % 2 === 0 ? C.line : '#9FB394'
      rect(g, cx + dx * u - dy * v, cy + dy * u + dx * v, 1, 1, e > 0.5 ? C.dark : mesh)
    }
  }
}

const drawLine2 = (g, x0, y0, x1, y1, col) => {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  for (let i = 0; i <= n; i++) rect(g, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 2, 2, col)
}

let spr = null
let sprCtx = null
const drawPerson = (gMain, a, facing, bobbing) => {
  const [px, py] = screen(a.x, a.y)
  // Drawn 1px-per-pixel into a buffer, then scaled: smaller towards the far baseline.
  const k = 2 * (0.82 + 0.18 * clamp(a.y, 0, 1))
  const g = sprCtx
  g.clearRect(0, 0, 64, 64)
  g.save()
  g.translate(32, 52)
  const sx = 0
  const sy = 0
  const front = facing === 'front'
  const run = a.moving && a.swing === 0
  const frame = run ? (Math.floor(game.t * 9) % 2 ? 'a' : 'b') : 'idle'
  const bob = (run && frame === 'a' ? -1 : 0) + (bobbing ? -Math.abs(Math.round(Math.sin(game.t * 14) * 3)) : 0)
  const fy = sy + (bobbing ? bob : 0)
  rect(g, sx - 6, sy - 1, 12, 2, 'rgba(0,0,0,0.28)')
  drawGrid(g, LEGS[frame], sx - 4, fy - 6)
  drawGrid(g, TORSO[facing], sx - 4, fy - 13 + (run ? bob : 0))
  drawGrid(g, HEAD[facing], sx - 5, fy - 23 + (run ? bob : 0))

  // arms + racket
  const ph = a.swing / SWING_TIME
  const m = (front ? -1 : 1) * (a.type === 'bh' ? -1 : 1)
  const top = fy - 12 + (run ? bob : 0)
  const shoulderX = sx + m * 4
  const cg = ph > 0 ? 0 : a.charge || 0
  const handX = sx + m * (6 + 3 * cg - 11 * Math.sin(Math.min(1, ph) * Math.PI * 0.5))
  const handY = top + 5 + 3 * cg - (ph > 0 ? 5 * Math.sin(Math.min(1, ph) * Math.PI) : 0)
  const th = ph > 0 ? -25 - 150 * Math.min(1, ph) : -50 + 55 * cg
  const ang = (m > 0 ? th : 180 - th) * (Math.PI / 180)
  drawLine2(g, sx - m * 5, top + 1, sx - m * 5, top + 6, C.dark)
  drawLine2(g, sx - m * 5 + 0.5, top + 1.5, sx - m * 5 + 0.5, top + 5.5, '#E3A672')
  drawLine2(g, shoulderX, top + 1, handX, handY, C.dark)
  drawLine2(g, shoulderX + 0.5, top + 1.5, handX + 0.5, handY + 0.5, '#E3A672')
  drawRacket(g, handX + 1, handY + 1, ang)
  g.restore()
  gMain.drawImage(spr, Math.round(px - 32 * k), Math.round(py - 52 * k), Math.round(64 * k), Math.round(64 * k))
}

// ---- state ----------------------------------------------------------------
let ctx = null
let raf = 0
let last = 0
let acc = 0
let audio = null

const sound = {
  init() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)()
  },
  play(freq, ms, type) {
    if (!audio) return
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.value = 0.04
    osc.connect(gain).connect(audio.destination)
    osc.start()
    osc.stop(audio.currentTime + ms / 1000)
  }
}
const game = createGame({
  ui: { phase, won, streak, bestStreak, serveHint, scoreP, scoreC, chargeUi, persistBest: (n) => localStorage.setItem(STREAK_KEY, String(n)) },
  sound
})
const { ball, pl, cpu, input } = game

// ---- drawing --------------------------------------------------------------
const drawBall = (g) => {
  const [sx, sy] = screen(ball.x, ball.y, ball.z)
  const [gx, gy] = screen(ball.x, ball.y, 0)
  rect(g, gx - 3, gy, 6, 2, 'rgba(0,0,0,0.35)')
  rect(g, sx - 2, sy - 2, 5, 5, C.dark)
  rect(g, sx - 1, sy - 1, 3, 3, C.yellow)
}

const drawNet = (g) => {
  const ny = wy(0.5)
  const hw = hwAt(0.5) * ALLEY + 5
  rect(g, CX - hw, ny - 10, hw * 2, 10, C.dark)
  for (let x = CX - hw + 1; x < CX + hw - 1; x += 2) {
    for (let y = ny - 8; y < ny - 1; y += 2) rect(g, x, y, 1, 1, S.net)
  }
  rect(g, CX - hw, ny - 10, hw * 2, 1, C.line)
  rect(g, CX - hw - 1, ny - 12, 2, 13, C.line)
  rect(g, CX + hw - 1, ny - 12, 2, 13, C.line)
}

const drawAim = (g) => {
  if (Math.floor(game.t * 5) % 2) return
  const [tx, ty] = game.serveAim()
  const [x, y] = screen(tx, ty)
  rect(g, x - 4, y - 1, 9, 2, C.yellow)
  rect(g, x - 1, y - 4, 2, 9, C.yellow)
}

// Referee's speech bubble (the score lives in the page header).
const drawHud = (g) => {
  if (game.msg && game.msg.text) {
    const w = textWidth(game.msg.text, 2) + 8
    const x = W - w - 4
    rect(g, x, 40, w, 16, C.line)
    rect(g, x + 1, 41, w - 2, 14, '#FFFFFF')
    rect(g, x + w - 12, 56, 4, 3, C.line)
    drawText(g, game.msg.text, x + 4, 44, 2, C.dark)
  }
}

// The court is short enough for both players to stay on screen; the camera only
// leans a little towards where the ball is.
const updateCamera = (dt) => {
  const focus = game.mode === 'rally' ? ball.y : pl.y
  const target = -53 + (clamp(focus, 0, 1) - 0.5) * 8
  camY += (target - camY) * Math.min(1, dt * 5)
}

const draw = () => {
  const g = ctx
  g.drawImage(bg, 0, Math.round(TOP - camY))
  const showBall = game.mode !== 'title'
  const ballFar = ball.y < 0.5
  drawPerson(g, cpu, 'front', game.mode === 'point' && game.pointWinner === 'c')
  if (showBall && ballFar) drawBall(g)
  drawNet(g)
  if (showBall && !ballFar) drawBall(g)
  if (game.mode === 'serve' && game.server === 'p') drawAim(g)
  drawPerson(g, pl, 'back', game.mode === 'point' && game.pointWinner === 'p')
  drawHud(g)
}

const loop = (now) => {
  const dt = Math.min(0.1, (now - last) / 1000 || 0)
  last = now
  acc += dt
  while (acc >= 1 / 120) {
    game.update(1 / 120)
    acc -= 1 / 120
  }
  if (r3d) {
    r3d.render(dt)
  } else {
    updateCamera(dt)
    draw()
  }
  raf = requestAnimationFrame(loop)
}

let padAnchor = [0, 0]
const PAD_PX = 40
const resetPad = () => {
  input.padX = input.padY = 0
  padKnob.value = { x: 0, y: 0 }
}
const onPadDown = (e) => {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    // not an active pointer (synthetic event): the pad still works without capture
  }
  padAnchor = [e.clientX, e.clientY]
  game.beginCharge()
}
const onPadMove = (e) => {
  if (!game.charging) return
  input.padX = clamp((e.clientX - padAnchor[0]) / PAD_PX, -1, 1)
  input.padY = clamp((e.clientY - padAnchor[1]) / PAD_PX, -1, 1)
  padKnob.value = { x: input.padX * 26, y: input.padY * 26 }
}
const onPadUp = () => {
  game.releaseCharge()
  resetPad()
}

const stickEl = ref(null)
let stickId = null
const moveStick = (e) => {
  const r = stickEl.value.getBoundingClientRect()
  const radius = r.width / 2
  let dx = e.clientX - (r.left + radius)
  let dy = e.clientY - (r.top + radius)
  const len = Math.hypot(dx, dy)
  const max = radius * 0.75
  if (len > max) {
    dx = (dx / len) * max
    dy = (dy / len) * max
  }
  input.x = clamp(dx / max, -1, 1)
  input.y = clamp(dy / max, -1, 1)
  knob.value = { x: dx, y: dy }
}
const onStickDown = (e) => {
  stickId = e.pointerId
  stickEl.value.setPointerCapture(e.pointerId)
  moveStick(e)
}
const onStickMove = (e) => {
  if (e.pointerId === stickId) moveStick(e)
}
const onStickUp = (e) => {
  if (e.pointerId !== stickId) return
  stickId = null
  input.x = input.y = 0
  knob.value = { x: 0, y: 0 }
}

const onKey = (e) => {
  const down = e.type === 'keydown'
  const set = (v, key, cur) => (down ? v : cur === v ? 0 : cur)
  if (e.key === 'ArrowLeft') input.keyX = set(-1, e.key, input.keyX)
  else if (e.key === 'ArrowRight') input.keyX = set(1, e.key, input.keyX)
  else if (e.key === 'ArrowUp') input.keyY = set(-1, e.key, input.keyY)
  else if (e.key === 'ArrowDown') input.keyY = set(1, e.key, input.keyY)
  else if (e.key === ' ' || e.key === 'z') {
    if (down && !e.repeat) game.beginCharge()
    else if (!down) game.releaseCharge()
  } else if (down && !e.repeat && e.key === 'Enter') game.swing()
}

onMounted(() => {
  ctx = canvas.value.getContext('2d')
  ctx.imageSmoothingEnabled = false
  spr = document.createElement('canvas')
  spr.width = 64
  spr.height = 64
  sprCtx = spr.getContext('2d')
  buildBackground()
  pl.x = 0.5
  cpu.x = -0.5
  pl.y = 1.0
  camY = -53
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)
  if (use3d) {
    // loaded on demand so the 2D game does not carry Three.js
    import('../game/render3d.js').then(({ createRenderer3D }) => {
      r3d = createRenderer3D({ container: stage.value, game, aspect: W / H, onTap: () => game.swing() })
    })
  }
  raf = requestAnimationFrame(loop)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  r3d?.dispose()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKey)
  audio?.close()
})
</script>

<template>
  <div
    class="bg-navy-ink select-none"
    :class="use3d ? 'relative h-[100dvh] max-w-[480px] mx-auto overflow-hidden' : 'min-h-[100dvh] flex flex-col items-center px-4 py-3'"
  >
    <div
      class="flex items-center justify-between text-cream"
      :class="use3d ? 'absolute top-0 inset-x-0 z-10 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] [text-shadow:0_2px_6px_rgba(0,0,0,0.55)]' : 'w-full max-w-[420px]'"
    >
      <button
        v-if="phase !== 'playing'"
        type="button"
        class="min-h-8 min-w-12 rounded border-2 border-cream/50 px-2 font-['Bebas_Neue'] text-xl leading-none tracking-wide text-cream/90 hover:text-white"
        @click="switchMode"
      >
        {{ use3d ? '2D' : '3D' }}
      </button>
      <span v-else class="min-w-12" />
      <div class="font-['Bebas_Neue'] text-2xl leading-none tracking-wide text-cream">
        COM <span class="text-ball-yellow">{{ scoreC }}</span>
        <span class="ml-3">YOU <span class="text-ball-yellow">{{ scoreP }}</span></span>
      </div>
      <div class="font-['Bebas_Neue'] text-xl leading-none tracking-wide text-cream/70">
        {{ tr('streak') }} <span class="text-ball-yellow text-3xl">{{ streak }}</span>
        <span class="ml-2">{{ tr('best') }} {{ bestStreak }}</span>
      </div>
    </div>

    <div
      ref="stage"
      :class="use3d ? 'absolute inset-0' : 'relative'"
      :style="use3d ? null : 'width: min(100%, calc((100dvh - 4.5rem - 8.5rem) * 144 / 240), 420px)'"
    >
      <canvas
        v-show="!use3d"
        ref="canvas"
        :width="W"
        :height="H"
        class="w-full h-auto block rounded border-2 border-cream/80"
        style="image-rendering: pixelated; touch-action: none"
        @pointerdown="game.swing()"
      />
      <div
        v-if="phase !== 'playing'"
        class="absolute inset-0 flex flex-col items-center gap-2 pointer-events-none text-center text-cream bg-navy-ink/60 rounded"
        :class="use3d ? 'justify-start pt-[24%]' : 'justify-center'"
      >
        <p class="font-['Bebas_Neue'] text-5xl text-ball-yellow">
          {{ phase === 'over' ? (won ? tr('win') : tr('lose')) : tr('title') }}
        </p>
        <p class="text-caption font-bold animate-pulse">
          {{ phase === 'over' ? tr('retry') : tr('tapToStart') }}
        </p>
        <p v-if="phase === 'title'" class="text-caption text-cream/70 max-w-[14rem]">{{ tr('howTo2') }}</p>
      </div>
      <p
        v-if="serveHint && phase === 'playing'"
        class="absolute inset-x-0 text-center text-caption font-bold text-ball-yellow animate-pulse pointer-events-none"
        :class="use3d ? 'bottom-[30%] [text-shadow:0_2px_6px_rgba(0,0,0,0.6)]' : 'bottom-2'"
      >
        {{ tr('serveHint2') }}
      </p>
    </div>

    <div
      class="flex items-center justify-between"
      :class="use3d ? 'absolute bottom-0 inset-x-0 z-10 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]' : 'w-full max-w-[420px] mt-3 px-2'"
      style="touch-action: none"
    >
      <div
        ref="stickEl"
        class="relative h-28 w-28 rounded-full bg-cream/10 border-2 border-cream/40"
        @pointerdown="onStickDown"
        @pointermove="onStickMove"
        @pointerup="onStickUp"
        @pointercancel="onStickUp"
      >
        <div
          class="absolute left-1/2 top-1/2 h-12 w-12 -ml-6 -mt-6 rounded-full bg-cream/70 pointer-events-none"
          :style="{ transform: `translate(${knob.x}px, ${knob.y}px)` }"
        />
      </div>
      <div class="relative flex items-center gap-2">
        <div class="h-24 w-2 rounded bg-cream/20 overflow-hidden flex items-end" aria-hidden="true">
          <div
            class="w-full"
            :class="chargeUi > 0.8 ? 'bg-danger' : 'bg-ball-yellow'"
            :style="{ height: chargeUi * 100 + '%' }"
          />
        </div>
        <div
          class="relative h-28 w-28 rounded-full bg-cream/10 border-2 border-cream/40"
          style="touch-action: none"
          @pointerdown.prevent="onPadDown"
          @pointermove="onPadMove"
          @pointerup="onPadUp"
          @pointercancel="onPadUp"
        >
          <span class="absolute left-1/2 top-1 -translate-x-1/2 text-cream/60 text-[10px] font-bold pointer-events-none">{{ tr('lob') }}</span>
          <span class="absolute left-1/2 bottom-1 -translate-x-1/2 text-cream/60 text-[10px] font-bold pointer-events-none">{{ tr('drop') }}</span>
          <div
            class="absolute left-1/2 top-1/2 h-16 w-16 -ml-8 -mt-8 rounded-full bg-ball-yellow text-court-navy flex items-center justify-center font-['Bebas_Neue'] text-2xl pointer-events-none"
            :style="{
              transform: `translate(${padKnob.x}px, ${padKnob.y + chargeUi * 8}px) scale(${1 - chargeUi * 0.15})`,
              boxShadow: `0 ${5 - chargeUi * 4}px 0 #B88B00`
            }"
            :aria-label="tr('swing')"
          >
            {{ tr('swing') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
