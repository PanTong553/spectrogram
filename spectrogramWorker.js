let canvas, ctx, sampleRate = 44100;

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
  const window = hannWindow(fftSize);
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  for (let x = 0, i = 0; i + fftSize <= signal.length; i += hop, x++) {
    for (let j = 0; j < fftSize; j++) {
      real[j] = signal[i + j] * window[j];
      imag[j] = 0;
    }
    fft(real, imag);
    for (let y = 0; y < height; y++) {
      const mag = Math.sqrt(real[y] * real[y] + imag[y] * imag[y]);
      let val = Math.log10(mag + 1e-12);
      val = Math.max(0, Math.min(1, val / 5));
      const col = Math.floor(val * 255);
      const idx = (height - 1 - y) * width + x;
      img.data[idx * 4] = col;
      img.data[idx * 4 + 1] = col;
      img.data[idx * 4 + 2] = col;
      img.data[idx * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  self.postMessage({ type: 'rendered' });
}

function hannWindow(N) {
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  return win;
}

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
