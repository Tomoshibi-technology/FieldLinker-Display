const FRAME_SIZE = 3600;
const LED_COUNT = 1200;
const MAX_BRIGHTNESS = 15;
const PREVIEW_MULTIPLIER = 18;
const PIXEL_MAP_URL = "../webclient/assets/pixel_map.json";

const PANELS = [
  { id: "panelA", label: "Display A", placeholder: "4b-01.local" },
  { id: "panelB", label: "Display B", placeholder: "4b-02.local" },
];

const appState = {
  pixelMap: [],
  panels: {},
  logEntries: [],
};

const sharedControls = {
  frame: document.getElementById("shared-frame"),
  interval: document.getElementById("shared-interval"),
  send: document.getElementById("shared-send"),
  auto: document.getElementById("shared-auto"),
};

const sharedState = {
  autoTimer: null,
};

const previewState = {
  canvas: null,
  ctx: null,
  regions: [],
  brushColor: { r: 5, g: 5, b: 5 },
  brushHSV: { h: 200, s: 90, v: 80 },
  brushRadius: 12,
  isPainting: false,
  pointerId: null,
  emptyPayload: new Uint8Array(FRAME_SIZE),
};

document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => log(`初期化に失敗: ${err}`, "error"));
});

async function init() {
  previewState.canvas = document.getElementById("preview-canvas");
  initBrushControls();
  await loadPixelMap();
  setupPreviewCanvas();
  PANELS.forEach(setupPanel);

  document.getElementById("clear-log").addEventListener("click", () => {
    appState.logEntries = [];
    renderLog();
  });
  sharedControls.send.addEventListener("click", () => sendBothPanels({ increment: true }));
  sharedControls.auto.addEventListener("click", toggleSharedAutoSend);
  updateSharedButtons();
  renderCombinedPreview();
  log("pixel_map.json を読み込みました。Display A/B を接続してください。");
}

async function loadPixelMap() {
  const res = await fetch(PIXEL_MAP_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length !== LED_COUNT) {
    throw new Error(`pixel_map の長さが想定と異なります (${data.length ?? "unknown"})`);
  }
  appState.pixelMap = data;
}

function setupPanel(panel) {
  const elements = {
    host: document.getElementById(`${panel.id}-host`),
    port: document.getElementById(`${panel.id}-port`),
    connect: document.getElementById(`${panel.id}-connect`),
    disconnect: document.getElementById(`${panel.id}-disconnect`),
    solid: document.getElementById(`${panel.id}-solid`),
    random: document.getElementById(`${panel.id}-random`),
    colorR: document.getElementById(`${panel.id}-color-r`),
    colorG: document.getElementById(`${panel.id}-color-g`),
    colorB: document.getElementById(`${panel.id}-color-b`),
    status: document.getElementById(`${panel.id}-status`),
  };

  const region = previewState.regions.find((r) => r.panelId === panel.id);
  const state = {
    id: panel.id,
    label: panel.label,
    placeholder: panel.placeholder,
    socket: null,
    payload: new Uint8Array(FRAME_SIZE),
    coords: region?.coords ?? [],
  };

  elements.host.value = panel.placeholder;
  setupNumericClamp([elements.colorR, elements.colorG, elements.colorB]);
  attachPanelEvents(state, elements);
  appState.panels[panel.id] = { state, elements };
}

function attachPanelEvents(state, elements) {
  elements.connect.addEventListener("click", () => connectPanel(state));
  elements.disconnect.addEventListener("click", () => disconnectPanel(state));
  elements.solid.addEventListener("click", () => {
    setPanelPayload(state, buildSolidFrame(elements));
  });
  elements.random.addEventListener("click", () => {
    setPanelPayload(state, buildRandomFrame());
  });
}

function connectPanel(panelState) {
  if (panelState.socket && panelState.socket.readyState === WebSocket.OPEN) {
    log(`${panelState.label}: 既に接続済みです`, "warn");
    return;
  }
  const { elements } = appState.panels[panelState.id];
  const host = (elements.host.value || panelState.placeholder || "localhost").trim();
  const port = Number(elements.port.value) || 8000;
  const url = host.startsWith("ws://") || host.startsWith("wss://") ? host : `ws://${host}:${port}/ws/frame`;

  const ws = new WebSocket(url);
  ws.addEventListener("open", () => {
    panelState.socket = ws;
    setPanelConnected(panelState, true);
    log(`${panelState.label}: 接続しました (${url})`);
  });
  ws.addEventListener("message", (event) => {
    log(`${panelState.label}: 受信 ${event.data}`);
  });
  ws.addEventListener("close", () => {
    log(`${panelState.label}: 切断されました`);
    setPanelConnected(panelState, false);
  });
  ws.addEventListener("error", (event) => {
    log(`${panelState.label}: WebSocket エラー ${event.message ?? "unknown"}`, "error");
  });
}

