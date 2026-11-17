import { describe, expect, it } from 'vitest';
import register from '../public/data/salons.json';
import { educationSymbol, filterSalons, hasDaikonBadge, parseSalons, safeWebUrl } from './data';

// Private audit files stay local. A fresh checkout needs only the public registry.
const localAudits = import.meta.glob(['../docs/import-source.json', '../docs/geocoding-cache.json'], { eager: true, import: 'default' });
const source = (localAudits['../docs/import-source.json'] as { rows: { row: number; fields: Record<string, string | null> }[] } | undefined) ?? null;
const geocodingCache = (localAudits['../docs/geocoding-cache.json'] as Record<string, { results: { lat: string; lon: string }[] }> | undefined) ?? null;

const salons = parseSalons(register);
const filter = (search = '', education = '', daikon = '') => filterSalons(salons, { search, education, daikon });
describe('Excel-import och sökning', () => {
  it('kombinerar utbildningsval som union och DAIKON och sökning som snitt', () => {
    const base = salons[0];
    const examples = [
      { ...base, id: 'trained', name: 'Utbildad', legacy: { diplomaSymbol: null, daikonSymbol: null, educationStatement: 'Utbildning i hårbottenproblematik' } },
      { ...base, id: 'diploma', name: 'Diplomerad', legacy: { diplomaSymbol: true, daikonSymbol: true, educationStatement: null } },
      { ...base, id: 'unknown', name: 'Okänd', legacy: undefined, people: null },
    ];
    const data = parseSalons(examples);
    const apply = (trained = false, diploma = false, retailer = false, search = '') => filterSalons(data, { search, education: '', daikon: '', trained, diploma, retailer }).map(salon => salon.id);
    expect(apply()).toEqual(['trained', 'diploma', 'unknown']);
    expect(apply(true)).toEqual(['trained', 'diploma']);
    expect(apply(false, true)).toEqual(['diploma']);
    expect(apply(true, true)).toEqual(['trained', 'diploma']);
    expect(apply(false, true, true)).toEqual(['diploma']);
    expect(apply(true, true, true, 'Utbildad')).toEqual([]);
    expect(apply(false, false, true)).toEqual(['diploma']);
    expect(filterSalons(salons, { search: '', education: '', daikon: '', diploma: true, retailer: true })).toHaveLength(13);
  });
  it('visar endast positiv återförsäljarmärkning och låter aktuellt nej gå före äldre symbol', () => {
    expect(salons.filter(hasDaikonBadge)).toHaveLength(13);
    const marked = salons.find(salon => salon.legacy?.daikonSymbol === true)!;
    expect(hasDaikonBadge({ ...marked, daikonRetailer: false })).toBe(false);
    expect(hasDaikonBadge({ ...salons[0], daikonRetailer: true })).toBe(true);
    expect(hasDaikonBadge(salons[0])).toBe(false);
  });
  it('bevarar 42 källposter och stabila ID:n utan demoposter', () => {
    expect(salons).toHaveLength(42);
    expect(salons.map(s => s.id)).toEqual(Array.from({ length: 42 }, (_, index) => `HA-${String(index + 1).padStart(3, '0')}`));
    expect(new Set(salons.map(s => s.id)).size).toBe(42);
    expect(salons.every(s => !s.isDemo && s.isPreliminary)).toBe(true);
    expect(salons.filter(s => s.country === 'Sverige')).toHaveLength(41);
    expect(salons.filter(s => s.country === 'Finland')).toHaveLength(1);
  });
  it.skipIf(!source)('bevarar namn, personer, adresser och kontaktlänkar exakt mot lokal privat källsnapshot', () => {
    source!.rows.forEach(({ fields: f, row }, index) => {
      const salon = register[index];
      expect(salon.name).toBe(f['Salong / verksamhet']);
      expect(salon.address).toBe(f.Gatuadress);
      expect(salon.originalAddress).toBe(f['Adress enligt sidan']);
      expect(salon.postalCode).toBe(f.Postnummer);
      expect(salon.city).toBe(f.Ort);
      expect(salon.country).toBe(f.Land);
      expect(salon.contact).toEqual({ website: f['Webb / social sida'], bookingUrl: f.Bokningslänk, email: f['E-post'], phone: f.Telefon });
      expect(salon.people?.map(person => person.name) ?? null).toEqual(f['Personer enligt sidan']?.split(/;|\s+och\s+/).map(name => name.trim()) ?? null);
      expect(salon.source.row).toBe(row);
      expect(salon.notes).toBe(f['Anmärkning / namnkälla']);
      expect(salon.legacy.diplomaSymbol).toBe(f['Diplomerad-symbol på sidan'] === 'Finns' ? true : null);
      expect(salon.legacy.daikonSymbol).toBe(f['DAIKON-symbol på sidan'] === 'Finns' ? true : null);
    });
  });
  it('använder bara dokumenterade adressmatchningar och bevarar övriga okända uppgifter', () => {
    expect(salons.filter(s => s.coordinates)).toHaveLength(14);
    expect(salons.filter(s => !s.coordinates)).toHaveLength(28);
    const candidates = geocodingCache ? Object.values(geocodingCache).flatMap(entry => entry.results) : null;
    register.filter(salon => salon.coordinates).forEach(salon => {
      expect(salon.geocoding.status).toBe('address-match');
      expect(Number.isFinite(salon.coordinates!.lat) && Number.isFinite(salon.coordinates!.lng)).toBe(true);
      expect(salon.geocoding.provider).toBe('Nominatim / OpenStreetMap');
      if (candidates) expect(candidates.some(candidate => Number(candidate.lat) === salon.coordinates!.lat && Number(candidate.lon) === salon.coordinates!.lng)).toBe(true);
    });
    expect(salons.find(s => s.id === 'HA-027')?.coordinates).toBeNull();
    expect(salons.find(s => s.id === 'HA-019')?.coordinates).toBeNull();
    expect(salons.every(s => s.services === null && s.daikonRetailer === null)).toBe(true);
    expect(salons.every(s => (s.people ?? []).every(p => p.educations === null))).toBe(true);
    expect(filter('', 'legacy:diploma')).toHaveLength(31);
    expect(filter('', 'legacy:education')).toHaveLength(42);
    expect(filter('', '', 'legacy:symbol')).toHaveLength(13);
    expect(filter('', '', 'unknown')).toHaveLength(42);
    expect(filter('', '', 'no')).toHaveLength(0);
    expect(filter('', '', 'yes')).toHaveLength(0);
  });
  it('låter diplomering ersätta grundsymbolen utan att skapa nya utbildningsnivåer', () => {
    expect(salons.filter(salon => educationSymbol(salon) === 'diploma')).toHaveLength(31);
    expect(salons.filter(salon => educationSymbol(salon) === 'trained')).toHaveLength(11);
    expect(educationSymbol({ ...salons[0], legacy: undefined, people: null })).toBe('neutral');
  });
  it('hittar personer, orter och salonger med kombinerade filter', () => {
    expect(filter('Selinda grythyttan', 'legacy:diploma', 'legacy:symbol').map(s => s.id)).toEqual(['HA-003']);
    expect(filter('choices UPPSALA').map(s => s.id)).toEqual(['HA-037']);
    expect(filter('Pia Heikkila').map(s => s.id)).toEqual(['HA-005']);
    expect(filter('Mariehamn').map(s => s.id)).toEqual(['HA-042']);
    expect(filter('Uppsala', 'legacy:diploma')).toHaveLength(0);
    expect(filter('', 'Håranalys')).toHaveLength(0);
  });
  it('bevarar okänt, tillåter uttryckligt nej och avvisar felaktiga importer', () => {
    const empty = parseSalons([{ ...register[0], daikonRetailer: '', coordinates: null, people: null, services: null, contact: null }])[0];
    expect(empty.daikonRetailer).toBeNull();
    expect(empty.contact.website).toBeNull();
    expect(filterSalons(parseSalons([{ ...register[0], daikonRetailer: false }]), { search: '', education: '', daikon: 'no' })).toHaveLength(1);
    expect(() => parseSalons([{ ...register[0], daikonRetailer: 'nej' }])).toThrow();
    expect(() => parseSalons([{ ...register[0], legacy: { diplomaSymbol: false, daikonSymbol: null } }])).toThrow();
    expect(() => parseSalons([{ ...register[0], coordinates: { lat: 150, lng: 18 } }])).toThrow();
    expect(() => parseSalons([register[0], register[0]])).toThrow();
  });
  it('tillåter bara säkra webblänkar', () => {
    expect(safeWebUrl('javascript:alert(1)')).toBeNull();
    expect(safeWebUrl('https://example.com')).toBe('https://example.com/');
  });
});
