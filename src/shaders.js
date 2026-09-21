// Volymrendering av en video som en "tidskub".
// Den raka lådan renderas i objektrymden: enhetskub [-0.5, 0.5]^3, x/y = bildens
// plan, z = tid. Med FORM definierad renderas i stället en fri form: bildrutorna
// kan böjas runt en axel, rundas, vridas, slingra och gå fram och tillbaka i tiden.

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

// Formen renderas i gruppens oskalade koordinater, inom en låda som omsluter den.
export const formVertexShader = /* glsl */ `
uniform vec3 uCamRoot;
uniform vec3 uBoundsMin;
uniform vec3 uBoundsMax;
out vec3 vOrigin;
out vec3 vDirection;

void main() {
  vOrigin = uCamRoot;
  vDirection = mix(uBoundsMin, uBoundsMax, position + 0.5) - uCamRoot;
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
uniform float uBrightness;
uniform float uSaturation;
uniform float uGlass;
uniform float uEdgeGlow;

// Varje riktning har ett snitt vid sin position plus fler med jämnt mellanrum 1 / antal.
uniform float uTimeCount;
uniform float uTimePos;
uniform float uTimeOpacity;
uniform float uTimeFade;
uniform float uTimeFull;
uniform float uTimeCurve;
uniform float uSharpTol;
uniform float uWave;
uniform float uWaveWidth;
uniform float uEdgeFade;
uniform float uSliceWave;
uniform float uSliceWaveWidth;
uniform float uTilt;
uniform float uXCount;
uniform float uXPos;
uniform float uYCount;
uniform float uXOpacity;
uniform float uYPos;
uniform float uYOpacity;

// Formen. Allt i världsenheter, i gruppens egna koordinater.
uniform vec3 uBoundsMin;
uniform vec3 uBoundsMax;
// Vinkeln klippet täcker runt axeln, i radianer. 0 = rak.
uniform float uBend;
// Djupet när formen är rak.
uniform float uDepthW;
uniform vec3 uAxisPoint;
uniform vec3 uAxisDir;
// Bildens riktning bort från axeln, och tidens riktning, för bildrutan i mitten.
uniform vec3 uRadDir;
uniform vec3 uTanDir;
// Avstånd från axeln till bildens mitt.
uniform float uCenter;
// Hur långt formen stiger längs axeln per varv.
uniform float uPitch;
uniform float uRound;
uniform float uTwist;
// Hur mycket formen är vriden runt axeln när den följer tidssnittet.
uniform float uSpin;
uniform vec2 uHalf;
// 1 om bilden når över axeln, så att en punkt kan ligga på bildens andra sida.
uniform float uNeg;
// 1 om formen sluter sig till en hel ring, så att ändarna inte är ytor.
uniform float uClosed;
// Fram och tillbaka: tiden går växelvis framåt och bakåt längs formen.
uniform float uWarpAmp;
uniform float uWarpFreq;
uniform float uWarpVar;
uniform float uWarpPhase;
// Hopp i tiden: formen delas i bitar som var och en visar en bit ur klippet.
uniform float uJumpAmt;
uniform float uJumpCount;
// Banan: bildrutorna flyttas åt sidorna och upp och ner, och snurrar.
uniform float uPathOn;
uniform vec2 uPathAmp;
uniform float uPathRoll;
uniform float uPathFreq;
uniform float uPathPhase;
uniform float uSeed;

#define MAX_STEPS 640
#define MAX_SLICES_PER_STEP 12

const float PI = 3.14159265;
const float TAU = 6.28318531;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// I läget Rörelse visas skillnaden mot nästa bildruta, så stillastående bakgrund
// blir svart och bara det som rör sig syns inne i lådan.
vec3 sampleUVT(vec3 uvt) {
  vec3 c = texture(uVolume, uvt).rgb;
  if (uContent == 1) return abs(texture(uVolume, uvt + vec3(0.0, 0.0, uFrameStep)).rgb - c) * uMotionGain;
  return c;
}

// Klippets början och slut kan tonas in och ut mot lådans fram- och bakkant.
float edgeAtTime(float t) {
  if (uEdgeFade <= 0.001) return 1.0;
  return smoothstep(0.0, uEdgeFade, t) * smoothstep(0.0, uEdgeFade, 1.0 - t);
}

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
float waveAtTime(float t) {
  if (uWave <= 0.001) return 1.0;
  float d = (t - uTimePos) / max(uWaveWidth, 0.001);
  return max(0.0, mix(1.0, exp(-d * d * 4.0), uWave));
}

vec3 grade(vec3 c) {
  c = mix(vec3(luma(c)), c, uSaturation);
  return c * uBrightness;
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

// Tidssnitten ligger på uTimePos + k / uTimeCount. Snittet som spelas är k = 0 och
// har full styrka; varje steg därifrån dämpas med samma faktor.
// Snitten med full styrka ligger utspridda över hela stacken: ett vid
// uppspelningen och sedan var n:te snitt åt båda håll. Mellan dem sjunker en båge
// ner till uTimeFade och stiger upp igen mot nästa topp.
// uTimeFull toppar jämnt fördelade över stacken, alla lika starka, var och en
// med en båge före och efter sig. Räknas på snittets nummer, så att den håller
// även när snitten är vridna och en punkt inte längre har en enda tid.
float sliceFade(float sliceIndex) {
  if (uTimeFade <= 0.001) return 1.0;
  float phase = sliceIndex * uTimeFull / max(uTimeCount, 1.0);
  float toNearest = abs(phase - floor(phase + 0.5));
  float arc = pow(0.5 + 0.5 * cos(6.2831853 * toNearest), uTimeCurve);
  return 1.0 - uTimeFade * (1.0 - arc);
}

// Ett prov av röken, vägt mot det som redan ligger längs strålen enligt blandningsläget.
void smoke(vec3 s, float k, float len, inout vec3 col, inout float acc, inout vec3 extra) {
  if (uBlend == 0) {
    over(col, acc, s, 1.0 - exp(-uDensity * k * len));
  } else if (uBlend == 1) {
    // Allt längs strålen lyser ihop, så mitten fylls i stället för att bli ett medelvärde.
    // Automatisk exponering gäller bilden; i rörelseläget styr rörelsekänsligheten.
    float gain = uContent == 0 ? uAutoGain : 1.0;
    extra += (1.0 - acc) * s * k * uDensity * gain * len;
  } else {
    // Det ljusaste längs strålen vinner, vilket lyfter fram innehållet i mitten.
    extra = max(extra, s * k * (1.0 - acc));
  }
}

vec4 finish(vec3 col, float acc, vec3 extra, vec3 glass) {
  // Adderande läge rullar av mjukt i toppen, annars bränns ljusa klipp ut till vitt.
  if (uBlend == 1) extra = 1.0 - exp(-extra);
  col += extra + glass;
  return vec4(col, clamp(acc + luma(extra) + luma(glass), 0.0, 1.0));
}

vec3 glassTint(float fres, vec3 p) {
  return vec3(0.78, 0.9, 1.0) * 0.35 + spectrum(fres * 1.3 + dot(p, vec3(0.6, 0.9, 0.4))) * 0.12;
}

#ifndef FORM

// Tid (0..1) för en punkt; framsidan (z = +0.5) är start som standard.
float timeAt(vec3 p) { return 0.5 - uTimeDir * p.z; }

vec3 sampleVol(vec3 p) { return sampleUVT(vec3(p.x + 0.5, 0.5 - p.y, timeAt(p))); }

float filledAt(vec3 p) { return step(timeAt(p), uFilled); }

float edgeAt(vec3 p) { return edgeAtTime(timeAt(p)); }

float waveAt(vec3 p) { return waveAtTime(timeAt(p)); }

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
    glass += glassTint(fresIn, pIn) * f * uGlass;
    glass += vec3(0.85, 0.95, 1.0) * exp(-edgeDist(pIn, nIn) * 28.0) * uEdgeGlow * 0.5;
    over(col, acc, grade(sampleVol(pIn)),
      uShellFront * grazing(fresIn) * filledAt(pIn) * waveAt(pIn) * edgeAt(pIn));
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
      // Snittets bredd är densamma vid vridning; det är lådan som klipper det.
      vec2 uv = vec2(dot(p * uScale, tiltR) / uScale.x + 0.5, p.y + 0.5);
      if (uv.x >= 0.0 && uv.x <= 1.0) {
        vec3 c = (uHasVideo > 0.5 && abs(sliceIndex) < 0.5)
          ? texture(uVideo, uv).rgb
          : texture(uVolume, vec3(uv.x, 1.0 - uv.y, sliceTime)).rgb;
        over(col, acc, grade(c), uTimeOpacity * sliceFade(sliceIndex)
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
        smoke(s, k, dt * worldPerUnit, col, acc, extra);
      }
    }

    tPrev = tEnd;
    t += dt;
  }

  // Baksidan av lådan.
  if (acc < 0.985) {
    float fresOut = 1.0 - abs(dot(nOut, rdW));
    over(col, acc, grade(sampleVol(pOut)),
      uShellBack * grazing(fresOut) * filledAt(pOut) * waveAt(pOut) * edgeAt(pOut));
    glass += vec3(0.85, 0.95, 1.0) * exp(-edgeDist(pOut, nOut) * 28.0) * uEdgeGlow * 0.25 * (1.0 - acc);
  }

  outColor = finish(col, acc, extra, glass);
}

#else

// --- Fri form ---------------------------------------------------------------
//
// Bildrutan vid läget u (0..1 längs formen) är en plan rektangel. I en böjd form
// ligger den i ett halvplan genom axeln, vid vinkeln (u - 0.5) * uBend, och en
// punkt i rummet kan därför tillhöra flera bildrutor: en per varv, och när
// bilden når över axeln även en på andra sidan. De kallas grenar. Gren n är
// bildrutan vid vinkeln ang + n * PI, där ang är punktens vinkel runt axeln;
// udda n ligger på bildens andra sida om axeln.

#define MAX_BRANCHES 9

// Jämn slumpkurva, ungefär -1..1. Tre sinusar med skeva frekvenser, så att
// mönstret inte syns upprepa sig. Samma formel finns i volume.js.
float wander(float x, float seed) {
  return 0.55 * sin(x + seed * 1.7)
    + 0.30 * sin(2.13 * x + seed * 3.1 + 1.3)
    + 0.15 * sin(4.37 * x + seed * 5.3 + 2.9);
}

float hash11(float x) { return fract(sin(x * 91.3458 + 17.123) * 47453.5453); }

// Biten av formen som läget u hör till när tiden hoppar, annars 0.
float jumpSegment(float u) {
  if (uJumpAmt <= 0.0 || uJumpCount < 1.5) return 0.0;
  return min(floor(u * uJumpCount), uJumpCount - 1.0);
}

// Klippets tid vid läget u. Tiden kan hoppa: varje bit av formen visar en lika
// lång bit ur klippet, tagen någon annanstans ifrån. Med fram och tillbaka går
// den dessutom växelvis framåt och bakåt, och studsar vid klippets ändar.
float timeAtU(float u) {
  float t = u;
  if (uJumpAmt > 0.0 && uJumpCount > 1.5) {
    float seg = jumpSegment(u);
    float len = 1.0 / uJumpCount;
    float start = mix(seg * len, hash11(seg + uSeed * 17.0) * (1.0 - len), uJumpAmt);
    t = start + u - seg * len;
  }
  if (uWarpAmp > 0.0) {
    float x = TAU * uWarpFreq * u + uWarpPhase;
    t += uWarpAmp * mix(sin(x), wander(x, uSeed + 3.3) * 1.6, uWarpVar);
    t = 1.0 - abs(mod(t, 2.0) - 1.0);
  }
  return t;
}

struct Pt { vec3 p; float along; float r; float ang; };

Pt pointAt(vec3 p) {
  Pt P;
  P.p = p;
  vec3 d = p - uAxisPoint;
  P.along = dot(d, uAxisDir);
  vec2 c = vec2(dot(d, uRadDir), dot(d, uTanDir));
  P.r = length(c);
  P.ang = atan(c.y, c.x);
  return P;
}

// u = läget längs formen, t = klippets tid där, q = läget i bilden (-1..1) före
// rundningen och s = efter, alltså det som samplas. thW = bildrutans vinkel och
// seg biten av formen när tiden hoppar.
struct Frame { float u; float t; vec2 q; vec2 s; float thW; float roll; float seg; };

float wrapAngle(float a) { return a - TAU * floor((a + PI) / TAU); }

// Läget i bildrutan för gren n av punkten. ang är punktens vinkel, uppvecklad
// längs strålen så att samma n betyder samma gren från steg till steg.
bool frameAt(Pt P, float ang, float n, out Frame f) {
  vec2 img;
  if (uBend > 0.0) {
    f.thW = ang + n * PI;
    f.u = 0.5 + uTimeDir * (f.thW + uSpin) / uBend;
    float rho = mod(n, 2.0) < 0.5 ? P.r : -P.r;
    // Spiralen stiger med bildrutans egen vinkel, så att formen bara snurrar när den följer tidssnittet.
    img = (rho - uCenter) * uRadDir.xy + (P.along - uPitch * (f.thW + uSpin) / TAU) * uAxisDir.xy;
  } else {
    f.thW = 0.0;
    f.u = 0.5 - uTimeDir * P.p.z / uDepthW;
    img = P.p.xy;
  }
  f.roll = uTwist * (f.u - 0.5);
  if (uPathOn > 0.5) {
    float x = TAU * uPathFreq * f.u + uPathPhase;
    img -= uPathAmp * vec2(wander(x, uSeed), wander(x, uSeed + 7.1));
    f.roll += uPathRoll * wander(x, uSeed + 13.9);
  }
  float c = cos(f.roll);
  float s = sin(f.roll);
  f.q = vec2(c * img.x + s * img.y, c * img.y - s * img.x) / uHalf;
  f.s = f.q;
  if (uRound > 0.0) {
    float li = max(abs(f.q.x), abs(f.q.y));
    if (li > 1e-6) f.s *= pow(length(f.q) / li, uRound);
  }
  float u = clamp(f.u, 0.0, 1.0);
  f.t = timeAtU(u);
  f.seg = jumpSegment(u);
  return f.u >= 0.0 && f.u <= 1.0 && max(abs(f.s.x), abs(f.s.y)) <= 1.0;
}

vec3 uvtOf(Frame f) { return vec3(f.s.x * 0.5 + 0.5, 0.5 - f.s.y * 0.5, f.t); }

// Grenarna vars vinkel hamnar inom klippets spann för någon vinkel i [lo, hi].
vec2 branchRange(float lo, float hi) {
  if (uBend <= 0.0) return vec2(0.0);
  float h = 0.5 * uBend;
  return vec2(ceil((-h - uSpin - hi) / PI), floor((h - uSpin - lo) / PI));
}

bool skipBranch(float n) { return uNeg < 0.5 && mod(n, 2.0) > 0.5; }

bool insidePt(Pt P) {
  vec2 nr = branchRange(P.ang, P.ang);
  Frame f;
  for (int i = 0; i < MAX_BRANCHES; i++) {
    float n = nr.x + float(i);
    if (n > nr.y) break;
    if (skipBranch(n)) continue;
    if (frameAt(P, P.ang, n, f)) return true;
  }
  return false;
}

vec2 hitBounds(vec3 o, vec3 d) {
  vec3 inv = 1.0 / d;
  vec3 t0 = (uBoundsMin - o) * inv;
  vec3 t1 = (uBoundsMax - o) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

// Där strålen går in i eller ut ur formen mellan ta och tb. Returnerar en punkt
// strax innanför ytan.
float surfaceBetween(vec3 ro, vec3 rd, float ta, float tb, bool aInside) {
  for (int k = 0; k < 6; k++) {
    float tm = 0.5 * (ta + tb);
    if (insidePt(pointAt(ro + rd * tm)) == aInside) ta = tm;
    else tb = tm;
  }
  return aInside ? ta : tb;
}

// Ytans normal där strålen går in i eller ut ur formen, och avståndet till
// närmaste kant för kantglöden. Ytan är antingen en ände (första eller sista
// bildrutan) eller en sida (bildens kant, svept längs formen).
vec3 formNormal(Pt P, Frame f, out float edge) {
  vec3 e = uRadDir * cos(f.thW) + uTanDir * sin(f.thW);
  vec3 capN;
  float capDist;
  if (uBend > 0.0) {
    capN = uTanDir * cos(f.thW) - uRadDir * sin(f.thW);
    float rho = dot(P.p - uAxisPoint, e);
    capDist = uClosed > 0.5 ? 1e3 : min(f.u, 1.0 - f.u) * uBend * max(abs(rho), 0.05);
  } else {
    capN = vec3(0.0, 0.0, 1.0);
    capDist = min(f.u, 1.0 - f.u) * uDepthW;
  }
  vec2 s = f.s;
  float li = max(abs(s.x), abs(s.y));
  float sideDist = (1.0 - li) * min(uHalf.x, uHalf.y);
  bool onX = abs(s.x) >= abs(s.y);
  if (capDist < sideDist) {
    edge = sideDist;
    return capN;
  }
  vec2 nS = onX ? vec2(sign(s.x), 0.0) : vec2(0.0, sign(s.y));
  vec2 nQ = normalize(mix(nS, f.q / max(length(f.q), 1e-5), uRound));
  vec2 nImg = normalize(nQ / uHalf);
  float c = cos(f.roll);
  float sn = sin(f.roll);
  nImg = vec2(c * nImg.x - sn * nImg.y, sn * nImg.x + c * nImg.y);
  vec3 sideN = uBend > 0.0
    ? e * dot(nImg, uRadDir.xy) + uAxisDir * dot(nImg, uAxisDir.xy)
    : vec3(nImg, 0.0);
  // Rundade sidor har inga veck, så där finns ingen kant att glöda.
  float crease = (onX ? (1.0 - abs(s.y)) * uHalf.y : (1.0 - abs(s.x)) * uHalf.x)
    / max(1.0 - uRound, 1e-3);
  edge = min(capDist, crease);
  return normalize(sideN);
}

// Ytan av formen där strålen går in (fram) eller ut (bak).
void formShell(vec3 ro, vec3 rd, float tIn, bool entering,
    inout vec3 col, inout float acc, inout vec3 glass) {
  Pt P = pointAt(ro + rd * tIn);
  vec2 nr = branchRange(P.ang, P.ang);
  Frame f;
  bool found = false;
  for (int i = 0; i < MAX_BRANCHES; i++) {
    float n = nr.x + float(i);
    if (n > nr.y) break;
    if (skipBranch(n)) continue;
    if (frameAt(P, P.ang, n, f)) {
      found = true;
      break;
    }
  }
  if (!found) return;
  float edge;
  vec3 nrm = formNormal(P, f, edge);
  float fres = 1.0 - abs(dot(nrm, rd));
  float glow = exp(-edge * 28.0) * uEdgeGlow;
  if (entering) {
    glass += (1.0 - acc) * (glassTint(fres, P.p) * fres * fres * fres * fres * uGlass
      + vec3(0.85, 0.95, 1.0) * glow * 0.5);
  } else {
    glass += (1.0 - acc) * vec3(0.85, 0.95, 1.0) * glow * 0.25;
  }
  float a = (entering ? uShellFront : uShellBack) * grazing(fres)
    * step(f.t, uFilled) * waveAtTime(f.t) * edgeAtTime(f.t);
  over(col, acc, grade(sampleUVT(uvtOf(f))), a);
}

// Snittens nivåer längs en gren: 0 = tid, 1 = sidled, 2 = höjdled. Ett snitt
// ligger där nivån är ett heltal.
float sliceLevel(int family, Frame f) {
  if (family == 0) return (f.t - uTimePos) * uTimeCount;
  if (family == 1) return (f.s.x * 0.5 + 0.5 - uXPos) * uXCount;
  return (f.s.y * 0.5 + 0.5 - uYPos) * uYCount;
}

bool frameOnRay(vec3 ro, vec3 rd, float tr, Pt pRef, float angRef, float n, out Frame f) {
  Pt P = pointAt(ro + rd * tr);
  return frameAt(P, angRef + wrapAngle(P.ang - pRef.ang), n, f);
}

// Alla snitt som strålen passerar mellan ta och tb. Snitten är ytor där
// bildrutans tid eller läget i bilden är konstant; var de korsas hittas längs
// varje gren och finjusteras med några steg regula falsi.
void formSlices(vec3 ro, vec3 rd, float ta, Pt pa, float angA, float tb, Pt pb, float angB,
    inout vec3 col, inout float acc) {
  vec2 nr = branchRange(min(angA, angB), max(angA, angB));
  for (int i = 0; i < MAX_BRANCHES; i++) {
    float n = nr.x + float(i);
    if (n > nr.y) break;
    if (skipBranch(n)) continue;
    Frame fa;
    Frame fb;
    frameAt(pa, angA, n, fa);
    frameAt(pb, angB, n, fb);
    for (int family = 0; family < 3; family++) {
      float count = family == 0 ? uTimeCount : family == 1 ? uXCount : uYCount;
      if (count < 0.5) continue;
      // Tiden hoppar mellan bitarna; det är en skarv, inte ett snitt.
      if (family == 0 && fa.seg != fb.seg) continue;
      float ga = sliceLevel(family, fa);
      float gb = sliceLevel(family, fb);
      if (floor(ga) == floor(gb)) continue;
      float dir = gb > ga ? 1.0 : -1.0;
      float k = dir > 0.0 ? floor(ga) + 1.0 : floor(ga);
      for (int j = 0; j < MAX_SLICES_PER_STEP; j++) {
        if (dir > 0.0 ? k > gb : k <= gb) break;
        float lo = ta;
        float hi = tb;
        float glo = ga;
        float ghi = gb;
        float tr = mix(ta, tb, (k - ga) / (gb - ga));
        Frame f;
        for (int r = 0; r < 2; r++) {
          frameOnRay(ro, rd, tr, pa, angA, n, f);
          float g = sliceLevel(family, f);
          if ((g - k) * (glo - k) > 0.0) {
            lo = tr;
            glo = g;
          } else {
            hi = tr;
            ghi = g;
          }
          tr = mix(lo, hi, clamp((k - glo) / (ghi - glo), 0.0, 1.0));
        }
        if (frameOnRay(ro, rd, tr, pa, angA, n, f)) {
          if (family == 0) {
            float tk = uTimePos + k / uTimeCount;
            if (tk >= 0.0 && tk <= 1.0) {
              vec2 uv = f.s * 0.5 + 0.5;
              vec3 c = (uHasVideo > 0.5 && abs(k) < 0.5)
                ? texture(uVideo, uv).rgb
                : texture(uVolume, vec3(uv.x, 1.0 - uv.y, tk)).rgb;
              over(col, acc, grade(c), uTimeOpacity * sliceFade(k)
                * sliceWaveAt(tk) * step(tk, uFilled) * edgeAtTime(tk));
            }
          } else {
            float opacity = family == 1 ? uXOpacity : uYOpacity;
            over(col, acc, grade(sampleUVT(uvtOf(f))),
              opacity * step(f.t, uFilled) * waveAtTime(f.t) * edgeAtTime(f.t));
          }
        }
        k += dir;
      }
    }
  }
}

void main() {
  vec3 ro = vOrigin;
  vec3 rd = normalize(vDirection);
  vec2 b = hitBounds(ro, rd);
  if (b.x > b.y) discard;
  b.x = max(b.x, 0.0);

  vec3 col = vec3(0.0);
  float acc = 0.0;
  vec3 glass = vec3(0.0);
  vec3 extra = vec3(0.0);

  float dt = length(uBoundsMax - uBoundsMin) / uSteps;
  float tPrev = b.x;
  float t = b.x + dt * hash12(gl_FragCoord.xy);
  Pt pPrev = pointAt(ro + rd * tPrev);
  float angPrev = pPrev.ang;
  bool inPrev = insidePt(pPrev);
  bool slices = uTimeCount > 0.5 || uXCount > 0.5 || uYCount > 0.5;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (tPrev >= b.y || acc > 0.985) break;
    float tEnd = min(t, b.y);
    Pt pCur = pointAt(ro + rd * tEnd);
    float ang = angPrev + wrapAngle(pCur.ang - pPrev.ang);

    // Röken vid punkten, en gång per gren. Den läggs ihop för sig och vägs in
    // efter ytan och snitten, som ligger framför den i steget.
    vec3 sCol = vec3(0.0);
    float sAcc = 0.0;
    vec3 sExtra = vec3(0.0);
    bool inCur = false;
    vec2 nr = branchRange(pCur.ang, pCur.ang);
    for (int j = 0; j < MAX_BRANCHES; j++) {
      float n = nr.x + float(j);
      if (n > nr.y) break;
      if (skipBranch(n)) continue;
      Frame f;
      if (!frameAt(pCur, pCur.ang, n, f)) continue;
      inCur = true;
      if (f.t > uFilled) continue;
      vec3 s = grade(sampleUVT(uvtOf(f)));
      float k = mix(1.0, 0.25 + 1.5 * luma(s), uLumWeight) * waveAtTime(f.t) * edgeAtTime(f.t);
      smoke(s, k, dt, sCol, sAcc, sExtra);
    }

    if (inCur && !inPrev) {
      formShell(ro, rd, surfaceBetween(ro, rd, tPrev, tEnd, false), true, col, acc, glass);
    }
    if (slices) formSlices(ro, rd, tPrev, pPrev, angPrev, tEnd, pCur, ang, col, acc);

    if (uBlend == 1) extra += (1.0 - acc) * sExtra;
    else if (uBlend == 2) extra = max(extra, sExtra * (1.0 - acc));
    col += (1.0 - acc) * sCol;
    acc += (1.0 - acc) * sAcc;

    if (!inCur && inPrev) {
      formShell(ro, rd, surfaceBetween(ro, rd, tPrev, tEnd, true), false, col, acc, glass);
    }

    pPrev = pCur;
    angPrev = ang;
    inPrev = inCur;
    tPrev = tEnd;
    t += dt;
  }

  outColor = finish(col, acc, extra, glass);
}

#endif
`;
