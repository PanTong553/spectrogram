export async function cropWavBlob(file, startTime, endTime) {
  if (!file) return null;
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);

  let fmtOffset = -1;
  let fmtSize = 0;
  let dataOffset = -1;
  let dataSize = 0;

  // Walk through chunks to find "fmt " and "data" chunks
  let pos = 12; // skip RIFF header
  while (pos < view.byteLength - 8) {
    const id = String.fromCharCode(
      view.getUint8(pos),
      view.getUint8(pos + 1),
      view.getUint8(pos + 2),
      view.getUint8(pos + 3)
    );
    const size = view.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      fmtOffset = pos + 8;
      fmtSize = size;
    } else if (id === 'data') {
      dataOffset = pos + 8;
      dataSize = size;
      break;
    }
    pos += 8 + size + (size % 2);
  }

  if (fmtOffset < 0 || dataOffset < 0) return null;

  const numChannels = view.getUint16(fmtOffset + 2, true);
  const sampleRate = view.getUint32(fmtOffset + 4, true);
  const bitsPerSample = view.getUint16(fmtOffset + 14, true);
  const blockAlign = numChannels * bitsPerSample / 8;

  const startSample = Math.floor(startTime * sampleRate);
  const endSample = Math.floor(endTime * sampleRate);
  const startByte = dataOffset + startSample * blockAlign;
  const endByte = Math.min(dataOffset + dataSize, dataOffset + endSample * blockAlign);

  if (endByte <= startByte) return null;

  const newDataLength = endByte - startByte;
  const header = new Uint8Array(buf.slice(0, dataOffset));
  const data = new Uint8Array(buf.slice(startByte, endByte));

  const output = new Uint8Array(header.length + newDataLength);
  output.set(header, 0);
  output.set(data, header.length);

  const outView = new DataView(output.buffer);
  outView.setUint32(4, output.length - 8, true); // update RIFF chunk size
  outView.setUint32(dataOffset - 4, newDataLength, true); // update data chunk size

  return new Blob([output.buffer], { type: file.type || 'audio/wav' });
}
