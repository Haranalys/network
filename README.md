# Håranalys · salongsregister

En fristående, statisk webbplats med Vite, TypeScript och Leaflet. Sökning, lista och karta använder samma filtrerade register. Allt sker i webbläsaren; ingen databas eller server krävs.

**Lokal testversion: preliminära, ej aktualitetskontrollerade uppgifter från frisörnätverket.** Registret har 42 Excel-poster: 41 i Sverige och en i Mariehamn, Åland, Finland. Efter separat geokodning har 14 entydiga adressmatchningar fått sparade koordinater; 28 behöver adresskontroll och finns bara i listan. En adressmatchning bekräftar inte att verksamheten finns kvar eller vilken entré som används. Namn, adresser och kontaktlänkar är bevarade. Lokala kontrollrapporter finns i `docs/geocoding-report.md` och `docs/import-report.md`; de ingår inte i Git-repot.

## Starta på Windows

Öppna PowerShell i projektmappen. Node.js och Git behöver finnas i Path. Node 22.12+ eller en senare kompatibel version rekommenderas. Projektet är verifierat med Node 26.13.1 och npm 11.20.0.

```powershell
npm.cmd install
npm.cmd run dev
```

Öppna adressen som Vite skriver ut, normalt **http://127.0.0.1:5173/**. Låt terminalen vara igång. Stoppa med Ctrl+C. `npm.cmd` fungerar även om PowerShell blockerar `npm.ps1`.

Kontrollera och förhandsvisa produktionsbygget:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run preview -- --port 4173 --strictPort
```

Öppna **http://127.0.0.1:4173/**. Ändringar kräver ett nytt bygge när du använder `preview`. `dev` uppdateras direkt. Efter att en låsfil finns kan `npm.cmd ci` användas för att installera exakt låsta beroenden.

Webbläsartester körs med `npm.cmd run test:e2e` efter bygget. De använder installerad Google Chrome och startar vid behov en tillfällig förhandsvisning. Om Chrome saknas kan du installera det eller välja en annan installerad kanal i `playwright.config.ts`. Testerna kontrollerar sökning, utbildningssymboler, DAIKON-tillägg, överlappande markörer, startvy, kortens innehåll, dator-/mobillayout och felaktigt register. De kontrollerar också att inga geokodningsanrop sker vid sidbesök.

## Uppdatera salongsregistret

Redigera **public/data/salons.json** i en texteditor. Filen ska vara giltig UTF-8 JSON: en lista med salongsobjekt, dubbla citattecken och inga kommentarer eller avslutande kommatecken. Ett objekt beskriver en salong; `people` kan innehålla flera personer.

```json
{
  "id": "unik-salong-001",
  "isDemo": true,
  "name": "Fiktiv exempelsalong",
  "city": "Exempelort",
  "address": null,
  "postalCode": null,
  "coordinates": null,
  "people": [{ "name": "Exempelperson", "educations": null }],
  "services": null,
  "daikonRetailer": null,
  "contact": {
    "website": null,
    "bookingUrl": null,
    "email": null,
    "phone": null
  }
}
```

* `id`: unikt, stabilt id. `name`: salongens namn. Dessa måste vara ifyllda.
* `isDemo`: `true` endast för fiktiva poster. Importerade riktiga poster har `false`, även när de inte är verifierade. `isPreliminary: true` markerar obekräftade verkliga uppgifter. Testbannern ska behållas tills registret aktualitetskontrollerats.
* `people[].educations`: utbildning för just den personen; i importen är detta okänt för samtliga. Äldre allmän utbildningsuppgift och diplomeringssymbol lagras separat under `legacy`. De kopplas inte automatiskt till varje person. Inga utbildningsnivåer har skapats.
* `services`: tjänster som salongen faktiskt erbjuder. Utbildning innebär inte automatiskt att en tjänst erbjuds, och används aldrig som tjänstefilter.
* `daikonRetailer`: `true` = bekräftat ja, `false` = uttryckligen bekräftat nej, `null` = okänt. Saknat fält och tom sträng normaliseras också till okänt, aldrig nej. Skriv booleska värden utan citattecken.
* Okända textfält kan vara `null`, `""` eller utelämnade. Okända listor och koordinater bör vara `null` eller utelämnade. Tomma uppgifter döljs i besökarvyn och tolkas aldrig som bekräftat nej.
* `coordinates`: `{ "lat": 59.3293, "lng": 18.0686 }`, eller `null`. Kontrollera riktiga positioner före import. Poster utan koordinater visas i listan och räknas i sökresultatet men får ingen kartmarkör. Ingen automatisk geokodning sker.
* `contact`: valfria kontaktuppgifter. Webblänkar ska börja med `https://` (även `http://` stöds). Tomma kontaktfält döljs. Innehåll från registret HTML-escapas; osäkra URL-protokoll används inte.

