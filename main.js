import {
initWavesurfer,
getWavesurfer,
getPlugin,
replacePlugin,
createSpectrogramPlugin,
getCurrentColorMap,
initScrollSync,
} from './modules/wsManager.js';

import { initZoomControls } from './modules/zoomControl.js';
import { initFileLoader, getWavSampleRate } from './modules/fileLoader.js';
import { initBrightnessControl } from './modules/brightnessControl.js';
import { initFrequencyHover } from './modules/frequencyHover.js';
import { cropWavBlob } from './modules/cropAudio.js';
import { drawTimeAxis, drawFrequencyGrid } from './modules/axisRenderer.js';
import { initExportCsv } from './modules/exportCsv.js';
import { initTrashProgram } from './modules/trashProgram.js';
import { initDragDropLoader } from './modules/dragDropLoader.js';
import { initMapPopup } from './modules/mapPopup.js';
import { initSidebar } from './modules/sidebar.js';
import { initTagControl } from './modules/tagControl.js';
import { initDropdown } from './modules/dropdown.js';
import { showMessageBox } from './modules/messageBox.js';
import { initAutoIdPanel } from './modules/autoIdPanel.js';
import { initFreqContextMenu } from './modules/freqContextMenu.js';
import { getCurrentIndex, getFileList, toggleFileIcon, setFileList, clearFileList, getFileIconState, getFileNote, setFileNote, getFileMetadata, setFileMetadata, clearTrashFiles, getTrashFileCount, getCurrentFile, getTimeExpansionMode, setTimeExpansionMode, toggleTimeExpansionMode } from './modules/fileState.js';

const spectrogramHeight = 800;
let sidebarControl;
let fileLoaderControl;
const container = document.getElementById('spectrogram-only');
const viewer = document.getElementById('viewer-container');
const timeAxis = document.getElementById('time-axis');
const timeWrapper = document.getElementById('time-axis-wrapper');
const timeLabel = document.getElementById('time-label');
const freqGrid = document.getElementById('freq-grid');
const freqAxisContainer = document.getElementById('freq-axis');
const hoverLineElem = document.getElementById('hover-line');
const hoverLineVElem = document.getElementById('hover-line-vertical');
const progressLineElem = document.getElementById('progress-line');
const hoverLabelElem = document.getElementById('hover-label');
const zoomControlsElem = document.getElementById('zoom-controls');
const playPauseBtn = document.getElementById('playPauseBtn');
const stopBtn = document.getElementById('stopBtn');
let containerWidth = container.clientWidth;
let isDraggingProgress = false;
let manualSeekTime = null;
let duration = 0;
let lastLoadedFileName = null;
let currentFreqMin = 10;
let currentFreqMax = 128;
let currentSampleRate = 256000;
let selectedSampleRate = 'auto';
let currentFftSize = 1024;
let currentWindowType = 'hann';
let currentOverlap = 'auto';
let currentAudioBufferLength = 0;
let savedAudioBufferLengthBeforeExpand = null;
let overlapWarningShown = false;
let freqHoverControl = null;
let autoIdControl = null;
let freqMenuControl = null;
let demoFetchController = null;
const sampleRateBtn = document.getElementById('sampleRateInput');
const fftSizeBtn = document.getElementById('fftSizeInput');
let selectionExpandMode = false;
let expandHistory = [];
let currentExpandBlob = null;
// When true, prevent applySampleRate from auto-adjusting the displayed
// freqMin/freqMax input values. Used when reloading the file due to
// UI-only actions (e.g. toggling Time Expansion) where we don't want to
// override user's displayed frequency settings.
let suppressFreqValueAdjustment = false;
const expandBackBtn = document.getElementById('expandBackBtn');
const expandBackCount = document.getElementById('expandBackCount');
let ignoreNextPause = false;
const canvasElem = document.getElementById("spectrogram-canvas");
const offscreen = canvasElem.transferControlToOffscreen();
const specWorker = new Worker("./spectrogramWorker.js", { type: "module" });
specWorker.postMessage({ type: "init", canvas: offscreen }, [offscreen]);

const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if (isMobileDevice) {
  [
    'toggleTagModeBtn',
    'autoIdBtn',
    'exportBtn',
    'mapBtn',
    'spectrogram-settings',
    'drop-overlay'
  ]
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('mobile-hidden');
    });
  // 預設收合 sidebar
  requestAnimationFrame(() => {
    const sidebarElem = document.getElementById('sidebar');
    if (sidebarElem && !sidebarElem.classList.contains('collapsed')) {
      sidebarElem.classList.add('collapsed');
      const toggleBtn = document.getElementById('toggleSidebarBtn');
      if (toggleBtn) toggleBtn.title = 'Open File List';
    }
    requestAnimationFrame(() => {
      alert('SonoRadar is optimized for desktop use. Android devices support viewer functionality only.');
    });
  });
}
function updateExpandBackBtn() {
  const count = expandHistory.length;
  expandBackBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  if (expandBackCount) {
    expandBackCount.textContent = String(count);
    expandBackCount.style.display = count > 0 ? 'flex' : 'none';
  }
}
// Time Expansion UI helper
const timeExpBtn = document.getElementById('timeexpBtn');
function applyTimeExpansionUI() {
  const active = getTimeExpansionMode();
  if (timeExpBtn) {
    if (active) {
      timeExpBtn.classList.add('active');
      timeExpBtn.title = 'Exit 10x Time Expansion';
    } else {
      timeExpBtn.classList.remove('active');
      timeExpBtn.title = '10x Time Expansion';
    }
  }
  document.body.classList.toggle('timeexp-open', active);
  // adjust displayed freq input maxima and values
  const maxFreq = currentSampleRate / 2000;
  const dispMax = active ? (maxFreq * 10) : maxFreq;
  freqMaxInput.max = dispMax;
  freqMinInput.max = dispMax;
}

