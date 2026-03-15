'use strict';

// ── Method configuration ───────────────────────────────────────────────────────
const METHOD_KEYS   = ['uniform', 'stratified', 'halton', 'pointfilter'];
const METHOD_COLORS = { uniform: '#63b3ed', stratified: '#48bb78', halton: '#b794f4', pointfilter: '#f6ad55' };
const METHOD_LABELS = { uniform: 'Uniform', stratified: 'Stratified', halton: 'Halton', pointfilter: 'Point-filter' };

// ── Canvas setup ──────────────────────────────────────────────────────────────
const chartCanvas = document.getElementById('chartCanvas');
const chartCtx    = chartCanvas.getContext('2d');

const canvases = {};
const contexts = {};
for (const key of METHOD_KEYS) {
  canvases[key] = document.getElementById('canvas-' + key);
  contexts[key] = canvases[key].getContext('2d');
}

let numStrips    = 6;
let LINE_SPACING = 60;
const MAX_NEEDLES  = 50000;
const CHART_POINTS = 200;
const GRID_N        = 8;
const ANGLE_BINS    = 12;
const CROSS_SEQ_LEN = 500;

// ── Per-method state ──────────────────────────────────────────────────────────
function createMethodState() {
  return {
    drops: 0,
    crossings: 0,
    needles: [],
    piHistory: [],
    lastSample: 0,
    haltonIndex: 0,
    stripCounts: new Array(numStrips).fill(0),
    gridCounts:  new Array(GRID_N * GRID_N).fill(0),
    angleCounts: new Array(ANGLE_BINS).fill(0),
    crossingSeq: [],
  };
}

const methodStates = {};
for (const key of METHOD_KEYS) methodStates[key] = createMethodState();

// ── Shared settings ───────────────────────────────────────────────────────────
let running       = false;
let animId        = null;
let needleRatio   = 0.8;
let dropsPerFrame = 5;
const enabledMethods = new Set(['uniform']);

function halton(index, base) {
  let result = 0, f = 1;
  while (index > 0) { f /= base; result += f * (index % base); index = Math.floor(index / base); }
  return result;
}

const SPEED_MAP = {
  1: { dpf: 1,   label: 'Slow'    },
  2: { dpf: 3,   label: 'Medium–' },
  3: { dpf: 10,  label: 'Medium'  },
  4: { dpf: 50,  label: 'Fast'    },
  5: { dpf: 300, label: 'Turbo'   },
};

// ── Resize canvases ───────────────────────────────────────────────────────────
function resizeCanvases() {
  const section  = document.querySelector('.canvas-section');
  const count    = Math.max(1, enabledMethods.size);
  const availW   = Math.floor(section.clientWidth / count) - 24;
  const availH   = section.clientHeight - 56;
  const size     = Math.max(10, Math.min(availW, availH));

  for (const key of METHOD_KEYS) {
    canvases[key].width  = size;
    canvases[key].height = size;
  }
  LINE_SPACING = size / numStrips;

  const chartSection = chartCanvas.parentElement;
  chartCanvas.width  = chartSection.clientWidth - 40;
  chartCanvas.height = 100;

  for (const key of METHOD_KEYS) {
    drawFloor(key);
    redrawNeedles(key);
  }
  drawChart();
}

