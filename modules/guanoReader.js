// modules/guanoReader.js

export async function extractGuanoMetadata(file) {
  if (!file) return '(no file selected)';
  
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const textDecoder = new TextDecoder("utf-8");
  let pos = 12;
  let foundGuano = null;

  while (pos < view.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(pos),
      view.getUint8(pos + 1),
      view.getUint8(pos + 2),
      view.getUint8(pos + 3)
    );

    const chunkSize = view.getUint32(pos + 4, true);
    const chunkData = new Uint8Array(buffer, pos + 8, chunkSize);
    const chunkText = textDecoder.decode(chunkData);

    if (chunkText.includes("GUANO|Version:")) {
      foundGuano = chunkText;
      break;
    }

    pos += 8 + chunkSize;
    if (chunkSize % 2 === 1) pos += 1; // word alignment
  }

  return foundGuano || '(No GUANO metadata found in file)';
}

export function parseGuanoMetadata(text) {
  if (!text || text.startsWith('(No GUANO')) return {};
  const lines = text.split(/\r?\n/);
  const meta = {};
  lines.forEach(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    meta[key] = value;
  });

  const ts = meta['Timestamp'];
  if (ts) {
    const [datePart, timePartWithZone] = ts.split(' ');
    const timePart = (timePartWithZone || '').split('+')[0];
    meta._Date = datePart ? datePart.replace(/-/g, '/') : '';
    meta._Time = timePart ? timePart.slice(0,5).replace(':','') : '';
  }

  if (meta['Loc Position']) {
    const [lat, lon] = meta['Loc Position'].split(/\s+/);
    meta._Latitude = lat || '';
    if (lon) {
      let lonNum = parseFloat(lon);
      if (!Number.isNaN(lonNum)) {
        if (lonNum < 0 && Math.abs(lonNum) >= 113 && Math.abs(lonNum) <= 115) {
          lonNum = Math.abs(lonNum);
        }
        meta._Longitude = lonNum.toString();
      } else {
        meta._Longitude = lon;
      }
    } else {
      meta._Longitude = '';
    }
  }

  return {
    date: meta._Date || '',
    time: meta._Time || '',
    latitude: meta._Latitude || '',
    longitude: meta._Longitude || ''
  };
}
