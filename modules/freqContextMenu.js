// 確保在全域可以存取到 handleCallTypeChange
window.handleCallTypeChange = window.handleCallTypeChange || function() {};

export function initFreqContextMenu({
  viewerId,
  wrapperId = 'viewer-wrapper',
  containerId = 'spectrogram-only',
  spectrogramHeight = 800,
  getDuration,
  getFreqRange,
  autoId
}) {
  const viewer = document.getElementById(viewerId);
  const wrapper = document.getElementById(wrapperId);
  const container = document.getElementById(containerId);
  if (!viewer || !wrapper) return null;
  const defaultScrollbarThickness = 20;
  const getScrollbarThickness = () =>
    container.scrollWidth > viewer.clientWidth ? 0 : defaultScrollbarThickness;
  const menu = document.createElement('div');
  menu.id = 'freq-context-menu';
  menu.className = 'freq-context-menu';
  menu.style.display = 'none';
  const labels = {
    start: 'Start freq.',
    end: 'End freq.',
    high: 'High freq.',
    low: 'Low freq.',
    knee: 'Knee freq.',
    heel: 'Heel freq.',
    cfStart: 'CF start',
    cfEnd: 'CF end'
  };
  const keys = Object.keys(labels);
  let deleteKey = null;
  keys.forEach(key => {
    const item = document.createElement('div');
    item.className = 'freq-menu-item';
    item.textContent = labels[key];
    item.dataset.key = key;
    item.addEventListener('click', () => {
      if (item.classList.contains('disabled')) return;
      const isDelete = deleteKey === key;
      hide();
      if (isDelete) {
        if (autoId && typeof autoId.removeMarker === 'function') {
          autoId.removeMarker(key);
        }
      } else if (autoId && typeof autoId.setMarkerAt === 'function') {
        autoId.setMarkerAt(key, currentFreq, currentTime);
      }
    });
    menu.appendChild(item);
  });
  // 新增 Call type submenu
  // 取得與dropdown完全一致的選項列表
  const callTypeInput = document.getElementById('callTypeInput');
  const callTypeOptions = callTypeInput && callTypeInput._dropdown ? 
    callTypeInput._dropdown.items : 
    ['CF-FM','FM-CF-FM','FM','FM-QCF','FM-QCF-FM','QCF'];
  
  let submenu = document.createElement('div');
  submenu.className = 'freq-context-menu freq-submenu';
  submenu.style.display = 'none';
  submenu.style.position = 'absolute';
  submenu.style.zIndex = '1001';
  document.body.appendChild(submenu);
  let submenuOpen = false;
  let submenuParentRect = null;
  function hideSubmenu() {
    submenu.style.display = 'none';
    submenuOpen = false;
  }
  function showSubmenu(parentRect) {
    submenu.style.display = 'block';
    submenuOpen = true;
    submenuParentRect = parentRect;
    // submenu定位：右側且避開spectrogram下邊緣
    const wrapperRect = wrapper.getBoundingClientRect();
    let left = parentRect.right;
    let top = parentRect.top;
    submenu.style.left = left + 'px';
    submenu.style.top = top + 'px';
    let submenuRect = submenu.getBoundingClientRect();
    if (submenuRect.bottom > wrapperRect.bottom) {
      top = Math.max(wrapperRect.top, wrapperRect.bottom - submenuRect.height);
      submenu.style.top = top + 'px';
    }
  }
  // 填充submenu內容
  function renderSubmenu(selectedIdx) {
    submenu.innerHTML = '';
    callTypeOptions.forEach((opt, idx) => {
      const item = document.createElement('div');
      item.className = 'freq-menu-item';
      item.textContent = opt;
      if (selectedIdx === idx) {
        item.style.fontWeight = 'bold';
        item.style.background = 'rgba(0,0,0,0.08)';
      }
      item.addEventListener('click', () => {
        // 直接呼叫全域的 handleCallTypeChange
        if (window.handleCallTypeChange) {
          window.handleCallTypeChange(opt, idx);
        }
        // 更新下拉選單的顯示文字
        const dropdownBtn = document.getElementById('callTypeInput');
        if (dropdownBtn) {
          dropdownBtn.textContent = opt;
        }
        hideSubmenu();
        hide();
      });
      submenu.appendChild(item);
    });
  }
  // 插入 Call type option
  const callTypeItem = document.createElement('div');
  callTypeItem.className = 'freq-menu-item freq-menu-calltype';
  callTypeItem.textContent = 'Call type';
  callTypeItem.style.position = 'relative';
  // 加上 > 符號
  const arrow = document.createElement('span');
  arrow.textContent = ' >';
  arrow.style.position = 'absolute';
  arrow.style.right = '8px';
  callTypeItem.appendChild(arrow);
  callTypeItem.addEventListener('click', (e) => {
    e.stopPropagation();
    // submenu顯示在右側
    const rect = callTypeItem.getBoundingClientRect();
    renderSubmenu(document.getElementById('callTypeInput')?document.getElementById('callTypeInput')._dropdown?.selectedIndex:-1);
    showSubmenu(rect);
  });
  menu.appendChild(callTypeItem);
  // Reset option
  const resetItem = document.createElement('div');
  resetItem.className = 'freq-menu-item';
  resetItem.textContent = 'Reset ↺';
  resetItem.style.color = 'red';
  resetItem.addEventListener('click', () => {
    hide();
    if (autoId && typeof autoId.resetCurrentTab === 'function') {
      autoId.resetCurrentTab();
    }
  });
  menu.appendChild(resetItem);
  document.body.appendChild(menu);

  let currentFreq = 0;
  let currentTime = 0;

  function show(clientX, clientY, freq, time, delKey = null) {
    currentFreq = freq;
    currentTime = time;
    deleteKey = delKey;
    keys.forEach(k => {
      const el = menu.querySelector(`[data-key="${k}"]`);
      const enabled = !autoId || (typeof autoId.isFieldEnabled === 'function' && autoId.isFieldEnabled(k));
      el.classList.toggle('disabled', !enabled);
      el.style.display = enabled ? 'block' : 'none';
      if (k === deleteKey) {
        el.textContent = `Delete ${labels[k]}`;
        el.classList.add('delete');
      } else {
        el.textContent = labels[k];
        el.classList.remove('delete');
      }
    });
    menu.style.display = 'block';
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    let menuRect = menu.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    if (menuRect.bottom > wrapperRect.bottom) {
      const newTop = clientY - menuRect.height;
      menu.style.top = `${Math.max(wrapperRect.top, newTop)}px`;
      menuRect = menu.getBoundingClientRect();
    }
    if (menuRect.right > wrapperRect.right) {
      const newLeft = clientX - menuRect.width;
      menu.style.left = `${Math.max(wrapperRect.left, newLeft)}px`;
    }
    hideSubmenu();
  }

  function hide() {
    menu.style.display = 'none';
    hideSubmenu();
    deleteKey = null;
  }

  wrapper.addEventListener('contextmenu', (e) => {
    if (!document.body.classList.contains('autoid-open')) return;
    if (e.target.closest('#zoom-controls')) return;
    const rect = viewer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const threshold = getScrollbarThickness();
    const overHScrollbar = y > (viewer.clientHeight - threshold);
    const overVScrollbar = viewer.scrollHeight > viewer.clientHeight && x > viewer.clientWidth;
    if (overHScrollbar || overVScrollbar) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    let freq, time, delKey = null;
    if (e.target.classList.contains('freq-marker')) {
      delKey = e.target.dataset.key;
      freq = parseFloat(e.target.dataset.freq);
      time = parseFloat(e.target.dataset.time);
    } else {
      const scrollLeft = viewer.scrollLeft || 0;
      const { min, max } = getFreqRange();
      freq = (1 - y / spectrogramHeight) * (max - min) + min;
      time = ((x + scrollLeft) / container.scrollWidth) * getDuration();
    }
    show(e.clientX, e.clientY, freq, time, delKey);
  });

  document.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    if (menu.style.display === 'none' && submenu.style.display === 'none') return;
    if (!menu.contains(ev.target) && !submenu.contains(ev.target)) {
      hide();
    }
  });

  return { hide };
}
