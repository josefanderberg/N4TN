import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

// Tidskuben som partiklar: varje partikel hämtas ur en punkt i volymen och får
// dess färg och tid. Rörelsen simuleras på grafikkortet, en textur för lägen och
// en för hastigheter, och partiklarna hålls inne i en behållare.

const velocityShader = /* glsl */ `
uniform sampler2D tHome;
uniform float uDt;
uniform float uTime;
uniform float uGravity;
uniform float uBurst;
uniform float uHome;
uniform float uSwirl;
uniform float uDrag;
uniform float uBounce;
uniform vec3 uCenter;
uniform vec3 uMin;
uniform vec3 uMax;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 p = texture2D(texturePosition, uv).xyz;
  vec3 v = texture2D(textureVelocity, uv).xyz;
  vec3 home = texture2D(tHome, uv).xyz;

  // Utkastet: bort från mitten, med lite slump i riktning och fart.
  if (uBurst > 0.0) {
    vec3 jitter = vec3(hash(uv * 17.0), hash(uv * 29.0 + 3.1), hash(uv * 41.0 + 7.7)) - 0.5;
    vec3 away = normalize(p - uCenter + jitter * 0.8 + vec3(0.0, 1e-4, 0.0));
    v += away * uBurst * (0.4 + 1.2 * hash(uv * 53.0 + uTime));
  }

  v.y -= uGravity * uDt;
  v += (home - p) * uHome * uDt;

  // Virvel: ett mjukt, nästan källfritt flöde som får partiklarna att snurra runt.
  if (uSwirl > 0.0) {
    vec3 q = p * 1.3;
    float t = uTime * 0.4;
    vec3 flow = vec3(
      sin(q.y * 1.7 + t) + cos(q.z * 1.3 - t * 0.7),
      sin(q.z * 1.5 + t * 0.8) + cos(q.x * 1.1 + t),
      sin(q.x * 1.9 - t * 0.6) + cos(q.y * 1.4 + t * 0.5));
    v += flow * uSwirl * uDt;
  }

  v *= exp(-uDrag * uDt);

  // Studs mot behållarens väggar. På golvet bromsas partiklarna också i sidled.
  vec3 next = p + v * uDt;
  if (next.x < uMin.x && v.x < 0.0) v.x = -v.x * uBounce;
  if (next.x > uMax.x && v.x > 0.0) v.x = -v.x * uBounce;
  if (next.y > uMax.y && v.y > 0.0) v.y = -v.y * uBounce;
  if (next.z < uMin.z && v.z < 0.0) v.z = -v.z * uBounce;
  if (next.z > uMax.z && v.z > 0.0) v.z = -v.z * uBounce;
  if (next.y < uMin.y && v.y < 0.0) {
    v.y = -v.y * uBounce;
    v.xz *= exp(-6.0 * uDt);
    if (abs(v.y) < uGravity * uDt * 2.0) v.y = 0.0;
  }

  gl_FragColor = vec4(v, 1.0);
}
`;

const positionShader = /* glsl */ `
uniform float uDt;
uniform vec3 uMin;
uniform vec3 uMax;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 p = texture2D(texturePosition, uv).xyz;
  vec3 v = texture2D(textureVelocity, uv).xyz;
  gl_FragColor = vec4(clamp(p + v * uDt, uMin, uMax), 1.0);
}
`;

const pointsVertex = /* glsl */ `
uniform sampler2D tPosition;
uniform float uSize;
uniform float uPixels;
uniform float uTimePos;
uniform float uWave;
uniform float uWaveWidth;
uniform float uBrightness;
attribute vec2 ref;
attribute vec3 tint;
attribute float time;
varying vec3 vColor;

// Samma våg som i volymen: tider nära uppspelningen lyser starkast.
float waveAt(float t) {
  if (uWave <= 0.001) return 1.0;
  float d = (t - uTimePos) / max(uWaveWidth, 0.001);
  return max(0.0, mix(1.0, exp(-d * d * 4.0), uWave));
}

void main() {
  vec3 p = texture2D(tPosition, ref).xyz;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, uSize * uPixels / -mv.z);
  vColor = tint * uBrightness * (0.12 + 0.88 * min(waveAt(time), 1.0));
}
`;

