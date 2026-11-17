import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];
if (!input) throw new Error('Ange Excel-fil: node scripts/import-register.mjs <sökväg.xlsx>');
mkdirSync(resolve(root, 'docs'), { recursive: true });
const snapshotPath = resolve(root, 'docs/import-source.json');
const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(root, 'scripts/read-register.ps1'), '-InputPath', resolve(input), '-OutputPath', snapshotPath], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Kunde inte läsa Excel-filen');
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const registerPath = resolve(root, 'public/data/salons.json');
const previous = new Map(existsSync(registerPath) ? JSON.parse(readFileSync(registerPath, 'utf8')).map(salon => [salon.id, salon]) : []);
const ids = new Set();
const symbol = value => {
  if (value === 'Finns') return true;
  if (value == null || value === 'Saknas') return null;
  throw new Error(`Oväntat symbolvärde: ${value}`);
};
const currentStatus = value => {
  if (value === 'Ja') return true;
  if (value === 'Nej') return false;
  if (value == null || value === 'Ej bekräftat') return null;
  throw new Error(`Oväntad aktuell DAIKON-status: ${value}`);
};
const salons = snapshot.rows.map(({ row, fields: f }) => {
  const id = f.ID;
  if (!id || !f['Salong / verksamhet'] || ids.has(id)) throw new Error(`Saknat namn/id eller dubblett på rad ${row}`);
  ids.add(id);
  const lat = f.Latitud, lng = f.Longitud;
  if ((lat == null) !== (lng == null)) throw new Error(`Ofullständiga koordinater för ${id}`);
  const old = previous.get(id);
  const addressUnchanged = old && old.address === f.Gatuadress && old.postalCode === f.Postnummer
    && old.city === f.Ort && old.country === f.Land && old.originalAddress === f['Adress enligt sidan'];
  const coordinates = lat == null ? addressUnchanged ? old.coordinates : null : { lat: Number(lat.replace(',', '.')), lng: Number(lng.replace(',', '.')) };
  if (coordinates && (!Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng) || Math.abs(coordinates.lat) > 90 || Math.abs(coordinates.lng) > 180)) throw new Error(`Ogiltiga koordinater för ${id}`);
  if (f['Bekräftad utbildning / nivå']) throw new Error(`${id}: utbildning måste kopplas till rätt person manuellt före import.`);
  return {
    id, isDemo: false, isPreliminary: true,
    name: f['Salong / verksamhet'], city: f.Ort, country: f.Land,
    address: f.Gatuadress, postalCode: f.Postnummer, originalAddress: f['Adress enligt sidan'],
    coordinates,
    ...(addressUnchanged && old.geocoding && lat == null ? { geocoding: old.geocoding } : {}),
    people: f['Personer enligt sidan']?.split(/;|\s+och\s+/).map(name => ({ name: name.trim(), educations: null })) ?? null,
    services: f['Tjänster som erbjuds']?.split(';').map(service => service.trim()) ?? null,
    daikonRetailer: currentStatus(f['Säljer DAIKON idag']),
    legacy: {
      diplomaSymbol: symbol(f['Diplomerad-symbol på sidan']),
      daikonSymbol: symbol(f['DAIKON-symbol på sidan']),
      educationStatement: f['Utbildning enligt nätverkssidan'],
    },
    contact: { website: f['Webb / social sida'], bookingUrl: f.Bokningslänk, email: f['E-post'], phone: f.Telefon },
    notes: f['Anmärkning / namnkälla'],
    verification: { status: f.Kontrollstatus, confirmedAt: f['Bekräftat datum'], needsConfirmation: f['Behöver kompletteras / bekräftas'] },
    source: { file: snapshot.file, sheet: snapshot.sheet, row },
  };
});
writeFileSync(resolve(root, 'public/data/salons.json'), JSON.stringify(salons, null, 2) + '\n');
const missing = salons.filter(s => !s.coordinates);
const count = predicate => salons.filter(predicate).length;
const table = entries => entries.map(s => `| ${s.id} | ${s.name.replaceAll('|', '\\|')} | ${s.city ?? 'Okänd'} | ${s.country ?? 'Okänt'} |`).join('\n');
writeFileSync(resolve(root, 'docs/import-report.md'), `# Importkontroll: ${snapshot.file}

Lokal testversion. Samtliga uppgifter är preliminära och kommer från ett äldre nätverk; de är inte aktualitetskontrollerade. Arbetsbokens innehåll används som data, inte som instruktioner. Inga salonger har kontaktats och inga länkar har ändrats eller funktionstestats. Excel-importen gör inga geokodningsanrop; sparade positioner bevaras vid oförändrad adress. Se [kartpositionsrapporten](geocoding-report.md) för separat geokodning och kontrollpunkter.

Källblad: ${snapshot.sheet}. SHA-256 för arbetsboken: \`${snapshot.sha256}\`. Alla 26 originalkolumner, inklusive tomma fält, finns i [import-source.json](import-source.json), med Excel-radnummer för jämförelse. Importen skriver bara lokala filer. Registret är [salons.json](../public/data/salons.json).

| Kontroll | Antal |
| --- | ---: |
| Importerade poster / unika oförändrade ID:n | ${salons.length} |
| Sverige | ${count(s => s.country === 'Sverige')} |
| Finland (Mariehamn, Åland) | ${count(s => s.country === 'Finland')} |
| Fiktiva poster | ${count(s => s.isDemo)} |
| Saknar kartposition | ${missing.length} |
| Diplomerad-symbol finns på gamla sidan | ${count(s => s.legacy.diplomaSymbol === true)} |
| Diplomeringsuppgift okänd (symbol saknas) | ${count(s => s.legacy.diplomaSymbol === null)} |
| DAIKON-symbol finns på gamla sidan | ${count(s => s.legacy.daikonSymbol === true)} |
| Äldre DAIKON-uppgift okänd (symbol saknas) | ${count(s => s.legacy.daikonSymbol === null)} |
| Aktuell DAIKON-status okänd | ${count(s => s.daikonRetailer === null)} |
| Tjänster okända | ${count(s => s.services === null)} |

## Tolkning

ID:n HA-001–HA-042 behålls exakt från Excel, även vid omimport. Namn, adresser, telefonnummer och länkar bevaras; originaladressen visas för att inte tappa orts-/entréinformation. Personnamn delas vid semikolon och det uttryckliga ”och” i ”Carin och Anna”; den ursprungliga texten finns kvar i källsnapshoten. Inga efternamn fylls i.

Diplomeringssymbolen hör till salongens block på den gamla sidan och tilldelas inte automatiskt varje person. Den allmänna utbildningsuppgiften sparas under legacy.educationStatement, inte som bekräftad kurs per person. Inga utbildningsnivåer skapas. Saknad symbol blir null, aldrig false. Den äldre DAIKON-symbolen och aktuell DAIKON-status är separata fält.

## Poster utan kartposition

Alla dessa poster finns i listan. Ingen ortscentrumposition används som ersättning.

| ID | Salong / verksamhet | Ort | Land |
| --- | --- | --- | --- |
${table(missing)}

## Särskilda uppgifter att kontrollera

* HA-004 Hamnsalongerna och HA-005 Hårservice har samma fasta telefon men olika adresser. De behålls som två separata poster.
* HA-027 Kim Beauty Room: ”Torsgatan 49 2” behöver klarläggas (gatunummer/våning).
* HA-019 Ekofrisören: källan nämner ingång via Sandgatan 1 och bron Spången. Bekräfta rätt entré.
* HA-042 Skönhetsmagasinet: Mariehamn ligger i Finland. Webblänken pekar på klipphornanydre.se, samma som HA-041; den är bevarad men bör kontrolleras särskilt.
* HA-003 StudioSelindas saknar postnummer. Flera arbetsnamn är enligt arbetsbokens anmärkningar tolkade från länkar/logotyper; dessa är inte verifierade företagsnamn.

## Förslag: geokoda och granska

1. Bekräfta besöksadress och verksamhet med salongen. Utgå från gatuadress, postnummer, ort och land; behandla Mariehamn som Finland. Lös tvetydiga adresser och entréer först.
2. Välj en geokodningstjänst vars villkor tillåter engångsimport och lagring. Kör separat från besökarnas sökning. Spara förslag per stabilt ID tillsammans med sökfråga, matchad adress, leverantör, precision och granskningsdatum.
3. Granska varje förslag på kartan mot adress och rätt entré. Acceptera inte bara en träff på orts- eller postnummernivå. Behåll coordinates: null för osäkra eller uteblivna träffar.
4. För över godkända WGS84-koordinater till registret och notera vem som kontrollerat dem och när. Kontrollera kontaktuppgifter, utbildning per person, tjänster och aktuell DAIKON-status separat.

Om ni väljer den publika Nominatim-tjänsten måste ni först läsa dess [användningspolicy](https://operations.osmfoundation.org/policies/nominatim/). Begränsningar omfattar högst en förfrågan per sekund, identifierande User-Agent/Referer, attribuering och cache. Mindre engångsjobb kan vara tillåtna med en enda tråd på en maskin; återkommande/mängdhämtning avråds och autocomplete är förbjudet. Skicka inte personuppgifter eller konfidentiellt material. Ingen sådan tjänst är inbyggd eller anropad i denna import.
`);
console.log(JSON.stringify({ imported: salons.length, missingCoordinates: missing.length, diplomaSymbols: count(s => s.legacy.diplomaSymbol === true), daikonSymbols: count(s => s.legacy.daikonSymbol === true) }));