// ── Floor and needle drawing ──────────────────────────────────────────────────
function drawFloor(key) {
  const ctx = contexts[key];
  const { width, height } = canvases[key];
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#2a2d3e';
  ctx.lineWidth   = 1;
  for (let y = LINE_SPACING; y < height; y += LINE_SPACING) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawNeedle(key, { x1, y1, x2, y2, crosses }) {
  const ctx = contexts[key];
  ctx.strokeStyle = crosses ? 'rgba(255,101,132,0.55)' : 'rgba(99,179,237,0.45)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function redrawNeedles(key) {
  for (const n of methodStates[key].needles) drawNeedle(key, n);
}

// ── Drop one needle ───────────────────────────────────────────────────────────
function dropNeedle(method) {
  const state  = methodStates[method];
  const canvas = canvases[method];
  const L      = needleRatio * LINE_SPACING;
  const { width, height } = canvas;
  let x1, y1, x2, y2, crosses, theta, trackX, trackY;

  if (method === 'pointfilter') {
    // Pick a random starting point
    x1 = Math.random() * width;
    y1 = Math.random() * height;

    // Rejection-sample a vector inside the disk of radius L from a bounding square
    let dx, dy;
    do {
      dx = (Math.random() * 2 - 1) * L;
      dy = (Math.random() * 2 - 1) * L;
    } while (dx * dx + dy * dy > L * L);

    // Normalize to exact length L (the "filter" step)
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-12) { dx = L; dy = 0; }
    else { dx = (dx / len) * L; dy = (dy / len) * L; }

    x2 = x1 + dx;
    y2 = y1 + dy;

    // Crossing detection via endpoints — no angle needed
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const firstLine = Math.ceil(minY / LINE_SPACING) * LINE_SPACING;
    crosses = firstLine <= maxY;

    // Derive implicit angle for angle-bin tracking: fold atan2 to [0, π)
    theta = Math.atan2(dy, dx);
    if (theta < 0) theta += Math.PI;

    trackX = x1;
    trackY = y1;
  } else {
    let cx, cy;
    if (method === 'stratified') {
      const strip = Math.floor(Math.random() * numStrips);
      state.stripCounts[strip] = (state.stripCounts[strip] || 0) + 1;
      cy    = (strip + Math.random()) * LINE_SPACING;
      cx    = Math.random() * width;
      theta = Math.random() * Math.PI;
    } else if (method === 'halton') {
      cx    = halton(state.haltonIndex, 2) * width;
      cy    = halton(state.haltonIndex, 3) * height;
      theta = halton(state.haltonIndex, 5) * Math.PI;
      state.haltonIndex++;
    } else {
      cx    = Math.random() * width;
      cy    = Math.random() * height;
      theta = Math.random() * Math.PI;
    }

    const dx = (L / 2) * Math.cos(theta);
    const dy = (L / 2) * Math.sin(theta);

    x1 = cx - dx; y1 = cy - dy;
    x2 = cx + dx; y2 = cy + dy;

    const distToLine = cy % LINE_SPACING;
    const minDist    = Math.min(distToLine, LINE_SPACING - distToLine);
    crosses          = (L / 2) * Math.abs(Math.sin(theta)) >= minDist;

    trackX = cx;
    trackY = cy;
  }

  const gx = Math.min(Math.floor(trackX / width  * GRID_N), GRID_N - 1);
  const gy = Math.min(Math.floor(trackY / height * GRID_N), GRID_N - 1);
  state.gridCounts[gy * GRID_N + gx]++;

  const ai = Math.min(Math.floor(theta / Math.PI * ANGLE_BINS), ANGLE_BINS - 1);
  state.angleCounts[ai]++;

  state.crossingSeq.push(crosses ? 1 : 0);
  if (state.crossingSeq.length > CROSS_SEQ_LEN) state.crossingSeq.shift();

  state.drops++;
  if (crosses) state.crossings++;

  const needle = { x1, y1, x2, y2, crosses };
  if (state.needles.length < MAX_NEEDLES) state.needles.push(needle);
  drawNeedle(method, needle);
}

// ── π estimate ────────────────────────────────────────────────────────────────
function estimatePi(state) {
  if (state.crossings === 0) return null;
  const L = needleRatio * LINE_SPACING;
  return (2 * L * state.drops) / (LINE_SPACING * state.crossings);
}

// ── Stats update ──────────────────────────────────────────────────────────────
function updateStats() {
  for (const key of METHOD_KEYS) {
    const state = methodStates[key];
    document.getElementById('stat-drops-' + key).textContent = state.drops.toLocaleString();
    const est = estimatePi(state);
    if (est === null) {
      document.getElementById('stat-pi-' + key).textContent    = '—';
      document.getElementById('stat-error-' + key).textContent = '—';
    } else {
      document.getElementById('stat-pi-' + key).textContent    = est.toFixed(6);
      const err = Math.abs(est - Math.PI) / Math.PI * 100;
      document.getElementById('stat-error-' + key).textContent = err.toFixed(3) + '%';
    }
  }
  updateRandMetrics();
}

// ── Randomness metrics ────────────────────────────────────────────────────────
function chiSqRatio(counts) {
  const n   = counts.reduce((a, b) => a + b, 0);
  const k   = counts.length;
  const exp = n / k;
  if (exp < 5) return null;
  const chi2 = counts.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
  return chi2 / (k - 1);
}

function lag1Autocorr(seq) {
  if (seq.length < 50) return null;
  const n    = seq.length;
  const mean = seq.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n - 1; i++) num += (seq[i] - mean) * (seq[i + 1] - mean);
  for (const v of seq) den += (v - mean) ** 2;
  return den > 0 ? num / den : 0;
}

function chiColor(r) {
  if (r === null) return 'mval-muted';
  if (r < 0.3)   return 'mval-blue';
  if (r < 0.5)   return 'mval-teal';
  if (r < 1.5)   return 'mval-green';
  if (r < 2.5)   return 'mval-yellow';
  return 'mval-red';
}

