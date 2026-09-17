import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VolumeBox } from './volume.js';
import { CancelledError, extractFrames, makeDemoVolume } from './frames.js';
import { buildPanel } from './ui.js';
import { CanvasRecorder, downloadBlob, pickMimeType } from './recorder.js';

const DEFAULTS = {
  frames: 144,
  size: 320,

  content: 1,
  motionGain: 8,
  blend: 1,
  density: 2.6,
  lumWeight: 0.4,
  shellFront: 0.75,
  shellBack: 0.6,
  brightness: 1.1,
  saturation: 0.9,
  glass: 1,
  edgeGlow: 0.6,
  lines: 0.3,
  depth: 1.3,
  flipTime: false,
  steps: 200,

  timeOn: true,
  timeCount: 1,
  timeFollow: true,
  timePos: 0,
  timeOpacity: 0.92,
  xCount: 0,
  xPos: 0.5,
  xSweep: false,
  yCount: 0,
  yPos: 0.5,
  axisOpacity: 0.3,

  motion: 'free',
  motionSpeed: 0.5,
  fov: 32,
  background: '#000000',

  format: '1080x1080',
  fps: 30,
  bitrate: 16,
  audio: true,
  loops: 1,
};

// Versionen bumpas när standardvärdena ändras, annars vinner gamla sparade inställningar.
const STORAGE_KEY = 'n4tn.params.v3';
const PRESET_KEY = 'n4tn.presets.v1';
const DEMO_DURATION = 6;

function loadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const merged = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof saved[key] === typeof DEFAULTS[key]) merged[key] = saved[key];
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

let saveTimer = 0;
function saveParams() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch {
      // Inställningarna sparas bara om webbläsaren tillåter det.
    }
  }, 300);
}

const params = loadParams();

function loadPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function storePresets(presets) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

// Bara kända nycklar med rätt typ tas in, så en gammal eller handredigerad fil
// inte kan sätta appen i ett trasigt läge.
function sanitize(values) {
  const clean = {};
  if (!values || typeof values !== 'object') return clean;
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof values[key] === typeof DEFAULTS[key]) clean[key] = values[key];
  }
  return clean;
}

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const stage = $('stage');
const frame = $('frame');

const state = {
  sourceUrl: null,
  sourceName: '',
  hasVideo: false,
  building: false,
  exporting: false,
  loadToken: 0,
  buildId: 0,
  muted: false,
  demoTime: 0,
  sweepTime: 0,
  builtWith: null,
};

// --- Rendering -----------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(params.fov, 1, 0.01, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 0.8;
controls.maxDistance = 20;

const volume = new VolumeBox();
scene.add(volume.group);

const demo = makeDemoVolume();
volume.setVolume(demo.texture);
volume.setAspect(demo.width / demo.height);

// Uppspelningsvideon. Den ligger i DOM:en (osynlig) så att bildrutorna uppdateras pålitligt.
const video = document.createElement('video');
video.className = 'hidden-video';
video.crossOrigin = 'anonymous';
video.playsInline = true;
video.loop = true;
video.preload = 'auto';
document.body.append(video);

const videoTexture = new THREE.VideoTexture(video);
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;
videoTexture.generateMipmaps = false;

function exportSize() {
  const [w, h] = params.format.split('x').map(Number);
  return { width: w, height: h };
}

