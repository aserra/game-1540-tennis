// Three.js renderer for the tennis simulation (src/game/core.js). Low-poly, everything built
// from primitives: court, net, stands and procedurally animated characters. It only reads
// the game state; the rules and the physics stay in the core.
import * as THREE from 'three'
import { SWING_TIME } from './core.js'

// Sim units -> metres. The net is 0.055 high in the sim and 0.914 m in real life, so one unit
// of sim height is ~16.6 m; court length and singles width are the real ones.
const HALF_W = 4.115 // x = ±1 (singles sideline)
const HALF_L = 11.885 // y = 0 / 1 (baselines)
const ALLEY = 1.25 // doubles sideline, in singles half-widths
const ZM = 16.6
const BALL_R = 0.18 // bigger than real so it reads from far away
const PERSON_SCALE = 1.25
const HIP_Y = 0.92
const toX = (x) => x * HALF_W
const toZ = (y) => (y - 0.5) * 2 * HALF_L
const toY = (z) => z * ZM

const lerp = (a, b, k) => a + (b - a) * k
const clamp01 = (v) => Math.min(1, Math.max(0, v))
const ease = (k) => k * k * (3 - 2 * k)

const PAL = {
  clay: '#C8683A',
  around: '#2F6B3A',
  line: '#FCF9EF',
  navy: '#00326A',
  yellow: '#FBC101',
  sky: '#8EC5FF'
}

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...opts })
const box = (w, h, d, material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

// ---- world ----------------------------------------------------------------
const buildCourt = (scene) => {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), mat(PAL.around))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const runW = HALF_W * ALLEY + 1.6
  const runL = HALF_L + 3
  const clay = new THREE.Mesh(new THREE.PlaneGeometry(runW * 2, runL * 2), mat(PAL.clay))
  clay.rotation.x = -Math.PI / 2
  clay.position.y = 0.005
  clay.receiveShadow = true
  scene.add(clay)

  const lineMat = new THREE.MeshBasicMaterial({ color: PAL.line })
  const line = (x0, z0, x1, z1, w = 0.07) => {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) > Math.abs(z1 - z0) ? len : w, 0.012, Math.abs(x1 - x0) > Math.abs(z1 - z0) ? w : len), lineMat)
    m.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2)
    scene.add(m)
  }
  const dw = HALF_W * ALLEY
  const sv = (0.5 - 0.25) * 2 * HALF_L // service line distance from the net
  line(-dw, -HALF_L, dw, -HALF_L, 0.1) // baselines
  line(-dw, HALF_L, dw, HALF_L, 0.1)
  line(-dw, -HALF_L, -dw, HALF_L) // doubles sidelines
  line(dw, -HALF_L, dw, HALF_L)
  line(-HALF_W, -HALF_L, -HALF_W, HALF_L) // singles sidelines
  line(HALF_W, -HALF_L, HALF_W, HALF_L)
  line(-HALF_W, -sv, HALF_W, -sv) // service lines
  line(-HALF_W, sv, HALF_W, sv)
  line(0, -sv, 0, sv) // centre service line
}

const buildNet = (scene) => {
  const w = HALF_W * ALLEY * 2 + 1.6
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const g = cv.getContext('2d')
  g.strokeStyle = 'rgba(30,30,30,0.9)'
  g.lineWidth = 3
  for (let i = 0; i <= 64; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke()
    g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(w / 0.5, 0.9 / 0.5)
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, 0.9),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, color: '#9AA0A6' })
  )
  mesh.position.set(0, 0.47, 0)
  scene.add(mesh)
  scene.add(box(w, 0.07, 0.04, new THREE.MeshStandardMaterial({ color: PAL.line }), 0, 0.93, 0))
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.07, 8), mat('#6B7280'))
    post.position.set(s * (w / 2), 0.535, 0)
    post.castShadow = true
    scene.add(post)
  }
}

const buildUmpire = (scene) => {
  const x = HALF_W * ALLEY + 1.7
  const wood = mat('#E8E2D0')
  for (const dx of [-0.3, 0.3]) for (const dz of [-0.3, 0.3]) scene.add(box(0.07, 2.2, 0.07, wood, x + dx, 1.1, dz))
  scene.add(box(0.85, 0.07, 0.85, wood, x, 2.2, 0))
  scene.add(box(0.85, 0.5, 0.06, wood, x, 2.5, 0.4))
  scene.add(box(0.4, 0.55, 0.28, mat('#2B2B2B'), x, 2.6, 0))
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), mat('#E3A672'))
  head.position.set(x, 3.05, 0)
  head.castShadow = true
  scene.add(head)
  scene.add(box(0.5, 0.05, 0.5, mat('#FCF9EF'), x, 3.22, 0))
}

