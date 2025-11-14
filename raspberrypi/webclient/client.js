const FRAME_SIZE = 3600;
const MAX_BRIGHTNESS = 15;
const PREVIEW_MULTIPLIER = Math.max(1, Math.ceil(255 / MAX_BRIGHTNESS)); // stretch LED brightness to preview RGB range
const LED_COUNT = 1200;
const PIXEL_MAP_URL = "./assets/pixel_map.json";

const elements = {
  wsHost: document.getElementById("ws-host"),
  frameId: document.getElementById("frame-id"),
  interval: document.getElementById("interval"),
  connectBtn: document.getElementById("connect-btn"),
  disconnectBtn: document.getElementById("disconnect-btn"),
  status: document.getElementById("status"),
  colorR: document.getElementById("color-r"),
  colorG: document.getElementById("color-g"),
  colorB: document.getElementById("color-b"),
  brushR: document.getElementById("brush-r"),
  brushG: document.getElementById("brush-g"),
  brushB: document.getElementById("brush-b"),
  brushRadius: document.getElementById("brush-radius"),
  brushRadiusValue: document.getElementById("brush-radius-value"),
  hueCanvas: document.getElementById("hue-canvas"),
  satCanvas: document.getElementById("sat-canvas"),
  valCanvas: document.getElementById("val-canvas"),
  brushPreview: document.getElementById("brush-preview"),
  solidGenerateBtn: document.getElementById("solid-generate-btn"),
  randomGenerateBtn: document.getElementById("random-generate-btn"),
  clearFrameBtn: document.getElementById("clear-frame-btn"),
  sendOnceBtn: document.getElementById("send-once-btn"),
  autoToggleBtn: document.getElementById("auto-toggle-btn"),
  log: document.getElementById("log"),
  clearLogBtn: document.getElementById("clear-log-btn"),
  previewCanvas: document.getElementById("preview-canvas"),
};

const BRIGHTNESS_INPUT_IDS = ["color-r", "color-g", "color-b", "brush-r", "brush-g", "brush-b"];

const state = {
  socket: null,
  autoTimer: null,
  isConnected: false,
  currentFrameId: Number(elements.frameId.value) || 0,
  pixelMap: [],
  previewCtx: null,
  previewScale: 1,
  previewOffset: { x: 0, y: 0 },
  previewLedCoords: [],
  pendingPayload: new Uint8Array(FRAME_SIZE),
  isPainting: false,
  paintingPointerId: null,
  hasEdits: false,
  brushHSV: { h: 200, s: 80, v: 100 },
  brushIndicator: { active: false, x: 0, y: 0 },
  brushRadius: Number(document.getElementById("brush-radius")?.value) || 10,
  logEntries: [],
};

function log(message, level = "info") {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  state.logEntries.push(entry);
  if (state.logEntries.length > 100) state.logEntries.shift();
  elements.log.textContent = state.logEntries.join("\n");
  elements.log.scrollTop = elements.log.scrollHeight;
}

function updateStatus(text) {
  elements.status.textContent = text;
}

function setConnected(isConnected) {
  state.isConnected = isConnected;
  elements.connectBtn.disabled = isConnected;
  elements.disconnectBtn.disabled = !isConnected;
  elements.sendOnceBtn.disabled = !isConnected;
  elements.autoToggleBtn.disabled = !isConnected;
  const hostLabel = elements.wsHost.value || "4b-01.local";
  updateStatus(isConnected ? `接続中 (ws://${hostLabel}:8000)` : "未接続");
  if (!isConnected) {
    stopAutoSend();
  }
}

function connect() {
  const host = (elements.wsHost.value.trim() || "4b-01.local").toLowerCase();
  const url = `ws://${host}:8000/ws/frame`;

  const ws = new WebSocket(url);
  ws.addEventListener("open", () => {
    log(`接続しました: ${url}`);
    setConnected(true);
  });
  ws.addEventListener("message", (event) => {
    log(`受信: ${event.data}`);
  });
  ws.addEventListener("close", () => {
    log("切断されました");
    setConnected(false);
  });
  ws.addEventListener("error", (event) => {
    log(`WebSocket エラー: ${event.message ?? "unknown"}`, "error");
  });

  state.socket = ws;
}