if (timeExpBtn) {
  timeExpBtn.addEventListener('click', async () => {
    // If currently in Time Expansion mode and the user is attempting to
    // exit it, disallow exiting when the currently loaded audio is
    // longer than 20 seconds.
    const currentlyActive = getTimeExpansionMode();
    if (currentlyActive) {
      const ws = getWavesurfer();
      const curDur = ws ? ws.getDuration() : 0;
      if (curDur > 20) {
        showMessageBox({
          title: 'Warning',
          message: 'Cannot exit time-expansion mode for >20s recording.'
        });
        return;
      }
    }

    const newState = toggleTimeExpansionMode();
    setTimeExpansionMode(newState); // ensure saved
    applyTimeExpansionUI();


    try {
      const idx = getCurrentIndex();
      if (idx >= 0 && fileLoaderControl && typeof fileLoaderControl.loadFileAtIndex === 'function') {
        suppressFreqValueAdjustment = true;
        try {
          await fileLoaderControl.loadFileAtIndex(idx);
        } finally {
          suppressFreqValueAdjustment = false;
        }
      } else {
        replacePlugin(
          getCurrentColorMap(),
          spectrogramHeight,
          currentFreqMin,
          currentFreqMax,
          getOverlapPercent(),
          () => {
            duration = getWavesurfer().getDuration();
            zoomControl.applyZoom();
            renderAxes();
            freqHoverControl?.refreshHover();
            autoIdControl?.updateMarkers();
            updateSpectrogramSettingsText();
          }
          ,
          currentFftSize,
          currentWindowType,
          shouldUseFlashForReplace(),
        );
      }
    } catch (err) {
      console.error('Error reloading file after Time Expansion toggle', err);
    }
  });
}
let stopBtnRafId = null;
function showStopButton() {
  if (stopBtnRafId !== null) {
    cancelAnimationFrame(stopBtnRafId);
    stopBtnRafId = null;
  }
  stopBtn.style.display = 'inline-flex';
  stopBtnRafId = requestAnimationFrame(() => {
    stopBtnRafId = null;
    stopBtn.classList.add('show');
  });
}
function hideStopButton() {
  if (stopBtnRafId !== null) {
    cancelAnimationFrame(stopBtnRafId);
    stopBtnRafId = null;
  }
  stopBtn.classList.remove('show');
  stopBtn.addEventListener('transitionend', function handler() {
    stopBtn.removeEventListener('transitionend', handler);
    if (!stopBtn.classList.contains('show')) {
      stopBtn.style.display = 'none';
    }
  }, { once: true });
}
playPauseBtn.disabled = true;
hideStopButton();
const getDuration = () => duration;

const guanoOutput = document.getElementById('guano-output');
const metadataDiv = document.getElementById('Metadata');
const fileListElem = document.getElementById('fileList');
const metadataToggle = document.getElementById('metadata-toggle');
metadataToggle.addEventListener('click', () => {
const collapsed = metadataDiv.classList.toggle('collapsed');
fileListElem.classList.toggle('metadata-collapsed', collapsed);
metadataToggle.classList.toggle('fa-caret-down', !collapsed);
metadataToggle.classList.toggle('fa-caret-up', collapsed);
});

initWavesurfer({
  container,
  sampleRate: currentSampleRate,
});
getWavesurfer().on('finish', () => {
  playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
  playPauseBtn.title = 'Play (Ctrl + P)';
  playPauseBtn.classList.remove('playing', 'paused');
  progressLineElem.style.display = 'none';
  progressLineElem.style.pointerEvents = 'none';
  manualSeekTime = null;
  ignoreNextPause = true;
  hideStopButton();
});

getWavesurfer().on('play', () => {
  progressLineElem.style.display = 'block';
  progressLineElem.style.pointerEvents = 'none';
  playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
  playPauseBtn.title = 'Pause';
  playPauseBtn.classList.add('playing');
  playPauseBtn.classList.remove('paused');
  showStopButton();
});

getWavesurfer().on('pause', () => {
  if (ignoreNextPause) {
    ignoreNextPause = false;
    return;
  }
  playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
  playPauseBtn.title = 'Continue (Ctrl + P)';
  playPauseBtn.classList.add('paused');
  playPauseBtn.classList.remove('playing');
  progressLineElem.style.pointerEvents = 'auto';
  if (getWavesurfer().getCurrentTime() === 0) {
    hideStopButton();
  } else {
    showStopButton();
  }
});

getWavesurfer().on('audioprocess', (time) => {
  updateProgressLine(time);
});

getWavesurfer().on('seek', (prog) => {
  updateProgressLine(prog * duration);
});

document.addEventListener('file-loaded', () => {
  playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
  playPauseBtn.title = 'Play (Ctrl + P)';
  playPauseBtn.classList.remove('playing', 'paused');
  progressLineElem.style.display = 'none';
  progressLineElem.style.pointerEvents = 'none';
  manualSeekTime = null;
  playPauseBtn.disabled = false;
  hideStopButton();
  updateProgressLine(0);
    if (document.body.classList.contains('autoid-open')) {
        freqHoverControl?.setPersistentLinesEnabled(false);
    }
});

playPauseBtn.addEventListener('click', () => {
  const ws = getWavesurfer();
  if (!ws) return;
  if (ws.isPlaying()) {
    ws.pause();
    // Update button immediately in case the pause event is delayed
    playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    playPauseBtn.title = 'Continue (Ctrl + P)';
    playPauseBtn.classList.add('paused');
    playPauseBtn.classList.remove('playing');
    progressLineElem.style.pointerEvents = 'auto';
  } else {
    if (manualSeekTime !== null) {
      ws.setTime(manualSeekTime);
      manualSeekTime = null;
    }
    ws.play();
    // Reflect playing state immediately
    playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    playPauseBtn.title = 'Pause';
    playPauseBtn.classList.add('playing');
    playPauseBtn.classList.remove('paused');
    progressLineElem.style.pointerEvents = 'none';
  }
});

stopBtn.addEventListener('click', () => {
  const ws = getWavesurfer();
  if (!ws) return;
  ignoreNextPause = true;
  ws.stop();
  playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
  playPauseBtn.title = 'Play (Ctrl + P)';
  playPauseBtn.classList.remove('playing', 'paused');
  progressLineElem.style.display = 'none';
  progressLineElem.style.pointerEvents = 'none';
  manualSeekTime = null;
  updateProgressLine(0);
  hideStopButton();
});
const overlay = document.getElementById('drop-overlay');
const loadingOverlay = document.getElementById('loading-overlay');
const uploadOverlay = document.getElementById('upload-overlay');

function showDropOverlay() {
overlay.style.display = 'flex';
overlay.style.pointerEvents = 'auto';
hoverLineElem.style.display = 'none';
hoverLineVElem.style.display = 'none';
hoverLabelElem.style.display = 'none';
viewer.classList.remove('hide-cursor');
freqHoverControl?.setPersistentLinesEnabled(false);
}

function hideDropOverlay() {
overlay.style.display = 'none';
overlay.style.pointerEvents = 'none';
  freqHoverControl?.hideHover();
  freqHoverControl?.setPersistentLinesEnabled(true);
  freqHoverControl?.refreshHover();
  autoIdControl?.updateMarkers();
}

showDropOverlay();
document.addEventListener('drop-overlay-show', showDropOverlay);
document.addEventListener('drop-overlay-hide', hideDropOverlay);
updateSpectrogramSettingsText();

