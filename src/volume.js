import * as THREE from 'three';
import { vertexShader, fragmentShader } from './shaders.js';

const _camLocal = new THREE.Vector3();

// Fler linjer än så blir bara brus, då ritas inga snittkonturer alls.
const MAX_OUTLINES = 16;
const RECT = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];

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
  cornersFor(coord, tilt, taper) {
    const w = (z) => (taper ? taper.back + (z + 0.5) * (taper.front - taper.back) : 1);
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

  update(coords, tilt = null, taper = null) {
    const count = coords.length;
    this.lines.visible = count > 0 && count <= MAX_OUTLINES;
    if (!this.lines.visible) return;
    let offset = 0;
    for (const coord of coords) {
      const pts = this.cornersFor(coord, tilt, taper);
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

// Lådan: en volymrenderad mesh plus trådram för lådan och snitten.
export class VolumeBox {
  constructor() {
    this.group = new THREE.Group();
    this.aspect = 16 / 9;
    this.depth = 1.3;

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
      uShellLeft: { value: 0.75 },
      uShellRight: { value: 0.75 },
      uShellTop: { value: 0.75 },
      uShellBottom: { value: 0.75 },
      uSizeFront: { value: 1 },
      uSizeBack: { value: 1 },
      uBrightness: { value: 1.1 },
      uSaturation: { value: 0.9 },
      uGlass: { value: 1 },
      uEdgeGlow: { value: 0.6 },
      uTimeCount: { value: 1 },
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
      uXPos: { value: 0.5 },
      uXOpacity: { value: 0.3 },
      uYCount: { value: 0 },
      uYPos: { value: 0.5 },
      uYOpacity: { value: 0.3 },
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

    this.taper = { front: 1, back: 1 };
    this.mesh = new THREE.Mesh(frustumGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.edges = boxOutline(this.mesh.geometry, 0.3);
    this.slices = [new SliceOutlines(0), new SliceOutlines(1), new SliceOutlines(2)];
    this.group.add(this.mesh, this.edges, ...this.slices.map((s) => s.lines));

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
    this.group.scale.copy(s);
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
    this.group.scale.copy(s);
    u.uScale.value.copy(s);
    u.uSliceW.value = s.x;
    u.uSliceH.value = s.y;

    u.uSteps.value = p.steps;
    u.uTimeDir.value = p.flipTime ? -1 : 1;
    u.uContent.value = p.content;
    u.uMotionGain.value = p.motionGain;
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
    u.uSaturation.value = p.saturation;
    u.uGlass.value = p.glass;
    u.uEdgeGlow.value = p.edgeGlow;
    u.uTimeCount.value = p.timeOn ? p.timeCount : 0;
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
    u.uXPos.value = p.xPosEffective;
    u.uYCount.value = p.yCount;
    u.uXOpacity.value = p.xOpacity;
    u.uYPos.value = p.yPosEffective;
    u.uYOpacity.value = p.yOpacity;

    this.group.updateMatrixWorld();
    _camLocal.copy(camera.position);
    this.group.worldToLocal(_camLocal);
    u.uCamPos.value.copy(_camLocal);

    const dir = p.flipTime ? -1 : 1;
    const taper = taperFront === taperBack && taperFront === 1
      ? null
      : { front: taperFront, back: taperBack };
    this.slices[0].update(planeCoords(p.xPosEffective - 0.5, p.xCount), null, taper);
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
      planeCoords((0.5 - p.timePosEffective) * dir, p.timeOn ? p.timeCount : 0),
      tiltInfo,
      taper,
    );

    this.edges.visible = p.lines > 0;
    for (const lines of [this.edges, ...this.slices.map((s) => s.lines)]) {
      lines.material.opacity = p.lines;
      if (p.lines <= 0) lines.visible = false;
    }
  }
}
