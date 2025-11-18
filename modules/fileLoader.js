// modules/fileLoader.js

import { extractGuanoMetadata, parseGuanoMetadata } from './guanoReader.js';
import { addFilesToList, getFileList, getCurrentIndex, setCurrentIndex, removeFilesByName, setFileMetadata, getTimeExpansionMode, setPreloadedDecoded, getPreloadedDecoded, clearPreloadedDecoded } from './fileState.js';
import { showMessageBox } from './messageBox.js';

export async function getWavSampleRate(file) {
  if (!file) return 256000;
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  let pos = 12;
  while (pos < view.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(pos),
      view.getUint8(pos + 1),
      view.getUint8(pos + 2),
      view.getUint8(pos + 3)
    );
    const chunkSize = view.getUint32(pos + 4, true);
    if (chunkId === 'fmt ') {
      return view.getUint32(pos + 12, true);
    }
    pos += 8 + chunkSize;
    if (chunkSize % 2 === 1) pos += 1; // word alignment
  }
  return 256000;
}

export async function getWavDuration(file) {
  if (!file) return 0;
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  let pos = 12;
  let sampleRate = 0;
  let numChannels = 1;
  let bitsPerSample = 16;
  let dataSize = 0;
  while (pos < view.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(pos),
      view.getUint8(pos + 1),
      view.getUint8(pos + 2),
      view.getUint8(pos + 3)
    );
    const chunkSize = view.getUint32(pos + 4, true);
    if (chunkId === 'fmt ') {
      numChannels = view.getUint16(pos + 10, true);
      sampleRate = view.getUint32(pos + 12, true);
      bitsPerSample = view.getUint16(pos + 22, true);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }
    pos += 8 + chunkSize;
    if (chunkSize % 2 === 1) pos += 1;
  }
  if (sampleRate > 0 && dataSize > 0) {
    const bytesPerSample = (bitsPerSample / 8) * numChannels;
    const numSamples = dataSize / bytesPerSample;
    return numSamples / sampleRate;
  }
  return 0;
}

let lastObjectUrl = null;

