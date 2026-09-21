import * as THREE from 'three';
import { vertexShader, formVertexShader, fragmentShader } from './shaders.js';

const _camLocal = new THREE.Vector3();
const _v = new THREE.Vector3();
const _box = new THREE.Box3();

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Fler linjer än så blir bara brus, då ritas inga snittkonturer alls.
const MAX_OUTLINES = 16;
const RECT = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/** Bilden böjs runt en axel så fort vinkeln är minst en grad. */
export const isBent = (p) => p.bend >= 1;

/** Tiden går inte jämnt längs formen: fram och tillbaka eller hopp. */
export const hasTimeWarp = (p) => p.warpAmount > 0 || p.jumpAmount > 0;

/** Bildrutorna flyttas eller snurrar längs en slumpad bana. */
export const hasPath = (p) => p.pathX > 0 || p.pathY > 0 || p.pathSpin > 0;

/** Allt som kräver den fria formen i stället för den raka lådan. */
export const hasForm = (p) =>
  isBent(p) || p.formRound > 0 || p.formTwist !== 0 || hasTimeWarp(p) || hasPath(p);

/** Hur tätt banan slingrar: mjukhet 0 ger ryckig, 1 ger lugn. */
export const pathFrequency = (soft) => 0.5 + 7.5 * (1 - soft) ** 2;

// Jämn slumpkurva, ungefär -1..1. Samma formel som wander() i shaders.js.
function wander(x, seed) {
  return 0.55 * Math.sin(x + seed * 1.7)
    + 0.3 * Math.sin(2.13 * x + seed * 3.1 + 1.3)
    + 0.15 * Math.sin(4.37 * x + seed * 5.3 + 2.9);
}


function lineMaterial(opacity) {
  return new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
}

function boxOutline(geometry, opacity) {
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), lineMaterial(opacity));
  lines.renderOrder = 2;
  lines.frustumCulled = false;
  return lines;
}

// Konturerna runt ett godtyckligt antal snittplan längs en axel.
class SliceOutlines {
  constructor(axis) {
    this.axis = axis;
    this.array = new Float32Array(MAX_OUTLINES * 8 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.array, 3));
    this.lines = new THREE.LineSegments(geometry, lineMaterial(0.3));
    this.lines.renderOrder = 2;
    this.lines.frustumCulled = false;
  }

  // De fyra hörnen för snittet vid `coord`. Tratten skalar hörnen med
  // tvärsnittet där de står, så sid- och höjdsnitten blir lutande fyrhörningar
  // som följer väggarna. Vridna ögonblick (bara djupled) blir parallellogram:
  // snittets breddaxel klippt mot lådans väggar och fram-/baksida, så konturen
  // följer exakt det som syns av snittet.
  cornersFor(coord, tilt, taper, fan) {
    const w = (z) => (taper ? taper.back + (z + 0.5) * (taper.front - taper.back) : 1);
    if (this.axis === 0 && fan) {
      // Bladet är ett plan genom solfjäderns axel (x = 0, z = fan.z0) vid
      // vinkeln coord, klippt mot väggarna och fram-/baksidan.
      const sphi = Math.sin(coord);
      const cphi = Math.cos(coord);
      const uMaxX = (0.5 * fan.sx) / Math.max(Math.abs(sphi), 1e-4);
      let uLo = -uMaxX;
      let uHi = uMaxX;
      if (Math.abs(cphi) > 1e-4) {
        const a = ((-0.5 - fan.z0) * fan.sz) / cphi;
        const b = ((0.5 - fan.z0) * fan.sz) / cphi;
        uLo = Math.max(uLo, Math.min(a, b));
        uHi = Math.min(uHi, Math.max(a, b));
      }
      if (uLo >= uHi) return RECT.map(() => [0, 0, fan.z0]);
      const at = (u, y) => [(u * sphi) / fan.sx, y, fan.z0 + (u * cphi) / fan.sz];
      return [at(uLo, -0.5), at(uHi, -0.5), at(uHi, 0.5), at(uLo, 0.5)];
    }
    if (this.axis === 0) return RECT.map((c) => [coord * w(c[0]), c[1] * w(c[0]), c[0]]);
    if (this.axis === 1) return RECT.map((c) => [c[0] * w(c[1]), coord * w(c[1]), c[1]]);
    // Tratten skalar snittets rektangel kring dess mitt på det djupet.
    const s = w(coord);
    if (!tilt) return RECT.map((c) => [c[0] * s, c[1] * s, coord]);
    // Snittets egna axlar: R i sidled (vridningen), U i höjdled (lutningen).
    // Spannen når väggar, golv och tak; fram- och baksidan klipper i z:
    // z(d, e) = coord + (−d·sa + e·ca·sb) / sz — först klipps d längs
    // mittlinjen, sedan e så att båda d-ändarna ryms.
    const { ca, sa, cb, sb, sx, sy, sz } = tilt;
    let dHi = ((0.5 * sx) / Math.max(Math.abs(ca), 0.05)) * s;
    let dLo = -dHi;
    let eHi = ((0.5 * sy) / Math.max(Math.abs(cb), 0.05)) * s;
    let eLo = -eHi;
    if (Math.abs(sa) > 1e-6) {
      const a = ((coord - 0.5) * sz) / sa;
      const b = ((coord + 0.5) * sz) / sa;
      dLo = Math.max(dLo, Math.min(a, b));
      dHi = Math.min(dHi, Math.max(a, b));
    }
    const zc = ca * sb;
    if (Math.abs(zc) > 1e-6 && dLo < dHi) {
      for (const d of [dLo, dHi]) {
        const a = ((-0.5 - coord) * sz + d * sa) / zc;
        const b = ((0.5 - coord) * sz + d * sa) / zc;
        eLo = Math.max(eLo, Math.min(a, b));
        eHi = Math.min(eHi, Math.max(a, b));
      }
    }
    // Helt utanför lådan: nollsegment, som inte ritar något.
    if (dLo >= dHi || eLo >= eHi) return RECT.map(() => [0, 0, coord]);
    const at = (d, e) => [
      (d * ca + e * sa * sb) / sx,
      (e * cb) / sy,
      coord + (-d * sa + e * ca * sb) / sz,
    ];
    return [at(dLo, eLo), at(dHi, eLo), at(dHi, eHi), at(dLo, eHi)];
  }

  update(coords, tilt = null, taper = null, fan = null) {
    const count = coords.length;
    this.lines.visible = count > 0 && count <= MAX_OUTLINES;
    if (!this.lines.visible) return;
    let offset = 0;
    for (const coord of coords) {
      const pts = this.cornersFor(coord, tilt, taper, fan);
      for (let e = 0; e < 4; e++) {
        this.array.set(pts[e], offset);
        this.array.set(pts[(e + 1) % 4], offset + 3);
        offset += 6;
      }
    }
    this.lines.geometry.setDrawRange(0, count * 8);
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}

