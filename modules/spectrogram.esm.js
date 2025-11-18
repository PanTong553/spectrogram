/**
 * Optimized Spectrogram Plugin with KissFFT integration
 * Features:
 * - KissFFT-based FFT computation (faster than JS Cooley-Tukey)
 * - Reusable FFT buffers (pre-allocation)
 * - Filter bank caching
 * - Resample mapping caching
 * - Pre-computed colorMap (Uint8 format)
 * - Fallback to JS FFT if needed
 */

import { KissFFT } from './kissFFT.js';

// Promise utility
function promiseHandler(t, e, s, r) {
    return new (s || (s = Promise))((function(i, a) {
        function n(t) {
            try {
                o(r.next(t))
            } catch (t) {
                a(t)
            }
        }
        function h(t) {
            try {
                o(r.throw(t))
            } catch (t) {
                a(t)
            }
        }
        function o(t) {
            var e;
            t.done ? i(t.value) : (e = t.value,
            e instanceof s ? e : new s((function(t) {
                t(e)
            }
            ))).then(n, h)
        }
        o((r = r.apply(t, e || [])).next())
    }
    ))
}

"function" == typeof SuppressedError && SuppressedError;

// Event emitter
class EventEmitter {
    constructor() {
        this.listeners = {}
    }
    on(t, e, s) {
        if (this.listeners[t] || (this.listeners[t] = new Set),
        this.listeners[t].add(e),
        null == s ? void 0 : s.once) {
            const s = () => {
                this.un(t, s),
                this.un(t, e)
            }
            ;
            return this.on(t, s),
            s
        }
        return () => this.un(t, e)
    }
    un(t, e) {
        var s;
        null === (s = this.listeners[t]) || void 0 === s || s.delete(e)
    }
    once(t, e) {
        return this.on(t, e, {
            once: !0
        })
    }
    unAll() {
        this.listeners = {}
    }
    emit(t, ...e) {
        this.listeners[t] && this.listeners[t].forEach((t => t(...e)))
    }
}

class BasePlugin extends EventEmitter {
    constructor(t) {
        super(),
        this.subscriptions = [],
        this.options = t
    }
    onInit() {}
    _init(t) {
        this.wavesurfer = t,
        this.onInit()
    }
    destroy() {
        this.emit("destroy"),
        this.subscriptions.forEach((t => t()))
    }
}

// DOM helper
function createElement(t, e) {
    const s = e.xmlns ? document.createElementNS(e.xmlns, t) : document.createElement(t);
    for (const [t,i] of Object.entries(e))
        if ("children" === t)
            for (const [t,i] of Object.entries(e))
                "string" == typeof i ? s.appendChild(document.createTextNode(i)) : s.appendChild(createElement(t, i));
        else
            "style" === t ? Object.assign(s.style, i) : "textContent" === t ? s.textContent = i : s.setAttribute(t, i.toString());
    return s
}

function createAndAppend(t, e, s) {
    const i = createElement(t, e || {});
    return null == s || s.appendChild(i),
    i
}

/**
 * FFT wrapper with KissFFT and JS fallback
 */
class FFTWrapper {
    constructor(bufferSize, sampleRate, windowFunc = "hann", alpha = null) {
        this.bufferSize = bufferSize;
        this.sampleRate = sampleRate;
        this.bandwidth = 2 / bufferSize * (sampleRate / 2);
        
        // Pre-compute window values
        this.windowValues = new Float32Array(bufferSize);
        this.computeWindow(windowFunc, alpha);
        
        // Try to initialize KissFFT, fallback to JS FFT
        try {
            this.kissFFT = new KissFFT(bufferSize);
            this.useKissFFT = true;
            // Pre-allocate output buffers for KissFFT
            this.kissReal = new Float32Array(bufferSize);
            this.kissImag = new Float32Array(bufferSize);
        } catch (e) {
            console.warn('KissFFT initialization failed, falling back to JS FFT:', e);
            this.useKissFFT = false;
            // Initialize JS FFT tables
            this.initJSFFT(bufferSize);
        }
        
        // Shared output magnitude spectrum
        this.spectrum = new Float32Array(bufferSize / 2);
        this.peakBand = 0;
        this.peak = 0;
    }

