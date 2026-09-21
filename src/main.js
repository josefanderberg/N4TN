import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VolumeBox, hasForm, hasPath, isBent } from './volume.js';
import { CancelledError, backgroundTexture, extractFrames, makeDemoVolume } from './frames.js';
import { depthTexture, estimateDepth } from './depth.js';
import { buildPanel } from './ui.js';
import { CanvasRecorder, downloadBlob, pickMimeType } from './recorder.js';
import { Particles } from './particles.js';
import { decodeSettings, encodeSettings } from './code.js';

const DEFAULTS = {
  frames: 144,
  size: 320,

  content: 1,
  bgRemove: false,
  bgThreshold: 0.15,
  motionGain: 8,
  motionMist: 0,
  blend: 1,
  density: 2.6,
  lumWeight: 0.4,
  wave: 0.7,
  waveWidth: 0.3,
  edgeFade: 0,
  sliceWave: 0,
  sliceWaveWidth: 0.3,
  special: false,
  specialReverse: false,
  specialVertical: false,
  specialAmount: 1,
  stereo: false,
  stereoMode: 'cross',
  stereoAngle: 3,
  shellFront: 0.75,
  shellBack: 0.6,
  shellLeft: 0.75,
  shellRight: 0.75,
  shellTop: 0.75,
  shellBottom: 0.75,
  sizeFront: 1,
  sizeBack: 1,
  brightness: 1.1,
  expFloor: 0,
  expCeil: 1,
  saturation: 0.9,
  timeTint: 0,
  depthRelief: 0.15,
  depthFrames: 12,
  glass: 1,
  edgeGlow: 0.6,
  lines: 0.3,
  // Brytare som släcker kanterna, spegelglansen och ytorna utan att röra reglagen.
  showEdges: true,
  showGlass: true,
  showShells: true,
  depth: 1.3,
  flipTime: false,
  steps: 200,

  // Form och tid: bilden böjd runt en axel, en slingrande bana och olinjär tid.
  bend: 0,
  bendCenter: 1,
  bendAxis: 0,
  bendPitch: 0,
  formRound: 0,
  formTwist: 0,
  warpAmount: 0,
  warpRate: 3,
  warpVariation: 0,
  warpSpeed: 0,
  jumpAmount: 0,
  jumpLength: 0.5,
  pathX: 0,
  pathY: 0,
  pathSpin: 0,
  pathSoft: 0.6,
  pathSpeed: 0,
  seed: 1,

  material: 0,
  liquidLevel: 0.3,
  liquidSoft: 1.5,
  liquidGloss: 1,
  liquidClarity: 0.6,

  prism: 0,
  prismReach: 0.5,
  prismSpread: 0.3,
  prismView: 0.5,

  particles: false,
  particlesVolume: false,
  particleCount: 65536,
  particleSize: 1,
  particleForce: 3,
  particleAuto: 0,
  gravity: false,
  gravityStrength: 6,
  particleBounce: 0.5,
  particleHome: 1,
  particleSwirl: 0,
  particleContainer: 1.6,
  particleBox: true,

  timeOn: true,
  timeLoop: false,
  timeAnchor: 0,
  timeSeam: 0.08,
  timeCount: 1,
  timeFollow: true,
  timePos: 0,
  timeOpacity: 0.92,
  timeFullOpacity: 0.92,
  timeGradient: 0,
  timeRestOpacity: 0.55,
  timeFull: 1,
  timeCurve: 1,
  xCount: 0,
  xPos: 0.5,
  xSweep: false,
  xFan: false,
  xFanCenter: 0.5,
  xSpinSpeed: 0.35,
  xOpacity: 0.3,
  yCount: 0,
  yPos: 0.5,
  ySweep: false,
  yOpacity: 0.3,

  speed: 1,
  followSlice: true,
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
const RANDOM_KEY = 'n4tn.random.v1';
const DEMO_DURATION = 6;

// --- Slumpen ---------------------------------------------------------------

// Reglage som slumpen aldrig rör: bygget kräver ombygge, exporten är filval
// och nyckelrutorna är ett beräkningsval, inte en del av looken. Djupledens
// tre kryss slumpas inte heller — de tvingas på efter varje slumpning, så att
// lådan aldrig slumpas till att se tom eller stillastående ut.
const RANDOM_EXCLUDED = new Set([
  'frames', 'size', 'format', 'fps', 'bitrate', 'audio', 'loops', 'depthFrames', 'particleCount',
  // Rummet är svart, och vad lådan visar av kanter, glans och ytor väljer man själv.
  'background', 'showEdges', 'showGlass', 'showShells',
  'timeOn', 'timeFollow', 'timeLoop',
]);
// Släckta från början: kameran, rummet och de tunga eller omvälvande valen.
// Tänds med tärningen intill reglaget när väljarläget är på.
const RANDOM_DEFAULT_OFF = new Set([
  'motion', 'motionSpeed', 'fov', 'followSlice', 'speed',
  'flipTime', 'steps', 'depth', 'bgRemove',
  'stereo', 'stereoMode', 'stereoAngle',
  // Materialet och partiklarna byter ut hela scenen, inte bara looken. (Form och
  // tid rörs inte alls av den stora tärningen, se randomizeParams.)
  'material', 'liquidLevel', 'liquidSoft', 'liquidGloss', 'liquidClarity',
  'particles', 'particlesVolume', 'particleSize', 'particleForce', 'particleAuto', 'gravity',
  'gravityStrength', 'particleBounce', 'particleHome', 'particleSwirl', 'particleContainer',
  'particleBox',
]);
// Slumpens egna spann där reglagets fulla skala mest ger oanvändbara lägen
// (256 snitt, djup 200, svart exponering …). Övriga slumpas över hela skalan.
const RANDOM_RANGE = {
  timeCount: [1, 16], xCount: [0, 12], yCount: [0, 8], timeFull: [1, 6],
  motionGain: [2, 20], motionMist: [0, 2], density: [0.3, 6],
  wave: [0, 1], sliceWave: [0, 1], specialAmount: [0.2, 1.5],
  expFloor: [0, 0.35], expCeil: [0.65, 1], brightness: [0.7, 2],
  saturation: [0.3, 1.6], bgThreshold: [0.08, 0.35], depthRelief: [0, 0.35],
  edgeFade: [0, 0.25], timeSeam: [0, 0.25], xSpinSpeed: [0.05, 1],
  depth: [0.5, 5], steps: [120, 280], fov: [18, 60], motionSpeed: [0.1, 1],
  timeOpacity: [0.3, 1], timeFullOpacity: [0.2, 1],
  timeRestOpacity: [0, 0.8], timeGradient: [0, 0.4], timeCurve: [0.4, 3],
  bend: [0, 720], bendCenter: [0, 4], bendPitch: [0, 2], formTwist: [-360, 360],
  warpAmount: [0, 0.3], jumpLength: [0.2, 2], pathX: [0, 1.5], pathY: [0, 1.5], pathSpin: [0, 180],
  liquidLevel: [0.1, 0.8], prismReach: [0.1, 1.5], particleForce: [1, 8], gravityStrength: [2, 15],
  particleSwirl: [0, 2], particleContainer: [1.2, 2.5],
};

function loadRandomPicks() {
  try {
    const saved = JSON.parse(localStorage.getItem(RANDOM_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

const randomPicks = loadRandomPicks();

function randomOn(key) {
  return randomPicks[key] ?? !RANDOM_DEFAULT_OFF.has(key);
}

function setRandomOn(key, on) {
  randomPicks[key] = on;
  try {
    localStorage.setItem(RANDOM_KEY, JSON.stringify(randomPicks));
  } catch {
    // Valet gäller ändå tills sidan laddas om.
  }
}

function loadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULTS, ...sanitize(migrateFullOpacity(saved)) };
  } catch {
    return { ...DEFAULTS };
  }
}

// Sparat från innan de fulla ögonblicken fick eget reglage: de låg då på samma
// nivå som bildrutan som spelas. Gäller hela uppsättningar (lagring och förval);
// delningskoderna räknas om utifrån sin version i decodeSettings.
function migrateFullOpacity(values) {
  if (values && typeof values.timeOpacity === 'number' && values.timeFullOpacity === undefined) {
    return { ...values, timeFullOpacity: values.timeOpacity };
  }
  return values;
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

// Rent utseende i panelen, inget som hör till bilden och sparas därför inte.
const ui = {
  sliceTab: 'time',
  waveTab: 'played',
  // Djupet över reglagets max öppnar det fria läget direkt.
  depthExpanded: params.depth > 5,
  shellsOpen: false,
  // Väljarläget för slumpen: visar en tärning intill varje reglage.
  randomPick: false,
  formTab: 'form',
};

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
  // Sparat från när uttoningen mellan snitten var relativ (timeFade): räkna om
  // till bottenopaciteten, så gamla förval och koder ser ut som de gjorde.
  if (typeof values.timeFade === 'number' && clean.timeRestOpacity === undefined) {
    const top = typeof clean.timeOpacity === 'number' ? clean.timeOpacity : DEFAULTS.timeOpacity;
    clean.timeRestOpacity = Math.round(top * (1 - values.timeFade) * 100) / 100;
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
  depthBusy: false,
  warpClock: 0,
  pathClock: 0,
  depthReady: false,
  depthKeyframes: 0,
};

// --- Rendering -----------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(params.fov, 1, 0.01, 2000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 0.8;
controls.maxDistance = 400;

const volume = new VolumeBox();
scene.add(volume.group);

const particles = new Particles(renderer);
scene.add(particles.group);

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

// Placerar kameran så att hela formen precis får plats i bilden, oavsett bildformat.
// Med keepDirection behålls vinkeln kameran har nu och bara avståndet ändras.
function fitCamera(keepDirection = false) {
  const points = volume.fitPoints(params);
  // Partiklarna kan flyga ut till behållarens väggar, så då ska den rymmas.
  if (params.particles) {
    const { min, max } = updateContainer();
    for (let i = 0; i < 8; i++) {
      points.push(new THREE.Vector3(
        i & 1 ? max.x : min.x,
        i & 2 ? max.y : min.y,
        i & 4 ? max.z : min.z,
      ));
    }
  }
  _dir.copy(camera.position).sub(controls.target);
  if (keepDirection && _dir.lengthSq() > 1e-8) {
    _dir.normalize();
  } else {
    _dir.set(
      Math.sin(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
      Math.sin(VIEW_ELEVATION),
      Math.cos(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
    ).normalize();
  }
  _right.set(0, 1, 0).cross(_dir);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
  _right.normalize();
  _up.crossVectors(_dir, _right).normalize();

  const tanV = Math.tan(THREE.MathUtils.degToRad(params.fov) / 2);
  // I stereogramläget får varje öga bara halva bildbredden.
  const tanH = tanV * (params.stereo ? camera.aspect / 2 : camera.aspect);
  let distance = 0;
  if (hasForm(params)) {
    // Varje punkt ska hamna innanför bildens kant sett från kameran.
    for (const c of points) {
      const need = Math.max(Math.abs(c.dot(_right)) / tanH, Math.abs(c.dot(_up)) / tanV);
      distance = Math.max(distance, c.dot(_dir) + need * 1.1);
    }
  } else {
    let maxRight = 0;
    let maxUp = 0;
    let maxDepth = 0;
    for (const c of points) {
      maxRight = Math.max(maxRight, Math.abs(c.dot(_right)));
      maxUp = Math.max(maxUp, Math.abs(c.dot(_up)));
      maxDepth = Math.max(maxDepth, c.dot(_dir));
    }
    distance = Math.max(maxRight / tanH, maxUp / tanV) * 1.1 + maxDepth;
  }

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

// Kameran kan åka med tidssnittet genom lådan. Mål och kamera flyttas lika
// mycket, så avståndet och vinkeln till snittet är oförändrade; när klippet
// börjar om hoppar snittet tillbaka till framkanten och kameran med det.
// En böjd form följer i stället genom att snurra runt sin axel, se volume.js.
function followSlice(timePos) {
  const desired = params.followSlice && !isBent(params)
    ? (0.5 - timePos) * (params.flipTime ? -1 : 1) * volume.size.z
    : 0;
  const delta = desired - controls.target.z;
  if (Math.abs(delta) < 1e-6) return;
  controls.target.z += delta;
  camera.position.z += delta;
}

// Special: djupsnitten vrids mot kamerans vinkel kring mittpunkten, så att de
// står på diagonalen men behåller sin ordning genom lådan.
// Sidledsvridningen följer kamerans azimut; höjdledslutningen dess elevation,
// så att ögonblicken även lutar fram och bak när man panorerar upp eller ner.
function tiltFromCamera() {
  // Formerna har egna ögonblick som inte går att vrida så.
  if (hasForm(params)) return { h: 0, v: 0 };
  const dx = camera.position.x - controls.target.x;
  const dy = camera.position.y - controls.target.y;
  const dz = camera.position.z - controls.target.z;
  const sign = params.specialReverse ? 1 : -1;
  const azimuth = Math.atan2(dx, dz);
  const elevation = Math.atan2(dy, Math.hypot(dx, dz));
  return {
    h: params.special ? sign * azimuth * params.specialAmount : 0,
    v: params.specialVertical ? sign * elevation * params.specialAmount : 0,
  };
}

// --- Stereogram ------------------------------------------------------------

// Två ögonvyer sida vid sida: kameran vrids ett halvt ögonavstånd åt varje
// håll kring målet, och varje vy ritas i sin halva av bilden. Vid korsblick
// ligger högra ögats vy till vänster, så att bilderna smälter ihop när man
// korsar blicken; parallellblick är tvärtom. Kameran återställs efteråt, så
// att styrningen och kameraföljningen aldrig märker av ögonen.
const _stereoSize = new THREE.Vector2();
const _stereoPos = new THREE.Vector3();
const _stereoQuat = new THREE.Quaternion();
const _stereoOffset = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

function renderStereo(frame) {
  renderer.getSize(_stereoSize);
  const w = _stereoSize.x;
  const h = _stereoSize.y;
  const half = THREE.MathUtils.degToRad(params.stereoAngle) / 2;
  // Positiv vridning flyttar kameran åt höger: högra ögat.
  const sign = params.stereoMode === 'cross' ? 1 : -1;
  _stereoPos.copy(camera.position);
  _stereoQuat.copy(camera.quaternion);
  const aspect = camera.aspect;
  camera.aspect = w / 2 / h;
  camera.updateProjectionMatrix();
  renderer.setScissorTest(true);
  for (const [x, angle] of [[0, sign * half], [w / 2, -sign * half]]) {
    _stereoOffset.copy(_stereoPos).sub(controls.target).applyAxisAngle(_yAxis, angle);
    camera.position.copy(controls.target).add(_stereoOffset);
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
    volume.update(camera, frame);
    renderer.setViewport(x, 0, w / 2, h);
    renderer.setScissor(x, 0, w / 2, h);
    renderer.render(scene, camera);
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  camera.position.copy(_stereoPos);
  camera.quaternion.copy(_stereoQuat);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

// --- Partiklar ------------------------------------------------------------

const particleState = { clock: 0, shapeDirty: true, container: new THREE.Box3() };
const _drawSize = new THREE.Vector2();
const placeParticle = (out, x, y, t) => volume.placeInVolume(out, x, y, t);

// Behållaren är lådan runt formen, förstorad kring sin mitt.
function updateContainer() {
  const box = particleState.container.setFromPoints(volume.fitPoints(params));
  const center = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5 * params.particleContainer);
  return box.set(center.clone().sub(half), center.add(half));
}

function updateParticles(dt) {
  const on = params.particles;
  particles.points.visible = on;
  particles.box.visible = on && params.particleBox;
  volume.group.visible = !on || params.particlesVolume;
  if (!on) return;

  particles.ensure(params);
  if (particleState.shapeDirty) {
    volume.configureForm(params);
    updateContainer();
    if (!particles.dirty) particles.place(placeParticle);
    particleState.shapeDirty = false;
  }
  if (particles.dirty && !state.building) {
    volume.configureForm(params);
    particles.seed(volume.uniforms.uVolume.value, placeParticle, params);
  }
  if (params.particleAuto > 0) {
    particleState.clock += dt;
    if (particleState.clock >= params.particleAuto) {
      particleState.clock = 0;
      particles.fling();
    }
  }
  renderer.getDrawingBufferSize(_drawSize);
  const pixels = _drawSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  particles.update(dt, frameParams, particleState.container, pixels);
}

// --- Renderloop ----------------------------------------------------------

const timer = new THREE.Timer();
timer.connect(document);
const frameParams = { ...params };

function clipDuration() {
  return state.hasVideo && video.duration ? video.duration : DEMO_DURATION;
}

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
  if (params.xSweep || params.ySweep) state.sweepTime += dt * 0.5;
  state.warpClock += dt * params.warpSpeed;
  state.pathClock += dt * params.pathSpeed;

  Object.assign(frameParams, params);
  // Brytarna släcker det de styr utan att röra reglagens värden.
  if (!params.showEdges) {
    frameParams.lines = 0;
    frameParams.edgeGlow = 0;
  }
  if (!params.showGlass) frameParams.glass = 0;
  if (!params.showShells) {
    for (const key of ['shellFront', 'shellBack', 'shellLeft', 'shellRight', 'shellTop', 'shellBottom']) {
      frameParams[key] = 0;
    }
  }
  frameParams.warpPhase = state.warpClock * Math.PI * 2;
  frameParams.pathPhase = state.pathClock * Math.PI * 2;
  frameParams.jumpPieces = jumpPieces();
  frameParams.timePosEffective = params.timeFollow ? currentTimeFraction() : params.timePos;
  followSlice(params.timeLoop ? params.timeAnchor : frameParams.timePosEffective);
  updateCamera(dt);
  const tilt = tiltFromCamera();
  frameParams.tilt = tilt.h;
  frameParams.tiltV = tilt.v;
  // I solfjäderläget snurrar svepet fläkten runt axeln i stället för att vagga.
  frameParams.xPosEffective = params.xSweep
    ? (params.xFan
      ? (state.sweepTime * params.xSpinSpeed) % 1
      : 0.5 + 0.45 * Math.sin(state.sweepTime))
    : params.xPos;
  // Egen takt för höjdleden, annars rör sig de två snitten i lås med varandra.
  frameParams.yPosEffective = params.ySweep
    ? 0.5 + 0.45 * Math.sin(state.sweepTime * 0.73 + 1.1)
    : params.yPos;
  renderer.setClearColor(params.background);
  updateParticles(dt);
  if (params.stereo) {
    renderStereo(frameParams);
  } else {
    volume.update(camera, frameParams);
    renderer.render(scene, camera);
  }
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

// En telefon kan låta bli att hämta videon tills skärmen rörs, och då kommer
// varken händelsen eller ett fel — därför en tidsgräns, så att väntan syns.
function waitFor(target, event, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, ok);
      target.removeEventListener('error', fail);
    };
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('Videon kunde inte spelas upp i webbläsaren.'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Videon startade inte. Tryck Försök igen.'));
    }, timeoutMs);
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
  busyIsError = false;
  showBusy('Läser in video…', 0, () => {
    state.loadToken++;
    hideBusy();
  });

  try {
    video.src = url;
    video.load();
    await waitFor(video, 'loadedmetadata');
    if (token !== state.loadToken) return;
    if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl);

    state.hasVideo = true;
    volume.setVideo(videoTexture);
    volume.setAspect(video.videoWidth / video.videoHeight);
    fitCamera();
    video.playbackRate = Number(speedSelect.value);
    play();
    syncPanel();
  } catch (err) {
    if (token !== state.loadToken) return;
    state.hasVideo = false;
    state.sourceUrl = null;
    state.builtWith = null;
    volume.setVideo(null);
    // Ett nytt försök startar från en knapptryckning, vilket är precis vad en
    // webbläsare som höll igen på videon väntade på.
    showError(err, () => openSource(url, name));
    syncPanel();
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
  syncPanel();
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
        // Nya bildrutor: bakgrunden och AI-djupet hörde till de gamla.
        volume.setVolume(texture);
        state.depthReady = false;
        state.depthKeyframes = 0;
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
    particles.dirty = true;
    volume.setExposure(built.meanLuma);
    updateJumpInfo();
    // Slogs borttagningen på under bygget räknades medianen på en halvfylld
    // volym; gör om den på de färdiga bildrutorna.
    volume.setBackground(null);
    ensureBackground();
  } catch (err) {
    if (!(err instanceof CancelledError)) showError(err);
  } finally {
    if (buildId === state.buildId) {
      state.building = false;
      if (!busyIsError) hideBusy();
      syncPanel();
    }
  }
}

// Bakgrundsbilden räknas fram först när borttagningen faktiskt slås på, ur
// volymens egna bildrutor — samma väg för demoscenen som för ett riktigt klipp.
function ensureBackground() {
  if (!params.bgRemove || volume.hasBackground) return;
  const image = volume.uniforms.uVolume.value?.image;
  if (!image?.data) return;
  volume.setBackground(backgroundTexture(image.data, image.width, image.height, image.depth));
}

// --- AI-djup ---------------------------------------------------------------

let depthToken = 0;

async function computeDepth() {
  if (state.building || state.exporting || state.depthBusy) return;
  const image = volume.uniforms.uVolume.value?.image;
  if (!image?.data) return;
  const token = ++depthToken;
  state.depthBusy = true;
  busyIsError = false;
  syncPanel();
  const cancel = () => {
    depthToken++;
    state.depthBusy = false;
    hideBusy();
    syncPanel();
  };
  showBusy('Hämtar djupmodellen…', 0, cancel);

  try {
    const result = await estimateDepth(image, {
      keyframes: params.depthFrames,
      isCancelled: () => token !== depthToken,
      onProgress: (label, fraction) => {
        if (token === depthToken) showBusy(label, fraction, cancel);
      },
    });
    if (token !== depthToken) {
      result.texture.dispose();
      return;
    }
    volume.setDepthMap(result.texture);
    state.depthReady = true;
    state.depthKeyframes = result.keyframes;
    state.depthBusy = false;
    hideBusy();
    syncPanel();
  } catch (err) {
    if (token !== depthToken || err instanceof CancelledError) return;
    state.depthBusy = false;
    showError(
      new Error(`Djupet kunde inte beräknas: ${err?.message || err}. Modellen hämtas från nätet första gången — kontrollera uppkopplingen och försök igen.`),
      computeDepth,
    );
    syncPanel();
  }
}

function depthStatusText() {
  if (state.depthBusy) return 'Beräknar…';
  if (!state.depthReady) {
    return 'Inget djup beräknat ännu. Knappen hämtar en AI-modell (första gången) och skattar djupet i klippet — allt sker i webbläsaren.';
  }
  return `Djupet är klart: ${state.depthKeyframes} nyckelrutor, mellanliggande bildrutor tonas fram. Reglaget Relief styr hur mycket ögonblicken buktar.`;
}

function updateDepthInfo() {
  const note = $('depth-status');
  if (note) note.textContent = depthStatusText();
}

let busyIsError = false;

function showError(err, retry = null) {
  console.error(err);
  busyIsError = true;
  showBusy(err?.message || 'Något gick fel.', 0, () => {
    busyIsError = false;
    hideBusy();
    retry?.();
  }, retry ? 'Försök igen' : 'Stäng');
}

function openFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv|ogv)$/i.test(file.name)) {
    showError(new Error(`"${file.name}" verkar inte vara en videofil.`));
    return;
  }
  // Säger webbläsaren nej till ljudkopplingen ska klippet ändå gå att ladda in.
  try {
    ensureAudio();
  } catch (err) {
    console.warn('Ljudet kunde inte kopplas in.', err);
  }
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
  syncSpeed();
  if (state.hasVideo && !state.exporting && video.playbackRate !== params.speed) {
    video.playbackRate = params.speed;
  }
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
  params.speed = Number(e.target.value);
  video.playbackRate = params.speed;
  saveParams();
});

