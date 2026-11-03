<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
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
const G = 1.0
const NET_H = 0.055
const REACH_X = 0.42
const REACH_Y = 0.14
const SWING_TIME = 0.34
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
  const frame = run ? (Math.floor(t * 9) % 2 ? 'a' : 'b') : 'idle'
  const bob = (run && frame === 'a' ? -1 : 0) + (bobbing ? -Math.abs(Math.round(Math.sin(t * 14) * 3)) : 0)
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
let t = 0
let inputX = 0
let inputY = 0
let keyX = 0
let keyY = 0
let padX = 0 // right pad, live
let padY = 0

const ball = { tx: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lastHitter: 'p', bounced: false, bounces: 0, serve: false, sSide: 1, netDone: true, inHand: true }
const mk = (y) => ({ x: 0, y, charge: 0, power: 0.3, aimX: 0, aimY: 0, swing: 0, hit: false, type: 'fh', moving: false, queued: false, react: 0 })
const pl = mk(1.0)
const cpu = mk(0.0)
let mode = 'title' // title | serve | rally | point | over
let server = 'c' // flipped at start: the player serves first
let side = 1
let faults = 0
let timer = 0
let msg = null
let pts = { p: 0, c: 0 }
let rally = 0
let gameEnded = false
let pointWinner = null

const rand = (a, b) => a + Math.random() * (b - a)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

const beep = (freq, ms, type = 'square') => {
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
const syncScore = () => {
  scoreP.value = label(pts.p, pts.c)
  scoreC.value = label(pts.c, pts.p)
}
const say = (text) => {
  msg = { text, t: 1.4 }
}
const label = (a, b) => {
  if (a >= 4 && a - b >= 2) return 'WIN'
  if (a >= 3 && b >= 3) return a === b ? '40' : a > b ? 'AD' : '40'
  return ['0', '15', '30', '40'][Math.min(a, 3)]
}

const strike = (who, tx, ty, T, quality = 1, isServe = false) => {
  const z0 = Math.max(ball.z, 0.05)
  ball.z = z0
  ball.lastHitter = who
  ball.bounced = false
  ball.bounces = 0
  ball.netDone = false
  ball.inHand = false
  ball.serve = isServe
  ball.tx = tx
  ball.vx = (tx - ball.x) / T
  ball.vy = (ty - ball.y) / T
  ball.vz = (((G * T * T) / 2 - z0) / T) * rand(0.94, 1.06) * (1 - (1 - quality) * 0.22)
  if (who === 'p') cpu.react = rand(0.12, 0.28)
  beep(who === 'p' ? 520 : 440, 45)
}
const rallyTime = () => clamp(1.15 - 0.015 * rally, 0.85, 1.15)

// Serve aim for the player: left/right of the stick inside the diagonal box.
const liveAim = () => [clamp(padX + 0.5 * (inputX + keyX), -1, 1), clamp(padY, -1, 1)]
const serveAim = () => {
  const dir = pl.x >= 0 ? -1 : 1
  const swinging = pl.swing > 0 || pl.queued
  const [sx, sy] = swinging ? [pl.aimX, pl.aimY] : liveAim()
  return [dir * (0.1 + 0.85 * (0.5 + 0.5 * sx * dir)), 0.37 + sy * 0.12]
}

const doServe = (who) => {
  const s = who === 'p' ? pl : cpu
  const sgn = s.x >= 0 ? 1 : -1
  ball.x = s.x
  ball.y = s.y
  ball.z = 0.16
  ball.sSide = sgn
  rally = 0
  mode = 'rally'
  serveHint.value = false
  if (who === 'p') {
    const [ax, ay] = serveAim()
    const pw = pl.power
    const wild = Math.max(0, pw - 0.55) * 0.3
    strike(who, ax + rand(-1, 1) * (0.06 + wild), ay + rand(-1, 1) * (0.04 + wild * 0.5), 1.2 * (1 - 0.22 * ((pw - 0.3) / 0.7)), 1, true)
  } else {
    const mag = 0.15 + rand(0, 0.75) + rand(-0.12, 0.12)
    strike(who, -sgn * mag, 0.5 + rand(0.08, 0.26), 1.2, 1, true)
  }
}

const startSwing = (a, type, power = 0.3, aim = [0, 0]) => {
  if (a.swing > 0) return false
  a.swing = 0.0001
  a.hit = false
  a.type = type
  a.power = power
  a.aimX = aim[0]
  a.aimY = aim[1]
  return true
}

const startPoint = () => {
  mode = 'serve'
  side = (pts.p + pts.c) % 2 === 0 ? 1 : -1
  faults = 0
  resetServe()
}
const resetServe = () => {
  const s = server === 'p' ? pl : cpu
  const r = server === 'p' ? cpu : pl
  s.x = side * 0.5
  s.y = server === 'p' ? 1.0 : 0.0
  r.x = -side * 0.5
  r.y = server === 'p' ? 0.04 : 0.96
  s.swing = 0
  s.queued = false
  ball.inHand = true
  ball.serve = false
  timer = 1.0
  serveHint.value = server === 'p'
  pointWinner = null
}

const finishMatch = () => {
  mode = 'over'
  phase.value = 'over'
  won.value = pts.p > pts.c
  streak.value = won.value ? streak.value + 1 : 0
  if (streak.value > bestStreak.value) {
    bestStreak.value = streak.value
    localStorage.setItem(STREAK_KEY, String(bestStreak.value))
  }
  beep(won.value ? 880 : 140, 400)
}
const endPoint = (winner, text) => {
  if (mode !== 'rally') return
  mode = 'point'
  timer = 1.6
  pts[winner]++
  syncScore()
  pointWinner = winner
  say(text)
  ball.vx = 0
  ball.vy = 0
  gameEnded = (pts.p >= 4 || pts.c >= 4) && Math.abs(pts.p - pts.c) >= 2
  beep(winner === 'p' ? 784 : 196, 160)
}
const fault = (text) => {
  faults++
  if (faults >= 2) endPoint(server === 'p' ? 'c' : 'p', 'DBL FAULT')
  else {
    say(text)
    mode = 'serve'
    resetServe()
    beep(150, 150)
  }
}
const start = () => {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)()
  pts = { p: 0, c: 0 }
  syncScore()
  server = server === 'p' ? 'c' : 'p'
  gameEnded = false
  phase.value = 'playing'
  startPoint()
}

