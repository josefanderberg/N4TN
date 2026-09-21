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
// Självlysande dimma där det rör sig i klippet, oavsett innehållsläge.
uniform float uMotionMist;
// 0 = genomskinlig (medelvärde), 1 = adderande, 2 = maxljus
uniform int uBlend;
uniform float uDensity;
uniform float uAutoGain;
uniform float uLumWeight;
// Varje sida av lådan har sin egen ytstyrka.
uniform float uShellFront;
uniform float uShellBack;
uniform float uShellLeft;
uniform float uShellRight;
uniform float uShellTop;
uniform float uShellBottom;
// Tratten: fram- och baksidans storlek (normerade så att den större är 1).
// Tvärsnittet i x/y skalas med w(z) = mix(uSizeBack, uSizeFront, z + 0.5).
uniform float uSizeFront;
uniform float uSizeBack;
uniform float uBrightness;
// Exponeringsfönstret: botten kapar det mörka, taket det ljusa.
uniform float uExpFloor;
uniform float uExpCeil;
uniform float uSaturation;
uniform float uGlass;
uniform float uEdgeGlow;
// 0 = rök, 1 = vätska, 2 = krom, 3 = gelé
uniform int uMaterial;
uniform float uIso;
uniform float uSoft;
uniform float uGloss;
uniform float uClarity;
// Bakgrunden: tidsmedianen av klippet. Med borttagningen på jämförs varje
// punkt mot den, och det som står stilla släcks så att motivet svävar fritt.
uniform sampler2D uBgTex;
uniform float uBgRemove;
uniform float uBgThreshold;
// Färg efter tid: varje ögonblick tonas efter var i klippet det hör hemma.
uniform float uTimeTint;
// AI-djupet: skattad närhet per bildruta (1 = nära kameran). Reliefen buktar
// ögonblicken mot betraktaren där det är nära.
uniform sampler3D uDepthVol;
uniform float uDepthOn;
uniform float uRelief;

// Varje riktning har ett snitt vid sin position plus fler med jämnt mellanrum 1 / antal.
uniform float uTimeCount;
// Loopläget: klippet rullar cykliskt genom lådan medan snitten står still.
// uTimeAnchor är var i lådan den spelade bildrutan ligger (0 fram, 1 bak).
uniform float uTimeLoop;
uniform float uTimeAnchor;
// Hur stor del av klippet som blandas över skarven i loopläget.
uniform float uSeamBlend;
uniform float uTimePos;
uniform float uTimeOpacity;
uniform float uTimeRestOpacity;
uniform float uTimeFullOpacity;
// Trappsteget: hur mycket varje fullt ögonblick tappar i opacitet för varje
// steg bort från den spelade bildrutan. 0 = alla lika starka.
uniform float uTimeGradient;
uniform float uTimeFull;
uniform float uTimeCurve;
uniform float uSharpTol;
uniform float uWave;
uniform float uWaveWidth;
uniform float uEdgeFade;
uniform float uSliceWave;
uniform float uSliceWaveWidth;
uniform float uTilt;
// Höjdledslutningen: ögonblicken lutar fram och bak med kamerans elevation.
uniform float uTiltV;
// Snittens egen bredd i världsmått: vid vridning är lådan smalare än snitten
// är breda, så bredden kan inte läsas ur uScale.x.
uniform float uSliceW;
uniform float uSliceH;
uniform float uXCount;
// Solfjädern: sidosnitten går genom lådans mittaxel i stället för rakt igenom.
uniform float uXFan;
// Var i djupled solfjäderns axel står (0 fram, 0,5 mitten, 1 bak).
uniform float uXFanCenter;
uniform float uXPos;
uniform float uYCount;
uniform float uXOpacity;
uniform float uYPos;
uniform float uYOpacity;
// Prisma: ögonblickens bilder viker över på snitten i sidled och höjdled.
uniform float uPrism;
uniform float uPrismReach;
uniform float uPrismSpread;
uniform float uPrismView;

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

// Bildens skala på ett givet djup.
float taperAt(float z) { return mix(uSizeBack, uSizeFront, z + 0.5); }

// Från trattens rum till enhetskuben: bilden fyller varje tvärsnitt, så den
// växer och krymper med formen genom lådan.
vec3 unwarp(vec3 p) {
  float w = taperAt(p.z);
  return vec3(p.xy / w, p.z);
}

// Tid (0..1) för en punkt; framsidan (z = +0.5) är start som standard.
// I loopläget rullar tiden cykliskt: lådans plats mäts från ankaret och
// läggs på uppspelningen, så det som spelats förbi kommer in längst bak.
float timeAt(vec3 p) {
  float b = 0.5 - uTimeDir * p.z;
  if (uTimeLoop > 0.5) return fract(uTimePos + b - uTimeAnchor);
  return b;
}

// Avstånd i tid från uppspelningen; cykliskt i loopläget, så att vågen
// följer med runt skarven.
float timeDelta(float t) {
  float d = t - uTimePos;
  if (uTimeLoop > 0.5) d = fract(d + 0.5) - 0.5;
  return d;
}

vec3 volTex(vec2 xy, float t) {
  return textureLod(uVolume, vec3(xy, t), 0.0).rgb;
}

// Skarven i loopläget: där klippets slut möter dess början vandrar en brytning
// genom lådan. Nära skarven blandas andra sidan in (texturen klampar t utanför
// 0..1 till första/sista bildrutan), så flödet blir sömlöst.
vec3 volTexLoop(vec2 xy, float t) {
  if (uTimeLoop < 0.5 || uSeamBlend <= 0.001) return volTex(xy, t);
  float w = uSeamBlend;
  if (t < w) return mix(volTex(xy, t), volTex(xy, t + 1.0), 0.5 * (1.0 - t / w));
  if (t > 1.0 - w) return mix(volTex(xy, t), volTex(xy, t - 1.0), 0.5 * (1.0 - (1.0 - t) / w));
  return volTex(xy, t);
}

vec3 volumeAt(vec3 p, float offset) {
  vec3 u = unwarp(p);
  return volTexLoop(vec2(u.x + 0.5, 0.5 - u.y), timeAt(p) + offset);
}

