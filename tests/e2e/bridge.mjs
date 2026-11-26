// End-to-end test of the J2534 path: Liftside served by Liftside Bridge
// (Linux build, simulated pass-thru device), scanned in Chromium.
// Run: ./tools/build-bridge.sh && dist-bridge/liftside-bridge-linux -sim benz -no-browser & node tests/e2e/bridge.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BRIDGE_URL || 'http://127.0.0.1:8534/';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let ok = true;
const step = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); } catch (e) { ok = false; console.log('  ✗ ' + name + '\n      ' + e.message.split('\n')[0]); }
};
await p.goto(BASE + '#/connect');
await step('pass-thru card lists the J2534 device', async () => {
  await p.getByRole('heading', { name: /J2534 pass-thru on this PC/ }).waitFor({ timeout: 5000 });
  if ((await p.getByLabel('Pass-thru device').inputValue()) !== 'Demo pass-thru (simulated benz)') throw new Error('device not listed');
  if (await p.getByText('Download').count()) throw new Error('download hint should be hidden inside the bridge');
});
await step('connect finds 11-bit CAN and two modules', async () => {
  await p.getByRole('button', { name: 'Connect pass-thru' }).click();
  await p.getByText('Start a scan').waitFor({ timeout: 15000 });
  await p.getByText('2 modules answered').waitFor();
});
await step('scan reads VIN, codes, freeze-frame code, voltage', async () => {
  await p.getByRole('link', { name: 'Start a scan' }).click();
  await p.waitForFunction(() => document.querySelector('#vin')?.value === 'WDDNG8GB0AA000215', null, { timeout: 10000 });
  await p.getByRole('button', { name: 'Start scan' }).click();
  await p.waitForURL(/#\/scan\/\d+$/, { timeout: 30000 });
  await p.getByText('3 trouble codes found').waitFor();
  await p.getByText('Battery 12.4 V.').waitFor();
  await p.getByText(/ISO 15765-4 CAN \(11 bit, 500 kbaud\).*Demo pass-thru/).waitFor();
});
await step('clear codes through the bridge, permanent code stays', async () => {
  await p.getByRole('button', { name: 'Clear codes' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Clear codes' }).click();
  await p.getByText('Check engine light is off.').waitFor({ timeout: 30000 });
  if (!(await p.locator('.badge', { hasText: 'Permanent' }).isVisible())) throw new Error('permanent code missing');
});
await step('report is marked DEMO', async () => {
  await p.getByRole('link', { name: 'Customer report' }).click();
  await p.getByText('DEMO — simulated vehicle').waitFor();
});
await step('no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')); });
await b.close();
console.log(ok ? 'bridge e2e: all passed' : 'bridge e2e: FAILED');
process.exit(ok ? 0 : 1);
