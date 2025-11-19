let canvas, ctx, sampleRate = 44100;
let windowCache = new Map();
let twiddleFactorCache = new Map();
// 緩衝重用與 bit-reverse 快取
let bufferPool = new Map(); // key: N -> { real: Float32Array, imag: Float32Array }
let bitReverseCache = new Map();
let spectrumPool = new Map(); // key: halfN -> Float32Array
let filterBankCache = new Map(); // key: scale:numFilters:sampleRate:fftSize -> filterBank
// color map and options
let colorMapUint = null; // Uint8ClampedArray(256*4)
let resampleMapCache = new Map();
let currentOptions = {
  colorMap: null,
  windowFunc: 'hann',
  gainDB: 20,
  rangeDB: 80,
};

self.onmessage = (e) => {
  const { type } = e.data;
  if (type === 'init') {
    canvas = e.data.canvas;
    sampleRate = e.data.sampleRate || sampleRate;
    ctx = canvas.getContext('2d');
    if (e.data.options) {
      currentOptions = Object.assign({}, currentOptions, e.data.options);
      if (currentOptions.colorMap) setColorMapUint(currentOptions.colorMap);
    }
  } else if (type === 'setOptions') {
    currentOptions = Object.assign({}, currentOptions, e.data.options || {});
    if (e.data.options && e.data.options.colorMap) setColorMapUint(e.data.options.colorMap);
  } else if (type === 'render') {
    if (!ctx) return;
    const opts = Object.assign({}, currentOptions, e.data.options || {});
    if (opts.colorMap) setColorMapUint(opts.colorMap);
    renderSpectrogram(e.data.buffer, e.data.sampleRate || sampleRate, e.data.fftSize || 1024, e.data.overlap || 0, opts);
  }
};

function renderSpectrogram(signal, sr, fftSize, overlapPct, opts = {}) {
  const hop = Math.max(1, Math.floor(fftSize * (1 - overlapPct / 100)));
  const width = Math.max(1, Math.ceil((signal.length - fftSize) / hop));
  const fftHalf = Math.floor(fftSize / 2);
  // decide whether to use filter-bank (scale)
  const scale = opts.scale || currentOptions.scale || null;
  const scaleTypes = ['mel', 'logarithmic', 'bark', 'erb'];
  let filterBank = null;
  let numFilters = null;
  if (scale && scaleTypes.includes(scale)) {
    numFilters = opts.numFilters || Math.max(1, fftHalf);
    filterBank = createFilterBankCached(scale, numFilters, sr, fftSize);
  }
  const height = filterBank ? numFilters : fftHalf;
  canvas.width = width;
  canvas.height = height;
  const img = ctx.createImageData(width, height);
  const imgData = img.data;
  const window = getWindowCached(fftSize);
  
  // 取得（或建立）可重用的緩衝，避免重複配置
  const { real, imag } = getBuffersCached(fftSize);
  const bitReverse = getBitReverseCached(fftSize);
  
  // 預計算幅度值的規範化常數
  const invHeight = 1.0 / height;
  const invFftSize = 1.0 / fftSize;
  
  // 使用預計算的 twiddle factors 進行快速 FFT
  const twiddleFactors = getTwiddleFactorsCached(fftSize);
  
  for (let x = 0, i = 0; i + fftSize <= signal.length; i += hop, x++) {
    // 應用窗函數並複製到實部
    for (let j = 0; j < fftSize; j++) {
      real[j] = signal[i + j] * window[j];
      imag[j] = 0;
    }
    
    // 使用優化的 FFT（傳入 bit-reverse 快取）
    fftOptimized(real, imag, twiddleFactors, bitReverse);

    // 建立頻譜 magnitude（0..fftHalf-1）並放入 spectrum 陣列
    const spectrum = getSpectrumCached(fftHalf);
    for (let k = 0; k < fftHalf; k++) {
      const magSq = real[k] * real[k] + imag[k] * imag[k];
      spectrum[k] = Math.sqrt(magSq);
    }

    // 若使用 filter bank，對頻譜套用 filter，否則直接使用 spectrum
    let energyArr;
    if (filterBank) {
      energyArr = applyFilterBank(spectrum, filterBank);
    } else {
      energyArr = spectrum;
    }

    // 以 dB scale 與 gain/range 做映射到 0..255
    const gainDB = (opts.gainDB != null) ? opts.gainDB : currentOptions.gainDB;
    const rangeDB = (opts.rangeDB != null) ? opts.rangeDB : currentOptions.rangeDB;
    for (let y = 0; y < height; y++) {
      const s = energyArr[y] > 1e-12 ? energyArr[y] : 1e-12;
      const db = 20 * Math.log10(s);
      let colIdx;
      if (db < -gainDB - rangeDB) colIdx = 0;
      else if (db > -gainDB) colIdx = 255;
      else colIdx = Math.round(((db + gainDB) / rangeDB) * 255);

      const idxPixel = (height - 1 - y) * width + x;
      const pixelIdx = idxPixel * 4;
      if (colorMapUint) {
        const cmapBase = colIdx * 4;
        imgData[pixelIdx] = colorMapUint[cmapBase];
        imgData[pixelIdx + 1] = colorMapUint[cmapBase + 1];
        imgData[pixelIdx + 2] = colorMapUint[cmapBase + 2];
        imgData[pixelIdx + 3] = colorMapUint[cmapBase + 3];
      } else {
        imgData[pixelIdx] = colIdx;
        imgData[pixelIdx + 1] = colIdx;
        imgData[pixelIdx + 2] = colIdx;
        imgData[pixelIdx + 3] = 255;
      }
    }
  }
  
  ctx.putImageData(img, 0, 0);
  self.postMessage({ type: 'rendered' });
}