// Andelen förgrund: hur mycket en punkt skiljer sig från bakgrundsbilden,
// som är tidsmedianen av hela klippet. Det som står stilla hamnar nära 0.
float fgMask(vec3 c, vec2 xy) {
  float d = distance(c, texture(uBgTex, xy).rgb);
  return smoothstep(uBgThreshold * 0.5, uBgThreshold, d);
}

// Senaste förgrundsandelen från sampleVol, så att även täckningen kan dämpas
// där bakgrunden togs bort (annars blir det svarta partiet ett mörkt dis).
float gFg = 1.0;

// I läget Rörelse visas skillnaden mot nästa bildruta, så stillastående bakgrund
// blir svart och bara det som rör sig syns inne i lådan.
vec3 sampleVol(vec3 p) {
  gFg = 1.0;
  vec3 u = unwarp(p);
  vec2 xy = vec2(u.x + 0.5, 0.5 - u.y);
  float t = timeAt(p);
  vec3 raw = volTexLoop(xy, t);
  vec3 c = raw;
  if (uBgRemove > 0.5 && uContent != 1) {
    gFg = fgMask(raw, xy);
    c *= gFg;
  }
  if (uContent == 0) return c;
  // Rörelsen räknas på råbilderna: bakgrunden tar ut sig själv i skillnaden.
  vec3 motion = abs(volTexLoop(xy, t + uFrameStep) - raw) * uMotionGain;
  // 2 = bild och rörelse ihop: bilden i botten, rörelsebanorna lyser ovanpå.
  return uContent == 1 ? motion : c + motion;
}

// I rena bildläget ska borttagen bakgrund även släppa igenom det bakom;
// i rörelselägena bär rörelsen täckningen och lämnas orörd.
float fgAlpha() { return uContent == 0 ? gFg : 1.0; }

float filledAt(vec3 p) { return step(timeAt(p), uFilled); }

// Klippets början och slut kan tonas in och ut mot lådans fram- och bakkant.
float edgeAtTime(float t) {
  if (uEdgeFade <= 0.001) return 1.0;
  return smoothstep(0.0, uEdgeFade, t) * smoothstep(0.0, uEdgeFade, 1.0 - t);
}

// Toningen ligger vid lådans fram- och bakkant. Utanför loopläget är det
// samma sak som klippets början och slut, men i loopläget möts klippets
// ändar inne i lådan (skarven) — en toning där skulle gräva ett vandrande
// mörkt band som Mjuka skarven aldrig kan ta bort.
float edgeAt(vec3 p) { return edgeAtTime(0.5 - uTimeDir * p.z); }

// Egen våg för djupsnitten, skild från vågen som gäller volymen och ytorna.
float sliceWaveAt(float sliceTime) {
  if (uSliceWave <= 0.001) return 1.0;
  float d = timeDelta(sliceTime) / max(uSliceWaveWidth, 0.001);
  return max(0.0, mix(1.0, exp(-d * d * 4.0), uSliceWave));
}

// Bildrutor nära den som spelas upp syns starkast och tonar ut åt båda håll.
// Vågens längd är andelen av klippet som fortfarande syns tydligt.
// Styrka över 1 drar ner även de närmaste grannarna och skär bort resten helt,
// så att bara ett smalt fönster kring den spelande bildrutan blir kvar.
float waveAtTime(float t) {
  if (uWave <= 0.001) return 1.0;
  float d = timeDelta(t) / max(uWaveWidth, 0.001);
  return max(0.0, mix(1.0, exp(-d * d * 4.0), uWave));
}

float waveAt(vec3 p) { return waveAtTime(timeAt(p)); }

// Exponeringsfönstret: allt under botten blir svart, allt över taket slår i
// taket, och spannet däremellan dras ut till full skala. Med botten 0 och
// tak 1 lämnas ljuset orört (även värden över 1 i rörelseläget).
// expAmount är hur mycket av fönstret som får verka: bildrutan som spelas och
// de fulla ögonblicken lämnas orörda (0), allt annat kläms fullt ut (1).
vec3 gradeExp(vec3 c, float expAmount) {
  if ((uExpFloor > 0.001 || uExpCeil < 0.999) && expAmount > 0.001) {
    vec3 w = clamp((c - uExpFloor) / max(uExpCeil - uExpFloor, 0.01), 0.0, 1.0);
    c = mix(c, w, expAmount);
  }
  c = mix(vec3(luma(c)), c, uSaturation);
  return c * uBrightness;
}

vec3 grade(vec3 c) { return gradeExp(c, 1.0); }

// Klipper strålen mot planet n·p = d; utsidan är där n·p > d.
void clipPlane(vec3 o, vec3 d, vec3 n, float dist, inout float t0, inout float t1) {
  float fo = dot(n, o) - dist;
  float fd = dot(n, d);
  if (abs(fd) < 1e-9) {
    if (fo > 0.0) t1 = -1e9;
    return;
  }
  float t = -fo / fd;
  if (fd > 0.0) t1 = min(t1, t);
  else t0 = max(t0, t);
}

// Tratten är fram- och baksidans plan plus fyra lutande sidoplan |x| och
// |y| = 0.5·w(z), i stället för det raka slab-paret för en låda.
vec2 hitBox(vec3 o, vec3 d) {
  float t0 = -1e9;
  float t1 = 1e9;
  float hm = 0.5 * (uSizeFront - uSizeBack);
  float hc = 0.25 * (uSizeFront + uSizeBack);
  clipPlane(o, d, vec3(0.0, 0.0, 1.0), 0.5, t0, t1);
  clipPlane(o, d, vec3(0.0, 0.0, -1.0), 0.5, t0, t1);
  clipPlane(o, d, vec3(1.0, 0.0, -hm), hc, t0, t1);
  clipPlane(o, d, vec3(-1.0, 0.0, -hm), hc, t0, t1);
  clipPlane(o, d, vec3(0.0, 1.0, -hm), hc, t0, t1);
  clipPlane(o, d, vec3(0.0, -1.0, -hm), hc, t0, t1);
  return vec2(t0, t1);
}