const buildStands = (scene) => {
  const rows = 6
  const cols = 46
  const geo = new THREE.BoxGeometry(0.55, 0.8, 0.45)
  const crowd = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), rows * cols)
  const palette = ['#BFD7F2', PAL.line, PAL.yellow, '#7FA8DA', '#0B5CAB', '#C62828'].map((c) => new THREE.Color(c))
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const m = new THREE.Matrix4()
  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      m.makeTranslation((c - cols / 2) * 0.62, 1.4 + r * 0.9 + rnd() * 0.08, -HALF_L - 6.5 - r * 0.85)
      crowd.setMatrixAt(i, m)
      crowd.setColorAt(i, palette[Math.floor(rnd() * palette.length)])
      i++
    }
  }
  crowd.castShadow = true
  scene.add(crowd)
  // the terraces themselves
  for (let r = 0; r < rows; r++) scene.add(box(cols * 0.62 + 2, 0.9 * (r + 1) + 0.4, 0.9, mat('#1B4A86'), 0, (0.9 * (r + 1) + 0.4) / 2 - 0.3, -HALF_L - 6.8 - r * 0.85 - 0.1))
  // advertising boards along the far baseline
  const cv = document.createElement('canvas')
  cv.width = 1024
  cv.height = 80
  const g = cv.getContext('2d')
  g.fillStyle = PAL.navy
  g.fillRect(0, 0, 1024, 80)
  g.fillStyle = PAL.line
  g.font = 'bold 64px Impact, "Bebas Neue", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('NOLATOKEM   ·   NOLATOKEM   ·   NOLATOKEM', 512, 44)
  const board = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * ALLEY * 2 + 6, 0.9, 0.12), [mat(PAL.navy), mat(PAL.navy), mat(PAL.navy), mat(PAL.navy), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv) }), mat(PAL.navy)])
  board.position.set(0, 0.45, -HALF_L - 3.6)
  board.castShadow = true
  scene.add(board)
}

// ---- characters -----------------------------------------------------------
const makeRacket = () => {
  const racket = new THREE.Group()
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 6), mat('#1C1C1C'))
  handle.position.y = -0.17
  racket.add(handle)
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 5, 14), mat('#1C1C1C'))
  frame.scale.set(0.85, 1, 1)
  frame.position.y = -0.5
  frame.castShadow = true
  racket.add(frame)
  const strings = new THREE.Mesh(new THREE.CircleGeometry(0.16, 14), new THREE.MeshBasicMaterial({ color: '#FCF9EF', transparent: true, opacity: 0.35, side: THREE.DoubleSide }))
  strings.scale.set(0.85, 1, 1)
  strings.position.y = -0.5
  racket.add(strings)
  return racket
}

const makePerson = ({ shirt, shorts, skin, hair, cap }) => {
  const root = new THREE.Group()
  root.scale.setScalar(PERSON_SCALE)
  const skinM = mat(skin)
  const shirtM = mat(shirt)
  const shortsM = mat(shorts)

  const leg = (s) => {
    const hip = new THREE.Group()
    hip.position.set(s * 0.1, HIP_Y, 0)
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.9, 6), skinM)
    thigh.position.y = -0.45
    thigh.castShadow = true
    hip.add(thigh)
    hip.add(box(0.16, 0.1, 0.3, mat('#FCF9EF'), 0, -0.9, -0.04))
    root.add(hip)
    return hip
  }
  const hipL = leg(-1)
  const hipR = leg(1)

  const torso = new THREE.Group()
  torso.position.y = HIP_Y
  root.add(torso)
  const shortsMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.3, 6), shortsM)
  shortsMesh.position.y = -0.04
  shortsMesh.castShadow = true
  torso.add(shortsMesh)
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.56, 6), shirtM)
  chest.scale.z = 0.72
  chest.position.y = 0.4
  chest.castShadow = true
  torso.add(chest)
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 1), skinM)
  head.position.y = 0.9
  head.castShadow = true
  torso.add(head)
  // hair / cap (the character faces -Z; the camera sees the player from behind)
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.205, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(cap || hair))
  top.position.y = 0.92
  top.castShadow = true
  torso.add(top)
  if (cap) torso.add(box(0.2, 0.03, 0.14, mat(cap), 0, 0.96, -0.24))
  else {
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), mat(hair))
      const a = (i / 5) * Math.PI * 2
      spike.position.set(Math.cos(a) * 0.12, 1.13, Math.sin(a) * 0.12)
      torso.add(spike)
    }
  }
  for (const s of [-1, 1]) torso.add(box(0.04, 0.05, 0.03, mat('#1C1C1C'), s * 0.07, 0.93, -0.18))

  const makeArm = (s) => {
    const arm = new THREE.Group()
    arm.position.set(s * 0.26, 0.62, 0)
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.24, 6), shirtM)
    sleeve.position.y = -0.12
    sleeve.castShadow = true
    arm.add(sleeve)
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.32, 6), skinM)
    fore.position.y = -0.4
    fore.castShadow = true
    arm.add(fore)
    const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 0), skinM)
    hand.position.y = -0.58
    arm.add(hand)
    torso.add(arm)
    return arm
  }
  const armOff = makeArm(-1)
  const armR = makeArm(1)
  const racket = makeRacket()
  racket.position.y = -0.58
  armR.add(racket)

  return { root, torso, hipL, hipR, armOff, armR, shoulder: new THREE.Vector3(0.26, 0.62, 0) }
}

