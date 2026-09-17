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

Öppna adressen som skrivs ut (http://localhost:5178) och dra in en videofil i fönstret,
eller klicka på **Öppna video…**. Volymen byggs upp medan videon redan spelar.

För en skarp version:

```bash
npm run build
```

Allt körs lokalt i webbläsaren. Ingen fil laddas upp någonstans.

## Reglagen

| Grupp | Vad det gör |
| --- | --- |
| **Sparade inställningar** | Namngivna uppsättningar av alla reglage: spara, hämta tillbaka, ta bort. Samt en kort kod för att dela eller flytta en uppsättning. |
| **Volym** | Antal bildrutor och upplösning i 3D-texturen — fria tal, skriv vad du vill (2–512 bildrutor, 32–720 px). Raden under visar vad valet kostar i minne. Ändring kräver **Bygg om volym**. Här finns också lådans djup och tidsriktning. |
| **Utseende** | Innehåll (bild/rörelse), blandning, densitet, hur mycket ytorna syns, ljusstyrka, mättnad, glasreflex, kantglöd, kantlinjer, renderingskvalitet och bakgrundsfärg. |
| **Snitt** | En flik per riktning: djupled (tiden), sidled (X) och höjdled (Y). Varje flik har antal, position, automatiskt svep och egen opacitet. Antalet styr hur många plan som läggs ut med jämna mellanrum; 0 stänger av riktningen och gråar ut resten av flikens reglage. |
| **Kamera** | Fri musstyrning, pendel eller rotation, hastighet och brännvidd. |
| **Export** | Bildformat (1:1, 4:5, 9:16, 16:9), bildfrekvens, kvalitet, antal varv och om ljudet ska med. |

### Innehåll

* **Rörelse** (standard) — varje punkt visar skillnaden mot nästa bildruta. Det som står still
  blir svart, och det som rör sig ritar banor genom lådan. Det är det som ger innehåll i mitten;
  i bildläget blir mitten annars summan av allt och därmed en jämn gröt utan struktur.
  **Rörelsekänslighet** styr hur mycket små rörelser förstärks.
* **Bild** — råa bildrutor. Ger den lugnare, rökiga looken där lådans ytor dominerar.

### Snitten i djupled

**Antal** lägger ut flera tidssnitt med jämna mellanrum, som alla följer uppspelningen.

**Snitt med full styrka** är hur många av dem närmast uppspelningen som behåller full
opacitet — 1 är bara det som spelas, 3 är det plus grannen på var sida, och så vidare.
**Uttoning därefter** bestämmer hur mycket svagare varje steg utanför kärnan är: samma
faktor för varje steg, så 0 ger lika starka snitt hela vägen och 1 lämnar bara kärnan kvar.

### Vågen

**Våg kring bildrutan som spelas** låter bildrutorna närmast uppspelningen synas starkast och
tona ut åt båda håll, i stället för att hela klippet syns lika mycket hela tiden. **Vågens
längd** är hur stor del av klippet som fortfarande syns tydligt: en kort våg ger ett smalt
fönster som vandrar genom lådan, en lång ger en mjuk uttoning.

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
Dubbelklick på ett enskilt reglage återställer bara det. Mellanslag spelar/pausar.
Inställningarna sparas i webbläsaren till nästa gång.

I smala fönster hamnar reglagen under videon, och videon ligger då kvar fäst överst på skärmen
medan du bläddrar bland dem.

## Export

Exporten spelar in canvasen i realtid från videons början till slut, så en 10-sekundersvideo
tar 10 sekunder att exportera. Håll fliken synlig under tiden — webbläsaren pausar
renderingen i bakgrundsflikar. Filen laddas ned som MP4 om webbläsaren stödjer det
(Chrome, Safari), annars som WebM.

**Spara bild** ger en PNG i exportupplösning.

## Så fungerar det

1. `src/frames.js` plockar ut jämnt fördelade bildrutor ur videon med fyra parallella
   videoelement som söker samtidigt, och packar dem i en `Data3DTexture` (x, y, tid).
2. `src/shaders.js` strålmarscherar genom lådan i objektrymden: bildrutorna vägs ihop enligt
   valt blandningsläge, snitten komponeras in där strålen korsar dem, och ytorna vägs med
   siktvinkeln så att lådan blir genomskinlig rakt framifrån men tät i sned vinkel — som glas.
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
