# game-1540-tennis

A tennis game for the browser, built with Vue 3 and canvas. Playable at [game.1540.tennis](https://game.1540.tennis).

The current prototype is Game Boy style: a camera follows the action, sprites are drawn procedurally (no image assets) and sound is synthesised with WebAudio. It is meant to be experimented with, so the look and the mechanics may change.

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

## Structure

- `src/games/TennisGame.vue`: the whole game (state, rendering, input, audio).
- `src/App.vue`: mounts the game.

## Origin

MIT licensed. Started as a hidden prototype inside [15/40 Tennis](https://1540.tennis) and split out to its own repository.
