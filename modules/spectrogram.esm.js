/*
  spectrogram.esm.js - de-minified JS built from spectrogram.ts
  Preserves runtime behavior while removing TypeScript-only syntax.
*/

// Calculate FFT - Based on https://github.com/corbanbrook/dsp.js
function FFT(bufferSize, sampleRate, windowFunc, alpha) {
  this.bufferSize = bufferSize
  this.sampleRate = sampleRate
  this.bandwidth = (2 / bufferSize) * (sampleRate / 2)

  this.sinTable = new Float32Array(bufferSize)
  this.cosTable = new Float32Array(bufferSize)
  this.windowValues = new Float32Array(bufferSize)
  this.reverseTable = new Uint32Array(bufferSize)

  this.peakBand = 0
  this.peak = 0

  var i
  switch (windowFunc) {
    case 'bartlett':
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = (2 / (bufferSize - 1)) * ((bufferSize - 1) / 2 - Math.abs(i - (bufferSize - 1) / 2))
      }
      break
    case 'bartlettHann':
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] =
          0.62 - 0.48 * Math.abs(i / (bufferSize - 1) - 0.5) - 0.38 * Math.cos((Math.PI * 2 * i) / (bufferSize - 1))
      }
      break
    case 'blackman':
      alpha = alpha || 0.16
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] =
          (1 - alpha) / 2 -
          0.5 * Math.cos((Math.PI * 2 * i) / (bufferSize - 1)) +
          (alpha / 2) * Math.cos((4 * Math.PI * i) / (bufferSize - 1))
      }
      break
    case 'cosine':
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = Math.cos((Math.PI * i) / (bufferSize - 1) - Math.PI / 2)
      }
      break
    case 'gauss':
      alpha = alpha || 0.25
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = Math.pow(
          Math.E,
          -0.5 * Math.pow((i - (bufferSize - 1) / 2) / ((alpha * (bufferSize - 1)) / 2), 2),
        )
      }
      break
    case 'hamming':
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = 0.54 - 0.46 * Math.cos((Math.PI * 2 * i) / (bufferSize - 1))
      }
      break
    case 'hann':
    case undefined:
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = 0.5 * (1 - Math.cos((Math.PI * 2 * i) / (bufferSize - 1)))
      }
      break
    case 'lanczoz':
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] =
          Math.sin(Math.PI * ((2 * i) / (bufferSize - 1) - 1)) / (Math.PI * ((2 * i) / (bufferSize - 1) - 1))
      }
      break
    case 'rectangular':
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = 1
      }
      break
    case 'triangular':
      for (i = 0; i < bufferSize; i++) {
        this.windowValues[i] = (2 / bufferSize) * (bufferSize / 2 - Math.abs(i - (bufferSize - 1) / 2))
      }
      break
    default:
      throw Error("No such window function '" + windowFunc + "'")
  }

  var limit = 1
  var bit = bufferSize >> 1

  while (limit < bufferSize) {
    for (i = 0; i < limit; i++) {
      this.reverseTable[i + limit] = this.reverseTable[i] + bit
    }

    limit = limit << 1
    bit = bit >> 1
  }

  for (i = 0; i < bufferSize; i++) {
    this.sinTable[i] = Math.sin(-Math.PI / i)
    this.cosTable[i] = Math.cos(-Math.PI / i)
  }

  this.calculateSpectrum = function (buffer) {
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
      mag,
      spectrum = new Float32Array(bufferSize / 2)

    var k = Math.floor(Math.log(bufferSize) / Math.LN2)

    if (Math.pow(2, k) !== bufferSize) {
      throw 'Invalid buffer size, must be a power of 2.'
    }
    if (bufferSize !== buffer.length) {
      throw (
        'Supplied buffer is not the same size as defined FFT. FFT Size: ' +
        bufferSize +
        ' Buffer Size: ' +
        buffer.length
      )
    }

    var halfSize = 1,
      phaseShiftStepReal,
      phaseShiftStepImag,
      currentPhaseShiftReal,
      currentPhaseShiftImag,
      off,
      tr,
      ti,
      tmpReal

    for (var i = 0; i < bufferSize; i++) {
      real[i] = buffer[reverseTable[i]] * this.windowValues[reverseTable[i]]
      imag[i] = 0
    }

    while (halfSize < bufferSize) {
      phaseShiftStepReal = cosTable[halfSize]
      phaseShiftStepImag = sinTable[halfSize]

      currentPhaseShiftReal = 1
      currentPhaseShiftImag = 0

      for (var fftStep = 0; fftStep < halfSize; fftStep++) {
        var i = fftStep

        while (i < bufferSize) {
          off = i + halfSize
          tr = currentPhaseShiftReal * real[off] - currentPhaseShiftImag * imag[off]
          ti = currentPhaseShiftReal * imag[off] + currentPhaseShiftImag * real[off]

          real[off] = real[i] - tr
          imag[off] = imag[i] - ti
          real[i] += tr
          imag[i] += ti

          i += halfSize << 1
        }

        tmpReal = currentPhaseShiftReal
        currentPhaseShiftReal = tmpReal * phaseShiftStepReal - currentPhaseShiftImag * phaseShiftStepImag
        currentPhaseShiftImag = tmpReal * phaseShiftStepImag + currentPhaseShiftImag * phaseShiftStepReal
      }

      halfSize = halfSize << 1
    }

    for (var i = 0, N = bufferSize / 2; i < N; i++) {
      rval = real[i]
      ival = imag[i]
      mag = bSi * sqrt(rval * rval + ival * ival)

      if (mag > this.peak) {
        this.peakBand = i
        this.peak = mag
      }
      spectrum[i] = mag
    }
    return spectrum
  }
}

const ERB_A = (1000 * Math.log(10)) / (24.7 * 4.37)

import BasePlugin from '../base-plugin.js'
import createElement from '../dom.js'

class SpectrogramPlugin extends BasePlugin {
  static create(options) {
    return new SpectrogramPlugin(options || {})
  }