// Ytnormal och axelmask för en punkt på trattens yta. Sidorna lutar med
// trattens vinkel; masken säger vilken axel ytan hör till, för kantglöden
// och för valet av sidans egen ytstyrka.
void surfInfo(vec3 p, out vec3 n, out vec3 axisMask) {
  vec3 a = abs(unwarp(p));
  float hm = 0.5 * (uSizeFront - uSizeBack);
  if (a.x >= a.y && a.x >= a.z) {
    n = vec3(sign(p.x), 0.0, -hm);
    axisMask = vec3(1.0, 0.0, 0.0);
  } else if (a.y >= a.z) {
    n = vec3(0.0, sign(p.y), -hm);
    axisMask = vec3(0.0, 1.0, 0.0);
  } else {
    n = vec3(0.0, 0.0, sign(p.z));
    axisMask = vec3(0.0, 0.0, 1.0);
  }
  // Skalningen är olika per axel, så normalen följer med som n / uScale.
  n = normalize(n / uScale);
}

// Ytstyrkan för lådans fasta sidor: fram/bak är kortsidorna av tiden,
// vänster/höger och tak/botten är de utsmetade bildkanterna.
float shellFor(vec3 axisMask, vec3 p) {
  if (axisMask.z > 0.5) return p.z > 0.0 ? uShellFront : uShellBack;
  if (axisMask.x > 0.5) return p.x > 0.0 ? uShellRight : uShellLeft;
  return p.y > 0.0 ? uShellTop : uShellBottom;
}

// Avstånd (i världsenheter) från en punkt på en sida till sidans närmaste kant.
float edgeDist(vec3 p, vec3 axisMask) {
  float w = taperAt(p.z);
  vec3 q = (0.5 - abs(unwarp(p))) * uScale * vec3(w, w, 1.0) + axisMask * 1e3;
  return min(q.x, min(q.y, q.z));
}

vec3 spectrum(float x) {
  return 0.5 + 0.5 * cos(6.28318 * (x + vec3(0.0, 0.33, 0.67)));
}

// Färg efter tid: ögonblickets plats i klippet blir en färg ur spektrat,
// med bevarad ljushet så att svart förblir svart. I loopläget går skalan
// hela varvet runt, så att skarven inte byter färg; annars stannar den vid
// blått i stället för att sluta där den började.
vec3 tintByTime(vec3 c, float t) {
  if (uTimeTint <= 0.001) return c;
  vec3 hue = spectrum(uTimeLoop > 0.5 ? t : t * 0.72);
  return mix(c, luma(c) * 1.9 * hue, uTimeTint);
}

