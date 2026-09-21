# N4TN · Tidskub

Ett redigeringsprogram som körs i webbläsaren: du laddar in en videofil och får ut den som
en **tidskub** — alla bildrutor staplade på djupet, så att lådans djup är tiden.

* Lådans sidor, tak och botten visar bildens kanter utdragna över tid (de utsmetade ränderna).
* Innehållet syns i hela lådan, inte bara vid ett plan. I standardläget **Rörelse** visas
  skillnaden mellan bildrutor, så stillastående bakgrund faller bort och det som rör sig blir
  synliga banor rakt genom lådan.
* Ett skarpt **tidssnitt** glider genom lådan i takt med uppspelningen.
* Valfritt antal extra snitt längs djup, bredd och höjd kan skäras in i volymen.
* Kameran styrs med musen, eller rör sig automatiskt (pendel/rotation).
* Resultatet exporteras som färdig MP4 (eller WebM) med originalljudet.

## Kom igång

```bash
npm install
```

```bash
npm run dev
```

Öppna adressen som skrivs ut (http://localhost:5178). Innan du laddar något visas en genererad
demoscen — en väg med en röd bil som rör sig — så att du kan prova alla reglage direkt. Dra
sedan in en videofil i fönstret, eller klicka på **Öppna video…**. Volymen byggs upp medan
videon redan spelar.

För en skarp version:

```bash
npm run build
```

Allt körs lokalt i webbläsaren. Ingen fil laddas upp någonstans.

## Reglagen

| Grupp | Vad det gör |
| --- | --- |
| **Sparade inställningar** | Namngivna uppsättningar av alla reglage: spara, hämta tillbaka, ta bort. Samt en kort kod för att dela eller flytta en uppsättning. |
| **Volym** | Fyra flikar. **Bildrutor**: antal bildrutor och upplösning i 3D-texturen — fria tal, skriv vad du vill (2–512 bildrutor, 32–720 px). Djupet går till 50, vilket drar ut lådan till en lång korridor. Raden under visar vad valet kostar i minne. Ändring kräver **Bygg om volym**. Här finns också lådans djup och tidsriktning. **Form**, **Bana** och **Tid** böjer, slingrar och klipper om tiden, se nedan. |
| **Utseende** | Innehåll (bild/rörelse), blandning, densitet, toning vid klippets ändar, hur mycket ytorna syns, ljusstyrka, mättnad, glasreflex, kantglöd, kantlinjer, renderingskvalitet och bakgrundsfärg. |
| **Snitt** | En flik per riktning: djupled (tiden), sidled (X) och höjdled (Y). Varje flik har antal, position, automatiskt svep och egen opacitet. Antalet går till 256 och styr hur många plan som läggs ut med jämna mellanrum; 0 stänger av riktningen och gråar ut resten av flikens reglage. |
| **Special** | Vrider djupsnitten mot kameravinkeln, med håll och styrka. |
| **Kamera** | Följ tidssnittet, fri musstyrning, pendel eller rotation, hastighet och brännvidd. |
| **Export** | Bildformat (1:1, 4:5, 9:16, 16:9), bildfrekvens, kvalitet, antal varv och om ljudet ska med. |

### Formen

Under **Volym → Form** kan bildrutorna läggas i en cirkel i stället för rakt bakåt.
**Böj runt axel** är hur många grader klippet täcker runt axeln: 0 är den vanliga lådan,
360 ett helt varv och upp till 1080 tre varv. **Centrum** är var axeln sitter i förhållande
till bilden: 0 mitt i bilden, 1 vid bildens kant och över 1 utanför, så att det blir ett hål i
mitten. **Axelns vinkel** vrider axeln från lodrät (0) till vågrät (90). **Spiral** låter
varven stiga längs axeln, mätt i bildhöjder per varv. **Rundning** gör bildens rektangel till
en ellips, och **Vridning** vrider bildrutorna kring sin egen mitt längs klippet.

Snabbvalen ger utgångslägen att skruva vidare på:

* **Cylinder** — ett helt varv med axeln vid bildens kant, vågrät, så att bildrutorna hänger
  från axeln som bladen i en rolodex.
* **Donut** — ett helt varv med axeln utanför bilden och full rundning.
* **Boll** — ett halvt varv med axeln mitt i bilden och full rundning. Bollen får bildens
  proportioner, så en 16:9-video ger en tillplattad boll.
* **Spiral** — tre varv som stiger längs axeln.

Med **Följ tidssnittet** påslaget snurrar en böjd form runt sin axel i stället för att
kameran åker, så att bildrutan som spelas står still och resten av formen vandrar förbi. Ett
helt varv går därför runt sömlöst när klippet börjar om. Djupet under Bildrutor gäller inte
när formen är böjd, och Special gäller bara den raka lådan.

### Bana

**Volym → Bana** låter bildrutorna vandra i stället för att gå rakt: **Åt sidorna** och
**Upp och ner** är hur långt (i halva bildbredder och bildhöjder), **Snurra** hur mycket de
vrider sig fram och tillbaka. **Mjukhet** styr hur lugnt banan slingrar, och **Rörelse** får
den att röra sig över tid. **Ny slump** ger en annan bana. Allt fungerar ihop med formerna,
så en donut kan slingra och en spiral snurra.

### Tid

**Volym → Tid** gör tiden olinjär längs formen. **Fram och tillbaka** låter tiden gå
växelvis framåt och bakåt: värdet är hur långt tillbaka varje sväng går, **Takt** hur många
svängar det blir, **Oregelbundenhet** gör svängarna olika långa och **Rörelse** får mönstret
att vandra. **Hoppa i tiden** delar formen i bitar, var och en med en lika lång bit ur en
annan del av klippet — 0,5 sekunder här, 0,5 sekunder där. **Bitarnas längd** anges i
sekunder, och hoppar ska de från 0 (i ordning) till 1 (helt utspridda). När en tid finns på
flera ställen visas tidssnittet på alla dem.

### Innehåll

* **Rörelse** (standard) — varje punkt visar skillnaden mot nästa bildruta. Det som står still
  blir svart, och det som rör sig ritar banor genom lådan. Det är det som ger innehåll i mitten;
  i bildläget blir mitten annars summan av allt och därmed en jämn gröt utan struktur.
  **Rörelsekänslighet** styr hur mycket små rörelser förstärks.
* **Bild** — råa bildrutor. Ger den lugnare, rökiga looken där lådans ytor dominerar.

### Snitten i djupled

**Antal** lägger ut flera tidssnitt med jämna mellanrum, som alla följer uppspelningen.

**Snitt med full styrka** är hur många av snitten som lyser för fullt samtidigt, jämnt
fördelade över klippet. 1 ger ett — det som spelas. 2 ger två som ligger en halv film isär och
går samtidigt, 3 ger tre en tredjedel isär, och så vidare. Alla är lika starka och var och en
har en båge före och efter sig. De vandrar med uppspelningen: när en lämnar bakkanten kommer
nästa in framifrån.

**Uttoning mellan dem** är hur djupt det sjunker i dalarna mellan topparna — 0 ger lika starka
snitt hela vägen, och då spelar antalet fulla ingen roll, så de reglagen gråas ut. Vid 1
släcks dalarna helt. Tänk också på att hög opacitet gör att det främsta snittet skymmer de
bakom, oavsett hur många toppar som är inställda. **Bågens form** ändrar kurvan däremellan: låga värden
ger breda toppar som nästan möts, höga ger spetsiga toppar med tydliga mellanrum.

Tidssnitten styrs bara av de här reglagen. Vågen under Utseende gäller volymen och lådans ytor,
så att den inte trycker ner toppar som ligger långt från uppspelningen.

### Vågen

Vågen låter det närmast uppspelningen synas starkast och tona ut åt båda håll, i stället för
att hela klippet syns lika mycket hela tiden. Den har två flikar med var sin uppsättning:
**Bildrutan som spelas** gäller volymen och lådans ytor, **Övriga djupsnitt** gäller snitten i
djupled. De är skilda åt så att den ena inte trycker ner den andras toppar.

**Vågens längd** är hur stor del av klippet som fortfarande syns tydligt: en kort våg ger ett
smalt fönster som vandrar genom lådan, en lång ger en mjuk uttoning.

Styrkan går till 4. Upp till 1 är det en mjuk uttoning; över 1 dras även de närmaste grannarna
ner och allt utanför fönstret skärs bort helt, så att bara en tunn skiva kring den spelande
bildrutan blir kvar. Sätt 0 för att visa hela klippet lika starkt.

### Blandning

Hur bildrutorna längs en siktlinje vägs ihop:

* **Adderande** (standard) — allt längs strålen lyser ihop, så mitten av lådan fylls med
  innehåll i stället för att bli ett grumligt medelvärde. Toppen rullar av mjukt, så ljusa
  klipp bränns inte ut. Exponeringen ställs automatiskt efter klippets medelljus.
* **Maxljus** — det ljusaste längs strålen vinner. Lyfter fram ljusa motiv som solida former.
* **Genomskinlig** — vanlig genomskinlighet framifrån och bakåt. Lugnast, men mitten blir
  ungefär medelvärdet av klippet och därmed mörkare.

Den rörliga väggen som visar filmen är **Visa tidssnitt** under Snitt — kryssa ur den för att
bara se innehållet i lådan. Svepen i sidled och höjdled går i olika takt, så att de två snitten
inte rör sig i lås med varandra.

Vill du kunna komma tillbaka till ett läge du gillar: skriv ett namn i **Sparade
inställningar** och tryck Spara. Uppsättningen hamnar i listan och ligger kvar i webbläsaren
till nästa gång. Byter du dator eller rensar webbläsaren är det koden nedan som gäller —
spara koden för de looks du bryr dig om, så kan du alltid få tillbaka dem.

### Special

**Vrid snitten efter kameran** vrider djupsnitten lika mycket som kameran är vinklad mot
lådans mittpunkt, fast åt motsatt håll, så att de står på diagonalen men behåller sin ordning
genom lådan. Snitten behåller sin egen bredd; det är lådan som klipper dem smalare ju mer de
vrids. **Motsatt håll** vänder vridningen, och **Hur mycket** skalar den — kring halv styrka
syns lutningen tydligast, full styrka vrider dem nästan på kant mot kameran.

### Följ tidssnittet

Med **Följ tidssnittet** åker kameran med bildrutan som spelas upp genom lådan, på konstant
avstånd från den, och hoppar tillbaka till framkanten när klippet börjar om. Eftersom kameran
då färdas in i lådan växer lådan i bild under klippets gång — dra ner **Djup (tid)** eller
zooma ut om det blir för mycket. Kryssa ur för en stillastående kamera som ser hela lådan.

### Tona in och ut

**Tona in och ut vid ändarna** under Utseende låter klippets början och slut tona mot lådans
fram- och bakkant i stället för att börja och sluta tvärt. Värdet är hur stor del av klippet
toningen tar i var ände.

### Dela med en kod

**Skapa kod att dela** packar dina inställningar till en kort kod, till exempel
`042PN48W04F307RG30G2AP963B10`, och kopierar en länk till urklipp. Den som får koden skriver
in den i fältet och trycker Öppna — eller klickar bara på länken. Inställningarna ligger i
själva koden, så det behövs ingen server och inget konto.

Koden innehåller bara det du ändrat från standard, vilket håller den kort: några ändringar ger
runt 20–30 tecken. Den är okänslig för stora och små bokstäver, och mellanslag och bindestreck
får du sätta hur du vill när du skriver av den. Tecken som lätt förväxlas (I, L, O, U) används
inte, och en kod som blivit fel avvisas i stället för att ge ett halvt resultat.

**Återställ** uppe till höger nollställer alla reglage (två klick, så att en felklickning inte
slår ut allt). Antal bildrutor och upplösning behålls, eftersom de kräver en ombyggnad.
Avsnitten i panelen är hopfällda från start; klicka på rubriken för att öppna ett.
Dubbelklick på ett enskilt reglage återställer bara det. Mellanslag spelar/pausar.
Inställningarna sparas i webbläsaren till nästa gång.

I smala fönster hamnar reglagen under videon, och videon ligger då kvar fäst överst på skärmen
medan du bläddrar bland dem.

## Export

Exporten spelar in canvasen i realtid från videons början till slut i vald hastighet, så en
10-sekundersvideo tar 10 sekunder att exportera i 1× och fem i 2×. Håll fliken synlig under tiden — webbläsaren pausar
renderingen i bakgrundsflikar. Filen laddas ned som MP4 om webbläsaren stödjer det
(Chrome, Safari), annars som WebM.

**Spara bild** ger en PNG i exportupplösning.

## Så fungerar det

1. `src/frames.js` plockar ut jämnt fördelade bildrutor ur videon med fyra parallella
   videoelement som söker samtidigt, och packar dem i en `Data3DTexture` (x, y, tid).
2. `src/shaders.js` strålmarscherar genom lådan i objektrymden: bildrutorna vägs ihop enligt
   valt blandningsläge, snitten komponeras in där strålen korsar dem, och ytorna vägs med
   siktvinkeln så att lådan blir genomskinlig rakt framifrån men tät i sned vinkel — som glas.
   När en form är på används en andra väg i samma shader: för varje punkt räknas ut vilka
   bildrutor den ligger i (i en böjd form en per varv och sida om axeln), snitten hittas där
   tiden eller läget i bilden passerar sina nivåer, och formens yta där strålen går in och ut.
   `src/volume.js` räknar samma form åt andra hållet för konturer och kamerans inpassning.
3. Det skarpa tidssnittet samplas från en `VideoTexture` i full upplösning, inte från volymen.
   Rörelseläget jämför två närliggande lager i volymen per sampling.
4. `src/recorder.js` spelar in canvasen med `MediaRecorder` och lägger till ljudet från
   videon via Web Audio.
5. `src/code.js` packar inställningarna till delningskoden: bara värden som skiljer sig från
   en frusen referens skrivs med, ett fält i taget, och resultatet skrivs i Crockford base32
   med en kontrollsiffra på slutet.

## Kända begränsningar

* Webbläsaren måste kunna spela upp källvideon. HEVC/ProRes i `.mov` fungerar inte överallt —
  konvertera i så fall först, t.ex. `ffmpeg -i in.mov -c:v libx264 -pix_fmt yuv420p ut.mp4`.
* Exporten är en realtidsinspelning; tunga inställningar (hög kvalitet + stort format) kan
  ge lägre bildfrekvens i filen.
* Fler bildrutor tar längre tid att läsa in och mer minne — raden under valet visar hur mycket.
  Få bildrutor (10–30) ger en synligt stegad, hackig tidsaxel, vilket kan vara en poäng i sig.

## Utveckling

`?src=<url>` i adressfältet laddar en video direkt, praktiskt vid test.
I dev-läge finns `window.__n4tn` med parametrar, kamera och volym för felsökning.
