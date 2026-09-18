// Volymrendering av en video som en "tidskub".
// Objektrymd: enhetskub [-0.5, 0.5]^3. x/y = bildens plan, z = tid.

export const vertexShader = /* glsl */ `
uniform vec3 uCamPos;
out vec3 vOrigin;
out vec3 vDirection;

void main() {
  vOrigin = uCamPos;
  vDirection = position - uCamPos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 outColor;

uniform sampler3D uVolume;
uniform sampler2D uVideo;
uniform float uHasVideo;
uniform vec3 uScale;
uniform float uSteps;
uniform float uFilled;
uniform float uTimeDir;

// 0 = bild, 1 = rörelse
uniform int uContent;
uniform float uFrameStep;
uniform float uMotionGain;
// 0 = genomskinlig (medelvärde), 1 = adderande, 2 = maxljus
uniform int uBlend;
uniform float uDensity;
uniform float uAutoGain;
uniform float uLumWeight;
uniform float uShellFront;
uniform float uShellBack;
uniform float uShellSide;
uniform float uBrightness;
uniform float uSaturation;
uniform float uGlass;
uniform float uEdgeGlow;

// Varje riktning har ett snitt vid sin position plus fler med jämnt mellanrum 1 / antal.
uniform float uTimeCount;
uniform float uTimePos;
uniform float uTimeOpacity;
uniform float uTimeRestOpacity;
uniform float uTimeFull;
uniform float uTimeCurve;
uniform float uSharpTol;
uniform float uWave;
uniform float uWaveWidth;
uniform float uEdgeFade;
uniform float uSliceWave;
uniform float uSliceWaveWidth;
uniform float uTilt;
// Snittens egen bredd i världsmått: vid vridning är lådan smalare än snitten
// är breda, så bredden kan inte läsas ur uScale.x.
uniform float uSliceW;
uniform float uXCount;
uniform float uXPos;
uniform float uYCount;
uniform float uXOpacity;
uniform float uYPos;
uniform float uYOpacity;

#define MAX_STEPS 640
#define MAX_SLICES_PER_STEP 12

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Tid (0..1) för en punkt; framsidan (z = +0.5) är start som standard.
float timeAt(vec3 p) { return 0.5 - uTimeDir * p.z; }

vec3 volumeAt(vec3 p, float offset) {
  return texture(uVolume, vec3(p.x + 0.5, 0.5 - p.y, timeAt(p) + offset)).rgb;
}

// I läget Rörelse visas skillnaden mot nästa bildruta, så stillastående bakgrund
// blir svart och bara det som rör sig syns inne i lådan.
vec3 sampleVol(vec3 p) {
  vec3 c = volumeAt(p, 0.0);
  if (uContent == 1) return abs(volumeAt(p, uFrameStep) - c) * uMotionGain;
  return c;
}

float filledAt(vec3 p) { return step(timeAt(p), uFilled); }

// Klippets början och slut kan tonas in och ut mot lådans fram- och bakkant.
float edgeAtTime(float t) {
  if (uEdgeFade <= 0.001) return 1.0;
  return smoothstep(0.0, uEdgeFade, t) * smoothstep(0.0, uEdgeFade, 1.0 - t);
}

float edgeAt(vec3 p) { return edgeAtTime(timeAt(p)); }

// Egen våg för djupsnitten, skild från vågen som gäller volymen och ytorna.
float sliceWaveAt(float sliceTime) {
  if (uSliceWave <= 0.001) return 1.0;
  float d = (sliceTime - uTimePos) / max(uSliceWaveWidth, 0.001);
  return max(0.0, mix(1.0, exp(-d * d * 4.0), uSliceWave));
}

// Bildrutor nära den som spelas upp syns starkast och tonar ut åt båda håll.
// Vågens längd är andelen av klippet som fortfarande syns tydligt.
// Styrka över 1 drar ner även de närmaste grannarna och skär bort resten helt,
// så att bara ett smalt fönster kring den spelande bildrutan blir kvar.
float waveAt(vec3 p) {
  if (uWave <= 0.001) return 1.0;
  float d = (timeAt(p) - uTimePos) / max(uWaveWidth, 0.001);
  return max(0.0, mix(1.0, exp(-d * d * 4.0), uWave));
}

vec3 grade(vec3 c) {
  c = mix(vec3(luma(c)), c, uSaturation);
  return c * uBrightness;
}

vec2 hitBox(vec3 o, vec3 d) {
  vec3 inv = 1.0 / d;
  vec3 t0 = (vec3(-0.5) - o) * inv;
  vec3 t1 = (vec3(0.5) - o) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

vec3 faceNormal(vec3 p) {
  vec3 a = abs(p);
  if (a.x >= a.y && a.x >= a.z) return vec3(sign(p.x), 0.0, 0.0);
  if (a.y >= a.z) return vec3(0.0, sign(p.y), 0.0);
  return vec3(0.0, 0.0, sign(p.z));
}

// Avstånd (i världsenheter) från en punkt på en sida till sidans närmaste kant.
float edgeDist(vec3 p, vec3 n) {
  vec3 q = (0.5 - abs(p)) * uScale + abs(n) * 1e3;
  return min(q.x, min(q.y, q.z));
}

vec3 spectrum(float x) {
  return 0.5 + 0.5 * cos(6.28318 * (x + vec3(0.0, 0.33, 0.67)));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void over(inout vec3 col, inout float acc, vec3 c, float a) {
  col += (1.0 - acc) * a * c;
  acc += (1.0 - acc) * a;
}

// Ytorna syns starkt i sned vinkel och nästan inte alls rakt framifrån, som glas.
float grazing(float fres) { return 0.12 + 0.88 * pow(fres, 1.5); }

// Tidssnitten ligger på uTimePos + k / uTimeCount. uTimeFull toppar med full
// styrka ligger jämnt fördelade över stacken: en vid uppspelningen (k = 0) och
// sedan var n:te snitt åt båda håll. Topparna har uTimeOpacity, dalarna
// däremellan bottnar på uTimeRestOpacity, och bågen mellan de två nivåerna
// formas av uTimeCurve. Räknas på snittets nummer, så att den håller även när
// snitten är vridna och en punkt inte längre har en enda tid.
float sliceAlpha(float sliceIndex) {
  float phase = sliceIndex * uTimeFull / max(uTimeCount, 1.0);
  float toNearest = abs(phase - floor(phase + 0.5));
  float arc = pow(0.5 + 0.5 * cos(6.2831853 * toNearest), uTimeCurve);
  return mix(uTimeRestOpacity, uTimeOpacity, arc);
}

// Första snittplanet som strålen korsar i [tA, tB), annars -1.
// Planen ligger på t = A + k * B för heltal k, så det räcker med att avrunda uppåt.
float nextSlice(float tA, float tB, float A, float B) {
  if (B <= 0.0) return -1.0;
  float t = A + ceil((tA - A) / B) * B;
  return t < tB ? t : -1.0;
}

void main() {
  vec3 rd = normalize(vDirection);
  vec2 b = hitBox(vOrigin, rd);
  if (b.x > b.y) discard;
  bool outside = b.x > 0.0;
  b.x = max(b.x, 0.0);

  vec3 rdW = normalize(rd * uScale);
  float worldPerUnit = length(rd * uScale);

  vec3 pIn = vOrigin + rd * b.x;
  vec3 pOut = vOrigin + rd * b.y;
  vec3 nIn = faceNormal(pIn);
  vec3 nOut = faceNormal(pOut);

  vec3 col = vec3(0.0);
  float acc = 0.0;
  vec3 glass = vec3(0.0);
  vec3 extra = vec3(0.0);

  // Framsidans glasyta: fresnel-reflex, lätt regnbågsskimmer och kantglöd.
  float fresIn = 1.0 - abs(dot(nIn, rdW));
  if (outside) {
    float f = fresIn * fresIn * fresIn * fresIn;
    vec3 tint = vec3(0.78, 0.9, 1.0) * 0.35 + spectrum(fresIn * 1.3 + dot(pIn, vec3(0.6, 0.9, 0.4))) * 0.12;
    glass += tint * f * uGlass;
    glass += vec3(0.85, 0.95, 1.0) * exp(-edgeDist(pIn, nIn) * 28.0) * uEdgeGlow * 0.5;
    // De fyra sidoväggarna har ett eget reglage; fram och bak behåller sina.
    float shellIn = abs(nIn.z) > 0.5 ? uShellFront : uShellSide;
    over(col, acc, grade(sampleVol(pIn)),
      shellIn * grazing(fresIn) * filledAt(pIn) * waveAt(pIn) * edgeAt(pIn));
  }

  // Djupsnitten kan vara vridna kring höjdaxeln. Planen definieras av sin
  // lutade normal i världsrymd, men skär tidsaxeln på samma ställen som förut,
  // så att ordningen och tiderna är oförändrade.
  vec3 tiltN = vec3(sin(uTilt), 0.0, cos(uTilt));
  vec3 tiltR = vec3(cos(uTilt), 0.0, -sin(uTilt));
  float cZero = tiltN.z * ((0.5 - uTimePos) * uTimeDir) * uScale.z;
  float cStep = tiltN.z * uScale.z / max(uTimeCount, 1.0);

  float aT = 0.0, bT = 0.0, aX = 0.0, bX = 0.0, aY = 0.0, bY = 0.0;
  float denomT = dot(tiltN, rd * uScale);
  if (uTimeCount > 0.5 && abs(denomT) > 1e-5 && abs(cStep) > 1e-6) {
    aT = (cZero - dot(tiltN, vOrigin * uScale)) / denomT;
    bT = abs(cStep / denomT);
  }
  if (uXCount > 0.5 && abs(rd.x) > 1e-5) {
    aX = ((uXPos - 0.5) - vOrigin.x) / rd.x;
    bX = abs(1.0 / (uXCount * rd.x));
  }
  if (uYCount > 0.5 && abs(rd.y) > 1e-5) {
    aY = ((uYPos - 0.5) - vOrigin.y) / rd.y;
    bY = abs(1.0 / (uYCount * rd.y));
  }

  float dt = 1.0 / uSteps;
  float tPrev = b.x;
  float t = b.x + dt * hash12(gl_FragCoord.xy);

  for (int i = 0; i < MAX_STEPS; i++) {
    if (tPrev >= b.y || acc > 0.985) break;
    float tEnd = min(t, b.y);

    // Flera snitt kan hamna inom samma steg när de ligger tätt.
    float ts = tPrev;
    for (int n = 0; n < MAX_SLICES_PER_STEP; n++) {
      ts = nextSlice(ts, tEnd, aT, bT);
      if (ts < 0.0) break;
      vec3 p = vOrigin + rd * ts;
      float sliceIndex = (dot(tiltN, p * uScale) - cZero) / cStep;
      float sliceTime = uTimePos - uTimeDir * sliceIndex / max(uTimeCount, 1.0);
      // Snittet behåller sin fulla bredd vid vridning; lådan är i stället
      // avsmalnad så att snittet precis når från vägg till vägg.
      vec2 uv = vec2(dot(p * uScale, tiltR) / uSliceW + 0.5, p.y + 0.5);
      if (uv.x >= 0.0 && uv.x <= 1.0) {
        vec3 c = (uHasVideo > 0.5 && abs(sliceIndex) < 0.5)
          ? texture(uVideo, uv).rgb
          : texture(uVolume, vec3(uv.x, 1.0 - uv.y, sliceTime)).rgb;
        over(col, acc, grade(c), sliceAlpha(sliceIndex)
          * sliceWaveAt(sliceTime) * step(sliceTime, uFilled) * edgeAtTime(sliceTime));
      }
      ts += 1e-6;
    }
    ts = tPrev;
    for (int n = 0; n < MAX_SLICES_PER_STEP; n++) {
      ts = nextSlice(ts, tEnd, aX, bX);
      if (ts < 0.0) break;
      vec3 p = vOrigin + rd * ts;
      over(col, acc, grade(sampleVol(p)), uXOpacity * filledAt(p) * waveAt(p) * edgeAt(p));
      ts += 1e-6;
    }
    ts = tPrev;
    for (int n = 0; n < MAX_SLICES_PER_STEP; n++) {
      ts = nextSlice(ts, tEnd, aY, bY);
      if (ts < 0.0) break;
      vec3 p = vOrigin + rd * ts;
      over(col, acc, grade(sampleVol(p)), uYOpacity * filledAt(p) * waveAt(p) * edgeAt(p));
      ts += 1e-6;
    }

    if (t < b.y) {
      vec3 p = vOrigin + rd * t;
      if (timeAt(p) <= uFilled) {
        vec3 s = grade(sampleVol(p));
        float k = mix(1.0, 0.25 + 1.5 * luma(s), uLumWeight) * waveAt(p) * edgeAt(p);
        if (uBlend == 0) {
          over(col, acc, s, 1.0 - exp(-uDensity * k * dt * worldPerUnit));
        } else if (uBlend == 1) {
          // Allt längs strålen lyser ihop, så mitten fylls i stället för att bli ett medelvärde.
          // Automatisk exponering gäller bilden; i rörelseläget styr rörelsekänsligheten.
          float gain = uContent == 0 ? uAutoGain : 1.0;
          extra += (1.0 - acc) * s * k * uDensity * gain * dt * worldPerUnit;
        } else {
          // Det ljusaste längs strålen vinner, vilket lyfter fram innehållet i mitten.
          extra = max(extra, s * k * (1.0 - acc));
        }
      }
    }

    tPrev = tEnd;
    t += dt;
  }

  // Baksidan av lådan.
  if (acc < 0.985) {
    float fresOut = 1.0 - abs(dot(nOut, rdW));
    float shellOut = abs(nOut.z) > 0.5 ? uShellBack : uShellSide;
    over(col, acc, grade(sampleVol(pOut)),
      shellOut * grazing(fresOut) * filledAt(pOut) * waveAt(pOut) * edgeAt(pOut));
    glass += vec3(0.85, 0.95, 1.0) * exp(-edgeDist(pOut, nOut) * 28.0) * uEdgeGlow * 0.25 * (1.0 - acc);
  }

  // Adderande läge rullar av mjukt i toppen, annars bränns ljusa klipp ut till vitt.
  if (uBlend == 1) extra = 1.0 - exp(-extra);
  col += extra + glass;
  outColor = vec4(col, clamp(acc + luma(extra) + luma(glass), 0.0, 1.0));
}
`;
