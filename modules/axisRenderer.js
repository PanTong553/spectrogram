// modules/axisRenderer.js

export function drawTimeAxis({
  containerWidth,
  duration,
  zoomLevel,
  axisElement,
  labelElement,
  timeExpansion = false,
}) {
  const pxPerSec = zoomLevel;
  const totalWidth = duration * pxPerSec;

  let step = 1000;
  if (pxPerSec >= 800) step = 100;
  else if (pxPerSec >= 500) step = 200;
  else if (pxPerSec >= 300) step = 500;

  // 使用 DocumentFragment 批量插入 DOM，減少重排
  const fragment = document.createDocumentFragment();
  
  for (let t = 0; t < duration * 1000; t += step) {
    const left = (t / 1000) * pxPerSec;

    // 主刻度線
    const majorTick = document.createElement('div');
    majorTick.className = 'time-major-tick';
    majorTick.style.left = `${left}px`;
    fragment.appendChild(majorTick);

    // 副刻度線
    const midLeft = left + (step / 1000 / 2) * pxPerSec;
    if (midLeft <= totalWidth) {
      const minorTick = document.createElement('div');
      minorTick.className = 'time-minor-tick';
      minorTick.style.left = `${midLeft}px`;
      fragment.appendChild(minorTick);
    }

    // 時間標籤
    const baseLabel = step >= 1000 ? (t / 1000) : t;
    const displayLabel = timeExpansion ? (baseLabel / 10) : baseLabel;
    const labelStr = (step >= 1000 && !timeExpansion) ? `${baseLabel}` : `${displayLabel}`;
    
    const label = document.createElement('span');
    label.className = 'time-axis-label';
    if (Number(displayLabel) === 0) label.classList.add('zero-label');
    label.style.left = `${left}px`;
    label.textContent = labelStr;
    fragment.appendChild(label);
  }

  // 一次性更新 DOM
  axisElement.innerHTML = '';
  axisElement.appendChild(fragment);
  axisElement.style.width = `${totalWidth}px`;
  labelElement.textContent = step >= 1000 ? 'Time (s)' : 'Time (ms)';
}

export function drawFrequencyGrid({
  gridCanvas,
  labelContainer,
  containerElement,
  spectrogramHeight = 800,
  maxFrequency = 128,
  offsetKHz = 0,
  timeExpansion = false,
}) {
  const width = containerElement.scrollWidth;
  gridCanvas.width = width;
  gridCanvas.height = spectrogramHeight;
  gridCanvas.style.width = width + 'px';
  gridCanvas.style.height = spectrogramHeight + 'px';

  const ctx = gridCanvas.getContext('2d');
  ctx.clearRect(0, 0, width, spectrogramHeight);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 0.4;

  const range = maxFrequency;
  const majorStep = timeExpansion ? 1 : 10;
  const minorStep = timeExpansion ? 0.5 : 5;

  // 優化：批量繪製所有網格線
  ctx.beginPath();
  for (let f = 0; f <= range; f += majorStep) {
    const y = (1 - f / range) * spectrogramHeight;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // 使用 DocumentFragment 批量操作 DOM
  const fragment = document.createDocumentFragment();
  
  // 繪製主刻度和標籤
  for (let f = 0; f <= range; f += majorStep) {
    const y = Math.round((1 - f / range) * spectrogramHeight);

    // 主刻度線
    const tick = document.createElement('div');
    tick.className = 'freq-major-tick';
    tick.style.top = `${y}px`;
    fragment.appendChild(tick);

    // 文字標籤
    const label = document.createElement('div');
    label.className = 'freq-label-static freq-axis-label';
    label.style.top = `${y - 1}px`;
    const freqValue = f + offsetKHz;
    const displayValue = timeExpansion ? (freqValue * 10) : freqValue;
    label.textContent = Number(displayValue.toFixed(1)).toString();
    fragment.appendChild(label);
  }

  // 繪製次刻度
  for (let f = minorStep; f <= range; f += minorStep) {
    // 跳過與主刻度位置重合的位置
    if (Math.abs((f / majorStep) - Math.round(f / majorStep)) < 1e-6) continue;

    const y = Math.round((1 - f / range) * spectrogramHeight);

    const minorTick = document.createElement('div');
    minorTick.className = 'freq-minor-tick';
    minorTick.style.top = `${y}px`;
    fragment.appendChild(minorTick);
  }

  // 一次性更新 DOM
  labelContainer.innerHTML = '';
  labelContainer.appendChild(fragment);
}
