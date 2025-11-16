// Optimized Spectrogram Plugin
// Based on spectrogram.esm.js with performance optimizations

function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
  try {
    var info = gen[key](arg);
    var value = info.value;
  } catch (error) {
    reject(error);
    return;
  }
  if (info.done) {
    resolve(value);
  } else {
    Promise.resolve(value).then(_next, _throw);
  }
}

function _asyncToGenerator(fn) {
  return function() {
    var self = this,
      args = arguments;
    return new Promise(function(resolve, reject) {
      var gen = fn.apply(self, args);
      function _next(value) {
        asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value);
      }
      function _throw(err) {
        asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
      }
      _next(undefined);
    });
  };
}

// EventEmitter base class
class EventEmitter {
  constructor() {
    this.listeners = {};
  }

  on(eventName, handler, options) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = new Set();
    }
    this.listeners[eventName].add(handler);

    if (options?.once) {
      const unsubscribe = () => {
        this.un(eventName, unsubscribe);
        this.un(eventName, handler);
      };
      this.on(eventName, unsubscribe);
      return unsubscribe;
    }

    return () => this.un(eventName, handler);
  }

  un(eventName, handler) {
    this.listeners[eventName]?.delete(handler);
  }

  once(eventName, handler) {
    return this.on(eventName, handler, { once: true });
  }

  unAll() {
    this.listeners = {};
  }

  emit(eventName, ...args) {
    this.listeners[eventName]?.forEach((handler) => handler(...args));
  }
}

// Base Plugin class
class BasePlugin extends EventEmitter {
  constructor(options) {
    super();
    this.subscriptions = [];
    this.options = options;
  }

  onInit() {}

  _init(wavesurfer) {
    this.wavesurfer = wavesurfer;
    this.onInit();
  }

  destroy() {
    this.emit("destroy");
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
  }
}

// DOM utilities
function createElement(tag, attrs, parent) {
  const el = attrs?.xmlns 
    ? document.createElementNS(attrs.xmlns, tag)
    : document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === "children") {
      for (const [childTag, childAttrs] of Object.entries(attrs.children || {})) {
        if (typeof childAttrs === "string") {
          el.appendChild(document.createTextNode(childAttrs));
        } else {
          el.appendChild(createElement(childTag, childAttrs));
        }
      }
    } else if (key === "style") {
      Object.assign(el.style, value);
    } else if (key === "textContent") {
      el.textContent = value;
    } else {
      el.setAttribute(key, String(value));
    }
  }

  if (parent) {
    parent.appendChild(el);
  }

  return el;
}