const qAim = new THREE.Quaternion()
const qPose = new THREE.Quaternion()
const eul = new THREE.Euler()
const down = new THREE.Vector3(0, -1, 0)
const tmp = new THREE.Vector3()

// Racket-arm pose for a swing phase: [forward angle, sideways angle] (+: forward / outwards).
const swingPose = (ph, c0) => {
  const ready = [0.35 - 1.3 * c0, 0.35 + 0.65 * c0]
  const back = [-1.0, 1.1]
  const through = [1.5, 0.1]
  const follow = [0.9, -0.9]
  if (ph <= 0) return ready
  if (ph < 0.35) {
    const k = ease(ph / 0.35)
    return [lerp(ready[0], back[0], k), lerp(ready[1], back[1], k)]
  }
  if (ph < 0.62) {
    const k = ease((ph - 0.35) / 0.27)
    return [lerp(back[0], through[0], k), lerp(back[1], through[1], k)]
  }
  const k = ease((ph - 0.62) / 0.38)
  return [lerp(through[0], follow[0], k), lerp(through[1], follow[1], k)]
}

const updatePerson = (p, a, who, game, ballW, dt) => {
  p.root.position.x = toX(a.x)
  p.root.position.z = toZ(a.y)
  const run = a.moving && a.swing === 0
  const celebrate = game.mode === 'point' && game.pointWinner === who
  const cyc = game.t * 12
  const k = Math.min(1, dt * 20)
  const legT = run ? Math.sin(cyc) * 0.75 : 0
  p.hipL.rotation.x = lerp(p.hipL.rotation.x, legT, k)
  p.hipR.rotation.x = lerp(p.hipR.rotation.x, -legT, k)
  p.root.position.y = celebrate ? Math.abs(Math.sin(game.t * 8)) * 0.4 : 0
  p.torso.position.y = HIP_Y + (run ? Math.abs(Math.sin(cyc)) * 0.07 : Math.sin(game.t * 2.2) * 0.012)
  p.torso.rotation.x = run ? -0.12 : 0

  const ph = a.swing > 0 ? a.swing / SWING_TIME : 0
  const s = a.type === 'bh' ? -1 : 1
  const c0 = who === 'p' ? clamp01(ph > 0 ? (a.power - 0.3) / 0.7 : a.charge || 0) : 0
  // shoulders turn away from the shot, then through it
  const twist = ph > 0 ? lerp(-0.6, 0.7, ease(clamp01(ph / 0.7))) : -0.25 * c0
  p.torso.rotation.y = s * twist
  p.armOff.rotation.x = ph > 0 ? 0.7 : run ? -legT * 0.6 : 0.15
  p.armOff.rotation.z = ph > 0 ? -0.5 : -0.12

  let [th, phi] = celebrate ? [2.7, 0.3] : swingPose(ph, c0)
  eul.set(th, 0, s * phi)
  qPose.setFromEuler(eul)
  p.armR.quaternion.copy(qPose)

  // while the swing can connect, the racket follows the ball so the contact looks right
  if (ph > 0.2 && ph < 0.85 && ballW) {
    p.torso.updateWorldMatrix(true, false)
    tmp.copy(ballW)
    p.torso.worldToLocal(tmp)
    tmp.sub(p.shoulder)
    const dist = tmp.length() * PERSON_SCALE
    const w = Math.sin(Math.PI * (ph - 0.2) / 0.65) ** 2 * clamp01((3.4 - dist) / 1.4)
    if (w > 0) {
      qAim.setFromUnitVectors(down, tmp.normalize())
      p.armR.quaternion.slerp(qAim, w)
    }
  }
}