  constructor(options) {
    super(options)

    this.frequenciesDataUrl = options.frequenciesDataUrl

    this.container = typeof options.container === 'string' ? document.querySelector(options.container) : options.container

    if (options.colorMap && typeof options.colorMap !== 'string') {
      if (options.colorMap.length < 256) {
        throw new Error('Colormap must contain 256 elements')
      }
      for (let i = 0; i < options.colorMap.length; i++) {
        const cmEntry = options.colorMap[i]
        if (cmEntry.length !== 4) {
          throw new Error('ColorMap entries must contain 4 values')
        }
      }
      this.colorMap = options.colorMap
    } else {
      this.colorMap = options.colorMap || 'roseus'
      switch (this.colorMap) {
        case 'gray':
          this.colorMap = []
          for (let i = 0; i < 256; i++) {
            const val = (255 - i) / 256
            this.colorMap.push([val, val, val, 1])
          }
          break
        case 'igray':
          this.colorMap = []
          for (let i = 0; i < 256; i++) {
            const val = i / 256
            this.colorMap.push([val, val, val, 1])
          }
          break
        case 'roseus':
          this.colorMap = [
            [0.004528, 0.004341, 0.004307, 1],
            [0.005625, 0.006156, 0.00601, 1],
            [0.006628, 0.008293, 0.008161, 1],
            [0.007551, 0.010738, 0.01079, 1],
            [0.008382, 0.013482, 0.013941, 1],
            [0.009111, 0.01652, 0.017662, 1],
            [0.009727, 0.019846, 0.022009, 1],
            [0.010223, 0.023452, 0.027035, 1],
            [0.010593, 0.027331, 0.032799, 1],
            [0.010833, 0.031475, 0.039361, 1],
            [0.010941, 0.035875, 0.046415, 1],
            [0.010918, 0.04052, 0.053597, 1],
            [0.010768, 0.045158, 0.060914, 1],
            [0.010492, 0.049708, 0.068367, 1],
            [0.010098, 0.054171, 0.075954, 1],
            [0.009594, 0.058549, 0.083672, 1],
            [0.008989, 0.06284, 0.091521, 1],
            [0.008297, 0.067046, 0.099499, 1],
            [0.00753, 0.071165, 0.107603, 1],
            [0.006704, 0.075196, 0.11583, 1],
            [0.005838, 0.07914, 0.124178, 1],
            [0.004949, 0.082994, 0.132643, 1],
            [0.004062, 0.086758, 0.141223, 1],
            [0.003198, 0.09043, 0.149913, 1],
            [0.002382, 0.09401, 0.158711, 1],
            [0.001643, 0.097494, 0.167612, 1],
            [0.001009, 0.100883, 0.176612, 1],
            [0.000514, 0.104174, 0.185704, 1],
            [0.000187, 0.107366, 0.194886, 1],
            [0.000066, 0.110457, 0.204151, 1],
            [0.000186, 0.113445, 0.213496, 1],
            [0.000587, 0.116329, 0.222914, 1],
            [0.001309, 0.119106, 0.232397, 1],
            [0.002394, 0.121776, 0.241942, 1],
            [0.003886, 0.124336, 0.251542, 1],
            [0.005831, 0.126784, 0.261189, 1],
            [0.008276, 0.12912, 0.270876, 1],
            [0.011268, 0.131342, 0.280598, 1],
            [0.014859, 0.133447, 0.290345, 1],
            [0.0191, 0.135435, 0.300111, 1],
            [0.024043, 0.137305, 0.309888, 1],
            [0.029742, 0.139054, 0.319669, 1],
            [0.036252, 0.140683, 0.329441, 1],
            [0.043507, 0.142189, 0.339203, 1],
            [0.050922, 0.143571, 0.348942, 1],
            [0.058432, 0.144831, 0.358649, 1],
            [0.066041, 0.145965, 0.368319, 1],
            [0.073744, 0.146974, 0.377938, 1],
            [0.081541, 0.147858, 0.387501, 1],
            [0.089431, 0.148616, 0.396998, 1],
            [0.097411, 0.149248, 0.406419, 1],
            [0.105479, 0.149754, 0.415755, 1],
            [0.113634, 0.150134, 0.424998, 1],
            [0.121873, 0.150389, 0.434139, 1],
            [0.130192, 0.150521, 0.443167, 1],
            [0.138591, 0.150528, 0.452075, 1],
            [0.147065, 0.150413, 0.460852, 1],
            [0.155614, 0.150175, 0.469493, 1],
            [0.164232, 0.149818, 0.477985, 1],
            [0.172917, 0.149343, 0.486322, 1],
            [0.181666, 0.148751, 0.494494, 1],
            [0.190476, 0.148046, 0.502493, 1],
            [0.199344, 0.147229, 0.510313, 1],
            [0.208267, 0.146302, 0.517944, 1],
            [0.217242, 0.145267, 0.52538, 1],
            [0.226264, 0.144131, 0.532613, 1],
            [0.235331, 0.142894, 0.539635, 1],
            [0.24444, 0.141559, 0.546442, 1],
            [0.253587, 0.140131, 0.553026, 1],
            [0.262769, 0.138615, 0.559381, 1],
            [0.271981, 0.137016, 0.5655, 1],
            [0.281222, 0.135335, 0.571381, 1],
            [0.290487, 0.133581, 0.577017, 1],
            [0.299774, 0.131757, 0.582404, 1],
            [0.30908, 0.129867, 0.587538, 1],
            [0.318399, 0.12792, 0.592415, 1],
            [0.32773, 0.125921, 0.597032, 1],
            [0.337069, 0.123877, 0.601385, 1],
            [0.346413, 0.121793, 0.605474, 1],
            [0.355758, 0.119678, 0.609295, 1],
            [0.365102, 0.11754, 0.612846, 1],
            [0.374443, 0.115386, 0.616127, 1],
            [0.383774, 0.113226, 0.619138, 1],
            [0.393096, 0.111066, 0.621876, 1],
            [0.402404, 0.108918, 0.624343, 1],
            [0.411694, 0.106794, 0.62654, 1],
            [0.420967, 0.104698, 0.628466, 1],
            [0.430217, 0.102645, 0.630123, 1],
            [0.439442, 0.100647, 0.631513, 1],
            [0.448637, 0.098717, 0.632638, 1],
            [0.457805, 0.096861, 0.633499, 1],
          ]
          break
        default:
          throw Error("No such colormap '" + this.colorMap + "'")
      }
    }

    this.fftSamples = options.fftSamples || 512
    this.height = options.height || 200
    this.noverlap = options.noverlap || null // Will be calculated later based on canvas size
    this.windowFunc = options.windowFunc || 'hann'
    this.alpha = options.alpha

    this.frequencyMin = options.frequencyMin || 0
    this.frequencyMax = options.frequencyMax || 0

    this.gainDB = options.gainDB ?? 20
    this.rangeDB = options.rangeDB ?? 80
    this.scale = options.scale || 'mel'

    this.numMelFilters = this.fftSamples / 2
    this.numLogFilters = this.fftSamples / 2
    this.numBarkFilters = this.fftSamples / 2
    this.numErbFilters = this.fftSamples / 2

    this.createWrapper()
    this.createCanvas()
  }

  onInit() {
    this.container = this.container || this.wavesurfer.getWrapper()
    this.container.appendChild(this.wrapper)

    if (this.wavesurfer.options.fillParent) {
      Object.assign(this.wrapper.style, {
        width: '100%',
        overflowX: 'hidden',
        overflowY: 'hidden',
      })
    }
    this.subscriptions.push(
      this.wavesurfer.on('decode', () => {
        this.buffer = undefined
        this.frequencies = undefined
      }),
      this.wavesurfer.on('redraw', () => this.render()),
    )
  }