fileLoaderControl = initFileLoader({
fileInputId: 'fileInput',
wavesurfer: getWavesurfer(),
spectrogramHeight,
colorMap: [],
onPluginReplaced: () => {},
onFileLoaded: (file) => {
hideDropOverlay();
zoomControlsElem.style.display = 'flex';
sidebarControl.refresh(file.name);
},
onBeforeLoad: () => {
  if (demoFetchController) {
    demoFetchController.abort();
    demoFetchController = null;
  }
  if (uploadOverlay.style.display !== 'flex') {
    loadingOverlay.style.display = 'flex';
  }
  // ✅ 在加載新文件前重置 container 寬度，避免先前 zoom 的殘留
  container.style.width = '100%';
  
  freqHoverControl?.hideHover();
  freqHoverControl?.clearSelections();
  if (selectionExpandMode) {
    selectionExpandMode = false;
    sampleRateBtn.disabled = false;
    expandHistory = [];
    currentExpandBlob = null;
    updateExpandBackBtn();
    // restore original audio length if we saved it
    if (savedAudioBufferLengthBeforeExpand !== null) {
      currentAudioBufferLength = savedAudioBufferLengthBeforeExpand;
      savedAudioBufferLengthBeforeExpand = null;
    }
  }
},
  onAfterLoad: () => {
    if (uploadOverlay.style.display !== 'flex') {
      loadingOverlay.style.display = 'none';
    }
    freqHoverControl?.refreshHover();
    autoIdControl?.updateMarkers();
    drawColorBar(getCurrentColorMap());
    updateSpectrogramSettingsText();
  },
onSampleRateDetected: autoSetSampleRate
});
sidebarControl = initSidebar({
onFileSelected: (index) => {
fileLoaderControl.loadFileAtIndex(index);
hideDropOverlay();
}
});
const sidebarElem = document.getElementById('sidebar');
sidebarElem.addEventListener('sidebar-toggle', () => {
  setTimeout(() => {
    const prev = containerWidth;
    zoomControl.applyZoom();
    if (container.clientWidth !== prev) {
      containerWidth = container.clientWidth;
      renderAxes();
      freqHoverControl?.refreshHover();
      autoIdControl?.updateMarkers();
    }
  }, 310);
});
const tagControl = initTagControl();

(async () => {
  demoFetchController = new AbortController();
  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/hkbatradar/SonoRadar/main/recording/demo_recording.wav',
      { signal: demoFetchController.signal }
    );
    const blob = await resp.blob();
    if (demoFetchController.signal.aborted) return;
    const demoFile = new File([blob], 'demo_recording.wav', { type: 'audio/wav' });
    setFileList([demoFile], -1);
    toggleFileIcon(0, 'trash');
    toggleFileIcon(0, 'star');
    toggleFileIcon(0, 'question');
    sidebarControl.refresh(demoFile.name);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Failed to preload demo file', err);
    }
  } finally {
    demoFetchController = null;
  }
})();

document.addEventListener('keydown', (e) => {
const idx = getCurrentIndex();
if (idx < 0) return;
if (e.key === 'Delete') {
toggleFileIcon(idx, 'trash');
sidebarControl.refresh(getFileList()[idx].name, false);
} else if (e.key === '*') {
toggleFileIcon(idx, 'star');
sidebarControl.refresh(getFileList()[idx].name, false);
} else if (e.key === '?') {
toggleFileIcon(idx, 'question');
sidebarControl.refresh(getFileList()[idx].name, false);
}
});

const toggleGridSwitch = document.getElementById('toggleGridSwitch');

freqGrid.style.display = 'none';
toggleGridSwitch.checked = false;
toggleGridSwitch.addEventListener('change', () => {
freqGrid.style.display = toggleGridSwitch.checked ? 'block' : 'none';
});

async function applySampleRate(rate, reloadFile = true) {
const prevRate = currentSampleRate;
currentSampleRate = rate;
const maxFreq = currentSampleRate / 2000;
  // Displayed max should reflect Time Expansion mode (UI shows values *10)
  const dispMax = getTimeExpansionMode() ? (maxFreq * 10) : maxFreq;
  freqMaxInput.max = dispMax;
  freqMinInput.max = dispMax;

const isManual = selectedSampleRate !== 'auto';

  // When updating displayed inputs, convert back and forth between display
  // values and internal kHz values. Displayed values are multiplied by 10 in
  // time expansion mode, so convert accordingly when reading input values.
  const divisor = getTimeExpansionMode() ? 10 : 1;
  if (!suppressFreqValueAdjustment) {
    if (isManual && rate < prevRate) {
      freqMaxInput.value = formatFreqValue(maxFreq);
    } else if (parseFloat(freqMaxInput.value) > (maxFreq * divisor)) {
      freqMaxInput.value = formatFreqValue(maxFreq);
    }
  }

  if (parseFloat(freqMinInput.value) > (maxFreq * divisor)) {
    freqMinInput.value = formatFreqValue(maxFreq);
  }

  currentFreqMax = parseFloat(freqMaxInput.value) / divisor;
  currentFreqMin = parseFloat(freqMinInput.value) / divisor;

if (getWavesurfer()) {
getWavesurfer().options.sampleRate = currentSampleRate;
if (reloadFile) {
const idx = getCurrentIndex();
if (idx >= 0) {
await fileLoaderControl.loadFileAtIndex(idx);
}
}
}
freqHoverControl?.hideHover();
  replacePlugin(
    getCurrentColorMap(),
    spectrogramHeight,
    currentFreqMin,
    currentFreqMax,
    getOverlapPercent(),
    () => {
duration = getWavesurfer().getDuration();
    zoomControl.applyZoom();
    renderAxes();
    freqHoverControl?.refreshHover();
    autoIdControl?.updateMarkers();
    updateSpectrogramSettingsText();
    },
    currentFftSize,
    currentWindowType,
    shouldUseFlashForReplace(),
  );
}

async function handleSampleRate(rate) {
selectedSampleRate = rate;
if (rate === 'auto') {
const cur = getCurrentFile();
if (cur) {
const autoRate = await getWavSampleRate(cur);
await autoSetSampleRate(autoRate);
} else {
updateSpectrogramSettingsText();
}
return;
}
await applySampleRate(rate);
}

async function autoSetSampleRate(rate, skipReload = false) {
if (selectedSampleRate === 'auto' && rate) {
await applySampleRate(rate, !skipReload);
} else if (selectedSampleRate === 'auto') {
updateSpectrogramSettingsText();
}
}