// 快取窗函數，避免重複計算
function getWindowCached(N) {
  if (!windowCache.has(N)) {
    windowCache.set(N, hannWindow(N));
  }
  return windowCache.get(N);
}

// 預計算 Twiddle Factors 用於快速 FFT
function getTwiddleFactorsCached(N) {
  if (!twiddleFactorCache.has(N)) {
    const factors = new Array(Math.log2(N));
    for (let stage = 0; stage < Math.log2(N); stage++) {
      const n2 = 1 << (stage + 1);
      const n1 = n2 >> 1;
      factors[stage] = [];
      for (let j = 0; j < n1; j++) {
        const angle = -2 * Math.PI * j / n2;
        factors[stage][j] = { c: Math.cos(angle), s: Math.sin(angle) };
      }
    }
    twiddleFactorCache.set(N, factors);
  }
  return twiddleFactorCache.get(N);
}

// 建立/更新 colorMap 的 Uint8ClampedArray 表
function setColorMapUint(colorMap) {
  if (!colorMap || !colorMap.length) {
    // clear to fallback
    colorMapUint = null;
    return;
  }
  const arr = new Uint8ClampedArray(256 * 4);
  for (let ii = 0; ii < 256; ii++) {
    const cc = colorMap[ii] || [0, 0, 0, 1];
    arr[ii * 4] = Math.round(255 * (cc[0] || 0));
    arr[ii * 4 + 1] = Math.round(255 * (cc[1] || 0));
    arr[ii * 4 + 2] = Math.round(255 * (cc[2] || 0));
    arr[ii * 4 + 3] = Math.round(255 * (cc[3] == null ? 1 : cc[3]));
  }
  colorMapUint = arr;
}

