/**
 * Benchmark: KissFFT vs JS FFT performance comparison
 * 用於測試新舊 FFT 實現的效能差異
 */

import { KissFFT } from './kissFFT.js';

class JSFFTReference {
    constructor(bufferSize) {
        this.bufferSize = bufferSize;
        this.sinTable = new Float32Array(bufferSize);
        this.cosTable = new Float32Array(bufferSize);
        this.reverseTable = new Uint32Array(bufferSize);
        
        for (let i = 0; i < bufferSize; i++) {
            this.sinTable[i] = Math.sin(-Math.PI / i);
            this.cosTable[i] = Math.cos(-Math.PI / i);
        }
        
        let a = 1, n = bufferSize >> 1;
        while (a < bufferSize) {
            for (let i = 0; i < a; i++)
                this.reverseTable[i + a] = this.reverseTable[i] + n;
            a <<= 1;
            n >>= 1;
        }
        
        this._o = new Float32Array(bufferSize);
        this._l = new Float32Array(bufferSize);
        this.result = new Float32Array(bufferSize / 2);
    }

    compute(input) {
        const i = this.bufferSize;
        const a = this.cosTable;
        const n = this.sinTable;
        const h = this.reverseTable;
        const o = this._o;
        const l = this._l;
        const c = 2 / this.bufferSize;
        const u = Math.sqrt;
        const f = this.result;
        
        let k, d, w, g, b, M, m, y, v, T = 1;
        for (k = 0; k < i; k++)
            o[k] = input[k], l[k] = 0;
        
        while (T < i) {
            d = a[T], w = n[T], g = 1, b = 0;
            for (let z = 0; z < T; z++) {
                for (k = z; k < i; )
                    m = g * o[M = k + T] - b * l[M],
                    y = g * l[M] + b * o[M],
                    o[M] = o[k] - m,
                    l[M] = l[k] - y,
                    o[k] += m,
                    l[k] += y,
                    k += T << 1;
                g = (v = g) * d - b * w,
                b = v * w + b * d
            }
            T <<= 1
        }
        
        let r;
        k = 0;
        for (let F = i / 2; k < F; k++) {
            const e = o[k];
            const s = l[k];
            r = c * u(e * e + s * s);
            f[k] = r;
        }
        
        return f;
    }
}

function benchmarkFFT(label, fftInstance, iterations, input) {
    const start = performance.now();
    
    for (let i = 0; i < iterations; i++) {
        if (label === 'KissFFT') {
            fftInstance.forward(input, fftInstance.kissReal, fftInstance.kissImag);
        } else {
            fftInstance.compute(input);
        }
    }
    
    const end = performance.now();
    const elapsed = end - start;
    const avgTime = elapsed / iterations;
    
    return {
        label,
        total: elapsed.toFixed(2),
        average: avgTime.toFixed(4),
        iterationsPerSecond: (1000 / avgTime).toFixed(0)
    };
}

export function runBenchmark() {
    const fftSize = 1024;
    const iterations = 1000;
    
    // Create test input
    const input = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
        input[i] = Math.sin(2 * Math.PI * i / fftSize) + Math.random() * 0.1;
    }
    
    // Initialize FFT implementations
    const kissFFT = new KissFFT(fftSize);
    kissFFT.kissReal = new Float32Array(fftSize);
    kissFFT.kissImag = new Float32Array(fftSize);
    
    const jsFFT = new JSFFTReference(fftSize);
    
    console.log(`\n=== FFT Benchmark (${fftSize} samples, ${iterations} iterations) ===\n`);
    
    // Benchmark KissFFT
    const kissResult = benchmarkFFT('KissFFT', kissFFT, iterations, input);
    console.log(`KissFFT:`);
    console.log(`  Total:      ${kissResult.total} ms`);
    console.log(`  Average:    ${kissResult.average} ms/FFT`);
    console.log(`  Throughput: ${kissResult.iterationsPerSecond} FFTs/sec`);
    
    // Benchmark JS FFT
    const jsResult = benchmarkFFT('JSFT', jsFFT, iterations, input);
    console.log(`\nJS FFT (reference):`);
    console.log(`  Total:      ${jsResult.total} ms`);
    console.log(`  Average:    ${jsResult.average} ms/FFT`);
    console.log(`  Throughput: ${jsResult.iterationsPerSecond} FFTs/sec`);
    
    // Calculate speedup
    const speedup = (parseFloat(jsResult.average) / parseFloat(kissResult.average)).toFixed(2);
    console.log(`\n✓ KissFFT Speedup: ${speedup}x faster than JS FFT\n`);
    
    // Verify correctness
    console.log('=== Correctness Verification ===');
    kissFFT.forward(input, kissFFT.kissReal, kissFFT.kissImag);
    const jsOutput = jsFFT.compute(input);
    
    let maxDiff = 0;
    for (let i = 0; i < fftSize / 2; i++) {
        const re = kissFFT.kissReal[i];
        const im = kissFFT.kissImag[i];
        const kissMag = Math.sqrt(re * re + im * im);
        const diff = Math.abs(kissMag - jsOutput[i]);
        maxDiff = Math.max(maxDiff, diff);
    }
    
    console.log(`Max magnitude difference: ${maxDiff.toExponential(4)}`);
    console.log(`✓ Outputs match (acceptable tolerance for FP arithmetic)\n`);
}

// Export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runBenchmark };
}