// Lådans skal som en tratt: tvärsnittet i x/y skalas med w(z), så att fram-
// och baksidan kan ha olika storlek. Vid 1/1 är det den vanliga enhetskuben,
// och trådramen faller ut ur samma geometri via EdgesGeometry.
function frustumGeometry(front, back) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const w = back + (front - back) * (position.getZ(i) + 0.5);
    position.setX(i, position.getX(i) * w);
    position.setY(i, position.getY(i) * w);
  }
  return geometry;
}

// Alla snittplan längs en axel: ett vid `center`, resten jämnt fördelade med 1 / count.
function planeCoords(center, count) {
  const coords = [];
  if (count < 1) return coords;
  const spacing = 1 / count;
  const first = Math.ceil((-0.5 - center) / spacing);
  const last = Math.floor((0.5 - center) / spacing);
  for (let k = first; k <= last && coords.length <= MAX_OUTLINES; k++) {
    coords.push(center + k * spacing);
  }
  return coords;
}

// --- Fri form ----------------------------------------------------------------

function makeForm() {
  return {
    active: false,
    bent: false,
    halfW: 0.5,
    halfH: 0.5,
    depth: 1,
    dir: 1,
    bend: 0,
    round: 0,
    twist: 0,
    center: 0,
    pitch: 0,
    spin: 0,
    neg: false,
    closed: false,
    path: false,
    pathAmpX: 0,
    pathAmpY: 0,
    pathRoll: 0,
    pathFreq: 1,
    pathPhase: 0,
    seed: 0,
    taperFront: 1,
    taperBack: 1,
    axis: new THREE.Vector3(0, 1, 0),
    rad: new THREE.Vector3(1, 0, 0),
    tan: new THREE.Vector3(0, 0, -1),
    origin: new THREE.Vector3(),
  };
}

