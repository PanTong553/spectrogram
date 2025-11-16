// zoomControl.js (優化版，含修正)

export function initZoomControls(ws, container, duration, applyZoomCallback,
                                wrapperElement, onBeforeZoom = null,
                                onAfterZoom = null, isSelectionExpandMode = () => false,
                                onCtrlArrowUp = null) {
  const zoomInBtn = document.getElementById('zoom-in');
  const zoomOutBtn = document.getElementById('zoom-out');
  const expandBtn = document.getElementById('expand-btn');

  let zoomLevel = 500;
  let minZoomLevel = 250;

  function computeMaxZoomLevel() {
    const dur = duration();

    if (dur > 15000) return 1500;
    if (dur > 10000) return 2000;

    if (isSelectionExpandMode()) {
      if (dur > 0) {
        if (dur < 1000) return 8000;
        if (dur < 3000) return 3000;
      }
    }
    return 2500;
  }

  function computeMinZoomLevel() {
    let visibleWidth = wrapperElement.clientWidth;
    const dur = duration();
    if (dur > 0) {
      minZoomLevel = Math.floor((visibleWidth - 2) / dur);
    }
  }

  function applyZoom() {
    computeMinZoomLevel();
    if (typeof onBeforeZoom === 'function') onBeforeZoom();
    const maxZoom = computeMaxZoomLevel();
    zoomLevel = Math.min(Math.max(zoomLevel, minZoomLevel), maxZoom);

    if (ws && typeof ws.zoom === 'function' &&
        typeof ws.getDuration === 'function' && ws.getDuration() > 0) {
      ws.zoom(zoomLevel);
    }
    const width = duration() * zoomLevel;
    container.style.width = `${width}px`;

    wrapperElement.style.width = `${width}px`;

    applyZoomCallback();
    if (typeof onAfterZoom === 'function') onAfterZoom();    
    updateZoomButtons();
  }

  function setZoomLevel(newZoom) {
    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    zoomLevel = Math.min(Math.max(newZoom, minZoomLevel), maxZoom);
    applyZoom();
  }

  function updateZoomButtons() {
    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    zoomInBtn.disabled = zoomLevel >= maxZoom;
    zoomOutBtn.disabled = zoomLevel <= minZoomLevel;
  }

  zoomInBtn.onclick = () => {
    const maxZoom = computeMaxZoomLevel();
    if (zoomLevel < maxZoom) {
      zoomLevel = Math.min(zoomLevel + 500, maxZoom);
      applyZoom();
    }
  };

  zoomOutBtn.onclick = () => {
    computeMinZoomLevel();
    if (zoomLevel > minZoomLevel) {
      zoomLevel = Math.max(zoomLevel - 500, minZoomLevel);
      applyZoom();
    }
  };

  expandBtn.onclick = () => {
    setZoomLevel(minZoomLevel);
  };

  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey) return;  // 只監聽 Ctrl + *

    if (e.key === 'ArrowUp' && typeof onCtrlArrowUp === 'function') {
      const handled = onCtrlArrowUp();
      if (handled) {
        e.preventDefault();
        return;
      }
    }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        zoomInBtn.click();
        break;
      case 'ArrowDown':
        e.preventDefault();
        zoomOutBtn.click();
        break;
      case '0':
        e.preventDefault();
        expandBtn.click();
        break;
    }
  });  

  // ✅ 新增：完整重置 zoom 狀態，不受先前狀態影響
  function resetZoomState() {
    // ✅ 強制重置 wrapper 和 container 寬度為 100%
    // 這必須在計算之前做，否則 computeMinZoomLevel 會基於舊寬度
    wrapperElement.style.width = '100%';
    container.style.width = '100%';
    
    // ✅ 重新計算 minZoomLevel（基於重置後的寬度）
    computeMinZoomLevel();
    
    // ✅ 強制 zoomLevel 為最小值
    zoomLevel = minZoomLevel;
    
    // ✅ 調用 applyZoom 來應用新的 zoomLevel 和更新 UI
    applyZoom();
  }

  return {
    applyZoom,
    updateZoomButtons,
    getZoomLevel: () => zoomLevel,
    setZoomLevel,
    resetZoomState,  // ✅ 暴露重置方法
  };
}