// ---- simulation -----------------------------------------------------------
const stepBall = (dt) => {
  const prevY = ball.y
  ball.vz -= G * dt
  ball.x += ball.vx * dt
  ball.y += ball.vy * dt
  ball.z += ball.vz * dt

  if (!ball.netDone && (prevY - 0.5) * (ball.y - 0.5) < 0) {
    ball.netDone = true
    if (ball.z < NET_H) {
      ball.vx = 0
      ball.vy = 0
      if (ball.serve && !ball.bounced) fault('NET!')
      else endPoint(ball.lastHitter === 'p' ? 'c' : 'p', 'NET!')
      return
    }
  }

  if (ball.z <= 0 && ball.vz < 0) {
    ball.z = 0
    ball.bounces++
    beep(190, 30, 'triangle')
    if (!ball.bounced) {
      const hitter = ball.lastHitter
      let ok
      if (ball.serve) {
        const inX = Math.abs(ball.x) <= 1.02 && ball.x * ball.sSide <= 0.02
        const inY = hitter === 'p' ? ball.y >= 0.23 && ball.y <= 0.5 : ball.y >= 0.5 && ball.y <= 0.77
        ok = inX && inY
      } else {
        const inX = Math.abs(ball.x) <= 1.03
        const inY = hitter === 'p' ? ball.y >= -0.02 && ball.y <= 0.5 : ball.y >= 0.5 && ball.y <= 1.02
        ok = inX && inY
      }
      if (!ok) {
        ball.vx = ball.vy = 0
        if (ball.serve) fault('FAULT!')
        else endPoint(hitter === 'p' ? 'c' : 'p', 'OUT!')
        return
      }
      if (ball.serve) say('IN!')
      ball.bounced = true
    } else if (ball.bounces >= 2) {
      endPoint(ball.lastHitter, '')
      return
    }
    ball.vz = -ball.vz * 0.62
    ball.vx *= 0.8
    ball.vy *= 0.8
  }
  if (ball.y < -0.45 || ball.y > 1.45 || Math.abs(ball.x) > 2.3) endPoint(ball.lastHitter, '')
}