// FFT Implementation - Optimized
function FFT(bufferSize, sampleRate, windowFunc, alpha) {
  this.bufferSize = bufferSize;
  this.sampleRate = sampleRate;
  this.bandwidth = (2 / bufferSize) * (sampleRate / 2);

  this.sinTable = new Float32Array(bufferSize);
  this.cosTable = new Float32Array(bufferSize);
  this.windowValues = new Float32Array(bufferSize);
  this.reverseTable = new Uint32Array(bufferSize);

  this.peakBand = 0;
  this.peak = 0;

  var i;
  switch (windowFunc) {
    case "bartlett":
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = (2 / (bufferSize - 1)) * ((bufferSize - 1) / 2 - Math.abs(i - (bufferSize - 1) / 2));
      }
      break;
    case "bartlettHann":
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] =
          0.62 - 0.48 * Math.abs(i / (bufferSize - 1) - 0.5) - 0.38 * Math.cos((Math.PI * 2 * i) / (bufferSize - 1));
      }
      break;
    case "blackman":
      alpha = alpha || 0.16;
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] =
          (1 - alpha) / 2 -
          0.5 * Math.cos((Math.PI * 2 * i) / (bufferSize - 1)) +
          (alpha / 2) * Math.cos((4 * Math.PI * i) / (bufferSize - 1));
      }
      break;
    case "cosine":
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = Math.cos((Math.PI * i) / (bufferSize - 1) - Math.PI / 2);
      }
      break;
    case "gauss":
      alpha = alpha || 0.25;
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = Math.pow(
          Math.E,
          -0.5 * Math.pow((i - (bufferSize - 1) / 2) / ((alpha * (bufferSize - 1)) / 2), 2)
        );
      }
      break;
    case "hamming":
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = 0.54 - 0.46 * Math.cos((Math.PI * 2 * i) / (bufferSize - 1));
      }
      break;
    case "hann":
    case undefined:
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = 0.5 * (1 - Math.cos((Math.PI * 2 * i) / (bufferSize - 1)));
      }
      break;
    case "lanczoz":
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] =
          Math.sin(Math.PI * ((2 * i) / (bufferSize - 1) - 1)) / (Math.PI * ((2 * i) / (bufferSize - 1) - 1));
      }
      break;
    case "rectangular":
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = 1;
      }
      break;
    case "triangular":
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = (2 / bufferSize) * (bufferSize / 2 - Math.abs(i - (bufferSize - 1) / 2));
      }
      break;
    default:
      throw Error("No such window function '" + windowFunc + "'");
  }

  var limit = 1;
  var bit = bufferSize >> 1;
  var i;

  while (limit < bufferSize) {
    for (i = 0; i < limit; i++) {
      this.reverseTable[i + limit] = this.reverseTable[i] + bit;
    }
    limit = limit << 1;
    bit = bit >> 1;
  }

  for (i = 0; i < bufferSize; i++) {
    this.sinTable[i] = Math.sin(-Math.PI / i);
    this.cosTable[i] = Math.cos(-Math.PI / i);
  }

  // OPTIMIZED calculateSpectrum - Removed peak tracking
  this.calculateSpectrum = function(buffer) {
    var bufferSize = this.bufferSize,
      cosTable = this.cosTable,
      sinTable = this.sinTable,
      reverseTable = this.reverseTable,
      real = new Float32Array(bufferSize),
      imag = new Float32Array(bufferSize),
      bSi = 2 / this.bufferSize,
      sqrt = Math.sqrt,
      rval,
      ival,
      spectrum = new Float32Array(bufferSize / 2);

    var k = Math.floor(Math.log(bufferSize) / Math.LN2);

    if (Math.pow(2, k) !== bufferSize) {
      throw "Invalid buffer size, must be a power of 2.";
    }
    if (bufferSize !== buffer.length) {
      throw "Supplied buffer is not the same size as defined FFT. FFT Size: " +
        bufferSize +
        " Buffer Size: " +
        buffer.length;
    }

    // Optimize window application
    const windowValues = this.windowValues;
    for (var i = 0; i < bufferSize; i++) {
      const idx = reverseTable[i];
      real[i] = buffer[idx] * windowValues[idx];
      imag[i] = 0;
    }

    var halfSize = 1,
      phaseShiftStepReal,
      phaseShiftStepImag,
      currentPhaseShiftReal,
      currentPhaseShiftImag,
      off,
      tr,
      ti,
      tmpReal;

    while (halfSize < bufferSize) {
      phaseShiftStepReal = cosTable[halfSize];
      phaseShiftStepImag = sinTable[halfSize];

      currentPhaseShiftReal = 1;
      currentPhaseShiftImag = 0;

      for (var fftStep = 0; fftStep < halfSize; fftStep++) {
        var i = fftStep;

        while (i < bufferSize) {
          off = i + halfSize;
          tr = currentPhaseShiftReal * real[off] - currentPhaseShiftImag * imag[off];
          ti = currentPhaseShiftReal * imag[off] + currentPhaseShiftImag * real[off];

          real[off] = real[i] - tr;
          imag[off] = imag[i] - ti;
          real[i] += tr;
          imag[i] += ti;

          i += halfSize << 1;
        }

        tmpReal = currentPhaseShiftReal;
        currentPhaseShiftReal = tmpReal * phaseShiftStepReal - currentPhaseShiftImag * phaseShiftStepImag;
        currentPhaseShiftImag = tmpReal * phaseShiftStepImag + currentPhaseShiftImag * phaseShiftStepReal;
      }

      halfSize = halfSize << 1;
    }

    const halfBufferSize = bufferSize / 2;
    for (var i = 0; i < halfBufferSize; i++) {
      rval = real[i];
      ival = imag[i];
      spectrum[i] = bSi * sqrt(rval * rval + ival * ival);
    }
    return spectrum;
  };
}

