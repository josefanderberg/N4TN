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

Varje reglage har en liten **i**-knapp intill etiketten som fäller ut en förklaring av vad
det ändrar, och ett litet streck på skalan som märker ut standardvärdet, så att du hittar
tillbaka efter en ändring (dubbelklick på reglaget återställer det).

| Grupp | Vad det gör |
| --- | --- |
| **Volym** | Sammanhanget: lådan som klippet byggs in i. Antal bildrutor och upplösning i 3D-texturen — fria tal, skriv vad du vill (2–512 bildrutor, 32–720 px). Raden under visar vad valet kostar i minne och om volymen är byggd med just de värdena. Ändring kräver **Bygg om volym**, som går att trycka på så fort ett klipp är laddat — även med oförändrade värden, för att göra om ett bygge som blev fel eller avbröts. Djupet är ett reglage upp till 5; **Utöka djupet…** öppnar ett fritt fält där du skriver vad du vill upp till 200. **Storlek fram/bak** gör lådan till en tratt: olika storlek på ändarna får innehållet att växa eller krympa genom flödet. Längst ner lådans egna kanter — kantlinjer och kantglöd — samt den vikbara gruppen **Ytor och glas** med glasreflexen och en yta per sida (fram, bak, vänster, höger, tak, botten) och bakgrundsfärgen. |
| **Utseende** | Helheten inne i lådan: innehåll (bild/rörelse), blandning, densitet, ljusstyrka, mättnad, renderingskvalitet och sist toningen vid klippets ändar. |
| **Ögonblick** | Bildrutorna som skarpa plan — flera tider samtidigt. En flik per riktning: djupled (tiden), sidled (X) och höjdled (Y), var och en med antal, position, uppspelning/svep och opacitet. Under Djupled ligger också mönstret mellan ögonblicken: vågen i två underflikar (Bildrutan som spelas och Övriga ögonblick) samt rampen — opacitet mellan ögonblicken, hur många som lyser för fullt och Bågens form. Antalet går till 256; 0 (eller avbockat) stänger av riktningen och gråar ut resten av flikens reglage. |
| **Special** | Vrider ögonblicken mot kameravinkeln, med håll och styrka. |
| **Kamera** | Följ ögonblicket, fri musstyrning, pendel eller rotation, hastighet och brännvidd. |
| **Export** | Bildformat (1:1, 4:5, 9:16, 16:9), bildfrekvens, kvalitet, antal varv och om ljudet ska med. |
| **Sparade inställningar** | Längst ner: namngivna uppsättningar av alla reglage — spara, hämta tillbaka, ta bort — samt en kort kod för att dela eller flytta en uppsättning. |

### Innehåll

* **Rörelse** (standard) — varje punkt visar skillnaden mot nästa bildruta. Det som står still
  blir svart, och det som rör sig ritar banor genom lådan. Det är det som ger innehåll i mitten;
  i bildläget blir mitten annars summan av allt och därmed en jämn gröt utan struktur.
  **Rörelsekänslighet** styr hur mycket små rörelser förstärks.
* **Bild** — råa bildrutor. Ger den lugnare, rökiga looken där lådans ytor dominerar.
* **Bild + rörelse** — bilden i botten och rörelsebanorna lysande ovanpå.

### Ögonblicken

Ögonblicken är tidssnitten: bildrutor som skarpa plan tvärs genom lådan, så att flera tider
syns samtidigt. **Antal** lägger ut dem med jämna mellanrum, och alla följer uppspelningen.
Opaciteten ställs i två reglage: ett för **bildrutan som spelas** och ett för de övriga
**fulla ögonblicken**, så att det följda ögonblicket kan lysa för sig. **Dynamisk opacitet**
är ett trappsteg: varje fullt ögonblick tappar så mycket i styrka för varje steg bort från
den spelade bildrutan (0,1 ger 0,9 → 0,8 → 0,7 …), så att det längst bort visas svagast.

### Mönstret mellan ögonblicken

Rampen och vågen ligger under Ögonblick → Djupled och styr hur ögonblicken tonar i och ur
varandra.

**Ögonblick med full styrka** är hur många som lyser för fullt samtidigt, jämnt fördelade
över klippet. 1 ger ett — det som spelas. 2 ger två som ligger en halv film isär och går
samtidigt, 3 ger tre en tredjedel isär, och så vidare. De vandrar med uppspelningen: när ett
lämnar bakkanten kommer nästa in framifrån.

**Opacitet mellan ögonblicken** är där auran bottnar mellan de fulla. Ligger den i nivå med
ögonblickens egen opacitet är alla lika starka och rampen platt; med 0 släcks dalarna helt.
Tänk också på att hög opacitet gör att det främsta ögonblicket skymmer de bakom, oavsett hur
många toppar som är inställda. **Bågens form** ändrar kurvan mellan de två nivåerna: låga
värden ger breda toppar som nästan möts, höga ger spetsiga toppar med tydliga mellanrum.

### Vågen

Vågen låter det närmast uppspelningen synas starkast och tona ut åt båda håll, i stället för
att hela klippet syns lika mycket hela tiden. Den ligger under Ögonblick → Djupled, i två
underflikar med var sin uppsättning: **Bildrutan som spelas** gäller volymen, **Övriga
ögonblick** gäller ögonblicken i djupled och dyker upp först när Antal är över 1. De är
skilda åt så att den ena inte trycker ner den andras toppar. Lådans ytor lyser jämnt och
styrs per sida under Volym → Ytor och glas, så att en yta är hela sidans klarhet — inte ett
band som följer uppspelningen.

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

**Vrid ögonblicken efter kameran** vrider ögonblicken lika mycket som kameran är vinklad mot
lådans mittpunkt, fast åt motsatt håll, så att de står på diagonalen men behåller sin ordning
genom lådan. Lådan behåller sin fulla bredd: varje ögonblick sträcker sig från vägg till vägg
— utanför bildrutan smetas kanten ut, som på väggarna — och kapas av lådans fram- och baksida.
**Motsatt håll** vänder vridningen, och **Hur mycket** skalar den — kring halv styrka syns
lutningen tydligast.

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