  destroy() {
    this.unAll()
    this.wavesurfer.un('ready', this._onReady)
    this.wavesurfer.un('redraw', this._onRender)
    this.buffer = undefined
    this.frequencies = undefined
    this.wavesurfer = null
    this.util = null
    this.options = null
    if (this.wrapper) {
      this.wrapper.remove()
      this.wrapper = null
    }
    super.destroy()
  }

  async loadFrequenciesData(url) {
    const resp = await fetch(url)
    if (!resp.ok) {
      throw new Error('Unable to fetch frequencies data')
    }
    const data = await resp.json()
    this.frequencies = data
    this.drawSpectrogram(data)
  }

  createWrapper() {
    this.wrapper = createElement('div', {
      style: {
        display: 'block',
        position: 'relative',
        userSelect: 'none',
      },
    })

    if (this.options.labels) {
      this.labelsEl = createElement(
        'canvas',
        {
          part: 'spec-labels',
          style: {
            position: 'absolute',
            zIndex: 9,
            width: '55px',
            height: '100%',
          },
        },
        this.wrapper,
      )
    }

    this.wrapper.addEventListener('click', this._onWrapperClick)
  }

  createCanvas() {
    this.canvas = createElement(
      'canvas',
      {
        style: {
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          zIndex: 4,
        },
      },
      this.wrapper,
    )
    this.spectrCc = this.canvas.getContext('2d')
  }

  render() {
    if (this.frequenciesDataUrl) {
      this.loadFrequenciesData(this.frequenciesDataUrl)
    } else {
      const decodedData = this.wavesurfer?.getDecodedData()
      if (decodedData) {
        if (!this.frequencies || this.buffer !== decodedData) {
          this.frequencies = this.getFrequencies(decodedData)
        }
        this.drawSpectrogram(this.frequencies)
      }
    }
  }

  drawSpectrogram(frequenciesData) {
    if (!isNaN(frequenciesData[0][0])) {
      frequenciesData = [frequenciesData]
    }

    this.wrapper.style.height = this.height * frequenciesData.length + 'px'

    this.canvas.width = this.getWidth()
    this.canvas.height = this.height * frequenciesData.length

    const spectrCc = this.spectrCc
    const height = this.height
    const width = this.getWidth()

    const freqFrom = this.buffer.sampleRate / 2

    const freqMin = this.frequencyMin
    const freqMax = this.frequencyMax

    if (!spectrCc) {
      return
    }

    if (freqMax > freqFrom) {
      const bgColor = this.colorMap[this.colorMap.length - 1]
      spectrCc.fillStyle = `rgba(${bgColor[0]}, ${bgColor[1]}, ${bgColor[2]}, ${bgColor[3]})`
      spectrCc.fillRect(0, 0, width, height * frequenciesData.length)
    }

    for (let c = 0; c < frequenciesData.length; c++) {
      const pixels = this.resample(frequenciesData[c])
      const bitmapHeight = pixels[0].length
      const imageData = new ImageData(width, bitmapHeight)

      for (let i = 0; i < pixels.length; i++) {
        for (let j = 0; j < pixels[i].length; j++) {
          const colorMap = this.colorMap[pixels[i][j]]
          const redIndex = ((bitmapHeight - j - 1) * width + i) * 4
          imageData.data[redIndex] = colorMap[0] * 255
          imageData.data[redIndex + 1] = colorMap[1] * 255
          imageData.data[redIndex + 2] = colorMap[2] * 255
          imageData.data[redIndex + 3] = colorMap[3] * 255
        }
      }

      const rMin = this.hzToScale(freqMin) / this.hzToScale(freqFrom)
      const rMax = this.hzToScale(freqMax) / this.hzToScale(freqFrom)

      const rMax1 = Math.min(1, rMax)

      createImageBitmap(
        imageData,
        0,
        Math.round(bitmapHeight * (1 - rMax1)),
        width,
        Math.round(bitmapHeight * (rMax1 - rMin)),
      ).then((bitmap) => {
        spectrCc.drawImage(bitmap, 0, height * (c + 1 - rMax1 / rMax), width, (height * rMax1) / rMax)
      })
    }

    if (this.options.labels) {
      this.loadLabels(
        this.options.labelsBackground,
        '12px',
        '12px',
        '',
        this.options.labelsColor,
        this.options.labelsHzColor || this.options.labelsColor,
        'center',
        '#specLabels',
        frequenciesData.length,
      )
    }

    this.emit('ready')
  }

  createFilterBank(numFilters, sampleRate, hzToScale, scaleToHz) {
    const filterMin = hzToScale(0)
    const filterMax = hzToScale(sampleRate / 2)
    const filterBank = Array.from({ length: numFilters }, () => Array(this.fftSamples / 2 + 1).fill(0))
    const scale = sampleRate / this.fftSamples
    for (let i = 0; i < numFilters; i++) {
      let hz = scaleToHz(filterMin + (i / numFilters) * (filterMax - filterMin))
      let j = Math.floor(hz / scale)
      let hzLow = j * scale
      let hzHigh = (j + 1) * scale
      let r = (hz - hzLow) / (hzHigh - hzLow)
      filterBank[i][j] = 1 - r
      filterBank[i][j + 1] = r
    }
    return filterBank
  }

  hzToMel(hz) {
    return 2595 * Math.log10(1 + hz / 700)
  }

  melToHz(mel) {
    return 700 * (Math.pow(10, mel / 2595) - 1)
  }

  createMelFilterBank(numMelFilters, sampleRate) {
    return this.createFilterBank(numMelFilters, sampleRate, this.hzToMel, this.melToHz)
  }

  hzToLog(hz) {
    return Math.log10(Math.max(1, hz))
  }

  logToHz(log) {
    return Math.pow(10, log)
  }

  createLogFilterBank(numLogFilters, sampleRate) {
    return this.createFilterBank(numLogFilters, sampleRate, this.hzToLog, this.logToHz)
  }

  hzToBark(hz) {
    let bark = (26.81 * hz) / (1960 + hz) - 0.53
    if (bark < 2) {
      bark += 0.15 * (2 - bark)
    }
    if (bark > 20.1) {
      bark += 0.22 * (bark - 20.1)
    }
    return bark
  }

  barkToHz(bark) {
    if (bark < 2) {
      bark = (bark - 0.3) / 0.85
    }
    if (bark > 20.1) {
      bark = (bark + 4.422) / 1.22
    }
    return 1960 * ((bark + 0.53) / (26.28 - bark))
  }

  createBarkFilterBank(numBarkFilters, sampleRate) {
    return this.createFilterBank(numBarkFilters, sampleRate, this.hzToBark, this.barkToHz)
  }

  hzToErb(hz) {
    return ERB_A * Math.log10(1 + hz * 0.00437)
  }

