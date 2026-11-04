// Tennis simulation: rules, physics, scoring and the CPU. No DOM, canvas or Vue in here:
// a renderer (canvas today, Three.js next) reads this state every frame and the UI layer
// feeds the input in. Coordinates: x in [-1, 1] across the singles court, y in [0, 1] from
// the far baseline (CPU) to the near one (player), z is height.
export const G = 1.0
export const NET_H = 0.055
export const REACH_X = 0.42
export const REACH_Y = 0.14
export const SWING_TIME = 0.34

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

// ui: ref-like objects ({ value }) the page shows: phase, won, streak, bestStreak,
//     serveHint, scoreP, scoreC, chargeUi; plus an optional persistBest(n).
// sound: optional { init(), play(freq, ms, type) }.
export const createGame = ({ ui, sound = {} }) => {
  const { phase, won, streak, bestStreak, serveHint, scoreP, scoreC, chargeUi } = ui
  // Live input, written by the UI layer: left stick (x, y), arrow keys, right pad.
  const input = { x: 0, y: 0, keyX: 0, keyY: 0, padX: 0, padY: 0 }

  let t = 0

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
  const beep = (freq, ms, type = 'square') => sound.play?.(freq, ms, type)
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
  const liveAim = () => [clamp(input.padX + 0.5 * (input.x + input.keyX), -1, 1), clamp(input.padY, -1, 1)]
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
      ui.persistBest?.(bestStreak.value)
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
    sound.init?.()
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
    if (!incoming || ball.z > 0.36) return
    // Volley: the player may hit the ball before it bounces once it has crossed the net
    // (never a serve, which must bounce). Otherwise the ball must have bounced exactly once.
    const volley = who === 'p' && ball.netDone && !ball.serve && !ball.bounced
    if (!volley && (!ball.bounced || ball.bounces !== 1)) return
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
      // Lob / drop only when the drag is clearly vertical (within ~35° of the vertical axis):
      // a thumb pushed fully sideways always drifts a bit up or down and must stay a normal shot.
      const vertical = Math.abs(a.aimY) > 0.4 && Math.abs(a.aimY) > 1.5 * Math.abs(a.aimX)
      if (vertical) shot = a.aimY < 0 ? 'lob' : 'drop'
      tx = clamp(stick * 0.9 * (1 + 0.45 * early - 0.35 * late + 0.2 * boost) + ((ball.x - a.x) / REACH_X) * 0.1, -1, 1)
      tx += rand(-1, 1) * (0.02 + sloppy + 0.002 * rally)
      ty = 0.06 + (1 - q) * 0.2 + rand(0, 0.06) - early * 0.04 + late * 0.12 - boost * 0.05
      if (volley && shot === 'normal') T *= 0.85 // a volley is punchier: the opponent has less time
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
    const mx = clamp(input.x + input.keyX, -1, 1)
    const my = clamp(input.y + input.keyY, -1, 1)
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

  return {
    ball,
    pl,
    cpu,
    input,
    update,
    start,
    swing,
    beginCharge,
    releaseCharge,
    serveAim,
    get t() { return t },
    get mode() { return mode },
    get server() { return server },
    get pointWinner() { return pointWinner },
    get msg() { return msg },
    get charging() { return charging }
  }
}
