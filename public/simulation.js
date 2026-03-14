'use strict';

// ── Canvas setup ──────────────────────────────────────────────────────────────
const simCanvas  = document.getElementById('simCanvas');
const chartCanvas = document.getElementById('chartCanvas');
const simCtx     = simCanvas.getContext('2d');
const chartCtx   = chartCanvas.getContext('2d');

let numStrips    = 6;
let LINE_SPACING = 60; // pixels between floor lines (derived from numStrips)
const MAX_NEEDLES  = 50000;
const CHART_POINTS = 200; // samples stored for convergence chart

// ── State ─────────────────────────────────────────────────────────────────────
let drops      = 0;
let crossings  = 0;
let needles    = [];        // { x1,y1,x2,y2, crosses }
let piHistory  = [];        // sampled π estimates for chart
let running    = false;
let animId     = null;
let lastSample = 0;

// Settings (updated from controls)
let needleRatio = 0.8;      // L = needleRatio * LINE_SPACING
let dropsPerFrame = 5;      // controlled by speed slider

// ── Generation method ─────────────────────────────────────────────────────────
let generationMethod = 'uniform';
let haltonIndex = 0;
let stripCounts = [];

function halton(index, base) {
  let result = 0, f = 1;
  while (index > 0) { f /= base; result += f * (index % base); index = Math.floor(index / base); }
  return result;
}

// ── Speed map ─────────────────────────────────────────────────────────────────
const SPEED_MAP = {
  1: { dpf: 1,    label: 'Slow'    },
  2: { dpf: 3,    label: 'Medium–' },
  3: { dpf: 10,   label: 'Medium'  },
  4: { dpf: 50,   label: 'Fast'    },
  5: { dpf: 300,  label: 'Turbo'   },
};

// ── Resize canvas to fill its container ───────────────────────────────────────
function resizeCanvases() {
  const section = simCanvas.parentElement;
  const size    = Math.min(section.clientWidth, section.clientHeight) - 32;
  simCanvas.width  = size;
  simCanvas.height = size;
  LINE_SPACING = size / numStrips;

  const chartSection = chartCanvas.parentElement;
  chartCanvas.width  = chartSection.clientWidth - 40;
  chartCanvas.height = 100;

  drawFloor();
  redrawNeedles();
  drawChart();
}

// ── Floor lines ───────────────────────────────────────────────────────────────
function drawFloor() {
  const { width, height } = simCanvas;
  simCtx.clearRect(0, 0, width, height);
  simCtx.strokeStyle = '#2a2d3e';
  simCtx.lineWidth   = 1;
  for (let y = LINE_SPACING; y < height; y += LINE_SPACING) {
    simCtx.beginPath();
    simCtx.moveTo(0, y);
    simCtx.lineTo(width, y);
    simCtx.stroke();
  }
}

// ── Redraw all stored needles ─────────────────────────────────────────────────
function redrawNeedles() {
  for (const n of needles) drawNeedle(n);
}

function drawNeedle({ x1, y1, x2, y2, crosses }) {
  simCtx.strokeStyle = crosses ? 'rgba(255,101,132,0.55)' : 'rgba(99,179,237,0.45)';
  simCtx.lineWidth   = 1.5;
  simCtx.beginPath();
  simCtx.moveTo(x1, y1);
  simCtx.lineTo(x2, y2);
  simCtx.stroke();
}

// ── Drop one needle ───────────────────────────────────────────────────────────
function dropNeedle() {
  const L     = needleRatio * LINE_SPACING;
  const { width, height } = simCanvas;
  let cx, cy, theta;

  if (generationMethod === 'stratified') {
    const strip = Math.floor(Math.random() * numStrips);
    stripCounts[strip] = (stripCounts[strip] || 0) + 1;
    cy    = (strip + Math.random()) * LINE_SPACING;
    cx    = Math.random() * width;
    theta = Math.random() * Math.PI;
  } else if (generationMethod === 'halton') {
    cx    = halton(haltonIndex, 2) * width;
    cy    = halton(haltonIndex, 3) * height;
    theta = halton(haltonIndex, 5) * Math.PI;
    haltonIndex++;
  } else {
    cx    = Math.random() * width;
    cy    = Math.random() * height;
    theta = Math.random() * Math.PI;
  }

  const dx = (L / 2) * Math.cos(theta);
  const dy = (L / 2) * Math.sin(theta);

  const x1 = cx - dx, y1 = cy - dy;
  const x2 = cx + dx, y2 = cy + dy;

  // Distance from center to nearest line (below or above)
  const distToLine = cy % LINE_SPACING;
  const minDist    = Math.min(distToLine, LINE_SPACING - distToLine);
  const crosses    = (L / 2) * Math.abs(Math.sin(theta)) >= minDist;

  drops++;
  if (crosses) crossings++;

  const needle = { x1, y1, x2, y2, crosses };
  if (needles.length < MAX_NEEDLES) needles.push(needle);
  drawNeedle(needle);
}