Sökningen matchar ort, salongsnamn och personnamn utan hänsyn till versaler eller svenska diakritiska tecken. Flera sökord måste alla matcha samma salong. Sökfält och tre filterknappar finns i en gemensam ruta som är bredare än kartan på dator och följer kartans bredd på mobil. Knapparna kan slås på/av med klick eller tangentbord och visar sitt läge med `aria-pressed`.

Grundutbildning inkluderar även diplomerade. Diplomeringsfiltret kräver diplomeringsuppgift i registret. De två utbildningsvalen kombineras som union; DAIKON och sökning begränsar detta urval. DAIKON kräver en positiv återförsäljaruppgift enligt samma logik som märkningen i korten, aldrig bara okänd status. Positiv äldre symbol räknas som registeruppgift, men ett uttryckligt aktuellt nej har företräde. Utan valda filter visas alla sökträffar. ”X av Y salonger” räknar även poster utan koordinater, och ”Rensa alla” återställer sökning och samtliga knappar. Vid noll träffar finns samma återställning i meddelandet.

Kartan visas först och den kompakta listan under, även på mobil. Lista och karta använder samma urval, men poster utan koordinater finns bara i listan. Tomma fält, kontrollanmärkningar och individuella preliminärmärken döljs i besökarvyn; alla uppgifter finns kvar i registret. En kort gemensam testupplysning visas ovanför sökningen.

## Importera Excel igen

Importen läser bladet **Salongsregister** utan Excel-installation eller extra paket. Den skriver över register och importdokumentation. Spara manuella korrigeringar i Excel först. Originalfilen ändras aldrig. Skriptet använder PowerShells `ExecutionPolicy Bypass` endast för den egna underprocessen som läser XLSX som ZIP/XML; ingen permanent systeminställning ändras.