const renderAxes = () => {
  containerWidth = container.clientWidth;
  
  // 使用批量更新優化，避免多次重排。在單個 RAF 中同時更新時間軸和頻率網格
  requestAnimationFrame(() => {
    drawTimeAxis({
      containerWidth,
      duration,
      zoomLevel: zoomControl.getZoomLevel(),
      axisElement: timeAxis,
      labelElement: timeLabel,
      timeExpansion: getTimeExpansionMode(),
    });
    
    drawFrequencyGrid({
      gridCanvas: freqGrid,
      labelContainer: freqAxisContainer,
      containerElement: container,
      spectrogramHeight,
      maxFrequency: currentFreqMax - currentFreqMin,
      offsetKHz: currentFreqMin,
      timeExpansion: getTimeExpansionMode(),
    });

    if (!freqHoverControl) {
      freqHoverControl = initFrequencyHover({
        viewerId: 'viewer-container',
        wrapperId: 'viewer-wrapper',
        hoverLineId: 'hover-line',
        hoverLineVId: 'hover-line-vertical',
        freqLabelId: 'hover-label',
        spectrogramHeight,
        spectrogramWidth: containerWidth,
        maxFrequency: currentFreqMax,
        minFrequency: currentFreqMin,
        totalDuration: duration,
        getZoomLevel: () => zoomControl.getZoomLevel(),
        getDuration: () => duration
      });
    } else {
      freqHoverControl.setFrequencyRange(currentFreqMin, currentFreqMax);
      autoIdControl?.updateMarkers();
    }
    updateProgressLine(getWavesurfer().getCurrentTime());
  });
};

const wrapper = document.getElementById('viewer-wrapper');
const zoomControl = initZoomControls(
  getWavesurfer(),
  container,
  getDuration,
  renderAxes,
  wrapper,
  () => { freqHoverControl?.hideHover(); },
  () => {
    freqHoverControl?.refreshHover();
    autoIdControl?.updateMarkers();
    updateSpectrogramSettingsText();
    // After zoom has been applied, switch to the flash plugin if the
    // overlap percent crosses the threshold (<=30%). This handles the case
    // where Auto overlap changes when the canvas width changes due to zoom.
    try {
      const useFlash = shouldUseFlashForReplace();
      const curPlugin = getPlugin();
      const isFlash = !!curPlugin?.isFlashPlugin;
      if (useFlash !== isFlash) {
        replacePlugin(
          getCurrentColorMap(),
          spectrogramHeight,
          currentFreqMin,
          currentFreqMax,
          getOverlapPercent(),
          () => {
            renderAxes();
            freqHoverControl?.refreshHover();
            autoIdControl?.updateMarkers();
            updateSpectrogramSettingsText();
          },
          currentFftSize,
          currentWindowType,
          useFlash
        );
      }
    } catch (e) {
      console.error('Failed to maybe replace plugin after zoom', e);
    }
  },
  () => selectionExpandMode,
  () => {
    const sel = freqHoverControl?.getHoveredSelection?.();
    if (sel) {
      viewer.dispatchEvent(new CustomEvent('expand-selection', {
        detail: { startTime: sel.data.startTime, endTime: sel.data.endTime }
      }));
      return true;
    }
    return false;
  }
);

function updateProgressLine(time) {
  if (isDraggingProgress) return;
  const t = (manualSeekTime !== null && !getWavesurfer().isPlaying()) ? manualSeekTime : time;
  const x = t * zoomControl.getZoomLevel() - viewer.scrollLeft;
  progressLineElem.style.left = `${x}px`;
}

viewer.addEventListener('scroll', () => {
  const ws = getWavesurfer();
  if (!ws) return;
  updateProgressLine(ws.getCurrentTime());
  autoIdControl?.updateMarkers();
});

progressLineElem.addEventListener('mousedown', (e) => {
  const ws = getWavesurfer();
  if (!ws || ws.isPlaying()) return;
  isDraggingProgress = true;
  e.preventDefault();
});

viewer.addEventListener('mousemove', (e) => {
  if (!isDraggingProgress) return;
  const rect = viewer.getBoundingClientRect();
  let x = e.clientX - rect.left;
  x = Math.max(0, Math.min(rect.width, x));
  manualSeekTime = Math.max(0, Math.min(duration, (x + viewer.scrollLeft) / zoomControl.getZoomLevel()));
  progressLineElem.style.left = `${x}px`;
});

document.addEventListener('mouseup', () => {
  if (isDraggingProgress) {
    isDraggingProgress = false;
  }
});

viewer.addEventListener('expand-selection', async (e) => {
  const { startTime, endTime } = e.detail;
  if (endTime > startTime) {
    freqHoverControl?.hideHover();
    const base = currentExpandBlob || getCurrentFile();
    const blob = await cropWavBlob(base, startTime, endTime);
    if (blob) {
      expandHistory.push({ src: base, freqMin: currentFreqMin, freqMax: currentFreqMax });
      // Save original audio length so we can restore when leaving expansion
      savedAudioBufferLengthBeforeExpand = currentAudioBufferLength;
      // Set selectionExpandMode true BEFORE loadBlob so decode handler sees it
      selectionExpandMode = true;
      try {
        await getWavesurfer().loadBlob(blob);
      } catch (err) {
        // if load fails, revert selectionExpandMode and rethrow
        selectionExpandMode = false;
        savedAudioBufferLengthBeforeExpand = null;
        throw err;
      }
      currentExpandBlob = blob;
      zoomControl.resetZoomState();
      container.style.width = '100%';
      
      sampleRateBtn.disabled = true;
      renderAxes();
      freqHoverControl?.hideHover();
      freqHoverControl?.clearSelections();
      updateExpandBackBtn();
      autoIdControl?.reset();
      viewer.dispatchEvent(new CustomEvent('force-hover-enable'));
      freqHoverControl?.refreshHover();
    }
  }
});

viewer.addEventListener('fit-window-selection', async (e) => {
  const { startTime, endTime, Flow, Fhigh } = e.detail;
  if (endTime > startTime) {
    freqHoverControl?.hideHover();
    const base = currentExpandBlob || getCurrentFile();
    const blob = await cropWavBlob(base, startTime, endTime);
    if (blob) {
      expandHistory.push({ src: base, freqMin: currentFreqMin, freqMax: currentFreqMax });
      // Ensure selectionExpandMode is set before decoding so getAutoOverlapPercent() can use backend buffer
      selectionExpandMode = true;
      try {
        await getWavesurfer().loadBlob(blob);
      } catch (err) {
        selectionExpandMode = false;
        savedAudioBufferLengthBeforeExpand = null;
        throw err;
      }
      currentExpandBlob = blob;
      zoomControl.resetZoomState();  // ✅ 使用完整重置
      
      // ✅ 強制重置 container 寬度
      container.style.width = '100%';
      
      sampleRateBtn.disabled = true;
      freqMinInput.value = formatFreqValue(Flow);
      freqMaxInput.value = formatFreqValue(Fhigh);
      updateFrequencyRange(Flow, Fhigh);
      freqHoverControl?.hideHover();
      freqHoverControl?.clearSelections();
      updateExpandBackBtn();
      autoIdControl?.reset();
      // ✅ 移除此處的 updateSpectrogramSettingsText()，讓 decode 事件處理器負責
      // updateSpectrogramSettingsText();
    }
  }
});