// ── π estimate ────────────────────────────────────────────────────────────────
function estimatePi() {
  if (crossings === 0) return null;
  const L = needleRatio * LINE_SPACING;
  return (2 * L * drops) / (LINE_SPACING * crossings);
}

// ── Stats update ──────────────────────────────────────────────────────────────
const elDrops    = document.getElementById('statDrops');
const elCrossings = document.getElementById('statCrossings');
const elPi       = document.getElementById('statPi');
const elError    = document.getElementById('statError');

function updateStats() {
  elDrops.textContent    = drops.toLocaleString();
  elCrossings.textContent = crossings.toLocaleString();

  const est = estimatePi();
  if (est === null) {
    elPi.textContent    = '—';
    elError.textContent = '—';
  } else {
    elPi.textContent    = est.toFixed(6);
    const err = Math.abs(est - Math.PI) / Math.PI * 100;
    elError.textContent = err.toFixed(3) + '%';
  }

  updateMethodInfo();
}

// ── Generation info panel ─────────────────────────────────────────────────────
const METHOD_DESCS = {
  uniform:    'Needle position and angle drawn independently from uniform distributions — the classic Buffon setup.',
  stratified: 'Y-position sampled uniformly within each floor strip, guaranteeing balanced vertical coverage and reducing crossing-rate variance.',
  halton:     'Low-discrepancy quasi-random sequence (bases 2, 3, 5) fills the canvas more evenly than pseudorandom numbers, accelerating convergence.',
};

const elGenDesc  = document.getElementById('genMethodDesc');
const elGenStats = document.getElementById('genMethodStats');

function statRow(label, value) {
  return `<div class="gen-stat-row"><span>${label}</span><span class="gen-stat-val">${value}</span></div>`;
}

function updateMethodInfo() {
  elGenDesc.textContent = METHOD_DESCS[generationMethod];

  const L = needleRatio * LINE_SPACING;
  const expectedRate = (2 * L) / (Math.PI * LINE_SPACING);
  const actualRate   = drops > 0 ? crossings / drops : 0;

  if (generationMethod === 'uniform' || generationMethod === 'halton') {
    let html = statRow('Crossing rate (actual)', drops > 0 ? actualRate.toFixed(4) : '—');
    html    += statRow('Crossing rate (expected)', expectedRate.toFixed(4));
    if (generationMethod === 'halton') {
      html += statRow('Sequence index', haltonIndex.toLocaleString());
    }
    elGenStats.innerHTML = html;

  } else if (generationMethod === 'stratified') {
    const counts  = stripCounts.slice(0, numStrips);
    const total   = counts.reduce((a, b) => a + b, 0);
    const mean    = total / numStrips || 0;
    const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / numStrips;
    const stdDev  = Math.sqrt(variance);

    // Mini bar chart
    const maxCount = Math.max(...counts, 1);
    const bars = counts.map(c => {
      const pct = Math.round((c / maxCount) * 100);
      return `<div class="strip-bar" style="height:${pct}%" title="${c} drops"></div>`;
    }).join('');

    let html  = statRow('Strip std dev', mean > 0 ? ((stdDev / mean * 100).toFixed(1) + '% of mean') : '—');
    html     += statRow('Crossing rate (actual)', drops > 0 ? actualRate.toFixed(4) : '—');
    html     += `<div class="strip-bars">${bars}</div>`;
    elGenStats.innerHTML = html;
  }
}

// ── Chart zoom ────────────────────────────────────────────────────────────────
const ZOOM_LEVELS = [1.5, 0.5, 0.1, 0.02];
let zoomIndex = 0;

// ── Convergence chart ─────────────────────────────────────────────────────────
function sampleChart() {
  const est = estimatePi();
  if (est !== null) {
    piHistory.push(est);
    if (piHistory.length > CHART_POINTS) piHistory.shift();
  }
}

