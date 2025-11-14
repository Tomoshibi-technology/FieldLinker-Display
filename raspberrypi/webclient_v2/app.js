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

document.addEventListener("DOMContentLoaded", async () => {
  await init();
});

async function init() {
  try {
    await loadPixelMap();
    PANELS.forEach(setupPanel);
    document.getElementById("clear-log").addEventListener("click", () => {
      appState.logEntries = [];
      renderLog();
    });
    sharedControls.send.addEventListener("click", () => sendBothPanels({ increment: true }));
    sharedControls.auto.addEventListener("click", toggleSharedAutoSend);
    updateSharedButtons();
    log("pixel_map.json を読み込みました。Display A/B を接続してください。");
  } catch (error) {
    log(`pixel_map.json の読み込みに失敗: ${error}`, "error");
  }
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
    canvas: document.getElementById(`${panel.id}-canvas`),
  };

  const state = {
    id: panel.id,
    label: panel.label,
    placeholder: panel.placeholder,
    socket: null,
    payload: new Uint8Array(FRAME_SIZE),
    ctx: null,
    coords: [],
  };

  elements.host.value = panel.placeholder;
  setupNumericClamp([elements.colorR, elements.colorG, elements.colorB]);
  setupCanvas(state, elements.canvas);
  attachPanelEvents(state, elements);
  appState.panels[panel.id] = { state, elements };
  drawPreview(state);
}

function setupNumericClamp(inputs) {
  inputs.forEach((input) => {
    input.addEventListener("input", () => {
      const value = clampByte(input.value);
      input.value = String(value);
    });
  });
}

function setupCanvas(state, canvas) {
  const ctx = canvas.getContext("2d");
  state.ctx = ctx;
  state.coords = createCanvasCoords(canvas, appState.pixelMap);
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
  drawPreview(panelState);
}

function sendBothPanels({ increment }) {
  const frameId = Number(sharedControls.frame.value) || 0;
  let sent = false;
  PANELS.forEach(({ id }) => {
    const panel = appState.panels[id];
    if (!panel) return;
    if (sendFrameToPanel(panel.state, frameId)) {
      sent = true;
    }
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
  const payload = panelState.payload ?? new Uint8Array(FRAME_SIZE);
  const message = {
    frame_id: frameId,
    data: encodeBase64(payload),
  };
  socket.send(JSON.stringify(message));
  log(`${panelState.label}: frame_id=${frameId} を送信`);
  drawPreview(panelState);
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

function drawPreview(panelState) {
  const ctx = panelState.ctx;
  if (!ctx || !panelState.coords.length) return;
  const payload = panelState.payload ?? new Uint8Array(FRAME_SIZE);
  const { canvas } = ctx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  panelState.coords.forEach(({ x, y }, index) => {
    const baseIdx = index * 3;
    const r = payload[baseIdx] ?? 0;
    const g = payload[baseIdx + 1] ?? 0;
    const b = payload[baseIdx + 2] ?? 0;
    const color = `rgb(${Math.min(255, r * PREVIEW_MULTIPLIER)},${Math.min(255, g * PREVIEW_MULTIPLIER)},${Math.min(
      255,
      b * PREVIEW_MULTIPLIER,
    )})`;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  const radius = Math.min(canvas.width, canvas.height) / 2 - 20;
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function createCanvasCoords(canvas, pixelMap) {
  const padding = 30;
  const xs = pixelMap.map((p) => p.x);
  const ys = pixelMap.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const usableWidth = canvas.width - padding * 2;
  const usableHeight = canvas.height - padding * 2;
  const scaleX = usableWidth / (maxX - minX || 1);
  const scaleY = usableHeight / (maxY - minY || 1);
  const scale = Math.min(scaleX, scaleY);
  const offsetX = padding + (usableWidth - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = padding + (usableHeight - (maxY - minY) * scale) / 2 - minY * scale;

  return pixelMap.map((led) => ({
    x: led.x * scale + offsetX,
    y: led.y * scale + offsetY,
  }));
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
