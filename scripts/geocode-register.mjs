// Bespoke, manually invoked one-time address lookup for this register only.
// Policy: https://operations.osmfoundation.org/policies/nominatim/
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registerPath = resolve(root, 'public/data/salons.json');
const cachePath = resolve(root, 'docs/geocoding-cache.json');
const salons = JSON.parse(readFileSync(registerPath, 'utf8'));
mkdirSync(resolve(root, 'docs'), { recursive: true });
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
const normalize = value => (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const manualReview = {
  'HA-019': 'Källan anger särskild entré via Sandgatan 1 och bron Spången. Rätt besöksentré behöver bekräftas.',
  'HA-027': 'Adressen ”Torsgatan 49 2” är tvetydig (gatunummer/våning). Behöver klarläggas före placering.',
};
const queryFor = salon => [salon.originalAddress || [salon.address, salon.postalCode, salon.city].filter(Boolean).join(', '), salon.country].filter(Boolean).join(', ');
const cacheKey = salon => JSON.stringify({ query: queryFor(salon), countrycodes: salon.country === 'Finland' ? 'fi,ax' : 'se' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

if (process.argv.includes('--fetch')) {
  const limit = Number(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] ?? Infinity);
  let requests = 0;
  for (const salon of salons) {
    if (salon.coordinates || manualReview[salon.id]) continue;
    const key = cacheKey(salon);
    if (cache[key]) continue;
    if (requests >= limit) break;
    // Always space requests out, including separate runs, and never parallelize/retry.
    await wait(1150);
    const params = new URLSearchParams({ q: queryFor(salon), countrycodes: salon.country === 'Finland' ? 'fi,ax' : 'se', format: 'jsonv2', addressdetails: '1', limit: '5', 'accept-language': 'sv' });
    const url = `https://nominatim.openstreetmap.org/search?${params}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'HaranalysNetwork-AddressReview/1.0 (+https://github.com/Haranalys/network; one-time local business-address import)', Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`${salon.id}: HTTP ${response.status}; avbryter utan automatiska återförsök.`);
    const results = await response.json();
    if (!Array.isArray(results)) throw new Error('Oväntat svar från geokodningstjänsten.');
    cache[key] = { fetchedAt: new Date().toISOString(), url, results };
    writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
    console.log(`${salon.id}: ${results.length} förslag sparade`);
    requests++;
  }
}

function assess(salon) {
  if (manualReview[salon.id]) return { status: 'needs-review', reason: manualReview[salon.id] };
  const entry = cache[cacheKey(salon)];
  if (!entry) return { status: 'not-queried', reason: 'Ingen sparad geokodning.' };
  const parts = salon.address?.match(/^(.*?)\s+(\d+\s*[a-zA-ZÅÄÖåäö]*)$/);
  if (!parts) return { status: 'needs-review', reason: 'Gatuadress och husnummer kan inte skiljas åt säkert.' };
  const street = normalize(parts[1]), number = normalize(parts[2]);
  const matches = entry.results.filter(result => {
    const a = result.address ?? {};
    const countryOk = salon.country === 'Finland' ? ['fi', 'ax'].includes(a.country_code) : a.country_code === 'se';
    const postcodeOk = !salon.postalCode || normalize(a.postcode) === normalize(salon.postalCode);
    const cityOk = salon.postalCode || [a.city, a.town, a.village, a.municipality].some(city => normalize(city) === normalize(salon.city));
    return countryOk && postcodeOk && cityOk && normalize(a.house_number) === number
      && normalize(a.road || a.pedestrian || a.residential) === street
      && Number.isFinite(Number(result.lat)) && Number.isFinite(Number(result.lon))
      && Number(result.lat) >= 54 && Number(result.lat) <= 70 && Number(result.lon) >= 10 && Number(result.lon) <= 32;
  });
  // Multiple OSM objects are acceptable only if the matching address points agree within ~30 m.
  const distinct = matches.filter((item, index) => !matches.slice(0, index).some(other =>
    Math.hypot((Number(item.lat) - Number(other.lat)) * 111000, (Number(item.lon) - Number(other.lon)) * 55000) < 30));
  if (distinct.length !== 1) {
    const exactHouse = entry.results.filter(result => normalize(result.address?.house_number) === number && normalize(result.address?.road) === street);
    const numbers = [...new Set(entry.results.map(result => result.address?.house_number).filter(Boolean))];
    const reason = !entry.results.length ? 'Ingen adress hittades.' : distinct.length > 1 ? 'Flera skilda adresspunkter matchar.'
      : exactHouse.length ? `Gata och husnummer matchar men postnummer/ort avviker: källan ${salon.postalCode ?? salon.city}, kartunderlaget ${[...new Set(exactHouse.map(result => result.address.postcode))].join(', ')}.`
        : numbers.length ? `Husnumret kan inte matchas exakt. Kartunderlaget anger ${numbers.join(', ')}; källan anger ${parts[2]}.`
          : 'Enbart gata/område hittades, ingen matchande adresspunkt med husnummer.';
    return { status: 'needs-review', reason };
  }
  const match = distinct[0];
  return { status: 'address-match', reason: 'Gata, husnummer, land och postnummer (eller ort där postnummer saknas) stämmer. Verksamhet och entré är inte aktualitetskontrollerade.', match, entry };
}

const review = salons.map(salon => ({ id: salon.id, name: salon.name, address: queryFor(salon), ...assess(salon) }));
writeFileSync(resolve(root, 'docs/geocoding-review.json'), JSON.stringify(review.map(({ entry, ...row }) => row), null, 2) + '\n');
if (process.argv.includes('--apply')) {
  for (const salon of salons) {
    const { status, reason, match, entry } = assess(salon);
    if (salon.coordinates) continue;
    salon.geocoding = { provider: 'Nominatim / OpenStreetMap', status, reason, query: queryFor(salon), fetchedAt: entry?.fetchedAt ?? cache[cacheKey(salon)]?.fetchedAt ?? null };
    if (status === 'address-match') {
      salon.coordinates = { lat: Number(match.lat), lng: Number(match.lon) };
      salon.geocoding.matchedAddress = match.display_name;
      salon.geocoding.osm = { type: match.osm_type, id: match.osm_id };
      salon.geocoding.licence = match.licence;
    }
  }
  writeFileSync(registerPath, JSON.stringify(salons, null, 2) + '\n');
}
console.log(JSON.stringify(review.map(({ id, name, status, reason, match }) => ({ id, name, status, reason, matchedAddress: match?.display_name })), null, 2));
const placed = salons.filter(salon => salon.coordinates);
const pending = review.filter(row => !salons.find(salon => salon.id === row.id)?.coordinates);
const table = rows => rows.map(row => `| ${row.id} | ${row.name.replaceAll('|', '\\|')} | ${row.reason.replaceAll('|', '\\|')} |`).join('\n');
writeFileSync(resolve(root, 'docs/geocoding-report.md'), `# Kartpositioner och markörer

Utgångsläge: 0 av 42 salonger hade giltiga koordinater. Kartkoden hoppade avsiktligt över poster utan koordinater; tester med syntetiska positioner visade att markörer kunde visas. Ingen annan spärr i koden hindrade dem.

Nu har **${placed.length} av ${salons.length}** poster sparade adresspositioner. **${pending.length}** ligger kvar i listan utan position och behöver adresskontroll. Inga ortscentrum eller gatumittpunkter har använts. En adressmatchning bekräftar inte att salongen finns kvar på adressen eller vilken entré som används.

## Geokodning

Nominatim / OpenStreetMap användes i ett manuellt initierat engångsjobb, med en tråd på en maskin, minst 1,15 sekunder mellan anrop, identifierande User-Agent och permanent lokal cache. Bara adressuppgifter skickades, inga kontaktpersoner eller kontaktuppgifter. [Användningspolicy](https://operations.osmfoundation.org/policies/nominatim/), [sök-API](https://nominatim.org/release-docs/latest/api/Search/), [ODbL och attribuering](https://www.openstreetmap.org/copyright).

Svaren finns i geocoding-cache.json och bedömningarna i geocoding-review.json. Godkända positioner i salons.json har källa, fråga, datum, matchad adress och OSM-id i geocoding. Anrop görs aldrig vid sidbesök. Koordinater accepteras endast vid matchande gata, exakt husnummer, land och postnummer (eller ort om postnummer saknas), utan skilda alternativa adresspunkter. Källadresserna har inte korrigerats automatiskt. Små skillnader mellan OSM-objekt för samma adress inom 30 meter behandlas som samma adress, inte som entréverifiering.

## Behöver kontrolleras

| ID | Salong | Orsak |
| --- | --- | --- |
${table(pending)}

## Placerade adressmatchningar

| ID | Salong | Matchad adress |
| --- | --- | --- |
${placed.map(salon => `| ${salon.id} | ${salon.name.replaceAll('|', '\\|')} | ${salon.geocoding?.matchedAddress ?? 'Tidigare sparad position'} |`).join('\n')}

## Kartbeteende

Startvyn och ”Visa alla träffar” anpassas efter alla placerade sökresultat. Efter sökning skapas markörer från samma urval som listan. Poster utan position finns kvar i listan. Brun cirkel betyder utbildning i hårbottenproblematik; guldfärgad cirkel med diplomsymbol ersätter grundsymbolen för diplomering enligt registret. Grönt D är ett positivt återförsäljartillägg och kan visas på båda. Saknad D-symbol innebär okänt, inte nej. Inga nya utbildningsnivåer har skapats.

Om markörer ligger inom 44 bildpunkter från varandra finns ”Fler salonger här” i informationsrutan med knappar för de andra salongerna. Även helt överlappande positioner kan därmed väljas utan att flytta eller förfalska koordinater. Varje kort med koordinater har också ”Visa på kartan”.
`);
