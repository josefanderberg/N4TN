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

    const box = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.Mesh(box, this.material);
    this.mesh.frustumCulled = false;
    this.edges = boxOutline(box, 0.3);
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
    this.slices[0].update(planeCoords(p.xPosEffective - 0.5, p.xCount));
    this.slices[1].update(planeCoords(p.yPosEffective - 0.5, p.yCount));
    this.slices[2].update(
      planeCoords((0.5 - p.timePosEffective) * dir, p.timeOn ? p.timeCount : 0),
    );

    this.edges.visible = p.lines > 0;
    for (const lines of [this.edges, ...this.slices.map((s) => s.lines)]) {
      lines.material.opacity = p.lines;
      if (p.lines <= 0) lines.visible = false;
    }
  }
}