// En punkt i formen: (sx, sy) i bilden, -1..1, vid läget u längs formen, 0..1.
// Det här är shaderns frameAt() baklänges.
function formPoint(out, f, sx, sy, u, round = true) {
  let qx = sx;
  let qy = sy;
  if (round && f.round > 0) {
    const l2 = Math.hypot(sx, sy);
    if (l2 > 1e-9) {
      const k = (Math.max(Math.abs(sx), Math.abs(sy)) / l2) ** f.round;
      qx *= k;
      qy *= k;
    }
  }
  let ix = qx * f.halfW;
  let iy = qy * f.halfH;
  let roll = f.twist * (u - 0.5);
  let ox = 0;
  let oy = 0;
  if (f.path) {
    const x = TAU * f.pathFreq * u + f.pathPhase;
    ox = f.pathAmpX * wander(x, f.seed);
    oy = f.pathAmpY * wander(x, f.seed + 7.1);
    roll += f.pathRoll * wander(x, f.seed + 13.9);
  }
  if (roll) {
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    [ix, iy] = [c * ix - s * iy, s * ix + c * iy];
  }
  // Tratten: bildrutan skalas efter var längs formen den ligger, som i lådan.
  const w = f.taperBack + (f.taperFront - f.taperBack) * ((0.5 - u) * f.dir + 0.5);
  ix *= w;
  iy *= w;
  ix += ox;
  iy += oy;
  if (!f.bent) return out.set(ix, iy, (0.5 - u) * f.dir * f.depth);

  const xr = ix * f.rad.x + iy * f.rad.y;
  const xa = ix * f.axis.x + iy * f.axis.y;
  const turn = (u - 0.5) * f.bend * f.dir;
  const th = turn - f.spin;
  const rho = f.center + xr;
  const along = xa + (f.pitch * turn) / TAU;
  const c = Math.cos(th);
  const s = Math.sin(th);
  return out.set(
    f.origin.x + f.axis.x * along + (f.rad.x * c + f.tan.x * s) * rho,
    f.origin.y + f.axis.y * along + (f.rad.y * c + f.tan.y * s) * rho,
    f.origin.z + f.axis.z * along + (f.rad.z * c + f.tan.z * s) * rho,
  );
}

// Lådan som rymmer hela formen. Bildens hörn räcker: varje bildruta är plan och
// hörnen spänner upp den, också när den är rundad.
function formBounds(box, f) {
  box.makeEmpty();
  let steps = f.bent ? Math.ceil((f.bend / TAU) * 128) + 8 : 1;
  if (f.twist || f.path) steps = Math.max(steps, 256);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    for (const [sx, sy] of CORNERS) box.expandByPoint(formPoint(_v, f, sx, sy, u, false));
  }
  return box;
}

// Punkter runt bildens kant, med rundningen, i ordning.
const RING = 32;
const RING_POINTS = Array.from({ length: RING }, (_, i) => {
  const side = Math.floor(i / 8);
  const k = (i % 8) / 8;
  const [ax, ay] = CORNERS[side];
  const [bx, by] = CORNERS[(side + 1) % 4];
  return [ax + (bx - ax) * k, ay + (by - ay) * k];
});

// Formens konturer: ändarna, tidssnitten och fyra linjer längs formen.
class FormOutlines {
  constructor() {
    this.array = new Float32Array(12000 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.array, 3));
    this.lines = new THREE.LineSegments(geometry, lineMaterial(0.3));
    this.lines.renderOrder = 2;
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.count = 0;
  }

  push(point) {
    if (this.count * 3 + 3 > this.array.length) return;
    point.toArray(this.array, this.count * 3);
    this.count++;
  }

  segment(f, sa, ua, sb, ub) {
    this.push(formPoint(_v, f, sa[0], sa[1], ua));
    this.push(formPoint(_v, f, sb[0], sb[1], ub));
  }

  ring(f, u) {
    for (let i = 0; i < RING; i++) this.segment(f, RING_POINTS[i], u, RING_POINTS[(i + 1) % RING], u);
  }

  update(f, p) {
    this.count = 0;
    this.ring(f, 0);
    this.ring(f, 1);
    // Med hopp eller fram och tillbaka ligger en tid på flera ställen; då ritas inga snitt.
    if (p.timeOn && p.timeCount <= MAX_OUTLINES && !hasTimeWarp(p)) {
      const at = p.timeLoop ? p.timeAnchor : p.timePosEffective;
      for (const coord of planeCoords(at - 0.5, p.timeCount)) this.ring(f, coord + 0.5);
    }
    let steps = f.bent ? Math.ceil((f.bend / TAU) * 96) + 4 : 1;
    if (f.twist || f.path) steps = Math.max(steps, 160);
    for (const corner of CORNERS) {
      for (let i = 0; i < steps; i++) this.segment(f, corner, i / steps, corner, (i + 1) / steps);
    }
    this.lines.geometry.setDrawRange(0, this.count);
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}