function disconnectPanel(panelState) {
  if (panelState.socket) {
    panelState.socket.close(1000, "client disconnect");
    panelState.socket = null;
  }
  setPanelConnected(panelState, false);
}

function setPanelConnected(panelState, connected) {
  const { elements } = appState.panels[panelState.id];
  elements.connect.disabled = connected;
  elements.disconnect.disabled = !connected;
  elements.status.textContent = connected ? "接続中" : "未接続";
  if (!connected && sharedState.autoTimer) {
    stopSharedAutoSend(`${panelState.label}: 切断されたため自動送信を停止しました`);
  }
  updateSharedButtons();
}

function isPanelConnected(panelId) {
  const panel = appState.panels[panelId];
  return Boolean(panel?.state.socket && panel.state.socket.readyState === WebSocket.OPEN);
}

function buildSolidFrame(elements) {
  const r = clampByte(elements.colorR.value);
  const g = clampByte(elements.colorG.value);
  const b = clampByte(elements.colorB.value);
  const buffer = new Uint8Array(FRAME_SIZE);
  for (let i = 0; i < buffer.length; i += 3) {
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

function setPanelPayload(panelState, payload) {
  panelState.payload = payload;
  renderCombinedPreview();
}

function sendBothPanels({ increment }) {
  const frameId = Number(sharedControls.frame.value) || 0;
  let sent = false;
  PANELS.forEach(({ id }) => {
    const panel = appState.panels[id];
    if (!panel) return;
    if (sendFrameToPanel(panel.state, frameId)) sent = true;
  });
  if (increment && sent) {
    sharedControls.frame.value = String(frameId + 1);
  }
}

function sendFrameToPanel(panelState, frameId) {
  const socket = panelState.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    log(`${panelState.label}: WebSocket が接続されていません`, "warn");
    return false;
  }
  const payload = panelState.payload ?? previewState.emptyPayload;
  const message = {
    frame_id: frameId,
    data: encodeBase64(payload),
  };
  socket.send(JSON.stringify(message));
  log(`${panelState.label}: frame_id=${frameId} を送信`);
  return true;
}

function toggleSharedAutoSend() {
  if (sharedState.autoTimer) {
    stopSharedAutoSend();
  } else {
    startSharedAutoSend();
  }
}

function startSharedAutoSend() {
  const allConnected = PANELS.every(({ id }) => isPanelConnected(id));
  if (!allConnected) {
    log("両方のディスプレイを接続してから自動送信を開始してください", "warn");
    return;
  }
  const interval = Math.max(50, Number(sharedControls.interval.value) || 100);
  sharedState.autoTimer = setInterval(() => sendBothPanels({ increment: true }), interval);
  sharedControls.auto.textContent = `両方自動送信停止 (${interval}ms)`;
  sharedControls.send.disabled = true;
  log(`両方自動送信を開始 (${interval}ms)。frame_id は送信ごとに+1します。`);
}

function stopSharedAutoSend(reason) {
  if (sharedState.autoTimer) {
    clearInterval(sharedState.autoTimer);
    sharedState.autoTimer = null;
    sharedControls.auto.textContent = "両方自動送信開始";
    log(reason ?? "両方自動送信を停止");
  }
  updateSharedButtons();
}

function setupPreviewCanvas() {
  const canvas = previewState.canvas;
  if (!canvas || !appState.pixelMap.length) return;
  previewState.ctx = canvas.getContext("2d");

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || canvas.width;
    const cssHeight = rect.height || canvas.height;
    const dpr = window.devicePixelRatio || 1;
    previewState.displayWidth = cssWidth;
    previewState.displayHeight = cssHeight;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    previewState.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    previewState.regions = PANELS.map((panel, index) =>
      createRegionCoords(cssWidth, cssHeight, appState.pixelMap, index, PANELS.length, panel.id),
    );
    PANELS.forEach(({ id }) => {
      const panel = appState.panels[id];
      if (panel) {
        panel.state.coords = previewState.regions.find((region) => region.panelId === id)?.coords ?? [];
      }
    });
    renderCombinedPreview();
  };

  resize();
  window.addEventListener("resize", resize);

  canvas.addEventListener("pointerdown", handlePreviewPointerDown);
  canvas.addEventListener("pointermove", handlePreviewPointerMove);
  ["pointerup", "pointerleave", "pointercancel"].forEach((type) => {
    canvas.addEventListener(type, handlePreviewPointerUp);
  });
}