// Both players hit through the same rule. The reach follows the racket (the side of the
// swing) as well as the body, so the racket connects where it visibly is. Timing also
// matters: hitting the ball early (before it reaches your height) gives a harder, more
// angled and deeper shot, but a riskier one; hitting it late gives a soft, short, safer one.
const RACKET_OFF = 0.4
const tryHit = (a, who) => {
  const ph = a.swing / SWING_TIME
  if (a.hit || ph < 0.2 || ph > 0.85) return
  const incoming = who === 'p' ? ball.lastHitter === 'c' : ball.lastHitter === 'p'
  if (!incoming || !ball.bounced || ball.bounces !== 1 || ball.z > 0.36) return
  const dy = ball.y - a.y
  const side = (who === 'c' ? -1 : 1) * (a.type === 'bh' ? -1 : 1)
  const dBody = Math.hypot((ball.x - a.x) / REACH_X, dy / REACH_Y) * 1.15
  const dRacket = Math.hypot((ball.x - (a.x + side * RACKET_OFF)) / REACH_X, dy / REACH_Y)
  const d = Math.min(dBody, dRacket)
  if (d >= 1) return
  const q = 1 - d
  // e > 0: early (ball still ahead of the player), e < 0: late (already level or past)
  const lead = who === 'p' ? -dy : dy
  const e = clamp(lead / REACH_Y, -1, 1)
  const early = Math.max(e, 0)
  const late = Math.max(-e, 0)
  a.hit = true
  rally++
  const pw = who === 'p' ? a.power : 0.3
  const boost = (pw - 0.3) / 0.7 // 0 = plain tap, 1 = fully charged
  const sloppy = (1 - q) * 0.3 + early * 0.1 + Math.max(0, pw - 0.55) * 0.35 * (1.2 - q)
  let tx
  let ty
  let T = rallyTime() * (1 + (1 - q) * 0.12) * (1 - 0.22 * early + 0.25 * late) * (1 - 0.3 * boost)
  let shot = 'normal'
  if (who === 'p') {
    const stick = a.aimX
    if (a.aimY < -0.4) shot = 'lob'
    else if (a.aimY > 0.4) shot = 'drop'
    tx = clamp(stick * 0.9 * (1 + 0.45 * early - 0.35 * late + 0.2 * boost) + ((ball.x - a.x) / REACH_X) * 0.1, -1, 1)
    tx += rand(-1, 1) * (0.02 + sloppy + 0.002 * rally)
    ty = 0.06 + (1 - q) * 0.2 + rand(0, 0.06) - early * 0.04 + late * 0.12 - boost * 0.05
    if (shot === 'lob') {
      // high and slow, deep: buys time
      ty = 0.04 + rand(0, 0.06) + (1 - q) * 0.1
      T = 1.65
    } else if (shot === 'drop') {
      // soft and short, just over the net
      tx *= 0.6
      ty = 0.37 + rand(0, 0.05) + (1 - q) * 0.08
      T = 1.15
    }
  } else {
    const away = pl.x > 0 ? -1 : 1
    tx = (Math.random() < 0.8 ? away * rand(0.35, 0.92) : rand(-0.9, 0.9)) + rand(-1, 1) * (0.06 + sloppy + 0.01 * rally)
    ty = rand(0.78, 0.92) + rand(-1, 1) * sloppy * 0.5
  }
  strike(who, tx, Math.max(ty, who === 'p' ? 0.0 : ty), T, q)
  if (who === 'p' && shot === 'lob' && q > 0.5) say('LOB!')
  else if (who === 'p' && shot === 'drop' && q > 0.5) say('DROP!')
  else if (who === 'p' && boost > 0.8 && q > 0.65) say('POW!')
  else if (who === 'p' && q > 0.8 && early > 0.4) say('NICE!')
}

