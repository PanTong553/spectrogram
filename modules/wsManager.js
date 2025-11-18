// modules/wsManager.js

import WaveSurfer from './wavesurfer.esm.js';
import Spectrogram from './spectrogram.esm.js';

let ws = null;
let plugin = null;
let currentColorMap = null;
let currentFftSize = 1024;
let currentWindowType = 'hann';
// pre-render cache: key -> OffscreenCanvas or HTMLCanvasElement
const _preRenderCache = new Map();
let _preRenderAudioCtx = null;

function _getAudioCtx() {
  try {
    if (!_preRenderAudioCtx) _preRenderAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _preRenderAudioCtx;
  } catch (err) {
    return null;
  }
}

export function initWavesurfer({
  container,
  url,
  sampleRate = 256000,
}) {
  ws = WaveSurfer.create({
    container,
    height: 0,
    interact: false,
    cursorWidth: 0,
    url,
    sampleRate,
  });

  return ws;
}

export function createSpectrogramPlugin({
  colorMap,
  height = 800,
  frequencyMin = 10,
  frequencyMax = 128,
  fftSamples = 1024,
  noverlap = null,
  windowFunc = 'hann',
}) {
  const baseOptions = {
    labels: false,
    height,
    fftSamples,
    frequencyMin: frequencyMin * 1000,
    frequencyMax: frequencyMax * 1000,
    scale: 'linear',
    windowFunc,
    colorMap,
  };

  if (noverlap !== null) {
    baseOptions.noverlap = noverlap;
  }

  return Spectrogram.create(baseOptions);
}

export function replacePlugin(
  colorMap,
  height = 800,
  frequencyMin = 10,
  frequencyMax = 128,
  overlapPercent = null,
  onRendered = null,  // ✅ 傳入 callback
  fftSamples = currentFftSize,
  windowFunc = currentWindowType
) {
  if (!ws) throw new Error('Wavesurfer not initialized.');
  const container = document.getElementById("spectrogram-only");

  // ✅ 改進：完全清理舊 plugin 和 canvas
  const oldCanvas = container.querySelector("canvas");
  if (oldCanvas) {
    oldCanvas.remove();
  }

  if (plugin?.destroy) {
    plugin.destroy();
    plugin = null;  // ✅ 確保 plugin 引用被清空
  }

  // ✅ 強制重新設置 container 寬度為預設值（避免殘留的大尺寸）
  container.style.width = '100%';

  currentColorMap = colorMap;

  currentFftSize = fftSamples;
  currentWindowType = windowFunc;
  const noverlap = overlapPercent !== null
    ? Math.floor(fftSamples * (overlapPercent / 100))
    : null;

  plugin = createSpectrogramPlugin({
    colorMap,
    height,
    frequencyMin,
    frequencyMax,
    fftSamples,
    noverlap,
    windowFunc,
  });

  ws.registerPlugin(plugin);

  try {
    plugin.render();
    requestAnimationFrame(() => {
      if (typeof onRendered === 'function') onRendered();
    });
  } catch (err) {
    console.warn('⚠️ Spectrogram render failed:', err);
  }
}

// key builder for cache: use filename + fft + window type
function _cacheKeyForFile(file) {
  if (!file) return null;
  const name = file.name || file;
  return `${name}:${currentFftSize}:${currentWindowType}`;
}

// Pre-render a file's spectrogram in background. Accepts a File object or URL string.
export async function preRenderSpectrogram(fileOrUrl, widthOverride) {
  try {
    // if already cached, skip
    const key = _cacheKeyForFile(fileOrUrl instanceof File ? fileOrUrl : { name: fileOrUrl });
    if (!key) return null;
    if (_preRenderCache.has(key)) return _preRenderCache.get(key);

    // obtain audio data
    let arrayBuffer;
    if (fileOrUrl instanceof File) {
      arrayBuffer = await fileOrUrl.arrayBuffer();
    } else if (typeof fileOrUrl === 'string') {
      const res = await fetch(fileOrUrl);
      arrayBuffer = await res.arrayBuffer();
    } else return null;

    const audioCtx = _getAudioCtx();
    if (!audioCtx) return null;
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

    // create spectrogram instance with current settings (minimal UI)
    const baseOptions = {
      labels: false,
      height: plugin?.options?.height || 200,
      fftSamples: currentFftSize,
      frequencyMin: (plugin?.options?.frequencyMin) || 0,
      frequencyMax: (plugin?.options?.frequencyMax) || decoded.sampleRate / 2,
      scale: plugin?.options?.scale || 'linear',
      windowFunc: currentWindowType,
      colorMap: currentColorMap || plugin?.options?.colorMap,
    };

    const spec = Spectrogram.create(baseOptions);

    // create offscreen canvas (or fallback to element canvas)
    const container = document.getElementById('spectrogram-only');
    const width = widthOverride || (container ? container.clientWidth : 1024);
    let off;
    if (typeof OffscreenCanvas !== 'undefined') {
      off = new OffscreenCanvas(width, baseOptions.height);
    } else {
      off = document.createElement('canvas');
      off.width = width;
      off.height = baseOptions.height;
    }

    // attach offscreen canvas and dummy wavesurfer wrapper for width queries
    spec.canvas = off;
    spec.spectrCc = off.getContext('2d');
    spec.wavesurfer = { getWrapper: () => ({ offsetWidth: width }) };
    spec.buffer = decoded;

    // compute frequencies and render to offscreen canvas
    const freqs = spec.getFrequencies(decoded);
    await spec.renderFrequenciesToCanvas(freqs);

    _preRenderCache.set(key, off);
    return off;
  } catch (err) {
    console.warn('preRenderSpectrogram failed', err);
    return null;
  }
}

// If a pre-render exists for the given file, apply it to the active plugin canvas.
export function applyPreRenderedIfExists(fileOrUrl) {
  const key = _cacheKeyForFile(fileOrUrl instanceof File ? fileOrUrl : { name: fileOrUrl });
  if (!key) return false;
  const pre = _preRenderCache.get(key);
  if (!pre) return false;
  if (!plugin) return false;
  try {
    // plugin should have applyPreRenderedCanvas method we added
    if (typeof plugin.applyPreRenderedCanvas === 'function') {
      return plugin.applyPreRenderedCanvas(pre);
    }
    // fallback: draw onto plugin canvas context
    const ctx = plugin.spectrCc;
    if (ctx) {
      plugin.canvas.width = pre.width;
      plugin.canvas.height = pre.height;
      ctx.clearRect(0, 0, pre.width, pre.height);
      ctx.drawImage(pre, 0, 0);
      plugin.emit('ready');
      return true;
    }
  } catch (err) {
    return false;
  }
  return false;
}

export function getWavesurfer() {
  return ws;
}

export function getPlugin() {
  return plugin;
}

export function getCurrentColorMap() {
  return currentColorMap;
}

export function getCurrentFftSize() {
  return currentFftSize;
}

export function getCurrentWindowType() {
  return currentWindowType;
}

export function initScrollSync({
  scrollSourceId,
  scrollTargetId,
}) {
  const source = document.getElementById(scrollSourceId);
  const target = document.getElementById(scrollTargetId);

  if (!source || !target) {
    console.warn(`[scrollSync] One or both elements not found.`);
    return;
  }

  source.addEventListener('scroll', () => {
    target.scrollLeft = source.scrollLeft;
  });
}