// ---- renderer -------------------------------------------------------------
export const createRenderer3D = ({ container, game, onTap }) => {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const el = renderer.domElement
  el.style.cssText = 'display:block;width:100%;height:100%;touch-action:none'
  el.addEventListener('pointerdown', () => onTap?.())
  container.insertBefore(el, container.firstChild)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PAL.sky)
  scene.fog = new THREE.Fog(PAL.sky, 38, 95)
  scene.add(new THREE.HemisphereLight('#CFE6FF', '#3A5A3A', 1.15))
  const sun = new THREE.DirectionalLight('#FFF4E0', 2.2)
  sun.position.set(-9, 22, 12)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 20, bottom: -20, near: 1, far: 60 })
  sun.shadow.bias = -0.0005
  scene.add(sun)

  buildCourt(scene)
  buildNet(scene)
  buildUmpire(scene)
  buildStands(scene)

  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 2), new THREE.MeshStandardMaterial({ color: PAL.yellow, emissive: '#6B5200', roughness: 0.6 }))
  ball.castShadow = true
  scene.add(ball)
  const blob = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.2, 14), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.4 }))
  blob.rotation.x = -Math.PI / 2
  scene.add(blob)

  const aim = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 20), new THREE.MeshBasicMaterial({ color: PAL.yellow, side: THREE.DoubleSide }))
  aim.rotation.x = -Math.PI / 2
  scene.add(aim)

  const me = makePerson({ shirt: '#6FB1E8', shorts: '#00326A', skin: '#E3A672', hair: '#6B3E1E', cap: '#FCF9EF' })
  const rival = makePerson({ shirt: '#C62828', shorts: '#FCF9EF', skin: '#E3A672', hair: '#1C1C1C' })
  rival.root.rotation.y = Math.PI
  scene.add(me.root, rival.root)

  const camera = new THREE.PerspectiveCamera(60, 0.46, 0.1, 200)
  const look = new THREE.Vector3()
  let camX = 0

  const bubble = document.createElement('div')
  Object.assign(bubble.style, {
    position: 'absolute', top: '21%', right: '4%', display: 'none', padding: '4px 10px', background: '#fff',
    border: '2px solid #FCF9EF', borderRadius: '4px', color: '#1C1C1C', font: "26px 'Bebas Neue', sans-serif", letterSpacing: '1px', pointerEvents: 'none'
  })
  container.appendChild(bubble)

  // The framing is tuned for a portrait phone (~0.46): keep the same horizontal field of view
  // whatever the screen, so the court always fits the width and the vertical one follows.
  const HFOV = 30.8
  const resize = () => {
    const w = container.clientWidth
    const h = container.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.fov = THREE.MathUtils.clamp((2 * Math.atan(Math.tan((HFOV * Math.PI) / 360) / camera.aspect) * 180) / Math.PI, 48, 78)
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(container)
  resize()

  const ballW = new THREE.Vector3()
  const render = (dt) => {
    const b = game.ball
    const showBall = game.mode !== 'title'
    ballW.set(toX(b.x), Math.max(toY(b.z), BALL_R), toZ(b.y))
    ball.visible = blob.visible = showBall
    ball.position.copy(ballW)
    const h = Math.max(0, ballW.y - BALL_R)
    blob.position.set(ballW.x, 0.02, ballW.z)
    blob.scale.setScalar(1 + h * 0.08)
    blob.material.opacity = 0.45 / (1 + h * 0.35)

    updatePerson(me, game.pl, 'p', game, game.ball.lastHitter === 'c' ? ballW : null, dt)
    updatePerson(rival, game.cpu, 'c', game, game.ball.lastHitter === 'p' ? ballW : null, dt)

    aim.visible = game.mode === 'serve' && game.server === 'p' && Math.floor(game.t * 5) % 2 === 0
    if (aim.visible) {
      const [ax, ay] = game.serveAim()
      aim.position.set(toX(ax), 0.04, toZ(ay))
    }

    // camera: high and behind the player (his feet stay above the controls), leaning towards him
    const targetX = game.pl.x * HALF_W * 0.5
    camX += (targetX - camX) * Math.min(1, dt * 4)
    camera.position.set(camX, 9, 25)
    look.set(camX * 0.45, 0, 4)
    camera.lookAt(look)

    const text = game.msg?.text
    bubble.style.display = text ? 'block' : 'none'
    if (text) bubble.textContent = text

    renderer.render(scene, camera)
  }

  const dispose = () => {
    ro.disconnect()
    renderer.dispose()
    el.remove()
    bubble.remove()
  }
  return { render, dispose }
}
