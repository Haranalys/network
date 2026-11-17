import { test, expect } from '@playwright/test';

test('kompakt register visar bara positiva DAIKON-markeringar och söker i alla poster', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hitta hjälp nära dig' })).toBeVisible();
  await expect(page.locator('.salon-card')).toHaveCount(42);
  await expect(page.locator('.salon-card .daikon-badge')).toHaveCount(13);
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(14);
  await expect(page.locator('.search-panel')).toBeVisible();
  await expect(page.locator('.symbol-legend')).toHaveCount(0);
  await expect(page.locator('.salon-card .qualification-badge .diploma')).toHaveCount(31);
  await expect(page.locator('.salon-card .qualification-badge .trained')).toHaveCount(42);
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.getByText(/uppgift saknas|säljer inte DAIKON|så läser du kartan/i)).toHaveCount(0);
  await page.getByRole('searchbox').fill('Pia Heikkila');
  await expect(page.locator('.salon-card')).toHaveCount(1);
  await expect(page.locator('.salon-card')).toContainText('Hårservice');
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);
  await expect(page.locator('.daikon-badge')).toHaveCount(0);
  await expect(page.locator('a[href="tel:0857034307"]')).toBeVisible();
  await expect(page.locator('a[href="tel:0704522415"]')).toBeVisible();
  await page.getByRole('searchbox').fill('Mariehamn');
  await expect(page.locator('.salon-card')).toContainText('Finland');
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0);
  await expect(page.locator('.salon-card a[href="https://www.klipphornanydre.se/"]')).toBeVisible();
  await page.getByRole('searchbox').fill('finns-inte');
  await expect(page.getByText('Inga salonger hittades')).toBeVisible();
  await page.locator('.empty-state button').click();
  await expect(page.locator('.salon-card')).toHaveCount(42);
  expect(errors).toEqual([]);
});

test('karta följs av lista på dator och mobil utan horisontell rullning', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('.salon-card')).toHaveCount(42);
    await expect(page.locator('#map')).toBeVisible();
    const map = await page.locator('.map-panel').boundingBox();
    const filters = await page.locator('.search-panel').boundingBox();
    if (width > 760) {
      expect(filters!.width).toBeGreaterThan(map!.width);
      expect(filters!.x + filters!.width / 2).toBeCloseTo(map!.x + map!.width / 2);
    } else {
      expect(filters!.width).toBe(map!.width);
      expect(filters!.x).toBe(map!.x);
    }
    const list = await page.locator('.directory').boundingBox();
    expect(map!.y + map!.height).toBeLessThanOrEqual(list!.y);
    const mapArea = await page.locator('#map').boundingBox();
    expect(mapArea!.height).toBeGreaterThan(mapArea!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('searchbox').fill('Uppsala');
    await expect(page.locator('.salon-card')).toHaveCount(1);
    await expect(page.locator('.salon-card')).toContainText('Choices Uppsala');
  }
});