// resample 映射快取：給定 source length 與 output width，回傳 mapping
function getResampleMap(srcLen, outW) {
  const key = `${srcLen}:${outW}`;
  if (resampleMapCache.has(key)) return resampleMapCache.get(key);
  const mapping = new Array(outW);
  const invIn = 1 / srcLen;
  const invOut = 1 / outW;
  for (let a = 0; a < outW; a++) {
    const contrib = [];
    for (let n = 0; n < srcLen; n++) {
      const s = n * invIn;
      const h = s + invIn;
      const o = a * invOut;
      const l = o + invOut;
      const c = Math.max(0, Math.min(h, l) - Math.max(s, o));
      if (c > 0) contrib.push([n, c / invOut]);
    }
    mapping[a] = contrib;
  }
  resampleMapCache.set(key, mapping);
  return mapping;
}

function getSpectrumCached(halfN) {
  if (!spectrumPool.has(halfN)) spectrumPool.set(halfN, new Float32Array(halfN));
  return spectrumPool.get(halfN);
}

// Scale conversion helpers (adapted from modules/spectrogram.esm.js)
function hzToMel(t) { return 2595 * Math.log10(1 + t / 700); }
function melToHz(t) { return 700 * (Math.pow(10, t / 2595) - 1); }
function hzToLog(t) { return Math.log10(Math.max(1, t)); }
function logToHz(t) { return Math.pow(10, t); }
function hzToBark(t) {
  let e = 26.81 * t / (1960 + t) - .53;
  if (e < 2) e += .15 * (2 - e);
  if (e > 20.1) e += .22 * (e - 20.1);
  return e;
}
function barkToHz(t) {
  if (t < 2) t = (t - .3) / .85;
  if (t > 20.1) t = (t + 4.422) / 1.22;
  return (t + .53) / (26.28 - t) * 1960;
}
const N_CONST = 1e3 * Math.log(10) / 107.939;
function hzToErb(t) { return N_CONST * Math.log10(1 + .00437 * t); }
function erbToHz(t) { return (Math.pow(10, t / N_CONST) - 1) / .00437; }

function createFilterBankCached(scale, numFilters, sampleRate, fftSize) {
  const key = `${scale}:${numFilters}:${sampleRate}:${fftSize}`;
  if (filterBankCache.has(key)) return filterBankCache.get(key);

  const fftHalf = Math.floor(fftSize / 2);
  const hzToScale = (scale === 'mel') ? hzToMel : (scale === 'logarithmic' ? hzToLog : (scale === 'bark' ? hzToBark : (scale === 'erb' ? hzToErb : null)));
  const scaleToHz = (scale === 'mel') ? melToHz : (scale === 'logarithmic' ? logToHz : (scale === 'bark' ? barkToHz : (scale === 'erb' ? erbToHz : null)));
  if (!hzToScale || !scaleToHz) return null;

  const i0 = hzToScale(0);
  const i1 = hzToScale(sampleRate / 2);
  const filterBank = new Array(numFilters);
  const h = sampleRate / fftSize;
  for (let e = 0; e < numFilters; e++) {
    const center = scaleToHz(i0 + e / numFilters * (i1 - i0));
    let o = Math.floor(center / h);
    if (o < 0) o = 0;
    if (o > fftHalf) o = fftHalf;
    const l = o * h;
    const denom = ((o + 1) * h - l) || 1;
    const c = (center - l) / denom;
    const row = new Float32Array(fftHalf + 1);
    if (o >= 0 && o <= fftHalf) row[o] = 1 - c;
    if (o + 1 >= 0 && o + 1 <= fftHalf) row[o + 1] = c;
    filterBank[e] = row;
  }
  filterBankCache.set(key, filterBank);
  return filterBank;
}

function applyFilterBank(spectrum, filterBank) {
  const numFilters = filterBank.length;
  const out = new Float32Array(numFilters);
  for (let i = 0; i < numFilters; i++) {
    const row = filterBank[i];
    let acc = 0;
    for (let k = 0; k < row.length; k++) {
      const w = row[k];
      if (w !== 0) acc += spectrum[k] * w;
    }
    out[i] = acc;
  }
  return out;
}