function createRegionCoords(canvasWidth, canvasHeight, pixelMap, index, total, panelId) {
  const padding = 50;
  const spacing = 40;
  const totalSpacing = spacing * (total + 1);
  const regionWidth = (canvasWidth - totalSpacing) / total;
  const regionHeight = canvasHeight - padding * 2;

  const xs = pixelMap.map((p) => p.x);
  const ys = pixelMap.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scaleX = regionWidth / (maxX - minX || 1);
  const scaleY = regionHeight / (maxY - minY || 1);
  const scale = Math.min(scaleX, scaleY);

  const left = spacing + index * (regionWidth + spacing);
  const offsetX = left + (regionWidth - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = padding + (regionHeight - (maxY - minY) * scale) / 2 - minY * scale;
  const radius = Math.min(regionWidth, regionHeight) / 2 - 5;

  const coords = pixelMap.map((led) => ({
    x: led.x * scale + offsetX,
    y: led.y * scale + offsetY,
  }));

  return {
    panelId,
    coords,
    bounds: { xMin: left, xMax: left + regionWidth },
    center: { x: left + regionWidth / 2, y: canvasHeight / 2 },
    radius,
  };
}

function renderCombinedPreview() {
  const ctx = previewState.ctx;
  if (!ctx) return;
  ctx.clearRect(0, 0, previewState.displayWidth, previewState.displayHeight);
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, previewState.displayWidth, previewState.displayHeight);

  previewState.regions.forEach((region) => {
    const panel = appState.panels[region.panelId];
    const payload = panel?.state.payload ?? previewState.emptyPayload;
    const dotRadius = 5.5;
    region.coords.forEach(({ x, y }, index) => {
      const baseIdx = index * 3;
      const r = payload[baseIdx] ?? 0;
      const g = payload[baseIdx + 1] ?? 0;
      const b = payload[baseIdx + 2] ?? 0;
      ctx.fillStyle = `rgb(${Math.min(255, r * PREVIEW_MULTIPLIER)},${Math.min(255, g * PREVIEW_MULTIPLIER)},${Math.min(
        255,
        b * PREVIEW_MULTIPLIER,
      )})`;
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(region.center.x, region.center.y, region.radius, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function handlePreviewPointerDown(event) {
  if (!previewState.canvas) return;
  previewState.isPainting = true;
  previewState.pointerId = event.pointerId;
  previewState.canvas.setPointerCapture(event.pointerId);
  paintAtEvent(event);
}

function handlePreviewPointerMove(event) {
  if (!previewState.isPainting || previewState.pointerId !== event.pointerId) return;
  paintAtEvent(event);
}

function handlePreviewPointerUp(event) {
  if (previewState.pointerId === event.pointerId) {
    previewState.isPainting = false;
    previewState.pointerId = null;
    previewState.canvas?.releasePointerCapture(event.pointerId);
  }
}

function paintAtEvent(event) {
  const point = getCanvasPoint(event);
  if (!point) return;
  const region = previewState.regions.find((r) => point.x >= r.bounds.xMin && point.x <= r.bounds.xMax);
  if (!region) return;
  const panel = appState.panels[region.panelId];
  if (!panel) return;
  const applied = applyBrush(panel.state, point.x, point.y, previewState.brushColor);
  if (applied) renderCombinedPreview();
}

function getCanvasPoint(event) {
  const canvas = previewState.canvas;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * previewState.displayWidth;
  const y = ((event.clientY - rect.top) / rect.height) * previewState.displayHeight;
  return { x, y };
}

function applyBrush(panelState, x, y, color) {
  ensurePayload(panelState);
  const coords = panelState.coords || [];
  const payload = panelState.payload;
  const radiusSq = previewState.brushRadius * previewState.brushRadius;
  let affected = false;
  coords.forEach((coord, idx) => {
    const dx = coord.x - x;
    const dy = coord.y - y;
    if (dx * dx + dy * dy <= radiusSq) {
      const base = idx * 3;
      payload[base] = color.r;
      payload[base + 1] = color.g;
      payload[base + 2] = color.b;
      affected = true;
    }
  });
  return affected;
}

function ensurePayload(panelState) {
  if (!panelState.payload || panelState.payload.length !== FRAME_SIZE) {
    panelState.payload = new Uint8Array(FRAME_SIZE);
  }
}

function initBrushControls() {
  const hue = document.getElementById("brush-h");
  const sat = document.getElementById("brush-s");
  const val = document.getElementById("brush-v");
  const radius = document.getElementById("brush-radius");
  const radiusValue = document.getElementById("brush-radius-value");

  const updateBrush = () => {
    previewState.brushHSV = {
      h: Number(hue.value) || 0,
      s: Number(sat.value) || 0,
      v: Number(val.value) || 0,
    };
    const rgb = hsvToRgb255(previewState.brushHSV.h, previewState.brushHSV.s, previewState.brushHSV.v);
    previewState.brushColor = {
      r: clampByte(Math.round((rgb.r / 255) * MAX_BRIGHTNESS)),
      g: clampByte(Math.round((rgb.g / 255) * MAX_BRIGHTNESS)),
      b: clampByte(Math.round((rgb.b / 255) * MAX_BRIGHTNESS)),
    };
    updateBrushSliderBackgrounds({ hue, sat, val });
    updateSliderValueLabel("brush-h", `${previewState.brushHSV.h}°`);
    updateSliderValueLabel("brush-s", `${previewState.brushHSV.s}%`);
    updateSliderValueLabel("brush-v", `${previewState.brushHSV.v}%`);
  };

  [hue, sat, val].forEach((slider) => slider.addEventListener("input", updateBrush));
  updateBrush();

  const updateRadius = () => {
    const value = Math.max(2, Number(radius.value) || 12);
    previewState.brushRadius = value;
    if (radiusValue) radiusValue.textContent = String(value);
  };
  radius.addEventListener("input", updateRadius);
  updateRadius();
}

function updateBrushSliderBackgrounds({ hue, sat, val }) {
  hue.style.background = `
    linear-gradient(
      to right,
      #ff0000,
      #ffff00,
      #00ff00,
      #00ffff,
      #0000ff,
      #ff00ff,
      #ff0000
    )
  `;
  const left = hsvToCss(previewState.brushHSV.h, 0, previewState.brushHSV.v);
  const right = hsvToCss(previewState.brushHSV.h, 100, previewState.brushHSV.v);
  sat.style.background = `linear-gradient(to right, ${left}, ${right})`;
  const dark = hsvToCss(previewState.brushHSV.h, previewState.brushHSV.s, 0);
  const bright = hsvToCss(previewState.brushHSV.h, previewState.brushHSV.s, 100);
  val.style.background = `linear-gradient(to right, ${dark}, ${bright})`;
}

function hsvToRgb255(h, s, v) {
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

function hsvToCss(h, s, v) {
  const { r, g, b } = hsvToRgb255(h, s, v);
  return `rgb(${r},${g},${b})`;
}

function updateSliderValueLabel(id, text) {
  const label = document.querySelector(`[data-slider-value="${id}"]`);
  if (label) label.textContent = text;
}

function setupNumericClamp(inputs, onChange) {
  inputs.forEach((input) => {
    const valueLabel = document.querySelector(`[data-slider-value="${input.id}"]`);
    const update = () => {
      const value = clampByte(input.value);
      input.value = String(value);
      if (valueLabel) valueLabel.textContent = String(value);
      if (onChange) onChange();
    };
    input.addEventListener("input", update);
    update();
  });
}

function updateSharedButtons() {
  const connectedCount = PANELS.filter(({ id }) => isPanelConnected(id)).length;
  if (!sharedState.autoTimer) {
    sharedControls.send.disabled = connectedCount === 0;
  }
  sharedControls.auto.disabled = connectedCount < PANELS.length;
}

function clampByte(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.min(MAX_BRIGHTNESS, Math.max(0, Math.floor(num)));
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

function log(message, level = "info") {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  appState.logEntries.push(entry);
  if (appState.logEntries.length > 200) {
    appState.logEntries.shift();
  }
  renderLog();
}

function renderLog() {
  const el = document.getElementById("log");
  el.textContent = appState.logEntries.join("\n");
  el.scrollTop = el.scrollHeight;
}
