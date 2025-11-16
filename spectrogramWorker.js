let canvas, ctx, sampleRate = 44100;
let windowCache = new Map();
let twiddleFactorCache = new Map();

self.onmessage = (e) => {
  const { type } = e.data;
  if (type === 'init') {
    canvas = e.data.canvas;
    sampleRate = e.data.sampleRate || sampleRate;
    ctx = canvas.getContext('2d');
  } else if (type === 'render') {
    if (!ctx) return;
    renderSpectrogram(e.data.buffer, e.data.sampleRate || sampleRate, e.data.fftSize || 1024, e.data.overlap || 0);
  }
};

function renderSpectrogram(signal, sr, fftSize, overlapPct) {
  const hop = Math.max(1, Math.floor(fftSize * (1 - overlapPct / 100)));
  const width = Math.max(1, Math.ceil((signal.length - fftSize) / hop));
  const height = fftSize / 2;
  canvas.width = width;
  canvas.height = height;
  const img = ctx.createImageData(width, height);
  const imgData = img.data;
  const window = getWindowCached(fftSize);
  
  // 預先分配並複用數組，避免重複創建
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  
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
    
    // 使用優化的 FFT
    fftOptimized(real, imag, twiddleFactors);
    
    // 批量繪製像素，減少運算次數
    for (let y = 0; y < height; y++) {
      const magSq = real[y] * real[y] + imag[y] * imag[y];
      const mag = Math.sqrt(magSq);
      
      // 快速對數規範化（避免多次 Math.log10 調用）
      let val = mag > 1e-12 ? Math.log10(mag) / 5 : -2.4;
      val = val < 0 ? 0 : (val > 1 ? 1 : val);
      
      const col = Math.floor(val * 255);
      const idx = (height - 1 - y) * width + x;
      const pixelIdx = idx * 4;
      
      // 直接操作 Uint8ClampedArray
      imgData[pixelIdx] = col;
      imgData[pixelIdx + 1] = col;
      imgData[pixelIdx + 2] = col;
      imgData[pixelIdx + 3] = 255;
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
function fftOptimized(real, imag, twiddleFactors) {
  const n = real.length;
  
  // 位反轉排列（Bit-reversal permutation）
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