const update = (dt) => {
  t += dt
  if (msg) {
    msg.t -= dt
    if (msg.t <= 0) msg = null
  }
  for (const a of [pl, cpu]) {
    if (a.swing > 0) {
      a.swing += dt
      if (a.swing >= SWING_TIME) {
        a.swing = 0
        a.hit = false
      }
    }
  }

  // spring button: the charge follows the pull (or the time held)
  if (charging && (phase.value !== 'playing' || (mode !== 'serve' && mode !== 'rally'))) charging = false
  pl.charge = charging ? chargeValue() : 0
  chargeUi.value = pl.charge

  // player: free movement
  const mx = clamp(inputX + keyX, -1, 1)
  const my = clamp(inputY + keyY, -1, 1)
  const canMove = mode !== 'point' || true
  pl.moving = canMove && (Math.abs(mx) > 0.08 || Math.abs(my) > 0.08) && mode !== 'title'
  if (pl.moving && mode !== 'over') {
    const yMin = mode === 'serve' && server === 'p' ? 1.0 : 0.56
    const yMax = mode === 'serve' && server === 'p' ? 1.0 : 1.12
    pl.x = clamp(pl.x + mx * 1.5 * dt, -1.1, 1.1)
    pl.y = clamp(pl.y + my * 0.45 * dt, yMin, yMax)
  }

  if (mode === 'serve') {
    const s = server === 'p' ? pl : cpu
    cpu.moving = false
    ball.x = s.x + 0.03
    ball.y = s.y
    ball.z = s.swing > 0 ? 0.1 + 0.25 * Math.min(1, s.swing / (SWING_TIME * 0.45)) : 0.1
    if (server === 'c') {
      timer -= dt
      if (timer <= 0 && s.swing === 0 && !s.queued) {
        s.queued = true
        startSwing(s, 'fh')
      }
    }
    if (s.queued && s.swing / SWING_TIME >= 0.45) {
      s.queued = false
      doServe(server)
    }
    return
  }

  if (mode === 'point') {
    timer -= dt
    if (timer <= 0) {
      if (gameEnded) finishMatch()
      else startPoint()
    }
    return
  }
  if (mode !== 'rally') return

  stepBall(dt)
  if (mode !== 'rally') return

  tryHit(pl, 'p')

  // cpu: reacts after a delay, then chases the ball and swings when it is close
  if (ball.lastHitter === 'p') {
    cpu.react -= dt
    if (cpu.react <= 0) {
      const goal = ball.bounced ? ball.x : ball.x + ball.vx * 0.2
      const dx = goal - cpu.x
      cpu.moving = Math.abs(dx) > 0.03 && cpu.swing === 0
      cpu.x += clamp(dx, -1.05 * dt, 1.05 * dt)
      const gy = ball.bounced ? clamp(ball.y, -0.12, 0.44) : 0.02
      cpu.y += clamp(gy - cpu.y, -0.4 * dt, 0.4 * dt)
    }
    if (ball.bounced && ball.vy < 0 && cpu.swing === 0 && Math.abs(ball.y - cpu.y) < 0.14 && Math.abs(ball.x - cpu.x) < 0.55) {
      startSwing(cpu, ball.x < cpu.x ? 'bh' : 'fh')
    }
  } else {
    cpu.moving = false
    cpu.x += clamp(0 - cpu.x, -0.4 * dt, 0.4 * dt)
    cpu.y += clamp(0.0 - cpu.y, -0.2 * dt, 0.2 * dt)
  }
  tryHit(cpu, 'c')
}

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
  if (Math.floor(t * 5) % 2) return
  const [tx, ty] = serveAim()
  const [x, y] = screen(tx, ty)
  rect(g, x - 4, y - 1, 9, 2, C.yellow)
  rect(g, x - 1, y - 4, 2, 9, C.yellow)
}

// Referee's speech bubble (the score lives in the page header).
const drawHud = (g) => {
  if (msg && msg.text) {
    const w = textWidth(msg.text, 2) + 8
    const x = W - w - 4
    rect(g, x, 40, w, 16, C.line)
    rect(g, x + 1, 41, w - 2, 14, '#FFFFFF')
    rect(g, x + w - 12, 56, 4, 3, C.line)
    drawText(g, msg.text, x + 4, 44, 2, C.dark)
  }
}

// The court is short enough for both players to stay on screen; the camera only
// leans a little towards where the ball is.
const updateCamera = (dt) => {
  const focus = mode === 'rally' ? ball.y : pl.y
  const target = -53 + (clamp(focus, 0, 1) - 0.5) * 8
  camY += (target - camY) * Math.min(1, dt * 5)
}

const draw = () => {
  const g = ctx
  g.drawImage(bg, 0, Math.round(TOP - camY))
  const showBall = mode !== 'title'
  const ballFar = ball.y < 0.5
  drawPerson(g, cpu, 'front', mode === 'point' && pointWinner === 'c')
  if (showBall && ballFar) drawBall(g)
  drawNet(g)
  if (showBall && !ballFar) drawBall(g)
  if (mode === 'serve' && server === 'p') drawAim(g)
  drawPerson(g, pl, 'back', mode === 'point' && pointWinner === 'p')
  drawHud(g)
}

const loop = (now) => {
  const dt = Math.min(0.1, (now - last) / 1000 || 0)
  last = now
  acc += dt
  while (acc >= 1 / 120) {
    update(1 / 120)
    acc -= 1 / 120
  }
  updateCamera(dt)
  draw()
  raf = requestAnimationFrame(loop)
}