    computeWindow(windowType, alpha) {
        const N = this.bufferSize;
        const win = this.windowValues;
        
        switch(windowType) {
            case "bartlett":
                for (let i = 0; i < N; i++)
                    win[i] = 2 / (N - 1) * ((N - 1) / 2 - Math.abs(i - (N - 1) / 2));
                break;
            case "bartlettHann":
                for (let i = 0; i < N; i++)
                    win[i] = .62 - .48 * Math.abs(i / (N - 1) - .5) - .38 * Math.cos(2 * Math.PI * i / (N - 1));
                break;
            case "blackman":
                const alphaBlack = alpha || .16;
                for (let i = 0; i < N; i++)
                    win[i] = (1 - alphaBlack) / 2 - .5 * Math.cos(2 * Math.PI * i / (N - 1)) + alphaBlack / 2 * Math.cos(4 * Math.PI * i / (N - 1));
                break;
            case "cosine":
                for (let i = 0; i < N; i++)
                    win[i] = Math.cos(Math.PI * i / (N - 1) - Math.PI / 2);
                break;
            case "gauss":
                const alphaGauss = alpha || .25;
                for (let i = 0; i < N; i++)
                    win[i] = Math.pow(Math.E, -.5 * Math.pow((i - (N - 1) / 2) / (alphaGauss * (N - 1) / 2), 2));
                break;
            case "hamming":
                for (let i = 0; i < N; i++)
                    win[i] = .54 - .46 * Math.cos(2 * Math.PI * i / (N - 1));
                break;
            case "hann":
            case undefined:
                for (let i = 0; i < N; i++)
                    win[i] = .5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
                break;
            case "lanczoz":
                for (let i = 0; i < N; i++)
                    win[i] = Math.sin(Math.PI * (2 * i / (N - 1) - 1)) / (Math.PI * (2 * i / (N - 1) - 1));
                break;
            case "rectangular":
                for (let i = 0; i < N; i++)
                    win[i] = 1;
                break;
            case "triangular":
                for (let i = 0; i < N; i++)
                    win[i] = 2 / N * (N / 2 - Math.abs(i - (N - 1) / 2));
                break;
            default:
                throw Error("No such window function '" + windowType + "'")
        }
    }

    initJSFFT(bufferSize) {
        // Pre-compute sine and cosine tables for JS FFT fallback
        this.sinTable = new Float32Array(bufferSize);
        this.cosTable = new Float32Array(bufferSize);
        this.reverseTable = new Uint32Array(bufferSize);
        
        for (let i = 0; i < bufferSize; i++) {
            this.sinTable[i] = Math.sin(-Math.PI / i);
            this.cosTable[i] = Math.cos(-Math.PI / i);
        }
        
        // Bit-reversal table
        let a = 1, n = bufferSize >> 1;
        while (a < bufferSize) {
            for (let i = 0; i < a; i++)
                this.reverseTable[i + a] = this.reverseTable[i] + n;
            a <<= 1;
            n >>= 1;
        }
        
        // Pre-allocate JS FFT buffers
        this._o = new Float32Array(bufferSize);
        this._l = new Float32Array(bufferSize);
    }

    calculateSpectrum(input) {
        if (this.useKissFFT) {
            return this.calculateSpectrumKissFFT(input);
        } else {
            return this.calculateSpectrumJS(input);
        }
    }

    calculateSpectrumKissFFT(input) {
        const N = this.bufferSize;
        const windowed = new Float32Array(N);
        
        // Apply window
        for (let i = 0; i < N; i++) {
            windowed[i] = input[i] * this.windowValues[i];
        }
        
        // Compute FFT using KissFFT
        this.kissFFT.forward(windowed, this.kissReal, this.kissImag);
        
        // Compute magnitude spectrum
        const spectrum = this.spectrum;
        const scale = 2.0 / N;
        for (let i = 0; i < N / 2; i++) {
            const re = this.kissReal[i];
            const im = this.kissImag[i];
            const mag = Math.sqrt(re * re + im * im) * scale;
            
            if (mag > this.peak) {
                this.peakBand = i;
                this.peak = mag;
            }
            spectrum[i] = mag;
        }
        
        return spectrum;
    }

