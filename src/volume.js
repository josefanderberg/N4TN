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

  write(offset, coord, corner) {
    const a = this.array;
    if (this.axis === 0) a.set([coord, corner[1], corner[0]], offset);
    else if (this.axis === 1) a.set([corner[0], coord, corner[1]], offset);
    else a.set([corner[0], corner[1], coord], offset);
    return offset + 3;
  }

  update(coords) {
    const count = coords.length;
    this.lines.visible = count > 0 && count <= MAX_OUTLINES;
    if (!this.lines.visible) return;
    let offset = 0;
    for (const coord of coords) {
      for (let e = 0; e < 4; e++) {
        offset = this.write(offset, coord, RECT[e]);
        offset = this.write(offset, coord, RECT[(e + 1) % 4]);
      }
    }
    this.lines.geometry.setDrawRange(0, count * 8);
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
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
      for (const coord of planeCoords(p.timePosEffective - 0.5, p.timeCount)) this.ring(f, coord + 0.5);
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
      uBlend: { value: 0 },
      uDensity: { value: 0.7 },
      uAutoGain: { value: 1 },
      uLumWeight: { value: 0.35 },
      uShellFront: { value: 0.75 },
      uShellBack: { value: 0.6 },
      uBrightness: { value: 1.1 },
      uSaturation: { value: 0.9 },
      uGlass: { value: 1 },
      uEdgeGlow: { value: 0.6 },
      uTimeCount: { value: 1 },
      uTimePos: { value: 0 },
      uTimeOpacity: { value: 0.92 },
      uTimeFade: { value: 0.4 },
      uTimeFull: { value: 1 },
      uTimeCurve: { value: 1 },
      uSharpTol: { value: 0.004 },
      uWave: { value: 0.7 },
      uWaveWidth: { value: 0.3 },
      uEdgeFade: { value: 0 },
      uSliceWave: { value: 0 },
      uSliceWaveWidth: { value: 0.3 },
      uTilt: { value: 0 },
      uXCount: { value: 1 },
      uXPos: { value: 0.5 },
      uXOpacity: { value: 0.3 },
      uYCount: { value: 0 },
      uYPos: { value: 0.5 },
      uYOpacity: { value: 0.3 },

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

    const materialOptions = {
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      fragmentShader,
      side: THREE.BackSide,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    };
    this.material = new THREE.ShaderMaterial({ ...materialOptions, vertexShader });
    this.formMaterial = new THREE.ShaderMaterial({
      ...materialOptions,
      vertexShader: formVertexShader,
      defines: { FORM: '' },
    });

    const box = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.Mesh(box, this.material);
    this.mesh.frustumCulled = false;
    this.edges = boxOutline(box, 0.3);
    this.slices = [new SliceOutlines(0), new SliceOutlines(1), new SliceOutlines(2)];
    this.box.add(this.mesh, this.edges, ...this.slices.map((s) => s.lines));

    this.formMesh = new THREE.Mesh(box, this.formMaterial);
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

  // Anropas varje bildruta innan rendering.
  update(camera, p) {
    const u = this.uniforms;
    u.uSteps.value = p.steps;
    u.uTimeDir.value = p.flipTime ? -1 : 1;
    u.uContent.value = p.content;
    u.uMotionGain.value = p.motionGain;
    u.uBlend.value = p.blend;
    u.uDensity.value = p.density;
    u.uLumWeight.value = p.lumWeight;
    u.uShellFront.value = p.shellFront;
    u.uShellBack.value = p.shellBack;
    u.uBrightness.value = p.brightness;
    u.uSaturation.value = p.saturation;
    u.uGlass.value = p.glass;
    u.uEdgeGlow.value = p.edgeGlow;
    u.uTimeCount.value = p.timeOn ? p.timeCount : 0;
    u.uTimePos.value = p.timePosEffective;
    u.uTimeOpacity.value = p.timeOpacity;
    u.uTimeFade.value = p.timeFade;
    u.uTimeFull.value = p.timeFull;
    u.uTimeCurve.value = p.timeCurve;
    u.uWave.value = p.wave;
    u.uWaveWidth.value = p.waveWidth;
    u.uEdgeFade.value = p.edgeFade;
    u.uSliceWave.value = p.sliceWave;
    u.uSliceWaveWidth.value = p.sliceWaveWidth;
    u.uTilt.value = p.tilt;
    u.uXCount.value = p.xCount;
    u.uXPos.value = p.xPosEffective;
    u.uYCount.value = p.yCount;
    u.uXOpacity.value = p.xOpacity;
    u.uYPos.value = p.yPosEffective;
    u.uYOpacity.value = p.yOpacity;

    this.group.updateMatrixWorld();
    const f = this.configureForm(p);
    this.box.visible = !f.active;
    this.formMesh.visible = f.active;
    this.formLines.lines.visible = f.active && p.lines > 0;

    if (f.active) {
      this._updateForm(camera, p, f);
    } else {
      _camLocal.copy(camera.position);
      this.box.worldToLocal(_camLocal);
      u.uCamPos.value.copy(_camLocal);

      const dir = p.flipTime ? -1 : 1;
      this.slices[0].update(planeCoords(p.xPosEffective - 0.5, p.xCount));
      this.slices[1].update(planeCoords(p.yPosEffective - 0.5, p.yCount));
      this.slices[2].update(
        planeCoords((0.5 - p.timePosEffective) * dir, p.timeOn ? p.timeCount : 0),
      );
    }

    this.edges.visible = p.lines > 0;
    for (const lines of [this.edges, ...this.slices.map((s) => s.lines), this.formLines.lines]) {
      lines.material.opacity = p.lines;
      if (p.lines <= 0) lines.visible = false;
    }
  }

  _updateForm(camera, p, f) {
    const u = this.uniforms;
    // Följer formen tidssnittet snurrar den runt axeln så att bildrutan som spelas står still.
    f.spin = f.bent && p.followSlice ? (p.timePosEffective - 0.5) * f.bend * f.dir : 0;

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