function layout() {
  if (state.exporting) return;
  const { width: fw, height: fh } = exportSize();
  const rect = stage.getBoundingClientRect();
  const scale = Math.min(rect.width / fw, rect.height / fh);
  const w = Math.max(1, Math.floor(fw * scale));
  const h = Math.max(1, Math.floor(fh * scale));
  frame.style.width = `${w}px`;
  frame.style.height = `${h}px`;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

new ResizeObserver(layout).observe(stage);

const VIEW_AZIMUTH = THREE.MathUtils.degToRad(32);
const VIEW_ELEVATION = THREE.MathUtils.degToRad(17);
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _corner = new THREE.Vector3();

// Placerar kameran så att hela lådan precis får plats i bilden, oavsett bildformat.
function fitCamera() {
  const size = volume.size;
  _dir.set(
    Math.sin(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
    Math.sin(VIEW_ELEVATION),
    Math.cos(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
  ).normalize();
  _right.set(0, 1, 0).cross(_dir).normalize();
  _up.crossVectors(_dir, _right).normalize();

  let maxRight = 0;
  let maxUp = 0;
  let maxDepth = 0;
  for (let i = 0; i < 8; i++) {
    _corner.set(
      (i & 1 ? 0.5 : -0.5) * size.x,
      (i & 2 ? 0.5 : -0.5) * size.y,
      (i & 4 ? 0.5 : -0.5) * size.z,
    );
    maxRight = Math.max(maxRight, Math.abs(_corner.dot(_right)));
    maxUp = Math.max(maxUp, Math.abs(_corner.dot(_up)));
    maxDepth = Math.max(maxDepth, _corner.dot(_dir));
  }

  const tanV = Math.tan(THREE.MathUtils.degToRad(params.fov) / 2);
  const tanH = tanV * camera.aspect;
  const distance = Math.max(maxRight / tanH, maxUp / tanV) * 1.1 + maxDepth;

  controls.target.set(0, 0, 0);
  camera.position.copy(_dir).multiplyScalar(distance);
  controls.update();
  anchorMotion();
}

// --- Kamerarörelse -------------------------------------------------------

const motion = { t: 0, theta: 0, phi: 0, interacting: false };
const PENDULUM_THETA = 0.55;
const PENDULUM_PHI = 0.12;
const _offset = new THREE.Vector3();
const _spherical = new THREE.Spherical();

function anchorMotion() {
  _offset.copy(camera.position).sub(controls.target);
  _spherical.setFromVector3(_offset);
  motion.theta = _spherical.theta - PENDULUM_THETA * Math.sin(motion.t);
  motion.phi = _spherical.phi - PENDULUM_PHI * Math.sin(motion.t * 0.7);
}

controls.addEventListener('start', () => {
  motion.interacting = true;
});
controls.addEventListener('end', () => {
  motion.interacting = false;
  anchorMotion();
});

function updateCamera(dt) {
  controls.autoRotate = params.motion === 'rotate' && !motion.interacting;
  controls.autoRotateSpeed = params.motionSpeed * 6;

  if (params.motion === 'pendulum' && !motion.interacting) {
    motion.t += dt * params.motionSpeed * 1.6;
    _offset.copy(camera.position).sub(controls.target);
    _spherical.setFromVector3(_offset);
    _spherical.theta = motion.theta + PENDULUM_THETA * Math.sin(motion.t);
    _spherical.phi = THREE.MathUtils.clamp(
      motion.phi + PENDULUM_PHI * Math.sin(motion.t * 0.7),
      0.05,
      Math.PI - 0.05,
    );
    camera.position.setFromSpherical(_spherical).add(controls.target);
  }

  if (camera.fov !== params.fov) {
    camera.fov = params.fov;
    camera.updateProjectionMatrix();
  }
  controls.update(dt);
}

// --- Renderloop ----------------------------------------------------------

const timer = new THREE.Timer();
timer.connect(document);
const frameParams = { ...params };

function currentTimeFraction() {
  if (state.hasVideo) {
    return video.duration ? THREE.MathUtils.clamp(video.currentTime / video.duration, 0, 1) : 0;
  }
  return (state.demoTime % DEMO_DURATION) / DEMO_DURATION;
}

function tick(timestamp) {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  if (!state.hasVideo) state.demoTime += dt;
  if (params.xSweep) state.sweepTime += dt * 0.5;

  updateCamera(dt);

  Object.assign(frameParams, params);
  frameParams.timePosEffective = params.timeFollow ? currentTimeFraction() : params.timePos;
  frameParams.xPosEffective = params.xSweep
    ? 0.5 + 0.45 * Math.sin(state.sweepTime)
    : params.xPos;
  volume.update(camera, frameParams);

  renderer.setClearColor(params.background);
  renderer.render(scene, camera);
  updateTransport();
}

layout();
fitCamera();
renderer.setAnimationLoop(tick);

// --- Ljud ----------------------------------------------------------------

let audio = null;

function ensureAudio() {
  if (!audio) {
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(video);
    const speaker = ctx.createGain();
    const recording = ctx.createMediaStreamDestination();
    source.connect(speaker).connect(ctx.destination);
    source.connect(recording);
    audio = { ctx, speaker, recording };
    video.muted = false;
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  applyMute();
  return audio;
}

function applyMute() {
  if (audio) audio.speaker.gain.value = state.muted ? 0 : 1;
  else video.muted = state.muted;
  $('icon-sound').hidden = state.muted;
  $('icon-muted').hidden = !state.muted;
}

// --- Laddning ------------------------------------------------------------

const busy = $('busy');
const busyLabel = $('busy-label');
const busyBar = $('busy-bar');
const busyCancel = $('busy-cancel');
let busyCancelAction = null;

function showBusy(label, fraction, cancel = null, cancelLabel = 'Avbryt') {
  busy.hidden = false;
  busyLabel.textContent = label;
  busyBar.style.width = `${Math.round(fraction * 100)}%`;
  busyCancelAction = cancel;
  busyCancel.hidden = !cancel;
  busyCancel.textContent = cancelLabel;
}

function hideBusy() {
  busy.hidden = true;
  busyCancelAction = null;
}

busyCancel.addEventListener('click', () => busyCancelAction?.());

function setStatus(text) {
  const note = $('export-status');
  if (note) note.textContent = text;
}

function waitFor(target, event) {
  return new Promise((resolve, reject) => {
    const ok = () => {
      target.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      target.removeEventListener(event, ok);
      reject(new Error('Videon kunde inte spelas upp i webbläsaren.'));
    };
    target.addEventListener(event, ok, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

async function openSource(url, name) {
  if (state.exporting) return;
  const token = ++state.loadToken;
  const previousUrl = state.sourceUrl;
  state.sourceUrl = url;
  state.sourceName = name;
  $('file-name').textContent = name;
  $('empty-hint').hidden = true;

  try {
    video.src = url;
    await waitFor(video, 'loadedmetadata');
    if (token !== state.loadToken) return;
    if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl);

    state.hasVideo = true;
    volume.setVideo(videoTexture);
    volume.setAspect(video.videoWidth / video.videoHeight);
    fitCamera();
    video.playbackRate = Number(speedSelect.value);
    play();
  } catch (err) {
    if (token !== state.loadToken) return;
    state.hasVideo = false;
    state.sourceUrl = null;
    volume.setVideo(null);
    showError(err);
    return;
  }

  await buildVolume();
}

async function buildVolume() {
  if (!state.sourceUrl) return;
  const token = state.loadToken;
  const buildId = ++state.buildId;
  const settings = { frames: params.frames, size: params.size };
  state.building = true;
  state.builtWith = null;
  busyIsError = false;
  panel.refresh();
  const cancel = () => {
    state.loadToken++;
  };
  showBusy('Läser in video…', 0, cancel);

  // Varje uppdatering laddar upp hela 3D-texturen, så förhandsvisningen strypes i tid.
  let nextUpload = 0;

  try {
    const built = await extractFrames(state.sourceUrl, {
      ...settings,
      isCancelled: () => token !== state.loadToken,
      onStart: (texture, info) => {
        volume.setVolume(texture);
        volume.setFilled(0);
        volume.setAspect(info.width / info.height);
        volume.setFrameCount(info.frames);
      },
      onProgress: (done, total, texture, filled) => {
        const now = performance.now();
        if (now >= nextUpload || done === total) {
          nextUpload = now + 300;
          texture.needsUpdate = true;
          volume.setFilled(filled);
        }
        showBusy(`Bygger volym… ${done}/${total} bildrutor`, done / total, cancel);
      },
    });
    state.builtWith = settings;
    volume.setExposure(built.meanLuma);
    updateVolumeInfo();
  } catch (err) {
    if (!(err instanceof CancelledError)) showError(err);
  } finally {
    if (buildId === state.buildId) {
      state.building = false;
      if (!busyIsError) hideBusy();
      panel.refresh();
    }
  }
}

let busyIsError = false;

function showError(err) {
  console.error(err);
  busyIsError = true;
  showBusy(err?.message || 'Något gick fel.', 0, () => {
    busyIsError = false;
    hideBusy();
  }, 'Stäng');
}

function openFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv|ogv)$/i.test(file.name)) {
    showError(new Error(`"${file.name}" verkar inte vara en videofil.`));
    return;
  }
  ensureAudio();
  openSource(URL.createObjectURL(file), file.name);
}

$('open-btn').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (e) => {
  openFile(e.target.files[0]);
  e.target.value = '';
});

// Dra och släpp
const dropOverlay = $('drop-overlay');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files') || state.exporting) return;
  dragDepth++;
  dropOverlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropOverlay.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  if (!state.exporting) openFile(e.dataTransfer?.files?.[0]);
});

// --- Uppspelning ---------------------------------------------------------

const playBtn = $('play-btn');
const scrub = $('scrub');
const timeLabel = $('time-label');
const speedSelect = $('speed');
const iconPlay = $('icon-play');
const iconPause = $('icon-pause');
let scrubbing = false;

function play() {
  if (!state.hasVideo) return;
  video.play().catch(() => {
    // Autouppspelning kan blockeras tills användaren klickar.
  });
}

function togglePlay() {
  if (!state.hasVideo || state.exporting) return;
  ensureAudio();
  if (video.paused) play();
  else video.pause();
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00.0';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function updateTransport() {
  const enabled = state.hasVideo && !state.exporting;
  playBtn.disabled = !enabled;
  scrub.disabled = !enabled;
  speedSelect.disabled = !enabled;
  iconPlay.hidden = !video.paused;
  iconPause.hidden = video.paused;
  if (!state.hasVideo) return;
  const duration = video.duration || 0;
  timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
  if (!scrubbing && duration) scrub.value = String(Math.round((video.currentTime / duration) * 1000));
}

playBtn.addEventListener('click', togglePlay);
scrub.addEventListener('input', () => {
  scrubbing = true;
  if (video.duration) video.currentTime = (Number(scrub.value) / 1000) * video.duration;
});
scrub.addEventListener('change', () => {
  scrubbing = false;
});
speedSelect.addEventListener('change', (e) => {
  video.playbackRate = Number(e.target.value);
});
$('mute-btn').addEventListener('click', () => {
  state.muted = !state.muted;
  applyMute();
});

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
  e.preventDefault();
  togglePlay();
});