const pointsFragment = /* glsl */ `
varying vec3 vColor;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(vColor * (1.0 - r * r), 1.0);
}
`;

function luma(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export class Particles {
  constructor(renderer) {
    this.renderer = renderer;
    this.side = 0;
    this.gpu = null;
    this.time = 0;
    this.burst = 0;
    this.dirty = true;
    this.fresh = true;
    this.center = new THREE.Vector3();
    this.min = new THREE.Vector3(-1, -1, -1);
    this.max = new THREE.Vector3(1, 1, 1);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tPosition: { value: null },
        uSize: { value: 0.012 },
        uPixels: { value: 500 },
        uTimePos: { value: 0 },
        uWave: { value: 0 },
        uWaveWidth: { value: 0.3 },
        uBrightness: { value: 1 },
      },
      vertexShader: pointsVertex,
      fragmentShader: pointsFragment,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;

    // Behållarens kanter.
    this.box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.box.visible = false;
    this.group = new THREE.Group();
    this.group.add(this.points, this.box);
  }

  // Simuleringen byggs om när antalet ändras. Sidan är texturens bredd, så
  // antalet partiklar är sidan i kvadrat.
  _setup(side) {
    this.gpu?.dispose();
    this.side = side;
    const gpu = new GPUComputationRenderer(side, side, this.renderer);
    if (!this.renderer.extensions.has('EXT_color_buffer_float')) gpu.setDataType(THREE.HalfFloatType);
    this.homeTexture?.dispose();
    this.homeTexture = new THREE.DataTexture(
      new Float32Array(side * side * 4), side, side, THREE.RGBAFormat, THREE.FloatType,
    );
    this.homeTexture.needsUpdate = true;

    this.velVar = gpu.addVariable('textureVelocity', velocityShader, gpu.createTexture());
    this.posVar = gpu.addVariable('texturePosition', positionShader, gpu.createTexture());
    gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);
    gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    Object.assign(this.velVar.material.uniforms, {
      tHome: { value: this.homeTexture },
      uDt: { value: 0 },
      uTime: { value: 0 },
      uGravity: { value: 0 },
      uBurst: { value: 0 },
      uHome: { value: 0 },
      uSwirl: { value: 0 },
      uDrag: { value: 0.4 },
      uBounce: { value: 0.5 },
      uCenter: { value: this.center },
      uMin: { value: this.min },
      uMax: { value: this.max },
    });
    Object.assign(this.posVar.material.uniforms, {
      uDt: { value: 0 },
      uMin: { value: this.min },
      uMax: { value: this.max },
    });
    const error = gpu.init();
    if (error) throw new Error(error);
    this.gpu = gpu;

    const count = side * side;
    const ref = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      ref[i * 2] = ((i % side) + 0.5) / side;
      ref[i * 2 + 1] = (Math.floor(i / side) + 0.5) / side;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('ref', new THREE.BufferAttribute(ref, 2));
    geometry.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('time', new THREE.BufferAttribute(new Float32Array(count), 1));
    this.points.geometry.dispose();
    this.points.geometry = geometry;
    this.fresh = true;
  }

  /**
   * Hämtar partiklarna ur volymen. Punkter med mycket innehåll (ljus, eller
   * rörelse i läget Rörelse) väljs oftare. place(out, x, y, t) ger var en punkt
   * i volymen (0..1 åt alla håll, y nedåt) hamnar i rummet.
   */
  seed(texture, place, p) {
    const count = this.side * this.side;
    const { data, width: w, height: h, depth: d } = texture.image;
    const plane = w * h * 4;
    const tint = this.points.geometry.attributes.tint.array;
    const time = this.points.geometry.attributes.time.array;
    const samples = new Float32Array(count * 3);
    const motion = p.content === 1;
    let tries = 0;
    for (let i = 0; i < count;) {
      tries++;
      const x = Math.floor(Math.random() * w);
      const y = Math.floor(Math.random() * h);
      const z = Math.floor(Math.random() * d);
      const o = z * plane + (y * w + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      let weight = luma(r, g, b);
      if (motion) {
        const n = Math.min(d - 1, z + 1) * plane + (y * w + x) * 4;
        weight = Math.abs(luma(data[n], data[n + 1], data[n + 2]) - weight) * p.motionGain;
      }
      // Lite av allt kommer med, så att även stilla partier syns som ett svagt stoft.
      if (Math.random() > 0.03 + Math.min(1, weight * 1.5) && tries < count * 60) continue;
      const t = (z + Math.random()) / d;
      samples[i * 3] = (x + Math.random()) / w;
      samples[i * 3 + 1] = (y + Math.random()) / h;
      samples[i * 3 + 2] = t;
      tint[i * 3] = (r / 255) * 1.1;
      tint[i * 3 + 1] = (g / 255) * 1.1;
      tint[i * 3 + 2] = (b / 255) * 1.1;
      time[i] = t;
      i++;
    }
    this.samples = samples;
    this.points.geometry.attributes.tint.needsUpdate = true;
    this.points.geometry.attributes.time.needsUpdate = true;
    this.dirty = false;
    this.place(place);
  }

  /**
   * Räknar om var partiklarna hör hemma, t.ex. när formen ändras. De glider dit
   * av sig själva om Dras tillbaka är på.
   */
  place(place) {
    if (!this.samples) return;
    const home = this.homeTexture.image.data;
    const s = this.samples;
    const out = new THREE.Vector3();
    for (let i = 0; i < s.length / 3; i++) {
      place(out, s[i * 3], s[i * 3 + 1], s[i * 3 + 2]);
      out.toArray(home, i * 4);
      home[i * 4 + 3] = 1;
    }
    this.homeTexture.needsUpdate = true;
    this.moved = false;
    if (this.fresh) this.gather();
    this.fresh = false;
  }

  /** Lägger alla partiklar på sina platser i bilden igen, stilla. */
  gather() {
    if (!this.gpu) return;
    const velocity = this.gpu.createTexture();
    for (const target of this.posVar.renderTargets) this.gpu.renderTexture(this.homeTexture, target);
    for (const target of this.velVar.renderTargets) this.gpu.renderTexture(velocity, target);
    velocity.dispose();
  }

  /** Slungar ut partiklarna från mitten. */
  fling() {
    this.burst = 1;
  }

  /** Bygger simuleringen om antalet partiklar har ändrats. */
  ensure(p) {
    const side = Math.round(Math.sqrt(p.particleCount));
    if (side === this.side) return;
    this._setup(side);
    this.dirty = true;
  }

  update(dt, p, container, pixels) {
    this.min.copy(container.min);
    this.max.copy(container.max);
    container.getCenter(this.center);

    const step = Math.min(dt, 1 / 30);
    this.time += step;
    const v = this.velVar.material.uniforms;
    v.uDt.value = step;
    v.uTime.value = this.time;
    v.uGravity.value = p.gravity ? p.gravityStrength : 0;
    v.uBurst.value = this.burst * p.particleForce;
    v.uHome.value = p.particleHome;
    v.uSwirl.value = p.particleSwirl;
    v.uBounce.value = p.particleBounce;
    this.posVar.material.uniforms.uDt.value = step;
    this.gpu.compute();
    this.burst = 0;

    const m = this.material.uniforms;
    m.tPosition.value = this.gpu.getCurrentRenderTarget(this.posVar).texture;
    m.uSize.value = 0.012 * p.particleSize;
    m.uPixels.value = pixels;
    m.uTimePos.value = p.timePosEffective;
    m.uWave.value = p.wave;
    m.uWaveWidth.value = p.waveWidth;
    m.uBrightness.value = p.brightness;

    container.getSize(this.box.scale);
    this.box.position.copy(this.center);
  }
}