// Hastigheten kan också komma från en sparad inställning eller en delad kod.
function syncSpeed() {
  const value = String(params.speed);
  if (speedSelect.value === value) return;
  if (![...speedSelect.options].some((o) => o.value === value)) {
    speedSelect.append(new Option(`${params.speed}×`, value));
  }
  speedSelect.value = value;
}
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
    video.playbackRate = params.speed;
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
  const codeInput = make('input', {
    type: 'text', className: 'preset-name preset-code', placeholder: 'Kod', spellcheck: false,
  });
  const openBtn = make('button', { type: 'button', className: 'btn btn-small', textContent: 'Öppna' });
  const shareBtn = make('button', {
    type: 'button', className: 'btn btn-small', textContent: 'Skapa kod att dela',
  });
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
    applyValues(migrateFullOpacity(presets[name]));
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

  shareBtn.addEventListener('click', async () => {
    const code = encodeSettings(params);
    codeInput.value = code;
    codeInput.select();
    const link = `${location.origin}${location.pathname}#k=${code}`;
    // Koden skrivs inte ut här: den står redan i fältet, och som obruten sträng
    // skulle den tvinga panelen bredare än skärmen.
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = 'Koden står i fältet — länken är kopierad.';
    } catch {
      status.textContent = 'Koden står i fältet — kopiera den därifrån.';
    }
  });

  function openCode() {
    const values = decodeSettings(codeInput.value);
    if (!values) {
      status.textContent = 'Koden känns inte igen. Kontrollera att hela koden kom med.';
      return;
    }
    applyValues(values);
    status.textContent = 'Öppnade inställningarna från koden.';
  }

  openBtn.addEventListener('click', openCode);
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openCode();
  });

  row.append(
    make('div', { className: 'preset-row' }),
    make('div', { className: 'preset-row' }),
    make('p', { className: 'preset-label', textContent: 'Dela med en kod' }),
    make('div', { className: 'preset-row' }),
    shareBtn,
    status,
  );
  row.children[0].append(select, deleteBtn);
  row.children[1].append(nameInput, saveBtn);
  row.children[3].append(codeInput, openBtn);

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