  erbToHz(erb) {
    return (Math.pow(10, erb / ERB_A) - 1) / 0.00437
  }

  createErbFilterBank(numErbFilters, sampleRate) {
    return this.createFilterBank(numErbFilters, sampleRate, this.hzToErb, this.erbToHz)
  }

  hzToScale(hz) {
    switch (this.scale) {
      case 'mel':
        return this.hzToMel(hz)
      case 'logarithmic':
        return this.hzToLog(hz)
      case 'bark':
        return this.hzToBark(hz)
      case 'erb':
        return this.hzToErb(hz)
    }
    return hz
  }

  scaleToHz(scale) {
    switch (this.scale) {
      case 'mel':
        return this.melToHz(scale)
      case 'logarithmic':
        return this.logToHz(scale)
      case 'bark':
        return this.barkToHz(scale)
      case 'erb':
        return this.erbToHz(scale)
    }
    return scale
  }

  applyFilterBank(fftPoints, filterBank) {
    const numFilters = filterBank.length
    const logSpectrum = Float32Array.from({ length: numFilters }, () => 0)
    for (let i = 0; i < numFilters; i++) {
      for (let j = 0; j < fftPoints.length; j++) {
        logSpectrum[i] += fftPoints[j] * filterBank[i][j]
      }
    }
    return logSpectrum
  }

  getWidth() {
    return this.wavesurfer.getWrapper().offsetWidth
  }

  getFrequencies(buffer) {
    const fftSamples = this.fftSamples
    const channels = (this.options.splitChannels ?? this.wavesurfer?.options.splitChannels) ? buffer.numberOfChannels : 1

    this.frequencyMax = this.frequencyMax || buffer.sampleRate / 2

    if (!buffer) return

    this.buffer = buffer

    const sampleRate = buffer.sampleRate
    const frequencies = []

    let noverlap = this.noverlap
    if (!noverlap) {
      const uniqueSamplesPerPx = buffer.length / this.canvas.width
      noverlap = Math.max(0, Math.round(fftSamples - uniqueSamplesPerPx))
    }

    const fft = new FFT(fftSamples, sampleRate, this.windowFunc, this.alpha)

    let filterBank
    switch (this.scale) {
      case 'mel':
        filterBank = this.createFilterBank(this.numMelFilters, sampleRate, this.hzToMel, this.melToHz)
        break
      case 'logarithmic':
        filterBank = this.createFilterBank(this.numLogFilters, sampleRate, this.hzToLog, this.logToHz)
        break
      case 'bark':
        filterBank = this.createFilterBank(this.numBarkFilters, sampleRate, this.hzToBark, this.barkToHz)
        break
      case 'erb':
        filterBank = this.createFilterBank(this.numErbFilters, sampleRate, this.hzToErb, this.erbToHz)
        break
    }

    for (let c = 0; c < channels; c++) {
      const channelData = buffer.getChannelData(c)
      const channelFreq = []
      let currentOffset = 0

      while (currentOffset + fftSamples < channelData.length) {
        const segment = channelData.slice(currentOffset, currentOffset + fftSamples)
        const array = new Uint8Array(fftSamples / 2)
        let spectrum = fft.calculateSpectrum(segment)
        if (filterBank) {
          spectrum = this.applyFilterBank(spectrum, filterBank)
        }
        for (let j = 0; j < fftSamples / 2; j++) {
          const magnitude = spectrum[j] > 1e-12 ? spectrum[j] : 1e-12
          const valueDB = 20 * Math.log10(magnitude)
          if (valueDB < -this.gainDB - this.rangeDB) {
            array[j] = 0
          } else if (valueDB > -this.gainDB) {
            array[j] = 255
          } else {
            array[j] = ((valueDB + this.gainDB) / this.rangeDB) * 255 + 256
          }
        }
        channelFreq.push(array)

        currentOffset += fftSamples - noverlap
      }
      frequencies.push(channelFreq)
    }

    this.frequencies = frequencies
    return frequencies
  }

  freqType(freq) {
    return freq >= 1000 ? (freq / 1000).toFixed(1) : Math.round(freq)
  }

  unitType(freq) {
    return freq >= 1000 ? 'kHz' : 'Hz'
  }

  getLabelFrequency(index, labelIndex) {
    const scaleMin = this.hzToScale(this.frequencyMin)
    const scaleMax = this.hzToScale(this.frequencyMax)
    return this.scaleToHz(scaleMin + (index / labelIndex) * (scaleMax - scaleMin))
  }

  loadLabels(bgFill, fontSizeFreq, fontSizeUnit, fontType, textColorFreq, textColorUnit, textAlign, container, channels) {
    const frequenciesHeight = this.height
    bgFill = bgFill || 'rgba(68,68,68,0)'
    fontSizeFreq = fontSizeFreq || '12px'
    fontSizeUnit = fontSizeUnit || '12px'
    fontType = fontType || 'Helvetica'
    textColorFreq = textColorFreq || '#fff'
    textColorUnit = textColorUnit || '#fff'
    textAlign = textAlign || 'center'
    container = container || '#specLabels'
    const bgWidth = 55
    const getMaxY = frequenciesHeight || 512
    const labelIndex = 5 * (getMaxY / 256)
    const freqStart = this.frequencyMin
    const step = (this.frequencyMax - freqStart) / labelIndex

    const ctx = this.labelsEl.getContext('2d')
    const dispScale = window.devicePixelRatio
    this.labelsEl.height = this.height * channels * dispScale
    this.labelsEl.width = bgWidth * dispScale
    ctx.scale(dispScale, dispScale)

    if (!ctx) {
      return
    }

    for (let c = 0; c < channels; c++) {
      ctx.fillStyle = bgFill
      ctx.fillRect(0, c * getMaxY, bgWidth, (1 + c) * getMaxY)
      ctx.fill()

      for (let i = 0; i <= labelIndex; i++) {
        ctx.textAlign = textAlign
        ctx.textBaseline = 'middle'

        const freq = this.getLabelFrequency(i, labelIndex)
        const label = this.freqType(freq)
        const units = this.unitType(freq)
        const x = 16
        let y = (1 + c) * getMaxY - (i / labelIndex) * getMaxY

        y = Math.min(Math.max(y, c * getMaxY + 10), (1 + c) * getMaxY - 10)

        ctx.fillStyle = textColorUnit
        ctx.font = fontSizeUnit + ' ' + fontType
        ctx.fillText(units, x + 24, y)
        ctx.fillStyle = textColorFreq
        ctx.font = fontSizeFreq + ' ' + fontType
        ctx.fillText(label, x, y)
      }
    }
  }