initBrightnessControl({
brightnessSliderId: 'brightnessSlider',
gainSliderId: 'gainSlider',
contrastSliderId: 'contrastSlider',
brightnessValId: 'brightnessVal',
gainValId: 'gainVal',
contrastValId: 'contrastVal',
resetBtnId: 'resetButton',
onColorMapUpdated: (colorMap) => {
freqHoverControl?.hideHover();        
    replacePlugin(
      colorMap,
      spectrogramHeight,
      currentFreqMin,
      currentFreqMax,
      getOverlapPercent(),
      () => {
duration = getWavesurfer().getDuration();
    zoomControl.applyZoom();
    renderAxes();
  freqHoverControl?.refreshHover();
  autoIdControl?.updateMarkers();
  updateSpectrogramSettingsText();
      },
      currentFftSize,
      currentWindowType,
      shouldUseFlashForReplace(),
    );
  drawColorBar(colorMap);
  },
});

initDragDropLoader({
targetElementId: 'viewer-wrapper',
wavesurfer: getWavesurfer(),
spectrogramHeight,
colorMap: [],
onPluginReplaced: () => {},
onFileLoaded: (file) => {
hideDropOverlay();
zoomControlsElem.style.display = 'flex';
sidebarControl.refresh(file.name);
},
onBeforeLoad: () => {
if (uploadOverlay.style.display !== 'flex') {
loadingOverlay.style.display = 'flex';
}
freqHoverControl?.hideHover();
freqHoverControl?.clearSelections();
},
  onAfterLoad: () => {
    if (uploadOverlay.style.display !== 'flex') {
      loadingOverlay.style.display = 'none';
    }
    freqHoverControl?.refreshHover();
    autoIdControl?.updateMarkers();
    drawColorBar(getCurrentColorMap());
    updateSpectrogramSettingsText();
  },
onSampleRateDetected: autoSetSampleRate
});

initScrollSync({
scrollSourceId: 'viewer-container',
scrollTargetId: 'time-axis-wrapper',
});

getWavesurfer().on('ready', () => {
    duration = getWavesurfer().getDuration();
    
    // ✅ 強制重置所有寬度，確保不受先前 zoom 影響
    container.style.width = '100%';
    wrapper.style.width = '100%';
    
    // ✅ 調用完整 reset，會基於 100% 寬度計算 minZoomLevel
    zoomControl.resetZoomState();

    progressLineElem.style.display = 'none';
    updateProgressLine(0);

    getPlugin()?.render();
    // Ensure the plugin type matches overlap threshold on file ready. This
    // is important when returning from selection expand mode where buffer
    // length can change and auto-overlap may need to switch implementation.
    try {
      const useFlash = shouldUseFlashForReplace();
      const curPlugin = getPlugin();
      const isFlash = !!curPlugin?.isFlashPlugin;
      if (useFlash !== isFlash) {
        replacePlugin(
          getCurrentColorMap(),
          spectrogramHeight,
          currentFreqMin,
          currentFreqMax,
          getOverlapPercent(),
          () => {
            renderAxes();
            freqHoverControl?.refreshHover();
            autoIdControl?.updateMarkers();
            updateSpectrogramSettingsText();
          },
          currentFftSize,
          currentWindowType,
          useFlash
        );
      }
    } catch (e) {
      console.error('Failed to maybe replace plugin on ready', e);
    }
    requestAnimationFrame(() => {
      renderAxes();
      freqHoverControl?.refreshHover();
      autoIdControl?.updateMarkers();
      updateSpectrogramSettingsText();
    });
  });

getWavesurfer().on('decode', () => {
  duration = getWavesurfer().getDuration();
  
  // ✅ 在 selection expansion mode 時，從 wavesurfer backend 獲取新的 buffer 長度
  if (selectionExpandMode) {
    // Try to get decoded data length from wavesurfer; fallback to backend buffer
    const newBufferLength = getWavesurfer()?.getDecodedData()?.length || getWavesurfer()?.backend?.buffer?.length;
    if (newBufferLength) {
      currentAudioBufferLength = newBufferLength;
    }
  }
  
  // ✅ 強制重置所有寬度，確保不受先前 zoom 影響
  container.style.width = '100%';
  wrapper.style.width = '100%';
  
  // ✅ 調用完整 reset，會基於 100% 寬度計算 minZoomLevel
  zoomControl.resetZoomState();
  
  progressLineElem.style.display = 'none';
  updateProgressLine(0);
  renderAxes();
  freqHoverControl?.refreshHover();
  autoIdControl?.updateMarkers();
  updateSpectrogramSettingsText();
});

document.body.addEventListener('touchstart', () => {
if (getWavesurfer()?.backend?.ac?.state === 'suspended') {
getWavesurfer().backend.ac.resume();
}
}, { once: true });

const freqMinInput = document.getElementById('freqMinInput');
const freqMaxInput = document.getElementById('freqMaxInput');
const applyFreqRangeBtn = document.getElementById('applyFreqRangeBtn');

// initialize displayed max according to Time Expansion mode
const initMaxFreq = currentSampleRate / 2000;
const initDispMax = getTimeExpansionMode() ? (initMaxFreq * 10) : initMaxFreq;
freqMaxInput.max = initDispMax;
freqMinInput.max = initDispMax;
// Ensure UI reflects current Time Expansion mode on startup
applyTimeExpansionUI();

const sampleRateDropdown = initDropdown('sampleRateInput', [
{ label: 'Auto', value: 'auto' },
{ label: '96', value: 96000 },
{ label: '192', value: 192000 },
{ label: '256', value: 256000 },
{ label: '384', value: 384000 },
{ label: '500', value: 500000 },
], { onChange: (item) => handleSampleRate(item.value) });
sampleRateDropdown.select(0);

const fftSizeDropdown = initDropdown('fftSizeInput', [
{ label: '512', value: 512 },
{ label: '1024', value: 1024 },
{ label: '2048', value: 2048 },
], { onChange: (item) => handleFftSize(item.value) });
fftSizeDropdown.select(0);