test('filterknappar fungerar med tangentbord, kombineras och återställs med Rensa alla', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.salon-card')).toHaveCount(42);
  const trained = page.getByRole('button', { name: 'Utbildning i hårbottenproblematik', exact: true });
  const diploma = page.getByRole('button', { name: 'Diplomerad i hårbottenproblematik', exact: true });
  const retailer = page.getByRole('button', { name: 'Återförsäljare DAIKON', exact: true });
  await expect(page.locator('#result-count')).toHaveText('42 av 42 salonger');
  await diploma.focus();
  await page.keyboard.press('Enter');
  await expect(diploma).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.salon-card')).toHaveCount(31);
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(10);
  await retailer.focus();
  await page.keyboard.press('Space');
  await expect(retailer).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.salon-card')).toHaveCount(13);
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(4);
  await expect(page.locator('#result-count')).toHaveText('13 av 42 salonger');
  await trained.click();
  await expect(page.locator('.salon-card')).toHaveCount(13);
  await retailer.click();
  await expect(retailer).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.salon-card')).toHaveCount(42);
  await trained.click();
  await expect(page.locator('.salon-card')).toHaveCount(31);
  await page.getByRole('searchbox').fill('Pia');
  await expect(page.getByText('Inga salonger hittades')).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0);
  await page.locator('.empty-state').getByRole('button', { name: 'Rensa alla' }).click();
  await expect(page.locator('.salon-card')).toHaveCount(42);
  await expect(page.getByRole('searchbox')).toHaveValue('');
  for (const button of [trained, diploma, retailer]) await expect(button).toHaveAttribute('aria-pressed', 'false');
  await diploma.click();
  await retailer.click();
  await page.getByRole('searchbox').fill('Göteborg');
  await page.locator('.filter-summary').getByRole('button', { name: 'Rensa alla' }).click();
  await expect(page.locator('.salon-card')).toHaveCount(42);
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(14);
  await expect(page.locator('#result-count')).toHaveText('42 av 42 salonger');
  await expect(page.getByRole('searchbox')).toHaveValue('');
  for (const button of [trained, diploma, retailer]) await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('utbildningssymboler, D-tillägg och helt överlappande markörer går att välja', async ({ page }) => {
  // Syntetiska positioner enbart i testsvaret, aldrig i salongsregistret.
  const base = { isDemo: true, city: 'Testort', address: null, people: null, services: null, contact: null };
  await page.route('**/data/salons.json', route => route.fulfill({ json: [
    { ...base, id: 'positive', name: 'Markerad salong', coordinates: { lat: 59.3, lng: 18 }, daikonRetailer: null,
      legacy: { diplomaSymbol: true, daikonSymbol: true, educationStatement: null },
      people: [{ name: 'Testperson', educations: ['Registrerad utbildning'] }], contact: { website: 'https://example.com' } },
    { ...base, id: 'no', name: 'Utan märke', coordinates: { lat: 59.3, lng: 18 }, daikonRetailer: false,
      legacy: { diplomaSymbol: null, daikonSymbol: null, educationStatement: 'Utbildning i hårbottenproblematik' } },
    { ...base, id: 'unknown', name: 'Tomma fält', coordinates: { lat: 59.3, lng: 18 }, daikonRetailer: null },
  ] }));
  await page.goto('/');
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3);
  await expect(page.locator('.salon-card .daikon-badge')).toHaveCount(1);
  await expect(page.locator('.leaflet-marker-pane .diploma')).toHaveCount(1);
  await expect(page.locator('.leaflet-marker-pane .trained')).toHaveCount(1);
  await expect(page.locator('.leaflet-marker-pane .marker-daikon')).toHaveCount(1);
  await expect(page.locator('[data-id="unknown"]')).toHaveText('Tomma fältTestortVisa på kartan');
  await page.getByRole('button', { name: 'Visa Markerad salong på kartan' }).click();
  await expect(page.locator('.leaflet-popup')).toContainText('Testperson');
  await expect(page.locator('.leaflet-popup')).toContainText('Registrerad utbildning');
  await expect(page.locator('.leaflet-popup .daikon-badge')).toContainText('Återförsäljare DAIKON');
  await expect(page.locator('.leaflet-popup a[href="https://example.com/"]')).toBeVisible();
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
  await page.locator('.leaflet-popup').getByRole('button', { name: 'Utan märke', exact: true }).click();
  await expect(page.locator('.leaflet-popup').last()).toContainText('Utan märke');
  await expect(page.locator('.leaflet-popup').last().locator('.daikon-badge')).toHaveCount(0);
  await page.locator('.leaflet-popup').last().getByRole('button', { name: 'Tomma fält', exact: true }).click();
  await expect(page.locator('.leaflet-popup').last()).toContainText('Tomma fält');
  await page.getByRole('searchbox').fill('Utan märke');
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  await page.locator('.leaflet-marker-icon').click();
  await expect(page.locator('.leaflet-popup')).toContainText('Utan märke');
  await expect(page.locator('.leaflet-popup .daikon-badge')).toHaveCount(0);
});

test('geokodning anropas aldrig vid sidbesök och alla placerade träffar ryms i startvyn', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('nominatim')) requests.push(request.url()); });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(14);
    await expect.poll(async () => {
      const map = (await page.locator('#map').boundingBox())!;
      for (const marker of await page.locator('.leaflet-marker-icon').all()) {
        const box = (await marker.boundingBox())!;
        if (box.x < map.x || box.y < map.y || box.x + box.width > map.x + map.width || box.y + box.height > map.y + map.height) return false;
      }
      return true;
    }).toBe(true);
  }
  expect(requests).toEqual([]);
});

test('felaktigt register ger tydligt fel', async ({ page }) => {
  await page.route('**/data/salons.json', route => route.fulfill({ json: [{ id: 'invalid' }] }));
  await page.goto('/');
  await expect(page.getByText('Registret är inte tillgängligt')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Försök igen' })).toBeVisible();
  await expect(page.getByRole('searchbox')).toBeDisabled();
});