function autocorrColor(r) {
  if (r === null) return 'mval-muted';
  const abs = Math.abs(r);
  if (abs < 0.05) return 'mval-green';
  if (abs < 0.12) return 'mval-yellow';
  return 'mval-red';
}

const elRandMetrics = document.getElementById('randMetrics');

function updateStatsVisibility() {
  for (const key of METHOD_KEYS) {
    const show = enabledMethods.has(key);
    for (const el of document.querySelectorAll(`[data-method="${key}"]`)) {
      el.hidden = !show;
    }
  }
}

function makeCell(tag, text, cssClass, style) {
  const el = document.createElement(tag);
  if (cssClass) el.className = cssClass;
  if (style)    el.style.cssText = style;
  el.textContent = text;
  return el;
}

function updateRandMetrics() {
  const table = document.createElement('table');
  table.className = 'rand-table';

  // Header row
  const thead = table.createTHead();
  const hrow  = thead.insertRow();
  hrow.appendChild(makeCell('th', ''));
  for (const key of METHOD_KEYS) {
    if (!enabledMethods.has(key)) continue;
    hrow.appendChild(makeCell('th', METHOD_LABELS[key], '', `color:${METHOD_COLORS[key]}`));
  }

  const tbody = table.createTBody();

  // Row builder
  function addRow(label, note, valueFn, colorFn) {
    const row = tbody.insertRow();
    const lbl = makeCell('td', label, 'rand-label');
    const mnote = document.createElement('span');
    mnote.className = 'mnote';
    mnote.textContent = note;
    lbl.appendChild(mnote);
    row.appendChild(lbl);
    for (const key of METHOD_KEYS) {
      if (!enabledMethods.has(key)) continue;
      const r = valueFn(key);
      row.appendChild(makeCell('td', r !== null ? r.display : '—', `mval ${colorFn(r !== null ? r.value : null)}`));
    }
  }

  addRow('Spatial χ²/df', 'ideal ≈ 1.0',
    key => { const v = chiSqRatio(methodStates[key].gridCounts);   return v !== null ? { value: v, display: v.toFixed(3) } : null; },
    chiColor);

  addRow('Angle χ²/df', 'ideal ≈ 1.0',
    key => { const v = chiSqRatio(methodStates[key].angleCounts);  return v !== null ? { value: v, display: v.toFixed(3) } : null; },
    chiColor);

  addRow('Serial autocorr', 'ideal ≈ 0',
    key => { const v = lag1Autocorr(methodStates[key].crossingSeq); return v !== null ? { value: v, display: (v >= 0 ? '+' : '') + v.toFixed(4) } : null; },
    r => autocorrColor(r));

  elRandMetrics.replaceChildren(table);
}

// ── Chart zoom ────────────────────────────────────────────────────────────────
const ZOOM_LEVELS = [1.5, 0.5, 0.1, 0.02];
let zoomIndex = 0;

// ── Convergence chart ─────────────────────────────────────────────────────────
function sampleChart(key) {
  const state = methodStates[key];
  const est   = estimatePi(state);
  if (est !== null) {
    state.piHistory.push(est);
    if (state.piHistory.length > CHART_POINTS) state.piHistory.shift();
  }
}

function drawChart() {
  const { width, height } = chartCanvas;
  chartCtx.clearRect(0, 0, width, height);

  const zoom = ZOOM_LEVELS[zoomIndex];
  const yMin = Math.PI - zoom;
  const yMax = Math.PI + zoom;
  const toY  = v => height - ((v - yMin) / (yMax - yMin)) * height;

  // π reference line
  chartCtx.strokeStyle = 'rgba(108,99,255,0.4)';
  chartCtx.lineWidth   = 1;
  chartCtx.setLineDash([4, 4]);
  const pyRef = toY(Math.PI);
  chartCtx.beginPath();
  chartCtx.moveTo(0, pyRef);
  chartCtx.lineTo(width, pyRef);
  chartCtx.stroke();
  chartCtx.setLineDash([]);

  // One line per method
  for (const key of METHOD_KEYS) {
    const hist = methodStates[key].piHistory;
    if (hist.length < 2) continue;
    chartCtx.strokeStyle = METHOD_COLORS[key];
    chartCtx.lineWidth   = 1.5;
    chartCtx.beginPath();
    const step = width / (CHART_POINTS - 1);
    hist.forEach((v, i) => {
      const x = i * step;
      const y = toY(Math.max(yMin, Math.min(yMax, v)));
      i === 0 ? chartCtx.moveTo(x, y) : chartCtx.lineTo(x, y);
    });
    chartCtx.stroke();
  }

  chartCtx.fillStyle = 'rgba(108,99,255,0.7)';
  chartCtx.font      = '10px monospace';
  chartCtx.fillText('π', 4, pyRef - 3);
}

