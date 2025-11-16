import { initDropdown } from "./dropdown.js";
import { autoIdHK } from "./autoid_HK.js";
import { getTimeExpansionMode } from './fileState.js';

export function initAutoIdPanel({
  buttonId = 'autoIdBtn',
  panelId = 'auto-id-panel',
  viewerId = 'viewer-container',
  containerId = 'spectrogram-only',
  overlayId = 'fixed-overlay',
  spectrogramHeight = 800,
  getDuration = () => 0,
  getFreqRange = () => ({ min: 0, max: 0 }),
  hideHover = () => {},
  refreshHover = () => {}
} = {}) {
  const btn = document.getElementById(buttonId);
  const panel = document.getElementById(panelId);
  const dragBar = panel.querySelector('.popup-drag-bar');
  const closeBtn = panel.querySelector('.popup-close-btn');
  const viewer = document.getElementById(viewerId);
  const container = document.getElementById(containerId);
  const overlay = document.getElementById(overlayId);

  const svgNS = 'http://www.w3.org/2000/svg';
  const linesSvg = document.createElementNS(svgNS, 'svg');
  linesSvg.id = 'autoid-lines';
  overlay.appendChild(linesSvg);

  // Helpers for Time Expansion aware display/parse
  function freqDisplayMultiplier() {
    return getTimeExpansionMode() ? 10 : 1;
  }
  function formatFreqForDisplay(v) {
    if (v == null || isNaN(v)) return '';
    const disp = v * freqDisplayMultiplier();
    return Math.abs(disp - Math.round(disp)) < 0.001 ? String(Math.round(disp)) : disp.toFixed(1);
  }
  function parseDisplayedFreq(el) {
    if (!el) return NaN;
    const raw = el.value === '' ? NaN : parseFloat(el.value);
    if (isNaN(raw)) return NaN;
    return raw / freqDisplayMultiplier();
  }
  function formatDurationForDisplay(ms) {
    if (ms == null || isNaN(ms)) return '';
    // When Time Expansion mode is active the displayed duration should be
    // scaled down (divide by 10) because the timeline is expanded by 10x.
    const denom = getTimeExpansionMode() ? 10 : 1;
    const disp = ms / denom;
    return Math.abs(disp - Math.round(disp)) < 0.001 ? String(Math.round(disp)) : disp.toFixed(1);
  }

  const layout = document.getElementById('layout');
  if (layout && panel && panel.parentElement !== layout) {
    layout.appendChild(panel);
  }
  const resetTabBtn = document.getElementById('autoIdTabResetBtn');
  const tabsContainer = document.getElementById("autoid-tabs");
  const tabs = [];
  const TAB_COUNT = 8;
  const tabData = Array.from({ length: TAB_COUNT }, () => ({
    callType: 3,
    harmonic: 0,
    autoIdResult: null,
    showValidation: false,
    inputs: {
      start: "",
      end: "",
      high: "",
      low: "",
      knee: "",
      heel: "",
      cfStart: "",
      cfEnd: ""
    },
    startTime: null,
    endTime: null,
    markers: {
      start: { el: null, freq: null, time: null },
      end: { el: null, freq: null, time: null },
      high: { el: null, freq: null, time: null },
      low: { el: null, freq: null, time: null },
      knee: { el: null, freq: null, time: null },
      heel: { el: null, freq: null, time: null },
      cfStart: { el: null, freq: null, time: null },
      cfEnd: { el: null, freq: null, time: null }
    },
    line: null,
    resultEl: null,
    curves: {}
  }));
  let currentTab = 0;

  if (!btn || !panel || !viewer) return;

  function togglePanel() {
    const isVisible = panel.style.display === 'block';
    panel.style.display = isVisible ? 'none' : 'block';
    document.body.classList.toggle('autoid-open', !isVisible);
    document.dispatchEvent(new Event(isVisible ? 'autoid-close' : 'autoid-open'));
  }

  function openPanel() {
    if (panel.style.display !== 'block') {
      panel.style.display = 'block';
      document.body.classList.add('autoid-open');
      document.dispatchEvent(new Event('autoid-open'));
    }
  }

  btn.addEventListener('click', togglePanel);
  closeBtn?.addEventListener('click', togglePanel);

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  function onDrag(e) {
    if (!dragging) return;
    panel.style.left = `${e.clientX - offsetX}px`;
    panel.style.top = `${e.clientY - offsetY}px`;
  }

  function stopDrag() {
    dragging = false;
    document.removeEventListener('mousemove', onDrag);
    hideHover();
  }

  dragBar?.addEventListener('mousedown', (e) => {
    dragging = true;
    offsetX = e.clientX - panel.offsetLeft;
    offsetY = e.clientY - panel.offsetTop;
    hideHover();
    document.addEventListener('mousemove', onDrag, { passive: true });
    document.addEventListener('mouseup', stopDrag, { once: true });
    e.preventDefault();
  });

  resetTabBtn?.addEventListener('click', resetCurrentTab);

  const callTypeDropdown = initDropdown('callTypeInput', ['CF-FM','FM-CF-FM','FM','FM-QCF','FM-QCF-FM','QCF']);
  const harmonicDropdown = initDropdown('harmonicInput', ['0','1','2','3']);
  function handleHarmonicChange(value, idx) {
    tabData[currentTab].harmonic = idx;
    if (!suppressResultReset) clearResult();
  }
  harmonicDropdown.onChange = handleHarmonicChange;
  // 暴露給全域使用
  window.handleCallTypeChange = function(value, idx) {
    const hideHighLow = ['CF-FM', 'FM-CF-FM'].includes(value);
    const hideKneeHeel = ['CF-FM', 'FM-CF-FM', 'QCF'].includes(value);
    const hideCf = ['QCF', 'FM-QCF', 'FM', 'FM-QCF-FM'].includes(value);
    toggleRow('high', !hideHighLow);
    toggleRow('low', !hideHighLow);
    toggleRow('knee', !hideKneeHeel);
    toggleRow('heel', !hideKneeHeel);
    toggleRow('cfStart', !hideCf);
    toggleRow('cfEnd', !hideCf);
    tabData[currentTab].callType = idx;
    if (!suppressResultReset) clearResult();
    updateDerived();
    updateLines();
    tabData[currentTab].showValidation = false;
    validateMandatoryInputs();
  };
  callTypeDropdown.onChange = window.handleCallTypeChange;
  if (tabsContainer) {
    tabsContainer.title = 'Prev pulse (Ctrl + ←), Next pulse (Ctrl + →)';
    for (let i = 0; i < TAB_COUNT; i++) {
      const t = document.createElement("button");
      t.textContent = `${i + 1}`;
      t.className = "tab-btn";
      t.title = `Pulse ${i + 1}`;
      if (i === 0) t.classList.add("active");
      t.addEventListener("click", () => switchTab(i));
      tabsContainer.appendChild(t);
      tabs.push(t);
    }
  }

  const inputs = {
    start: document.getElementById('startFreqInput'),
    end: document.getElementById('endFreqInput'),
    high: document.getElementById('highFreqInput'),
    low: document.getElementById('lowFreqInput'),
    knee: document.getElementById('kneeFreqInput'),
    heel: document.getElementById('heelFreqInput'),
    cfStart: document.getElementById('cfStartFreqInput'),
    cfEnd: document.getElementById('cfEndFreqInput'),
  };
  const rows = {
    start: document.getElementById('startFreqRow'),
    end: document.getElementById('endFreqRow'),
    high: document.getElementById('highFreqRow'),
    low: document.getElementById('lowFreqRow'),
    knee: document.getElementById('kneeFreqRow'),
    heel: document.getElementById('heelFreqRow'),
    cfStart: document.getElementById('cfStartFreqRow'),
    cfEnd: document.getElementById('cfEndFreqRow'),
  };
  const bandwidthEl = document.getElementById('bandwidthVal');
  const durationEl = document.getElementById('durationVal');
  const pulseIdBtn = document.getElementById('pulseIdBtn');
  const sequenceIdBtn = document.getElementById('sequenceIdBtn');
  const resultEl = document.getElementById('autoIdResult');
  const bandwidthWarning = document.getElementById('bandwidth-warning');
  const freqOrderWarning = document.getElementById('freq-order-warning');
  const kneeOrderWarning = document.getElementById('knee-order-warning');
  const timeOrderWarning = document.getElementById('time-order-warning');

  function updateWarnings(high, low, knee, bw, startT, endT) {
    const QCFDurationWarning = document.getElementById('QCF-duration-warning');
    const QCFSlopeWarning = document.getElementById('QCF-slope-warning');
    const highFreqWarning = document.getElementById('highfreq-warning');
    const lowFreqWarning = document.getElementById('lowfreq-warning');
    const startfreqWarning = document.getElementById('startfreq-warning');
    const endfreqWarning = document.getElementById('endfreq-warning');
    const callType = callTypeDropdown.items[callTypeDropdown.selectedIndex];
    const HighKneeTimeWarning = document.getElementById('highknee-time-warning');
    const LowKneeTimeWarning = document.getElementById('lowknee-time-warning');
    const HighHeelTimeWarning = document.getElementById('highheel-time-warning');
    const LowHeelTimeWarning = document.getElementById('lowheel-time-warning');
    let showQCFDuration = false;
    let showQCFSlope = false;

    // FM-QCF 檢查
    if (callType === 'FM-QCF') {
      // 取得 marker
      const knee = markers.knee;
      const heel = markers.heel;
      const low = markers.low;
      // 1. Knee, Heel, Low 都有值
      if (knee?.freq != null && knee?.time != null && heel?.freq != null && heel?.time != null && low?.freq != null && low?.time != null) {
        // 以 Knee 與 Heel 計算
        const duration = (heel.time - knee.time) * 1000;
        showQCFDuration = duration < 1;
        const bw = Math.abs(heel.freq - knee.freq);
        if (duration > 0) {
          // compute slope using displayed values so warnings match UI when Time Expansion is active
          const freqMul = freqDisplayMultiplier();
          const timeDenom = getTimeExpansionMode() ? 10 : 1;
          const dispBw = bw * freqMul; // kHz displayed
          const dispDur = duration / timeDenom; // ms displayed
          if (dispDur > 0) {
            const slope = dispBw / dispDur;
            showQCFSlope = !(slope < 1 && slope >= 0.1);
          }
        }
      } else if (knee?.freq != null && knee?.time != null && low?.freq != null && low?.time != null && (heel?.freq == null || heel?.time == null)) {
        // 2. Knee, Low 有值，Heel 無值
        const duration = (low.time - knee.time) * 1000;
        showQCFDuration = duration < 1;
        const bw = Math.abs(low.freq - knee.freq);
        if (duration > 0) {
          const freqMul = freqDisplayMultiplier();
          const timeDenom = getTimeExpansionMode() ? 10 : 1;
          const dispBw = bw * freqMul;
          const dispDur = duration / timeDenom;
          if (dispDur > 0) {
            const slope = dispBw / dispDur;
            showQCFSlope = !(slope < 1 && slope >= 0.1);
          }
        }
      }
    }
    // QCF 檢查（原本的 QCF 類型）
    if (callType === 'QCF') {
      let duration = null;
      const markerTimes = Object.values(markers)
        .filter(m => m.time != null && !isNaN(m.time))
        .map(m => m.time);
      if (markerTimes.length >= 2) {
        const maxTime = Math.max(...markerTimes);
        const minTime = Math.min(...markerTimes);
        duration = Math.abs(maxTime - minTime) * 1000;
        showQCFDuration = duration < 1;
      }
      if (bw != null && duration != null && duration > 0) {
        const freqMul = freqDisplayMultiplier();
        const timeDenom = getTimeExpansionMode() ? 10 : 1;
        const dispBw = bw * freqMul;
        const dispDur = duration / timeDenom;
        if (dispDur > 0) {
          const slope = dispBw / dispDur;
          showQCFSlope = !(slope < 1 && slope >= 0.1);
        }
      }
    }
    
    // 新增高低頻檢查
    const markerFreqs = Object.values(markers)
      .filter(m => m.freq != null && !isNaN(m.freq))
      .map(m => m.freq);
    let showHighFreqWarning = false;
    let showLowFreqWarning = false;
    
    if (markerFreqs.length > 1) {
      const maxFreq = Math.max(...markerFreqs);
      const minFreq = Math.min(...markerFreqs);
      
      // 只在high freq有值時檢查
      if (inputs.high.value !== '') {
        const highFreq = markers.high?.freq;
        if (!isNaN(highFreq) && highFreq !== maxFreq) {
          showHighFreqWarning = true;
        }
      }
      
      // 只在low freq有值時檢查
      if (inputs.low.value !== '') {
        const lowFreq = markers.low?.freq;
        if (!isNaN(lowFreq) && lowFreq !== minFreq) {
          showLowFreqWarning = true;
        }
      }
    }
    
    // 檢查 Start freq 和 End freq 的時間順序
    let showStartFreqWarning = false;
    let showEndFreqWarning = false;
    
    // 取得所有有效的時間標記
    const markerTimes = Object.values(markers)
      .filter(m => m.time != null && !isNaN(m.time))
      .map(m => m.time);
      
    if (markerTimes.length > 0) {
      const minTime = Math.min(...markerTimes);
      const maxTime = Math.max(...markerTimes);
      
      // 檢查 Start freq
      if (inputs.start.value !== '' && markers.start?.time !== null) {
        if (markers.start.time > minTime) {
          showStartFreqWarning = true;
        }
      }
      
      // 檢查 End freq
      if (inputs.end.value !== '' && markers.end?.time !== null) {
        if (markers.end.time < maxTime) {
          showEndFreqWarning = true;
        }
      }
    }
    
  // const showKneeOrder = !isNaN(knee) && !isNaN(low) && knee < low;
  let hasWarnings = showQCFDuration || showQCFSlope || showHighFreqWarning || 
             showLowFreqWarning || showStartFreqWarning || 
             showEndFreqWarning;
    // 新增 Knee/Heel/High/Low time 順序檢查
    let showHighKneeTimeWarning = false;
    let showLowKneeTimeWarning = false;
    let showHighHeelTimeWarning = false;
    let showLowHeelTimeWarning = false;

    // 檢查 Knee 順序
    if (inputs.knee.value !== '' && markers.knee?.time != null) {
      if (inputs.high.value !== '' && markers.high?.time != null) {
        if (markers.knee.time <= markers.high.time) {
          showHighKneeTimeWarning = true;
        }
      }
      if (inputs.low.value !== '' && markers.low?.time != null) {
        if (markers.knee.time >= markers.low.time) {
          showLowKneeTimeWarning = true;
        }
      }
    }
    // 檢查 Heel 順序
    if (inputs.heel.value !== '' && markers.heel?.time != null) {
      if (inputs.high.value !== '' && markers.high?.time != null) {
        if (markers.heel.time <= markers.high.time) {
          showHighHeelTimeWarning = true;
        }
      }
      if (inputs.low.value !== '' && markers.low?.time != null) {
        if (markers.heel.time >= markers.low.time) {
          showLowHeelTimeWarning = true;
        }
      }
    } 

    hasWarnings = hasWarnings || showHighKneeTimeWarning || showLowKneeTimeWarning || 
                  showHighHeelTimeWarning || showLowHeelTimeWarning;
    
    if (inputs.high) inputs.high.classList.toggle('warning', showHighFreqWarning);
  if (inputs.low) inputs.low.classList.toggle('warning', showLowFreqWarning || (callType === 'FM-QCF' && (showQCFDuration || showQCFSlope) && !markers.heel?.time));
  if (inputs.knee) inputs.knee.classList.toggle('warning', showHighKneeTimeWarning || showLowKneeTimeWarning || (callType === 'FM-QCF' && (showQCFDuration || showQCFSlope)));
  if (inputs.heel) inputs.heel.classList.toggle('warning', showHighHeelTimeWarning || showLowHeelTimeWarning || (callType === 'FM-QCF' && markers.heel?.time && (showQCFDuration || showQCFSlope)));
    if (inputs.start) inputs.start.classList.toggle('warning', showStartFreqWarning || (callType === 'QCF' && (showQCFDuration || showQCFSlope)));
    if (inputs.end) inputs.end.classList.toggle('warning', showEndFreqWarning || (callType === 'QCF' && (showQCFDuration || showQCFSlope)));
    
    if (QCFDurationWarning) {
      QCFDurationWarning.style.display = showQCFDuration ? 'flex' : 'none';
      QCFDurationWarning.textContent = 'Duration of QCF should be >= 1ms';
    }
    if (QCFSlopeWarning) {
      QCFSlopeWarning.style.display = showQCFSlope ? 'flex' : 'none';
      QCFSlopeWarning.textContent = 'Slope of QCF should be <1 and >=0.1kHz/ms';
    }
    if (highFreqWarning) {
      highFreqWarning.style.display = showHighFreqWarning ? 'flex' : 'none';
      highFreqWarning.textContent = 'High frequency should be the highest one';
    }
    if (lowFreqWarning) {
      lowFreqWarning.style.display = showLowFreqWarning ? 'flex' : 'none';
      lowFreqWarning.textContent = 'Low frequency should be the lowest one';
    }
        if (HighKneeTimeWarning) {
          HighKneeTimeWarning.style.display = showHighKneeTimeWarning ? 'flex' : 'none';
          HighKneeTimeWarning.textContent = 'Knee frequency should come after High frequency';
        }
        if (LowKneeTimeWarning) {
          LowKneeTimeWarning.style.display = showLowKneeTimeWarning ? 'flex' : 'none';
          LowKneeTimeWarning.textContent = 'Knee frequency should come before Low frequency';
        }
        if (HighHeelTimeWarning) {
          HighHeelTimeWarning.style.display = showHighHeelTimeWarning ? 'flex' : 'none';
          HighHeelTimeWarning.textContent = 'Heel frequency should come after High frequency';
        }
        if (LowHeelTimeWarning) {
          LowHeelTimeWarning.style.display = showLowHeelTimeWarning ? 'flex' : 'none';
          LowHeelTimeWarning.textContent = 'Heel frequency should come before Low frequency';
        }
    if (startfreqWarning) {
      startfreqWarning.style.display = showStartFreqWarning ? 'flex' : 'none';
      startfreqWarning.textContent = 'Start frequency should be the first one';
    }
    if (endfreqWarning) {
      endfreqWarning.style.display = showEndFreqWarning ? 'flex' : 'none';
      endfreqWarning.textContent = 'End frequency should be the last one';
    }
    if (pulseIdBtn) pulseIdBtn.disabled = hasWarnings;
    if (sequenceIdBtn) sequenceIdBtn.disabled = hasWarnings;
  }

  const markerColors = {
    start: '#e74c3c',
    end: '#004cff',
    high: '#3498db',
    low: '#9b59b6',
    knee: '#f39c12',
    heel: '#16a085',
    cfStart: '#e67e22',
    cfEnd: '#1abc9c'
  };

  const markerTitles = {
    start: 'Start freq.',
    end: 'End freq.',
    high: 'High freq.',
    low: 'Low freq.',
    knee: 'Knee freq.',
    heel: 'Heel freq.',
    cfStart: 'CF start',
    cfEnd: 'CF end'
  };

  let markers = tabData[currentTab].markers;

  let active = null;
  let startTime = null;
  let endTime = null;
  let draggingKey = null;
  let draggingEl = null;
  let draggingHandle = null;
  let activeMarkerKey = null;
  let markersEnabled = true;
  let suppressResultReset = false;
  let markerWasDragged = false;
  let ctrlPressed = false;

  function showHandlesForMarker(key) {
    activeMarkerKey = key;
    updateHandleVisibility();
  }

  function hideHandles() {
    activeMarkerKey = null;
    updateHandleVisibility();
  }

  function updateHandleVisibility() {
    tabData.forEach((tab, idx) => {
      Object.values(tab.curves || {}).forEach(curve => {
        const showCp1 = idx === currentTab && activeMarkerKey === curve.p1Key;
        const showCp2 = idx === currentTab && activeMarkerKey === curve.p2Key;
        if (curve.cp1El) curve.cp1El.style.display = showCp1 ? 'block' : 'none';
        if (curve.cp1LineEl) curve.cp1LineEl.style.display = showCp1 ? 'block' : 'none';
        if (curve.cp2El) curve.cp2El.style.display = showCp2 ? 'block' : 'none';
        if (curve.cp2LineEl) curve.cp2LineEl.style.display = showCp2 ? 'block' : 'none';
      });
    });
  }

  document.addEventListener('click', hideHandles);

  function updateResultDisplay() {
    const res = tabData[currentTab].autoIdResult;
    if (resultEl) {
      if (res) {
        resultEl.innerHTML = formatSpeciesResult(res);
      } else {
        resultEl.textContent = '-';
      }
    }
  }

  function clearResult() {
    if (tabData[currentTab].autoIdResult != null) {
      tabData[currentTab].autoIdResult = null;
      updateResultDisplay();
      updateMarkers();
    }
  }
  function saveCurrentTab() {
    const data = tabData[currentTab];
    data.callType = callTypeDropdown.selectedIndex;
    data.harmonic = harmonicDropdown.selectedIndex;
    data.startTime = startTime;
    data.endTime = endTime;
    // store internal (unscaled) frequency values so loadTab can render according
    // to current Time Expansion mode
    Object.keys(inputs).forEach(k => {
      const el = inputs[k];
      if (!el) { data.inputs[k] = ''; return; }
      const val = el.value === '' ? '' : String(parseDisplayedFreq(el));
      data.inputs[k] = val;
    });
  }

  function loadTab(idx) {
    const data = tabData[idx];
    markers = data.markers;
    suppressResultReset = true;
    callTypeDropdown.select(data.callType);
    harmonicDropdown.select(data.harmonic);
    suppressResultReset = false;
    Object.keys(inputs).forEach(k => {
      const el = inputs[k];
      if (!el) return;
      const stored = data.inputs[k];
      if (stored === null || stored === undefined || stored === '') {
        el.value = '';
      } else {
        const num = parseFloat(stored);
        el.value = isNaN(num) ? '' : formatFreqForDisplay(num);
      }
      if (data.markers[k].time != null) {
        el.dataset.time = data.markers[k].time;
      } else {
        delete el.dataset.time;
      }
    });
    startTime = data.startTime;
    endTime = data.endTime;
    updateDerived();
    updateMarkers();
    updateResultDisplay();
    validateMandatoryInputs();
  }

  function switchTab(idx) {
    if (idx === currentTab) return;
    saveCurrentTab();
    if (tabs[currentTab]) tabs[currentTab].classList.remove("active");
    currentTab = idx;
    if (tabs[currentTab]) tabs[currentTab].classList.add("active");
    activeMarkerKey = null;
    loadTab(idx);
  }

  function setMarkerInteractivity(enabled) {
    markersEnabled = enabled;
    document.body.classList.toggle('markers-disabled', !enabled);
  }

  setMarkerInteractivity(true);

  Object.entries(inputs).forEach(([key, el]) => {
    if (!el) return;
    el.dataset.key = key;
    el.readOnly = true;
    el.addEventListener('click', () => {
      if (active === el) {
        el.classList.remove('active-get');
        active = null;
        setMarkerInteractivity(true);
        return;
      }
      if (active) active.classList.remove('active-get');
      active = el;
      el.classList.add('active-get');
      setMarkerInteractivity(false);
    });
  });

  function resetField(key) {
    const input = inputs[key];
    if (!input) return;
    input.value = '';
    delete input.dataset.time;
    input.classList.remove('active-get');
    input.classList.remove('invalid');
    input.classList.remove('warning');
    markers[key].freq = null;
    markers[key].time = null;
    if (markers[key].el) markers[key].el.style.display = 'none';
    if (key === 'start') startTime = null;
    if (key === 'end') endTime = null;
    tabData[currentTab].inputs[key] = '';
    tabData[currentTab].markers[key].freq = null;
    tabData[currentTab].markers[key].time = null;
    tabData[currentTab].startTime = startTime;
    tabData[currentTab].endTime = endTime;
    updateDerived();
    updateMarkers();
    if (!suppressResultReset) clearResult();
    validateMandatoryInputs();
  }

  const resetButtons = {};
  panel.querySelectorAll('.autoid-marker[data-key]').forEach(btn => {
    const key = btn.dataset.key;
    resetButtons[key] = btn;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      resetField(key);
    });
  });

  function toggleRow(key, show) {
    const row = rows[key];
    if (!row) return;
    row.style.display = show ? 'flex' : 'none';
    if (inputs[key]) inputs[key].disabled = !show;
    const btn = resetButtons[key];
    if (btn) btn.disabled = !show;
    if (!show) resetField(key);
    validateMandatoryInputs();
  }

  function handleCallTypeChange(value, idx) {
    const hideHighLow = ['CF-FM', 'FM-CF-FM'].includes(value);
    const hideKneeHeel = ['CF-FM', 'FM-CF-FM', 'QCF'].includes(value);
    const hideCf = ['QCF', 'FM-QCF', 'FM', 'FM-QCF-FM'].includes(value);
    toggleRow('high', !hideHighLow);
    toggleRow('low', !hideHighLow);
    toggleRow('knee', !hideKneeHeel);
    toggleRow('heel', !hideKneeHeel);
    toggleRow('cfStart', !hideCf);
    toggleRow('cfEnd', !hideCf);
    tabData[currentTab].callType = idx;
    if (!suppressResultReset) clearResult();
    updateDerived();
    updateLines();
    tabData[currentTab].showValidation = false;
    validateMandatoryInputs();
  }

  callTypeDropdown.onChange = handleCallTypeChange;
  harmonicDropdown.select(0);
  callTypeDropdown.select(3);
  loadTab(0);

  function updateDerived() {
    const callType = callTypeDropdown.items[callTypeDropdown.selectedIndex];
    // parse displayed frequency inputs (UI may be scaled in Time Expansion mode)
    const freqDiv = getTimeExpansionMode() ? 10 : 1;
    const parseInputFreq = (el) => {
      if (!el) return NaN;
      const v = el.value === '' ? NaN : parseFloat(el.value);
      return isNaN(v) ? NaN : (v / freqDiv);
    };
    const high = parseInputFreq(inputs.high);
    const low = parseInputFreq(inputs.low);
    const knee = parseInputFreq(inputs.knee);
    const cfStartVal = parseInputFreq(inputs.cfStart);
    const endVal = parseInputFreq(inputs.end);
    let bandwidth = null;
    // 新 Bandwidth 計算：取所有 marker 中有 freq 且有 value 的，找最大最小 freq
    const markerFreqs = Object.values(markers)
      .filter(m => m.freq != null && !isNaN(m.freq) && m.el && m.el.value !== "")
      .map(m => m.freq);
    if (markerFreqs.length >= 2) {
      const maxFreq = Math.max(...markerFreqs);
      const minFreq = Math.min(...markerFreqs);
      bandwidth = maxFreq - minFreq;
      // display bandwidth adjusted for Time Expansion mode
      const dispBw = bandwidth * (getTimeExpansionMode() ? 10 : 1);
      bandwidthEl.textContent = dispBw.toFixed(1);
    } else {
      bandwidthEl.textContent = '-';
    }
    const times = Object.values(markers)
      .filter((m) => m.time != null && !isNaN(m.freq))
      .map((m) => m.time);
    if (times.length >= 2) {
      const max = Math.max(...times);
      const min = Math.min(...times);
      // display duration adjusted for Time Expansion mode (show longer when expanded)
      const durMs = (max - min) * 1000;
      // Use the centralized formatter so Time Expansion scaling is consistent
      durationEl.textContent = formatDurationForDisplay(durMs);
    } else {
      durationEl.textContent = '-';
    }
    updateWarnings(high, low, knee, bandwidth, startTime, endTime);
  }

  function createMarkerEl(key, tabIdx) {
    const el = document.createElement('i');
    el.className = `fa-solid fa-xmark freq-marker marker-${key}`;
    el.style.color = markerColors[key];
    el.dataset.key = key;
    el.dataset.tab = tabIdx;
    const title = markerTitles[key] || key;
    el.dataset.title = title;
    el.setAttribute('aria-label', title);
    el.addEventListener('mouseenter', hideHover);
    el.addEventListener('mouseleave', refreshHover);
    el.addEventListener('mousedown', (ev) => {
      if (!markersEnabled) return;
      ev.stopPropagation();
      hideHover();
      viewer.classList.add('hide-cursor');
      el.classList.add('hide-cursor');
      draggingKey = key;
      draggingEl = el;
      markerWasDragged = false;
      document.addEventListener('mousemove', onMarkerDrag, { passive: true });
      document.addEventListener('mouseup', stopMarkerDrag, { once: true });
    });
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (markerWasDragged) {
        markerWasDragged = false;
        return;
      }
      // 檢查是否已建立 handle，若未建立則建立
      const tab = tabData[tabIdx];
      let hasHandle = false;
      Object.values(tab.curves || {}).forEach(curve => {
        if ((curve.p1Key === key || curve.p2Key === key) && (curve.cp1El || curve.cp2El)) {
          hasHandle = true;
        }
      });
      if (!hasHandle) {
        updateLines(); // 觸發 path 生成與 handle 建立
      }
      showHandlesForMarker(key);
    });
    overlay.appendChild(el);
    return el;
  }

  function createHandleEl(tabIdx, segKey, handleKey) {
    const el = document.createElement('div');
    el.className = 'path-handle';
    el.dataset.tab = tabIdx;
    el.dataset.seg = segKey;
    el.dataset.handle = handleKey;
    el.addEventListener('mousedown', (ev) => {
      if (!markersEnabled) return;
      ev.stopPropagation();
      hideHover();
      viewer.classList.add('hide-cursor');
      el.classList.add('hide-cursor');
      document.querySelectorAll('.freq-marker').forEach(m => m.classList.add('hide-cursor'));
      document.querySelectorAll('.path-handle').forEach(h => h.classList.add('dragging'));
      document.querySelectorAll('.handle-connector').forEach(l => l.classList.add('dragging'));
      draggingHandle = { tabIdx, segKey, handleKey, el };
      document.addEventListener('mousemove', onHandleDrag, { passive: true });
      document.addEventListener('mouseup', stopHandleDrag, { once: true });
    });
    el.addEventListener('mouseenter', hideHover);
    el.addEventListener('mouseleave', refreshHover);
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    el.addEventListener('click', (ev) => ev.stopPropagation());
    el.style.display = 'none';
    overlay.appendChild(el);
    return el;
  }

  function createResultEl(tabIdx) {
    const el = document.createElement('div');
    el.className = 'pulseid-result';
    el.dataset.tab = tabIdx;
    overlay.appendChild(el);
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openPanel();
      switchTab(tabIdx);
    });
    el.addEventListener('mouseenter', hideHover);
    el.addEventListener('mouseleave', refreshHover);
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    return el;
  }

  function updateMarkers() {
    const { min, max } = getFreqRange();
    const actualWidth = container.scrollWidth;
    tabData.forEach((tab, idx) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let hasAny = false;
      Object.entries(tab.markers).forEach(([key, m]) => {
        if (!m.el) m.el = createMarkerEl(key, idx);
        if (m.freq == null || m.time == null) {
          m.el.style.display = 'none';
          return;
        }
        const x = (m.time / getDuration()) * actualWidth - viewer.scrollLeft;
        const y = (1 - (m.freq - min) / (max - min)) * spectrogramHeight;
        m.el.style.left = `${x}px`;
        m.el.style.top = `${y}px`;
        m.el.style.display = 'block';
        m.el.style.pointerEvents = (idx === currentTab && !ctrlPressed) ? 'auto' : 'none';
        m.el.style.opacity = idx === currentTab ? '1' : '0.5';
        m.el.dataset.freq = m.freq;
        m.el.dataset.time = m.time;
      // 動態更新 data-title 內容
  const title = `${markerTitles[key] || key} (${formatFreqForDisplay(Number(m.freq))} kHz)`;
  m.el.dataset.title = title;
  m.el.setAttribute('aria-label', title);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        hasAny = true;
      });
      if (!tab.resultEl) tab.resultEl = createResultEl(idx);
      const rEl = tab.resultEl;
      if (tab.autoIdResult && hasAny) {
        rEl.innerHTML = formatSpeciesResult(tab.autoIdResult);
        rEl.style.left = `${(minX + maxX) / 2}px`;
        rEl.style.top = `${maxY + 20}px`;
        rEl.style.display = 'block';
        rEl.classList.toggle('inactive', idx !== currentTab);
      } else {
        rEl.style.display = 'none';
      }
    });
    updateLines();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Control' && !ctrlPressed) {
      ctrlPressed = true;
      updateMarkers();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Control' && ctrlPressed) {
      ctrlPressed = false;
      updateMarkers();
    }
  });

  function xyToTimeFreq(x, y) {
    const scrollLeft = viewer.scrollLeft || 0;
    const { min, max } = getFreqRange();
    const time = ((x + scrollLeft) / container.scrollWidth) * getDuration();
    const freq = (1 - y / spectrogramHeight) * (max - min) + min;
    return { time, freq };
  }

  function timeFreqToXY(time, freq) {
    const actualWidth = container.scrollWidth;
    const { min, max } = getFreqRange();
    const x = (time / getDuration()) * actualWidth - viewer.scrollLeft;
    const y = (1 - (freq - min) / (max - min)) * spectrogramHeight;
    return { x, y };
  }

  function updateLines() {
    const { min, max } = getFreqRange();
    const actualWidth = container.scrollWidth;
    tabData.forEach((tab, idx) => {
      if (!tab.line) {
        tab.line = document.createElementNS(svgNS, 'path');
        tab.line.dataset.tab = idx;
        linesSvg.appendChild(tab.line);
      }
      const points = Object.entries(tab.markers)
        .filter(([_, m]) => m.freq != null && m.time != null)
        .sort((a, b) => a[1].time - b[1].time)
        .map(([key, m]) => {
          const x = (m.time / getDuration()) * actualWidth - viewer.scrollLeft;
          const y = (1 - (m.freq - min) / (max - min)) * spectrogramHeight;
          return { x, y, key };
        });
      if (points.length < 2) {
        tab.line.setAttribute('d', '');
        tab.line.style.display = 'none';
        Object.values(tab.curves || {}).forEach(c => {
          c.cp1El?.remove();
          c.cp2El?.remove();
          c.cp1LineEl?.remove();
          c.cp2LineEl?.remove();
        });
        tab.curves = {};
        return;
      }
      const d = makeRoundedPath(points, tab, idx);
      tab.line.setAttribute('stroke-linejoin', 'round');
      tab.line.setAttribute('d', d);
      tab.line.style.display = 'block';
      tab.line.style.opacity = idx === currentTab ? '1' : '0.5';
    });
    updateHandleVisibility();
  }

  function makeRoundedPath(points, tab, tabIdx, tension = 0.5) {
    if (points.length < 2) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    const maxVerticalOffset = 10; // 全域最大垂直偏移限制
    const usedSegKeys = [];

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const segKey = `${p1.key}-${p2.key}`;
      usedSegKeys.push(segKey);

      const isLastSegment = (i === points.length - 2);
      const yDiff = Math.abs(p1.y - p2.y);

      if (p1.key === 'cfStart' && p2.key === 'cfEnd') {
        if (tab.curves[segKey]) {
          tab.curves[segKey].cp1El?.remove();
          tab.curves[segKey].cp2El?.remove();
          tab.curves[segKey].cp1LineEl?.remove();
          tab.curves[segKey].cp2LineEl?.remove();
          delete tab.curves[segKey];
        }
        d += ` L ${p2.x} ${p2.y}`;
        continue;
      } else if (isLastSegment && yDiff < 5) {
        if (tab.curves[segKey]) {
          tab.curves[segKey].cp1El?.remove();
          tab.curves[segKey].cp2El?.remove();
          tab.curves[segKey].cp1LineEl?.remove();
          tab.curves[segKey].cp2LineEl?.remove();
          delete tab.curves[segKey];
        }
        d += ` L ${p1.x} ${p2.y} L ${p2.x} ${p2.y}`;
        continue;
      }

      if (!tab.curves[segKey]) tab.curves[segKey] = {};
      const curve = tab.curves[segKey];
      curve.p1Key = p1.key;
      curve.p2Key = p2.key;
      let cp1x, cp1y, cp2x, cp2y;
      const isDraggingSeg = draggingKey && (p1.key === draggingKey || p2.key === draggingKey);

      if (!isDraggingSeg && curve.cp1 && curve.cp2) {
        ({ x: cp1x, y: cp1y } = timeFreqToXY(curve.cp1.time, curve.cp1.freq));
        ({ x: cp2x, y: cp2y } = timeFreqToXY(curve.cp2.time, curve.cp2.freq));
      } else {
        cp1x = p1.x + (p2.x - p0.x) * tension / 6;
        cp1y = p1.y + (p2.y - p0.y) * tension / 6;
        cp2x = p2.x - (p3.x - p1.x) * tension / 6;
        cp2y = p2.y - (p3.y - p1.y) * tension / 6;

        if (p1.key === 'high' && p2.key === 'knee') {
          const currLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          const nextLen = Math.hypot(p3.x - p2.x, p3.y - p2.y);
          const factor = currLen ? 1 + (nextLen / currLen) * 2 : 1;
          cp2x = p2.x - (p3.x - p1.x) * tension / 6 * factor;
          cp2y = p2.y - (p3.y - p1.y) * tension / 6 * factor;
        }

        if (p2.key !== 'cfStart' && p2.key !== 'end') {
          const dy = Math.abs(p1.y - p2.y);
          const localMaxOffset = Math.min(maxVerticalOffset, dy * 0.6);
          cp2y = Math.min(cp2y, p2.y + localMaxOffset);
          cp2x = Math.min(cp2x, p2.x);
        }

        const cp1tf = xyToTimeFreq(cp1x, cp1y);
        const cp2tf = xyToTimeFreq(cp2x, cp2y);
        curve.cp1 = cp1tf;
        curve.cp2 = cp2tf;
      }

      if (!isDraggingSeg) {
        if (!curve.cp1El) curve.cp1El = createHandleEl(tabIdx, segKey, 'cp1');
        if (!curve.cp2El) curve.cp2El = createHandleEl(tabIdx, segKey, 'cp2');
        if (!curve.cp1LineEl) {
          curve.cp1LineEl = document.createElementNS(svgNS, 'line');
          curve.cp1LineEl.classList.add('handle-connector');
          curve.cp1LineEl.style.display = 'none';
          curve.cp1LineEl.setAttribute('stroke', '#4b0082');
          curve.cp1LineEl.setAttribute('stroke-width', '1');
          linesSvg.appendChild(curve.cp1LineEl);
        }
        if (!curve.cp2LineEl) {
          curve.cp2LineEl = document.createElementNS(svgNS, 'line');
          curve.cp2LineEl.classList.add('handle-connector');
          curve.cp2LineEl.style.display = 'none';
          curve.cp2LineEl.setAttribute('stroke', '#4b0082');
          curve.cp2LineEl.setAttribute('stroke-width', '1');
          linesSvg.appendChild(curve.cp2LineEl);
        }

        curve.cp1El.style.left = `${cp1x}px`;
        curve.cp1El.style.top = `${cp1y}px`;
        curve.cp2El.style.left = `${cp2x}px`;
        curve.cp2El.style.top = `${cp2y}px`;

        const handleRadius = 5;

        curve.cp1LineEl.setAttribute('x1', p1.x);
        curve.cp1LineEl.setAttribute('y1', p1.y);
        const dx1 = cp1x - p1.x;
        const dy1 = cp1y - p1.y;
        const len1 = Math.hypot(dx1, dy1) || 1;
        const cp1EdgeX = cp1x - (dx1 / len1) * handleRadius;
        const cp1EdgeY = cp1y - (dy1 / len1) * handleRadius;
        curve.cp1LineEl.setAttribute('x2', cp1EdgeX);
        curve.cp1LineEl.setAttribute('y2', cp1EdgeY);

        curve.cp2LineEl.setAttribute('x1', p2.x);
        curve.cp2LineEl.setAttribute('y1', p2.y);
        const dx2 = cp2x - p2.x;
        const dy2 = cp2y - p2.y;
        const len2 = Math.hypot(dx2, dy2) || 1;
        const cp2EdgeX = cp2x - (dx2 / len2) * handleRadius;
        const cp2EdgeY = cp2y - (dy2 / len2) * handleRadius;
        curve.cp2LineEl.setAttribute('x2', cp2EdgeX);
        curve.cp2LineEl.setAttribute('y2', cp2EdgeY);
      } else {
        curve.cp1El?.remove();
        curve.cp2El?.remove();
        curve.cp1LineEl?.remove();
        curve.cp2LineEl?.remove();
        delete curve.cp1El;
        delete curve.cp2El;
        delete curve.cp1LineEl;
        delete curve.cp2LineEl;
      }

      d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
    }

    Object.keys(tab.curves).forEach(k => {
      if (!usedSegKeys.includes(k)) {
        const c = tab.curves[k];
        c.cp1El?.remove();
        c.cp2El?.remove();
        c.cp1LineEl?.remove();
        c.cp2LineEl?.remove();
        delete tab.curves[k];
      }
    });

    return d;
  }

  function resetCurvesForMarker(key, tabIdx = currentTab) {
    const tab = tabData[tabIdx];
    Object.entries(tab.curves || {}).forEach(([segKey, curve]) => {
      if (curve.p1Key === key || curve.p2Key === key) {
        curve.cp1El?.remove();
        curve.cp2El?.remove();
        curve.cp1LineEl?.remove();
        curve.cp2LineEl?.remove();
        delete tab.curves[segKey];
      }
    });
    hideHandles();
  }

  function onMarkerDrag(e) {
    if (!draggingKey || !markersEnabled) return;
    if (!markerWasDragged) {
      markerWasDragged = true;
    }
    const rect = viewer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scrollLeft = viewer.scrollLeft || 0;
    const { min, max } = getFreqRange();
    const freq = (1 - y / spectrogramHeight) * (max - min) + min;
    const time = ((x + scrollLeft) / container.scrollWidth) * getDuration();
    const input = inputs[draggingKey];
    if (input) {
      input.value = formatFreqForDisplay(freq);
      input.dataset.time = time;
      if (input === inputs.start) startTime = time;
      if (input === inputs.end) endTime = time;
    }
    tabData[currentTab].startTime = startTime;
    tabData[currentTab].endTime = endTime;
    markers[draggingKey].freq = freq;
    markers[draggingKey].time = time;

    // 在每次拖動時找出並更新相鄰的 markers path
    const markerEntries = Object.entries(markers)
      .filter(([k, m]) => m.freq != null && m.time != null)
      .sort((a, b) => a[1].time - b[1].time);
    const idx = markerEntries.findIndex(([k]) => k === draggingKey);
    // 移除相關 curves 以重新計算
    if (idx > 0) resetCurvesForMarker(markerEntries[idx - 1][0]);
    resetCurvesForMarker(draggingKey);
    if (idx < markerEntries.length - 1) resetCurvesForMarker(markerEntries[idx + 1][0]);

    updateDerived();
    updateMarkers(); // 這會調用 updateLines() 重新計算和繪製所有 path
  }

  function stopMarkerDrag() {
    const key = draggingKey;
    draggingKey = null;
    if (draggingEl) {
      draggingEl.classList.remove('hide-cursor');
      draggingEl = null;
    }
    document.removeEventListener('mousemove', onMarkerDrag);
    viewer.classList.remove('hide-cursor');
    refreshHover();
    validateMandatoryInputs();
    clearResult();
    if (key && markerWasDragged) {
      // 找出 time 上排序的 marker key
      const markerEntries = Object.entries(markers)
        .filter(([k, m]) => m.freq != null && m.time != null)
        .sort((a, b) => a[1].time - b[1].time);
      const idx = markerEntries.findIndex(([k]) => k === key);
      // 取得相鄰 marker key 並重置 path
      if (idx > 0) resetCurvesForMarker(markerEntries[idx - 1][0]);
      resetCurvesForMarker(key);
      if (idx < markerEntries.length - 1) resetCurvesForMarker(markerEntries[idx + 1][0]);
      updateLines();
    }
  }

  function onHandleDrag(e) {
    if (!draggingHandle || !markersEnabled) return;
    const rect = viewer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { time, freq } = xyToTimeFreq(x, y);
    const { tabIdx, segKey, handleKey } = draggingHandle;
    const curve = tabData[tabIdx].curves[segKey];
    if (curve) {
      curve[handleKey] = { time, freq };
    }
    updateLines();
  }

  function stopHandleDrag() {
    if (!draggingHandle) return;
    draggingHandle.el.classList.remove('hide-cursor');
    // 拖動結束時移除半透明與游標隱藏
    document.querySelectorAll('.path-handle').forEach(h => h.classList.remove('dragging'));
    document.querySelectorAll('.handle-connector').forEach(l => l.classList.remove('dragging'));
    document.querySelectorAll('.freq-marker').forEach(m => m.classList.remove('hide-cursor'));
    draggingHandle = null;
    document.removeEventListener('mousemove', onHandleDrag);
    viewer.classList.remove('hide-cursor');
    refreshHover();
    clearResult();
  }

  function setMarkerAt(key, freq, time) {
  const input = inputs[key];
  if (!input) return;
  input.value = formatFreqForDisplay(freq);
    input.dataset.time = time;
    markers[key].freq = freq;
    markers[key].time = time;
    if (key === 'start') startTime = time;
    if (key === 'end') endTime = time;
    tabData[currentTab].startTime = startTime;
    tabData[currentTab].endTime = endTime;

    // 找出 time 上排序的 marker key
    const markerEntries = Object.entries(markers)
      .filter(([k, m]) => m.freq != null && m.time != null)
      .sort((a, b) => a[1].time - b[1].time);
    const idx = markerEntries.findIndex(([k]) => k === key);
    // 取得相鄰 marker key
    const affectedKeys = [key];
    if (idx > 0) affectedKeys.push(markerEntries[idx - 1][0]);
    if (idx < markerEntries.length - 1) affectedKeys.push(markerEntries[idx + 1][0]);
    // 對自己與相鄰 marker 都重置 path
    affectedKeys.forEach(k => resetCurvesForMarker(k, currentTab));

    updateDerived();
    updateMarkers();
    clearResult();
    validateMandatoryInputs();
  }

  function removeMarker(key) {
    resetField(key);
  }

  function isFieldEnabled(key) {
    const input = inputs[key];
    return input && !input.disabled;
  }

  function resetTabData(tab) {
    tab.callType = 3;
    tab.harmonic = 0;
    tab.autoIdResult = null;
    tab.showValidation = false;
    Object.keys(tab.inputs).forEach(k => { tab.inputs[k] = ""; });
    tab.startTime = null;
    tab.endTime = null;
    Object.values(tab.markers).forEach(m => {
      m.freq = null;
      m.time = null;
      if (m.el) m.el.style.display = 'none';
    });
    Object.values(tab.curves || {}).forEach(c => {
      c.cp1El?.remove();
      c.cp2El?.remove();
      c.cp1LineEl?.remove();
      c.cp2LineEl?.remove();
    });
    tab.curves = {};
    if (tab.line) {
      tab.line.setAttribute('d', '');
      tab.line.style.display = 'none';
    }
  }

  function resetCurrentTab() {
    tabData[currentTab].showValidation = false;
    resetTabData(tabData[currentTab]);
    callTypeDropdown.select(3);
    harmonicDropdown.select(0);
    Object.values(inputs).forEach(el => {
      if (!el) return;
      el.value = "";
      delete el.dataset.time;
      el.classList.remove('active-get');
      el.classList.remove('invalid');
      el.classList.remove('warning');
    });
    bandwidthEl.textContent = '-';
    durationEl.textContent = '-';
    startTime = null;
    endTime = null;
    active = null;
    tabData[currentTab].autoIdResult = null;
    activeMarkerKey = null;
    setMarkerInteractivity(true);
    loadTab(currentTab);
  }

  function reset() {
    tabData.forEach(d => {
      d.showValidation = false;
      d.callType = 3;
      d.harmonic = 0;
      d.autoIdResult = null;
      Object.keys(d.inputs).forEach(k => { d.inputs[k] = ""; });
      d.startTime = null;
      d.endTime = null;
      Object.keys(d.markers).forEach(k => { d.markers[k].freq = null; d.markers[k].time = null; });
      Object.values(d.curves || {}).forEach(c => { c.cp1El?.remove(); c.cp2El?.remove(); c.cp1LineEl?.remove(); c.cp2LineEl?.remove(); });
      d.curves = {};
      if (d.line) {
        d.line.setAttribute('d', '');
        d.line.style.display = 'none';
      }
    });
    callTypeDropdown.select(3);
    harmonicDropdown.select(0);
    Object.values(inputs).forEach(el => {
      if (!el) return;
      el.value = "";
      delete el.dataset.time;
      el.classList.remove('active-get');
      el.classList.remove('invalid');
      el.classList.remove('warning');
    });
    bandwidthEl.textContent = '-';
    durationEl.textContent = '-';
    startTime = null;
    endTime = null;
    tabData.forEach(tab => {
      Object.values(tab.markers).forEach(m => {
        m.freq = null;
        m.time = null;
        if (m.el) m.el.style.display = 'none';
      });
    });
    active = null;
    activeMarkerKey = null;
    setMarkerInteractivity(true);
    loadTab(currentTab);
  }
  viewer.addEventListener('click', (e) => {
    if (!active) return;
    const rect = viewer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scrollLeft = viewer.scrollLeft || 0;
    const { min, max } = getFreqRange();
    const freq = (1 - y / spectrogramHeight) * (max - min) + min;
    const time = ((x + scrollLeft) / container.scrollWidth) * getDuration();
    const key = active.dataset.key;
  active.value = formatFreqForDisplay(freq);
    active.dataset.time = time;
    markers[key].freq = freq;
    markers[key].time = time;
    if (active === inputs.start) startTime = time;
    if (active === inputs.end) endTime = time;
    tabData[currentTab].startTime = startTime;
    tabData[currentTab].endTime = endTime;
    active.classList.remove('active-get');
    active = null;
    setMarkerInteractivity(true);
    updateDerived();
    updateMarkers();
    clearResult();
  });

  viewer.addEventListener('scroll', updateMarkers);

  function formatSpeciesResult(res) {
    return res.split(' / ').map(name => {
      if (name.endsWith('sp.')) {
        const genus = name.replace(' sp.', '');
        return `<i>${genus}</i> sp.`;
      }
      if (name === 'TBC' || name === '-' || name === 'No species matched') return name;
      return `<i>${name}</i>`;
    }).join(' / ');
  }

  function showPlaceholderResult() {
    updateResultDisplay();
  }

  function validateMandatoryInputs(forceShow = false) {
    const tab = tabData[currentTab];
    if (forceShow) tab.showValidation = true;
    const showValidation = tab.showValidation;
    const callType = callTypeDropdown.items[callTypeDropdown.selectedIndex];
    const requiredMap = {
      'CF-FM': ['cfStart', 'cfEnd'],
      'FM-CF-FM': ['cfStart', 'cfEnd'],
      'FM': ['high', 'low'],
      'FM-QCF': ['high', 'low', 'knee'],
      'FM-QCF-FM': ['high', 'knee', 'heel', 'low'],
      'QCF': ['high', 'low'],
    };
    const required = requiredMap[callType] || [];
    let allValid = true;
    const freqKeys = ['start','end','high','low','knee','heel','cfStart','cfEnd'];
    Object.entries(inputs).forEach(([key, el]) => {
      if (!el) return;
      if (required.includes(key)) {
        const val = freqKeys.includes(key) ? parseDisplayedFreq(el) : parseFloat(el.value);
        const isValid = !isNaN(val);
        if (showValidation) {
          el.classList.toggle('invalid', !isValid);
        } else {
          el.classList.remove('invalid');
        }
        if (!isValid) allValid = false;
      } else {
        el.classList.remove('invalid');
      }
    });
    return allValid;
  }
  function runPulseId() {
    if (!validateMandatoryInputs(true)) {
      tabData[currentTab].autoIdResult = null;
      if (resultEl) resultEl.textContent = "-";
      updateMarkers();
      return;
    }
    const callType = callTypeDropdown.items[callTypeDropdown.selectedIndex];
  // parse displayed freq inputs back to internal kHz values
  const high = parseDisplayedFreq(inputs.high);
  const low = parseDisplayedFreq(inputs.low);
  const knee = parseDisplayedFreq(inputs.knee);
  const heel = parseDisplayedFreq(inputs.heel);
  const start = parseDisplayedFreq(inputs.start);
  const end = parseDisplayedFreq(inputs.end);
  const cfStart = parseDisplayedFreq(inputs.cfStart);
  const cfEnd = parseDisplayedFreq(inputs.cfEnd);

    let duration = null;
    const times = Object.values(markers)
      .filter((m) => m.time != null && !isNaN(m.freq))
      .map((m) => m.time);
    if (times.length >= 2) {
      const max = Math.max(...times);
      const min = Math.min(...times);
      duration = (max - min) * 1000;
    }

    let bandwidth = null;
    if (["FM-CF-FM", "CF-FM"].includes(callType)) {
      if (!isNaN(cfStart) && !isNaN(end)) bandwidth = cfStart - end;
    } else if (!isNaN(high) && !isNaN(low)) {
      bandwidth = high - low;
    }

    const kneeLowTime =
      markers.knee.time != null && markers.low.time != null
        ? (markers.knee.time - markers.low.time) * 1000
        : null;
    const kneeLowBandwidth = !isNaN(knee) && !isNaN(low) ? knee - low : null;
    const heelLowBandwidth = !isNaN(heel) && !isNaN(low) ? heel - low : null;
    const kneeHeelBandwidth = !isNaN(knee) && !isNaN(heel) ? knee - heel : null;
    const harmonic = parseInt(
      harmonicDropdown.items[harmonicDropdown.selectedIndex],
      10
    );

    // Adjust values according to Time Expansion so autoIdHK receives the
    // same scale as the UI displays. When Time Expansion is active:
    // - displayed frequencies are internal * 10
    // - displayed durations are internal / 10
    const freqMul = getTimeExpansionMode() ? 10 : 1;
    const timeDenom = getTimeExpansionMode() ? 10 : 1;

    const scaled = {
      callType,
      harmonic,
      // frequencies/bandwidth in displayed kHz when TE active
      highestFreq: isNaN(high) ? high : high * freqMul,
      lowestFreq: isNaN(low) ? low : low * freqMul,
      kneeFreq: isNaN(knee) ? knee : knee * freqMul,
      heelFreq: isNaN(heel) ? heel : heel * freqMul,
      startFreq: isNaN(start) ? start : start * freqMul,
      endFreq: isNaN(end) ? end : end * freqMul,
      cfStart: isNaN(cfStart) ? cfStart : cfStart * freqMul,
      cfEnd: isNaN(cfEnd) ? cfEnd : cfEnd * freqMul,
      // durations in displayed ms when TE active
      duration: duration == null || isNaN(duration) ? duration : (duration / timeDenom),
      // bandwidths in displayed kHz when TE active
      bandwidth: bandwidth == null || isNaN(bandwidth) ? bandwidth : (bandwidth * freqMul),
      kneeLowTime: kneeLowTime == null || isNaN(kneeLowTime) ? kneeLowTime : (kneeLowTime / timeDenom),
      kneeLowBandwidth: kneeLowBandwidth == null || isNaN(kneeLowBandwidth) ? kneeLowBandwidth : (kneeLowBandwidth * freqMul),
      heelLowBandwidth: heelLowBandwidth == null || isNaN(heelLowBandwidth) ? heelLowBandwidth : (heelLowBandwidth * freqMul),
      kneeHeelBandwidth: kneeHeelBandwidth == null || isNaN(kneeHeelBandwidth) ? kneeHeelBandwidth : (kneeHeelBandwidth * freqMul)
    };

    const res = autoIdHK(scaled);
    tabData[currentTab].autoIdResult = res;
    updateResultDisplay();
    updateMarkers();
  }

  function runSequenceId() {
    runPulseId();
  }

  pulseIdBtn?.addEventListener('click', runPulseId);
  sequenceIdBtn?.addEventListener('click', runSequenceId);

  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('autoid-open')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      pulseIdBtn?.click();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      sequenceIdBtn?.click();
    } else if (e.ctrlKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      if (currentTab > 0) switchTab(currentTab - 1);
    } else if (e.ctrlKey && e.key === 'ArrowRight') {
      e.preventDefault();
      if (currentTab < TAB_COUNT - 1) switchTab(currentTab + 1);
    }
  });

  return {
    updateMarkers,
    reset,
    resetCurrentTab,
    setMarkerAt,
    removeMarker,
    isFieldEnabled,
    getFreqRange,
    getDuration: () => getDuration(),
    spectrogramHeight
  };
}