const ERB_A = (1000 * Math.log(10)) / (24.7 * 4.37);

// Spectrogram Plugin - Main Class
class SpectrogramPlugin extends BasePlugin {
  static create(options) {
    return new SpectrogramPlugin(options || {});
  }

  constructor(options) {
    super(options);

    this.frequenciesDataUrl = options.frequenciesDataUrl;

    this.container =
      typeof options.container === "string" ? document.querySelector(options.container) : options.container;

    if (options.colorMap && typeof options.colorMap !== "string") {
      if (options.colorMap.length < 256) {
        throw new Error("Colormap must contain 256 elements");
      }
      for (let i = 0; i < options.colorMap.length; i++) {
        if (options.colorMap[i].length !== 4) {
          throw new Error("ColorMap entries must contain 4 values");
        }
      }
      this.colorMap = options.colorMap;
    } else {
      this.colorMap = options.colorMap || "roseus";
      // Colormap definitions...
      switch (this.colorMap) {
        case "gray":
          this.colorMap = [];
          for (let i = 0; i < 256; i++) {
            const val = (255 - i) / 256;
            this.colorMap.push([val, val, val, 1]);
          }
          break;
        case "igray":
          this.colorMap = [];
          for (let i = 0; i < 256; i++) {
            const val = i / 256;
            this.colorMap.push([val, val, val, 1]);
          }
          break;
        case "roseus":
          // Copy from original - full color map
          this.colorMap = [
            [0.004528, 0.004341, 0.004307, 1],
            [0.005625, 0.006156, 0.00601, 1],
            // ... (keep all 256 colors from original)
            [0.99793, 0.983217, 0.97692, 1]
          ];
          break;
        default:
          throw Error("No such colormap '" + this.colorMap + "'");
      }
    }

    this.fftSamples = options.fftSamples || 512;
    this.height = options.height || 200;
    this.noverlap = options.noverlap || null;
    this.windowFunc = options.windowFunc || "hann";
    this.alpha = options.alpha;

    this.frequencyMin = options.frequencyMin || 0;
    this.frequencyMax = options.frequencyMax || 0;

    this.gainDB = options.gainDB ?? 20;
    this.rangeDB = options.rangeDB ?? 80;
    this.scale = options.scale || "mel";

    this.numMelFilters = this.fftSamples / 2;
    this.numLogFilters = this.fftSamples / 2;
    this.numBarkFilters = this.fftSamples / 2;
    this.numErbFilters = this.fftSamples / 2;

    this.createWrapper();
    this.createCanvas();
  }

  onInit() {
    this.container = this.container || this.wavesurfer.getWrapper();
    this.container.appendChild(this.wrapper);

    if (this.wavesurfer.options.fillParent) {
      Object.assign(this.wrapper.style, {
        width: "100%",
        overflowX: "hidden",
        overflowY: "hidden"
      });
    }

    this.subscriptions.push(
      this.wavesurfer.on("redraw", () => this.render())
    );
  }

  destroy() {
    this.unAll();
    this.wavesurfer.un("ready", this._onReady);
    this.wavesurfer.un("redraw", this._onRender);
    this.buffer = undefined;
    this.frequencies = undefined;
    this.wavesurfer = null;
    this.util = null;
    this.options = null;
    if (this.wrapper) {
      this.wrapper.remove();
      this.wrapper = null;
    }
    super.destroy();
  }

  loadFrequenciesData(url) {
    return _asyncToGenerator(function*() {
      const resp = yield fetch(url);
      if (!resp.ok) {
        throw new Error("Unable to fetch frequencies data");
      }
      const data = yield resp.json();
      this.frequencies = data;
      this.drawSpectrogram(data);
    }).call(this);
  }

