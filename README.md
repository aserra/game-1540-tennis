# game-1540-tennis

A tennis game for the browser, built with Vue 3 and canvas. Playable at [game.1540.tennis](https://game.1540.tennis).

Everything is generated in code (sprites, 3D models, sound via WebAudio): there are no image or model assets. It is meant to be experimented with, so the look and the mechanics may change.

## Controls

- **Stick (left):** move your player.
- **Swing button:** hit the ball. Timing decides how clean the shot is.
- **Right pad:** hold to charge power; where you drag it decides the shot at release (left/right = direction, up = lob, down = drop shot). A quick tap is a plain shot.

## Develop

```
npm install
npm run dev      # http://localhost:5174
npm run build    # static output in dist/
```

## Renderers

The same simulation is drawn by two renderers, so both are kept:

- **2D**: Game Boy style, pixel sprites on a canvas.
- **3D**: low-poly Three.js scene (procedural characters, stands, shadows), full-screen on phones.

Pick one with the **2D/3D** button on the title screen (remembered in the browser), or force it with `?2d` / `?3d` in the URL. The default is set by `DEFAULT_MODE` in `TennisGame.vue`.

## Structure

- `src/game/core.js`: the simulation (rules, physics, scoring, CPU). No DOM, canvas or Vue.
- `src/game/render3d.js`: the Three.js renderer (loaded on demand, so the 2D game does not carry it).
- `src/games/TennisGame.vue`: the 2D renderer, the touch controls, audio and the page layout.
- `src/App.vue`: mounts the game.

## Origin

MIT licensed. Started as a hidden prototype inside [15/40 Tennis](https://1540.tennis) and split out to its own repository.
