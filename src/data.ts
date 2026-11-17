export interface Salon {
  id: string;
  isDemo: boolean;
  isPreliminary?: boolean;
  country?: string | null;
  originalAddress?: string | null;
  notes?: string | null;
  legacy?: { diplomaSymbol: true | null; daikonSymbol: true | null; educationStatement: string | null };
  name: string;
  city: string | null;
  address: string | null;
  postalCode: string | null;
  coordinates: { lat: number; lng: number } | null;
  position?: {
    precision: 'exact' | 'approximate';
    source: { provider: string; url: string; licence: string };
    reviewedOn: string;
    reviewNote?: string;
    uncertaintyMeters?: number;
    supportingUrls?: string[];
    method?: string;
  };
  people: { name: string; educations: string[] | null }[] | null;
  services: string[] | null;
  daikonRetailer: boolean | null;
  contact: { website: string | null; bookingUrl: string | null; email: string | null; phone: string | null };
}

export interface Filters {
  search: string;
  education: string;
  daikon: string;
  trained?: boolean;
  diploma?: boolean;
  retailer?: boolean;
}
// A confirmed current "no" overrides an older positive symbol. Unknown stays unknown in the register.
export function hasDaikonBadge(salon: Salon): boolean {
  return salon.daikonRetailer === true || (salon.daikonRetailer !== false && salon.legacy?.daikonSymbol === true);
}
export function educationSymbol(salon: Salon): 'diploma' | 'trained' | 'neutral' {
  if (salon.legacy?.diplomaSymbol === true) return 'diploma';
  const education = [salon.legacy?.educationStatement, ...(salon.people ?? []).flatMap(person => person.educations ?? [])].join(' ');
  return /h[åa]rbottenproblematik/i.test(education) ? 'trained' : 'neutral';
}
export const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('sv').trim();
export function filterSalons(salons: Salon[], filters: Filters): Salon[] {
  const terms = normalize(filters.search).split(/\s+/).filter(Boolean);
  return salons.filter(salon => {
    const searchable = normalize([salon.name, salon.city, ...(salon.people ?? []).map(person => person.name)].join(' '));
    return terms.every(term => searchable.includes(term))
      && ((!filters.trained && !filters.diploma)
        || (filters.trained && educationSymbol(salon) !== 'neutral')
        || (filters.diploma && educationSymbol(salon) === 'diploma'))
      && (!filters.retailer || hasDaikonBadge(salon))
      && (!filters.education || (filters.education === 'legacy:diploma' ? salon.legacy?.diplomaSymbol === true
        : filters.education === 'legacy:education' ? !!salon.legacy?.educationStatement
          : (salon.people ?? []).some(person => person.educations?.includes(filters.education))))
      && (!filters.daikon || (filters.daikon === 'legacy:symbol' ? salon.legacy?.daikonSymbol === true
        : filters.daikon === 'yes' ? salon.daikonRetailer === true
        : filters.daikon === 'no' ? salon.daikonRetailer === false : salon.daikonRetailer === null));
  });
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nullableText = (value: unknown) => value == null || typeof value === 'string';
const textList = (value: unknown) => value == null || (Array.isArray(value) && value.every(item => typeof item === 'string'));

/** Keep empty/unknown values distinct from an explicit false. Reject malformed imports. */
export function parseSalons(value: unknown): Salon[] {
  if (!Array.isArray(value)) throw new Error('Registret måste vara en JSON-lista.');
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const fail = () => { throw new Error(`Fel i salongspost ${index + 1}. Kontrollera fälten i salons.json.`); };
    if (!record(entry) || typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id)
      || typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.isDemo !== 'boolean') return fail();
    ids.add(entry.id);
    if (entry.isPreliminary != null && typeof entry.isPreliminary !== 'boolean') return fail();
    if (entry.position != null && (!record(entry.position)
      || !['exact', 'approximate'].includes(String(entry.position.precision))
      || !record(entry.position.source)
      || !['provider', 'url', 'licence'].every(key => typeof (entry.position as { source: Record<string, unknown> }).source[key] === 'string')
      || typeof entry.position.reviewedOn !== 'string')) return fail();
    if (![entry.country, entry.originalAddress, entry.notes].every(nullableText)) return fail();
    if (entry.legacy != null && (!record(entry.legacy)
      || ![entry.legacy.diplomaSymbol, entry.legacy.daikonSymbol].every(value => value === true || value === null)
      || !nullableText(entry.legacy.educationStatement))) return fail();
    if (![entry.city, entry.address, entry.postalCode].every(nullableText) || !textList(entry.services)) return fail();
    if (entry.daikonRetailer != null && entry.daikonRetailer !== '' && typeof entry.daikonRetailer !== 'boolean') return fail();
    if (entry.coordinates != null && (!record(entry.coordinates)
      || typeof entry.coordinates.lat !== 'number' || !Number.isFinite(entry.coordinates.lat) || Math.abs(entry.coordinates.lat) > 90
      || typeof entry.coordinates.lng !== 'number' || !Number.isFinite(entry.coordinates.lng) || Math.abs(entry.coordinates.lng) > 180)) return fail();
    if (entry.people != null && (!Array.isArray(entry.people) || !entry.people.every(person => record(person)
      && typeof person.name === 'string' && textList(person.educations)))) return fail();
    if (entry.contact != null && (!record(entry.contact)
      || !['website', 'bookingUrl', 'email', 'phone'].every(key => nullableText((entry.contact as Record<string, unknown>)[key])))) return fail();
    const contact = (entry.contact ?? {}) as Record<string, string | null>;
    return {
      ...entry,
      city: entry.city || null, address: entry.address || null, postalCode: entry.postalCode || null,
      coordinates: entry.coordinates ?? null, people: entry.people ?? null, services: entry.services ?? null,
      daikonRetailer: typeof entry.daikonRetailer === 'boolean' ? entry.daikonRetailer : null,
      contact: { website: contact.website || null, bookingUrl: contact.bookingUrl || null, email: contact.email || null, phone: contact.phone || null },
    } as Salon;
  });
}

export function safeWebUrl(value: string | null): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