const onFormTab = (tab) => () => ui.formTab === tab;

// Snabbval under Form. Alla utgår från FORM_BASE, så att ett val inte ärver
// något från det förra.
const FORM_BASE = {
  bend: 0, bendCenter: 1, bendAxis: 0, bendPitch: 0, formRound: 0, formTwist: 0,
};
const FORM_PRESETS = {
  Låda: {},
  Cylinder: { bend: 360, bendCenter: 1, bendAxis: 90 },
  Donut: { bend: 360, bendCenter: 2.2, formRound: 1 },
  Boll: { bend: 180, bendCenter: 0, formRound: 1 },
  Spiral: { bend: 1080, bendCenter: 1.6, bendPitch: 1.1, formRound: 0.5 },
};

// Ett utgångsläge för prismat: glesa djupsnitt och några sidosnitt som bilderna viker över på.
const HOLOGRAM = {
  timeOn: true, timeCount: 10, timeOpacity: 0.35, timeFullOpacity: 0.35, timeRestOpacity: 0.35,
  xCount: 4, xOpacity: 0.6, prism: 1, prismReach: 0.6, prismSpread: 0.35, prismView: 0.6,
};

// Snabbval som går att ångra. Första snabbvalet sparar hur reglagen stod innan,
// och följande snabbval behåller det, så att ångra alltid går tillbaka till läget
// innan man började prova. Det sparade ligger i webbläsaren, precis som
// inställningarna, så att ångran finns kvar efter en omladdning.
function undoable(storageKey) {
  let saved = null;
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (value && typeof value === 'object') saved = value;
  } catch {
    // Utan lagring gäller ångran bara tills sidan laddas om.
  }
  const store = (value) => {
    saved = value;
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
    } catch {
      // Se ovan.
    }
  };
  return {
    get active() {
      return !!saved;
    },
    apply(values) {
      if (!saved) store(Object.fromEntries(Object.keys(values).map((key) => [key, params[key]])));
      Object.assign(params, values);
    },
    undo() {
      if (saved) Object.assign(params, sanitize(saved));
      store(null);
    },
    forget() {
      if (saved) store(null);
    },
  };
}

const formUndo = undoable('n4tn.undo.form.v1');
const hologramUndo = undoable('n4tn.undo.hologram.v1');

function toggleHologram() {
  if (hologramUndo.active) hologramUndo.undo();
  else hologramUndo.apply(HOLOGRAM);
  onParamChange('hologram');
}

// Ändringar som ger formen en annan storlek; då flyttas kameran så att den ryms.
const FORM_KEYS = new Set([
  'bend', 'bendCenter', 'bendAxis', 'bendPitch', 'formRound', 'formTwist',
  'pathX', 'pathY', 'pathSpin', 'pathSoft', 'seed', 'form', '*', 'particles', 'particleContainer',
]);

function newSeed() {
  params.seed = (params.seed + 1 + Math.floor(Math.random() * 998)) % 1000;
  onParamChange('seed');
}

// Hur många bitar klippet delas i när tiden hoppar.
function jumpPieces() {
  return Math.min(256, Math.max(1, Math.round(clipDuration() / params.jumpLength)));
}

function updateJumpInfo() {
  const note = $('jump-info');
  if (note) note.textContent = `Klippet delas i ${jumpPieces()} bitar som var och en visar en bit ur en annan del av klippet.`;
}

