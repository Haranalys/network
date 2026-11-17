import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { educationSymbol, filterSalons, hasDaikonBadge, parseSalons, safeWebUrl } from './data';
import type { Salon } from './data';

const icons = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  diploma: '<path d="M6 3h12v12H6zM9 7h6M9 10h4"/><circle cx="15" cy="16" r="3"/><path d="m13 18-1 4 3-2 3 2-1-4"/>',
};
const icon = (name: keyof typeof icons) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <a class="skip-link" href="#results">Till salongslistan</a>
  <header class="site-header"><a class="brand" href="./" aria-label="Håranalys startsida">HÅRANALYS</a><span>Frisörnätverk</span></header>
  <main>
    <section class="intro" aria-labelledby="page-title"><h1 id="page-title">Hitta hjälp nära dig</h1><p>Hitta frisörer och behandlare. Sök på ort, salong eller person.</p></section>

    <form id="search-form" class="search-panel" role="search" aria-label="Sök och filtrera salonger">
      <label class="visually-hidden" for="search">Ort, salong eller person</label>
      <div class="input-wrap">${icon('search')}<input id="search" type="search" placeholder="Sök ort, salong eller person" autocomplete="off"></div>
      <div class="filter-groups">
        <fieldset><legend>Utbildning</legend><div class="education-options">
          <button type="button" class="filter-button trained" data-filter="trained" aria-pressed="false"><span class="qualification-symbol trained" aria-hidden="true"></span><span>Utbildning i hårbottenproblematik</span></button>
          <button type="button" class="filter-button diploma" data-filter="diploma" aria-pressed="false"><span class="qualification-symbol diploma" aria-hidden="true">${icon('diploma')}</span><span>Diplomerad i hårbottenproblematik</span></button>
        </div></fieldset>
        <fieldset><legend>Produkter</legend><button type="button" class="filter-button retailer" data-filter="retailer" aria-pressed="false"><span class="daikon-symbol" aria-hidden="true">D</span><span>Återförsäljare DAIKON</span></button></fieldset>
      </div>
      <div class="filter-summary"><span id="result-count" role="status" aria-live="polite">Läser in…</span><button type="reset" class="reset-button">Rensa alla</button></div>
    </form>
    <section class="map-panel" aria-label="Salongskarta"><div class="map-toolbar"><span>${icon('pin')}Salongskartan</span><button type="button" id="fit-map">Visa alla träffar ↗</button></div><div id="map" role="region" aria-label="Karta med salonger"></div><p id="map-status" class="map-status" role="status" hidden></p><div class="map-caption"><p id="map-coverage" hidden></p><a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">Rapportera kartfel ↗</a></div></section>
    <section class="directory" aria-labelledby="results"><div class="results-heading"><h2 id="results" tabindex="-1">Salonger</h2><span class="sort-note">A–Ö</span></div><div id="salon-list" class="salon-list"></div></section>
  </main>
  <footer class="site-footer"><span></span><span></span></footer>`;

const search = document.querySelector<HTMLInputElement>('#search')!;
const list = document.querySelector<HTMLDivElement>('#salon-list')!;
const count = document.querySelector<HTMLSpanElement>('#result-count')!;
const mapStatus = document.querySelector<HTMLParagraphElement>('#map-status')!;
const activeFilters = { trained: false, diploma: false, retailer: false };
const filterButtons = document.querySelectorAll<HTMLButtonElement>('[data-filter]');
let salons: Salon[] = [];
let results: Salon[] = [];
let map: L.Map | undefined;
let markerLayer: L.LayerGroup | undefined;
let selectedId: string | null = null;
const markers = new Map<string, L.Marker>();
const swedenBounds: L.LatLngBoundsExpression = [[55.2, 10.8], [69.15, 24.3]];

function address(salon: Salon) {
  return salon.originalAddress || (salon.address || salon.postalCode ? [salon.address, [salon.postalCode, salon.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '');
}
function retailerBadge(salon: Salon) {
  if (!hasDaikonBadge(salon)) return '';
  return `<span class="daikon-badge"><i class="daikon-symbol" aria-hidden="true">D</i>Återförsäljare DAIKON</span>`;
}
function qualificationSymbol(salon: Salon, withRetailer = false) {
  const kind = educationSymbol(salon);
  return `<span class="qualification-symbol ${kind}" aria-hidden="true">${kind === 'diploma' ? icon('diploma') : ''}${withRetailer && hasDaikonBadge(salon) ? '<i class="daikon-symbol marker-daikon">D</i>' : ''}</span>`;
}
function qualificationBadge(salon: Salon) {
  const kind = educationSymbol(salon);
  if (kind === 'neutral') return '';
  return `<span class="qualification-badge">${qualificationSymbol(salon)}${kind === 'diploma' ? 'Diplomerad i hårbottenproblematik' : 'Utbildning i hårbottenproblematik'}</span>`;
}
function educationDetails(salon: Salon) {
  const statement = salon.legacy?.educationStatement?.trim();
  if (!statement || educationSymbol(salon) === 'trained') return '';
  if (/h[åa]rbottenproblematik/i.test(statement)) {
    return '<span class="qualification-badge"><span class="qualification-symbol trained" aria-hidden="true"></span>Utbildning i hårbottenproblematik</span>';
  }
  return `<p class="education">${escape(statement.replace(/^Enligt nätverkssidan: gått utbildning i /i, 'Utbildning i '))}</p>`;
}
function peopleDetails(salon: Salon) {
  const people = (salon.people ?? []).map(person => {
    const educations = (person.educations ?? []).map(text => text.trim()).filter(Boolean);
    return `${person.name.trim() ? `<span class="person-name">${escape(person.name)}</span>` : ''}${educations.length ? `<span class="person-education">${educations.map(escape).join(', ')}</span>` : ''}`;
  }).filter(Boolean);
  return people.length ? `<div class="people">${people.map(person => `<p>${person}</p>`).join('')}</div>` : '';
}
function contactLinks(salon: Salon) {
  const links: string[] = [];
  const booking = safeWebUrl(salon.contact.bookingUrl);
  const website = safeWebUrl(salon.contact.website);
  if (booking) links.push(`<a class="booking-link" href="${escape(booking)}" target="_blank" rel="noopener noreferrer">Boka tid ↗</a>`);
  if (website) links.push(`<a href="${escape(website)}" target="_blank" rel="noopener noreferrer">Webbplats ↗</a>`);
  const { email, phone } = salon.contact;
  if (email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) links.push(`<a href="mailto:${escape(encodeURIComponent(email))}">E-post</a>`);
  if (phone) phone.split(/\s+eller\s+|;/).map(number => number.trim()).filter(Boolean).forEach(number => {
    links.push(/^[+\d()\s-]+$/.test(number) ? `<a href="tel:${escape(number.replace(/[^+\d]/g, ''))}">${escape(number)}</a>` : `<span>${escape(number)}</span>`);
  });
  return links.length ? `<div class="contact-links">${links.join('')}</div>` : '';
}
function card(salon: Salon) {
  const article = document.createElement('article');
  article.className = `salon-card${selectedId === salon.id ? ' selected' : ''}`;
  article.dataset.id = salon.id;
  const location = [salon.city, salon.country && salon.country !== 'Sverige' ? salon.country : null].filter(Boolean).join(' · ');
  const streetAddress = address(salon);
  const services = (salon.services ?? []).map(text => text.trim()).filter(Boolean);
  article.innerHTML = `<div class="salon-identity"><h3>${escape(salon.name)}</h3>${location ? `<p class="city">${escape(location)}</p>` : ''}${streetAddress ? `<p class="address">${escape(streetAddress)}</p>` : ''}${retailerBadge(salon)}</div><div class="salon-details">${peopleDetails(salon)}${qualificationBadge(salon)}${educationDetails(salon)}${services.length ? `<p class="services">${services.map(escape).join(' · ')}</p>` : ''}</div><div class="salon-contact">${contactLinks(salon)}${salon.coordinates ? `<button type="button" class="on-map" aria-label="Visa ${escape(salon.name)} på kartan">${icon('pin')}Visa på kartan</button>` : ''}</div>`;
  article.querySelector('button')?.addEventListener('click', () => selectSalon(salon.id, true));
  return article;
}
function selectSalon(id: string, openMap: boolean) {
  selectedId = id;
  list.querySelectorAll<HTMLElement>('.salon-card').forEach(element => element.classList.toggle('selected', element.dataset.id === id));
  if (openMap) {
    const marker = markers.get(id);
    if (marker && map) {
      map.setView(marker.getLatLng(), 13);
      openSalonPopup(salonById(id)!, marker);
      document.querySelector('.map-panel')!.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}
function salonById(id: string) { return results.find(salon => salon.id === id); }
function openSalonPopup(salon: Salon, marker: L.Marker) {
  if (!map) return;
  const popup = document.createElement('div');
  popup.className = 'salon-popup';
  const location = address(salon) || [salon.city, salon.country].filter(Boolean).join(', ');
  popup.innerHTML = `<h3>${escape(salon.name)}</h3>${location ? `<p>${escape(location)}</p>` : ''}${peopleDetails(salon)}${qualificationBadge(salon)}${educationDetails(salon)}${retailerBadge(salon)}${contactLinks(salon)}`;
  const point = map.latLngToContainerPoint(marker.getLatLng());
  const neighbours = results.filter(other => other.id !== salon.id && other.coordinates
    && point.distanceTo(map!.latLngToContainerPoint([other.coordinates.lat, other.coordinates.lng])) < 44);
  if (neighbours.length) {
    const choices = document.createElement('div');
    choices.className = 'nearby-salons';
    choices.innerHTML = '<p>Fler salonger här</p>';
    neighbours.forEach(other => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = other.name;
      button.addEventListener('click', () => {
        const otherMarker = markers.get(other.id);
        if (otherMarker) { selectSalon(other.id, false); openSalonPopup(other, otherMarker); }
      });
      choices.append(button);
    });
    popup.append(choices);
  }
  L.popup({ maxHeight: 340, minWidth: 220 }).setLatLng(marker.getLatLng()).setContent(popup).openOn(map);
}
function fitResults() {
  if (!map) return;
  map.invalidateSize();
  const locations = results.flatMap(salon => salon.coordinates ? [L.latLng(salon.coordinates.lat, salon.coordinates.lng)] : []);
  if (locations.length) map.fitBounds(L.latLngBounds(locations), { padding: [35, 35], maxZoom: 12 });
  else map.fitBounds(swedenBounds, { padding: [16, 16] });
}
function renderMarkers() {
  map?.closePopup();
  markerLayer?.clearLayers(); markers.clear();
  if (!map || !markerLayer) return;
  results.forEach(salon => {
    if (!salon.coordinates) return;
    const marker = L.marker([salon.coordinates.lat, salon.coordinates.lng], {
      icon: L.divIcon({ className: 'salon-marker-wrap', html: qualificationSymbol(salon, true), iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -18] }),
      title: `${salon.name}${educationSymbol(salon) === 'diploma' ? ' · Diplomerad i hårbottenproblematik' : ''}${hasDaikonBadge(salon) ? ' · Återförsäljare DAIKON' : ''}`,
      alt: [salon.name, salon.city].filter(Boolean).join(', '),
    });
    marker.on('click', () => { selectSalon(salon.id, false); openSalonPopup(salon, marker); }).addTo(markerLayer!);
    markers.set(salon.id, marker);
  });
}
function render() {
  results = filterSalons(salons, { search: search.value, education: '', daikon: '', ...activeFilters });
  selectedId = null;
  count.textContent = `${results.length} av ${salons.length} salonger`;
  const missingCoordinates = results.filter(salon => !salon.coordinates).length;
  const coverage = document.querySelector<HTMLParagraphElement>('#map-coverage')!;
  coverage.hidden = missingCoordinates === 0;
  coverage.textContent = `${missingCoordinates} ${missingCoordinates === 1 ? 'salong inväntar' : 'salonger inväntar'} adresskontroll och visas bara i listan.`;
  list.replaceChildren(...results.map(card));
  if (!results.length) {
    list.innerHTML = '<div class="empty-state"><h3>Inga salonger hittades</h3><p>Prova en annan sökning eller färre filter.</p><button type="button">Rensa alla</button></div>';
    list.querySelector('button')!.addEventListener('click', reset);
  }
  renderMarkers(); fitResults();
}
function reset() {
  search.value = '';
  activeFilters.trained = activeFilters.diploma = activeFilters.retailer = false;
  filterButtons.forEach(button => button.setAttribute('aria-pressed', 'false'));
  render();
}
filterButtons.forEach(button => button.addEventListener('click', () => {
  const key = button.dataset.filter as keyof typeof activeFilters;
  activeFilters[key] = !activeFilters[key];
  button.setAttribute('aria-pressed', String(activeFilters[key]));
  render();
}));
document.querySelector('#fit-map')!.addEventListener('click', fitResults);
document.querySelector('#search-form')!.addEventListener('submit', event => event.preventDefault());
document.querySelector('#search-form')!.addEventListener('reset', event => { event.preventDefault(); reset(); });
search.addEventListener('input', render);

async function fetchJson(path: string) {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!response.ok) throw new Error(`Kunde inte läsa ${path} (${response.status}).`);
  return response.json();
}
async function initMap() {
  try {
    const config = await fetchJson('map-config.json');
    if (typeof config.tileUrl !== 'string' || !config.tileUrl.startsWith('https://') || typeof config.attribution !== 'string'
      || !Number.isInteger(config.maxZoom) || config.maxZoom < 5 || config.maxZoom > 22) throw new Error('Ogiltig kartkonfiguration.');
    map = L.map('map', { scrollWheelZoom: true, minZoom: 3, zoomControl: false, zoomSnap: 0.25 }).fitBounds(swedenBounds, { padding: [16, 16] });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer(config.tileUrl, { attribution: config.attribution, maxZoom: config.maxZoom }).on('tileerror', () => {
      mapStatus.hidden = false;
      mapStatus.textContent = 'Kartbakgrunden kunde inte läsas in. Salongerna finns i listan nedan.';
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    renderMarkers(); fitResults();
    new ResizeObserver(() => {
      map?.invalidateSize();
      if (!selectedId) fitResults();
    }).observe(document.querySelector('#map')!);
  } catch (error) {
    mapStatus.hidden = false;
    mapStatus.textContent = 'Kartan kunde inte starta. Du kan söka i listan nedan.';
    console.error(error);
  }
}
async function initSalons() {
  try {
    salons = parseSalons(await fetchJson('data/salons.json')).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    render();
  } catch (error) {
    count.textContent = '– kunde inte läsas in';
    list.innerHTML = '<div class="empty-state"><h3>Registret är inte tillgängligt</h3><p>Försök läsa in sidan igen.</p><button type="button">Försök igen</button></div>';
    list.querySelector('button')!.addEventListener('click', () => location.reload());
    search.disabled = true;
    filterButtons.forEach(button => button.disabled = true);
    console.error(error);
  }
}
await Promise.allSettled([initSalons(), initMap()]);