const windowTypeDropdown = initDropdown('windowTypeInput', [
  { label: 'Blackman', value: 'blackman' },
  { label: 'Gauss', value: 'gauss' },
  { label: 'Hamming', value: 'hamming' },
  { label: 'Hann', value: 'hann' },
  { label: 'Rectangular', value: 'rectangular' },
  { label: 'Triangular', value: 'triangular' },
], { onChange: (item) => handleWindowType(item.value) });
windowTypeDropdown.select(3);

const overlapInput = document.getElementById('overlapInput');
overlapInput.value = '';
overlapInput.addEventListener('change', () => {
const val = overlapInput.value.trim();
if (val === '') {
currentOverlap = 'auto';
handleOverlapChange();
return;
}

const num = parseInt(val, 10);
if (!isNaN(num) && num >= 1 && num <= 99) {
const proceed = () => {
currentOverlap = num;
handleOverlapChange();
};
if (num >= 80 && !overlapWarningShown) {
showMessageBox({
title: 'Reminder',
message: `Using an overlap size above 80% can significantly increase rendering time. If the .wav file is longer than 8 seconds or high-level zoom-in is enabled, large overlap sizes are not recommended.`,
confirmText: 'OK',
cancelText: 'Cancel',
onConfirm: () => {
overlapWarningShown = true;
proceed();
},
onCancel: () => {
overlapInput.value = '';
currentOverlap = 'auto';
}
});
return;
}
proceed();
} else {
alert('Overlap must be between 1 and 99.');
overlapInput.value = '';
currentOverlap = 'auto';
handleOverlapChange();
}
});

const quickPresetBtn = document.getElementById('quickPresetBtn');
let quickPresetActive = false;
let prevSampleRateIndex = null;
let prevFftSizeIndex = null;
quickPresetBtn.addEventListener('click', () => {
  if (!quickPresetActive) {
    prevSampleRateIndex = sampleRateDropdown.selectedIndex;
    prevFftSizeIndex = fftSizeDropdown.selectedIndex;
    fftSizeDropdown.select(0);
    fftSizeBtn.disabled = true;
    sampleRateDropdown.select(3);
    sampleRateBtn.disabled = true;
    quickPresetBtn.style.color = 'rgb(249, 191, 0)';
    quickPresetBtn.title = 'Exit Quick Screening Mode';
    quickPresetActive = true;
  } else {
    sampleRateBtn.disabled = false;
    fftSizeBtn.disabled = false;
    if (prevFftSizeIndex != null) fftSizeDropdown.select(prevFftSizeIndex);
    if (prevSampleRateIndex != null) sampleRateDropdown.select(prevSampleRateIndex);
    quickPresetBtn.style.color = '';
    quickPresetBtn.style.textShadow = '';
    quickPresetBtn.title = 'Quick Screening Mode';
    quickPresetActive = false;
  }
  overlapInput.value = '';
  currentOverlap = 'auto';
  handleOverlapChange();
});

function updateSpectrogramSettingsText() {
  const textElem = document.getElementById('spectrogram-settings-text');
  const sampleRate = currentSampleRate;
  const fftSize = currentFftSize;
  const overlap = currentOverlap === 'auto'
    ? getAutoOverlapPercent()
    : getPluginUsedOverlapPercentFromManual(currentOverlap);
  const windowType = currentWindowType.charAt(0).toUpperCase() + currentWindowType.slice(1);

  const overlapText = currentOverlap === 'auto'
    ? `Auto${overlap !== null ? ` (${overlap}%)` : ''}`
    : `${overlap}%`;
  if (textElem) {
    textElem.textContent =
      `Sampling rate: ${sampleRate / 1000}kHz, FFT size: ${fftSize}, Overlap size: ${overlapText}, ${windowType} window`;
  }
}

function drawColorBar(colorMap) {
  const canvas = document.getElementById('color-bar');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const step = width / colorMap.length;
  for (let i = 0; i < colorMap.length; i++) {
    const [r, g, b, a] = colorMap[i];
    ctx.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    ctx.fillRect(i * step, 0, step, height);
  }
}

function getOverlapPercent() {
  if (currentOverlap === 'auto') return null;
  const parsed = parseInt(currentOverlap, 10);
  return isNaN(parsed) ? null : parsed;
}

function getPluginUsedOverlapPercentFromManual(pct) {
  const parsed = parseInt(pct, 10);
  if (isNaN(parsed)) return null;
  const fft = currentFftSize;
  if (!fft) return null;
  const noverlap = Math.floor(fft * (parsed / 100));
  return Math.round((noverlap / fft) * 100);
}

function shouldUseFlashForReplace() {
  const manual = getOverlapPercent();
  if (manual !== null) {
    const pluginPct = getPluginUsedOverlapPercentFromManual(manual);
    return pluginPct !== null && pluginPct <= 30;
  }
  const auto = getAutoOverlapPercent();
  return auto !== null && auto <= 30;
}

function getAutoOverlapPercent(overriddenBufferLength = null) {
  // 優先使用傳入的 bufferLength，其次是 currentAudioBufferLength，最後回退到 wavesurfer backend
  const bufferLength = overriddenBufferLength !== null
    ? overriddenBufferLength
    : (
      // If not in selectionExpandMode, prefer wavesurfer internal decoded length (original wav)
      (!selectionExpandMode && getWavesurfer()?.getDecodedData()?.length) ||
      currentAudioBufferLength ||
      getWavesurfer()?.getDecodedData()?.length ||
      getWavesurfer()?.backend?.buffer?.length
    );
  const canvasWidth = document
    .querySelector('#spectrogram-only canvas')
    ?.width || container.clientWidth;
  const fft = currentFftSize;
  if (bufferLength && canvasWidth && fft) {
    const samplesPerCol = bufferLength / canvasWidth;
    const noverlap = Math.max(0, Math.round(fft - samplesPerCol));
    return Math.round((noverlap / fft) * 100);
  }
  return null;
}

function formatFreqValue(value) {
  const timeExp = getTimeExpansionMode();
  const display = timeExp ? (value * 10) : value;
  return Math.abs(display - Math.round(display)) < 0.001
    ? String(Math.round(display))
    : display.toFixed(1);
}

applyFreqRangeBtn.addEventListener('click', () => {
  const dispMin = Math.max(0, parseFloat(freqMinInput.value));
  const maxAllowed = currentSampleRate / 2000;
  const divisor = getTimeExpansionMode() ? 10 : 1;
  const dispMax = Math.min(maxAllowed * divisor, parseFloat(freqMaxInput.value));

  if (isNaN(dispMin) || isNaN(dispMax) || dispMin >= dispMax) {
    alert('Please enter valid frequency values. Min must be less than Max.');
    return;
  }

  const min = dispMin / divisor;
  const max = dispMax / divisor;
  updateFrequencyRange(min, max);
});