const sections = [
  {
    title: 'Volym',
    accent: '#7fd4c1',
    hint: 'Sammanhanget: lådan som klippet byggs in i, och rummet runt den.',
    items: [
      { type: 'number', key: 'frames', label: 'Bildrutor', min: 2, max: 512, step: 1,
        info: 'Hur många bildrutor ur klippet som staplas i djupled. Fler ger mjukare tidsövergång men tar längre tid att bygga.' },
      { type: 'number', key: 'size', label: 'Upplösning (px)', min: 32, max: 720, step: 1,
        info: 'Upplösningen på varje bildruta i lådan. Högre blir skarpare men kostar minne.' },
      { type: 'note', id: 'volume-info', text: '' },
      // Knappen är öppen så fort ett klipp är laddat: ett bygge som blev fel eller
      // avbröts ska gå att göra om utan att först behöva ändra något reglage.
      { type: 'buttons', buttons: [
        { label: 'Bygg om volym', id: 'rebuild-btn', action: () => buildVolume() },
      ], disabled: () => noVideo() || state.building,
        info: 'Läser om klippet och packar bildrutorna till lådans 3D-textur med värdena ovan.' },
      // Djupet är ett reglage upp till 5; den som vill dra ut lådan längre än så
      // öppnar det fria läget och skriver vad som helst.
      { type: 'range', key: 'depth', label: 'Djup (tid)', min: 0.2, max: 5, step: 0.05,
        visible: () => !ui.depthExpanded,
        info: 'Hur långt lådan dras ut i tidsled. 1 är en kub; högre blir en korridor genom tiden.' },
      { type: 'number', key: 'depth', label: 'Djup (tid)', min: 0.2, max: 200, step: 0.01,
        visible: () => ui.depthExpanded,
        info: 'Fritt djup i tidsled — skriv vad du vill upp till 200.' },
      { type: 'buttons', buttons: [
        { label: 'Utöka djupet…', action: () => { ui.depthExpanded = true; panel.refresh(); } },
      ], visible: () => !ui.depthExpanded },
      { type: 'buttons', buttons: [
        { label: 'Tillbaka till reglaget', action: () => {
          ui.depthExpanded = false;
          if (params.depth > 5) params.depth = 5;
          onParamChange('depth');
        } },
      ], visible: () => ui.depthExpanded },
      { type: 'checkbox', key: 'flipTime', label: 'Vänd tidsriktning',
        info: 'Vänder tiden i lådan, så att klippets slut ligger längst fram.' },
      // Olika storlek fram och bak drar ut lådan till en tratt, åt valfritt håll.
      { type: 'range', key: 'sizeFront', label: 'Storlek fram', min: 0.2, max: 2, step: 0.01,
        info: 'Framsidans storlek i förhållande till baksidan. Olika värden gör lådan till en tratt, så innehållet växer eller krymper genom flödet.' },
      { type: 'range', key: 'sizeBack', label: 'Storlek bak', min: 0.2, max: 2, step: 0.01,
        info: 'Baksidans storlek. Det är förhållandet mellan fram och bak som syns; lådan kramar alltid den större änden.' },
      // Lådans egna kanter och rummet runt den hör ihop med lådan, inte med bilden.
      // Tre brytare för det lådan visar runt innehållet. De släcker allt på en
      // gång men lämnar reglagen orörda, så att allt kommer tillbaka när de slås på.
      { type: 'checkbox', key: 'showEdges', label: 'Kanter',
        info: 'Slår av och på trådramen, konturerna och kantglöden på en gång.' },
      { type: 'checkbox', key: 'showGlass', label: 'Spegelglans',
        info: 'Slår av och på glasreflexen som får ytorna att skifta när kameran rör sig.' },
      { type: 'checkbox', key: 'showShells', label: 'Ytor',
        info: 'Slår av och på lådans alla sex sidor på en gång. Styrkan per sida finns under Ytor och glas.' },
      { type: 'range', key: 'lines', label: 'Kantlinjer', min: 0, max: 1, step: 0.01,
        disabled: (p) => !p.showEdges,
        info: 'Trådramen runt lådan och konturerna kring ögonblicken.' },
      { type: 'range', key: 'edgeGlow', label: 'Kantglöd', min: 0, max: 2, step: 0.01,
        disabled: (p) => !p.showEdges,
        info: 'Ljusskimret längs lådans kanter.' },
      // Ytorna och glaset: en yta per sida, hopfällda för att inte ta över panelen.
      { type: 'fold', label: 'Ytor och glas',
        get: () => ui.shellsOpen, set: (value) => { ui.shellsOpen = value; } },
      { type: 'range', key: 'glass', label: 'Glasreflex', min: 0, max: 2, step: 0.01, pane: true,
        visible: () => ui.shellsOpen, disabled: (p) => !p.showGlass,
        info: 'Reflexen som får lådans ytor att skifta som glas när kameran rör sig.' },
      { type: 'range', key: 'shellFront', label: 'Yta fram', min: 0, max: 1, step: 0.01, pane: true,
        visible: () => ui.shellsOpen, disabled: (p) => !p.showShells,
        info: 'Framsidan — kortsidan där klippet börjar (eller slutar med vänd tidsriktning).' },
      { type: 'range', key: 'shellBack', label: 'Yta bak', min: 0, max: 1, step: 0.01, pane: true,
        visible: () => ui.shellsOpen, disabled: (p) => !p.showShells,
        info: 'Baksidan — den bortre kortsidan av tiden.' },
      { type: 'range', key: 'shellLeft', label: 'Yta vänster', min: 0, max: 1, step: 0.01, pane: true,
        visible: () => ui.shellsOpen, disabled: (p) => !p.showShells,
        info: 'Vänstra väggen: bildens vänsterkant utsmetad över tid.' },
      { type: 'range', key: 'shellRight', label: 'Yta höger', min: 0, max: 1, step: 0.01, pane: true,
        visible: () => ui.shellsOpen, disabled: (p) => !p.showShells,
        info: 'Högra väggen: bildens högerkant utsmetad över tid.' },
      { type: 'range', key: 'shellTop', label: 'Yta tak', min: 0, max: 1, step: 0.01, pane: true,
        visible: () => ui.shellsOpen, disabled: (p) => !p.showShells,
        info: 'Taket: bildens överkant utsmetad över tid.' },
      { type: 'range', key: 'shellBottom', label: 'Yta botten', min: 0, max: 1, step: 0.01, pane: true,
        visible: () => ui.shellsOpen, disabled: (p) => !p.showShells,
        info: 'Botten: bildens underkant utsmetad över tid.' },
      { type: 'color', key: 'background', label: 'Bakgrund',
        info: 'Färgen på rummet runt lådan.' },
    ],
  },
  {
    title: 'Form och tid',
    accent: '#5fe0b0',
    // Har egna tärningar i rubriken och under flikarna; den stora rör den inte.
    topRandom: false,
    hint: 'Tiden som form i rummet: böj klippet i en cirkel, låt det slingra, och låt tiden gå fram och tillbaka.',
    items: [
      { type: 'tabs',
        tabs: [['form', 'Form'], ['path', 'Bana'], ['time', 'Tid']],
        get: () => ui.formTab,
        set: (value) => { ui.formTab = value; } },

      { type: 'buttons', small: true, visible: onFormTab('form'),
        buttons: Object.entries(FORM_PRESETS).map(([label, values]) => ({
          label,
          action: () => {
            formUndo.apply({ ...FORM_BASE, ...values });
            onParamChange('form');
          },
        })),
        info: 'Utgångslägen att skruva vidare på. Låda är den vanliga raka lådan. Tillbaka till innan lägger tillbaka formen du hade innan du tryckte på det första snabbvalet.' },
      { type: 'buttons', small: true, visible: () => ui.formTab === 'form' && formUndo.active,
        buttons: [{ label: 'Tillbaka till innan', action: () => {
          formUndo.undo();
          onParamChange('form');
        } }] },
      { type: 'range', key: 'bend', label: 'Böj runt axel (grader)', min: 0, max: 1080, step: 1,
        visible: onFormTab('form'),
        info: 'Hur många grader klippet täcker runt en axel: 0 är den raka lådan, 360 ett helt varv och upp till 1080 tre varv.' },
      { type: 'range', key: 'bendCenter', label: 'Centrum', min: 0, max: 8, step: 0.01,
        visible: onFormTab('form'), disabled: (p) => !isBent(p),
        info: 'Var axeln sitter: 0 mitt i bilden, 1 vid bildens kant och över 1 utanför, så att det blir ett hål i mitten. Ett helt varv blir cylinder vid 0–1 och donut över 1.' },
      { type: 'range', key: 'bendAxis', label: 'Axelns vinkel', min: 0, max: 180, step: 1,
        visible: onFormTab('form'), disabled: (p) => !isBent(p),
        info: 'Vrider axeln i bildens plan: 0 lodrät (bildrutorna snurrar som en karusell), 90 vågrät (som bladen i en rolodex).' },
      { type: 'range', key: 'bendPitch', label: 'Spiral', min: 0, max: 4, step: 0.01,
        visible: onFormTab('form'), disabled: (p) => !isBent(p),
        info: 'Låter varven stiga längs axeln, mätt i bildhöjder per varv. Med mer än ett varv blir det en spiral.' },
      { type: 'range', key: 'formRound', label: 'Rundning', min: 0, max: 1, step: 0.01,
        visible: onFormTab('form'),
        info: 'Gör bildens rektangel till en ellips. Med axeln mitt i bilden blir ett halvt varv en boll, och en ring blir en rund donut.' },
      { type: 'range', key: 'formTwist', label: 'Vridning (grader)', min: -720, max: 720, step: 1,
        visible: onFormTab('form'),
        info: 'Vrider bildrutorna kring sin egen mitt längs klippet, som en skruv.' },
      { type: 'note', text: 'Djupet under Volym gäller inte när bilden är böjd — då är det vinkeln här som bestämmer. Special gäller bara den raka lådan.',
        visible: (p) => ui.formTab === 'form' && isBent(p) },

      { type: 'range', key: 'pathX', label: 'Åt sidorna', min: 0, max: 3, step: 0.01,
        visible: onFormTab('path'),
        info: 'Hur långt bildrutorna vandrar åt sidorna längs klippet, i halva bildbredder.' },
      { type: 'range', key: 'pathY', label: 'Upp och ner', min: 0, max: 3, step: 0.01,
        visible: onFormTab('path'),
        info: 'Hur långt bildrutorna vandrar upp och ner, i halva bildhöjder.' },
      { type: 'range', key: 'pathSpin', label: 'Snurra (grader)', min: 0, max: 360, step: 1,
        visible: onFormTab('path'),
        info: 'Hur mycket bildrutorna vrider sig fram och tillbaka längs banan.' },
      { type: 'range', key: 'pathSoft', label: 'Mjukhet', min: 0, max: 1, step: 0.01,
        visible: onFormTab('path'), disabled: (p) => !hasPath(p),
        info: 'Hur lugnt banan slingrar: lågt ger en ryckig bana, högt långa mjuka svängar.' },
      { type: 'range', key: 'pathSpeed', label: 'Rörelse', min: 0, max: 2, step: 0.01,
        visible: onFormTab('path'), disabled: (p) => !hasPath(p),
        info: 'Får banan att röra sig över tid, som en orm. 0 står still.' },
      { type: 'buttons', buttons: [{ label: 'Ny slump', action: () => newSeed() }],
        visible: onFormTab('path'), disabled: (p) => !hasPath(p),
        info: 'Slumpar fram en ny bana med samma inställningar.' },

      { type: 'range', key: 'warpAmount', label: 'Fram och tillbaka', min: 0, max: 0.5, step: 0.005,
        visible: onFormTab('time'),
        info: 'Låter tiden gå växelvis framåt och bakåt längs formen i stället för jämnt. Värdet är hur långt tillbaka varje sväng går, som andel av klippet.' },
      { type: 'range', key: 'warpRate', label: 'Takt', min: 0.5, max: 12, step: 0.1,
        visible: onFormTab('time'), disabled: (p) => p.warpAmount <= 0,
        info: 'Hur många svängar fram och tillbaka det blir genom formen.' },
      { type: 'range', key: 'warpVariation', label: 'Oregelbundenhet', min: 0, max: 1, step: 0.01,
        visible: onFormTab('time'), disabled: (p) => p.warpAmount <= 0,
        info: 'Gör svängarna olika långa och olika snabba i stället för jämna.' },
      { type: 'range', key: 'warpSpeed', label: 'Rörelse', min: 0, max: 2, step: 0.01,
        visible: onFormTab('time'), disabled: (p) => p.warpAmount <= 0,
        info: 'Får mönstret av svängar att vandra genom formen över tid.' },
      { type: 'range', key: 'jumpAmount', label: 'Hoppa i tiden', min: 0, max: 1, step: 0.01,
        visible: onFormTab('time'),
        info: 'Delar formen i bitar som var och en visar en lika lång bit ur en annan del av klippet — 0,5 sekunder här, 0,5 sekunder där. 0 är i ordning, 1 helt utspritt.' },
      { type: 'range', key: 'jumpLength', label: 'Bitarnas längd (s)', min: 0.1, max: 5, step: 0.05,
        visible: onFormTab('time'), disabled: (p) => p.jumpAmount <= 0,
        info: 'Hur lång varje bit är, i sekunder av klippet.' },
      { type: 'note', id: 'jump-info', text: '', visible: (p) => ui.formTab === 'time' && p.jumpAmount > 0 },
      { type: 'buttons', buttons: [{ label: 'Ny slump', action: () => newSeed() }],
        visible: onFormTab('time'),
        disabled: (p) => p.jumpAmount <= 0 && (p.warpAmount <= 0 || p.warpVariation <= 0),
        info: 'Slumpar om vilka bitar som hamnar var, och de oregelbundna svängarna.' },
    ],
  },
  {
    title: 'Utseende',
    accent: '#c4a6ff',
    hint: 'Helheten inne i lådan: hur bildrutorna vägs ihop och lyser.',
    items: [
      { type: 'select', key: 'content', label: 'Innehåll', options: [
        [0, 'Bild'], [1, 'Rörelse'], [2, 'Bild + rörelse'],
      ], info: 'Bild visar råa bildrutor. Rörelse visar skillnaden mellan bildrutor, så att stillastående faller bort och det som rör sig ritar banor genom lådan. Bild + rörelse lägger banorna lysande ovanpå bilden.' },
      { type: 'checkbox', key: 'bgRemove', label: 'Ta bort bakgrunden',
        info: 'Räknar fram en bakgrundsbild ur hela klippet (tidsmedianen) och släcker allt som står stilla — kvar blir det som rör sig eller skiljer sig, svävande fritt i lådan. Kräver fast kamera i klippet.' },
      { type: 'range', key: 'bgThreshold', label: 'Bakgrundströskel', min: 0.02, max: 0.7, step: 0.01,
        disabled: (p) => !p.bgRemove,
        info: 'Hur mycket en punkt måste skilja sig från bakgrunden för att behållas. Höj om bakgrunden skimrar kvar, sänk om motivet äts upp.' },
      { type: 'range', key: 'motionGain', label: 'Rörelsekänslighet', min: 1, max: 40, step: 0.5,
        visible: (p) => p.content !== 0,
        info: 'Hur mycket små rörelser förstärks i rörelseläget.' },
      { type: 'range', key: 'motionMist', label: 'Rörelsedimma', min: 0, max: 5, step: 0.05,
        info: 'En självlysande dimma som glöder där det rör sig i klippet — banorna syns genom lådan oavsett innehållsläge.' },
      { type: 'select', key: 'material', label: 'Material', options: [
        [0, 'Rök'], [1, 'Vätska'], [2, 'Krom'], [3, 'Gelé'],
      ], info: 'Rök väger ihop allt längs siktlinjen. Vätska, Krom och Gelé gör i stället innehållet till en yta med speglingar och högdagrar, där det som är ljusare än nivån (eller rör sig mer än den) blir en sammanhängande form.' },
      { type: 'select', key: 'blend', label: 'Blandning', options: [
        [0, 'Genomskinlig'], [1, 'Adderande'], [2, 'Maxljus'],
      ], visible: (p) => p.material === 0,
        info: 'Hur allt längs siktlinjen vägs ihop: som genomskinliga lager, som adderat ljus, eller bara det ljusaste som syns.' },
      { type: 'range', key: 'density', label: 'Densitet', min: 0, max: 10, step: 0.05,
        visible: (p) => p.material === 0 && p.blend !== 2,
        info: 'Hur tät volymen är. Högre gör lådan mer ogenomskinlig.' },
      { type: 'range', key: 'lumWeight', label: 'Ljusa partier tätare', min: 0, max: 1, step: 0.01,
        visible: (p) => p.material === 0,
        info: 'Låter ljusa partier väga tyngre än mörka, så att de tar över i blandningen.' },
      { type: 'range', key: 'liquidLevel', label: 'Nivå', min: 0.01, max: 1.5, step: 0.01,
        visible: (p) => p.material !== 0,
        info: 'Allt som är ljusare än nivån blir vätska — i läget Rörelse allt som rör sig mer än den. Sänk för mer vätska, höj för mindre.' },
      { type: 'range', key: 'liquidSoft', label: 'Mjukhet', min: 0, max: 4, step: 0.05,
        visible: (p) => p.material !== 0,
        info: 'Läser innehållet ur en suddigare version av volymen, så att ytan blir rundare och mindre brusig. Lågt ger skarpa, krispiga former.' },
      { type: 'range', key: 'liquidGloss', label: 'Glans', min: 0, max: 2, step: 0.01,
        visible: (p) => p.material !== 0,
        info: 'Hur mycket ytan speglar och glänser.' },
      { type: 'range', key: 'liquidClarity', label: 'Klarhet', min: 0, max: 1, step: 0.01,
        visible: (p) => p.material === 1 || p.material === 3,
        info: 'Hur mycket man ser igenom vätskan. Lågt gör den grumlig och färgad av innehållet.' },
      { type: 'range', key: 'expFloor', label: 'Exponeringsbotten', min: 0, max: 0.9, step: 0.01,
        info: 'Allt mörkare än så här blir svart och resten dras ut — skär bort dis och brus i botten. Gäller allt utom bildrutan som spelas och de fulla ögonblicken, som behåller sitt ljus.' },
      { type: 'range', key: 'expCeil', label: 'Exponeringstak', min: 0.1, max: 1, step: 0.01,
        info: 'Allt ljusare än så här slår i taket och spannet under dras ut till full skala — tyglar utbrända partier. Gäller allt utom bildrutan som spelas och de fulla ögonblicken.' },
      { type: 'range', key: 'brightness', label: 'Ljusstyrka', min: 0.2, max: 3, step: 0.01,
        info: 'Ljusstyrkan på allt innehåll i lådan.' },
      { type: 'range', key: 'saturation', label: 'Mättnad', min: 0, max: 2, step: 0.01,
        info: 'Färgmättnaden, från svartvitt till förstärkta färger.' },
      { type: 'range', key: 'timeTint', label: 'Färg efter tid', min: 0, max: 1, step: 0.01,
        info: 'Tonar varje ögonblick efter var i klippet det hör hemma — början röd, mitten grön, slutet blå. Tiden blir en färgskala; i loopläget går skalan hela varvet runt. Prova med Mättnad 0 för ren tidsfärg.' },
      { type: 'range', key: 'steps', label: 'Kvalitet (steg)', min: 48, max: 360, step: 1,
        info: 'Hur många steg strålarna tar genom lådan. Fler ger jämnare bild men tyngre rendering.' },
      { type: 'range', key: 'edgeFade', label: 'Tona in och ut vid ändarna', min: 0, max: 0.5, step: 0.005,
        info: 'Tonar klippets början och slut mot lådans ändar i stället för att de klipps tvärt. I loopläget tonas lådans fram- och bakkant, så skarven inne i lådan lämnas orörd.' },
    ],
  },
  {
    title: 'Partiklar',
    accent: '#7ee0ff',
    hint: 'Gör om tidskuben till partiklar som kan slungas ut i en behållare.',
    items: [
      { type: 'checkbox', key: 'particles', label: 'Gör om till partiklar',
        info: 'Byter volymen mot ett punktmoln, hämtat ur det som är ljust (eller rör sig, i läget Rörelse) och placerat där formen säger.' },
      { type: 'checkbox', key: 'particlesVolume', label: 'Visa volymen också',
        disabled: (p) => !p.particles,
        info: 'Ritar volymen bakom partiklarna.' },
      { type: 'select', key: 'particleCount', label: 'Antal', options: [
        [16384, '16 000'], [65536, '65 000'], [262144, '262 000'],
      ], disabled: (p) => !p.particles,
        info: 'Hur många partiklar. Rörelsen räknas på grafikkortet, så även det högsta går lätt på de flesta datorer.' },
      { type: 'range', key: 'particleSize', label: 'Storlek', min: 0.2, max: 5, step: 0.05,
        disabled: (p) => !p.particles,
        info: 'Hur stora partiklarna ritas.' },
      { type: 'buttons', buttons: [
        { label: 'Slunga ut', primary: true, action: () => particles.fling() },
        { label: 'Samla ihop', action: () => particles.gather() },
      ], disabled: (p) => !p.particles,
        info: 'Slunga ut skjuter iväg partiklarna från mitten. Samla ihop lägger dem på sina platser direkt.' },
      { type: 'range', key: 'particleForce', label: 'Kraft utåt', min: 0.2, max: 12, step: 0.1,
        disabled: (p) => !p.particles,
        info: 'Hur hårt partiklarna slungas ut.' },
      { type: 'range', key: 'particleAuto', label: 'Slunga ut var n:e sekund', min: 0, max: 10, step: 0.1,
        disabled: (p) => !p.particles,
        info: 'Slungar ut partiklarna av sig självt med jämna mellanrum. 0 stänger av.' },
      { type: 'checkbox', key: 'gravity', label: 'Gravitation', disabled: (p) => !p.particles,
        info: 'Partiklarna faller mot behållarens golv, studsar och bromsas upp.' },
      { type: 'range', key: 'gravityStrength', label: 'Tyngd', min: 0.5, max: 25, step: 0.1,
        disabled: (p) => !p.particles || !p.gravity,
        info: 'Hur hårt gravitationen drar.' },
      { type: 'range', key: 'particleBounce', label: 'Studs', min: 0, max: 1, step: 0.01,
        disabled: (p) => !p.particles,
        info: 'Hur mycket av farten partiklarna behåller när de studsar mot behållarens väggar.' },
      { type: 'range', key: 'particleHome', label: 'Dras tillbaka', min: 0, max: 6, step: 0.05,
        disabled: (p) => !p.particles,
        info: 'Drar partiklarna mot sina platser i bilden, så att tidskuben byggs upp igen efter varje utkast. 0 låter dem ligga kvar där de hamnar.' },
      { type: 'range', key: 'particleSwirl', label: 'Virvel', min: 0, max: 4, step: 0.05,
        disabled: (p) => !p.particles,
        info: 'Får partiklarna att snurra runt i ett mjukt flöde.' },
      { type: 'range', key: 'particleContainer', label: 'Behållarens storlek', min: 1, max: 4, step: 0.05,
        disabled: (p) => !p.particles,
        info: 'Behållaren är lådan runt formen, förstorad så här mycket. Partiklarna studsar mot dess väggar.' },
      { type: 'checkbox', key: 'particleBox', label: 'Visa behållaren', disabled: (p) => !p.particles,
        info: 'Ritar behållarens kanter.' },
    ],
  },
  {
    // Snitten är ögonblicken: bildrutorna som skarpa plan, flera tider samtidigt.
    title: 'Ögonblick',
    accent: '#ffc978',
    hint: 'Bildrutor som skarpa plan i lådan — flera tider samtidigt. En flik per riktning.',
    items: [
      { type: 'tabs',
        tabs: [['time', 'Djupled'], ['x', 'Sidled'], ['y', 'Höjdled'], ['prism', 'Prisma']],
        get: () => ui.sliceTab,
        set: (value) => { ui.sliceTab = value; } },

      { type: 'checkbox', key: 'timeOn', label: 'Visa ögonblicken',
        visible: () => ui.sliceTab === 'time',
        info: 'Visar ögonblicken: skarpa bildrutor som plan tvärs genom lådan.' },
      { type: 'range', key: 'timeCount', label: 'Antal', min: 1, max: 256, step: 1,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn,
        info: 'Hur många ögonblick som visas samtidigt, jämnt fördelade genom klippet.' },
      { type: 'range', key: 'timeFull', label: 'Ögonblick med full styrka', min: 1, max: 32, step: 1,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn || p.timeCount < 2,
        info: 'Hur många ögonblick som lyser för fullt samtidigt, jämnt fördelade över klippet. Styrkan sjunker mellan dem.' },
      { type: 'checkbox', key: 'timeFollow', label: 'Följ uppspelningen',
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn,
        info: 'Låter ögonblicken glida genom lådan i takt med att klippet spelas.' },
      { type: 'range', key: 'timePos', label: 'Position', min: 0, max: 1, step: 0.001,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn || p.timeFollow,
        info: 'Var i klippet ögonblicket ligger, när det inte följer uppspelningen.' },
      { type: 'checkbox', key: 'timeLoop', label: 'Loopa genom lådan',
        visible: () => ui.sliceTab === 'time',
        info: 'Klippet rullar cykliskt genom lådan medan snitten står still: bildrutan som spelats förbi kommer in längst bak igen, och kameran behöver aldrig flytta sig.' },
      { type: 'range', key: 'timeAnchor', label: 'Följda bildrutans läge', min: 0, max: 1, step: 0.001,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn || !p.timeLoop,
        info: 'Var i lådan den spelade bildrutan står i loopläget: 0 längst fram, 0,5 i mitten, 1 längst bak.' },
      { type: 'range', key: 'timeSeam', label: 'Mjuka skarven', min: 0, max: 0.5, step: 0.01,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeLoop,
        info: 'I loopen vandrar skarven mellan klippets slut och början genom lådan. Här blandas de två sidorna över en andel av klippet, så mellanrummet försvinner.' },
      { type: 'range', key: 'timeOpacity', label: 'Opacitet (bildrutan som spelas)', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn,
        info: 'Styrkan på just den bildruta som spelas — ögonblicket kameran följer.' },
      { type: 'range', key: 'timeFullOpacity', label: 'Opacitet (fulla ögonblick)', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn || p.timeCount < 2,
        info: 'Styrkan på de övriga ögonblicken med full styrka. Den spelade bildrutan har sitt eget reglage ovanför.' },
      { type: 'range', key: 'timeGradient', label: 'Dynamisk opacitet', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn || p.timeCount < 2,
        info: 'Hur mycket varje fullt ögonblick tappar per steg bort från den spelade bildrutan — 0,1 ger 0,9, 0,8, 0,7 … så att det längst bort visas svagast. 0 gör alla fulla lika starka.' },
      { type: 'note', text: 'Höj Antal över 1 för fler ögonblick genom lådan — då vaknar mönstret mellan dem.',
        visible: (p) => ui.sliceTab === 'time' && p.timeOn && p.timeCount < 2 },
      { type: 'note', text: 'Hög opacitet gör att det främsta ögonblicket skymmer de bakom — sänk den för att se flera.',
        visible: (p) => ui.sliceTab === 'time' && p.timeOn && p.timeCount >= 2 && p.timeOpacity > 0.5 },

      // Vågen och styrkerampen — mönstret mellan ögonblicken. Vågen ligger i två
      // underflikar; den andra finns bara när det finns fler snitt än ett att tona.
      { type: 'tabs',
        tabs: [
          ['played', 'Bildrutan som spelas'],
          ['slices', 'Övriga ögonblick', (p) => p.timeCount >= 2],
        ],
        get: () => ui.waveTab,
        set: (value) => { ui.waveTab = value; },
        random: false,
        visible: () => ui.sliceTab === 'time' },
      { type: 'range', key: 'wave', label: 'Vågens styrka', min: 0, max: 4, step: 0.01, pane: true,
        visible: () => ui.sliceTab === 'time' && ui.waveTab === 'played',
        info: 'Hur mycket starkare allt nära den spelade bildrutan lyser än resten av klippet. 0 visar allt lika mycket; över 1 skärs det bortanför vågen bort.' },
      { type: 'range', key: 'waveWidth', label: 'Vågens längd', min: 0.02, max: 1, step: 0.01, pane: true,
        visible: () => ui.sliceTab === 'time' && ui.waveTab === 'played', disabled: (p) => p.wave <= 0,
        info: 'Hur stor del av klippet kring den spelade bildrutan som syns tydligt.' },
      { type: 'note', pane: true,
        text: 'Vågstyrka över 1 skär bort allt utanför vågen — i loopläget blir det ett stående svart band där klippet är som längst från den spelade bildrutan. Sänk styrkan till 1 eller lägre om bandet stör.',
        visible: (p) => ui.sliceTab === 'time' && ui.waveTab === 'played' && p.timeLoop && p.wave > 1 },
      { type: 'range', key: 'sliceWave', label: 'Vågens styrka', min: 0, max: 4, step: 0.01, pane: true,
        visible: () => ui.sliceTab === 'time' && ui.waveTab === 'slices', disabled: (p) => !p.timeOn,
        info: 'Samma våg, men för de övriga ögonblicken: de nära uppspelningen lyser starkast.' },
      { type: 'range', key: 'sliceWaveWidth', label: 'Vågens längd', min: 0.02, max: 1, step: 0.01, pane: true,
        visible: () => ui.sliceTab === 'time' && ui.waveTab === 'slices',
        disabled: (p) => !p.timeOn || p.sliceWave <= 0,
        info: 'Hur brett fönstret kring uppspelningen är för de övriga ögonblicken.' },
      { type: 'note', pane: true,
        text: 'Vågstyrka över 1 släcker ögonblicken längst från den spelade bildrutan helt — i loopläget syns det som ett stående tomt parti. Sänk styrkan till 1 eller lägre om det stör.',
        visible: (p) => ui.sliceTab === 'time' && ui.waveTab === 'slices' && p.timeLoop && p.sliceWave > 1 },

      // Styrkerampen: fulla ögonblick på en nivå, de emellan på en annan,
      // och bågen går mellan de två.
      { type: 'range', key: 'timeRestOpacity', label: 'Opacitet mellan ögonblicken', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn || p.timeCount < 2,
        info: 'Var mönstret bottnar mellan de fulla ögonblicken; topparna styrs av de två opacitetsreglagen högre upp.' },
      { type: 'note', text: 'Ligger opaciteten emellan i nivå med de fulla ögonblicken blir rampen platt — sänk den för att få tillbaka bågen.',
        visible: (p) => ui.sliceTab === 'time' && p.timeOn && p.timeCount >= 2
          && p.timeRestOpacity >= p.timeFullOpacity },
      { type: 'range', key: 'timeCurve', label: 'Bågens form', min: 0.2, max: 5, step: 0.05,
        visible: () => ui.sliceTab === 'time', disabled: (p) => !p.timeOn || p.timeCount < 2,
        info: 'Kurvan mellan full styrka och botten: låga värden ger breda toppar som nästan möts, höga ger spetsiga toppar.' },

      { type: 'range', key: 'xCount', label: 'Antal', min: 0, max: 256, step: 1,
        visible: () => ui.sliceTab === 'x',
        info: 'Antal snitt i sidled — stående skivor där höjden är rum och djupet är tid.' },
      { type: 'checkbox', key: 'xFan', label: 'Vinkla mot mitten (solfjäder)',
        visible: () => ui.sliceTab === 'x', disabled: (p) => p.xCount < 1,
        info: 'Sidosnitten går genom lådans mittaxel som en solfjäder i stället för rakt igenom. Position vrider solfjädern, och svepet snurrar den som en hologramfläkt.' },
      { type: 'checkbox', key: 'xSweep', label: 'Svep automatiskt',
        visible: () => ui.sliceTab === 'x', disabled: (p) => p.xCount < 1,
        info: 'Låter sidledssnitten vandra fram och tillbaka av sig själva — eller snurra, i solfjäderläget.' },
      { type: 'range', key: 'xSpinSpeed', label: 'Snurrhastighet', min: 0.02, max: 2, step: 0.01,
        visible: () => ui.sliceTab === 'x',
        disabled: (p) => p.xCount < 1 || !p.xFan || !p.xSweep,
        info: 'Hur fort solfjädern snurrar runt axeln när svepet är på.' },
      { type: 'range', key: 'xPos', label: 'Position', min: 0, max: 1, step: 0.001,
        visible: () => ui.sliceTab === 'x', disabled: (p) => p.xCount < 1 || p.xSweep,
        info: 'Var i sidled snittet ligger.' },
      { type: 'range', key: 'xFanCenter', label: 'Centrum (fram–bak)', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'x', disabled: (p) => p.xCount < 1 || !p.xFan,
        info: 'Var i djupled solfjäderns axel står: 0 längst fram, 0,5 i mitten, 1 längst bak.' },
      { type: 'range', key: 'xOpacity', label: 'Opacitet', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'x', disabled: (p) => p.xCount < 1,
        info: 'Hur starkt sidledssnitten syns.' },

      { type: 'range', key: 'yCount', label: 'Antal', min: 0, max: 256, step: 1,
        visible: () => ui.sliceTab === 'y',
        info: 'Antal snitt i höjdled — liggande skivor där bredden är rum och djupet är tid.' },
      { type: 'checkbox', key: 'ySweep', label: 'Svep automatiskt',
        visible: () => ui.sliceTab === 'y', disabled: (p) => p.yCount < 1,
        info: 'Låter höjdledssnitten vandra upp och ner av sig själva.' },
      { type: 'range', key: 'yPos', label: 'Position', min: 0, max: 1, step: 0.001,
        visible: () => ui.sliceTab === 'y', disabled: (p) => p.yCount < 1 || p.ySweep,
        info: 'Var i höjdled snittet ligger.' },
      { type: 'range', key: 'yOpacity', label: 'Opacitet', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'y', disabled: (p) => p.yCount < 1,
        info: 'Hur starkt höjdledssnitten syns.' },

      { type: 'range', key: 'prism', label: 'Styrka', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'prism',
        info: 'Där ett ögonblick möter ett snitt i sidled eller höjdled viker bilden från ögonblicket över på snittet, som om bildrutan böjdes runt hörnet. Styrkan blandar in det.' },
      { type: 'range', key: 'prismReach', label: 'Räckvidd', min: 0.02, max: 3, step: 0.01,
        visible: () => ui.sliceTab === 'prism', disabled: (p) => p.prism <= 0,
        info: 'Hur långt bilden hinner vika ut på sidosnittet innan den tonar bort.' },
      { type: 'range', key: 'prismSpread', label: 'Regnbåge', min: 0, max: 1, step: 0.01,
        visible: () => ui.sliceTab === 'prism', disabled: (p) => p.prism <= 0,
        info: 'Låter färgerna vika olika långt, som ljus genom ett prisma, så att kanterna får regnbågsfransar.' },
      { type: 'range', key: 'prismView', label: 'Följer kameran', min: 0, max: 2, step: 0.01,
        visible: () => ui.sliceTab === 'prism', disabled: (p) => p.prism <= 0,
        info: 'Förskjuter bilden efter hur man tittar, så att den glider när kameran rör sig — det ger hologramkänslan.' },
      { type: 'note', text: 'Prismat syns där ögonblicken möter snitten i sidled och höjdled — slå på båda sorterna.',
        visible: (p) => ui.sliceTab === 'prism' && (!p.timeOn || (p.xCount < 1 && p.yCount < 1)) },
      { type: 'buttons', buttons: [{
        label: () => (hologramUndo.active ? 'Ångra hologram' : 'Prova hologram'),
        action: toggleHologram,
      }], visible: () => ui.sliceTab === 'prism',
        info: 'Ställer in glesa ögonblick och några sidosnitt att börja från. Tryck igen (Ångra hologram) så kommer ögonblicken och sidosnitten tillbaka som de var innan.' },
    ],
  },
  {
    title: 'Special',
    accent: '#ff7ad9',
    hint: 'Specialtricken: vrid ögonblicken efter kameran, eller se kuben i äkta 3D.',
    items: [
      { type: 'checkbox', key: 'special', label: 'Vrid ögonblicken efter kameran',
        disabled: (p) => hasForm(p),
        info: 'Ögonblicken vrider sig mot kameran när den åker runt lådan. De går från vägg till vägg och kapas av lådans fram- och baksida.' },
      { type: 'checkbox', key: 'specialVertical', label: 'Luta upp och ner (höjdled)',
        disabled: (p) => hasForm(p),
        info: 'Samma effekt i höjdled: ögonblicken lutar fram och bak när kameran panorerar upp eller ner.' },
      { type: 'checkbox', key: 'specialReverse', label: 'Motsatt håll',
        disabled: (p) => (!p.special && !p.specialVertical) || hasForm(p),
        info: 'Vrider åt andra hållet i förhållande till kameran.' },
      { type: 'range', key: 'specialAmount', label: 'Hur mycket', min: 0, max: 3, step: 0.01,
        disabled: (p) => (!p.special && !p.specialVertical) || hasForm(p),
        info: 'Hur långt mot kameravinkeln ögonblicken vrids.' },
      { type: 'note', text: 'Vridningen gäller bara den raka lådan, inte när en form under Form och tid är på.',
        visible: (p) => hasForm(p) && (p.special || p.specialVertical) },
      // Stereogrammet: två ögonvyer sida vid sida, äkta 3D utan glasögon.
      { type: 'checkbox', key: 'stereo', label: 'Stereogram (3D med blicken)',
        info: 'Delar bilden i två vyer, en per öga. Korsa blicken tills de två bilderna glider ihop till en tredje i mitten — den är tredimensionell på riktigt, utan glasögon. Även exporten spelas in så här, så du kan dela 3D-klipp.' },
      { type: 'select', key: 'stereoMode', label: 'Betraktningssätt', options: [
        ['cross', 'Korsblick'], ['parallel', 'Parallellblick'],
      ], disabled: (p) => !p.stereo,
        info: 'Korsblick: korsa ögonen tills bilderna möts — funkar på alla skärmstorlekar. Parallellblick: slappna av och titta genom skärmen — kräver att bilderna är smala, håll skärmen en bit bort.' },
      { type: 'range', key: 'stereoAngle', label: 'Djupstyrka', min: 0.5, max: 8, step: 0.1,
        disabled: (p) => !p.stereo,
        info: 'Vinkeln mellan de två ögonvyerna. Högre ger starkare djupkänsla men blir svårare att smälta ihop — börja lågt.' },
    ],
  },
  {
    title: 'AI-djup (5D)',
    accent: '#6fe3ff',
    hint: 'En AI skattar djupet i bildrutorna, så att ögonblicken får relief.',
    items: [
      { type: 'note', id: 'depth-status', text: '' },
      { type: 'select', key: 'depthFrames', label: 'Nyckelrutor', options: [
        [6, '6 (snabbt)'], [12, '12'], [24, '24 (noggrant)'],
      ], info: 'Hur många bildrutor djupet beräknas för; resten tonas fram däremellan. Fler blir följsammare men tar längre tid.' },
      { type: 'buttons', buttons: [
        { label: 'Beräkna djup (AI)', id: 'depth-btn', primary: true, action: computeDepth },
      ], disabled: () => state.building || state.exporting || state.depthBusy,
        info: 'Hämtar en liten djupmodell (Depth Anything, ca 25–50 MB — bara första gången) och skattar djupet i nyckelrutorna. Allt körs i webbläsaren; klippet laddas aldrig upp.' },
      { type: 'range', key: 'depthRelief', label: 'Relief', min: 0, max: 0.5, step: 0.005,
        disabled: () => !state.depthReady,
        info: 'Hur mycket ögonblicken buktar mot betraktaren där AI:n ser att det är nära — bildrutorna blir små landskap i stället för platta plan. 0 stänger av.' },
    ],
  },
  {
    title: 'Kamera',
    accent: '#9ede8a',
    hint: 'Var kameran står och hur den rör sig.',
    items: [
      { type: 'checkbox', key: 'followSlice', label: 'Följ ögonblicket',
        info: 'Kameran åker med ögonblicket genom lådan på konstant avstånd.' },
      { type: 'select', key: 'motion', label: 'Rörelse', options: [
        ['free', 'Fri (mus)'], ['pendulum', 'Pendel'], ['rotate', 'Rotation'],
      ], info: 'Fri styr du själv med mus eller finger; pendel vaggar kameran, rotation åker runt lådan.' },
      { type: 'range', key: 'motionSpeed', label: 'Hastighet', min: 0.05, max: 2, step: 0.01,
        visible: (p) => p.motion !== 'free',
        info: 'Hur fort pendeln eller rotationen går.' },
      { type: 'range', key: 'fov', label: 'Brännvidd (FOV)', min: 12, max: 75, step: 1,
        info: 'Lågt värde ger tele och plattare perspektiv, högt ger vidvinkel och mer djupkänsla.' },
      { type: 'buttons', buttons: [
        { label: 'Återställ vy', action: () => fitCamera() },
      ], info: 'Ställer kameran så att hela lådan precis får plats i bilden.' },
    ],
  },
  {
    title: 'Export',
    accent: '#ff9db1',
    hint: 'Format och kvalitet på filen du laddar ned.',
    items: [
      { type: 'select', key: 'format', label: 'Format', options: [
        ['1080x1080', '1:1 · 1080×1080'],
        ['1080x1350', '4:5 · 1080×1350'],
        ['1080x1920', '9:16 · 1080×1920'],
        ['1920x1080', '16:9 · 1920×1080'],
      ], info: 'Bildförhållandet på filen som exporteras — samma som förhandsvisningen.' },
      { type: 'select', key: 'fps', label: 'Bilder/s', options: [[30, '30'], [60, '60']],
        info: 'Bildfrekvensen i den exporterade filen.' },
      { type: 'select', key: 'bitrate', label: 'Kvalitet', options: [
        [8, '8 Mbit/s'], [16, '16 Mbit/s'], [24, '24 Mbit/s'], [40, '40 Mbit/s'],
      ], info: 'Bithastigheten: högre ger skarpare video men större fil.' },
      { type: 'select', key: 'loops', label: 'Längd', options: [
        [1, '1 varv'], [2, '2 varv'], [3, '3 varv'],
      ], info: 'Hur många varv av klippet som spelas in.' },
      { type: 'checkbox', key: 'audio', label: 'Ta med ljud',
        info: 'Tar med klippets originalljud i den exporterade filen.' },
      { type: 'buttons', buttons: [
        { label: 'Exportera video', id: 'export-btn', primary: true, action: exportVideo },
        { label: 'Spara bild', action: saveSnapshot },
      ], disabled: () => noVideo() || state.building,
        info: 'Exportera video spelar in i realtid och laddar ner som fil; Spara bild tar en stillbild av vyn.' },
      { type: 'note', id: 'export-status',
        text: 'Exporten spelar in i realtid i den hastighet du valt under videon. Håll fliken synlig under tiden.' },
    ],
  },
  {
    title: 'Slumpa',
    accent: '#ffe066',
    hint: 'Tärningen i toppraden slumpar looken (utom Form och tid). Varje avsnitt har egna knappar i rubriken: 🎲 slumpar avsnittet, ✕ återställer det till standard och ↶ ångrar. Under flikarna finns samma sak för bara fliken du står på. ↶ i toppraden ångrar det senaste, var det än gjordes.',
    items: [
      { type: 'buttons', buttons: [
        { label: '🎲 Slumpa nu', action: () => randomizeParams() },
      ], disabled: () => state.exporting,
        info: 'Slumpar alla reglage som har tärningen tänd — samma som tärningen i toppraden. Bygget (bildrutor och upplösning), exporten och Form och tid rörs aldrig, och djupledens tre kryss (visa ögonblicken, följ uppspelningen, loopa) står alltid på efteråt.' },
      { type: 'checkbox', label: 'Välj vad som får slumpas',
        get: () => ui.randomPick, set: (value) => { ui.randomPick = value; },
        info: 'Visar en tärning intill varje reglage i hela panelen. Tänd tärning = reglaget får slumpas, släckt = det fredas. Valet sparas i webbläsaren. Kamera, rum och de tyngsta valen är släckta från början för den stora tärningen; avsnittens och flikarnas egna tärningar rör dem ändå, men aldrig det du själv har släckt.' },
      { type: 'note', text: 'Freda det du redan gillar och slumpa resten. Återställ i toppraden tar dig alltid tillbaka till standard.' },
    ],
  },
  {
    title: 'Sparade inställningar',
    accent: '#8fb9ff',
    hint: 'Spara looks du gillar, och dela dem med en kod.',
    items: [{ type: 'custom', render: renderPresets }],
  },
];

