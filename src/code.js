// Delningskod: inställningarna packas in i själva koden, eftersom sidan är statisk
// och inte har någon server som kan lagra dem. Bara värden som skiljer sig från
// referensen nedan skrivs med, vilket håller koden kort.

export const CODE_VERSION = 2;

// Fält som betydde något annat i en äldre kodversion. Nyckeln är versionen,
// värdet är fältets dåvarande beskrivning.
const LEGACY = {
  1: { wave: ['wave', 'f1', 0, 1, 0.01] },
};

// Referensvärden som koden räknar skillnad mot. De är FRYSTA: ändras appens
// standardvärden får de inte ändras här, annars skulle gamla koder tolkas fel.
const BASE = {
  frames: 144, size: 320, content: 1, motionGain: 8, blend: 1, density: 2.6,
  lumWeight: 0.4, wave: 0.7, waveWidth: 0.3, shellFront: 0.75, shellBack: 0.6, brightness: 1.1, saturation: 0.9,
  glass: 1, edgeGlow: 0.6, lines: 0.3, steps: 200, depth: 1.3, flipTime: false,
  timeOn: true, timeCount: 1, timeFollow: true, timePos: 0, timeOpacity: 0.92, timeFade: 0.4,
  xCount: 0, xPos: 0.5, xSweep: false, xOpacity: 0.3,
  yCount: 0, yPos: 0.5, ySweep: false, yOpacity: 0.3, axisOpacity: 0.3,
  motion: 'free', motionSpeed: 0.5, fov: 32, background: '#000000',
  format: '1080x1080', fps: 30, bitrate: 16, audio: true, loops: 1,
};

// Ordningen bestämmer varje fälts nummer i koden. Lägg bara till nya fält sist.
// i1/i2 = heltal i en eller två byte, f1/f2 = tal mellan min och max i en eller
// två byte, b = ja/nej (kostar ingen värdebyte alls), e = val ur lista, c = färg.
const FIELDS = [
  ['frames', 'i2'],
  ['size', 'i2'],
  ['content', 'i1'],
  ['motionGain', 'f1', 1, 40, 0.5],
  ['blend', 'i1'],
  ['density', 'f1', 0, 10, 0.05],
  ['lumWeight', 'f1', 0, 1, 0.01],
  ['shellFront', 'f1', 0, 1, 0.01],
  ['shellBack', 'f1', 0, 1, 0.01],
  ['brightness', 'f2', 0.2, 3, 0.01],
  ['saturation', 'f1', 0, 2, 0.01],
  ['glass', 'f1', 0, 2, 0.01],
  ['edgeGlow', 'f1', 0, 2, 0.01],
  ['lines', 'f1', 0, 1, 0.01],
  ['steps', 'i2'],
  ['depth', 'f1', 0.2, 4, 0.05],
  ['flipTime', 'b'],
  ['timeOn', 'b'],
  ['timeCount', 'i1'],
  ['timeFollow', 'b'],
  ['timePos', 'f2', 0, 1, 0.001],
  ['timeOpacity', 'f1', 0, 1, 0.01],
  ['xCount', 'i1'],
  ['xPos', 'f2', 0, 1, 0.001],
  ['xSweep', 'b'],
  ['yCount', 'i1'],
  ['yPos', 'f2', 0, 1, 0.001],
  // Utgått: låg förr på både X och Y. Platsen behålls så gamla koder går att läsa.
  ['axisOpacity', 'f1', 0, 1, 0.01],
  ['motion', 'e', ['free', 'pendulum', 'rotate']],
  ['motionSpeed', 'f1', 0.05, 2, 0.01],
  ['fov', 'i1'],
  ['background', 'c'],
  ['format', 'e', ['1080x1080', '1080x1350', '1080x1920', '1920x1080']],
  ['fps', 'i1'],
  ['bitrate', 'i1'],
  ['audio', 'b'],
  ['loops', 'i1'],
  ['wave', 'f1', 0, 4, 0.01],
  ['waveWidth', 'f1', 0.02, 1, 0.01],
  ['xOpacity', 'f1', 0, 1, 0.01],
  ['ySweep', 'b'],
  ['yOpacity', 'f1', 0, 1, 0.01],
  ['timeFade', 'f1', 0, 1, 0.01],
];