export function initFileLoader({
  fileInputId,
  wavesurfer,
  spectrogramHeight,
  colorMap,
  onPluginReplaced,
  onFileLoaded,
  onBeforeLoad,
  onAfterLoad,
  onSampleRateDetected
}) {
  const fileInput = document.getElementById(fileInputId);
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const fileNameElem = document.getElementById('fileNameText');
  const guanoOutput = document.getElementById('guano-output');
  const spectrogramSettingsText = document.getElementById('spectrogram-settings-text');
  const uploadOverlay = document.getElementById('upload-overlay');
  const uploadProgressBar = document.getElementById('upload-progress-bar');
  const uploadProgressText = document.getElementById('upload-progress-text');

  function showUploadOverlay(total) {
    if (!uploadOverlay) return;
    document.dispatchEvent(new Event('drop-overlay-hide'));
    if (uploadProgressBar) uploadProgressBar.style.width = '0%';
    if (uploadProgressText) uploadProgressText.textContent = `0/${total}`;
    uploadOverlay.style.display = 'flex';
  }

  function updateUploadOverlay(count, total) {
    if (uploadProgressBar) {
      const pct = total > 0 ? (count / total) * 100 : 0;
      uploadProgressBar.style.width = `${pct}%`;
    }
    if (uploadProgressText) {
      uploadProgressText.textContent = `${count}/${total}`;
    }
  }

  function hideUploadOverlay() {
    if (uploadOverlay) uploadOverlay.style.display = 'none';
  }

  async function loadFile(file) {
    if (!file) return;
    const detectedSampleRate = await getWavSampleRate(file);

    if (typeof onBeforeLoad === 'function') {
      onBeforeLoad();
    }

    if (typeof onFileLoaded === 'function') {
      onFileLoaded(file);
    }

    if (typeof onSampleRateDetected === 'function') {
      await onSampleRateDetected(detectedSampleRate, true);
    }
    
    if (fileNameElem) {
      fileNameElem.textContent = file.name;
    }

    try {
      const result = await extractGuanoMetadata(file);
      guanoOutput.textContent = result || '(No GUANO metadata found)';
      const meta = parseGuanoMetadata(result);
      const idx = getCurrentIndex();
      setFileMetadata(idx, meta);
    } catch (err) {
      guanoOutput.textContent = '(Error reading GUANO metadata)';
    }

    // try to use a pre-decoded buffer for faster initial spectrogram rendering
    const files = getFileList();
    const fileIndex = files.findIndex(f => f === file);
    const predecoded = fileIndex >= 0 ? getPreloadedDecoded(fileIndex) : null;

    if (predecoded && wavesurfer && wavesurfer.renderer && typeof wavesurfer.renderer.render === 'function') {
      try {
        // set decodedData and render immediately (fast UI) while we still load audio for playback
        wavesurfer.decodedData = predecoded;
        try { wavesurfer.emit && wavesurfer.emit('decode', wavesurfer.getDuration && wavesurfer.getDuration()); } catch (e) {}
        wavesurfer.renderer.render(predecoded);
      } catch (err) {
        // ignore render errors and continue with normal load
        console.warn('Pre-render using predecoded buffer failed', err);
      }
    }

    const fileUrl = URL.createObjectURL(file);
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = fileUrl;

    // still load into wavesurfer for playback & official decode; keep awaiting so rest of flow is preserved
    await wavesurfer.load(fileUrl);

    if (typeof onPluginReplaced === 'function') {
      onPluginReplaced();
    }

    const sampleRate = detectedSampleRate || wavesurfer?.options?.sampleRate || 256000;

    if (typeof onAfterLoad === 'function') {
      onAfterLoad();
    }
    document.dispatchEvent(new Event('file-loaded'));
    // kick off background preload for the next file (do not await)
    (async () => {
      try {
        if (fileIndex >= 0) await preloadNext(fileIndex);
      } catch (err) {
        // preload failures are non-fatal
        console.warn('Preload next failed', err);
      }
    })();
    
  }

  // background preload: decode next file's ArrayBuffer to AudioBuffer and cache it
  async function preloadNext(currentIndex) {
    const files = getFileList();
    const nextIndex = currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= files.length) return;
    // skip if already cached
    if (getPreloadedDecoded(nextIndex)) return;
    const file = files[nextIndex];
    if (!file) return;
    try {
      const ab = await file.arrayBuffer();
      // create temporary AudioContext to decode, then close it when done
      const AudioCtx = window.OfflineAudioContext || window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx(1, 1, 44100);
      let decoded = null;
      try {
        // modern decodeAudioData returns a Promise
        decoded = await audioCtx.decodeAudioData(ab);
      } catch (err) {
        // some older browsers use callback style
        decoded = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej));
      }
      try { audioCtx.close && audioCtx.close(); } catch (e) {}
      if (decoded) {
        setPreloadedDecoded(nextIndex, decoded);
      }
    } catch (err) {
      // ignore preload errors
      console.warn('Error preloading next file', err);
    }
  }

  fileInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files);
    const selectedFile = files[0];
    if (!selectedFile) return;

    const sameDirFiles = files.filter(f => f.name.endsWith('.wav'));
    showUploadOverlay(sameDirFiles.length);

    if (typeof onBeforeLoad === 'function') {
      onBeforeLoad();
    }

    let skippedLong = 0;
    let skippedSmall = 0;
    const sortedList = sameDirFiles.sort((a, b) => a.name.localeCompare(b.name));
    const filteredList = [];
    const metaList = [];
    for (let i = 0; i < sortedList.length; i++) {
      const fileItem = sortedList[i];
      const dur = await getWavDuration(fileItem);
      if (fileItem.size < 200 * 1024) {
        skippedSmall++;
      } else if (dur > 20 && !getTimeExpansionMode()) {
        // normally skip files longer than 20s, but allow when Time Expansion mode
        // is active (user requested 10x time expansion)
        skippedLong++;
      } else {
        filteredList.push(fileItem);
        try {
          const txt = await extractGuanoMetadata(sortedList[i]);
          metaList.push(parseGuanoMetadata(txt));
        } catch (err) {
          metaList.push({ date: '', time: '', latitude: '', longitude: '' });
        }
      }
      updateUploadOverlay(i + 1, sortedList.length);
    }

    const index = filteredList.findIndex(f => f.name === selectedFile.name);

    removeFilesByName('demo_recording.wav');
    const startIdx = getFileList().length;
    if (filteredList.length > 0) {
      addFilesToList(filteredList, index >= 0 ? index : 0);
      for (let i = 0; i < filteredList.length; i++) {
        setFileMetadata(startIdx + i, metaList[i]);
      }
    }
    hideUploadOverlay();
    if (filteredList.length > 0) {
      await loadFile(filteredList[index >= 0 ? index : 0]);
    }
    // reset value so that selecting the same file again triggers change
    fileInput.value = '';
    if (skippedLong > 0) {
      showMessageBox({
        title: 'Warning',
        message: `.wav files longer than 20 seconds are not supported and a total of (${skippedLong}) such files were skipped during the loading process. Please trim or preprocess these files to meet the duration requirement before loading.`
      });
    }
    if (skippedSmall > 0) {
      showMessageBox({
        title: 'Warning',
        message: `${skippedSmall} wav files were skipped due to small file size (<200kb).`
      });
    }
  });

  prevBtn.addEventListener('click', () => {
    const index = getCurrentIndex();
    if (index > 0) {
      setCurrentIndex(index - 1);
      const file = getFileList()[index - 1];
      loadFile(file);
    }
  });

  nextBtn.addEventListener('click', () => {
    const index = getCurrentIndex();
    const files = getFileList();
    if (index < files.length - 1) {
      setCurrentIndex(index + 1);
      const file = files[index + 1];
      loadFile(file);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey) return; // avoid conflict with zoom shortcuts
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      prevBtn.click();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      nextBtn.click();
    }
  });

  return {
    loadFileAtIndex: async (index) => {
      const files = getFileList();
      if (index >= 0 && index < files.length) {
        setCurrentIndex(index);
        await loadFile(files[index]);
      }
    }
  };  
}