// Volymens färdiga färg i en punkt: innehåll, exponering och tidsfärg ihop.
vec3 shadeVol(vec3 p) {
  return tintByTime(grade(sampleVol(p)), timeAt(p));
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
// Hur fullt ett snitt är: 1 vid topparna (den spelade bildrutan och de fulla
// ögonblicken), 0 i dalarna emellan. Styr både opacitetsrampen och hur mycket
// exponeringsfönstret får klämma snittet.
float sliceArc(float sliceIndex) {
  float phase = sliceIndex * uTimeFull / max(uTimeCount, 1.0);
  float toNearest = abs(phase - floor(phase + 0.5));
  return pow(0.5 + 0.5 * cos(6.2831853 * toNearest), uTimeCurve);
}

float sliceAlpha(float sliceIndex) {
  float phase = sliceIndex * uTimeFull / max(uTimeCount, 1.0);
  float nearest = floor(phase + 0.5);
  float arc = sliceArc(sliceIndex);
  // Bildrutan som spelas är klarast. Övriga fulla ögonblick börjar på sin
  // egen nivå och tappar ett trappsteg för varje steg bort från den spelade
  // (0,9 → 0,8 → 0,7 …), så att det längst bort visas svagast. nearest är
  // vilket fullt ögonblick i ordningen punkten hör till.
  float rank = abs(nearest);
  float peak = rank < 0.5
    ? uTimeOpacity
    : max(uTimeFullOpacity - (rank - 1.0) * uTimeGradient, 0.0);
  return mix(uTimeRestOpacity, peak, arc);
}

// Första snittplanet som strålen korsar i [tA, tB), annars -1.
// Planen ligger på t = A + k * B för heltal k, så det räcker med att avrunda uppåt.
float nextSlice(float tA, float tB, float A, float B) {
  if (B <= 0.0) return -1.0;
  float t = A + ceil((tA - A) / B) * B;
  return t < tB ? t : -1.0;
}

// Samma sak för sid- och höjdsnitten, som följer tratten: i trattens rum ligger
// de vid A + k · B, och koordinaten ax / w(z) är monoton längs strålen, så det
// räcker att gå till närmaste plan i färdriktningen och lösa ut t ur planet
// ax = v · w(z), som är rakt fast lutande.
float nextWallSlice(float tA, float tB, float axO, float axD, float oz, float dz, float A, float B) {
  if (B <= 0.0) return -1.0;
  float qA = (axO + tA * axD) / taperAt(oz + tA * dz);
  float qB = (axO + tB * axD) / taperAt(oz + tB * dz);
  if (qA == qB) return -1.0;
  float v = qB > qA
    ? A + ceil((qA - A) / B) * B
    : A + floor((qA - A) / B) * B;
  float den = axD - v * (uSizeFront - uSizeBack) * dz;
  if (abs(den) < 1e-7) return -1.0;
  float t = (v * taperAt(oz) - axO) / den;
  return (t >= tA && t < tB) ? t : -1.0;
}

// Solfjäderns nästa blad längs strålen. Bladen är plan genom mittaxeln,
// jämnt spridda i vinkel (A + k·B), och vinkeln sedd från axeln är monoton
// längs en rak stråle, så det räcker att kliva mot nästa bladvinkel i
// färdriktningen och lösa ut t ur planet.
float fanNext(float tA, float tB, vec3 o, vec3 d, float A, float B) {
  if (B <= 0.0) return -1.0;
  float z0 = (0.5 - uXFanCenter) * uScale.z;
  float qA = atan((o.x + tA * d.x) * uScale.x, (o.z + tA * d.z) * uScale.z - z0);
  float qB = atan((o.x + tB * d.x) * uScale.x, (o.z + tB * d.z) * uScale.z - z0);
  float dq = qB - qA;
  if (dq > 3.14159265) dq -= 6.2831853;
  if (dq < -3.14159265) dq += 6.2831853;
  float v = dq > 0.0
    ? A + ceil((qA - A) / B) * B
    : A + floor((qA - A) / B) * B;
  if (abs(v - qA) > abs(dq)) return -1.0;
  float cv = cos(v);
  float sv = sin(v);
  float f0 = cv * o.x * uScale.x - sv * (o.z * uScale.z - z0);
  float fd = cv * d.x * uScale.x - sv * d.z * uScale.z;
  if (abs(fd) < 1e-7) return -1.0;
  float t = -f0 / fd;
  return (t >= tA && t < tB) ? t : -1.0;
}

// --- Gemensamt för lådan och formen -----------------------------------------

// Innehållet i en punkt given som (x, y, tid) i volymen; samma som sampleVol.
vec3 sampleUVT(vec3 uvt) {
  gFg = 1.0;
  vec3 raw = volTexLoop(uvt.xy, uvt.z);
  vec3 c = raw;
  if (uBgRemove > 0.5 && uContent != 1) {
    gFg = fgMask(raw, uvt.xy);
    c *= gFg;
  }
  if (uContent == 0) return c;
  vec3 motion = abs(volTexLoop(uvt.xy, uvt.z + uFrameStep) - raw) * uMotionGain;
  return uContent == 1 ? motion : c + motion;
}

// Bilden i djupsnittet k, som har tiden tk, vid uv (0..1, uppåt positivt).
// Snittet som spelas visas skarpt ur videon.
vec3 sliceImage(float k, float tk, vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
  if (uTimeLoop > 0.5) tk = fract(tk);
  else if (tk < 0.0 || tk > 1.0) return vec3(0.0);
  if (uHasVideo > 0.5 && abs(k) < 0.5) return texture(uVideo, uv).rgb;
  return volTexLoop(vec2(uv.x, 1.0 - uv.y), tk);
}

// Prisma: där ögonblicken möter ett sidosnitt viker deras bilder över på det,
// som om varje bildruta böjdes runt hörnet. Färgerna viker olika långt, som
// ljus genom ett prisma, och bilden glider när kameran rör sig, som i ett
// hologram. s är punktens läge räknat i ögonblick (heltal = på ett snitt) och
// tiden för snitt k är uTimePos + timeSign * k / antal. gap är avståndet mellan
// snitten och fold riktningen i bilden som viks över, båda i världsenheter.
vec3 prismColor(float s, float timeSign, float gap, vec2 uv, vec2 fold, vec2 imgSize, float view) {
  float k0 = floor(s);
  float k1 = k0 + 1.0;
  float d0 = (s - k0) * gap;
  float d1 = gap - d0;
  float reach = max(uPrismReach, 1e-3);
  float w0 = exp(-d0 / reach);
  float w1 = exp(-d1 / reach);
  float t0 = uTimePos + timeSign * k0 / uTimeCount;
  float t1 = uTimePos + timeSign * k1 / uTimeCount;
  float shift = view * uPrismView;
  vec3 c = vec3(0.0);
  for (int ch = 0; ch < 3; ch++) {
    float spread = 1.0 + (float(ch) - 1.0) * uPrismSpread;
    vec2 uv0 = uv + fold * (d0 * spread + shift) / imgSize;
    vec2 uv1 = uv - fold * (d1 * spread - shift) / imgSize;
    c[ch] = sliceImage(k0, t0, uv0)[ch] * w0 + sliceImage(k1, t1, uv1)[ch] * w1;
  }
  return c;
}

// Ett prov av röken, vägt mot det som redan ligger längs strålen enligt blandningsläget.
void smoke(vec3 s, float k, float len, inout vec3 col, inout float acc, inout vec3 extra) {
  if (uBlend == 0) {
    over(col, acc, s, 1.0 - exp(-uDensity * k * len));
  } else if (uBlend == 1) {
    float gain = uContent != 1 ? uAutoGain : 1.0;
    extra += (1.0 - acc) * s * k * uDensity * gain * len;
  } else {
    extra = max(extra, s * k * (1.0 - acc));
  }
}

vec4 finish(vec3 col, float acc, vec3 extra, vec3 glass, vec3 mist) {
  // Adderande läge rullar av mjukt i toppen, annars bränns ljusa klipp ut till vitt.
  if (uBlend == 1) extra = 1.0 - exp(-extra);
  mist = 1.0 - exp(-mist);
  col += extra + glass + mist;
  return vec4(col, clamp(acc + luma(extra) + luma(glass) + luma(mist), 0.0, 1.0));
}

vec3 glassTint(float fres, vec3 p) {
  return vec3(0.78, 0.9, 1.0) * 0.35 + spectrum(fres * 1.3 + dot(p, vec3(0.6, 0.9, 0.4))) * 0.12;
}

// --- Vätska ------------------------------------------------------------------
// Innehållet blir en yta där ljuset (eller rörelsen) går över en nivå. Den läses
// ur en suddigare mipnivå av volymen, så att ytan blir mjuk i stället för brusig.

vec4 liquidUVT(vec3 uvt) {
  vec3 raw = textureLod(uVolume, uvt, uSoft).rgb;
  vec3 c = raw;
  if (uBgRemove > 0.5 && uContent != 1) c *= fgMask(raw, uvt.xy);
  if (uContent != 0) {
    float dt = uFrameStep * exp2(uSoft);
    vec3 motion = abs(textureLod(uVolume, uvt + vec3(0.0, 0.0, dt), uSoft).rgb - raw) * uMotionGain;
    c = uContent == 1 ? motion : c + motion;
  }
  c = grade(c);
  return vec4(c, luma(c));
}

// En påhittad studio att spegla sig i: mörkt golv, ljusare himmel och två mjuka lampor.
vec3 environment(vec3 d) {
  vec3 c = mix(vec3(0.015, 0.018, 0.025), vec3(0.35, 0.42, 0.55), smoothstep(-0.3, 0.8, d.y));
  c += vec3(1.0, 0.97, 0.92) * pow(max(dot(d, normalize(vec3(-0.5, 0.75, 0.45))), 0.0), 60.0) * 3.0;
  c += vec3(0.7, 0.85, 1.0) * smoothstep(0.93, 0.98, dot(d, normalize(vec3(0.7, 0.2, 0.6)))) * 1.2;
  return c;
}

// Ljuset på ytan. n pekar ut ur vätskan, mot betraktaren; base är innehållets färg där.
vec4 shadeLiquid(vec3 n, vec3 rd, vec3 base) {
  float cosi = clamp(-dot(n, rd), 0.0, 1.0);
  float fres = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
  vec3 refl = environment(reflect(rd, n));
  vec3 light = normalize(vec3(-0.5, 0.75, 0.45));
  float spec = pow(max(dot(n, normalize(light - rd)), 0.0), 90.0);
  float diff = 0.3 + 0.7 * max(dot(n, light), 0.0);
  if (uMaterial == 2) {
    // Krom: speglar allt, färgat lite av innehållet.
    return vec4(refl * mix(vec3(1.0), base * 1.5 + 0.2, 0.35) + spec * 2.0 * uGloss, 1.0);
  }
  if (uMaterial == 3) {
    // Gelé: mjukt och mättat, svag spegling.
    vec3 c = base * (0.55 + 0.45 * diff) + (refl * fres * 0.4 + spec * 0.5) * uGloss;
    return vec4(c, mix(0.5, 0.95, 1.0 - uClarity));
  }
  vec3 c = mix(base * diff, refl, fres * min(uGloss, 1.0)) + spec * 1.5 * uGloss;
  return vec4(c, mix(1.0 - 0.85 * uClarity, 1.0, fres));
}

// Vätskans inre, mellan ytorna: färgad och mer eller mindre grumlig.
void liquidBody(vec3 base, float len, inout vec3 col, inout float acc) {
  float thick = uMaterial == 3 ? 6.0 : 2.5;
  over(col, acc, base * 0.7, 1.0 - exp(-(1.0 - uClarity) * thick * len));
}

// --- Lådans prisma och vätska ------------------------------------------------

// Ett snitt i sidled eller höjdled med prismat inblandat, om det är på.
vec3 boxSideColor(vec3 p, vec3 c, vec2 fold, vec3 tiltN, vec3 tiltR, vec3 tiltU,
    float cZero, float cStep, vec3 rdW) {
  if (uPrism <= 0.0 || uTimeCount < 0.5 || abs(cStep) < 1e-6) return c;
  float s = (dot(tiltN, p * uScale) - cZero) / cStep;
  vec2 size = vec2(uSliceW, uSliceH) * taperAt(p.z);
  vec2 uv = vec2(dot(p * uScale, tiltR), dot(p * uScale, tiltU)) / size + 0.5;
  vec3 prism = prismColor(s, -uTimeDir, abs(cStep), uv, fold, size, rdW.z);
  return mix(c, tintByTime(grade(prism), timeAt(p)), uPrism);
}

// Vätskans nivå i lådan. Utanför lådan är den 0, så att lådans väggar blir
// vätskans kant där den är full.
float boxField(vec3 p) {
  vec3 w = unwarp(p);
  if (any(greaterThan(abs(w), vec3(0.4999)))) return 0.0;
  return liquidUVT(vec3(w.x + 0.5, 0.5 - w.y, timeAt(p))).a * waveAt(p) * edgeAt(p) * filledAt(p);
}

// Ytan mellan ta och tb, där nivån passerar uIso. Normalen tas ur nivåns lutning.
void boxLiquidSurface(vec3 rd, vec3 rdW, float ta, float tb, bool entering,
    inout vec3 col, inout float acc) {
  for (int k = 0; k < 5; k++) {
    float tm = 0.5 * (ta + tb);
    if ((boxField(vOrigin + rd * tm) >= uIso) == entering) tb = tm;
    else ta = tm;
  }
  vec3 p = vOrigin + rd * (entering ? tb : ta);
  vec3 e = 0.015 / uScale;
  vec3 g = vec3(
    boxField(p + vec3(e.x, 0.0, 0.0)) - boxField(p - vec3(e.x, 0.0, 0.0)),
    boxField(p + vec3(0.0, e.y, 0.0)) - boxField(p - vec3(0.0, e.y, 0.0)),
    boxField(p + vec3(0.0, 0.0, e.z)) - boxField(p - vec3(0.0, 0.0, e.z)));
  vec3 n = -normalize(g + vec3(0.0, 1e-7, 0.0));
  vec4 lit = shadeLiquid(entering ? n : -n, rdW, shadeVol(p));
  over(col, acc, lit.rgb, lit.a * (entering ? 1.0 : 0.5));
}

#ifndef FORM

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
  vec3 nIn;
  vec3 maskIn;
  surfInfo(pIn, nIn, maskIn);
  vec3 nOut;
  vec3 maskOut;
  surfInfo(pOut, nOut, maskOut);

  vec3 col = vec3(0.0);
  float acc = 0.0;
  vec3 glass = vec3(0.0);
  vec3 extra = vec3(0.0);
  vec3 mist = vec3(0.0);

  // Framsidans glasyta: fresnel-reflex, lätt regnbågsskimmer och kantglöd.
  float fresIn = 1.0 - abs(dot(nIn, rdW));
  if (outside) {
    float f = fresIn * fresIn * fresIn * fresIn;
    vec3 tint = vec3(0.78, 0.9, 1.0) * 0.35 + spectrum(fresIn * 1.3 + dot(pIn, vec3(0.6, 0.9, 0.4))) * 0.12;
    glass += tint * f * uGlass;
    glass += vec3(0.85, 0.95, 1.0) * exp(-edgeDist(pIn, maskIn) * 28.0) * uEdgeGlow * 0.5;
    vec3 sIn = shadeVol(pIn);
    over(col, acc, sIn,
      shellFor(maskIn, pIn) * grazing(fresIn) * filledAt(pIn) * edgeAt(pIn) * fgAlpha());
  }

  // Djupsnitten kan vridas kring höjdaxeln (uTilt) och luta fram/bak kring
  // sidaxeln (uTiltV). Planen definieras av sin lutade normal i världsrymd,
  // men skär tidsaxeln på samma ställen som förut, så att ordningen och
  // tiderna är oförändrade. tiltR och tiltU är snittets egna axlar.
  float ca = cos(uTilt);
  float sa = sin(uTilt);
  float cb = cos(uTiltV);
  float sb = sin(uTiltV);
  vec3 tiltN = vec3(sa * cb, -sb, ca * cb);
  vec3 tiltR = vec3(ca, 0.0, -sa);
  vec3 tiltU = vec3(sa * sb, cb, ca * sb);
  float anchorB = uTimeLoop > 0.5 ? uTimeAnchor : uTimePos;
  float cZero = tiltN.z * ((0.5 - anchorB) * uTimeDir) * uScale.z;
  float cStep = tiltN.z * uScale.z / max(uTimeCount, 1.0);

  float aT = 0.0, bT = 0.0;
  float denomT = dot(tiltN, rd * uScale);
  if (uTimeCount > 0.5 && abs(denomT) > 1e-5 && abs(cStep) > 1e-6) {
    aT = (cZero - dot(tiltN, vOrigin * uScale)) / denomT;
    bT = abs(cStep / denomT);
  }
  float xA = uXPos - 0.5;
  float xB = uXCount > 0.5 ? 1.0 / uXCount : 0.0;
  float yA = uYPos - 0.5;
  float yB = uYCount > 0.5 ? 1.0 / uYCount : 0.0;

  float dt = 1.0 / uSteps;
  float tPrev = b.x;
  float t = b.x + dt * hash12(gl_FragCoord.xy);
  // Vätskan: var förra provet låg och om det var inne i vätskan.
  float tLiquid = b.x;
  bool inLiquid = false;

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
      if (uTimeLoop > 0.5) sliceTime = fract(sliceTime);
      // Vridna snitt går från vägg till vägg — utanför bildrutan smetas
      // kanten ut, som på väggarna — och kapas av lådans fram- och baksida.
      // Tratten skalar bildrutan kring sin mitt på det djupet.
      vec2 uv = vec2(dot(p * uScale, tiltR) / uSliceW + 0.5,
                     dot(p * uScale, tiltU) / uSliceH + 0.5);
      uv = clamp((uv - 0.5) / taperAt(p.z) + 0.5, 0.0, 1.0);
      // AI-reliefen: där djupet säger nära buktar snittet mot betraktaren.
      // Parallax i två steg: läs djupet, flytta blickpunkten, läs igen.
      if (uDepthOn > 0.5 && uRelief > 0.001) {
        vec3 vW = -rd * uScale;
        float vn = max(abs(dot(vW, tiltN)), 0.2 * length(vW));
        vec2 vt = vec2(dot(vW, tiltR) / uSliceW, dot(vW, tiltU) / uSliceH) / vn;
        float h = (texture(uDepthVol, vec3(uv.x, 1.0 - uv.y, sliceTime)).r - 0.5) * uRelief;
        vec2 uv2 = clamp(uv + vt * h, 0.0, 1.0);
        h = (texture(uDepthVol, vec3(uv2.x, 1.0 - uv2.y, sliceTime)).r - 0.5) * uRelief;
        uv = clamp(uv + vt * h, 0.0, 1.0);
      }
      vec3 c = (uHasVideo > 0.5 && abs(sliceIndex) < 0.5)
        ? texture(uVideo, uv).rgb
        : volTexLoop(vec2(uv.x, 1.0 - uv.y), sliceTime);
      // Utan bakgrund blir snitten urklipp: motivet står kvar, resten släpper igenom.
      float fg = uBgRemove > 0.5 ? fgMask(c, vec2(uv.x, 1.0 - uv.y)) : 1.0;
      // Exponeringsfönstret gäller allt utom bildrutan som spelas och de fulla
      // ögonblicken: ju fullare snittet är, desto mer behåller det sitt ljus.
      // Även snittens ändtoning följer lådan i loopläget, inte klippets skarv.
      over(col, acc, tintByTime(gradeExp(c, 1.0 - sliceArc(sliceIndex)), sliceTime),
        fg * sliceAlpha(sliceIndex)
        * sliceWaveAt(sliceTime) * step(sliceTime, uFilled)
        * edgeAtTime(uTimeLoop > 0.5 ? 0.5 - uTimeDir * p.z : sliceTime));
      ts += 1e-6;
    }
    ts = tPrev;
    for (int n = 0; n < MAX_SLICES_PER_STEP; n++) {
      ts = uXFan > 0.5
        ? fanNext(ts, tEnd, vOrigin, rd, uXPos * 3.14159265,
            uXCount > 0.5 ? 3.14159265 / uXCount : 0.0)
        : nextWallSlice(ts, tEnd, vOrigin.x, rd.x, vOrigin.z, rd.z, xA, xB);
      if (ts < 0.0) break;
      vec3 p = vOrigin + rd * ts;
      vec3 sx = boxSideColor(p, shadeVol(p), vec2(1.0, 0.0), tiltN, tiltR, tiltU, cZero, cStep, rdW);
      over(col, acc, sx, uXOpacity * filledAt(p) * waveAt(p) * edgeAt(p) * fgAlpha());
      ts += 1e-6;
    }
    ts = tPrev;
    for (int n = 0; n < MAX_SLICES_PER_STEP; n++) {
      ts = nextWallSlice(ts, tEnd, vOrigin.y, rd.y, vOrigin.z, rd.z, yA, yB);
      if (ts < 0.0) break;
      vec3 p = vOrigin + rd * ts;
      vec3 sy = boxSideColor(p, shadeVol(p), vec2(0.0, 1.0), tiltN, tiltR, tiltU, cZero, cStep, rdW);
      over(col, acc, sy, uYOpacity * filledAt(p) * waveAt(p) * edgeAt(p) * fgAlpha());
      ts += 1e-6;
    }

    if (t < b.y) {
      vec3 p = vOrigin + rd * t;
      if (uMaterial != 0) {
        bool inside = boxField(p) >= uIso;
        if (inside != inLiquid) boxLiquidSurface(rd, rdW, tLiquid, t, inside, col, acc);
        if (inside) {
          vec3 w = unwarp(p);
          vec3 base = liquidUVT(vec3(w.x + 0.5, 0.5 - w.y, timeAt(p))).rgb;
          liquidBody(tintByTime(base, timeAt(p)), dt * worldPerUnit, col, acc);
        }
        inLiquid = inside;
        tLiquid = t;
      } else if (timeAt(p) <= uFilled) {
        // Dimman lyser där bilden ändras mellan bildrutorna: en mjuk glöd som
        // följer rörelsen genom lådan, ovanpå vilket innehållsläge som helst.
        if (uMotionMist > 0.001) {
          vec3 mv = abs(volumeAt(p, uFrameStep) - volumeAt(p, 0.0));
          mist += (1.0 - acc) * tintByTime(grade(mv), timeAt(p)) * uMotionMist * 3.0
            * waveAt(p) * edgeAt(p) * dt * worldPerUnit;
        }
        vec3 s = shadeVol(p);
        float k = mix(1.0, 0.25 + 1.5 * luma(s), uLumWeight)
          * waveAt(p) * edgeAt(p) * fgAlpha();
        if (uBlend == 0) {
          over(col, acc, s, 1.0 - exp(-uDensity * k * dt * worldPerUnit));
        } else if (uBlend == 1) {
          // Allt längs strålen lyser ihop, så mitten fylls i stället för att bli ett medelvärde.
          // Automatisk exponering gäller bilden; i rörelseläget styr rörelsekänsligheten.
          float gain = uContent != 1 ? uAutoGain : 1.0;
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

  if (inLiquid && acc < 0.985) boxLiquidSurface(rd, rdW, tLiquid, b.y, false, col, acc);

  // Baksidan av lådan.
  if (acc < 0.985) {
    float fresOut = 1.0 - abs(dot(nOut, rdW));
    vec3 sOut = shadeVol(pOut);
    over(col, acc, sOut,
      shellFor(maskOut, pOut) * grazing(fresOut) * filledAt(pOut) * edgeAt(pOut) * fgAlpha());
    glass += vec3(0.85, 0.95, 1.0) * exp(-edgeDist(pOut, maskOut) * 28.0) * uEdgeGlow * 0.25 * (1.0 - acc);
  }

  // Adderande läge rullar av mjukt i toppen, annars bränns ljusa klipp ut till vitt.
  if (uBlend == 1) extra = 1.0 - exp(-extra);
  mist = 1.0 - exp(-mist);
  col += extra + glass + mist;
  outColor = vec4(col, clamp(acc + luma(extra) + luma(glass) + luma(mist), 0.0, 1.0));
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
  // Loopläget: klippet rullar runt genom formen, som genom lådan.
  if (uTimeLoop > 0.5) t = fract(uTimePos + t - uTimeAnchor);
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
  // Tratten: bildrutan är mindre eller större beroende på var längs formen den ligger.
  img /= taperAt((0.5 - f.u) * uTimeDir);
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

// Innehållets färdiga färg i bildrutan, med exponering och tidsfärg.
vec3 shadeFrame(Frame f) { return tintByTime(grade(sampleUVT(uvtOf(f))), f.t); }

// Toningen vid ändarna ligger vid formens ändar, som vid lådans fram- och bakkant.
float formEdge(Frame f) { return edgeAtTime(clamp(f.u, 0.0, 1.0)); }

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

// Vätskans nivå i formen: den högsta av grenarna. Utanför formen är den 0.
float formField(vec3 p, out vec3 base) {
  Pt P = pointAt(p);
  vec2 nr = branchRange(P.ang, P.ang);
  float best = 0.0;
  base = vec3(0.0);
  for (int i = 0; i < MAX_BRANCHES; i++) {
    float n = nr.x + float(i);
    if (n > nr.y) break;
    if (skipBranch(n)) continue;
    Frame f;
    if (!frameAt(P, P.ang, n, f) || f.t > uFilled) continue;
    vec4 l = liquidUVT(uvtOf(f));
    float v = l.a * waveAtTime(f.t) * formEdge(f);
    if (v > best) {
      best = v;
      base = tintByTime(l.rgb, f.t);
    }
  }
  return best;
}

float formField(vec3 p) {
  vec3 base;
  return formField(p, base);
}

void formLiquidSurface(vec3 ro, vec3 rd, float ta, float tb, bool entering,
    inout vec3 col, inout float acc) {
  for (int k = 0; k < 5; k++) {
    float tm = 0.5 * (ta + tb);
    if ((formField(ro + rd * tm) >= uIso) == entering) tb = tm;
    else ta = tm;
  }
  vec3 p = ro + rd * (entering ? tb : ta);
  float e = 0.015;
  vec3 g = vec3(
    formField(p + vec3(e, 0.0, 0.0)) - formField(p - vec3(e, 0.0, 0.0)),
    formField(p + vec3(0.0, e, 0.0)) - formField(p - vec3(0.0, e, 0.0)),
    formField(p + vec3(0.0, 0.0, e)) - formField(p - vec3(0.0, 0.0, e)));
  vec3 n = -normalize(g + vec3(0.0, 1e-7, 0.0));
  vec3 base;
  formField(p, base);
  vec4 lit = shadeLiquid(entering ? n : -n, rd, base * 1.2);
  over(col, acc, lit.rgb, lit.a * (entering ? 1.0 : 0.5));
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
  vec3 c = shadeFrame(f);
  float a = (entering ? uShellFront : uShellBack) * grazing(fres)
    * step(f.t, uFilled) * formEdge(f) * fgAlpha();
  over(col, acc, c, a);
}

// Snittens nivåer längs en gren: 0 = tid, 1 = sidled, 2 = höjdled. Ett snitt
// ligger där nivån är ett heltal.
float sliceLevel(int family, Frame f) {
  if (family == 0) return timeDelta(f.t) * uTimeCount;
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
      float ga = sliceLevel(family, fa);
      float gb = sliceLevel(family, fb);
      // Tiden hoppar mellan bitarna, och i loopläget vid skarven; det är en
      // skarv, inte ett snitt.
      if (family == 0 && (fa.seg != fb.seg || abs(gb - ga) > 0.5 * uTimeCount)) continue;
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
            if (uTimeLoop > 0.5) tk = fract(tk);
            if (tk >= 0.0 && tk <= 1.0) {
              vec2 uv = f.s * 0.5 + 0.5;
              vec3 c = (uHasVideo > 0.5 && abs(k) < 0.5)
                ? texture(uVideo, uv).rgb
                : volTexLoop(vec2(uv.x, 1.0 - uv.y), tk);
              // Samma ögonblick som i lådan: urklipp utan bakgrund, exponering
              // som skonar de fulla ögonblicken, och styrkerampen.
              float fg = uBgRemove > 0.5 ? fgMask(c, vec2(uv.x, 1.0 - uv.y)) : 1.0;
              over(col, acc, tintByTime(gradeExp(c, 1.0 - sliceArc(k)), tk),
                fg * sliceAlpha(k) * sliceWaveAt(tk) * step(tk, uFilled)
                * edgeAtTime(uTimeLoop > 0.5 ? clamp(f.u, 0.0, 1.0) : tk));
            }
          } else {
            float opacity = family == 1 ? uXOpacity : uYOpacity;
            vec3 c = shadeFrame(f);
            float fg = fgAlpha();
            if (uPrism > 0.0 && uTimeCount > 0.5) {
              vec3 p = ro + rd * tr;
              float len = uDepthW;
              vec3 along = vec3(0.0, 0.0, 1.0);
              if (uBend > 0.0) {
                vec3 e = uRadDir * cos(f.thW) + uTanDir * sin(f.thW);
                len = uBend * max(abs(dot(p - uAxisPoint, e)), 0.05);
                along = uTanDir * cos(f.thW) - uRadDir * sin(f.thW);
              }
              vec2 fold = family == 1 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
              vec3 prism = prismColor(timeDelta(f.t) * uTimeCount, 1.0, len / uTimeCount,
                f.s * 0.5 + 0.5, fold, 2.0 * uHalf, dot(rd, along));
              c = mix(c, tintByTime(grade(prism), f.t), uPrism);
            }
            over(col, acc, c, opacity * step(f.t, uFilled) * waveAtTime(f.t) * formEdge(f) * fg);
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
  vec3 mist = vec3(0.0);

  float dt = length(uBoundsMax - uBoundsMin) / uSteps;
  float tPrev = b.x;
  float t = b.x + dt * hash12(gl_FragCoord.xy);
  Pt pPrev = pointAt(ro + rd * tPrev);
  float angPrev = pPrev.ang;
  bool inPrev = insidePt(pPrev);
  bool slices = uTimeCount > 0.5 || uXCount > 0.5 || uYCount > 0.5;
  bool liquid = uMaterial != 0;
  bool inLiquid = false;

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
    vec3 sMist = vec3(0.0);
    bool inCur = liquid && insidePt(pCur);
    vec2 nr = liquid ? vec2(0.0, -1.0) : branchRange(pCur.ang, pCur.ang);
    for (int j = 0; j < MAX_BRANCHES; j++) {
      float n = nr.x + float(j);
      if (n > nr.y) break;
      if (skipBranch(n)) continue;
      Frame f;
      if (!frameAt(pCur, pCur.ang, n, f)) continue;
      inCur = true;
      if (f.t > uFilled) continue;
      vec3 s = shadeFrame(f);
      float k = mix(1.0, 0.25 + 1.5 * luma(s), uLumWeight) * waveAtTime(f.t) * formEdge(f) * fgAlpha();
      smoke(s, k, dt, sCol, sAcc, sExtra);
      // Rörelsedimman, som i lådan: en glöd där bilden ändras mellan bildrutorna.
      if (uMotionMist > 0.001) {
        vec3 uvt = uvtOf(f);
        vec3 mv = abs(volTexLoop(uvt.xy, uvt.z + uFrameStep) - volTexLoop(uvt.xy, uvt.z));
        sMist += tintByTime(grade(mv), f.t) * uMotionMist * 3.0 * waveAtTime(f.t) * formEdge(f) * dt;
      }
    }

    if (inCur && !inPrev) {
      formShell(ro, rd, surfaceBetween(ro, rd, tPrev, tEnd, false), true, col, acc, glass);
    }
    if (slices) formSlices(ro, rd, tPrev, pPrev, angPrev, tEnd, pCur, ang, col, acc);

    if (liquid) {
      vec3 base;
      bool inside = formField(pCur.p, base) >= uIso;
      if (inside != inLiquid) formLiquidSurface(ro, rd, tPrev, tEnd, inside, col, acc);
      if (inside) liquidBody(base, dt, col, acc);
      inLiquid = inside;
    } else {
      if (uBlend == 1) extra += (1.0 - acc) * sExtra;
      else if (uBlend == 2) extra = max(extra, sExtra * (1.0 - acc));
      mist += (1.0 - acc) * sMist;
      col += (1.0 - acc) * sCol;
      acc += (1.0 - acc) * sAcc;
    }

    if (!inCur && inPrev) {
      formShell(ro, rd, surfaceBetween(ro, rd, tPrev, tEnd, true), false, col, acc, glass);
    }

    pPrev = pCur;
    angPrev = ang;
    inPrev = inCur;
    tPrev = tEnd;
    t += dt;
  }

  outColor = finish(col, acc, extra, glass, mist);
}

#endif
`;
