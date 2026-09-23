'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#64b5f6', // J - pale blue
  '#ffb74d', // L - orange
  '#ff5252', // bomb
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8]],                                       // bomb power-up
];

const LINE_SCORES = [0, 100, 300, 500, 800];

// Power-up: Bomba — pieza especial 1x1 que al aterrizar destruye un área 3x3
const BOMB_TYPE = 8;
const BOMB_CHANCE = 0.08;
const BOMB_CELL_SCORE = 10;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const startRecords = document.getElementById('start-records');
const recordsExtra = document.getElementById('records-extra');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');
const overRecords = document.getElementById('over-records');
const resetBtns = document.querySelectorAll('.reset-records-btn');

const THEME_KEY = 'tetris-theme';
const RECORDS_KEY = 'tetris-records';
const NAME_KEY = 'tetris-player-name';
const MAX_RECORDS = 5;
const NAME_MAX = 12;
const GRID_COLOR = { dark: '#22222e', light: '#d8d8e4' };

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, explosion;
let combo = 0, started = false, pendingEntry = null, bestComboRun = 0;

function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
  themeToggle.checked = theme === 'light';
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'light' ? 'light' : 'dark');
  themeToggle.addEventListener('change', () => {
    const theme = themeToggle.checked ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  });
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.random() < BOMB_CHANCE ? BOMB_TYPE : Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function explode(cx, cy) {
  let destroyed = 0;
  for (let r = cy - 1; r <= cy + 1; r++) {
    if (r < 0 || r >= ROWS) continue;
    for (let c = cx - 1; c <= cx + 1; c++) {
      if (c < 0 || c >= COLS) continue;
      if (board[r][c]) {
        board[r][c] = 0;
        destroyed++;
      }
    }
  }
  score += destroyed * BOMB_CELL_SCORE * level;
  explosion = { x: cx, y: cy, t: performance.now() };
  updateHUD();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.type === BOMB_TYPE) {
    explode(current.x, current.y);
  } else {
    merge();
    const before = lines;
    clearLines();
    combo = lines > before ? combo + 1 : 0;
    if (combo > bestComboRun) bestComboRun = combo;
  }
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;

  if (colorIndex === BOMB_TYPE) {
    const cx = x * size + size / 2;
    const cy = y * size + size / 2;
    const radius = size / 2 - 3;
    context.fillStyle = color;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(0,0,0,0.6)';
    context.lineWidth = 2;
    context.stroke();
    // brillo
    context.fillStyle = 'rgba(255,255,255,0.35)';
    context.beginPath();
    context.arc(cx - radius * 0.35, cy - radius * 0.35, radius * 0.3, 0, Math.PI * 2);
    context.fill();
    // mecha
    context.strokeStyle = '#ffd54f';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(cx + radius * 0.4, cy - radius * 0.7);
    context.lineTo(cx + radius * 0.9, cy - radius * 1.2);
    context.stroke();
    context.globalAlpha = 1;
    return;
  }

  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = document.body.classList.contains('light') ? GRID_COLOR.light : GRID_COLOR.dark;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  // explosion flash
  if (explosion) {
    const elapsed = performance.now() - explosion.t;
    const duration = 250;
    if (elapsed < duration) {
      const alpha = 0.6 * (1 - elapsed / duration);
      const startC = Math.max(0, explosion.x - 1);
      const startR = Math.max(0, explosion.y - 1);
      const endC = Math.min(COLS - 1, explosion.x + 1);
      const endR = Math.min(ROWS - 1, explosion.y + 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ff9800';
      ctx.fillRect(startC * BLOCK, startR * BLOCK, (endC - startC + 1) * BLOCK, (endR - startR + 1) * BLOCK);
      ctx.globalAlpha = 1;
    } else {
      explosion = null;
    }
  }
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  finishRecords();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  explosion = null;
  combo = 0;
  bestComboRun = 0;
  submitName();
  pendingEntry = null;
  recordsExtra.classList.add('hidden');
  startScreen.classList.add('hidden');
  started = true;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (!started) {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); init(); }
    return;
  }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

initTheme();
initRecords();

