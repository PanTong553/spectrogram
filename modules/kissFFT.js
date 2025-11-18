/**
 * KissFFT - Pure JavaScript FFT implementation
 * Optimized for real-to-complex FFT (input is real signal, output is magnitude spectrum)
 * Based on the original C Kiss FFT library with JS port optimizations
 */

class KissFFT {
  constructor(fftSize) {
    if (!this.isPowerOfTwo(fftSize)) {
      throw new Error(`FFT size must be power of 2, got ${fftSize}`);
    }
    this.fftSize = fftSize;
    this.nfft = fftSize;
    this.logN = Math.log2(fftSize);
    
    // Pre-allocate work arrays
    this.realWork = new Float32Array(fftSize);
    this.imagWork = new Float32Array(fftSize);
    
    // Pre-compute twiddle factors
    this.twiddleFactors = this.precomputeTwiddleFactors();
    
    // Bit-reversal table
    this.bitReversalTable = this.computeBitReversalTable();
  }

  isPowerOfTwo(n) {
    return n > 0 && (n & (n - 1)) === 0;
  }

  precomputeTwiddleFactors() {
    const factors = [];
    const stages = this.logN;
    for (let stage = 0; stage < stages; stage++) {
      const n2 = 1 << (stage + 1);
      const n1 = n2 >> 1;
      const stageFactors = [];
      for (let j = 0; j < n1; j++) {
        const angle = -2 * Math.PI * j / n2;
        stageFactors.push({
          c: Math.cos(angle),
          s: Math.sin(angle)
        });
      }
      factors.push(stageFactors);
    }
    return factors;
  }

  computeBitReversalTable() {
    const table = new Uint32Array(this.nfft);
    for (let i = 0; i < this.nfft; i++) {
      table[i] = this.reverseBits(i, this.logN);
    }
    return table;
  }

  reverseBits(x, bits) {
    let result = 0;
    for (let i = 0; i < bits; i++) {
      result = (result << 1) | (x & 1);
      x >>= 1;
    }
    return result;
  }

  /**
   * Forward FFT for real input
   * @param {Float32Array} input - Real input signal (fftSize samples)
   * @param {Float32Array} outputReal - Real part of FFT (output)
   * @param {Float32Array} outputImag - Imaginary part of FFT (output)
   */
  forward(input, outputReal, outputImag) {
    const real = this.realWork;
    const imag = this.imagWork;
    
    // Copy input and apply bit-reversal permutation
    for (let i = 0; i < this.nfft; i++) {
      const j = this.bitReversalTable[i];
      real[i] = input[j];
      imag[i] = 0;
    }

    // Cooley-Tukey FFT via butterflies
    let stage_size = 1;
    for (let stage = 0; stage < this.logN; stage++) {
      const half_stage = stage_size;
      stage_size <<= 1;
      const twiddleFactorsForStage = this.twiddleFactors[stage];

      for (let k = 0; k < half_stage; k++) {
        const { c, s } = twiddleFactorsForStage[k];

        for (let i = k; i < this.nfft; i += stage_size) {
          const j = i + half_stage;
          
          // butterfly: multiply by twiddle factor
          const tr = c * real[j] - s * imag[j];
          const ti = c * imag[j] + s * real[j];

          // butterfly addition/subtraction
          real[j] = real[i] - tr;
          imag[j] = imag[i] - ti;
          real[i] += tr;
          imag[i] += ti;
        }
      }
    }

    // Copy result to output
    for (let i = 0; i < this.nfft; i++) {
      outputReal[i] = real[i];
      outputImag[i] = imag[i];
    }
  }

  /**
   * Compute magnitude spectrum from real and imaginary parts
   * @param {Float32Array} real - Real part
   * @param {Float32Array} imag - Imaginary part
   * @param {Float32Array} output - Magnitude spectrum (fftSize/2 samples)
   * @param {number} scale - Scaling factor (default 1.0)
   */
  getMagnitudeSpectrum(real, imag, output, scale = 1.0) {
    const halfSize = this.nfft >> 1;
    const scale2 = scale * scale;
    for (let i = 0; i < halfSize; i++) {
      const re = real[i];
      const im = imag[i];
      output[i] = Math.sqrt(re * re + im * im) * scale;
    }
  }

  /**
   * Compute power spectrum (magnitude squared)
   * @param {Float32Array} real - Real part
   * @param {Float32Array} imag - Imaginary part
   * @param {Float32Array} output - Power spectrum (fftSize/2 samples)
   */
  getPowerSpectrum(real, imag, output) {
    const halfSize = this.nfft >> 1;
    for (let i = 0; i < halfSize; i++) {
      const re = real[i];
      const im = imag[i];
      output[i] = re * re + im * im;
    }
  }
}

export { KissFFT };