function disconnect() {
  if (state.socket) {
    state.socket.close(1000, "client disconnect");
    state.socket = null;
  }
}

function buildSolidFrame() {
  const buffer = new Uint8Array(FRAME_SIZE);
  const r = clampByte(elements.colorR.value);
  const g = clampByte(elements.colorG.value);
  const b = clampByte(elements.colorB.value);
  for (let i = 0; i < FRAME_SIZE; i += 3) {
    buffer[i] = r;
    buffer[i + 1] = g;
    buffer[i + 2] = b;
  }
  return buffer;
}

function buildRandomFrame() {
  const buffer = new Uint8Array(FRAME_SIZE);
  crypto.getRandomValues(buffer);
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = Math.floor((buffer[i] / 255) * MAX_BRIGHTNESS);
  }
  return buffer;
}

function buildRingPatternFrame() {
  const buffer = new Uint8Array(FRAME_SIZE);
  if (!state.pixelMap.length) return buffer;
  const primary = getSelectedColor();
  const dim = scaleColor(primary, 0.35);
  const maxRadius =
    state.pixelMap.reduce((max, led) => Math.max(max, Math.hypot(led.x, led.y)), 0) || 1;
  const ringCount = 10;
  state.pixelMap.forEach((led, idx) => {
    const ratio = Math.hypot(led.x, led.y) / maxRadius;
    const band = Math.floor(ratio * ringCount) % 2 === 0;
    writeColorToBuffer(buffer, idx, band ? primary : dim);
  });
  return buffer;
}

function buildStripePatternFrame() {
  const buffer = new Uint8Array(FRAME_SIZE);
  if (!state.pixelMap.length) return buffer;
  const primary = getSelectedColor();
  const accent = rotateColor(primary, 120);
  const stripeCount = 8;
  state.pixelMap.forEach((led, idx) => {
    const angle = Math.atan2(led.y, led.x);
    const normalized = (angle + Math.PI) / (2 * Math.PI);
    const stripe = Math.floor(normalized * stripeCount) % 2 === 0;
    const mix = stripe ? primary : accent;
    writeColorToBuffer(buffer, idx, mix);
  });
  return buffer;
}

function clampByte(value) {
  const num = Number(value);
  if (Number.isNaN(num)) {
    return 0;
  }
  return Math.min(MAX_BRIGHTNESS, Math.max(0, Math.floor(num)));
}

function initBrightnessInputs() {
  BRIGHTNESS_INPUT_IDS.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.min = 0;
    input.max = MAX_BRIGHTNESS;
    input.value = String(clampByte(input.value));
  });
}

