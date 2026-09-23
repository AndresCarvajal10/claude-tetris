# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Classic Tetris implemented in vanilla JavaScript with HTML5 Canvas and CSS — no dependencies, no build step, no package.json. The entire game logic lives in a single file, `game.js` (~300 lines).

## Running the game

There is no build/lint/test tooling. Just serve or open the files directly:

```bash
# Open directly
start index.html       # Windows

# Or serve locally (either works)
python3 -m http.server 8000
npx serve .
```

Then verify changes by opening the page in a browser and playing — there are no automated tests.

## Architecture

Three files cooperate, no modules/bundler:

- `index.html` — DOM structure: the main `<canvas id="board">` (300×600, i.e. `COLS × BLOCK` by `ROWS × BLOCK`), a side panel (score/lines/level/next-piece preview), and a pause/game-over overlay.
- `style.css` — dark/retro arcade visual theme.
- `game.js` — all game logic, structured around a small set of core concepts:
  - **Board model**: a `ROWS × COLS` matrix where each cell is `0` (empty) or a color index `1–7` identifying a locked piece.
  - **Pieces**: the 7 standard tetrominoes defined as square matrices in `PIECES`. Rotation is done via `rotateCW` (transpose + reverse rows), not by storing rotation states.
  - **Collision** (`collide`): checks board bounds and overlap with locked cells.
  - **Wall kicks** (`tryRotate`): after rotating, tries offsets `[0, -1, 1, -2, 2]` columns before giving up on the rotation.
  - **Game loop** (`loop`): driven by `requestAnimationFrame`; accumulates elapsed time and drops the piece one row once `dropAccum >= dropInterval`.
  - **Line clearing** (`clearLines`): scans bottom-to-top, splices full rows out and unshifts empty rows at the top.
  - **Scoring**: `LINE_SCORES = [0, 100, 300, 500, 800]` multiplied by current `level`; hard drop adds 2 pts/cell, soft drop adds 1 pt/row.
  - **Leveling/speed**: level increases every 10 lines; `dropInterval = max(100, 1000 - (level - 1) * 90)` ms.
  - **Ghost piece** (`ghostY`): projects the current piece straight down to its landing row, drawn at `globalAlpha = 0.2`.
  - **Bomb power-up**: a special 1×1 piece (`type = BOMB_TYPE`, spawn chance `BOMB_CHANCE` in `randomPiece`) drawn as a fuse-and-circle. On lock, `lockPiece` calls `explode` instead of `merge`/`clearLines`, clearing the 3×3 area centered on the bomb (board bounds are clipped, nothing above falls), awarding `BOMB_CELL_SCORE * level` per destroyed cell, and triggering a brief orange flash in `draw()`.
  - **Pause menu**: `P`/`Escape` calls `togglePause()` -> `openPauseMenu()`/`closePauseMenu()`, showing the separate `#pause-menu` overlay (`#overlay` stays for game over) with Reanudar, Reiniciar, Ver controles (in-menu key list) and a starting-level selector. While paused all game keys are ignored; resume resets `lastTime`/`dropAccum`. `startLevel` (1-`MAX_START_LEVEL`) is persisted in localStorage `tetris-start-level`, applied by `init()`, and acts as a floor in `clearLines` (`level = max(startLevel, floor(lines/10)+1)`).

Control flow: `init()` builds the board, seeds `next`, calls `spawn()`, and starts the `requestAnimationFrame` loop. `spawn()` promotes `next` to `current` and generates a new `next`; if the newly spawned piece immediately collides, `endGame()` fires and the Game Over overlay is shown. Keyboard input (`keydown` listener) handles movement/rotation/soft-drop/hard-drop/pause; `P` toggles pause via `togglePause()`.

## Tunable constants (in `game.js`)

`COLS`, `ROWS`, `BLOCK` (cell pixel size), `COLORS`, `LINE_SCORES`, `dropInterval`, `BOMB_CHANCE` (bomb piece spawn probability), `BOMB_CELL_SCORE`, `MAX_START_LEVEL` (top of the start-level selector). If `COLS`/`ROWS`/`BLOCK` change, update the `width`/`height` attributes of `<canvas id="board">` in `index.html` to match (`COLS × BLOCK` by `ROWS × BLOCK`).
