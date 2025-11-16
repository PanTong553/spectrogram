// modules/wsManager.js

import WaveSurfer from './wavesurfer.esm.js';
import SpectrogramDefault from './spectrogram.esm.js';
import SpectrogramOptimized from './spectrogram-optimized.esm.js';

let ws = null;
let plugin = null;
let currentColorMap = null;
let currentFftSize = 1024;
let currentWindowType = 'hann';
let currentSpectrogram = SpectrogramOptimized; // 默認使用優化版本

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

export function setSpectrogramModule(useOptimized = false) {
  currentSpectrogram = useOptimized ? SpectrogramOptimized : SpectrogramDefault;
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

  return currentSpectrogram.create(baseOptions);
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
  // 返回一個 Promise，確保呼叫者可以等待 render 完成
  return new Promise((resolve) => {
    if (!ws) throw new Error('Wavesurfer not initialized.');
    const container = document.getElementById('spectrogram-only');

    // 完整清理舊 plugin 和 canvas
    const oldCanvas = container.querySelector('canvas');
    if (oldCanvas) {
      oldCanvas.remove();
    }

    if (plugin?.destroy) {
      try {
        plugin.destroy();
      } catch (e) {
        console.warn('Error destroying old plugin:', e);
      }
      plugin = null; // 確保 plugin 引用被清空
    }

    // 強制重新設置 container 寬度為預設值（避免殘留的大尺寸）
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

    // 註冊新 plugin
    try {
      ws.registerPlugin(plugin);
    } catch (err) {
      console.warn('Error registering spectrogram plugin:', err);
    }

    // 等待 wavesurfer 的 rendered 事件，或在超時後回退
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      ws?.un && typeof ws.un === 'function' && ws.un('rendered', onRenderedEvent);
      if (typeof onRendered === 'function') {
        try { onRendered(); } catch (e) { console.warn('onRendered callback error', e); }
      }
      resolve();
    };

    const onRenderedEvent = () => {
      // Use requestAnimationFrame to ensure DOM updated
      requestAnimationFrame(() => {
        cleanup();
      });
    };

    // Attach once listener to wavesurfer 'rendered' event
    try {
      if (ws && typeof ws.once === 'function') {
        ws.once('rendered', onRenderedEvent);
      }
    } catch (err) {
      console.warn('Error attaching rendered listener:', err);
    }

    // Trigger render and a short retry if canvas doesn't appear
    try {
      if (plugin && typeof plugin.render === 'function') {
        plugin.render();
      }
    } catch (err) {
      console.warn('⚠️ Spectrogram render failed:', err);
    }

    // If rendering didn't create a canvas within a short time, retry once
    setTimeout(() => {
      try {
        if (!container.querySelector('canvas') && plugin && typeof plugin.render === 'function') {
          // attempt one retry
          plugin.render();
        }
      } catch (e) {
        console.warn('Retry render failed:', e);
      }
    }, 120);

    // Safety fallback: if 'rendered' doesn't fire, resolve after 250ms
    setTimeout(() => {
      cleanup();
    }, 250);
  });
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