function encodeBase64(uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function sendFrameOnce() {
  if (!state.isConnected || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
    log("WebSocket が接続されていません", "warn");
    return;
  }
  ensurePendingPayload();
  const payload = state.pendingPayload.slice();
  const frameId = Number(elements.frameId.value) || 0;
  state.currentFrameId = frameId;

  const message = {
    frame_id: frameId,
    data: encodeBase64(payload),
  };
  state.socket.send(JSON.stringify(message));
  log(`送信: frame_id=${frameId}`);
  elements.frameId.value = frameId + 1;
  redrawPreview(state.pendingPayload);
}

function toggleAutoSend() {
  if (state.autoTimer) {
    stopAutoSend();
  } else {
    startAutoSend();
  }
}

function startAutoSend() {
  if (!state.isConnected) {
    log("接続後に開始してください", "warn");
    return;
  }
  const interval = Number(elements.interval.value) || 1000;
  state.autoTimer = setInterval(sendFrameOnce, interval);
  elements.autoToggleBtn.textContent = "自動送信停止";
  log(`自動送信を開始 (間隔 ${interval} ms)`);
}

function stopAutoSend() {
  if (state.autoTimer) {
    clearInterval(state.autoTimer);
    state.autoTimer = null;
    elements.autoToggleBtn.textContent = "自動送信開始";
    log("自動送信を停止");
  }
}

elements.connectBtn.addEventListener("click", connect);
elements.disconnectBtn.addEventListener("click", disconnect);
elements.sendOnceBtn.addEventListener("click", sendFrameOnce);
elements.autoToggleBtn.addEventListener("click", toggleAutoSend);
elements.clearLogBtn.addEventListener("click", () => {
  state.logEntries = [];
  elements.log.textContent = "";
});

elements.solidGenerateBtn.addEventListener("click", () => {
  setPendingPayload(buildSolidFrame());
});

elements.randomGenerateBtn.addEventListener("click", () => {
  setPendingPayload(buildRandomFrame());
});

elements.clearFrameBtn.addEventListener("click", () => {
  setPendingPayload(new Uint8Array(FRAME_SIZE));
});

const previewCanvas = elements.previewCanvas;
if (previewCanvas) {
  previewCanvas.addEventListener("pointerdown", handlePointerDown);
  previewCanvas.addEventListener("pointermove", handlePointerMove);
  previewCanvas.addEventListener("pointerup", handlePointerUp);
  previewCanvas.addEventListener("pointerleave", handlePointerUp);
  previewCanvas.addEventListener("pointercancel", handlePointerUp);
}

initBrightnessInputs();

elements.wsHost.addEventListener("input", () => {
  const value = elements.wsHost.value.trim() || "4b-01.local";
  const display = document.getElementById("ws-host-display");
  if (display) {
    display.textContent = value;
  }
});

[elements.colorR, elements.colorG, elements.colorB].forEach((input) => {
  input.addEventListener("input", () => {
    input.value = String(clampByte(input.value));
  });
});

[elements.brushR, elements.brushG, elements.brushB].forEach((input) => {
  input.addEventListener("input", () => {
    input.value = String(clampByte(input.value));
    updateHSVFromBrush();
  });
});

if (elements.brushRadius) {
  elements.brushRadius.addEventListener("input", () => {
    state.brushRadius = Number(elements.brushRadius.value) || 10;
    if (elements.brushRadiusValue) {
      elements.brushRadiusValue.textContent = String(state.brushRadius);
    }
    redrawPreview(state.pendingPayload);
  });
  if (elements.brushRadiusValue) {
    elements.brushRadiusValue.textContent = elements.brushRadius.value;
  }
}

attachCanvasPicker(elements.hueCanvas, (ratio) => {
  state.brushHSV.h = ratio * 360;
  updateBrushFromHSV();
});
attachCanvasPicker(elements.satCanvas, (ratio) => {
  state.brushHSV.s = ratio * 100;
  updateBrushFromHSV();
});
attachCanvasPicker(elements.valCanvas, (ratio) => {
  state.brushHSV.v = ratio * 100;
  updateBrushFromHSV();
});
initBrushPicker();

async function initPixelMap() {
  try {
    const res = await fetch(PIXEL_MAP_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.pixelMap = data;
    setupPreviewCanvas();
    setPendingPayload(buildSolidFrame(), false);
    log(`pixel_map を読み込みました (LED ${data.length} 個)`);
  } catch (err) {
    log(`pixel_map の読み込みに失敗: ${err}`, "error");
  }
}

function setupPreviewCanvas() {
  const canvas = elements.previewCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  state.previewCtx = ctx;
  state.previewLedCoords = [];

  const xs = state.pixelMap.map((p) => p.x);
  const ys = state.pixelMap.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padding = 30;
  const width = canvas.width;
  const height = canvas.height;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const scaleX = usableWidth / (maxX - minX || 1);
  const scaleY = usableHeight / (maxY - minY || 1);
  state.previewScale = Math.min(scaleX, scaleY);
  const offsetX =
    padding + (usableWidth - (maxX - minX) * state.previewScale) / 2 - minX * state.previewScale;
  const offsetY =
    padding + (usableHeight - (maxY - minY) * state.previewScale) / 2 - minY * state.previewScale;
  state.previewOffset = { x: offsetX, y: offsetY };

  state.previewLedCoords = state.pixelMap.map((led) => {
    const x = led.x * state.previewScale + state.previewOffset.x;
    const y = led.y * state.previewScale + state.previewOffset.y;
    return { x, y };
  });

  redrawPreview(new Uint8Array(FRAME_SIZE));
}

function redrawPreview(payload) {
  if (!state.previewCtx || state.pixelMap.length === 0) return;
  const ctx = state.previewCtx;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const centerX = ctx.canvas.width / 2;
  const centerY = ctx.canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 18;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < state.pixelMap.length; i++) {
    const coord = state.previewLedCoords[i];
    if (!coord) continue;
    const baseIdx = i * 3;
    const rawR = payload[baseIdx] ?? 0;
    const rawG = payload[baseIdx + 1] ?? 0;
    const rawB = payload[baseIdx + 2] ?? 0;
    const r = Math.min(255, rawR * PREVIEW_MULTIPLIER);
    const g = Math.min(255, rawG * PREVIEW_MULTIPLIER);
    const b = Math.min(255, rawB * PREVIEW_MULTIPLIER);
    const isDark = r === 0 && g === 0 && b === 0;
    ctx.fillStyle = isDark ? "rgb(70,70,70)" : `rgb(${r},${g},${b})`;
    const { x, y } = coord;
    ctx.beginPath();
    ctx.arc(x, y, 8.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  if (state.brushIndicator.active) {
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.setLineDash([5, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(state.brushIndicator.x, state.brushIndicator.y, state.brushRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function setPendingPayload(buffer, markEdited = true) {
  state.pendingPayload = buffer;
  state.hasEdits = markEdited;
  redrawPreview(buffer);
}

function ensurePendingPayload() {
  if (!state.pendingPayload) {
    setPendingPayload(buildSolidFrame(), false);
  }
}

function handlePointerDown(event) {
  if (event.pointerType !== "mouse" && event.pointerType !== "pen" && event.pointerType !== "touch") {
    return;
  }
  ensurePendingPayload();
  state.isPainting = true;
  state.paintingPointerId = event.pointerId;
  elements.previewCanvas?.setPointerCapture(event.pointerId);
  state.lastPaintPoint = null;
  paintAtEvent(event);
}

function handlePointerMove(event) {
  if (!state.isPainting || state.paintingPointerId !== event.pointerId) return;
  paintAtEvent(event);
}

function handlePointerUp(event) {
  if (state.paintingPointerId === event.pointerId) {
    state.isPainting = false;
    state.paintingPointerId = null;
    elements.previewCanvas?.releasePointerCapture(event.pointerId);
    state.brushIndicator.active = false;
    state.lastPaintPoint = null;
    redrawPreview(state.pendingPayload);
  }
}

function paintAtEvent(event) {
  const point = getRelativeCanvasPoint(event);
  if (!point) return;
  const { x, y, inside } = point;

  if (!inside) {
    state.brushIndicator.active = false;
    state.lastPaintPoint = null;
    redrawPreview(state.pendingPayload);
    return;
  }

  if (state.brushIndicator.active && state.lastPaintPoint) {
    drawBrushPath(state.lastPaintPoint, point, getSelectedColor());
  }
  state.brushIndicator = { active: true, x, y };
  const applied = applyBrush(x, y, getSelectedColor());
  if (!applied) {
    redrawPreview(state.pendingPayload);
    return;
  }
  state.lastPaintPoint = point;
  redrawPreview(state.pendingPayload);
}

function getRelativeCanvasPoint(event) {
  const canvas = elements.previewCanvas;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  let x = (event.clientX - rect.left) * scaleX;
  let y = (event.clientY - rect.top) * scaleY;
  const inside = x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height;
  x = Math.min(Math.max(x, 0), canvas.width);
  y = Math.min(Math.max(y, 0), canvas.height);
  return { x, y, inside };
}

function findNearestLed(x, y) {
  let bestIndex = null;
  let bestDist = Infinity;
  for (let i = 0; i < state.previewLedCoords.length; i++) {
    const coord = state.previewLedCoords[i];
    if (!coord) continue;
    const dx = coord.x - x;
    const dy = coord.y - y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  const threshold = 18 * 18; // px^2
  return bestDist <= threshold ? bestIndex : null;
}

function getSelectedColor() {
  return {
    r: clampByte(elements.brushR.value),
    g: clampByte(elements.brushG.value),
    b: clampByte(elements.brushB.value),
  };
}

function writeColorToBuffer(buffer, index, color) {
  const base = index * 3;
  buffer[base] = color.r;
  buffer[base + 1] = color.g;
  buffer[base + 2] = color.b;
}

function scaleColor(color, factor) {
  return {
    r: clampByte(Math.round(color.r * factor)),
    g: clampByte(Math.round(color.g * factor)),
    b: clampByte(Math.round(color.b * factor)),
  };
}

function rotateColor(color, degrees) {
  const rgb255 = {
    r: Math.round((color.r / MAX_BRIGHTNESS) * 255),
    g: Math.round((color.g / MAX_BRIGHTNESS) * 255),
    b: Math.round((color.b / MAX_BRIGHTNESS) * 255),
  };
  const hsv = rgbToHsv(rgb255.r, rgb255.g, rgb255.b);
  hsv.h = (hsv.h + degrees) % 360;
  const rotated = hsvToRgb(hsv.h, hsv.s, hsv.v);
  return {
    r: clampByte(Math.round((rotated.r / 255) * MAX_BRIGHTNESS)),
    g: clampByte(Math.round((rotated.g / 255) * MAX_BRIGHTNESS)),
    b: clampByte(Math.round((rotated.b / 255) * MAX_BRIGHTNESS)),
  };
}

function initBrushPicker() {
  updateHSVFromBrush();
  updateBrushFromHSV();
}

function updateBrushFromHSV() {
  const { h, s, v } = state.brushHSV;
  const { r, g, b } = hsvToRgb(h, s, v);
  elements.brushR.value = String(clampByte(Math.round((r / 255) * MAX_BRIGHTNESS)));
  elements.brushG.value = String(clampByte(Math.round((g / 255) * MAX_BRIGHTNESS)));
  elements.brushB.value = String(clampByte(Math.round((b / 255) * MAX_BRIGHTNESS)));
  drawHueCanvas();
  drawSatCanvas();
  drawValCanvas();
  syncBrushPreview();
}

function updateHSVFromBrush() {
  const r = Math.round((Number(elements.brushR.value) || 0) / MAX_BRIGHTNESS * 255);
  const g = Math.round((Number(elements.brushG.value) || 0) / MAX_BRIGHTNESS * 255);
  const b = Math.round((Number(elements.brushB.value) || 0) / MAX_BRIGHTNESS * 255);
  state.brushHSV = rgbToHsv(r, g, b);
  drawHueCanvas();
  drawSatCanvas();
  drawValCanvas();
  syncBrushPreview();
}

function drawHueCanvas() {
  const canvas = elements.hueCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  for (let i = 0; i <= 360; i += 5) {
    const { r, g, b } = hsvToRgb(i, state.brushHSV.s, state.brushHSV.v);
    gradient.addColorStop(i / 360, `rgb(${r},${g},${b})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const x = (state.brushHSV.h / 360) * width;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
}

function drawSatCanvas() {
  const canvas = elements.satCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  for (let i = 0; i <= 100; i += 5) {
    const { r, g, b } = hsvToRgb(state.brushHSV.h, i, state.brushHSV.v);
    gradient.addColorStop(i / 100, `rgb(${r},${g},${b})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const x = (state.brushHSV.s / 100) * width;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
}

function drawValCanvas() {
  const canvas = elements.valCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  for (let i = 0; i <= 100; i += 5) {
    const { r, g, b } = hsvToRgb(state.brushHSV.h, state.brushHSV.s, i);
    gradient.addColorStop(i / 100, `rgb(${r},${g},${b})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const x = (state.brushHSV.v / 100) * width;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
}

function syncBrushPreview() {
  if (!elements.brushPreview) return;
  const r = Math.round((Number(elements.brushR.value) || 0) / MAX_BRIGHTNESS * 255);
  const g = Math.round((Number(elements.brushG.value) || 0) / MAX_BRIGHTNESS * 255);
  const b = Math.round((Number(elements.brushB.value) || 0) / MAX_BRIGHTNESS * 255);
  elements.brushPreview.style.background = `rgb(${r},${g},${b})`;
}

function updateSliderGradients() {
  if (elements.satSlider) {
    const start = hsvToRgb(state.brushHSV.h, 0, state.brushHSV.v);
    const end = hsvToRgb(state.brushHSV.h, 100, state.brushHSV.v);
    elements.satSlider.style.background = `linear-gradient(to right, ${rgbCss(start)}, ${rgbCss(end)})`;
  }
  if (elements.valSlider) {
    const start = hsvToRgb(state.brushHSV.h, state.brushHSV.s, 0);
    const end = hsvToRgb(state.brushHSV.h, state.brushHSV.s, 100);
    elements.valSlider.style.background = `linear-gradient(to right, ${rgbCss(start)}, ${rgbCss(end)})`;
  }
}

function rgbCss({ r, g, b }) {
  return `rgb(${r},${g},${b})`;
}

function attachCanvasPicker(canvas, onSelect) {
  if (!canvas) return;
  const handleEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const ratio = rect.width <= 0 ? 0 : x / rect.width;
    onSelect(ratio);
  };

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    handleEvent(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons !== 1) return;
    handleEvent(event);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
    canvas.addEventListener(type, (event) => {
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    });
  });
}

function hsvToRgb(h, s, v) {
  const sat = s / 100;
  const val = v / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = val - c;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (h >= 0 && h < 60) {
    r1 = c;
    g1 = x;
  } else if (h >= 60 && h < 120) {
    r1 = x;
    g1 = c;
  } else if (h >= 120 && h < 180) {
    g1 = c;
    b1 = x;
  } else if (h >= 180 && h < 240) {
    g1 = x;
    b1 = c;
  } else if (h >= 240 && h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function rgbToHsv(r, g, b) {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rNorm) h = 60 * (((gNorm - bNorm) / delta) % 6);
    else if (max === gNorm) h = 60 * ((bNorm - rNorm) / delta + 2);
    else h = 60 * ((rNorm - gNorm) / delta + 4);
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;

  return { h, s, v };
}

function setLedColor(index, color) {
  ensurePendingPayload();
  if (!state.pendingPayload) return;
  const base = index * 3;
  state.pendingPayload[base] = color.r;
  state.pendingPayload[base + 1] = color.g;
  state.pendingPayload[base + 2] = color.b;
  state.hasEdits = true;
}

function applyBrush(x, y, color) {
  ensurePendingPayload();
  if (!state.pendingPayload) return false;
  const radiusSq = state.brushRadius * state.brushRadius;
  let affected = false;
  for (let i = 0; i < state.previewLedCoords.length; i++) {
    const coord = state.previewLedCoords[i];
    if (!coord) continue;
    const dx = coord.x - x;
    const dy = coord.y - y;
    if (dx * dx + dy * dy <= radiusSq) {
      setLedColor(i, color);
      affected = true;
    }
  }
  return affected;
}

function drawBrushPath(start, end, color) {
  ensurePendingPayload();
  if (!state.pendingPayload) return;
  const steps = Math.ceil(distance(start, end) / (state.brushRadius / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = start.x + (end.x - start.x) * t;
    const y = start.y + (end.y - start.y) * t;
    applyBrush(x, y, color);
  }
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

initPixelMap();
document.getElementById("ring-generate-btn")?.addEventListener("click", () => {
  setPendingPayload(buildRingPatternFrame());
});

document.getElementById("stripe-generate-btn")?.addEventListener("click", () => {
  setPendingPayload(buildStripePatternFrame());
});
