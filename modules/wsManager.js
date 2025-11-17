// modules/wsManager.js

import WaveSurfer from './wavesurfer.esm.js';
import Spectrogram from './spectrogram.esm.js';
import SpectrogramFlash from './spectrogram-flash.esm.js';

let ws = null;
let plugin = null;
let currentColorMap = null;
let currentFftSize = 1024;
let currentWindowType = 'hann';

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

export function createSpectrogramFlashPlugin({
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

  return SpectrogramFlash.create(baseOptions);
}

export function replacePlugin(
  colorMap,
  height = 800,
  frequencyMin = 10,
  frequencyMax = 128,
  overlapPercent = null,
  onRendered = null,  // ✅ 傳入 callback
  fftSamples = currentFftSize,
  windowFunc = currentWindowType,
  useFlash = false
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

  // Choose the optimized 'flash' plugin for lower overlap percentages when requested
  if (useFlash) {
    plugin = createSpectrogramFlashPlugin({
      colorMap,
      height,
      frequencyMin,
      frequencyMax,
      fftSamples,
      noverlap,
      windowFunc,
    });
    // mark which plugin type we created for consumers to check
    plugin.isFlashPlugin = true;
  } else {
    plugin = createSpectrogramPlugin({
      colorMap,
      height,
      frequencyMin,
      frequencyMax,
      fftSamples,
      noverlap,
      windowFunc,
    });
    plugin.isFlashPlugin = false;
  }
  

  ws.registerPlugin(plugin);

  try {
    plugin.render();
    // Ensure outer viewer container keeps overflow-x available so the
    // scrollbar remains when using the flash plugin in auto overlap mode.
    const outerViewer = document.getElementById('viewer-container');
    if (outerViewer) {
      outerViewer.style.overflowX = 'auto';
    }
    requestAnimationFrame(() => {
      if (typeof onRendered === 'function') onRendered();
    });
    // Re-bind ws scroll sync after plugin replacement so the time-axis
    // keeps in sync with the active plugin's internal scroll container.
    try {
      initWsScrollSync({ scrollTargetId: 'time-axis-wrapper' });
    } catch (e) {
      // initWsScrollSync may not be available if the module is loaded
      // differently — swallow failures gracefully.
    }
  } catch (err) {
    console.warn('⚠️ Spectrogram render failed:', err);
  }
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

// Sync time axis to Wavesurfer's scroll events. Use wavesurfer's "scroll"
// event so it works regardless of which scrollable element (outer viewer or
// plugin internal scroll container) receives the scroll.
export function initWsScrollSync({ scrollTargetId }) {
  const target = document.getElementById(scrollTargetId);
  if (!target) {
    console.warn('[wsScrollSync] target not found.');
    return;
  }
  if (!ws) {
    console.warn('[wsScrollSync] wavesurfer not initialized yet.');
    return;
  }

  // Remove any previously bound handlers to avoid duplicates
  if (ws._timeAxisSyncCleanup) {
    try { ws._timeAxisSyncCleanup(); } catch (e) { /* noop */ }
    ws._timeAxisSyncCleanup = null;
  }

  const unsubscribe = ws.on('scroll', (startPct, endPct, scrollLeft) => {
    // scrollLeft is the pixel offset; set scrollLeft of the target element.
    // Guard for missing scrollLeft values.
    if (typeof scrollLeft === 'number') {
      target.scrollLeft = scrollLeft;
    }
  });

  // Keep unsubscribe reference on ws so we can clear it when swapping plugins
  ws._timeAxisSyncCleanup = unsubscribe;

  // Initialize the time-axis scroll position from the current wavesurfer
  try {
    if (typeof ws.getScroll === 'function') target.scrollLeft = ws.getScroll();
  } catch (e) {
    // ignore - not critical
  }
}
