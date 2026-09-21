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
tillbaka efter en ändring (dubbelklick på reglaget återställer det). Tärningen **🎲 Slumpa**
i toppraden slumpar fram en ny look av de reglage som får slumpas — se gruppen **Slumpa**.

| Grupp | Vad det gör |
| --- | --- |
| **Volym** | Sammanhanget: lådan som klippet byggs in i. Antal bildrutor och upplösning i 3D-texturen — fria tal, skriv vad du vill (2–512 bildrutor, 32–720 px). Raden under visar vad valet kostar i minne och om volymen är byggd med just de värdena. Ändring kräver **Bygg om volym**, som går att trycka på så fort ett klipp är laddat — även med oförändrade värden, för att göra om ett bygge som blev fel eller avbröts. Djupet är ett reglage upp till 5; **Utöka djupet…** öppnar ett fritt fält där du skriver vad du vill upp till 200. **Storlek fram/bak** gör lådan till en tratt: olika storlek på ändarna får innehållet att växa eller krympa genom flödet. Längst ner lådans egna kanter — kantlinjer och kantglöd — samt den vikbara gruppen **Ytor och glas** med glasreflexen och en yta per sida (fram, bak, vänster, höger, tak, botten) och bakgrundsfärgen. |
| **Form och tid** | Tiden som form i rummet. **Form** böjer klippet runt en axel (cylinder, donut, boll, spiral), rundar och vrider det; **Bana** låter bildrutorna slingra åt sidorna och upp och ner och snurra; **Tid** låter tiden gå fram och tillbaka eller hoppa i bitar över hela klippet. |
| **Utseende** | Helheten inne i lådan: innehåll (bild/rörelse), material (rök, vätska, krom, gelé), bakgrundsborttagning med tröskel, blandning, densitet, rörelsedimma, exponeringsbotten och -tak (fönstret däremellan dras ut till full skala — bildrutan som spelas och de fulla ögonblicken behåller sitt ljus), ljusstyrka, mättnad, färg efter tid, renderingskvalitet och sist toningen vid klippets ändar. |
| **Partiklar** | Gör om tidskuben till partiklar som kan slungas ut, falla med gravitation, studsa mot en behållare, virvla och dras tillbaka till bilden. |
| **Ögonblick** | Bildrutorna som skarpa plan — flera tider samtidigt. En flik per riktning: djupled (tiden), sidled (X) och höjdled (Y), var och en med antal, position, uppspelning/svep och opacitet. Under Djupled ligger också mönstret mellan ögonblicken: vågen i två underflikar (Bildrutan som spelas och Övriga ögonblick) samt rampen — opacitet mellan ögonblicken, hur många som lyser för fullt och Bågens form. Antalet går till 256; 0 (eller avbockat) stänger av riktningen och gråar ut resten av flikens reglage. Fliken **Prisma** viker ögonblickens bilder över på snitten i sidled och höjdled. |
| **Special** | Vrider ögonblicken mot kameravinkeln — i sidled, i höjdled eller båda — med håll och styrka. Här bor också **Stereogram**: två ögonvyer sida vid sida som ger äkta 3D med korsblick eller parallellblick, utan glasögon. |
| **AI-djup (5D)** | En AI-modell skattar djupet i bildrutorna direkt i webbläsaren, och **Relief** låter ögonblicken bukta mot betraktaren där det är nära. |
| **Kamera** | Följ ögonblicket, fri musstyrning, pendel eller rotation, hastighet och brännvidd. |
| **Export** | Bildformat (1:1, 4:5, 9:16, 16:9), bildfrekvens, kvalitet, antal varv och om ljudet ska med. |
| **Slumpa** | Tärningen 🎲 i toppraden slumpar looken. **Välj vad som får slumpas** visar en tärning intill varje reglage: tänd = får slumpas, släckt = fredas. Bygget och exporten rörs aldrig; kamera, rum och de tyngsta valen är släckta från början. |
| **Sparade inställningar** | Längst ner: namngivna uppsättningar av alla reglage — spara, hämta tillbaka, ta bort — samt en kort kod för att dela eller flytta en uppsättning. |

### Formen

Under **Form och tid → Form** kan bildrutorna läggas i en cirkel i stället för rakt bakåt.
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

Med **Följ ögonblicket** påslaget snurrar en böjd form runt sin axel i stället för att
kameran åker, så att bildrutan som spelas står still och resten av formen vandrar förbi. Ett
helt varv går därför runt sömlöst när klippet börjar om. Djupet under Volym gäller inte
när formen är böjd. Tratten (Storlek fram och bak), loopläget, bakgrundsborttagningen,
exponeringsfönstret, färg efter tid och rörelsedimman gäller även formerna; vridningen under
Special, solfjädern och AI-reliefen gäller bara den raka lådan.