```powershell
node scripts/import-register.mjs 'C:/register/Haranalys_salongregister.xlsx'
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

`docs/import-source.json` bevarar alla 26 originalkolumner inklusive tomma fält, radnummer och arbetsbokens SHA-256. `docs/import-report.md` redovisar alla saknade kartpositioner och föreslår geokodning följt av manuell adress-/entrékontroll. Tester jämför registerfälten mot källsnapshoten. ID:n kopieras oförändrade från Excel; poster slås aldrig ihop på namn, adress eller telefon. Personnamn delas vid semikolon och det uttryckliga ”och” i ”Carin och Anna”; originaltexten finns i snapshoten. Länkarna har inte funktionstestats eller korrigerats.

`legacy.diplomaSymbol` och `legacy.daikonSymbol` är `true` om symbolen finns på gamla sidan, annars `null`. Den gamla diplomeringssymbolen gäller salongens block. `daikonRetailer` hämtas enbart från **Säljer DAIKON idag**: Ja/Nej/Ej bekräftat blir true/false/null. Historisk symbol innebär aldrig automatiskt bekräftat ja idag. `legacy.educationStatement` bevarar den generella utbildningsuppgiften utan nivå eller kursdatum. `originalAddress` används vid visning för att behålla adressens ursprungliga ortsangivelser. Land, anmärkningar, kontrollstatus och källa sparas i `country`, `notes`, `verification` och `source`.

Importen stoppar vid okända symbolvärden, dubblett-ID:n, ofullständiga koordinater eller ett ifyllt fält för bekräftad utbildning som behöver kopplas till rätt person manuellt. Inga kartpositioner geokodas eller gissas. Kör tester och bygge efter ändringar; granska sidan. Registret valideras också i webbläsaren.

Vid Excel-omimport bevaras tidigare sparade koordinater och geokodningsmetadata för samma ID om gatuadress, originaladress, postnummer, ort och land är oförändrade och Excel inte har nya koordinater. Vid ändrad adress återställs positionen till okänd om Excel saknar koordinater, så att en gammal position inte följer med fel adress.

## Geokodning som separat engångsjobb

Geokodningen sker aldrig i webbplatsen. `scripts/geocode-register.mjs` är ett manuellt importverktyg enbart för detta register. Alla sparade svar och även uteblivna träffar cachas lokalt i `docs/geocoding-cache.json`. Bedömningarna finns i `docs/geocoding-review.json` och sammanställs i `docs/geocoding-report.md`. Dessa arbetsfiler ingår inte i Git. `--apply` använder bara sparade svar och skriver säkra matchningar till `salons.json` med källa, datum, matchad adress och OSM-id. En ny klon innehåller de färdiga koordinaterna i `salons.json`, men inte råcachen.

```powershell
# Granska sparade svar, utan nätverksanrop:
node scripts/geocode-register.mjs
# För över accepterade adressmatchningar från cache:
node scripts/geocode-register.mjs --apply
```

`--fetch` är endast för en avsiktligt initierad ny engångsgenomgång efter adresskorrigeringar och hämtar bara frågor som inte redan är cachade. Skriptet skickar endast adressuppgifter, en förfrågan i taget med minst 1,15 sekunder mellan anrop, identifierande User-Agent och utan automatiska återförsök. Inga privata/confidentiella uppgifter ska skickas. Läs alltid [Nominatims användningspolicy](https://operations.osmfoundation.org/policies/nominatim/) före en ny körning: högst ett anrop per sekund, en maskin/tråd för mindre engångsjobb, cache och attribuering krävs; återkommande mängdhämtning avråds och autocomplete är förbjudet. Det är ingen generell geokodningstjänst för besökare. Geokodade data kommer från OpenStreetMap, © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).

Ingen gatupunkt eller ortsmitt accepteras som ersättning för husnummer. Gata, exakt husnummer, land och postnummer (eller ort när postnummer saknas) måste stämma. Avvikande postnummer, flera skilda adresspunkter och otydliga adresser lämnas för manuell kontroll.

## Besökarvyn och markörer

Blå cirkel (#3478B8) visar utbildning i hårbottenproblematik enligt registeruppgiften. Lila cirkel (#7952B3) med vit diplomsymbol ersätter grundmarkören för diplomering enligt registret. Ett litet grönt D (#167568) med vit bokstav läggs till på båda för positiv DAIKON-markering. Symbolerna har vit kant och diskret skugga. Samma symboler används i filterknappar, kort och informationsrutor; ingen extra symbolförklaring upprepas. I listan har grundutbildningsraden alltid blå cirkel, även hos diplomerade som dessutom har lila diplomeringsmärkning. Uppgifterna kommer från frisörnätverket och innebär ingen ny utbildningsnivå eller aktualitetskontroll. Om varken utbildning eller diplomering är känd används en neutral cirkel utan kompetenspåstående.

Startvyn omfattar alla placerade sökresultat. Markörklick visar namn, personer, utbildningsuppgifter och tillgängliga kontakt-/bokningslänkar. ”Visa på kartan” i kortet fokuserar motsvarande markör. När markörer överlappar eller ligger inom 44 bildpunkter visas ”Fler salonger här” med valbara knappar i informationsrutan. Ingen koordinat flyttas för att få markörer att synas. Poster utan koordinater ligger kvar i listan och sammanfattas vid kartan.

Endast positiva markeringar visas som **Återförsäljare DAIKON**, både i kortet och kartans informationsruta. Märket visas för bekräftat aktuellt ja eller en positiv äldre symbol när aktuellt nej inte har bekräftats. Ett uttryckligt aktuellt nej har företräde framför en äldre symbol. Den gemensamma testupplysningen anger att uppgifterna inte är aktualitetskontrollerade. Varken nej eller okänd status visas som text eller märke. Registerfälten och deras trevärdeslogik är oförändrade.

Utbildningar visas bara när det finns uppgifter. Bekräftade personutbildningar ligger vid respektive namn. Allmän utbildningsuppgift och diplomering från gamla sidan visas på salongsnivå med källangivelse, utan påhittade nivåer.

## Kartleverantör och villkor

**public/map-config.json** styr bakgrundskartan separat från register och kod. Ändra `tileUrl`, `attribution`, `maxZoom`, `name` och `policyUrl` för att byta till en annan Leaflet-kompatibel rasterleverantör. URL-mallen använder `{z}`, `{x}` och `{y}`. Inställningen är en publik fil och får inte innehålla privata nycklar; använd bara leverantörens domänbegränsade publika webbkartsnycklar om sådana behövs. Attribueringen är betrodd administratörs-HTML och får bara redigeras av projektägaren.

Standardkartan använder OpenStreetMaps publika rasterplattor med korrekt synlig attribuering: © OpenStreetMap contributors. Se [tile policy](https://operations.osmfoundation.org/policies/tiles/) och [datavillkor/attribuering](https://www.openstreetmap.org/copyright). Webbläsaren skickar normal User-Agent och Referer och hanterar HTTP-cache. Sidan sätter `strict-origin-when-cross-origin`; ändra inte till en policy som tar bort Referer för kartan. Ingen offlinehämtning, masshämtning, proxy eller förladdning används. Kartbilder hämtas först när kartytan visas.

OSM:s publika server saknar tillgänglighetsgaranti och ska inte behandlas som en obegränsad kommersiell karttjänst. Välj en leverantör vars kapacitet och villkor passar trafikvolymen inför skarp drift, behåll korrekt attribuering och lägg till en riktig kontaktadress på sajten. Granska den nya leverantörens villkor innan byte. Internet krävs för bakgrundskartan. Listan fungerar även om karttjänsten inte svarar. Logotyptexten HÅRANALYS använder lokalt lagrad Cormorant Garamond (public/fonts), med medföljande SIL Open Font License. Inga externa typsnittstjänster, analysverktyg eller bildtjänster används; kartan gör anrop till vald kartleverantör.

## Publicera senare (inget är publicerat)

Bygget skapar **dist/**. Hela mappen kan hostas som statiska filer. Inga hemligheter eller serverfunktioner behövs.

| Tjänst | Byggkommando | Utmatningsmapp |
| --- | --- | --- |
| Cloudflare Pages | `npm run build` | `dist` |
| Netlify | `npm run build` | `dist` |

Använd en kompatibel Node-version (t.ex. 22.12+). Netlify-inställningar finns i `netlify.toml`. För Cloudflare Pages anger du motsvarande inställningar i deras gränssnitt och Node 22 eller senare kompatibel version. Sajten förutsätter publicering på domänens rot. Ingen routing eller SPA-omskrivning behövs. `public/` kopieras automatiskt till `dist/` vid bygge; redigera källfilerna, inte `dist/`.

Projektets remote är `https://github.com/Haranalys/network.git`. Att spara källkoden på GitHub publicerar inte webbplatsen. Ingen hosting eller automatisk driftsättning har konfigurerats.

## Filer som sparas på GitHub

Källkod, konfiguration, tester, importverktyg, lokalt typsnitt med licens och `public/data/salons.json` ingår. Excel-register, hela `docs/` med privata källsnapshotar/kontrollrapporter/råcache, `.env`-filer, nyckelfiler, lokala verktygsinställningar, `node_modules`, byggresultat och testbilder undantas via `.gitignore` och ligger kvar lokalt.

Bygge och ordinarie tester fungerar med bara repots filer. Testet som jämför mot hela Excel-snapshoten körs endast om den privata filen finns lokalt och markeras annars som överhoppat. Kontroll mot råa geokodningssvar görs också endast när lokal cache finns; giltighet och metadata för de publicerade koordinaterna kontrolleras alltid. Inga privata arbetsunderlag behövs för webbplatsen.