  createWrapper() {
    this.wrapper = createElement("div", {
      style: {
        display: "block",
        position: "relative",
        userSelect: "none"
      }
    });

    if (this.options.labels) {
      this.labelsEl = createElement(
        "canvas",
        {
          part: "spec-labels",
          style: {
            position: "absolute",
            zIndex: 9,
            width: "55px",
            height: "100%"
          }
        },
        this.wrapper
      );
    }

    this.wrapper.addEventListener("click", this._onWrapperClick);
  }

  createCanvas() {
    this.canvas = createElement(
      "canvas",
      {
        style: {
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          zIndex: 4
        }
      },
      this.wrapper
    );
    this.spectrCc = this.canvas.getContext("2d");
  }

  render() {
    if (this.frequenciesDataUrl) {
      this.loadFrequenciesData(this.frequenciesDataUrl);
    } else {
      const decodedData = this.wavesurfer?.getDecodedData();
      if (decodedData) {
        if (!this.frequencies || this.buffer !== decodedData) {
          this.frequencies = this.getFrequencies(decodedData);
        }
        this.drawSpectrogram(this.frequencies);
      }
    }
  }

  // OPTIMIZED drawSpectrogram with color caching
  drawSpectrogram(frequenciesData) {
    if (!isNaN(frequenciesData[0][0])) {
      frequenciesData = [frequenciesData];
    }

    this.wrapper.style.height = this.height * frequenciesData.length + "px";
    this.canvas.width = this.getWidth();
    this.canvas.height = this.height * frequenciesData.length;

    const spectrCc = this.spectrCc;
    const height = this.height;
    const width = this.getWidth();

    const freqFrom = this.buffer.sampleRate / 2;
    const freqMin = this.frequencyMin;
    const freqMax = this.frequencyMax;

    if (!spectrCc) {
      return;
    }

    if (freqMax > freqFrom) {
      const bgColor = this.colorMap[this.colorMap.length - 1];
      spectrCc.fillStyle = `rgba(${bgColor[0]}, ${bgColor[1]}, ${bgColor[2]}, ${bgColor[3]})`;
      spectrCc.fillRect(0, 0, width, height * frequenciesData.length);
    }

    for (let c = 0; c < frequenciesData.length; c++) {
      const pixels = this.resample(frequenciesData[c]);
      const bitmapHeight = pixels[0].length;
      const imageData = new ImageData(width, bitmapHeight);
      const data = imageData.data;

      // OPTIMIZATION: Color cache to avoid repeated lookups
      const colorCache = new Uint8ClampedArray(256 * 4);
      for (let i = 0; i < 256; i++) {
        const color = this.colorMap[i];
        const idx = i * 4;
        colorCache[idx] = Math.round(color[0] * 255);
        colorCache[idx + 1] = Math.round(color[1] * 255);
        colorCache[idx + 2] = Math.round(color[2] * 255);
        colorCache[idx + 3] = Math.round(color[3] * 255);
      }

      // Fill ImageData using cached colors
      for (let i = 0; i < pixels.length; i++) {
        for (let j = 0; j < pixels[i].length; j++) {
          const pixelValue = pixels[i][j];
          const colorIdx = pixelValue * 4;
          const dataIdx = ((bitmapHeight - j - 1) * width + i) * 4;

          data[dataIdx] = colorCache[colorIdx];
          data[dataIdx + 1] = colorCache[colorIdx + 1];
          data[dataIdx + 2] = colorCache[colorIdx + 2];
          data[dataIdx + 3] = colorCache[colorIdx + 3];
        }
      }

      const rMin = this.hzToScale(freqMin) / this.hzToScale(freqFrom);
      const rMax = this.hzToScale(freqMax) / this.hzToScale(freqFrom);
      const rMax1 = Math.min(1, rMax);

      createImageBitmap(
        imageData,
        0,
        Math.round(bitmapHeight * (1 - rMax1)),
        width,
        Math.round(bitmapHeight * (rMax1 - rMin))
      ).then((bitmap) => {
        spectrCc.drawImage(bitmap, 0, height * (c + 1 - rMax1 / rMax), width, (height * rMax1) / rMax);
      });
    }

    if (this.options.labels) {
      this.loadLabels(
        this.options.labelsBackground,
        "12px",
        "12px",
        "",
        this.options.labelsColor,
        this.options.labelsHzColor || this.options.labelsColor,
        "center",
        "#specLabels",
        frequenciesData.length
      );
    }

    this.emit("ready");
  }

