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
    requestAnimationFrame(() => {
      if (typeof onRendered === 'function') onRendered();
    });
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
  const defaultSource = document.getElementById(scrollSourceId);
  const target = document.getElementById(scrollTargetId);

  // Determine actual scroll element to listen to: prefer WaveSurfer's
  // internal `.scroll` container (inside its shadow root) when available.
  let source = defaultSource;
  try {
    const ws = getWavesurfer();
    if (ws && typeof ws.getWrapper === 'function') {
      const wrapper = ws.getWrapper();
      if (wrapper && wrapper.getRootNode) {
        const root = wrapper.getRootNode();
        const host = root && root.host;
        if (host && host.shadowRoot) {
          const sc = host.shadowRoot.querySelector('.scroll');
          if (sc) {
            source = sc;
          }
        }
      }
    }
  } catch (e) {
    // ignore and fallback to provided source element
  }

  if (!source || !target) {
    console.warn(`[scrollSync] One or both elements not found.`);
    return;
  }

  let syncing = false;
  const onSourceScroll = () => {
    if (syncing) return;
    syncing = true;
    target.scrollLeft = source.scrollLeft;
    // schedule reset of syncing flag on next frame
    requestAnimationFrame(() => (syncing = false));
  };

  source.addEventListener('scroll', onSourceScroll);

  // Also mirror time-axis scroll back to waveform scroll (two-way sync)
  // to keep both in sync if user scrolls the time axis.
  const onTargetScroll = () => {
    if (syncing) return;
    syncing = true;
    source.scrollLeft = target.scrollLeft;
    requestAnimationFrame(() => (syncing = false));
  };
  target.addEventListener('scroll', onTargetScroll);
}
