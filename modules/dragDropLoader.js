// modules/dragDropLoader.js

import { extractGuanoMetadata, parseGuanoMetadata } from './guanoReader.js';
import { getWavSampleRate, getWavDuration } from './fileLoader.js';
import { addFilesToList, removeFilesByName, setFileMetadata, getCurrentIndex, getFileList, getTimeExpansionMode } from './fileState.js';
import { showMessageBox } from './messageBox.js';
import { importKmlFile } from './mapPopup.js';

export function initDragDropLoader({
  targetElementId,
  wavesurfer,
  spectrogramHeight,
  colorMap,
  onPluginReplaced,
  onFileLoaded,
  onBeforeLoad,
  onAfterLoad,
  onSampleRateDetected
}) {
  const dropArea = document.getElementById(targetElementId);
  const overlay = document.getElementById('drop-overlay');
  const uploadOverlay = document.getElementById('upload-overlay');
  const uploadProgressBar = document.getElementById('upload-progress-bar');
  const uploadProgressText = document.getElementById('upload-progress-text');
  const fileNameElem = document.getElementById('fileNameText');
  const guanoOutput = document.getElementById('guano-output');
  const spectrogramSettingsText = document.getElementById('spectrogram-settings-text');
  let lastObjectUrl = null;

  function showOverlay() {
    overlay.style.display = 'flex';
    document.dispatchEvent(new Event('drop-overlay-show'));
  }

  function hideOverlay() {
    overlay.style.display = 'none';
    document.dispatchEvent(new Event('drop-overlay-hide'));
  }

  function showUploadOverlay(total) {
    if (!uploadOverlay) return;
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

    const fileUrl = URL.createObjectURL(file);
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = fileUrl;

    await wavesurfer.load(fileUrl);

    if (typeof onPluginReplaced === 'function') {
      onPluginReplaced();
    }

      const sampleRate = detectedSampleRate || wavesurfer?.options?.sampleRate || 256000;

    if (typeof onSampleRateDetected === 'function') {
      await onSampleRateDetected(sampleRate);
    }



    if (typeof onAfterLoad === 'function') {
      onAfterLoad();
    }
    document.dispatchEvent(new Event('file-loaded'));
  }

  let pendingKmlFile = null;

  async function handleFiles(files) {
    const kmlFile = Array.from(files).find(f => f.name.toLowerCase().endsWith('.kml'));
    if (kmlFile) {
      pendingKmlFile = kmlFile;
    }

    const validFiles = Array.from(files).filter(file => file.type === 'audio/wav' || file.name.endsWith('.wav'));
    if (validFiles.length === 0) {
      showMessageBox({
        title: 'Reminder',
        message: 'Only .wav files are supported.'
      });
      showOverlay();
      return;
    }

    showUploadOverlay(validFiles.length);

    if (typeof onBeforeLoad === 'function') {
      onBeforeLoad();
    }

    let skippedLong = 0;
    let skippedSmall = 0;
    const sortedList = validFiles.sort((a, b) => a.name.localeCompare(b.name));
    const filteredList = [];
    const metaList = [];
    for (let i = 0; i < sortedList.length; i++) {
      const fileItem = sortedList[i];
      const dur = await getWavDuration(fileItem);
      if (fileItem.size < 200 * 1024) {
        skippedSmall++;
      } else if (dur > 20 && !getTimeExpansionMode()) {
        // normally skip files longer than 20s, but allow when Time Expansion
        // mode is active (user requested 10x time expansion)
        skippedLong++;
      } else {
        filteredList.push(fileItem);
        try {
          const txt = await extractGuanoMetadata(fileItem);
          metaList.push(parseGuanoMetadata(txt));
        } catch (err) {
          metaList.push({ date: '', time: '', latitude: '', longitude: '' });
        }
      }
      updateUploadOverlay(i + 1, sortedList.length);
    }

    removeFilesByName('demo_recording.wav');
    const startIdx = getFileList().length;
    if (filteredList.length > 0) {
      addFilesToList(filteredList, 0);
      for (let i = 0; i < filteredList.length; i++) {
        setFileMetadata(startIdx + i, metaList[i]);
      }
    }
    hideUploadOverlay();
    if (filteredList.length > 0) {
      await loadFile(filteredList[0]);
      if (pendingKmlFile) {
        await importKmlFile(pendingKmlFile);
        pendingKmlFile = null;
      }
    }
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
  }

  let dragCounter = 0;

  function isFileDrag(e) {
    return Array.from(e.dataTransfer?.types || []).includes('Files');
  }

  dropArea.addEventListener('dragenter', e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounter++;
    showOverlay();
  });

  dropArea.addEventListener('dragleave', e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      hideOverlay();
    }
  });

  dropArea.addEventListener('dragover', e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  async function getFilesFromDataTransfer(dt) {
    if (!dt.items) return Array.from(dt.files);

    const traverse = async (entry) => {
      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file(f => resolve([f]), () => resolve([]));
        });
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        const entries = [];
        const readEntries = () => new Promise((resolve) => {
          reader.readEntries(async (results) => {
            if (!results.length) {
              const children = await Promise.all(entries.map(traverse));
              resolve(children.flat());
            } else {
              entries.push(...results);
              resolve(await readEntries());
            }
          }, () => resolve([]));
        });
        return readEntries();
      }
      return [];
    };

    const entries = Array.from(dt.items)
      .map(item => item.webkitGetAsEntry && item.webkitGetAsEntry())
      .filter(Boolean);

    if (!entries.length) return Array.from(dt.files);

    const fileArrays = await Promise.all(entries.map(traverse));
    return fileArrays.flat();
  }

  dropArea.addEventListener('drop', async e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounter = 0;
    hideOverlay();
    const files = await getFilesFromDataTransfer(e.dataTransfer);
    handleFiles(files);
  });
}