    calculateSpectrumJS(input) {
        const i = this.bufferSize;
        const a = this.cosTable;
        const n = this.sinTable;
        const h = this.reverseTable;
        const o = this._o;
        const l = this._l;
        const c = 2 / this.bufferSize;
        const u = Math.sqrt;
        const f = this.spectrum;
        const p = Math.floor(Math.log(i) / Math.LN2);
        
        if (Math.pow(2, p) !== i)
            throw "Invalid buffer size, must be a power of 2.";
        if (i !== input.length)
            throw "Supplied buffer is not the same size as defined FFT. FFT Size: " + i + " Buffer Size: " + input.length;
        
        let k, d, w, g, b, M, m, y, v, T = 1;
        for (k = 0; k < i; k++)
            o[k] = input[h[k]] * this.windowValues[h[k]],
            l[k] = 0;
        
        while (T < i) {
            d = a[T],
            w = n[T],
            g = 1,
            b = 0;
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
            if (r > this.peak) {
                this.peakBand = k;
                this.peak = r;
            }
            f[k] = r;
        }
        
        return f;
    }
}

// ERB scale constant
const erbConstant = 1e3 * Math.log(10) / 107.939;

class Spectrogram extends BasePlugin {
    static create(t) {
        return new Spectrogram(t || {})
    }

    constructor(t) {
        super(t);
        
        this.frequenciesDataUrl = t.frequenciesDataUrl;
        this.container = "string" == typeof t.container ? document.querySelector(t.container) : t.container;
        
        // Initialize colorMap
        if (t.colorMap && "string" != typeof t.colorMap) {
            if (t.colorMap.length < 256)
                throw new Error("Colormap must contain 256 elements");
            for (let e = 0; e < t.colorMap.length; e++) {
                if (4 !== t.colorMap[e].length)
                    throw new Error("ColorMap entries must contain 4 values")
            }
            this.colorMap = t.colorMap
        } else {
            const colorMapName = t.colorMap || "roseus";
            this.colorMap = this.generateColorMap(colorMapName);
        }
        
        // Configuration
        this.fftSamples = t.fftSamples || 512;
        this.height = t.height || 200;
        this.noverlap = t.noverlap || null;
        this.windowFunc = t.windowFunc || "hann";
        this.alpha = t.alpha;
        this.frequencyMin = t.frequencyMin || 0;
        this.frequencyMax = t.frequencyMax || 0;
        this.gainDB = null !== t.gainDB && void 0 !== t.gainDB ? t.gainDB : 20;
        this.rangeDB = null !== t.rangeDB && void 0 !== t.rangeDB ? t.rangeDB : 80;
        this.scale = t.scale || "mel";
        this.numMelFilters = this.fftSamples / 2;
        this.numLogFilters = this.fftSamples / 2;
        this.numBarkFilters = this.fftSamples / 2;
        this.numErbFilters = this.fftSamples / 2;
        
        // Cache for filter banks
        this._filterBankCache = {};
        this._resampleCache = {};
        
        // Pre-compute colorMap as Uint8 for faster rendering
        this._colorMapUint = new Uint8ClampedArray(256 * 4);
        this.precomputeColorMapUint();
        
        this.createWrapper();
        this.createCanvas();
    }

    generateColorMap(name) {
        const map = [];
        switch(name) {
            case "gray":
                for (let t = 0; t < 256; t++) {
                    const e = (255 - t) / 256;
                    map.push([e, e, e, 1])
                }
                break;
            case "igray":
                for (let t = 0; t < 256; t++) {
                    const e = t / 256;
                    map.push([e, e, e, 1])
                }
                break;
            default:
                throw Error("No such colormap '" + name + "'")
        }
        return map;
    }

    precomputeColorMapUint() {
        if (this.colorMap && this._colorMapUint) {
            for (let ii = 0; ii < 256; ii++) {
                const cc = this.colorMap[ii] || [0, 0, 0, 1];
                this._colorMapUint[ii * 4] = Math.round(255 * cc[0]);
                this._colorMapUint[ii * 4 + 1] = Math.round(255 * cc[1]);
                this._colorMapUint[ii * 4 + 2] = Math.round(255 * cc[2]);
                this._colorMapUint[ii * 4 + 3] = Math.round(255 * cc[3]);
            }
        }
    }