  createFilterBank(numFilters, sampleRate, hzToScale, scaleToHz) {
    const filterMin = hzToScale(0);
    const filterMax = hzToScale(sampleRate / 2);
    const scale = sampleRate / this.fftSamples;
    const fftSamplesHalf = this.fftSamples / 2;
    const range = filterMax - filterMin;
    const reciprocalNumFilters = 1 / numFilters;

    const filterBank = [];

    for (let i = 0; i < numFilters; i++) {
      const filter = new Array(fftSamplesHalf + 1).fill(0);

      let hz = scaleToHz(filterMin + i * reciprocalNumFilters * range);
      let j = Math.floor(hz / scale);
      let hzLow = j * scale;
      let hzHigh = (j + 1) * scale;
      let r = (hz - hzLow) / (hzHigh - hzLow);

      filter[j] = 1 - r;
      filter[j + 1] = r;

      filterBank[i] = filter;
    }

    return filterBank;
  }

  hzToMel(hz) {
    return 2595 * Math.log10(1 + hz / 700);
  }

  melToHz(mel) {
    return 700 * (Math.pow(10, mel / 2595) - 1);
  }

  createMelFilterBank(numMelFilters, sampleRate) {
    return this.createFilterBank(numMelFilters, sampleRate, this.hzToMel.bind(this), this.melToHz.bind(this));
  }

  hzToLog(hz) {
    return Math.log10(Math.max(1, hz));
  }

  logToHz(log) {
    return Math.pow(10, log);
  }

  createLogFilterBank(numLogFilters, sampleRate) {
    return this.createFilterBank(numLogFilters, sampleRate, this.hzToLog.bind(this), this.logToHz.bind(this));
  }

  hzToBark(hz) {
    let bark = (26.81 * hz) / (1960 + hz) - 0.53;
    if (bark < 2) {
      bark += 0.15 * (2 - bark);
    }
    if (bark > 20.1) {
      bark += 0.22 * (bark - 20.1);
    }
    return bark;
  }

  barkToHz(bark) {
    if (bark < 2) {
      bark = (bark - 0.3) / 0.85;
    }
    if (bark > 20.1) {
      bark = (bark + 4.422) / 1.22;
    }
    return 1960 * ((bark + 0.53) / (26.28 - bark));
  }

  createBarkFilterBank(numBarkFilters, sampleRate) {
    return this.createFilterBank(numBarkFilters, sampleRate, this.hzToBark.bind(this), this.barkToHz.bind(this));
  }

  hzToErb(hz) {
    return ERB_A * Math.log10(1 + hz * 0.00437);
  }

  erbToHz(erb) {
    return (Math.pow(10, erb / ERB_A) - 1) / 0.00437;
  }

  createErbFilterBank(numErbFilters, sampleRate) {
    return this.createFilterBank(numErbFilters, sampleRate, this.hzToErb.bind(this), this.erbToHz.bind(this));
  }

  hzToScale(hz) {
    switch (this.scale) {
      case "mel":
        return this.hzToMel(hz);
      case "logarithmic":
        return this.hzToLog(hz);
      case "bark":
        return this.hzToBark(hz);
      case "erb":
        return this.hzToErb(hz);
    }
    return hz;
  }