### Bana

**Form och tid → Bana** låter bildrutorna vandra i stället för att gå rakt: **Åt sidorna** och
**Upp och ner** är hur långt (i halva bildbredder och bildhöjder), **Snurra** hur mycket de
vrider sig fram och tillbaka. **Mjukhet** styr hur lugnt banan slingrar, och **Rörelse** får
den att röra sig över tid. **Ny slump** ger en annan bana. Allt fungerar ihop med formerna,
så en donut kan slingra och en spiral snurra.

### Tid

**Form och tid → Tid** gör tiden olinjär längs formen. **Fram och tillbaka** låter tiden gå
växelvis framåt och bakåt: värdet är hur långt tillbaka varje sväng går, **Takt** hur många
svängar det blir, **Oregelbundenhet** gör svängarna olika långa och **Rörelse** får mönstret
att vandra. **Hoppa i tiden** delar formen i bitar, var och en med en lika lång bit ur en
annan del av klippet — 0,5 sekunder här, 0,5 sekunder där. **Bitarnas längd** anges i
sekunder, och hoppen går från 0 (i ordning) till 1 (helt utspridda). När en tid finns på
flera ställen visas ögonblicket på alla dem.

### Innehåll

* **Rörelse** (standard) — varje punkt visar skillnaden mot nästa bildruta. Det som står still
  blir svart, och det som rör sig ritar banor genom lådan. Det är det som ger innehåll i mitten;
  i bildläget blir mitten annars summan av allt och därmed en jämn gröt utan struktur.
  **Rörelsekänslighet** styr hur mycket små rörelser förstärks.
* **Rörelsedimma** — en självlysande dimma som glöder där det rör sig i klippet, ovanpå
  vilket innehållsläge som helst, så att banorna syns genom lådan.
* **Bild** — råa bildrutor. Ger den lugnare, rökiga looken där lådans ytor dominerar.
* **Bild + rörelse** — bilden i botten och rörelsebanorna lysande ovanpå.
* **Ta bort bakgrunden** — en bakgrundsbild räknas fram ur hela klippet (tidsmedianen per
  bildpunkt), och allt som ligger nära den släcks: kvar blir det som rör sig eller skiljer
  sig, svävande fritt i lådan. **Bakgrundströskel** avgör hur stor skillnaden måste vara —
  höj om bakgrunden skimrar kvar, sänk om motivet äts upp. Fungerar bäst när kameran i
  klippet står still.
* **Färg efter tid** — tonar varje ögonblick efter var i klippet det hör hemma: början röd,
  mitten grön, slutet blå. Tiden blir en färgskala genom lådan; i loopläget går skalan hela
  varvet runt så att skarven inte byter färg. Med **Mättnad** 0 blir det ren tidsfärg.

### Ögonblicken

Ögonblicken är tidssnitten: bildrutor som skarpa plan tvärs genom lådan, så att flera tider
syns samtidigt. **Antal** lägger ut dem med jämna mellanrum, och alla följer uppspelningen.
**Loopa genom lådan** vänder på det: snitten står still och klippet rullar cykliskt igenom —
bildrutan som spelats förbi kommer in längst bak igen, och kameran behöver aldrig flytta sig.
**Följda bildrutans läge** väljer var i lådan den spelade bildrutan står: längst fram, i
mitten eller längst bak. **Mjuka skarven** blandar klippets slut och början över en ställbar
andel, så att brytningen som annars vandrar genom lådan försvinner.
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

### Material

Standard är **Rök**, där allt längs strålen vägs ihop. De andra materialen gör innehållet
till en yta i stället: allt som är ljusare än **Nivå** (i läget Rörelse: allt som rör sig mer
än den) blir en sammanhängande form, och där strålen träffar dess kant ritas en yta med
speglingar och högdagrar.

* **Vätska** — blank och genomskinlig, med innehållets färg i kroppen. **Klarhet** styr hur
  mycket man ser igenom den.
* **Krom** — speglar en påhittad studio, lätt färgad av innehållet. Tät.
* **Gelé** — mjuk och mättad, med svag spegling.

**Mjukhet** läser innehållet ur en suddigare version av volymen, så att ytan blir rundare och
mindre brusig; låga värden ger skarpa, krispiga former. **Glans** styr speglingar och
högdagrar. Vågen och toningen vid ändarna gäller även här, så en kort våg ger en vätska som
bara finns kring bildrutan som spelas. Lådans väggar (eller formens yta) blir vätskans kant
där den är full, som i en behållare.

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

### Partiklar

**Gör om till partiklar** byter volymen mot ett punktmoln. Partiklarna hämtas ur volymen —
ur det som är ljust, eller i läget Rörelse ur det som rör sig — och får färgen därifrån. De
ligger där formen säger, så en donut blir en ring av partiklar. Vågen under Utseende gäller
dem också, så tider nära uppspelningen lyser starkast.