  resample(oldMatrix) {
    const columnsNumber = this.getWidth()
    const newMatrix = []

    const oldPiece = 1 / oldMatrix.length
    const newPiece = 1 / columnsNumber

    for (let i = 0; i < columnsNumber; i++) {
      const column = new Array(oldMatrix[0].length)

      for (let j = 0; j < oldMatrix.length; j++) {
        const oldStart = j * oldPiece
        const oldEnd = oldStart + oldPiece
        const newStart = i * newPiece
        const newEnd = newStart + newPiece
        const overlap = Math.max(0, Math.min(oldEnd, newEnd) - Math.max(oldStart, newStart))

        if (overlap > 0) {
          for (let k = 0; k < oldMatrix[0].length; k++) {
            if (column[k] == null) {
              column[k] = 0
            }
            column[k] += (overlap / newPiece) * oldMatrix[j][k]
          }
        }
      }

      const intColumn = new Uint8Array(oldMatrix[0].length)
      for (let m = 0; m < oldMatrix[0].length; m++) {
        intColumn[m] = column[m]
      }

      newMatrix.push(intColumn)
    }

    return newMatrix
  }
}

export default SpectrogramPlugin
function t(t,e,s,r){return new(s||(s=Promise))((function(i,a){function n(t){try{o(r.next(t))}catch(t){a(t)}}function h(t){try{o(r.throw(t))}catch(t){a(t)}}function o(t){var e;t.done?i(t.value):(e=t.value,e instanceof s?e:new s((function(t){t(e)}))).then(n,h)}o((r=r.apply(t,e||[])).next())}))}"function"==typeof SuppressedError&&SuppressedError;class e{constructor(){this.listeners={}}on(t,e,s){if(this.listeners[t]||(this.listeners[t]=new Set),this.listeners[t].add(e),null==s?void 0:s.once){const s=()=>{this.un(t,s),this.un(t,e)};return this.on(t,s),s}return()=>this.un(t,e)}un(t,e){var s;null===(s=this.listeners[t])||void 0===s||s.delete(e)}once(t,e){return this.on(t,e,{once:!0})}unAll(){this.listeners={}}emit(t,...e){this.listeners[t]&&this.listeners[t].forEach((t=>t(...e)))}}class s extends e{constructor(t){super(),this.subscriptions=[],this.options=t}onInit(){}_init(t){this.wavesurfer=t,this.onInit()}destroy(){this.emit("destroy"),this.subscriptions.forEach((t=>t()))}}function r(t,e){const s=e.xmlns?document.createElementNS(e.xmlns,t):document.createElement(t);for(const[t,i]of Object.entries(e))if("children"===t)for(const[t,i]of Object.entries(e))"string"==typeof i?s.appendChild(document.createTextNode(i)):s.appendChild(r(t,i));else"style"===t?Object.assign(s.style,i):"textContent"===t?s.textContent=i:s.setAttribute(t,i.toString());return s}function i(t,e,s){const i=r(t,e||{});return null==s||s.appendChild(i),i}function a(t,e,s,r){switch(this.bufferSize=t,this.sampleRate=e,this.bandwidth=2/t*(e/2),this.sinTable=new Float32Array(t),this.cosTable=new Float32Array(t),this.windowValues=new Float32Array(t),this.reverseTable=new Uint32Array(t),this.peakBand=0,this.peak=0,s){case"bartlett":for(i=0;i<t;i++)this.windowValues[i]=2/(t-1)*((t-1)/2-Math.abs(i-(t-1)/2));break;case"bartlettHann":for(i=0;i<t;i++)this.windowValues[i]=.62-.48*Math.abs(i/(t-1)-.5)-.38*Math.cos(2*Math.PI*i/(t-1));break;case"blackman":for(r=r||.16,i=0;i<t;i++)this.windowValues[i]=(1-r)/2-.5*Math.cos(2*Math.PI*i/(t-1))+r/2*Math.cos(4*Math.PI*i/(t-1));break;case"cosine":for(i=0;i<t;i++)this.windowValues[i]=Math.cos(Math.PI*i/(t-1)-Math.PI/2);break;case"gauss":for(r=r||.25,i=0;i<t;i++)this.windowValues[i]=Math.pow(Math.E,-.5*Math.pow((i-(t-1)/2)/(r*(t-1)/2),2));break;case"hamming":for(i=0;i<t;i++)this.windowValues[i]=.54-.46*Math.cos(2*Math.PI*i/(t-1));break;case"hann":case void 0:for(i=0;i<t;i++)this.windowValues[i]=.5*(1-Math.cos(2*Math.PI*i/(t-1)));break;case"lanczoz":for(i=0;i<t;i++)this.windowValues[i]=Math.sin(Math.PI*(2*i/(t-1)-1))/(Math.PI*(2*i/(t-1)-1));break;case"rectangular":for(i=0;i<t;i++)this.windowValues[i]=1;break;case"triangular":for(i=0;i<t;i++)this.windowValues[i]=2/t*(t/2-Math.abs(i-(t-1)/2));break;default:throw Error("No such window function '"+s+"'")}for(var i,a=1,n=t>>1;a<t;){for(i=0;i<a;i++)this.reverseTable[i+a]=this.reverseTable[i]+n;a<<=1,n>>=1}for(i=0;i<t;i++)this.sinTable[i]=Math.sin(-Math.PI/i),this.cosTable[i]=Math.cos(-Math.PI/i);this.calculateSpectrum=function(t){var e,s,r,i=this.bufferSize,a=this.cosTable,n=this.sinTable,h=this.reverseTable,o=new Float32Array(i),l=new Float32Array(i),c=2/this.bufferSize,u=Math.sqrt,f=new Float32Array(i/2),p=Math.floor(Math.log(i)/Math.LN2);if(Math.pow(2,p)!==i)throw"Invalid buffer size, must be a power of 2.";if(i!==t.length)throw"Supplied buffer is not the same size as defined FFT. FFT Size: "+i+" Buffer Size: "+t.length;for(var d,w,g,b,M,m,y,v,T=1,k=0;k<i;k++)o[k]=t[h[k]]*this.windowValues[h[k]],l[k]=0;for(;T<i;){d=a[T],w=n[T],g=1,b=0;for(var z=0;z<T;z++){for(k=z;k<i;)m=g*o[M=k+T]-b*l[M],y=g*l[M]+b*o[M],o[M]=o[k]-m,l[M]=l[k]-y,o[k]+=m,l[k]+=y,k+=T<<1;g=(v=g)*d-b*w,b=v*w+b*d}T<<=1}k=0;for(var F=i/2;k<F;k++)(r=c*u((e=o[k])*e+(s=l[k])*s))>this.peak&&(this.peakBand=k,this.peak=r),f[k]=r;return f}}const n=1e3*Math.log(10)/107.939;class h extends s{static create(t){return new h(t||{})}constructor(t){var e,s;if(super(t),this.frequenciesDataUrl=t.frequenciesDataUrl,this.container="string"==typeof t.container?document.querySelector(t.container):t.container,t.colorMap&&"string"!=typeof t.colorMap){if(t.colorMap.length<256)throw new Error("Colormap must contain 256 elements");for(let e=0;e<t.colorMap.length;e++){if(4!==t.colorMap[e].length)throw new Error("ColorMap entries must contain 4 values")}this.colorMap=t.colorMap}else switch(this.colorMap=t.colorMap||"roseus",this.colorMap){case"gray":this.colorMap=[];for(let t=0;t<256;t++){const e=(255-t)/256;this.colorMap.push([e,e,e,1])}break;case"igray":this.colorMap=[];for(let t=0;t<256;t++){const e=t/256;this.colorMap.push([e,e,e,1])}break;case"roseus":this.colorMap=[[.004528,.004341,.004307,1],[.005625,.006156,.00601,1],[.006628,.008293,.008161,1],[.007551,.010738,.01079,1],[.008382,.013482,.013941,1],[.009111,.01652,.017662,1],[.009727,.019846,.022009,1],[.010223,.023452,.027035,1],[.010593,.027331,.032799,1],[.010833,.031475,.039361,1],[.010941,.035875,.046415,1],[.010918,.04052,.053597,1],[.010768,.045158,.060914,1],[.010492,.049708,.068367,1],[.010098,.054171,.075954,1],[.009594,.058549,.083672,1],[.008989,.06284,.091521,1],[.008297,.067046,.099499,1],[.00753,.071165,.107603,1],[.006704,.075196,.11583,1],[.005838,.07914,.124178,1],[.004949,.082994,.132643,1],[.004062,.086758,.141223,1],[.003198,.09043,.149913,1],[.002382,.09401,.158711,1],[.001643,.097494,.167612,1],[.001009,.100883,.176612,1],[514e-6,.104174,.185704,1],[187e-6,.107366,.194886,1],[66e-6,.110457,.204151,1],[186e-6,.113445,.213496,1],[587e-6,.116329,.222914,1],[.001309,.119106,.232397,1],[.002394,.121776,.241942,1],[.003886,.124336,.251542,1],[.005831,.126784,.261189,1],[.008276,.12912,.270876,1],[.011268,.131342,.280598,1],[.014859,.133447,.290345,1],[.0191,.135435,.300111,1],[.024043,.137305,.309888,1],[.029742,.139054,.319669,1],[.036252,.140683,.329441,1],[.043507,.142189,.339203,1],[.050922,.143571,.348942,1],[.058432,.144831,.358649,1],[.066041,.145965,.368319,1],[.073744,.146974,.377938,1],[.081541,.147858,.387501,1],[.089431,.148616,.396998,1],[.097411,.149248,.406419,1],[.105479,.149754,.415755,1],[.113634,.150134,.424998,1],[.121873,.150389,.434139,1],[.130192,.150521,.443167,1],[.138591,.150528,.452075,1],[.147065,.150413,.460852,1],[.155614,.150175,.469493,1],[.164232,.149818,.477985,1],[.172917,.149343,.486322,1],[.181666,.148751,.494494,1],[.190476,.148046,.502493,1],[.199344,.147229,.510313,1],[.208267,.146302,.517944,1],[.217242,.145267,.52538,1],[.226264,.144131,.532613,1],[.235331,.142894,.539635,1],[.24444,.141559,.546442,1],[.253587,.140131,.553026,1],[.262769,.138615,.559381,1],[.271981,.137016,.5655,1],[.281222,.135335,.571381,1],[.290487,.133581,.577017,1],[.299774,.131757,.582404,1],[.30908,.129867,.587538,1],[.318399,.12792,.592415,1],[.32773,.125921,.597032,1],[.337069,.123877,.601385,1],[.346413,.121793,.605474,1],[.355758,.119678,.609295,1],[.365102,.11754,.612846,1],[.374443,.115386,.616127,1],[.383774,.113226,.619138,1],[.393096,.111066,.621876,1],[.402404,.108918,.624343,1],[.411694,.106794,.62654,1],[.420967,.104698,.628466,1],[.430217,.102645,.630123,1],[.439442,.100647,.631513,1],[.448637,.098717,.632638,1],[.457805,.096861,.633499,1],[.46694,.095095,.6341,1],[.47604,.093433,.634443,1],[.485102,.091885,.634532,1],[.494125,.090466,.63437,1],[.503104,.08919,.633962,1],[.512041,.088067,.633311,1],[.520931,.087108,.63242,1],[.529773,.086329,.631297,1],[.538564,.085738,.629944,1],[.547302,.085346,.628367,1],[.555986,.085162,.626572,1],[.564615,.08519,.624563,1],[.573187,.085439,.622345,1],[.581698,.085913,.619926,1],[.590149,.086615,.617311,1],[.598538,.087543,.614503,1],[.606862,.0887,.611511,1],[.61512,.090084,.608343,1],[.623312,.09169,.605001,1],[.631438,.093511,.601489,1],[.639492,.095546,.597821,1],[.647476,.097787,.593999,1],[.655389,.100226,.590028,1],[.66323,.102856,.585914,1],[.670995,.105669,.581667,1],[.678686,.108658,.577291,1],[.686302,.111813,.57279,1],[.69384,.115129,.568175,1],[.7013,.118597,.563449,1],[.708682,.122209,.558616,1],[.715984,.125959,.553687,1],[.723206,.12984,.548666,1],[.730346,.133846,.543558,1],[.737406,.13797,.538366,1],[.744382,.142209,.533101,1],[.751274,.146556,.527767,1],[.758082,.151008,.522369,1],[.764805,.155559,.516912,1],[.771443,.160206,.511402,1],[.777995,.164946,.505845,1],[.784459,.169774,.500246,1],[.790836,.174689,.494607,1],[.797125,.179688,.488935,1],[.803325,.184767,.483238,1],[.809435,.189925,.477518,1],[.815455,.19516,.471781,1],[.821384,.200471,.466028,1],[.827222,.205854,.460267,1],[.832968,.211308,.454505,1],[.838621,.216834,.448738,1],[.844181,.222428,.442979,1],[.849647,.22809,.43723,1],[.855019,.233819,.431491,1],[.860295,.239613,.425771,1],[.865475,.245471,.420074,1],[.870558,.251393,.414403,1],[.875545,.25738,.408759,1],[.880433,.263427,.403152,1],[.885223,.269535,.397585,1],[.889913,.275705,.392058,1],[.894503,.281934,.386578,1],[.898993,.288222,.381152,1],[.903381,.294569,.375781,1],[.907667,.300974,.370469,1],[.911849,.307435,.365223,1],[.915928,.313953,.360048,1],[.919902,.320527,.354948,1],[.923771,.327155,.349928,1],[.927533,.333838,.344994,1],[.931188,.340576,.340149,1],[.934736,.347366,.335403,1],[.938175,.354207,.330762,1],[.941504,.361101,.326229,1],[.944723,.368045,.321814,1],[.947831,.375039,.317523,1],[.950826,.382083,.313364,1],[.953709,.389175,.309345,1],[.956478,.396314,.305477,1],[.959133,.403499,.301766,1],[.961671,.410731,.298221,1],[.964093,.418008,.294853,1],[.966399,.425327,.291676,1],[.968586,.43269,.288696,1],[.970654,.440095,.285926,1],[.972603,.44754,.28338,1],[.974431,.455025,.281067,1],[.976139,.462547,.279003,1],[.977725,.470107,.277198,1],[.979188,.477703,.275666,1],[.980529,.485332,.274422,1],[.981747,.492995,.273476,1],[.98284,.50069,.272842,1],[.983808,.508415,.272532,1],[.984653,.516168,.27256,1],[.985373,.523948,.272937,1],[.985966,.531754,.273673,1],[.986436,.539582,.274779,1],[.98678,.547434,.276264,1],[.986998,.555305,.278135,1],[.987091,.563195,.280401,1],[.987061,.5711,.283066,1],[.986907,.579019,.286137,1],[.986629,.58695,.289615,1],[.986229,.594891,.293503,1],[.985709,.602839,.297802,1],[.985069,.610792,.302512,1],[.98431,.618748,.307632,1],[.983435,.626704,.313159,1],[.982445,.634657,.319089,1],[.981341,.642606,.32542,1],[.98013,.650546,.332144,1],[.978812,.658475,.339257,1],[.977392,.666391,.346753,1],[.97587,.67429,.354625,1],[.974252,.68217,.362865,1],[.972545,.690026,.371466,1],[.97075,.697856,.380419,1],[.968873,.705658,.389718,1],[.966921,.713426,.399353,1],[.964901,.721157,.409313,1],[.962815,.728851,.419594,1],[.960677,.7365,.430181,1],[.95849,.744103,.44107,1],[.956263,.751656,.452248,1],[.954009,.759153,.463702,1],[.951732,.766595,.475429,1],[.949445,.773974,.487414,1],[.947158,.781289,.499647,1],[.944885,.788535,.512116,1],[.942634,.795709,.524811,1],[.940423,.802807,.537717,1],[.938261,.809825,.550825,1],[.936163,.81676,.564121,1],[.934146,.823608,.577591,1],[.932224,.830366,.59122,1],[.930412,.837031,.604997,1],[.928727,.843599,.618904,1],[.927187,.850066,.632926,1],[.925809,.856432,.647047,1],[.92461,.862691,.661249,1],[.923607,.868843,.675517,1],[.92282,.874884,.689832,1],[.922265,.880812,.704174,1],[.921962,.886626,.718523,1],[.92193,.892323,.732859,1],[.922183,.897903,.747163,1],[.922741,.903364,.76141,1],[.92362,.908706,.77558,1],[.924837,.913928,.789648,1],[.926405,.919031,.80359,1],[.92834,.924015,.817381,1],[.930655,.928881,.830995,1],[.93336,.933631,.844405,1],[.936466,.938267,.857583,1],[.939982,.942791,.870499,1],[.943914,.947207,.883122,1],[.948267,.951519,.895421,1],[.953044,.955732,.907359,1],[.958246,.959852,.918901,1],[.963869,.963887,.930004,1],[.969909,.967845,.940623,1],[.976355,.971737,.950704,1],[.983195,.97558,.960181,1],[.990402,.979395,.968966,1],[.99793,.983217,.97692,1]];break;default:throw Error("No such colormap '"+this.colorMap+"'")}this.fftSamples=t.fftSamples||512,this.height=t.height||200,this.noverlap=t.noverlap||null,this.windowFunc=t.windowFunc||"hann",this.alpha=t.alpha,this.frequencyMin=t.frequencyMin||0,this.frequencyMax=t.frequencyMax||0,this.gainDB=null!==(e=t.gainDB)&&void 0!==e?e:20,this.rangeDB=null!==(s=t.rangeDB)&&void 0!==s?s:80,this.scale=t.scale||"mel",this.numMelFilters=this.fftSamples/2,this.numLogFilters=this.fftSamples/2,this.numBarkFilters=this.fftSamples/2,this.numErbFilters=this.fftSamples/2,this.createWrapper(),this.createCanvas()}onInit(){this.container=this.container||this.wavesurfer.getWrapper(),this.container.appendChild(this.wrapper),this.wavesurfer.options.fillParent&&Object.assign(this.wrapper.style,{width:"100%",overflowX:"hidden",overflowY:"hidden"}),this.subscriptions.push(this.wavesurfer.on("redraw",(()=>this.render())))}destroy(){this.unAll(),this.wavesurfer.un("ready",this._onReady),this.wavesurfer.un("redraw",this._onRender),this.wavesurfer=null,this.util=null,this.options=null,this.wrapper&&(this.wrapper.remove(),this.wrapper=null),super.destroy()}loadFrequenciesData(e){return t(this,void 0,void 0,(function*(){const t=yield fetch(e);if(!t.ok)throw new Error("Unable to fetch frequencies data");const s=yield t.json();this.drawSpectrogram(s)}))}createWrapper(){this.wrapper=i("div",{style:{display:"block",position:"relative",userSelect:"none"}}),this.options.labels&&(this.labelsEl=i("canvas",{part:"spec-labels",style:{position:"absolute",zIndex:9,width:"55px",height:"100%"}},this.wrapper)),this.wrapper.addEventListener("click",this._onWrapperClick)}createCanvas(){this.canvas=i("canvas",{style:{position:"absolute",left:0,top:0,width:"100%",height:"100%",zIndex:4}},this.wrapper),this.spectrCc=this.canvas.getContext("2d")}render(){var t;if(this.frequenciesDataUrl)this.loadFrequenciesData(this.frequenciesDataUrl);else{const e=null===(t=this.wavesurfer)||void 0===t?void 0:t.getDecodedData();e&&this.drawSpectrogram(this.getFrequencies(e))}}drawSpectrogram(t){isNaN(t[0][0])||(t=[t]),this.wrapper.style.height=this.height*t.length+"px",this.canvas.width=this.getWidth(),this.canvas.height=this.height*t.length;const e=this.spectrCc,s=this.height,r=this.getWidth(),i=this.buffer.sampleRate/2,a=this.frequencyMin,n=this.frequencyMax;if(e){if(n>i){const i=this.colorMap[this.colorMap.length-1];e.fillStyle=`rgba(${i[0]}, ${i[1]}, ${i[2]}, ${i[3]})`,e.fillRect(0,0,r,s*t.length)}for(let h=0;h<t.length;h++){const o=this.resample(t[h]),l=o[0].length,c=new ImageData(r,l);for(let t=0;t<o.length;t++)for(let e=0;e<o[t].length;e++){const s=this.colorMap[o[t][e]],i=4*((l-e-1)*r+t);c.data[i]=255*s[0],c.data[i+1]=255*s[1],c.data[i+2]=255*s[2],c.data[i+3]=255*s[3]}const u=this.hzToScale(a)/this.hzToScale(i),f=this.hzToScale(n)/this.hzToScale(i),p=Math.min(1,f);createImageBitmap(c,0,Math.round(l*(1-p)),r,Math.round(l*(p-u))).then((t=>{e.drawImage(t,0,s*(h+1-p/f),r,s*p/f)}))}this.options.labels&&this.loadLabels(this.options.labelsBackground,"12px","12px","",this.options.labelsColor,this.options.labelsHzColor||this.options.labelsColor,"center","#specLabels",t.length),this.emit("ready")}}createFilterBank(t,e,s,r){const i=s(0),a=s(e/2),n=Array.from({length:t},(()=>Array(this.fftSamples/2+1).fill(0))),h=e/this.fftSamples;for(let e=0;e<t;e++){let s=r(i+e/t*(a-i)),o=Math.floor(s/h),l=o*h,c=(s-l)/((o+1)*h-l);n[e][o]=1-c,n[e][o+1]=c}return n}hzToMel(t){return 2595*Math.log10(1+t/700)}melToHz(t){return 700*(Math.pow(10,t/2595)-1)}createMelFilterBank(t,e){return this.createFilterBank(t,e,this.hzToMel,this.melToHz)}hzToLog(t){return Math.log10(Math.max(1,t))}logToHz(t){return Math.pow(10,t)}createLogFilterBank(t,e){return this.createFilterBank(t,e,this.hzToLog,this.logToHz)}hzToBark(t){let e=26.81*t/(1960+t)-.53;return e<2&&(e+=.15*(2-e)),e>20.1&&(e+=.22*(e-20.1)),e}barkToHz(t){return t<2&&(t=(t-.3)/.85),t>20.1&&(t=(t+4.422)/1.22),(t+.53)/(26.28-t)*1960}createBarkFilterBank(t,e){return this.createFilterBank(t,e,this.hzToBark,this.barkToHz)}hzToErb(t){return n*Math.log10(1+.00437*t)}erbToHz(t){return(Math.pow(10,t/n)-1)/.00437}createErbFilterBank(t,e){return this.createFilterBank(t,e,this.hzToErb,this.erbToHz)}hzToScale(t){switch(this.scale){case"mel":return this.hzToMel(t);case"logarithmic":return this.hzToLog(t);case"bark":return this.hzToBark(t);case"erb":return this.hzToErb(t)}return t}scaleToHz(t){switch(this.scale){case"mel":return this.melToHz(t);case"logarithmic":return this.logToHz(t);case"bark":return this.barkToHz(t);case"erb":return this.erbToHz(t)}return t}applyFilterBank(t,e){const s=e.length,r=Float32Array.from({length:s},(()=>0));for(let i=0;i<s;i++)for(let s=0;s<t.length;s++)r[i]+=t[s]*e[i][s];return r}getWidth(){return this.wavesurfer.getWrapper().offsetWidth}getFrequencies(t){var e,s;const r=this.fftSamples,i=(null!==(e=this.options.splitChannels)&&void 0!==e?e:null===(s=this.wavesurfer)||void 0===s?void 0:s.options.splitChannels)?t.numberOfChannels:1;if(this.frequencyMax=this.frequencyMax||t.sampleRate/2,!t)return;this.buffer=t;const n=t.sampleRate,h=[];let o=this.noverlap;if(!o){const e=t.length/this.canvas.width;o=Math.max(0,Math.round(r-e))}const l=new a(r,n,this.windowFunc,this.alpha);let c;switch(this.scale){case"mel":c=this.createFilterBank(this.numMelFilters,n,this.hzToMel,this.melToHz);break;case"logarithmic":c=this.createFilterBank(this.numLogFilters,n,this.hzToLog,this.logToHz);break;case"bark":c=this.createFilterBank(this.numBarkFilters,n,this.hzToBark,this.barkToHz);break;case"erb":c=this.createFilterBank(this.numErbFilters,n,this.hzToErb,this.erbToHz)}for(let e=0;e<i;e++){const s=t.getChannelData(e),i=[];let a=0;for(;a+r<s.length;){const t=s.slice(a,a+r),e=new Uint8Array(r/2);let n=l.calculateSpectrum(t);c&&(n=this.applyFilterBank(n,c));for(let t=0;t<r/2;t++){const s=n[t]>1e-12?n[t]:1e-12,r=20*Math.log10(s);r<-this.gainDB-this.rangeDB?e[t]=0:r>-this.gainDB?e[t]=255:e[t]=(r+this.gainDB)/this.rangeDB*255+256}i.push(e),a+=r-o}h.push(i)}return h}freqType(t){return t>=1e3?(t/1e3).toFixed(1):Math.round(t)}unitType(t){return t>=1e3?"kHz":"Hz"}getLabelFrequency(t,e){const s=this.hzToScale(this.frequencyMin),r=this.hzToScale(this.frequencyMax);return this.scaleToHz(s+t/e*(r-s))}loadLabels(t,e,s,r,i,a,n,h,o){t=t||"rgba(68,68,68,0)",e=e||"12px",s=s||"12px",r=r||"Helvetica",i=i||"#fff",a=a||"#fff",n=n||"center";const l=this.height||512,c=l/256*5;this.frequencyMin;this.frequencyMax;const u=this.labelsEl.getContext("2d"),f=window.devicePixelRatio;if(this.labelsEl.height=this.height*o*f,this.labelsEl.width=55*f,u.scale(f,f),u)for(let h=0;h<o;h++){let o;for(u.fillStyle=t,u.fillRect(0,h*l,55,(1+h)*l),u.fill(),o=0;o<=c;o++){u.textAlign=n,u.textBaseline="middle";const t=this.getLabelFrequency(o,c),f=this.freqType(t),p=this.unitType(t),d=16;let w=(1+h)*l-o/c*l;w=Math.min(Math.max(w,h*l+10),(1+h)*l-10),u.fillStyle=a,u.font=s+" "+r,u.fillText(p,d+24,w),u.fillStyle=i,u.font=e+" "+r,u.fillText(f,d,w)}}}resample(t){const e=this.getWidth(),s=[],r=1/t.length,i=1/e;let a;for(a=0;a<e;a++){const e=new Array(t[0].length);let n;for(n=0;n<t.length;n++){const s=n*r,h=s+r,o=a*i,l=o+i,c=Math.max(0,Math.min(h,l)-Math.max(s,o));let u;if(c>0)for(u=0;u<t[0].length;u++)null==e[u]&&(e[u]=0),e[u]+=c/i*t[n][u]}const h=new Uint8Array(t[0].length);let o;for(o=0;o<t[0].length;o++)h[o]=e[o];s.push(h)}return s}}export{h as default};