// Slumpar alla reglage vars tärning är tänd. Slumpen läser panelbeskrivningen,
// så nya reglage är automatiskt med utan egen lista — bara spannet kan behöva
// en rad i RANDOM_RANGE om hela skalan inte är rimlig att slumpa över.
function randomValue(item) {
  const key = item.key;
  if (item.type === 'checkbox') return Math.random() < 0.5;
  if (item.type === 'select') return item.options[Math.floor(Math.random() * item.options.length)][0];
  if (item.type === 'color') {
    // Mörka rumsfärger, så lådan fortfarande lyser mot bakgrunden.
    const ch = () => Math.floor(Math.random() * 48).toString(16).padStart(2, '0');
    return `#${ch()}${ch()}${ch()}`;
  }
  if (item.type === 'range' || item.type === 'number') {
    const [lo, hi] = RANDOM_RANGE[key] ?? [item.min, item.max];
    const step = item.step ?? 0.01;
    const value = lo + Math.random() * (hi - lo);
    return Number((Math.round(value / step) * step).toFixed(4));
  }
  return undefined;
}

// Slumpar reglagen i listan som får slumpas, och sparar först deras värden så
// att slumpningen går att ångra. forced skrivs efter slumpen och ångras också.
function randomizeItems(items, eligible, forced = {}, section = null) {
  if (state.exporting) return;
  const picked = new Map();
  for (const item of items) {
    const key = item.key;
    if (!key || picked.has(key) || !eligible(key)) continue;
    const value = randomValue(item);
    if (value !== undefined) picked.set(key, value);
  }
  const keys = [...picked.keys(), ...Object.keys(forced)];
  if (!keys.length) return;
  rememberForUndo(keys, section);
  for (const [key, value] of picked) params[key] = value;
  Object.assign(params, forced);
  onParamChange('*');
}

