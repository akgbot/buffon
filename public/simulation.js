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
    spatialChiHistory: [],
    angleChiHistory: [],
    autocorrHistory: [],
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
const enabledMethods = new Set(['uniform', 'pointfilter']);

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
  sizeAndDrawStatCharts();
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

function updateRandMetrics() {
  const enabledKeys = METHOD_KEYS.filter(k => enabledMethods.has(k));
  const numCols = enabledKeys.length + 1;
  let html = '<table class="rand-table"><thead><tr><th></th>';
  for (const key of enabledKeys) {
    html += `<th style="color:${METHOD_COLORS[key]}">${METHOD_LABELS[key]}</th>`;
  }
  html += '</tr></thead><tbody>';

  html += '<tr><td class="rand-label">Spatial χ²/df</td>';
  for (const key of enabledKeys) {
    const r = chiSqRatio(methodStates[key].gridCounts);
    html += `<td class="mval ${chiColor(r)}">${r !== null ? r.toFixed(3) : '—'}</td>`;
  }
  html += '</tr>';
  html += `<tr class="rand-chart-row"><td colspan="${numCols}"><canvas id="spatialChiCanvas" class="stat-inline-chart"></canvas></td></tr>`;

  html += '<tr><td class="rand-label">Angle χ²/df</td>';
  for (const key of enabledKeys) {
    const r = chiSqRatio(methodStates[key].angleCounts);
    html += `<td class="mval ${chiColor(r)}">${r !== null ? r.toFixed(3) : '—'}</td>`;
  }
  html += '</tr>';
  html += `<tr class="rand-chart-row"><td colspan="${numCols}"><canvas id="angleChiCanvas" class="stat-inline-chart"></canvas></td></tr>`;

  html += '<tr><td class="rand-label">Serial autocorr</td>';
  for (const key of enabledKeys) {
    const r = lag1Autocorr(methodStates[key].crossingSeq);
    const s = r !== null ? (r >= 0 ? '+' : '') + r.toFixed(4) : '—';
    html += `<td class="mval ${autocorrColor(r)}">${s}</td>`;
  }
  html += '</tr>';
  html += `<tr class="rand-chart-row"><td colspan="${numCols}"><canvas id="autocorrCanvas" class="stat-inline-chart"></canvas></td></tr>`;

  html += '</tbody></table>';
  elRandMetrics.innerHTML = html;
  sizeAndDrawStatCharts();
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

  const sc = chiSqRatio(state.gridCounts);
  if (sc !== null) {
    state.spatialChiHistory.push(sc);
    if (state.spatialChiHistory.length > CHART_POINTS) state.spatialChiHistory.shift();
  }

  const ac = chiSqRatio(state.angleCounts);
  if (ac !== null) {
    state.angleChiHistory.push(ac);
    if (state.angleChiHistory.length > CHART_POINTS) state.angleChiHistory.shift();
  }

  const corr = lag1Autocorr(state.crossingSeq);
  if (corr !== null) {
    state.autocorrHistory.push(corr);
    if (state.autocorrHistory.length > CHART_POINTS) state.autocorrHistory.shift();
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

// ── Randomness stat charts ─────────────────────────────────────────────────────
function drawStatChart(canvas, ctx, getHistory, yMin, yMax, refVal, refLabel) {
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const toY = v => height - ((v - yMin) / (yMax - yMin)) * height;
  const refY = Math.max(0, Math.min(height, toY(refVal)));

  // Reference line
  ctx.strokeStyle = 'rgba(108,99,255,0.4)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, refY);
  ctx.lineTo(width, refY);
  ctx.stroke();
  ctx.setLineDash([]);

  // One line per method
  for (const key of METHOD_KEYS) {
    if (!enabledMethods.has(key)) continue;
    const hist = getHistory(key);
    if (hist.length < 2) continue;
    ctx.strokeStyle = METHOD_COLORS[key];
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    const step = width / (CHART_POINTS - 1);
    hist.forEach((v, i) => {
      const x = i * step;
      const y = toY(Math.max(yMin, Math.min(yMax, v)));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Legend (drawn last so it appears on top)
  const legendText = 'ideal = ' + refLabel;
  ctx.font = '9px monospace';
  const lineLen = 14;
  const gap     = 4;
  const textW   = ctx.measureText(legendText).width;
  const padX    = 5;
  const boxW    = padX + lineLen + gap + textW + padX;
  const boxH    = 14;
  const bx      = width - boxW - 4;
  const by      = 4;

  // Background box
  ctx.fillStyle = 'rgba(26,29,39,0.88)';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(bx, by, boxW, boxH, 3);
  } else {
    ctx.rect(bx, by, boxW, boxH);
  }
  ctx.fill();

  // Border
  ctx.strokeStyle = 'rgba(108,99,255,0.35)';
  ctx.lineWidth   = 0.5;
  ctx.setLineDash([]);
  ctx.stroke();

  // Dashed line swatch
  ctx.strokeStyle = 'rgba(108,99,255,0.8)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(bx + padX, by + boxH / 2);
  ctx.lineTo(bx + padX + lineLen, by + boxH / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Legend text
  ctx.fillStyle = 'rgba(108,99,255,0.9)';
  ctx.fillText(legendText, bx + padX + lineLen + gap, by + boxH / 2 + 3);
}

function sizeAndDrawStatCharts() {
  for (const id of ['spatialChiCanvas', 'angleChiCanvas', 'autocorrCanvas']) {
    const el = document.getElementById(id);
    if (!el) continue;
    const w = el.offsetWidth;
    if (w > 0) el.width = w;
    el.height = 70;
  }
  drawStatCharts();
}

function drawStatCharts() {
  const specs = [
    { id: 'spatialChiCanvas', getHist: key => methodStates[key].spatialChiHistory, yMin: 0,    yMax: 3,   refVal: 1, refLabel: '1' },
    { id: 'angleChiCanvas',   getHist: key => methodStates[key].angleChiHistory,   yMin: 0,    yMax: 3,   refVal: 1, refLabel: '1' },
    { id: 'autocorrCanvas',   getHist: key => methodStates[key].autocorrHistory,   yMin: -0.3, yMax: 0.3, refVal: 0, refLabel: '0' },
  ];
  for (const { id, getHist, yMin, yMax, refVal, refLabel } of specs) {
    const canvas = document.getElementById(id);
    if (!canvas || !canvas.width) continue;
    drawStatChart(canvas, canvas.getContext('2d'), getHist, yMin, yMax, refVal, refLabel);
  }
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
  running = false;
  cancelAnimationFrame(animId);
  resetAllStates();
  btnStart.disabled    = false;
  btnStart.textContent = 'Start';
  btnPause.disabled    = true;
  updateStats();
  drawChart();
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