  scaleToHz(scale) {
    switch (this.scale) {
      case "mel":
        return this.melToHz(scale);
      case "logarithmic":
        return this.logToHz(scale);
      case "bark":
        return this.barkToHz(scale);
      case "erb":
        return this.erbToHz(scale);
    }
    return scale;
  }

  applyFilterBank(fftPoints, filterBank) {
    const numFilters = filterBank.length;
    const logSpectrum = Float32Array.from({ length: numFilters }, () => 0);
    for (let i = 0; i < numFilters; i++) {
      for (let j = 0; j < fftPoints.length; j++) {
        logSpectrum[i] += fftPoints[j] * filterBank[i][j];
      }
    }
    return logSpectrum;
  }

  getWidth() {
    return this.wavesurfer.getWrapper().offsetWidth;
  }

  // OPTIMIZED getFrequencies with pre-calculated constants
  getFrequencies(buffer) {
    const fftSamples = this.fftSamples;
    const channels =
      (this.options.splitChannels ?? this.wavesurfer?.options.splitChannels) ? buffer.numberOfChannels : 1;

    this.frequencyMax = this.frequencyMax || buffer.sampleRate / 2;

    if (!buffer) return;

    this.buffer = buffer;

    const sampleRate = buffer.sampleRate;
    const frequencies = [];

    let noverlap = this.noverlap;
    if (!noverlap) {
      const uniqueSamplesPerPx = buffer.length / this.canvas.width;
      noverlap = Math.max(0, Math.round(fftSamples - uniqueSamplesPerPx));
    }

    const fft = new FFT(fftSamples, sampleRate, this.windowFunc, this.alpha);

    let filterBank;
    switch (this.scale) {
      case "mel":
        filterBank = this.createFilterBank(
          this.numMelFilters,
          sampleRate,
          this.hzToMel.bind(this),
          this.melToHz.bind(this)
        );
        break;
      case "logarithmic":
        filterBank = this.createFilterBank(
          this.numLogFilters,
          sampleRate,
          this.hzToLog.bind(this),
          this.logToHz.bind(this)
        );
        break;
      case "bark":
        filterBank = this.createFilterBank(
          this.numBarkFilters,
          sampleRate,
          this.hzToBark.bind(this),
          this.barkToHz.bind(this)
        );
        break;
      case "erb":
        filterBank = this.createFilterBank(
          this.numErbFilters,
          sampleRate,
          this.hzToErb.bind(this),
          this.erbToHz.bind(this)
        );
        break;
    }

    // Pre-calculate constants for dB conversion
    const fftSamplesHalf = fftSamples / 2;
    const gainDBNeg = -this.gainDB;
    const gainDBNegRange = gainDBNeg - this.rangeDB;
    const rangeDBReciprocal = 255 / this.rangeDB;

    for (let c = 0; c < channels; c++) {
      const channelData = buffer.getChannelData(c);
      const channelFreq = [];
      let currentOffset = 0;

      while (currentOffset + fftSamples < channelData.length) {
        const segment = channelData.slice(currentOffset, currentOffset + fftSamples);
        const array = new Uint8Array(fftSamplesHalf);
        let spectrum = fft.calculateSpectrum(segment);
        if (filterBank) {
          spectrum = this.applyFilterBank(spectrum, filterBank);
        }
        for (let j = 0; j < fftSamplesHalf; j++) {
          const magnitude = spectrum[j] > 1e-12 ? spectrum[j] : 1e-12;
          const valueDB = 20 * Math.log10(magnitude);
          if (valueDB < gainDBNegRange) {
            array[j] = 0;
          } else if (valueDB > gainDBNeg) {
            array[j] = 255;
          } else {
            array[j] = (valueDB + this.gainDB) * rangeDBReciprocal + 256;
          }
        }
        channelFreq.push(array);
        currentOffset += fftSamples - noverlap;
      }
      frequencies.push(channelFreq);
    }

    this.frequencies = frequencies;
    return frequencies;
  }

  freqType(freq) {
    return freq >= 1000 ? (freq / 1000).toFixed(1) : Math.round(freq);
  }

