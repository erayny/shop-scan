// End-to-end tests: drives the built app in Chromium against the simulated cars.
// Run: npm run build && npm run preview  (in another terminal)  then  npm run e2e
// Each case fails on any console error, and every screen gets an axe accessibility scan.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const AXE = readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');

const results = [];
let browser;

async function newPage(viewport = { width: 1024, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && page.errors.push(m.text()));
  page.on('response', (r) => r.status() >= 500 && page.errors.push(`${r.status()} ${r.url()}`));
  await page.goto(BASE);
  return page;
}

async function axe(page, where) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations
    .filter((x) => x.impact === 'serious' || x.impact === 'critical')
    .map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`));
  if (v.length) throw new Error(`axe on ${where}: ${v.join(' | ')}`);
}

function expect(cond, msg) { if (!cond) throw new Error(msg); }

async function connectDemo(page, car) {
  await page.getByRole('link', { name: 'Adapter connection' }).click();
  await page.getByLabel('Demo car').selectOption(car);
  await page.getByRole('button', { name: 'Connect demo car' }).click();
  await page.getByText('Start a scan').waitFor({ timeout: 15000 });
}

async function scanCar(page, car, extra = {}) {
  await connectDemo(page, car);
  await page.getByRole('link', { name: 'Start a scan' }).click();
  await page.waitForFunction(() => document.querySelector('#vin')?.value.length === 17, null, { timeout: 10000 });
  for (const [label, v] of Object.entries(extra)) await page.getByLabel(label, { exact: true }).fill(v);
  await page.getByRole('button', { name: 'Start scan' }).click();
  await page.waitForURL(/#\/scan\/\d+$/, { timeout: 20000 });
}

async function test(id, name, fn, viewport) {
  const page = await newPage(viewport);
  try {
    await fn(page);
    if (page.errors.length) throw new Error('console errors: ' + page.errors.join(' | '));
    results.push({ id, name, ok: true });
    console.log(`  ✓ ${id} ${name}`);
  } catch (e) {
    results.push({ id, name, ok: false, err: e.message });
    console.log(`  ✗ ${id} ${name}\n      ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `test-results/${id}.png`, fullPage: true }).catch(() => {});
  }
  await page.context().close();
}