// ── Animation loop ────────────────────────────────────────────────────────────
function step() {
  if (!running) return;

  for (const key of METHOD_KEYS) {
    if (!enabledMethods.has(key)) continue;
    for (let i = 0; i < dropsPerFrame; i++) dropNeedle(key);
    const state = methodStates[key];
    if (state.drops - state.lastSample >= 200) {
      sampleChart(key);
      state.lastSample = state.drops;
    }
  }

  drawChart();
  updateStats();
  animId = requestAnimationFrame(step);
}

// ── Reset helpers ─────────────────────────────────────────────────────────────
function resetAllStates() {
  for (const key of METHOD_KEYS) {
    methodStates[key] = createMethodState();
    drawFloor(key);
  }
}

// ── Controls ──────────────────────────────────────────────────────────────────
const btnStart     = document.getElementById('btnStart');
const btnPause     = document.getElementById('btnPause');
const btnReset     = document.getElementById('btnReset');
const sliderLen    = document.getElementById('needleLen');
const sliderSpd    = document.getElementById('speed');
const sliderStrips = document.getElementById('strips');
const labelLen     = document.getElementById('needleLenLabel');
const labelSpd     = document.getElementById('speedLabel');
const labelStrips  = document.getElementById('stripsLabel');

document.getElementById('btnZoom').addEventListener('click', () => {
  zoomIndex = (zoomIndex + 1) % ZOOM_LEVELS.length;
  document.getElementById('btnZoom').textContent = '±' + ZOOM_LEVELS[zoomIndex];
  drawChart();
});

sliderLen.addEventListener('input', () => {
  needleRatio = parseFloat(sliderLen.value);
  labelLen.textContent = needleRatio.toFixed(2) + '× spacing';
});

sliderStrips.addEventListener('input', () => {
  numStrips = parseInt(sliderStrips.value);
  labelStrips.textContent = numStrips;
  LINE_SPACING = canvases.uniform.width / numStrips;
  running = false;
  cancelAnimationFrame(animId);
  resetAllStates();
  btnStart.disabled    = false;
  btnStart.textContent = 'Start';
  btnPause.disabled    = true;
  updateStats();
  drawChart();
});

sliderSpd.addEventListener('input', () => {
  const s = parseInt(sliderSpd.value);
  dropsPerFrame        = SPEED_MAP[s].dpf;
  labelSpd.textContent = SPEED_MAP[s].label;
});

btnStart.addEventListener('click', () => {
  running           = true;
  btnStart.disabled = true;
  btnPause.disabled = false;
  animId = requestAnimationFrame(step);
});

btnPause.addEventListener('click', () => {
  running              = false;
  cancelAnimationFrame(animId);
  btnStart.disabled    = false;
  btnPause.disabled    = true;
  btnStart.textContent = 'Resume';
});

btnReset.addEventListener('click', () => {
  running = false;
  cancelAnimationFrame(animId);
  resetAllStates();
  btnStart.disabled    = false;
  btnStart.textContent = 'Start';
  btnPause.disabled    = true;
  updateStats();
  drawChart();
});

document.getElementById('btnRandInfo').addEventListener('click', () => {
  const panel = document.getElementById('randInfoPanel');
  panel.hidden = !panel.hidden;
});

for (const key of METHOD_KEYS) {
  document.getElementById('toggle-' + key).addEventListener('change', function () {
    const panel = document.getElementById('panel-' + key);
    if (this.checked) {
      enabledMethods.add(key);
      panel.hidden = false;
    } else {
      enabledMethods.delete(key);
      panel.hidden = true;
    }
    updateStatsVisibility();
    updateRandMetrics();
    resizeCanvases();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('resize', resizeCanvases);
resizeCanvases();

needleRatio = parseFloat(sliderLen.value);
labelLen.textContent = needleRatio.toFixed(2) + '× spacing';
const initSpeed = parseInt(sliderSpd.value);
dropsPerFrame        = SPEED_MAP[initSpeed].dpf;
labelSpd.textContent = SPEED_MAP[initSpeed].label;
numStrips = parseInt(sliderStrips.value);
labelStrips.textContent = numStrips;

updateStatsVisibility();
updateStats();