**Slunga ut** skjuter iväg dem från mitten med **Kraft utåt**, och **Slunga ut var n:e
sekund** gör det av sig självt. Med **Gravitation** faller de mot behållarens golv, där de
studsar (**Studs**) och bromsas upp. **Dras tillbaka** drar dem mot sina platser i bilden,
så att tidskuben byggs upp igen efter varje utkast — sätt den till 0 för att låta dem ligga
kvar. **Virvel** får dem att snurra runt i ett mjukt flöde, och **Samla ihop** lägger dem på
plats direkt. Behållaren är lådan runt formen, förstorad med **Behållarens storlek**.
**Visa volymen också** ritar volymen bakom partiklarna. Rörelsen räknas på grafikkortet, så
även 262 000 partiklar går lätt.

### Prisma

**Ögonblick → Prisma** får ögonblicken och snitten i sidled och höjdled att samverka. Där ett
ögonblick möter ett sidosnitt viker bilden från ögonblickets tid över på sidosnittet, som om
bildrutan böjdes runt hörnet: bildens högra del fortsätter bakåt längs sidosnittet och den
vänstra framåt. **Styrka** blandar in det, **Räckvidd** är hur långt bilden hinner vika ut
innan den tonar bort, och **Regnbåge** låter färgerna vika olika långt, som ljus genom ett
prisma. **Följer kameran** förskjuter bilden efter hur man tittar, så att den glider när
kameran rör sig — det är det som ger hologramkänslan. **Prova hologram** ställer in glesa
ögonblick och några sidosnitt att börja från. Prismat fungerar också i de fria formerna.

### Special

**Vrid ögonblicken efter kameran** vrider ögonblicken lika mycket som kameran är vinklad mot
lådans mittpunkt, fast åt motsatt håll, så att de står på diagonalen men behåller sin ordning
genom lådan. Lådan behåller sin fulla bredd: varje ögonblick sträcker sig från vägg till vägg
— utanför bildrutan smetas kanten ut, som på väggarna — och kapas av lådans fram- och baksida.
**Luta upp och ner (höjdled)** gör samma sak kring sidaxeln: ögonblicken lutar fram och bak
när kameran panorerar upp eller ner, och de två går att kombinera. **Motsatt håll** vänder
vridningen, och **Hur mycket** skalar den — kring halv styrka syns lutningen tydligast.

### Stereogram

**Stereogram (3D med blicken)** under Special delar bilden i två vyer, en per öga, med
**Djupstyrka** som vinkeln mellan dem. Korsa blicken tills de två bilderna glider ihop till en
tredje i mitten — den är tredimensionell på riktigt, utan glasögon. **Korsblick** (standard)
lägger högra ögats vy till vänster och funkar på alla skärmstorlekar; **Parallellblick** är
tvärtom och passar när bilderna är smala och skärmen hålls en bit bort. Börja med låg
djupstyrka och öka när ögonen har hittat rätt. Exporten spelas in likadant, så 3D-klippen går
att dela.

### Solfjädern

Under Ögonblick → Sidled kan snitten vinklas mot mitten: **Vinkla mot mitten (solfjäder)**
gör dem till plan genom lådans mittaxel, jämnt spridda i vinkel, i stället för att gå rakt
igenom — som bladen i en hologramfläkt. **Position** vrider solfjädern, **Svep automatiskt**
snurrar den runt axeln, **Snurrhastighet** styr hur fort och **Centrum (fram–bak)** flyttar
axeln i djupled.

### AI-djup (5D)

Under **AI-djup (5D)** kan en liten djupmodell (Depth Anything V2) skatta hur nära kameran
varje del av bilden är. **Beräkna djup (AI)** hämtar modellen (cirka 25–50 MB, bara första
gången — den läggs i webbläsarens cache) och räknar ut djupet för ett antal **nyckelrutor**;
bildrutorna däremellan tonas fram. Allt körs lokalt i webbläsaren, klippet laddas aldrig upp.
När djupet är klart styr **Relief** hur mycket ögonblicken buktar mot betraktaren där det är
nära: bildrutorna blir små landskap i stället för platta plan, och motivet kliver ut ur
snittet när kameran rör sig. Djupet hör till det byggda klippet och räknas om efter varje
nytt bygge.

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
4. `src/particles.js` väljer partiklar ur volymens data och simulerar dem på grafikkortet
   med `GPUComputationRenderer`: en textur för lägen och en för hastigheter.
5. `src/recorder.js` spelar in canvasen med `MediaRecorder` och lägger till ljudet från
   videon via Web Audio.
6. `src/code.js` packar inställningarna till delningskoden: bara värden som skiljer sig från
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