const run = async () => {
  browser = await chromium.launch();
  console.log('Shop Scan e2e against ' + BASE);

  await test('F01-H1', 'connect a demo car and the VIN is read automatically, year and make filled', async (p) => {
    await axe(p, 'home');
    await connectDemo(p, 'benz');
    await axe(p, 'connect');
    await p.getByRole('link', { name: 'Start a scan' }).click();
    await p.waitForFunction(() => document.querySelector('#vin')?.value === 'WDDNG8GB0AA000215');
    expect(await p.getByLabel('Year').inputValue() === '2010', 'year not filled');
    expect(await p.getByLabel('Make').inputValue() === 'Mercedes-Benz', 'make not filled');
    await axe(p, 'vehicle form');
  });

  await test('F01-E1', 'a mistyped VIN is caught before scanning', async (p) => {
    await connectDemo(p, 'camry');
    await p.getByRole('link', { name: 'Start a scan' }).click();
    await p.waitForFunction(() => document.querySelector('#vin')?.value.length === 17);
    await p.getByLabel('VIN').fill('4T1C31AK5NU00O417');
    expect(await p.getByText('without I, O or Q').isVisible(), 'no VIN error');
    expect(await p.getByRole('button', { name: 'Start scan' }).isDisabled(), 'start not disabled');
  });

  await test('F01-E2', 'diagnose without an adapter routes to connect, no Bluetooth explained', async (p) => {
    await p.getByRole('link', { name: /Diagnose/ }).click();
    await p.getByRole('heading', { name: 'Connect adapter' }).waitFor();
    const hasBt = await p.evaluate(() => 'bluetooth' in navigator);
    if (!hasBt) expect(await p.getByText('This browser has no Bluetooth access').isVisible(), 'no explanation');
  });

  await test('F02-H1', 'scan a car with faults: codes, freeze frame, readiness, report', async (p) => {
    await scanCar(p, 'benz', { Model: 'S550', Odometer: '84700', 'Customer name': 'Pat Example' });
    await p.getByText('3 trouble codes found').waitFor();
    expect(await p.locator('.dtc .code', { hasText: 'P0442' }).count() === 2, 'P0442 should be stored and permanent');
    expect(await p.getByText('EVAP vent control circuit').isVisible(), 'description missing');
    expect(await p.getByRole('heading', { name: /^Freeze frame/ }).isVisible(), 'freeze frame missing');
    expect(await p.locator('.kv .mon-no', { hasText: 'Not ready' }).isVisible(), 'EVAP monitor should be not ready');
    await axe(p, 'results');
    await p.getByRole('link', { name: 'Customer report' }).click();
    await p.getByText('Vehicle Scan Report').waitFor();
    expect(await p.getByText('DEMO — simulated vehicle').isVisible(), 'demo marker missing on report');
    expect(await p.getByText('84,700 mi').isVisible(), 'odometer missing');
    await p.getByLabel('Technician notes').fill('Smoke test EVAP system. Vent valve suspected.');
    await axe(p, 'report');
    await p.reload();
    await p.getByLabel('Technician notes').waitFor();
    expect((await p.getByLabel('Technician notes').inputValue()).includes('Vent valve'), 'notes not saved');
  });

  await test('F02-H2', 'all-clear car shows no codes and ready monitors', async (p) => {
    await scanCar(p, 'camry');
    await p.getByText('No trouble codes', { exact: true }).waitFor();
    expect(await p.getByText('All supported monitors have run').isVisible(), 'readiness summary wrong');
    expect(!(await p.getByRole('button', { name: 'Clear codes' }).isEnabled()), 'clear should be disabled');
  });

  await test('F02-H3', 'older ISO 9141 car: VIN, misfire codes', async (p) => {
    await scanCar(p, 'accord');
    await p.getByText('Cylinder 2 misfire detected').waitFor();
    expect(await p.getByText('ISO 9141-2').isVisible(), 'protocol not shown');
  });

  await test('F02-E1', 'double tap on Start scan makes one scan, not two', async (p) => {
    await connectDemo(p, 'camry');
    await p.getByRole('link', { name: 'Start a scan' }).click();
    await p.waitForFunction(() => document.querySelector('#vin')?.value.length === 17);
    await p.getByRole('button', { name: 'Start scan' }).dblclick();
    await p.waitForURL(/#\/scan\/\d+$/, { timeout: 20000 });
    const n = await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('shop-scan');
      r.onsuccess = () => { const c = r.result.transaction('scans').objectStore('scans').count(); c.onsuccess = () => res(c.result); };
    }));
    expect(n === 1, `expected 1 scan, found ${n}`);
  });

  await test('F02-E2', 'refresh during a scan does not leave a scan stuck and hidden', async (p) => {
    await connectDemo(p, 'benz');
    await p.getByRole('link', { name: 'Start a scan' }).click();
    await p.waitForFunction(() => document.querySelector('#vin')?.value.length === 17);
    await p.getByRole('button', { name: 'Start scan' }).click();
    await p.waitForURL(/run$/);
    await p.reload();
    await p.getByText('The adapter is not connected').waitFor();
    await p.getByRole('link', { name: 'Reconnect' }).click();
    await p.getByLabel('Demo car').selectOption('benz');
    await p.getByRole('button', { name: 'Connect demo car' }).click();
    await p.waitForURL(/#\/scan\/\d+$/, { timeout: 20000 });
    await p.getByText('3 trouble codes found').waitFor();
  });

  await test('F03-H1', 'clear codes warns first, then light is off and permanent code stays', async (p) => {
    await scanCar(p, 'benz');
    await p.getByRole('button', { name: 'Clear codes' }).click();
    await p.getByText('Readiness monitors reset').waitFor();
    await axe(p, 'clear dialog');
    await p.getByRole('dialog').getByRole('button', { name: 'Clear codes' }).click();
    await p.waitForURL(/#\/scan\/\d+$/);
    await p.getByText('Check engine light is off.').waitFor({ timeout: 20000 });
    expect(await p.locator('.badge', { hasText: 'Permanent' }).isVisible(), 'permanent code should remain');
  });

  await test('F03-E1', 'Esc cancels the clear dialog and nothing is cleared', async (p) => {
    await scanCar(p, 'benz');
    await p.getByRole('button', { name: 'Clear codes' }).click();
    await p.keyboard.press('Escape');
    expect(!(await p.getByRole('dialog').isVisible()), 'dialog still open');
    expect(await p.getByText('Check engine light is ON.').isVisible(), 'codes changed');
  });

  await test('F04-H1', 'live data streams values and can be paused', async (p) => {
    await connectDemo(p, 'camry');
    await p.getByRole('link', { name: 'Live data' }).click();
    await p.waitForFunction(() => [...document.querySelectorAll('.value-card .v')].some((e) => /\d/.test(e.textContent)), null, { timeout: 15000 });
    await axe(p, 'live');
    await p.getByRole('button', { name: /Pause/ }).click();
    await p.getByRole('button', { name: /Resume/ }).waitFor();
    await p.getByRole('button', { name: 'Engine RPM' }).click();
    expect(await p.getByRole('button', { name: 'Engine RPM' }).getAttribute('aria-pressed') === 'false', 'toggle failed');
  });

  await test('F06-H1', 'find a past report by plate and see the vehicle history', async (p) => {
    await scanCar(p, 'benz', { 'License plate': 'TEST123' });
    await p.goto(BASE + '#/reports');
    await p.getByLabel('Search reports').fill('test123');
    await p.getByRole('link', { name: /Mercedes-Benz/ }).first().click();
    await p.getByRole('link', { name: /history/i }).click();
    await p.getByRole('heading', { name: /Visits/ }).waitFor();
    await axe(p, 'history');
  });

  await test('F06-E1', 'second visit fills in the customer from the last visit', async (p) => {
    await scanCar(p, 'benz', { 'Customer name': 'Pat Example', 'Customer phone': '555-0100' });
    await p.goto(BASE + '#/scan/new');
    await p.waitForFunction(() => document.querySelector('#cust')?.value === 'Pat Example', null, { timeout: 10000 });
  });

  await test('S14-H1', 'settings saved and printed on the report; backup export works', async (p) => {
    await p.goto(BASE + '#/settings');
    await p.getByLabel('Shop name').fill('Demo Auto Repair');
    await p.getByLabel('Phone', { exact: true }).fill('555-0199');
    await p.getByRole('button', { name: 'Save settings' }).click();
    await p.getByText('Settings saved').waitFor();
    await axe(p, 'settings');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /Export backup/ }).click()]);
    expect(/shop-scan-backup-.*\.json/.test(dl.suggestedFilename()), 'bad backup name');
    await scanCar(p, 'camry');
    await p.getByRole('link', { name: 'Customer report' }).click();
    await p.getByText('Demo Auto Repair').waitFor();
  });

  await test('M-1', 'phone width: no sideways scrolling on results and report', async (p) => {
    await scanCar(p, 'benz');
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over <= 0, `results overflow by ${over}px`);
    await p.getByRole('link', { name: 'Customer report' }).click();
    await p.getByText('Vehicle Scan Report').waitFor();
    const over2 = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over2 <= 0, `report overflows by ${over2}px`);
  }, { width: 390, height: 844 });

  await test('O-1', 'works offline after the first visit', async (p) => {
    await p.waitForFunction(() => navigator.serviceWorker?.controller || new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', () => r(true))), null, { timeout: 10000 }).catch(() => {});
    await p.reload();
    await p.waitForTimeout(500);
    await p.context().setOffline(true);
    await p.reload();
    await p.getByRole('link', { name: /Diagnose/ }).waitFor({ timeout: 5000 });
    await p.context().setOffline(false);
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} cases, ${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
};
run().catch((e) => { console.error(e); process.exit(1); });