function randomizeParams() {
  // Avsnitt med topRandom: false (Form och tid) har sina egna tärningar och
  // rörs inte av den stora. Djupledens tre kryss står alltid på efter en
  // slumpning: ögonblicken synliga, uppspelningen följd och loopen igång.
  randomizeItems(
    sections.filter((section) => section.topRandom !== false).flatMap((section) => section.items),
    (key) => !RANDOM_EXCLUDED.has(key) && randomOn(key),
    { timeOn: true, timeFollow: true, timeLoop: true },
  );
}

// Avsnittens och flikarnas egna tärningar. De rör även det som är släckt från
// början för den stora tärningen, men aldrig det man själv har släckt i
// väljarläget, och inte huvudbrytarna som slår av och på en hel funktion.
const RANDOM_SECTION_KEEP = new Set(['particles', 'particlesVolume', 'stereo', 'bgRemove']);
const sectionEligible = (key) =>
  !RANDOM_EXCLUDED.has(key) && !RANDOM_SECTION_KEEP.has(key) && randomPicks[key] !== false;

// Återställningen rör allt utom bygget, som annars kräver en ny volym.
const RESET_KEEP = new Set(['frames', 'size']);
const resettable = (key) => key in DEFAULTS && !RESET_KEEP.has(key);

// Reglagen i listan som inte står på sitt standardvärde.
function changedKeys(items) {
  const keys = new Set();
  for (const item of items) {
    const key = item.key;
    if (key && resettable(key) && params[key] !== DEFAULTS[key]) keys.add(key);
  }
  return [...keys];
}