    onInit() {
        this.container = this.container || this.wavesurfer.getWrapper();
        this.container.appendChild(this.wrapper);
        this.wavesurfer.options.fillParent && Object.assign(this.wrapper.style, {
            width: "100%",
            overflowX: "hidden",
            overflowY: "hidden"
        });
        this.subscriptions.push(this.wavesurfer.on("redraw", ( () => this.render())));
    }

    destroy() {
        this.unAll();
        this.wavesurfer.un("ready", this._onReady);
        this.wavesurfer.un("redraw", this._onRender);
        this.wavesurfer = null;
        this.util = null;
        this.options = null;
        this.wrapper && (this.wrapper.remove(), this.wrapper = null);
        super.destroy()
    }

    loadFrequenciesData(e) {
        return promiseHandler(this, void 0, void 0, (function*() {
            const t = yield fetch(e);
            if (!t.ok)
                throw new Error("Unable to fetch frequencies data");
            const s = yield t.json();
            this.drawSpectrogram(s)
        }
        ))
    }

    createWrapper() {
        this.wrapper = createAndAppend("div", {
            style: {
                display: "block",
                position: "relative",
                userSelect: "none"
            }
        });
        this.options.labels && (this.labelsEl = createAndAppend("canvas", {
            part: "spec-labels",
            style: {
                position: "absolute",
                zIndex: 9,
                width: "55px",
                height: "100%"
            }
        }, this.wrapper));
        this.wrapper.addEventListener("click", this._onWrapperClick)
    }

    createCanvas() {
        this.canvas = createAndAppend("canvas", {
            style: {
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                zIndex: 4
            }
        }, this.wrapper);
        this.spectrCc = this.canvas.getContext("2d")
    }

    render() {
        let t;
        if (this.frequenciesDataUrl)
            this.loadFrequenciesData(this.frequenciesDataUrl);
        else {
            const e = null === (t = this.wavesurfer) || void 0 === t ? void 0 : t.getDecodedData();
            e && this.drawSpectrogram(this.getFrequencies(e))
        }
    }

    drawSpectrogram(t) {
        isNaN(t[0][0]) || (t = [t]);
        this.wrapper.style.height = this.height * t.length + "px";
        this.canvas.width = this.getWidth();
        this.canvas.height = this.height * t.length;
        
        const e = this.spectrCc;
        const s = this.height;
        const r = this.getWidth();
        const i = this.buffer.sampleRate / 2;
        const a = this.frequencyMin;
        const n = this.frequencyMax;
        
        if (e) {
            if (n > i) {
                const i = this.colorMap[this.colorMap.length - 1];
                e.fillStyle = `rgba(${i[0]}, ${i[1]}, ${i[2]}, ${i[3]})`;
                e.fillRect(0, 0, r, s * t.length)
            }
            
            for (let h = 0; h < t.length; h++) {
                const o = this.resample(t[h]);
                const l = o[0].length;
                const c = new ImageData(r, l);
                
                for (let t = 0; t < o.length; t++)
                    for (let e = 0; e < o[t].length; e++) {
                        let idx = o[t][e];
                        if (idx < 0) idx = 0; else if (idx > 255) idx = 255;
                        const cmapBase = idx * 4;
                        const i = 4 * ((l - e - 1) * r + t);
                        c.data[i] = this._colorMapUint[cmapBase];
                        c.data[i + 1] = this._colorMapUint[cmapBase + 1];
                        c.data[i + 2] = this._colorMapUint[cmapBase + 2];
                        c.data[i + 3] = this._colorMapUint[cmapBase + 3];
                    }
                
                const u = this.hzToScale(a) / this.hzToScale(i);
                const f = this.hzToScale(n) / this.hzToScale(i);
                const p = Math.min(1, f);
                
                createImageBitmap(c, 0, Math.round(l * (1 - p)), r, Math.round(l * (p - u))).then((t => {
                    e.drawImage(t, 0, s * (h + 1 - p / f), r, s * p / f)
                }))
            }
            
            this.options.labels && this.loadLabels(this.options.labelsBackground, "12px", "12px", "", this.options.labelsColor, this.options.labelsHzColor || this.options.labelsColor, "center", "#specLabels", t.length);
            this.emit("ready")
        }
    }