function drawChart() {
  const { width, height } = chartCanvas;
  chartCtx.clearRect(0, 0, width, height);

  if (piHistory.length < 2) return;

  // y range: π ± zoom
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

  // Convergence line
  chartCtx.strokeStyle = '#6c63ff';
  chartCtx.lineWidth   = 1.5;
  chartCtx.beginPath();
  const step = width / (CHART_POINTS - 1);
  piHistory.forEach((v, i) => {
    const x = i * step;
    const y = toY(Math.max(yMin, Math.min(yMax, v)));
    i === 0 ? chartCtx.moveTo(x, y) : chartCtx.lineTo(x, y);
  });
  chartCtx.stroke();

  // π label
  chartCtx.fillStyle = 'rgba(108,99,255,0.7)';
  chartCtx.font      = '10px monospace';
  chartCtx.fillText('π', 4, pyRef - 3);
}

// ── Animation loop ────────────────────────────────────────────────────────────
function step() {
  if (!running) return;

  for (let i = 0; i < dropsPerFrame; i++) dropNeedle();

  // Sample chart every ~200 drops
  if (drops - lastSample >= 200) {
    sampleChart();
    drawChart();
    lastSample = drops;
  }

  updateStats();
  animId = requestAnimationFrame(step);
}

// ── Controls ──────────────────────────────────────────────────────────────────
const btnStart    = document.getElementById('btnStart');
const btnPause    = document.getElementById('btnPause');
const btnReset    = document.getElementById('btnReset');
const sliderLen   = document.getElementById('needleLen');
const sliderSpd   = document.getElementById('speed');
const sliderStrips = document.getElementById('strips');
const labelLen    = document.getElementById('needleLenLabel');
const labelSpd    = document.getElementById('speedLabel');
const labelStrips = document.getElementById('stripsLabel');

const btnZoom = document.getElementById('btnZoom');
btnZoom.addEventListener('click', () => {
  zoomIndex = (zoomIndex + 1) % ZOOM_LEVELS.length;
  btnZoom.textContent = '±' + ZOOM_LEVELS[zoomIndex];
  drawChart();
});

sliderLen.addEventListener('input', () => {
  needleRatio = parseFloat(sliderLen.value);
  labelLen.textContent = needleRatio.toFixed(2) + '× spacing';
});

sliderStrips.addEventListener('input', () => {
  numStrips = parseInt(sliderStrips.value);
  labelStrips.textContent = numStrips;
  LINE_SPACING = simCanvas.height / numStrips;
  // Reset: existing crossings are based on old spacing
  running = false;
  cancelAnimationFrame(animId);
  drops = 0; crossings = 0; needles = []; piHistory = []; lastSample = 0;
  haltonIndex = 0; stripCounts = new Array(numStrips).fill(0);
  btnStart.disabled = false;
  btnStart.textContent = 'Start';
  btnPause.disabled = true;
  drawFloor();
  updateStats();
  drawChart();
});

sliderSpd.addEventListener('input', () => {
  const s = parseInt(sliderSpd.value);
  dropsPerFrame = SPEED_MAP[s].dpf;
  labelSpd.textContent = SPEED_MAP[s].label;
});

btnStart.addEventListener('click', () => {
  running = true;
  btnStart.disabled = true;
  btnPause.disabled = false;
  animId = requestAnimationFrame(step);
});

btnPause.addEventListener('click', () => {
  running = false;
  cancelAnimationFrame(animId);
  btnStart.disabled = false;
  btnPause.disabled = true;
  btnStart.textContent = 'Resume';
});

btnReset.addEventListener('click', () => {
  running = false;
  cancelAnimationFrame(animId);
  drops     = 0;
  crossings = 0;
  needles   = [];
  piHistory = [];
  lastSample = 0;
  haltonIndex = 0;
  stripCounts = new Array(numStrips).fill(0);
  btnStart.disabled = false;
  btnStart.textContent = 'Start';
  btnPause.disabled = true;
  drawFloor();
  updateStats();
  drawChart();
});

const selectMethod = document.getElementById('genMethod');
selectMethod.addEventListener('change', () => {
  generationMethod = selectMethod.value;
  btnReset.click();
});

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('resize', resizeCanvases);
resizeCanvases();
updateStats();

// Set initial label values
stripCounts = new Array(numStrips).fill(0);
needleRatio = parseFloat(sliderLen.value);
labelLen.textContent = needleRatio.toFixed(2) + '× spacing';
const initSpeed = parseInt(sliderSpd.value);
dropsPerFrame = SPEED_MAP[initSpeed].dpf;
labelSpd.textContent = SPEED_MAP[initSpeed].label;
numStrips = parseInt(sliderStrips.value);
labelStrips.textContent = numStrips;