// ---- Records locales ----
function loadRecords() {
  const rec = { top: [], bestCombo: 0, maxLines: 0 };
  try {
    const d = JSON.parse(localStorage.getItem(RECORDS_KEY));
    if (d && typeof d === 'object') {
      if (Array.isArray(d.top)) {
        rec.top = d.top
          .filter(e => e && Number.isFinite(e.score))
          .map(e => ({
            name: String(e.name || 'Anónimo').slice(0, NAME_MAX),
            score: e.score,
            lines: Number(e.lines) || 0,
            level: Number(e.level) || 1,
            date: String(e.date || ''),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_RECORDS);
      }
      rec.bestCombo = Number(d.bestCombo) || 0;
      rec.maxLines = Number(d.maxLines) || 0;
    }
  } catch (e) { /* datos corruptos: valores por defecto */ }
  return rec;
}

function saveRecords(rec) {
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(rec)); } catch (e) { /* sin almacenamiento */ }
}

function loadName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
}

function renderRecords(container, rec, highlight) {
  container.textContent = '';
  const table = document.createElement('table');
  table.className = 'records-table';
  const head = table.createTHead().insertRow();
  ['#', 'Nombre', 'Puntos', 'Líneas'].forEach(t => {
    const th = document.createElement('th');
    th.textContent = t;
    head.appendChild(th);
  });
  const body = table.createTBody();
  if (!rec.top.length) {
    const td = body.insertRow().insertCell();
    td.colSpan = 4;
    td.className = 'records-empty';
    td.textContent = 'Sin records todavía';
  }
  rec.top.forEach((e, i) => {
    const tr = body.insertRow();
    if (i === highlight) tr.className = 'records-highlight';
    [i + 1, e.name, e.score.toLocaleString(), e.lines].forEach(v => {
      tr.insertCell().textContent = v;
    });
  });
  container.appendChild(table);
  const stats = document.createElement('p');
  stats.className = 'records-stats';
  stats.textContent = `Mejor combo: ${rec.bestCombo} · Líneas máx.: ${rec.maxLines}`;
  container.appendChild(stats);
}

function finishRecords() {
  const rec = loadRecords();
  rec.maxLines = Math.max(rec.maxLines, lines);
  rec.bestCombo = Math.max(rec.bestCombo, bestComboRun);
  const qualifies = score > 0 && (rec.top.length < MAX_RECORDS || score > rec.top[rec.top.length - 1].score);
  saveRecords(rec);
  recordsExtra.classList.remove('hidden');
  if (qualifies) {
    pendingEntry = { name: '', score, lines, level, date: new Date().toISOString().slice(0, 10) };
    nameInput.value = loadName().slice(0, NAME_MAX);
    nameForm.classList.remove('hidden');
    overRecords.textContent = '';
    nameInput.focus();
    nameInput.select();
  } else {
    pendingEntry = null;
    nameForm.classList.add('hidden');
    renderRecords(overRecords, rec, -1);
  }
}

function submitName() {
  if (!pendingEntry) return;
  const rec = loadRecords();
  const name = nameInput.value.trim().slice(0, NAME_MAX) || 'Anónimo';
  try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* ignorar */ }
  pendingEntry.name = name;
  rec.top.push(pendingEntry);
  rec.top.sort((a, b) => b.score - a.score);
  const idx = rec.top.indexOf(pendingEntry);
  rec.top = rec.top.slice(0, MAX_RECORDS);
  saveRecords(rec);
  pendingEntry = null;
  nameForm.classList.add('hidden');
  renderRecords(overRecords, rec, idx < MAX_RECORDS ? idx : -1);
}

function resetRecords() {
  if (!confirm('¿Borrar todos los records?')) return;
  try { localStorage.removeItem(RECORDS_KEY); } catch (e) { /* ignorar */ }
  renderRecords(startRecords, loadRecords(), -1);
  if (gameOver && !pendingEntry) renderRecords(overRecords, loadRecords(), -1);
}

function initRecords() {
  renderRecords(startRecords, loadRecords(), -1);
  startBtn.addEventListener('click', init);
  nameForm.addEventListener('submit', e => { e.preventDefault(); submitName(); });
  resetBtns.forEach(b => b.addEventListener('click', resetRecords));
  startScreen.classList.remove('hidden');
}