    createFilterBank(t, e, s, r) {
        const cacheKey = `${this.scale}:${t}:${e}:${this.fftSamples}`;
        if (this._filterBankCache[cacheKey])
            return this._filterBankCache[cacheKey];

        const i = s(0);
        const a = s(e / 2);
        const n = Array.from({ length: t }, ( () => Array(this.fftSamples / 2 + 1).fill(0)));
        const h = e / this.fftSamples;
        
        for (let e = 0; e < t; e++) {
            let s = r(i + e / t * (a - i));
            let o = Math.floor(s / h);
            let l = o * h;
            let c = (s - l) / ((o + 1) * h - l);
            n[e][o] = 1 - c;
            n[e][o + 1] = c
        }
        
        this._filterBankCache[cacheKey] = n;
        return n;
    }

    hzToMel(t) { return 2595 * Math.log10(1 + t / 700) }
    melToHz(t) { return 700 * (Math.pow(10, t / 2595) - 1) }
    createMelFilterBank(t, e) { return this.createFilterBank(t, e, this.hzToMel, this.melToHz) }
    
    hzToLog(t) { return Math.log10(Math.max(1, t)) }
    logToHz(t) { return Math.pow(10, t) }
    createLogFilterBank(t, e) { return this.createFilterBank(t, e, this.hzToLog, this.logToHz) }
    
    hzToBark(t) {
        let e = 26.81 * t / (1960 + t) - .53;
        return e < 2 && (e += .15 * (2 - e)),
        e > 20.1 && (e += .22 * (e - 20.1)),
        e
    }
    
    barkToHz(t) {
        return t < 2 && (t = (t - .3) / .85),
        t > 20.1 && (t = (t + 4.422) / 1.22),
        (t + .53) / (26.28 - t) * 1960
    }
    
    createBarkFilterBank(t, e) { return this.createFilterBank(t, e, this.hzToBark, this.barkToHz) }
    
    hzToErb(t) { return erbConstant * Math.log10(1 + .00437 * t) }
    erbToHz(t) { return (Math.pow(10, t / erbConstant) - 1) / .00437 }
    createErbFilterBank(t, e) { return this.createFilterBank(t, e, this.hzToErb, this.erbToHz) }
    
    hzToScale(t) {
        switch (this.scale) {
        case "mel": return this.hzToMel(t);
        case "logarithmic": return this.hzToLog(t);
        case "bark": return this.hzToBark(t);
        case "erb": return this.hzToErb(t);
        }
        return t
    }
    
    scaleToHz(t) {
        switch (this.scale) {
        case "mel": return this.melToHz(t);
        case "logarithmic": return this.logToHz(t);
        case "bark": return this.barkToHz(t);
        case "erb": return this.erbToHz(t);
        }
        return t
    }

    applyFilterBank(t, e) {
        const s = e.length;
        const r = Float32Array.from({ length: s }, ( () => 0));
        
        for (let i = 0; i < s; i++)
            for (let s = 0; s < t.length; s++)
                r[i] += t[s] * e[i][s];
        
        return r
    }

    getWidth() {
        return this.wavesurfer.getWrapper().offsetWidth
    }

    getFrequencies(t) {
        let e, s;
        const r = this.fftSamples;
        const i = (null !== (e = this.options.splitChannels) && void 0 !== e ? e : null === (s = this.wavesurfer) || void 0 === s ? void 0 : s.options.splitChannels) ? t.numberOfChannels : 1;
        
        if (this.frequencyMax = this.frequencyMax || t.sampleRate / 2, !t)
            return;
        
        this.buffer = t;
        const n = t.sampleRate;
        const h = [];
        let o = this.noverlap;
        
        if (!o) {
            const e = t.length / this.canvas.width;
            o = Math.max(0, Math.round(r - e))
        }
        
        const l = new FFTWrapper(r, n, this.windowFunc, this.alpha);
        let c;
        
        switch (this.scale) {
        case "mel":
            c = this.createFilterBank(this.numMelFilters, n, this.hzToMel, this.melToHz);
            break;
        case "logarithmic":
            c = this.createFilterBank(this.numLogFilters, n, this.hzToLog, this.logToHz);
            break;
        case "bark":
            c = this.createFilterBank(this.numBarkFilters, n, this.hzToBark, this.barkToHz);
            break;
        case "erb":
            c = this.createFilterBank(this.numErbFilters, n, this.hzToErb, this.erbToHz);
        }
        
        for (let e = 0; e < i; e++) {
            const s = t.getChannelData(e);
            const i = [];
            let a = 0;
            
            while (a + r < s.length) {
                const tSlice = s.subarray(a, a + r);
                const e = new Uint8Array(r / 2);
                let n = l.calculateSpectrum(tSlice);
                
                if (c) n = this.applyFilterBank(n, c);
                
                for (let t = 0; t < r / 2; t++) {
                    const s = n[t] > 1e-12 ? n[t] : 1e-12;
                    const r = 20 * Math.log10(s);
                    if (r < -this.gainDB - this.rangeDB)
                        e[t] = 0;
                    else if (r > -this.gainDB)
                        e[t] = 255;
                    else
                        e[t] = (r + this.gainDB) / this.rangeDB * 255 + 256;
                }
                
                i.push(e);
                a += r - o;
            }
            
            h.push(i);
        }
        
        return h;
    }