// Ett avsnitt (eller en flik) tillbaka till standard. Går att ångra som en slumpning.
function resetItems(items, section = null) {
  if (state.exporting) return;
  const keys = changedKeys(items);
  if (!keys.length) return;
  rememberForUndo(keys, section);
  for (const key of keys) params[key] = DEFAULTS[key];
  onParamChange('*');
}

// Slumpningar och återställningar ångras ett steg i taget: ↶ i toppraden tar
// det senaste var det än gjordes, ↶ i ett avsnitts rubrik det senaste i just
// det avsnittet. Varje steg är bara värdena som ändrades, så det man ändrat för
// hand efteråt i andra reglage står kvar.
const undoHistory = [];
const undoBtn = $('undo-btn');

function rememberForUndo(keys, section = null) {
  undoHistory.push({ section, values: Object.fromEntries(keys.map((key) => [key, params[key]])) });
  if (undoHistory.length > 50) undoHistory.shift();
  updateUndoButton();
}

function undoStep(section = null) {
  let index = undoHistory.length - 1;
  if (section) while (index >= 0 && undoHistory[index].section !== section) index--;
  if (index < 0) return;
  const [step] = undoHistory.splice(index, 1);
  Object.assign(params, step.values);
  updateUndoButton();
  onParamChange('*');
}