// ---- input ----------------------------------------------------------------
const swing = (power = 0.3) => {
  if (phase.value !== 'playing') return start()
  if (mode === 'serve' && server === 'p') {
    if (pl.swing === 0 && !pl.queued) {
      pl.queued = true
      startSwing(pl, 'fh', power, liveAim())
    }
  } else if (mode === 'rally') {
    startSwing(pl, ball.x < pl.x - 0.05 ? 'bh' : 'fh', power, liveAim())
  }
}

// Spring button: pull it down (or hold it) to charge, release to swing. A quick tap is a plain shot.
let charging = false
let chargeT0 = 0
let padAnchor = [0, 0]
const PAD_PX = 40
const chargeValue = () => clamp((performance.now() - chargeT0) / 900, 0, 1)
const beginCharge = () => {
  if (phase.value !== 'playing') return start()
  if (mode !== 'serve' && mode !== 'rally') return
  charging = true
  chargeT0 = performance.now()
}
const releaseCharge = () => {
  if (!charging) return
  const power = clamp(0.3 + chargeValue() * 0.7, 0.3, 1)
  charging = false
  pl.charge = 0
  swing(power) // reads the pad while it is still held
}
const resetPad = () => {
  padX = padY = 0
  padKnob.value = { x: 0, y: 0 }
}
const onPadDown = (e) => {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    // not an active pointer (synthetic event): the pad still works without capture
  }
  padAnchor = [e.clientX, e.clientY]
  beginCharge()
}
const onPadMove = (e) => {
  if (!charging) return
  padX = clamp((e.clientX - padAnchor[0]) / PAD_PX, -1, 1)
  padY = clamp((e.clientY - padAnchor[1]) / PAD_PX, -1, 1)
  padKnob.value = { x: padX * 26, y: padY * 26 }
}
const onPadUp = () => {
  releaseCharge()
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
  inputX = clamp(dx / max, -1, 1)
  inputY = clamp(dy / max, -1, 1)
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
  inputX = inputY = 0
  knob.value = { x: 0, y: 0 }
}

const onKey = (e) => {
  const down = e.type === 'keydown'
  const set = (v, key, cur) => (down ? v : cur === v ? 0 : cur)
  if (e.key === 'ArrowLeft') keyX = set(-1, e.key, keyX)
  else if (e.key === 'ArrowRight') keyX = set(1, e.key, keyX)
  else if (e.key === 'ArrowUp') keyY = set(-1, e.key, keyY)
  else if (e.key === 'ArrowDown') keyY = set(1, e.key, keyY)
  else if (e.key === ' ' || e.key === 'z') {
    if (down && !e.repeat) beginCharge()
    else if (!down) releaseCharge()
  } else if (down && !e.repeat && e.key === 'Enter') swing()
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
  raf = requestAnimationFrame(loop)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKey)
  audio?.close()
})
</script>

<template>
  <div class="min-h-[100dvh] bg-navy-ink flex flex-col items-center px-4 py-3 select-none">
    <div class="w-full max-w-[420px] flex items-center justify-between text-cream">
      <span />
      <div class="font-['Bebas_Neue'] text-2xl leading-none tracking-wide text-cream">
        COM <span class="text-ball-yellow">{{ scoreC }}</span>
        <span class="ml-3">YOU <span class="text-ball-yellow">{{ scoreP }}</span></span>
      </div>
      <div class="font-['Bebas_Neue'] text-xl leading-none tracking-wide text-cream/70">
        {{ tr('streak') }} <span class="text-ball-yellow text-3xl">{{ streak }}</span>
        <span class="ml-2">{{ tr('best') }} {{ bestStreak }}</span>
      </div>
    </div>

    <div class="relative" style="width: min(100%, calc((100dvh - 4.5rem - 8.5rem) * 144 / 240), 420px)">
      <canvas
        ref="canvas"
        :width="W"
        :height="H"
        class="w-full h-auto block rounded border-2 border-cream/80"
        style="image-rendering: pixelated; touch-action: none"
        @pointerdown="swing()"
      />
      <div
        v-if="phase !== 'playing'"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none text-center text-cream bg-navy-ink/60 rounded"
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
        class="absolute bottom-2 inset-x-0 text-center text-caption font-bold text-ball-yellow animate-pulse pointer-events-none"
      >
        {{ tr('serveHint2') }}
      </p>
    </div>

    <div class="w-full max-w-[420px] mt-3 flex items-center justify-between px-2" style="touch-action: none">
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