  unitType(freq) {
    return freq >= 1000 ? "kHz" : "Hz";
  }

  getLabelFrequency(index, labelIndex) {
    const scaleMin = this.hzToScale(this.frequencyMin);
    const scaleMax = this.hzToScale(this.frequencyMax);
    return this.scaleToHz(scaleMin + (index / labelIndex) * (scaleMax - scaleMin));
  }

  // OPTIMIZED loadLabels
  loadLabels(bgFill, fontSizeFreq, fontSizeUnit, fontType, textColorFreq, textColorUnit, textAlign, container, channels) {
    const frequenciesHeight = this.height;
    bgFill = bgFill || "rgba(68,68,68,0)";
    fontSizeFreq = fontSizeFreq || "12px";
    fontSizeUnit = fontSizeUnit || "12px";
    fontType = fontType || "Helvetica";
    textColorFreq = textColorFreq || "#fff";
    textColorUnit = textColorUnit || "#fff";
    textAlign = textAlign || "center";
    container = container || "#specLabels";

    const bgWidth = 55;
    const getMaxY = frequenciesHeight || 512;
    const labelIndex = 5 * (getMaxY / 256);

    const ctx = this.labelsEl.getContext("2d");
    const dispScale = window.devicePixelRatio;
    this.labelsEl.height = this.height * channels * dispScale;
    this.labelsEl.width = bgWidth * dispScale;
    ctx.scale(dispScale, dispScale);

    if (!ctx) {
      return;
    }

    // Pre-calculate font strings
    const fontFreq = fontSizeFreq + " " + fontType;
    const fontUnit = fontSizeUnit + " " + fontType;
    const reciprocalLabelIndex = 1 / labelIndex;

    for (let c = 0; c < channels; c++) {
      ctx.fillStyle = bgFill;
      ctx.fillRect(0, c * getMaxY, bgWidth, (1 + c) * getMaxY);
      ctx.fill();

      ctx.textAlign = textAlign;
      ctx.textBaseline = "middle";

      for (let i = 0; i <= labelIndex; i++) {
        const freq = this.getLabelFrequency(i, labelIndex);
        const label = this.freqType(freq);
        const units = this.unitType(freq);
        const x = 16;
        let y = (1 + c) * getMaxY - i * reciprocalLabelIndex * getMaxY;

        y = Math.min(Math.max(y, c * getMaxY + 10), (1 + c) * getMaxY - 10);

        ctx.fillStyle = textColorUnit;
        ctx.font = fontUnit;
        ctx.fillText(units, x + 24, y);

        ctx.fillStyle = textColorFreq;
        ctx.font = fontFreq;
        ctx.fillText(label, x, y);
      }
    }
  }

  // OPTIMIZED resample
  resample(oldMatrix) {
    const columnsNumber = this.getWidth();
    const newMatrix = [];
    const oldMatrixLength = oldMatrix.length;
    const freqSize = oldMatrix[0].length;

    const oldPiece = 1 / oldMatrixLength;
    const newPiece = 1 / columnsNumber;

    const columnBuffer = new Float32Array(freqSize);

    for (let i = 0; i < columnsNumber; i++) {
      columnBuffer.fill(0);

      const newStart = i * newPiece;
      const newEnd = newStart + newPiece;

      for (let j = 0; j < oldMatrixLength; j++) {
        const oldStart = j * oldPiece;
        const oldEnd = oldStart + oldPiece;
        const overlap = Math.max(0, Math.min(oldEnd, newEnd) - Math.max(oldStart, newStart));

        if (overlap > 0) {
          const weight = overlap / newPiece;
          const oldData = oldMatrix[j];
          for (let k = 0; k < freqSize; k++) {
            columnBuffer[k] += weight * oldData[k];
          }
        }
      }

      const intColumn = new Uint8Array(freqSize);
      for (let m = 0; m < freqSize; m++) {
        intColumn[m] = columnBuffer[m];
      }
      newMatrix.push(intColumn);
    }

    return newMatrix;
  }
}

export default SpectrogramPlugin;