// 取得可重用的 FFT 緩衝（real/imag）
function getBuffersCached(N) {
  if (!bufferPool.has(N)) {
    bufferPool.set(N, { real: new Float32Array(N), imag: new Float32Array(N) });
  }
  return bufferPool.get(N);
}

// 產生並快取 bit-reverse 索引陣列
function getBitReverseCached(N) {
  if (!bitReverseCache.has(N)) {
    const bits = Math.log2(N);
    const rev = new Uint32Array(N);
    for (let i = 0; i < N; i++) {
      let x = i;
      let y = 0;
      for (let j = 0; j < bits; j++) {
        y = (y << 1) | (x & 1);
        x >>= 1;
      }
      rev[i] = y;
    }
    bitReverseCache.set(N, rev);
  }
  return bitReverseCache.get(N);
}

function hannWindow(N) {
  const win = new Float32Array(N);
  const invN = 1 / (N - 1);
  const twoPI = 2 * Math.PI;
  for (let i = 0; i < N; i++) {
    win[i] = 0.5 * (1 - Math.cos(twoPI * i * invN));
  }
  return win;
}

// 優化的 FFT，使用預計算的 twiddle factors
function fftOptimized(real, imag, twiddleFactors, bitReverse) {
  const n = real.length;

  // 位反轉排列（Bit-reversal permutation） - 使用快取索引以減少操作
  if (bitReverse) {
    for (let i = 0; i < n; i++) {
      const j = bitReverse[i];
      if (j > i) {
        let temp = real[i]; real[i] = real[j]; real[j] = temp;
        temp = imag[i]; imag[i] = imag[j]; imag[j] = temp;
      }
    }
  } else {
    // 備援：原本的位反轉演算法
    let j = 0;
    for (let i = 1; i < n - 1; i++) {
      let n1 = n >> 1;
      while (j >= n1) { j -= n1; n1 >>= 1; }
      j += n1;
      if (j > i) {
        let temp = real[i]; real[i] = real[j]; real[j] = temp;
        temp = imag[i]; imag[i] = imag[j]; imag[j] = temp;
      }
    }
  }

  // 蝴蝶操作（Butterfly operations）
  for (let stage = 0; stage < twiddleFactors.length; stage++) {
    const factors = twiddleFactors[stage];
    const n2 = 1 << (stage + 1);
    const n1 = n2 >> 1;

    for (let j = 0; j < n1; j++) {
      const { c, s } = factors[j];

      for (let i = j; i < n; i += n2) {
        const k = i + n1;
        const tr = c * real[k] - s * imag[k];
        const ti = c * imag[k] + s * real[k];

        real[k] = real[i] - tr;
        imag[k] = imag[i] - ti;
        real[i] += tr;
        imag[i] += ti;
      }
    }
  }
}

// 原始 FFT 作為備用（可選）
function fft(real, imag) {
  const n = real.length;
  let i = 0, j = 0, n1, n2, a, c, s, t1, t2;
  for (j = 1, i = 0; j < n - 1; j++) {
    n1 = n >> 1;
    while (i >= n1) { i -= n1; n1 >>= 1; }
    i += n1;
    if (j < i) { t1 = real[j]; real[j] = real[i]; real[i] = t1; t1 = imag[j]; imag[j] = imag[i]; imag[i] = t1; }
  }
  n1 = 0; n2 = 1;
  for (let l = 0; l < Math.log2(n); l++) {
    n1 = n2; n2 <<= 1; a = 0;
    for (j = 0; j < n1; j++) {
      c = Math.cos(-2 * Math.PI * j / n2);
      s = Math.sin(-2 * Math.PI * j / n2);
      for (i = j; i < n; i += n2) {
        const k = i + n1;
        t1 = c * real[k] - s * imag[k];
        t2 = s * real[k] + c * imag[k];
        real[k] = real[i] - t1; imag[k] = imag[i] - t2;
        real[i] += t1; imag[i] += t2;
      }
    }
  }
}