// Lådan: en volymrenderad mesh plus trådram för lådan och snitten. När någon form
// är på tar en andra mesh över, som renderar den fria formen i stället.
export class VolumeBox {
  constructor() {
    this.group = new THREE.Group();
    this.box = new THREE.Group();
    this.group.add(this.box);
    this.aspect = 16 / 9;
    this.depth = 1.3;
    this.form = makeForm();

    this.uniforms = {
      uVolume: { value: null },
      uVideo: { value: null },
      uHasVideo: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uScale: { value: new THREE.Vector3(1, 1, 1) },
      uSteps: { value: 200 },
      uFilled: { value: 1 },
      uTimeDir: { value: 1 },
      uContent: { value: 0 },
      uFrameStep: { value: 1 / 144 },
      uMotionGain: { value: 8 },
      uMotionMist: { value: 0 },
      uBlend: { value: 0 },
      uDensity: { value: 0.7 },
      uAutoGain: { value: 1 },
      uLumWeight: { value: 0.35 },
      uShellFront: { value: 0.75 },
      uShellBack: { value: 0.6 },
      uShellLeft: { value: 0.75 },
      uShellRight: { value: 0.75 },
      uShellTop: { value: 0.75 },
      uShellBottom: { value: 0.75 },
      uSizeFront: { value: 1 },
      uSizeBack: { value: 1 },
      uBrightness: { value: 1.1 },
      uExpFloor: { value: 0 },
      uExpCeil: { value: 1 },
      uSaturation: { value: 0.9 },
      uBgTex: { value: null },
      uBgRemove: { value: 0 },
      uBgThreshold: { value: 0.15 },
      uTimeTint: { value: 0 },
      uDepthVol: { value: null },
      uDepthOn: { value: 0 },
      uRelief: { value: 0 },
      uGlass: { value: 1 },
      uEdgeGlow: { value: 0.6 },
      uMaterial: { value: 0 },
      uIso: { value: 0.3 },
      uSoft: { value: 1.5 },
      uGloss: { value: 1 },
      uClarity: { value: 0.6 },
      uTimeCount: { value: 1 },
      uTimeLoop: { value: 0 },
      uTimeAnchor: { value: 0 },
      uSeamBlend: { value: 0.08 },
      uTimePos: { value: 0 },
      uTimeOpacity: { value: 0.92 },
      uTimeRestOpacity: { value: 0.55 },
      uTimeFullOpacity: { value: 0.92 },
      uTimeGradient: { value: 0 },
      uTimeFull: { value: 1 },
      uTimeCurve: { value: 1 },
      uSharpTol: { value: 0.004 },
      uWave: { value: 0.7 },
      uWaveWidth: { value: 0.3 },
      uEdgeFade: { value: 0 },
      uSliceWave: { value: 0 },
      uSliceWaveWidth: { value: 0.3 },
      uTilt: { value: 0 },
      uTiltV: { value: 0 },
      uSliceW: { value: 1 },
      uSliceH: { value: 1 },
      uXCount: { value: 1 },
      uXFan: { value: 0 },
      uXFanCenter: { value: 0.5 },
      uXPos: { value: 0.5 },
      uXOpacity: { value: 0.3 },
      uYCount: { value: 0 },
      uYPos: { value: 0.5 },
      uYOpacity: { value: 0.3 },
      uPrism: { value: 0 },
      uPrismReach: { value: 0.5 },
      uPrismSpread: { value: 0.3 },
      uPrismView: { value: 0.5 },

      uCamRoot: { value: new THREE.Vector3() },
      uBoundsMin: { value: new THREE.Vector3(-0.5, -0.5, -0.5) },
      uBoundsMax: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uBend: { value: 0 },
      uDepthW: { value: 1 },
      uAxisPoint: { value: new THREE.Vector3() },
      uAxisDir: { value: new THREE.Vector3(0, 1, 0) },
      uRadDir: { value: new THREE.Vector3(1, 0, 0) },
      uTanDir: { value: new THREE.Vector3(0, 0, -1) },
      uCenter: { value: 0 },
      uPitch: { value: 0 },
      uRound: { value: 0 },
      uTwist: { value: 0 },
      uSpin: { value: 0 },
      uHalf: { value: new THREE.Vector2(0.5, 0.5) },
      uNeg: { value: 0 },
      uClosed: { value: 0 },
      uWarpAmp: { value: 0 },
      uWarpFreq: { value: 3 },
      uWarpVar: { value: 0 },
      uWarpPhase: { value: 0 },
      uJumpAmt: { value: 0 },
      uJumpCount: { value: 1 },
      uPathOn: { value: 0 },
      uPathAmp: { value: new THREE.Vector2() },
      uPathRoll: { value: 0 },
      uPathFreq: { value: 1 },
      uPathPhase: { value: 0 },
      uSeed: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    });
    this.formMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      vertexShader: formVertexShader,
      fragmentShader,
      defines: { FORM: '' },
      side: THREE.BackSide,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    });

    // En neutral 1×1×1-djupkarta, så att uDepthVol alltid har något bundet.
    this._dummyDepth = new THREE.Data3DTexture(new Uint8Array([128]), 1, 1, 1);
    this._dummyDepth.format = THREE.RedFormat;
    this._dummyDepth.type = THREE.UnsignedByteType;
    this._dummyDepth.unpackAlignment = 1;
    this._dummyDepth.needsUpdate = true;
    this.uniforms.uDepthVol.value = this._dummyDepth;
    this.hasBackground = false;

    this.taper = { front: 1, back: 1 };
    this.mesh = new THREE.Mesh(frustumGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.edges = boxOutline(this.mesh.geometry, 0.3);
    this.slices = [new SliceOutlines(0), new SliceOutlines(1), new SliceOutlines(2)];
    this.box.add(this.mesh, this.edges, ...this.slices.map((s) => s.lines));

    this.formMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.formMaterial);
    this.formMesh.frustumCulled = false;
    this.formMesh.visible = false;
    this.formLines = new FormOutlines();
    this.group.add(this.formMesh, this.formLines.lines);

    this._updateScale();
  }

  setVolume(texture) {
    const old = this.uniforms.uVolume.value;
    if (old && old !== texture) old.dispose();
    this.uniforms.uVolume.value = texture;
    // Bakgrunden och djupet hör till det gamla klippet och räknas om vid behov.
    this.setBackground(null);
    this.setDepthMap(null);
  }

  // Bakgrundsbilden (tidsmedianen) som borttagningen jämför mot.
  setBackground(texture) {
    const old = this.uniforms.uBgTex.value;
    if (old && old !== texture) old.dispose();
    this.uniforms.uBgTex.value = texture;
    this.hasBackground = !!texture;
  }

  // AI-djupkartan: enkanalig 3D-textur i samma upplösning som volymen.
  setDepthMap(texture) {
    const old = this.uniforms.uDepthVol.value;
    if (old && old !== texture && old !== this._dummyDepth) old.dispose();
    this.uniforms.uDepthVol.value = texture || this._dummyDepth;
    this.uniforms.uDepthOn.value = texture ? 1 : 0;
  }

  setVideo(texture) {
    this.uniforms.uVideo.value = texture;
    this.uniforms.uHasVideo.value = texture ? 1 : 0;
  }

  setFilled(fraction) {
    this.uniforms.uFilled.value = fraction >= 1 ? 1.01 : fraction;
  }

  // Mörka klipp behöver mer förstärkning än ljusa för att mitten ska fyllas lika mycket.
  setExposure(meanLuma) {
    this.uniforms.uAutoGain.value = THREE.MathUtils.clamp(0.3 / Math.max(meanLuma, 0.02), 0.25, 3);
  }

  // Hur nära uppspelningen ett tidssnitt måste ligga för att hämtas skarpt ur videon.
  setFrameCount(frames) {
    this.uniforms.uSharpTol.value = 0.5 / Math.max(1, frames);
    this.uniforms.uFrameStep.value = 1 / Math.max(1, frames);
  }

  setAspect(aspect) {
    this.aspect = aspect;
    this._updateScale();
  }

  setDepth(depth) {
    this.depth = depth;
    this._updateScale();
  }

  // Kortaste sidan av bildplanet är alltid 1 enhet.
  get size() {
    const a = this.aspect;
    return a >= 1
      ? new THREE.Vector3(a, 1, this.depth)
      : new THREE.Vector3(1, 1 / a, this.depth);
  }

  _updateScale() {
    const s = this.size;
    this.box.scale.copy(s);
    this.uniforms.uScale.value.copy(s);
  }

  // Skalet och ramen byggs om bara när storlekarna faktiskt ändras, inte varje bildruta.
  _setTaper(front, back) {
    if (front === this.taper.front && back === this.taper.back) return;
    this.taper = { front, back };
    this.uniforms.uSizeFront.value = front;
    this.uniforms.uSizeBack.value = back;
    const geometry = frustumGeometry(front, back);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.edges.geometry.dispose();
    this.edges.geometry = new THREE.EdgesGeometry(geometry);
  }

  // Anropas varje bildruta innan rendering.
  update(camera, p) {
    const u = this.uniforms;

    // Special: lådan behåller sin fulla bredd. Vridna ögonblick sträcker sig
    // från vägg till vägg och kapas av fram- och baksidan.
    const s = this.size;
    const cosT = Math.cos(p.tilt || 0);
    const sinT = Math.sin(p.tilt || 0);
    this.box.scale.copy(s);
    u.uScale.value.copy(s);
    u.uSliceW.value = s.x;
    u.uSliceH.value = s.y;

    u.uSteps.value = p.steps;
    u.uTimeDir.value = p.flipTime ? -1 : 1;
    u.uContent.value = p.content;
    u.uMotionGain.value = p.motionGain;
    u.uMotionMist.value = p.motionMist;
    u.uBlend.value = p.blend;
    u.uDensity.value = p.density;
    u.uLumWeight.value = p.lumWeight;
    u.uShellFront.value = p.shellFront;
    u.uShellBack.value = p.shellBack;
    u.uShellLeft.value = p.shellLeft;
    u.uShellRight.value = p.shellRight;
    u.uShellTop.value = p.shellTop;
    u.uShellBottom.value = p.shellBottom;
    // Tratten: bara förhållandet mellan fram och bak syns, så den större änden
    // normeras till lådans fulla storlek.
    const taperMax = Math.max(p.sizeFront, p.sizeBack);
    const taperFront = p.sizeFront / taperMax;
    const taperBack = p.sizeBack / taperMax;
    this._setTaper(taperFront, taperBack);
    u.uBrightness.value = p.brightness;
    u.uExpFloor.value = p.expFloor;
    u.uExpCeil.value = p.expCeil;
    u.uSaturation.value = p.saturation;
    u.uBgRemove.value = p.bgRemove && this.hasBackground ? 1 : 0;
    u.uBgThreshold.value = p.bgThreshold;
    u.uTimeTint.value = p.timeTint;
    u.uRelief.value = p.depthRelief;
    u.uGlass.value = p.glass;
    u.uEdgeGlow.value = p.edgeGlow;
    u.uMaterial.value = p.material;
    u.uIso.value = p.liquidLevel;
    u.uSoft.value = p.liquidSoft;
    u.uGloss.value = p.liquidGloss;
    u.uClarity.value = p.liquidClarity;
    u.uTimeCount.value = p.timeOn ? p.timeCount : 0;
    u.uTimeLoop.value = p.timeLoop ? 1 : 0;
    u.uTimeAnchor.value = p.timeAnchor;
    u.uSeamBlend.value = p.timeSeam;
    u.uTimePos.value = p.timePosEffective;
    u.uTimeOpacity.value = p.timeOpacity;
    u.uTimeRestOpacity.value = p.timeRestOpacity;
    u.uTimeFullOpacity.value = p.timeFullOpacity;
    u.uTimeGradient.value = p.timeGradient;
    u.uTimeFull.value = p.timeFull;
    u.uTimeCurve.value = p.timeCurve;
    u.uWave.value = p.wave;
    u.uWaveWidth.value = p.waveWidth;
    u.uEdgeFade.value = p.edgeFade;
    u.uSliceWave.value = p.sliceWave;
    u.uSliceWaveWidth.value = p.sliceWaveWidth;
    u.uTilt.value = p.tilt;
    u.uTiltV.value = p.tiltV;
    u.uXCount.value = p.xCount;
    u.uXFan.value = p.xFan ? 1 : 0;
    u.uXFanCenter.value = p.xFanCenter;
    u.uXPos.value = p.xPosEffective;
    u.uYCount.value = p.yCount;
    u.uXOpacity.value = p.xOpacity;
    u.uYPos.value = p.yPosEffective;
    u.uYOpacity.value = p.yOpacity;
    u.uPrism.value = p.prism;
    u.uPrismReach.value = p.prismReach;
    u.uPrismSpread.value = p.prismSpread;
    u.uPrismView.value = p.prismView;

    this.group.updateMatrixWorld();
    const f = this.configureForm(p);
    this.box.visible = !f.active;
    this.formMesh.visible = f.active;
    this.formLines.lines.visible = f.active && p.lines > 0;
    if (f.active) {
      this._updateForm(camera, p, f);
      this._styleLines(p);
      return;
    }

    _camLocal.copy(camera.position);
    this.box.worldToLocal(_camLocal);
    u.uCamPos.value.copy(_camLocal);

    const dir = p.flipTime ? -1 : 1;
    const taper = taperFront === taperBack && taperFront === 1
      ? null
      : { front: taperFront, back: taperBack };
    if (p.xFan && p.xCount > 0) {
      // Solfjäderns bladvinklar: hela varvet är ett halvt varv, eftersom
      // bladen går genom axeln och täcker båda sidor.
      const angles = [];
      for (let k = 0; k < Math.min(p.xCount, 16); k++) {
        angles.push(p.xPosEffective * Math.PI + (k * Math.PI) / p.xCount);
      }
      this.slices[0].update(angles, null, null, {
        sx: s.x,
        sz: s.z,
        z0: 0.5 - p.xFanCenter,
      });
    } else {
      this.slices[0].update(planeCoords(p.xPosEffective - 0.5, p.xCount), null, taper);
    }
    this.slices[1].update(planeCoords(p.yPosEffective - 0.5, p.yCount), null, taper);
    // Så mycket av snittets halva bredd som ryms i den avsmalnade lådan.
    // Snittets båda vinklar till konturerna: vridning i sidled och lutning i
    // höjdled. Spannen räknas där, fram till väggar, golv och tak.
    const tiltInfo = (p.tilt || p.tiltV) ? {
      ca: cosT,
      sa: sinT,
      cb: Math.cos(p.tiltV || 0),
      sb: Math.sin(p.tiltV || 0),
      sx: s.x,
      sy: s.y,
      sz: s.z,
    } : null;
    this.slices[2].update(
      planeCoords((0.5 - (p.timeLoop ? p.timeAnchor : p.timePosEffective)) * dir,
        p.timeOn ? p.timeCount : 0),
      tiltInfo,
      taper,
    );

    this._styleLines(p);
  }

  _styleLines(p) {
    this.edges.visible = p.lines > 0;
    for (const lines of [this.edges, ...this.slices.map((s) => s.lines), this.formLines.lines]) {
      lines.material.opacity = p.lines;
      if (p.lines <= 0) lines.visible = false;
    }
  }

  /** Räknar ut formen ur inställningarna. Axeln läggs så att formen i vila hamnar mitt i bild. */
  configureForm(p) {
    const f = this.form;
    const size = this.size;
    f.active = hasForm(p);
    f.bent = isBent(p);
    f.halfW = size.x / 2;
    f.halfH = size.y / 2;
    f.depth = size.z;
    f.dir = p.flipTime ? -1 : 1;
    f.bend = f.bent ? p.bend * DEG : 0;
    f.round = p.formRound;
    f.twist = p.formTwist * DEG;
    // Tratten under Volym gäller formen också: bara förhållandet fram/bak syns.
    const taperMax = Math.max(p.sizeFront, p.sizeBack);
    f.taperFront = p.sizeFront / taperMax;
    f.taperBack = p.sizeBack / taperMax;

    const a = p.bendAxis * DEG;
    f.axis.set(Math.sin(a), Math.cos(a), 0);
    f.rad.set(Math.cos(a), -Math.sin(a), 0);
    const radialHalf = Math.abs(f.rad.x) * f.halfW + Math.abs(f.rad.y) * f.halfH;
    const axialHalf = Math.abs(f.axis.x) * f.halfW + Math.abs(f.axis.y) * f.halfH;
    f.center = p.bendCenter * radialHalf;
    f.pitch = f.bent ? p.bendPitch * 2 * axialHalf : 0;

    f.path = hasPath(p);
    f.pathAmpX = p.pathX * f.halfW;
    f.pathAmpY = p.pathY * f.halfH;
    f.pathRoll = p.pathSpin * DEG;
    f.pathFreq = pathFrequency(p.pathSoft);
    f.pathPhase = p.pathPhase ?? 0;
    f.seed = p.seed;

    // Når bilden över axeln kan en punkt ligga på bildens andra sida om den.
    const turns = f.twist || f.pathRoll;
    const reach = (turns ? Math.hypot(f.halfW, f.halfH) : radialHalf)
      + (f.path ? Math.hypot(f.pathAmpX, f.pathAmpY) * 1.05 : 0);
    f.neg = f.center < reach;
    f.closed = f.bent && f.bend >= TAU - 1e-3 && f.pitch === 0;

    f.spin = 0;
    f.origin.set(0, 0, 0);
    if (f.bent) f.origin.copy(formBounds(_box, f).getCenter(_v)).negate();
    return f;
  }

  /** Var punkten (x, y, t) i volymen hamnar i rummet, med formen i vila. x, y och t går 0..1, y nedåt. */
  placeInVolume(out, x, y, t) {
    const f = this.form;
    const spin = f.spin;
    f.spin = 0;
    formPoint(out, f, 2 * x - 1, 1 - 2 * y, t);
    f.spin = spin;
    return out;
  }

  /**
   * Punkter som kameran ska rymma: lådans hörn, eller punkter runt formens kant.
   * Snurrar formen med tidssnittet ryms ändlägena också.
   */
  fitPoints(p) {
    const f = this.configureForm(p);
    const points = [];
    if (!f.active) {
      const half = this.size.multiplyScalar(0.5);
      for (let i = 0; i < 8; i++) {
        points.push(new THREE.Vector3(
          i & 1 ? half.x : -half.x,
          i & 2 ? half.y : -half.y,
          i & 4 ? half.z : -half.z,
        ));
      }
      return points;
    }
    const spins = f.bent && p.followSlice && !f.closed ? [0, -f.bend / 2, f.bend / 2] : [0];
    const steps = f.bent ? Math.ceil((f.bend / TAU) * 64) + 8 : f.twist || f.path ? 128 : 1;
    for (const spin of spins) {
      f.spin = spin;
      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j < RING; j += 2) {
          const [sx, sy] = RING_POINTS[j];
          points.push(formPoint(new THREE.Vector3(), f, sx, sy, i / steps));
        }
      }
    }
    f.spin = 0;
    return points;
  }

  _updateForm(camera, p, f) {
    const u = this.uniforms;
    // Följer formen tidssnittet snurrar den runt axeln så att bildrutan som spelas står still.
    // I loopläget står bildrutan som spelas still vid ankaret, så då står formen också still.
    const at = p.timeLoop ? p.timeAnchor : p.timePosEffective;
    f.spin = f.bent && p.followSlice ? (at - 0.5) * f.bend * f.dir : 0;

    formBounds(_box, f);
    _box.expandByScalar(_box.getSize(_v).length() * 0.01 + 0.01);
    u.uBoundsMin.value.copy(_box.min);
    u.uBoundsMax.value.copy(_box.max);
    _box.getCenter(this.formMesh.position);
    _box.getSize(this.formMesh.scale);

    u.uBend.value = f.bend;
    u.uDepthW.value = f.depth;
    u.uAxisPoint.value.copy(f.origin);
    u.uAxisDir.value.copy(f.axis);
    u.uRadDir.value.copy(f.rad);
    u.uTanDir.value.copy(f.tan);
    u.uCenter.value = f.center;
    u.uPitch.value = f.pitch;
    u.uRound.value = f.round;
    u.uTwist.value = f.twist;
    u.uSpin.value = f.spin;
    u.uHalf.value.set(f.halfW, f.halfH);
    u.uNeg.value = f.neg ? 1 : 0;
    u.uClosed.value = f.closed ? 1 : 0;

    u.uWarpAmp.value = p.warpAmount;
    u.uWarpFreq.value = p.warpRate;
    u.uWarpVar.value = p.warpVariation;
    u.uWarpPhase.value = p.warpPhase ?? 0;
    u.uJumpAmt.value = p.jumpAmount;
    u.uJumpCount.value = p.jumpPieces ?? 1;
    u.uPathOn.value = f.path ? 1 : 0;
    u.uPathAmp.value.set(f.pathAmpX, f.pathAmpY);
    u.uPathRoll.value = f.pathRoll;
    u.uPathFreq.value = f.pathFreq;
    u.uPathPhase.value = f.pathPhase;
    u.uSeed.value = f.seed;

    _camLocal.copy(camera.position);
    this.group.worldToLocal(_camLocal);
    u.uCamRoot.value.copy(_camLocal);

    this.formMesh.updateMatrixWorld();
    if (this.formLines.lines.visible) this.formLines.update(f, p);
  }
}