// Crockford base32: inga tecken som går att blanda ihop (I, L, O, U saknas),
// och koden är okänslig för stora och små bokstäver när man skriver in den.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function toBase32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text) {
  const clean = String(text)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (!clean) return null;
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  // Ett tecken för mycket eller för lite ger samma byte-följd men fel längd;
  // det ska avvisas i stället för att tyst tolkas som en giltig kod.
  if (clean.length !== Math.ceil((bytes.length * 8) / 5)) return null;
  return Uint8Array.from(bytes);
}

function checksum(bytes) {
  let hash = 0x1f;
  for (const byte of bytes) hash = (hash * 31 + byte) & 255;
  return hash;
}

function snap(value, min, max, step) {
  const snapped = Math.round(value / step) * step;
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(4));
}

function writeField(out, field, value) {
  const [, type, a, b, c] = field;
  if (type === 'i1') out.push(Math.max(0, Math.min(255, Math.round(value))));
  else if (type === 'i2') {
    const n = Math.max(0, Math.min(65535, Math.round(value)));
    out.push(n >> 8, n & 255);
  } else if (type === 'f1') {
    out.push(Math.max(0, Math.min(255, Math.round(((value - a) / (b - a)) * 255))));
  } else if (type === 'f2') {
    const n = Math.max(0, Math.min(65535, Math.round(((value - a) / (b - a)) * 65535)));
    out.push(n >> 8, n & 255);
  } else if (type === 'e') {
    const index = a.indexOf(value);
    if (index < 0) return false;
    out.push(index);
  } else if (type === 'c') {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(value));
    if (!m) return false;
    const n = parseInt(m[1], 16);
    out.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  return true;
}

function readField(field, bytes, at) {
  const [, type, a, b, c] = field;
  if (type === 'i1') return [bytes[at], at + 1];
  if (type === 'i2') return [(bytes[at] << 8) | bytes[at + 1], at + 2];
  if (type === 'f1') return [snap(a + (bytes[at] / 255) * (b - a), a, b, c), at + 1];
  if (type === 'f2') {
    const n = (bytes[at] << 8) | bytes[at + 1];
    return [snap(a + (n / 65535) * (b - a), a, b, c), at + 2];
  }
  if (type === 'e') {
    const value = a[bytes[at]];
    return value === undefined ? null : [value, at + 1];
  }
  if (type === 'c') {
    const hex = [bytes[at], bytes[at + 1], bytes[at + 2]]
      .map((n) => n.toString(16).padStart(2, '0')).join('');
    return [`#${hex}`, at + 3];
  }
  return null;
}

function sizeOf(type) {
  return { i1: 1, i2: 2, f1: 1, f2: 2, e: 1, c: 3, b: 0 }[type];
}

/** Packar inställningarna till en kort kod. Lika värden som referensen utelämnas. */
export function encodeSettings(params) {
  const body = [CODE_VERSION];
  FIELDS.forEach((field, index) => {
    const [key, type] = field;
    const value = params[key];
    if (value === undefined || value === BASE[key]) return;
    if (type === 'b') {
      // Ett ja/nej som skiljer sig från referensen kan bara vara det omvända,
      // så fältnumret ensamt räcker som värde.
      body.push(index | 128);
      return;
    }
    const bytes = [];
    if (!writeField(bytes, field, value)) return;
    body.push(index, ...bytes);
  });
  return toBase32([...body, checksum(body)]);
}

/** Läser en kod. Returnerar inställningarna, eller null om koden inte går ihop. */
export function decodeSettings(code) {
  const bytes = fromBase32(code);
  if (!bytes || bytes.length < 2) return null;
  const body = bytes.subarray(0, bytes.length - 1);
  if (checksum(body) !== bytes[bytes.length - 1]) return null;
  const version = body[0];
  if (version !== CODE_VERSION && !LEGACY[version]) return null;

  const values = {};
  let at = 1;
  while (at < body.length) {
    const marker = body[at++];
    const index = marker & 127;
    const field = FIELDS[index];
    if (!field) return null;
    const [key, type] = field;
    if (type === 'b') {
      if (!(marker & 128)) return null;
      values[key] = !BASE[key];
      continue;
    }
    if (marker & 128) return null;
    if (at + sizeOf(type) > body.length) return null;
    const read = readField(LEGACY[version]?.[key] ?? field, body, at);
    if (!read) return null;
    values[key] = read[0];
    at = read[1];
  }

  // Koder från när X och Y delade opacitet: låt värdet gälla båda.
  if (values.axisOpacity !== undefined) {
    if (values.xOpacity === undefined) values.xOpacity = values.axisOpacity;
    if (values.yOpacity === undefined) values.yOpacity = values.axisOpacity;
    delete values.axisOpacity;
  }
  return values;
}