document.getElementById('fileInputBtn').addEventListener('click', () => {
document.getElementById('fileInput').click();
});

function handleFftSize(size) {
  currentFftSize = size;
  const colorMap = getCurrentColorMap();
  freqHoverControl?.hideHover();
  replacePlugin(
    colorMap,
    spectrogramHeight,
    currentFreqMin,
    currentFreqMax,
    getOverlapPercent(),
    () => {
      duration = getWavesurfer().getDuration();
      zoomControl.applyZoom();
      renderAxes();
      freqHoverControl?.refreshHover();
      autoIdControl?.updateMarkers();
      updateSpectrogramSettingsText();
    },
    currentFftSize,
    currentWindowType,
    shouldUseFlashForReplace(),
  );
}

function handleWindowType(type) {
  currentWindowType = type;
  const colorMap = getCurrentColorMap();
  freqHoverControl?.hideHover();
  replacePlugin(
    colorMap,
    spectrogramHeight,
    currentFreqMin,
    currentFreqMax,
    getOverlapPercent(),
    () => {
      duration = getWavesurfer().getDuration();
      zoomControl.applyZoom();
      renderAxes();
      freqHoverControl?.refreshHover();
      autoIdControl?.updateMarkers();
      updateSpectrogramSettingsText();
    },
    currentFftSize,
    currentWindowType,
    shouldUseFlashForReplace(),
  );
}

function handleOverlapChange() {
const colorMap = getCurrentColorMap();
freqHoverControl?.hideHover();
    replacePlugin(
    colorMap,
    spectrogramHeight,
    currentFreqMin,
    currentFreqMax,
  getOverlapPercent(),
  () => {
freqHoverControl?.refreshHover();
autoIdControl?.updateMarkers();
duration = getWavesurfer().getDuration();
zoomControl.applyZoom();
renderAxes();
updateSpectrogramSettingsText();
  },
  currentFftSize,
  currentWindowType,
  shouldUseFlashForReplace(),
);
}

function updateFrequencyRange(freqMin, freqMax) {
const colorMap = getCurrentColorMap();
currentFreqMin = freqMin;
currentFreqMax = freqMax;

freqHoverControl?.hideHover();
replacePlugin(
colorMap,
spectrogramHeight,
freqMin,
freqMax,
  getOverlapPercent(),
  () => {
    freqHoverControl?.refreshHover();
    autoIdControl?.updateMarkers();
    duration = getWavesurfer().getDuration();
    zoomControl.applyZoom();
    renderAxes();
    if (freqHoverControl) {
      freqHoverControl.setFrequencyRange(currentFreqMin, currentFreqMax);
      autoIdControl?.updateMarkers();
    }
    updateSpectrogramSettingsText();
  },
  currentFftSize,
  currentWindowType,
  shouldUseFlashForReplace(),
);
}

const clearAllBtn = document.getElementById('clearAllBtn');
clearAllBtn.addEventListener('click', () => {
clearFileList();
sidebarControl.refresh('');
  replacePlugin(
    getCurrentColorMap(),
    spectrogramHeight,
    currentFreqMin,
    currentFreqMax,
    getOverlapPercent(),
    () => {
      updateSpectrogramSettingsText();
    },
    currentFftSize,
    currentWindowType,
    shouldUseFlashForReplace(),
  );
showDropOverlay();
loadingOverlay.style.display = 'none';
zoomControlsElem.style.display = 'none';
guanoOutput.textContent = '(no file selected)';
tagControl.updateTagButtonStates();
document.dispatchEvent(new Event('file-list-cleared'));
});

const clearTrashBtn = document.getElementById('clearTrashBtn');
clearTrashBtn.addEventListener('click', () => {
  const count = getTrashFileCount();
  if (count === 0) return;

  showMessageBox({
    title: 'Message',
    message: `Confirm to clear ${count} trash flagged file(s) from the list?`,
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    onConfirm: () => {
      const prevIdx = getCurrentIndex();
      const filesBefore = getFileList();
      let nextFile = null;
      if (prevIdx >= 0 && getFileIconState(prevIdx).trash) {
        for (let i = prevIdx + 1; i < filesBefore.length; i++) {
          if (!getFileIconState(i).trash) {
            nextFile = filesBefore[i];
            break;
          }
        }
        if (!nextFile) {
          for (let i = prevIdx - 1; i >= 0; i--) {
            if (!getFileIconState(i).trash) {
              nextFile = filesBefore[i];
              break;
            }
          }
        }
      }

      const removed = clearTrashFiles();
      if (removed > 0) {
        const remaining = getFileList();
        if (remaining.length === 0) {
          sidebarControl.refresh('');
          replacePlugin(
            getCurrentColorMap(),
            spectrogramHeight,
            currentFreqMin,
            currentFreqMax,
            getOverlapPercent(),
            () => {
              updateSpectrogramSettingsText();
            },
            currentFftSize,
            currentWindowType,
            shouldUseFlashForReplace(),
          );
          showDropOverlay();
          loadingOverlay.style.display = 'none';
          zoomControlsElem.style.display = 'none';
          guanoOutput.textContent = '(no file selected)';
        } else {
          let currentName = '';
          if (nextFile) {
            currentName = nextFile.name;
          } else {
            const cur = getCurrentFile();
            currentName = cur ? cur.name : '';
          }
          sidebarControl.refresh(currentName);
          if (nextFile) {
            const idx = remaining.findIndex(f => f === nextFile);
            if (idx >= 0) {
              fileLoaderControl.loadFileAtIndex(idx);
            }
          }
        }
        tagControl.updateTagButtonStates();
        document.dispatchEvent(new Event('file-list-changed'));
      }
    }
  });
});

const settingBtn = document.getElementById('setting');
const toolBar = document.getElementById('tool-bar');

settingBtn.addEventListener('click', () => {
const isOpen = toolBar.classList.toggle('open');
document.body.classList.toggle('settings-open', isOpen);
});

