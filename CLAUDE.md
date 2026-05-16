# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install      # install deps
npm run dev      # start Vite dev server (default http://localhost:5173)
npm run build    # production build to dist/
npm run preview  # serve the built bundle
```

There is no linter, formatter, or test framework configured — the project ships only the three Vite scripts above.

## Architecture

The entire game lives in a single ~750-line React component: [src/App.jsx](src/App.jsx). [src/main.jsx](src/main.jsx) only mounts it. Treat `App.jsx` as the source of truth — there is no module split, no state library, no router.

### State model

The component uses two parallel state systems on purpose:

- **`gameRef.current`** (mutable ref) — owns the real-time simulation state (`x`, `y`, `heading`, `speed`, `sailAngle`, `angleDiff`, `currentMark`, `elapsed`, `trail`, `t`). The game loop mutates this every frame at ~60 Hz **without** triggering React re-renders.
- **`useState` values** (`elapsed`, `sailAngleDisplay`, `speedDisplay`, `speedRatio`, `currentMark`) — mirrors of the above, updated once per frame from the loop *only for HUD display*. CSS overlays (speed glow, flash bar) read these.

When changing physics or per-frame behavior, mutate `gameRef.current` directly. Only push to `setState` if the HUD or a CSS overlay needs to react. Adding setState calls inside the per-frame loop has a real perf cost — keep it minimal.

Similarly, `keysRef` and `rudderRef` hold input state outside React for the same reason.

### Game loop

A single `useEffect` (gated on `gameState === "playing"`) drives everything via `requestAnimationFrame`. Each frame:

1. Read keyboard (`keysRef`) and touch (`rudderRef`, `gameRef.current.sailAngle` written by `Joystick`/`SailSlider`).
2. Compute physics — `angleDiff` (boat heading vs. wind), `polarSpeed(angleDiff)` (boat polar curve), `optimalSailAngle(angleDiff)` (target sail angle), then ease `g.speed` toward target.
3. Detect tacking (sign change of `windSide`) → trigger coach line.
4. Move boat, append to trail, check mark proximity, advance `currentMark` or finish level.
5. Trigger coach categories (`noGoZone`, `sailTooIn`, `sailTooOut`, `goodSpeed`, `nearMark`) based on current state.
6. Update HUD state via `setState`.
7. Draw the frame on canvas: ocean → wind arrows → trail → particles → speed streaks → marks → boat → speedometer → wind compass.

### Sailing physics conventions

These are easy to break if you don't know them. Comments in [src/App.jsx:268-278](src/App.jsx#L268) and [src/App.jsx:328-345](src/App.jsx#L328) document them; keep those in sync if you change behavior:

- **Heading**: `0°` = boat moves toward screen-up (canvas `-Y`). Rotation is clockwise.
- **`windDir`**: direction the wind is *going to* (per `LEVELS`). `windFrom = (windDir + 180) % 360` is where it comes from.
- **`angleDiff`**: heading − wind-from, normalized to `(-180, 180]`. `>0` means wind from port, `<0` from starboard.
- **`windSide`**: sign of `angleDiff`. Sail (boom) swings to the opposite side. A change in sign is a tack.
- **`sailAngle`**: `0` = sail aligned with stern (closed), `100` ≈ fully eased. `optimalSailAngle()` returns the target for current `angleDiff`; sail efficiency falls off linearly with the deviation.

### Levels

`LEVELS` is a flat array at the top of `App.jsx`. Each entry defines `windDir`, `windSpeed`, an ordered list of `marks` (the boat must reach them in order), `startPos`, `startHeading`, and an on-screen `tip`. Adding a level = appending an entry. Best times are keyed `lv${id}` in `localStorage` under `op_records3` (bump this key if record schema changes).

### Coach (黑熊教練)

`BEAR_TIPS` maps a category to several humorous Traditional-Chinese lines (one is picked at random). `showBear(cat)` rate-limits by stashing the last category in `lastBearCatRef` and a 5.5s timer in `bearTimerRef` — repeated calls with the same category are dropped. `speakBear()` uses `window.speechSynthesis` with `zh-TW` and prefers a list of male Chinese voice names. The coach can be toggled off; `coachOnRef` mirrors the state so the game loop reads it without re-subscribing.

### Rendering pipeline

All visuals are drawn directly on a single `<canvas width={800} height={700}>`. The CSS layer on top of the canvas only renders the speed glow (`boxShadow`) and the flash bar — the boat, marks, particles, speed streaks, speedometer, and compass are all canvas primitives. `speedZone(ratio)` is the single source of truth for the four speed tiers (`無風 / 微風 / 強風 / 飆速`) and their colors; both canvas drawing and CSS overlays read from it, so changing a color there propagates everywhere.

## Style and language

- The game UI and all user-facing strings are **Traditional Chinese (zh-TW)**. Keep new strings in zh-TW unless the user says otherwise.
- All styling is inline `style={{...}}` — there are no CSS files. Two `@keyframes` (`bearIn`, `flashBar`) live in a `<style>` tag at the bottom of the playing view.
- Single-letter variable names (`g` for `gameRef.current`, `lv` for level, `mk` for mark) are an established pattern inside the loop. The loop is dense on purpose; favor preserving that style over reformatting.