const canUndo = (section) => undoHistory.some((step) => step.section === section);

function updateUndoButton() {
  undoBtn.hidden = !undoHistory.length;
  undoBtn.title = `Ångra senaste slumpningen eller återställningen (${undoHistory.length} steg att ångra)`;
}

// När allt byts ut mot något annat (en kod eller en sparad uppsättning) finns
// inget kvar att ångra tillbaka till.
function forgetUndo() {
  undoHistory.length = 0;
  updateUndoButton();
  formUndo.forget();
  hologramUndo.forget();
}


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
  const cost = `${w}×${h} × ${params.frames} st ≈ ${mb.toFixed(0)} MB${fps}.`;
  if (state.building) return `${cost} Bygger…`;
  if (!state.builtWith) return `${cost} Ingen volym byggd än — tryck Bygg om volym.`;
  if (!volumeUpToDate()) return `${cost} Ändrat sedan bygget — tryck Bygg om volym.`;
  return `${cost} Volymen är byggd så här; bygg om för att göra om den.`;
}

function updateVolumeInfo() {
  const note = $('volume-info');
  if (note) note.textContent = volumeEstimate();
}

// Panelen speglar var volymen står: både knapptillstånd och raden som beskriver bygget.
function syncPanel() {
  updateVolumeInfo();
  updateDepthInfo();
  panel.refresh();
}

function applyValues(values) {
  Object.assign(params, sanitize(values));
  forgetUndo();
  onParamChange('*');
}

// Inställningar som ändrar vilka punkter partiklarna hämtas ur, eller var de hör hemma.
const PARTICLE_SOURCE_KEYS = new Set(['content', 'motionGain', '*']);
const PARTICLE_SHAPE_KEYS = new Set([
  ...FORM_KEYS, 'depth', 'flipTime', 'followSlice', 'sizeFront', 'sizeBack',
]);

function onParamChange(key) {
  if (key === 'frames' || key === 'size' || key === '*') updateVolumeInfo();
  if (key === 'bgRemove' || key === '*') ensureBackground();
  // Ett stort djup från en kod eller ett förval öppnar det fria läget av sig självt.
  if ((key === 'depth' || key === '*') && params.depth > 5) ui.depthExpanded = true;
  if (key === 'depth' || key === '*') volume.setDepth(params.depth);
  if (key === 'format' || key === '*') layout();
  if (key === 'motion' || key === '*') anchorMotion();
  // Halva bildbredden per öga: passa in lådan på nytt när läget slås om.
  if (key === 'stereo') fitCamera();
  else if (FORM_KEYS.has(key)) fitCamera(true);
  if (PARTICLE_SOURCE_KEYS.has(key)) particles.dirty = true;
  if (PARTICLE_SHAPE_KEYS.has(key)) particleState.shapeDirty = true;
  updateJumpInfo();
  saveParams();
  panel.refresh();
}

const panel = buildPanel($('panel'), sections, params, DEFAULTS, onParamChange, {
  picking: () => ui.randomPick,
  eligible: (key) => !RANDOM_EXCLUDED.has(key),
  get: randomOn,
  set: setRandomOn,
  sectionEligible,
  resettable,
  randomize: (items, section) => randomizeItems(items, sectionEligible, {}, section),
  reset: resetItems,
  canReset: (items) => changedKeys(items).length > 0,
  undo: undoStep,
  canUndo,
});

$('random-btn').addEventListener('click', randomizeParams);
undoBtn.addEventListener('click', () => undoStep());

// Återställningen kräver två klick, så att inte en felklickning slår ut alla inställningar.
const resetBtn = $('reset-btn');
let resetTimer = 0;
function armReset(armed) {
  clearTimeout(resetTimer);
  resetBtn.classList.toggle('is-armed', armed);
  resetBtn.textContent = armed ? 'Säker?' : '✕';
  if (armed) resetTimer = setTimeout(() => armReset(false), 3000);
}
resetBtn.addEventListener('click', () => {
  if (!resetBtn.classList.contains('is-armed')) {
    armReset(true);
    return;
  }
  armReset(false);
  // Antal bildrutor och upplösning behålls, annars måste volymen byggas om.
  // Återställningen går att ångra med ↶, precis som en slumpning.
  formUndo.forget();
  hologramUndo.forget();
  resetItems(Object.keys(DEFAULTS).map((key) => ({ key })));
});
volume.setDepth(params.depth);
applyMute();
updateVolumeInfo();
ensureBackground();
updateDepthInfo();
updateJumpInfo();
fitCamera();

// En länk med #k=<kod> öppnar delade inställningar direkt.
const sharedCode = location.hash.slice(1).replace(/^k=/, '');
if (sharedCode) {
  const shared = decodeSettings(sharedCode);
  if (shared) applyValues(shared);
}

// ?src=url laddar en video direkt (bra för test och länkar).
const srcParam = new URLSearchParams(location.search).get('src');
if (srcParam) {
  state.muted = true;
  applyMute();
  openSource(srcParam, srcParam.split('/').pop());
}

if (import.meta.env.DEV) {
  window.__n4tn = { params, state, camera, controls, volume, particles, video, renderer, fitCamera, openSource, exportVideo, applyValues };
  // Testdjup utan modell: ljusstyrkan får låtsas vara närhet, så att reliefen
  // går att se och provköra även utan nätåtkomst till modellen.
  window.__n4tn.testDepth = () => {
    const image = volume.uniforms.uVolume.value.image;
    const out = new Uint8Array(image.width * image.height * image.depth);
    for (let i = 0; i < out.length; i++) {
      const o = i * 4;
      out[i] = Math.min(255, Math.round(
        0.2126 * image.data[o] + 0.7152 * image.data[o + 1] + 0.0722 * image.data[o + 2]));
    }
    volume.setDepthMap(depthTexture(out, image.width, image.height, image.depth));
    state.depthReady = true;
    state.depthKeyframes = image.depth;
    syncPanel();
  };
}