initExportCsv();
initTrashProgram();
initMapPopup();
autoIdControl = initAutoIdPanel({
  spectrogramHeight,
  getDuration,
  getFreqRange: () => ({ min: currentFreqMin, max: currentFreqMax }),
  hideHover: () => freqHoverControl?.hideHover(),
  refreshHover: () => freqHoverControl?.refreshHover()
});
freqMenuControl = initFreqContextMenu({
  viewerId: 'viewer-container',
  wrapperId: 'viewer-wrapper',
  containerId: 'spectrogram-only',
  spectrogramHeight,
  getDuration,
  getFreqRange: () => ({ min: currentFreqMin, max: currentFreqMax }),
  autoId: autoIdControl
});
document.addEventListener('autoid-open', () => {
  freqHoverControl?.setPersistentLinesEnabled(false);
});
document.addEventListener('autoid-close', () => {
  freqHoverControl?.setPersistentLinesEnabled(true);
  freqMenuControl?.hide();
});
document.addEventListener('hide-spectrogram-hover', () => {
  freqHoverControl?.hideHover();
});
document.addEventListener('keydown', (e) => {
if (!e.ctrlKey) return;
if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
switch (e.key.toLowerCase()) {
case 'm':
e.preventDefault();
document.getElementById('mapBtn')?.click();
break;
case 's':
e.preventDefault();
settingBtn.click();
break;
case 'p':
e.preventDefault();
playPauseBtn.click();
break;
case 'i':
e.preventDefault();
document.getElementById('autoIdBtn')?.click();
break;
}
});
document.addEventListener('map-file-selected', (e) => {
const idx = e.detail?.index;
if (typeof idx === 'number') {
fileLoaderControl.loadFileAtIndex(idx);
}
});

expandBackBtn.addEventListener('click', async () => {
  if (expandHistory.length === 0) return;
  const wasSingle = expandHistory.length === 1;
  const prevState = expandHistory.pop();
  const prev = prevState.src;
  const prevMin = prevState.freqMin;
  const prevMax = prevState.freqMax;

  if (prev && prev.name !== undefined) {
    if (wasSingle) {
      await getWavesurfer().loadBlob(prev);
      duration = getWavesurfer().getDuration();
      currentExpandBlob = null;
      selectionExpandMode = false;
      // Restore original audio buffer length if we saved it before expansion
      if (savedAudioBufferLengthBeforeExpand !== null) {
        currentAudioBufferLength = savedAudioBufferLengthBeforeExpand;
        savedAudioBufferLengthBeforeExpand = null;
      }
      sampleRateBtn.disabled = false;
      zoomControl.setZoomLevel(0);
      renderAxes();
      freqHoverControl?.clearSelections();
      expandHistory = [];
    } else {
      currentExpandBlob = null;
      await fileLoaderControl.loadFileAtIndex(getCurrentIndex());
    }
  } else if (prev) {
    await getWavesurfer().loadBlob(prev);
    currentExpandBlob = prev;
    selectionExpandMode = true;
    zoomControl.setZoomLevel(0);
    sampleRateBtn.disabled = true;
    renderAxes();
    freqHoverControl?.clearSelections();
  }

  freqMinInput.value = formatFreqValue(prevMin);
  freqMaxInput.value = formatFreqValue(prevMax);
  updateFrequencyRange(prevMin, prevMax);

  updateExpandBackBtn();
  autoIdControl?.reset();
  updateSpectrogramSettingsText();
});

document.addEventListener('keydown', (e) => {
if (e.key === 'Backspace' && expandHistory.length > 0 &&
!(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
e.preventDefault();
expandBackBtn.click();
}
});

document.addEventListener("file-loaded", async () => {
  const currentFile = getCurrentFile();
  duration = getWavesurfer().getDuration();
  zoomControl.setZoomLevel(0);
  playPauseBtn.classList.remove('playing', 'paused');
  progressLineElem.style.display = 'none';
  progressLineElem.style.pointerEvents = 'none';
  manualSeekTime = null;
  playPauseBtn.disabled = false;
  hideStopButton();
  updateProgressLine(0);
  lastLoadedFileName = currentFile ? currentFile.name : null;
  selectionExpandMode = false;
  sampleRateBtn.disabled = quickPresetActive ? true : false;
  fftSizeBtn.disabled = quickPresetActive ? true : false;
  expandHistory = [];
  currentExpandBlob = null;
  updateExpandBackBtn();
  autoIdControl?.reset();
  if (currentFile) {
    const arrayBuf = await currentFile.arrayBuffer();
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuf = await ac.decodeAudioData(arrayBuf.slice(0));
    // Prefer Wavesurfer decoded internal length for the original audio buffer when available
    const wsDecodedLen = getWavesurfer()?.getDecodedData()?.length;
    currentAudioBufferLength = wsDecodedLen || audioBuf.length;
    // If a saved original length from expansion exists, clear it because we just loaded the real file
    savedAudioBufferLengthBeforeExpand = null;
    const workerOverlap = currentOverlap === 'auto'
      ? getAutoOverlapPercent()
      : getOverlapPercent();
    specWorker.postMessage({ type: "render", buffer: audioBuf.getChannelData(0), sampleRate: audioBuf.sampleRate, fftSize: currentFftSize, overlap: workerOverlap }, [audioBuf.getChannelData(0).buffer]);
    updateSpectrogramSettingsText();
  }
});

document.addEventListener('file-list-cleared', () => {
selectionExpandMode = false;
  sampleRateBtn.disabled = quickPresetActive ? true : false;
  fftSizeBtn.disabled = quickPresetActive ? true : false;
expandHistory = [];
currentExpandBlob = null;
updateExpandBackBtn();
  currentAudioBufferLength = 0;
  savedAudioBufferLengthBeforeExpand = null;
  playPauseBtn.disabled = true;
  hideStopButton();
  updateSpectrogramSettingsText();
  // After a file finishes loading, ensure the implemented plugin matches the
  // current overlap threshold. This handles transitions from selection
  // expansion back to the original file.
  try {
    const useFlash = shouldUseFlashForReplace();
    const curPlugin = getPlugin();
    const isFlash = !!curPlugin?.isFlashPlugin;
    if (useFlash !== isFlash) {
      replacePlugin(
        getCurrentColorMap(),
        spectrogramHeight,
        currentFreqMin,
        currentFreqMax,
        getOverlapPercent(),
        () => {
          renderAxes();
          freqHoverControl?.refreshHover();
          autoIdControl?.updateMarkers();
          updateSpectrogramSettingsText();
        },
        currentFftSize,
        currentWindowType,
        useFlash
      );
    }
  } catch (e) {
    console.error('Failed to maybe replace plugin on file-loaded', e);
  }
});

window.addEventListener('resize', () => {
  zoomControl.applyZoom();
  if (container.clientWidth !== containerWidth) {
    containerWidth = container.clientWidth;
    renderAxes();
    freqHoverControl?.refreshHover();
    autoIdControl?.updateMarkers();
  }
});

// Warn user before closing the tab/window so they must confirm.
window.addEventListener('beforeunload', (e) => {
  // Standard way to trigger a confirmation dialog in modern browsers.
  // Browsers will typically show a generic message; custom text is ignored.
  e.preventDefault();
  e.returnValue = '';
});