    freqType(t) {
        return t >= 1e3 ? (t / 1e3).toFixed(1) : Math.round(t)
    }

    unitType(t) {
        return t >= 1e3 ? "kHz" : "Hz"
    }

    getLabelFrequency(t, e) {
        const s = this.hzToScale(this.frequencyMin);
        const r = this.hzToScale(this.frequencyMax);
        return this.scaleToHz(s + t / e * (r - s))
    }

    loadLabels(t, e, s, r, i, a, n, h, o) {
        t = t || "rgba(68,68,68,0)";
        e = e || "12px";
        s = s || "12px";
        r = r || "Helvetica";
        i = i || "#fff";
        a = a || "#fff";
        n = n || "center";
        
        const l = this.height || 512;
        const c = l / 256 * 5;
        const u = this.labelsEl.getContext("2d");
        const f = window.devicePixelRatio;
        
        if (this.labelsEl.height = this.height * o * f,
        this.labelsEl.width = 55 * f,
        u.scale(f, f),
        u)
            for (let h = 0; h < o; h++) {
                let o;
                for (u.fillStyle = t,
                u.fillRect(0, h * l, 55, (1 + h) * l),
                u.fill(),
                o = 0; o <= c; o++) {
                    u.textAlign = n;
                    u.textBaseline = "middle";
                    const t = this.getLabelFrequency(o, c);
                    const f = this.freqType(t);
                    const p = this.unitType(t);
                    const d = 16;
                    let w = (1 + h) * l - o / c * l;
                    w = Math.min(Math.max(w, h * l + 10), (1 + h) * l - 10);
                    u.fillStyle = a;
                    u.font = s + " " + r;
                    u.fillText(p, d + 24, w);
                    u.fillStyle = i;
                    u.font = e + " " + r;
                    u.fillText(f, d, w);
                }
            }
    }

    resample(t) {
        const outW = this.getWidth();
        const out = [];
        const invIn = 1 / t.length;

        const cacheKey = `${t.length}:${outW}`;
        let mapping = this._resampleCache[cacheKey];
        
        if (!mapping) {
            mapping = new Array(outW);
            const invOut = 1 / outW;
            for (let a = 0; a < outW; a++) {
                const contrib = [];
                for (let n = 0; n < t.length; n++) {
                    const s = n * invIn;
                    const h = s + invIn;
                    const o = a * invOut;
                    const l = o + invOut;
                    const c = Math.max(0, Math.min(h, l) - Math.max(s, o));
                    if (c > 0)
                        contrib.push([n, c / invOut]);
                }
                mapping[a] = contrib;
            }
            this._resampleCache[cacheKey] = mapping;
        }

        for (let a = 0; a < outW; a++) {
            const accum = new Array(t[0].length);
            const contrib = mapping[a];
            for (let j = 0; j < contrib.length; j++) {
                const nIdx = contrib[j][0];
                const weight = contrib[j][1];
                const src = t[nIdx];
                for (let u = 0; u < src.length; u++) {
                    if (accum[u] == null)
                        accum[u] = 0;
                    accum[u] += weight * src[u];
                }
            }
            const outArr = new Uint8Array(t[0].length);
            for (let o = 0; o < t[0].length; o++)
                outArr[o] = accum[o];
            out.push(outArr);
        }
        
        return out;
    }
}

export { Spectrogram as default };