// --- Export --------------------------------------------------------------

function baseName() {
  return (state.sourceName || 'tidskub').replace(/\.[^.]+$/, '') || 'tidskub';
}

function withExportSize(fn) {
  const { width, height } = exportSize();
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  return fn();
}

function saveSnapshot() {
  withExportSize(() => {
    tick();
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${baseName()}-tidskub.png`);
    }, 'image/png');
  });
  layout();
}

let exportAbort = null;

async function exportVideo() {
  if (!state.hasVideo || state.exporting || state.building) return;
  const withAudio = params.audio;
  const format = pickMimeType(withAudio) ?? (withAudio ? pickMimeType(false) : null);
  if (!format) {
    setStatus('Webbläsaren kan inte spela in video. Prova Chrome eller Safari.');
    return;
  }

  state.exporting = true;
  panel.setLocked(true);
  const wasLooping = video.loop;
  const wasRate = video.playbackRate;
  let aborted = false;
  let recorder = null;
  exportAbort = () => {
    aborted = true;
    video.pause();
    video.dispatchEvent(new Event('ended'));
  };

  try {
    const { ctx, recording } = ensureAudio();
    await ctx.resume();
    video.pause();
    video.loop = false;
    video.playbackRate = 1;
    video.currentTime = 0;
    await waitFor(video, 'seeked');

    withExportSize(() => {});
    const audioTracks = withAudio ? recording.stream.getAudioTracks() : [];
    recorder = new CanvasRecorder(canvas, {
      fps: params.fps,
      videoBitsPerSecond: params.bitrate * 1_000_000,
      audioTracks,
      mimeType: format.mimeType,
    });

    const loops = params.loops;
    const total = video.duration * loops;
    let loopIndex = 0;
    const progress = () => {
      const done = (loopIndex * video.duration + video.currentTime) / total;
      showBusy(`Exporterar… ${Math.round(done * 100)} %`, done, exportAbort);
    };
    video.addEventListener('timeupdate', progress);
    progress();

    const finished = new Promise((resolve) => {
      const onEnded = async () => {
        loopIndex++;
        if (aborted || loopIndex >= loops) {
          video.removeEventListener('ended', onEnded);
          resolve();
          return;
        }
        video.currentTime = 0;
        await waitFor(video, 'seeked');
        video.play();
      };
      video.addEventListener('ended', onEnded);
    });

    recorder.start();
    await video.play();
    await finished;
    video.removeEventListener('timeupdate', progress);
    const blob = await recorder.stop();
    recorder = null;

    if (aborted) {
      setStatus('Exporten avbröts.');
    } else {
      downloadBlob(blob, `${baseName()}-tidskub.${format.ext}`);
      const mb = (blob.size / 1e6).toFixed(1);
      setStatus(`Klar: ${baseName()}-tidskub.${format.ext} (${mb} MB) har laddats ned.`);
    }
  } catch (err) {
    console.error(err);
    setStatus(`Exporten misslyckades: ${err.message}`);
    if (recorder) await recorder.stop();
  } finally {
    exportAbort = null;
    video.loop = wasLooping;
    video.playbackRate = wasRate;
    state.exporting = false;
    hideBusy();
    panel.setLocked(false);
    layout();
    play();
  }
}

// --- Sparade inställningar ------------------------------------------------

function make(tag, props) {
  return Object.assign(document.createElement(tag), props);
}

function renderPresets(row) {
  row.classList.add('presets');
  let presets = loadPresets();

  const select = make('select', { className: 'preset-select' });
  const nameInput = make('input', {
    type: 'text', className: 'preset-name', placeholder: 'Namn', maxLength: 60,
  });
  const saveBtn = make('button', { type: 'button', className: 'btn btn-small', textContent: 'Spara' });
  const deleteBtn = make('button', { type: 'button', className: 'btn btn-small', textContent: 'Ta bort' });
  const exportBtn = make('button', { type: 'button', className: 'btn btn-small', textContent: 'Till fil' });
  const importBtn = make('button', { type: 'button', className: 'btn btn-small', textContent: 'Från fil' });
  const fileInput = make('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const status = make('p', { className: 'row-note' });

  const sortedNames = () => Object.keys(presets).sort((a, b) => a.localeCompare(b, 'sv'));

  let panelLocked = false;
  const updateDelete = () => {
    deleteBtn.disabled = panelLocked || !select.value;
  };

  function refreshList(selected = select.value) {
    const names = sortedNames();
    select.textContent = '';
    select.append(make('option', {
      value: '',
      textContent: names.length ? '— välj sparad —' : 'Inget sparat ännu',
    }));
    for (const name of names) select.append(make('option', { value: name, textContent: name }));
    select.value = names.includes(selected) ? selected : '';
    saveBtn.textContent = presets[nameInput.value.trim()] ? 'Skriv över' : 'Spara';
    updateDelete();
  }

  function persist(message) {
    status.textContent = storePresets(presets)
      ? message
      : 'Kunde inte spara — webbläsaren tillåter inte lagring här.';
  }

  let armTimer = 0;
  function armDelete(armed) {
    clearTimeout(armTimer);
    deleteBtn.classList.toggle('is-armed', armed);
    deleteBtn.textContent = armed ? 'Säker?' : 'Ta bort';
    if (armed) armTimer = setTimeout(() => armDelete(false), 3000);
  }

  select.addEventListener('change', () => {
    armDelete(false);
    updateDelete();
    const name = select.value;
    if (!name) return;
    nameInput.value = name;
    applyValues(presets[name]);
    status.textContent = `Hämtade "${name}".`;
    refreshList(name);
  });

  nameInput.addEventListener('input', () => {
    saveBtn.textContent = presets[nameInput.value.trim()] ? 'Skriv över' : 'Spara';
  });

  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || `Inställning ${sortedNames().length + 1}`;
    presets[name] = { ...params };
    nameInput.value = name;
    refreshList(name);
    persist(`Sparade "${name}".`);
  });

  deleteBtn.addEventListener('click', () => {
    const name = select.value;
    if (!name) {
      status.textContent = 'Välj en sparad inställning i listan först.';
      return;
    }
    if (!deleteBtn.classList.contains('is-armed')) {
      armDelete(true);
      return;
    }
    armDelete(false);
    delete presets[name];
    refreshList('');
    persist(`Tog bort "${name}".`);
  });

  exportBtn.addEventListener('click', () => {
    const data = {
      app: 'n4tn-tidskub',
      version: 1,
      savedAt: new Date().toISOString(),
      presets,
      current: { ...params },
    };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      'n4tn-installningar.json');
    status.textContent = 'Laddade ned inställningarna som fil.';
  });

  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      // Filen kan vara en hel export eller en enda uppsättning inställningar.
      const incoming = data?.presets && typeof data.presets === 'object'
        ? data.presets
        : { [file.name.replace(/\.json$/i, '')]: data };
      let added = 0;
      for (const [name, values] of Object.entries(incoming)) {
        const clean = sanitize(values);
        if (!Object.keys(clean).length) continue;
        let unique = name;
        for (let n = 2; presets[unique]; n++) unique = `${name} (${n})`;
        presets[unique] = clean;
        added++;
      }
      if (!added) {
        status.textContent = 'Filen innehöll inga inställningar som gick att läsa.';
        return;
      }
      refreshList();
      persist(`Läste in ${added} inställning${added === 1 ? '' : 'ar'} från filen.`);
    } catch {
      status.textContent = 'Filen gick inte att läsa som inställningar.';
    }
  });

  row.append(
    select,
    make('div', { className: 'preset-row' }, ),
    make('div', { className: 'preset-row' }, ),
    status,
    fileInput,
  );
  row.children[1].append(nameInput, saveBtn);
  row.children[2].append(deleteBtn, exportBtn, importBtn);

  refreshList();
  return {
    sync: (disabled) => {
      panelLocked = disabled;
      updateDelete();
    },
  };
}

// --- Panel ---------------------------------------------------------------

const noVideo = () => !state.hasVideo;
const volumeUpToDate = () =>
  !!state.builtWith &&
  state.builtWith.frames === params.frames &&
  state.builtWith.size === params.size;

const sections = [
  {
    title: 'Sparade inställningar',
    items: [{ type: 'custom', render: renderPresets }],
  },
  {
    title: 'Volym',
    items: [
      { type: 'number', key: 'frames', label: 'Bildrutor', min: 2, max: 512, step: 1 },
      { type: 'number', key: 'size', label: 'Upplösning (px)', min: 32, max: 720, step: 1 },
      { type: 'note', id: 'volume-info', text: '' },
      { type: 'buttons', buttons: [
        { label: 'Bygg om volym', id: 'rebuild-btn', action: () => buildVolume() },
      ], disabled: () => noVideo() || state.building || volumeUpToDate() },
      { type: 'range', key: 'depth', label: 'Djup (tid)', min: 0.2, max: 4, step: 0.05 },
      { type: 'checkbox', key: 'flipTime', label: 'Vänd tidsriktning' },
    ],
  },
  {
    title: 'Utseende',
    items: [
      { type: 'select', key: 'content', label: 'Innehåll', options: [
        [0, 'Bild'], [1, 'Rörelse'],
      ] },
      { type: 'range', key: 'motionGain', label: 'Rörelsekänslighet', min: 1, max: 40, step: 0.5,
        visible: (p) => p.content === 1 },
      { type: 'select', key: 'blend', label: 'Blandning', options: [
        [0, 'Genomskinlig'], [1, 'Adderande'], [2, 'Maxljus'],
      ] },
      { type: 'range', key: 'density', label: 'Densitet', min: 0, max: 10, step: 0.05,
        visible: (p) => p.blend !== 2 },
      { type: 'range', key: 'lumWeight', label: 'Ljusa partier tätare', min: 0, max: 1, step: 0.01 },
      { type: 'range', key: 'shellFront', label: 'Yta fram', min: 0, max: 1, step: 0.01 },
      { type: 'range', key: 'shellBack', label: 'Yta bak', min: 0, max: 1, step: 0.01 },
      { type: 'range', key: 'brightness', label: 'Ljusstyrka', min: 0.2, max: 3, step: 0.01 },
      { type: 'range', key: 'saturation', label: 'Mättnad', min: 0, max: 2, step: 0.01 },
      { type: 'range', key: 'glass', label: 'Glasreflex', min: 0, max: 2, step: 0.01 },
      { type: 'range', key: 'edgeGlow', label: 'Kantglöd', min: 0, max: 2, step: 0.01 },
      { type: 'range', key: 'lines', label: 'Kantlinjer', min: 0, max: 1, step: 0.01 },
      { type: 'range', key: 'steps', label: 'Kvalitet (steg)', min: 48, max: 360, step: 1 },
      { type: 'color', key: 'background', label: 'Bakgrund' },
    ],
  },
  {
    title: 'Snitt',
    items: [
      { type: 'checkbox', key: 'timeOn', label: 'Tidssnitt (följer klippet)' },
      { type: 'range', key: 'timeCount', label: 'Antal i djupled', min: 1, max: 64, step: 1,
        visible: (p) => p.timeOn },
      { type: 'checkbox', key: 'timeFollow', label: 'Följ uppspelningen', visible: (p) => p.timeOn },
      { type: 'range', key: 'timePos', label: 'Tidsposition', min: 0, max: 1, step: 0.001,
        visible: (p) => p.timeOn && !p.timeFollow },
      { type: 'range', key: 'timeOpacity', label: 'Opacitet', min: 0, max: 1, step: 0.01,
        visible: (p) => p.timeOn },
      { type: 'range', key: 'xCount', label: 'Antal snitt i sidled (X)', min: 0, max: 64, step: 1 },
      { type: 'checkbox', key: 'xSweep', label: 'Svep automatiskt', visible: (p) => p.xCount >= 1 },
      { type: 'range', key: 'xPos', label: 'X-position', min: 0, max: 1, step: 0.001,
        visible: (p) => p.xCount >= 1 && !p.xSweep },
      { type: 'range', key: 'yCount', label: 'Antal snitt i höjdled (Y)', min: 0, max: 64, step: 1 },
      { type: 'range', key: 'yPos', label: 'Y-position', min: 0, max: 1, step: 0.001,
        visible: (p) => p.yCount >= 1 },
      { type: 'range', key: 'axisOpacity', label: 'Opacitet X/Y', min: 0, max: 1, step: 0.01,
        visible: (p) => p.xCount >= 1 || p.yCount >= 1 },
    ],
  },
  {
    title: 'Kamera',
    items: [
      { type: 'select', key: 'motion', label: 'Rörelse', options: [
        ['free', 'Fri (mus)'], ['pendulum', 'Pendel'], ['rotate', 'Rotation'],
      ] },
      { type: 'range', key: 'motionSpeed', label: 'Hastighet', min: 0.05, max: 2, step: 0.01,
        visible: (p) => p.motion !== 'free' },
      { type: 'range', key: 'fov', label: 'Brännvidd (FOV)', min: 12, max: 75, step: 1 },
      { type: 'buttons', buttons: [
        { label: 'Återställ vy', action: () => fitCamera() },
      ] },
    ],
  },
  {
    title: 'Export',
    items: [
      { type: 'select', key: 'format', label: 'Format', options: [
        ['1080x1080', '1:1 · 1080×1080'],
        ['1080x1350', '4:5 · 1080×1350'],
        ['1080x1920', '9:16 · 1080×1920'],
        ['1920x1080', '16:9 · 1920×1080'],
      ] },
      { type: 'select', key: 'fps', label: 'Bilder/s', options: [[30, '30'], [60, '60']] },
      { type: 'select', key: 'bitrate', label: 'Kvalitet', options: [
        [8, '8 Mbit/s'], [16, '16 Mbit/s'], [24, '24 Mbit/s'], [40, '40 Mbit/s'],
      ] },
      { type: 'select', key: 'loops', label: 'Längd', options: [
        [1, '1 varv'], [2, '2 varv'], [3, '3 varv'],
      ] },
      { type: 'checkbox', key: 'audio', label: 'Ta med ljud' },
      { type: 'buttons', buttons: [
        { label: 'Exportera video', id: 'export-btn', primary: true, action: exportVideo },
        { label: 'Spara bild', action: saveSnapshot },
      ], disabled: () => noVideo() || state.building },
      { type: 'note', id: 'export-status',
        text: 'Exporten spelar in videon i realtid från början till slut. Håll fliken synlig under tiden.' },
    ],
  },
];

// Visar vad de valda inställningarna kostar innan man bygger om.
function volumeEstimate() {
  if (!state.hasVideo || !video.videoWidth) {
    return 'Fler bildrutor ger mjukare tidsövergång men tar längre tid att bygga.';
  }
  const scale = Math.min(1, params.size / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.max(2, Math.round(video.videoWidth * scale));
  const h = Math.max(2, Math.round(video.videoHeight * scale));
  const mb = (w * h * params.frames * 4) / 1e6;
  const fps = video.duration ? ` (${(params.frames / video.duration).toFixed(1)} bildrutor/s av klippet)` : '';
  return `${w}×${h} × ${params.frames} st ≈ ${mb.toFixed(0)} MB${fps}.`;
}

function updateVolumeInfo() {
  const note = $('volume-info');
  if (note) note.textContent = volumeEstimate();
}

function applyValues(values) {
  Object.assign(params, sanitize(values));
  onParamChange('*');
}

function onParamChange(key) {
  if (key === 'frames' || key === 'size' || key === '*') updateVolumeInfo();
  if (key === 'depth' || key === '*') volume.setDepth(params.depth);
  if (key === 'format' || key === '*') layout();
  if (key === 'motion' || key === '*') anchorMotion();
  saveParams();
  panel.refresh();
}

const panel = buildPanel($('panel'), sections, params, DEFAULTS, onParamChange);

// Återställningen kräver två klick, så att inte en felklickning slår ut alla inställningar.
const resetBtn = $('reset-btn');
let resetTimer = 0;
function armReset(armed) {
  clearTimeout(resetTimer);
  resetBtn.classList.toggle('is-armed', armed);
  resetBtn.textContent = armed ? 'Säker?' : 'Återställ';
  if (armed) resetTimer = setTimeout(() => armReset(false), 3000);
}
resetBtn.addEventListener('click', () => {
  if (!resetBtn.classList.contains('is-armed')) {
    armReset(true);
    return;
  }
  armReset(false);
  // Antal bildrutor och upplösning behålls, annars måste volymen byggas om.
  const keep = { frames: params.frames, size: params.size };
  Object.assign(params, DEFAULTS, keep);
  onParamChange('*');
});
volume.setDepth(params.depth);
applyMute();
updateVolumeInfo();

// ?src=url laddar en video direkt (bra för test och länkar).
const srcParam = new URLSearchParams(location.search).get('src');
if (srcParam) {
  state.muted = true;
  applyMute();
  openSource(srcParam, srcParam.split('/').pop());
}

if (import.meta.env.DEV) {
  window.__n4tn = { params, state, camera, controls, volume, video, renderer, fitCamera, openSource, exportVideo };
}
