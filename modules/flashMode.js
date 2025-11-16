// flashMode.js - Flash Mode Management for Spectrogram

let isFlashModeActive = false;

/**
 * 初始化 Flash Mode 按鈕
 */
export function initFlashMode() {
  const flashModeBtn = document.getElementById('flashModeBtn');
  
  if (!flashModeBtn) {
    console.warn('Flash Mode button not found');
    return;
  }

  // 點擊事件
  flashModeBtn.addEventListener('click', toggleFlashMode);

  // 鍵盤快捷鍵 Ctrl+F
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      toggleFlashMode();
    }
  });

  // 初始化狀態顯示
  updateFlashModeUI();
}

/**
 * 切換 Flash Mode
 */
async function toggleFlashMode() {
  isFlashModeActive = !isFlashModeActive;
  updateFlashModeUI();
  
  // 立即更新當前正在播放的音頻的頻譜圖
  await reloadCurrentSpectrogram();
}

/**
 * 更新 Flash Mode UI
 */
function updateFlashModeUI() {
  const flashModeBtn = document.getElementById('flashModeBtn');
  
  if (isFlashModeActive) {
    document.body.classList.add('flashmode-active');
    flashModeBtn.title = 'Flash Mode ON - Optimized Spectrogram (Ctrl+F)';
  } else {
    document.body.classList.remove('flashmode-active');
    flashModeBtn.title = 'Flash Mode OFF - Standard Spectrogram (Ctrl+F)';
  }
}

/**
 * 重新加載當前頻譜圖
 */
async function reloadCurrentSpectrogram() {
  try {
    // 動態導入 wsManager
    const wsManager = await import('./wsManager.js');
    
    const ws = wsManager.getWavesurfer();
    const plugin = wsManager.getPlugin();
    
    if (!ws || !plugin) {
      console.warn('Wavesurfer or plugin not initialized');
      return;
    }

    // 設置要使用的 Spectrogram 模塊
    wsManager.setSpectrogramModule(isFlashModeActive);

    // 取得當前設置
    const colorMap = wsManager.getCurrentColorMap();
    const fftSize = wsManager.getCurrentFftSize();
    const windowType = wsManager.getCurrentWindowType();

    // 取得當前頻率範圍（從 UI）
    const freqMinEl = document.getElementById('freqMinInput');
    const freqMaxEl = document.getElementById('freqMaxInput');
    const frequencyMin = freqMinEl ? parseInt(freqMinEl.value) : 10;
    const frequencyMax = freqMaxEl ? parseInt(freqMaxEl.value) : 128;

    // 取得 overlap（從 UI）
    const overlapEl = document.getElementById('overlapInput');
    const overlap = overlapEl && overlapEl.value ? parseInt(overlapEl.value) : null;

    // 重新渲染頻譜圖，等待 render 完成或超時
    await wsManager.replacePlugin(colorMap, 800, frequencyMin, frequencyMax, overlap, null, fftSize, windowType);

    const mode = isFlashModeActive ? '⚡ Flash Mode (Optimized)' : '📊 Standard Mode';
    console.log(`✨ ${mode} - Spectrogram updated`);
  } catch (err) {
    console.error('Error reloading spectrogram:', err);
  }
}

/**
 * 取得當前 Flash Mode 狀態
 */
export function isFlashModeEnabled() {
  return isFlashModeActive;
}

/**
 * 設置 Flash Mode 狀態（用於外部控制）
 */
export function setFlashMode(enabled) {
  if (enabled !== isFlashModeActive) {
    toggleFlashMode();
  }
}

