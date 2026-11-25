import { describe, it, expect } from 'vitest';
import {
  decodeDtc, decodeDtcList, decodeMilStatus, decodeSupported, decodeVin, parseFrames, protocolInfo,
  decodePidValue, displayValue, pidDef, vinYear, vinMake,
} from '../../src/obd/decode';
import { describeDtc } from '../../src/obd/dtc-db';
import { Elm327 } from '../../src/obd/elm327';
import { SimTransport } from '../../src/obd/sim';
import { runAutoScan, clearCodes, readLive } from '../../src/obd/scan';

describe('decoders', () => {
  it('decodes DTC bytes', () => {
    expect(decodeDtc(0x04, 0x56)).toBe('P0456');
    expect(decodeDtc(0xc1, 0x40)).toBe('U0140');
    expect(decodeDtc(0x42, 0x34)).toBe('C0234');
    expect(decodeDtc(0x9a, 0xbc)).toBe('B1ABC');
    expect(decodeDtc(0x0a, 0x80)).toBe('P0A80');
  });

  it('reads DTC lists on CAN (count byte) and legacy (padding)', () => {
    expect(decodeDtcList([0x43, 0x02, 0x04, 0x42, 0x04, 0x46], 'can11')).toEqual(['P0442', 'P0446']);
    expect(decodeDtcList([0x43, 0x00], 'can11')).toEqual([]);
    expect(decodeDtcList([0x43, 0x03, 0x00, 0x03, 0x02, 0x01, 0x71, 0x00], 'legacy')).toEqual(['P0300', 'P0302', 'P0171']);
  });

  it('parses single and multi-frame CAN with headers, spaces on or off', () => {
    const lines = ['7E8 10 14 49 02 01 57 44 44', '7E8 21 4E 47 38 47 42 30 41', '7E8 22 41 30 30 30 32 31 35', '7E9 03 41 01 00 00 00 00 00'];
    const msgs = parseFrames(lines, 'can11');
    expect(msgs).toHaveLength(2);
    expect(decodeVin(msgs.filter((m) => m.ecu === '7E8'))).toBe('WDDNG8GB0AA000215');
    expect(parseFrames(['7E806410098180001AA'], 'can11')[0].data).toEqual([0x41, 0x00, 0x98, 0x18, 0x00, 0x01]);
  });

  it('parses 29-bit CAN headers', () => {
    const m = parseFrames(['18DAF110034301 00'.replace(' ', '')], 'can29');
    expect(m[0].ecu).toBe('10');
  });

  it('parses legacy frames and multi-line VIN', () => {
    const msgs = parseFrames(['48 6B 10 49 02 01 00 00 00 31 xx'.replace(' xx', ' 00'), '48 6B 10 49 02 02 48 47 43 4D 00'], 'legacy');
    expect(msgs[0].ecu).toBe('10');
    expect(msgs[1].data).toEqual([0x49, 0x02, 0x02, 0x48, 0x47, 0x43, 0x4d]);
  });

  it('decodes MIL and readiness', () => {
    const s = decodeMilStatus([0x41, 0x01, 0x82, 0x07, 0xe5, 0x04])!;
    expect(s.milOn).toBe(true);
    expect(s.dtcCount).toBe(2);
    const evap = s.monitors.find((m) => m.name.startsWith('Evap'))!;
    expect(evap).toMatchObject({ supported: true, complete: false });
    expect(s.monitors.find((m) => m.name === 'Catalyst')).toMatchObject({ supported: true, complete: true });
    expect(s.monitors.find((m) => m.name === 'Secondary air')).toMatchObject({ supported: false });
  });

  it('decodes supported PID bitmaps and values', () => {
    expect(decodeSupported([0x41, 0x00, 0x80, 0x00, 0x00, 0x01])).toEqual([0x01, 0x20]);
    expect(decodePidValue([0x41, 0x0c, 0x0b, 0xb8])).toEqual({ pid: 0x0c, value: 750 });
    expect(decodePidValue([0x42, 0x05, 0x00, 0x7b], 2)).toEqual({ pid: 0x05, value: 83 });
    expect(displayValue(pidDef(0x05)!, 100, 'imperial')).toEqual({ value: 212, unit: '°F' });
  });

  it('knows protocols, VIN year and make', () => {
    expect(protocolInfo('A6').family).toBe('can11');
    expect(protocolInfo('3').family).toBe('legacy');
    expect(vinYear('4T1C31AK5NU000417')).toBe(2022);
    expect(vinYear('1HGCM56404A000318')).toBe(2004);
    expect(vinYear('WDDNG8GB0AA000215')).toBe(2010);
    expect(vinMake('WDDNG8GB0AA000215')).toBe('Mercedes-Benz');
    expect(vinMake('JTHBK1GG0F2000000')).toBe('Lexus');
  });

  it('describes known and unknown codes', () => {
    expect(describeDtc('P0442')).toMatchObject({ known: true });
    expect(describeDtc('P0302').text).toBe('Cylinder 2 misfire detected');
    expect(describeDtc('P0131').text).toMatch(/bank 1, sensor 1\) signal too low/);
    expect(describeDtc('P0135').text).toMatch(/heater/);
    const u = describeDtc('P1234');
    expect(u.known).toBe(false);
    expect(u.text).toMatch(/Manufacturer-specific/);
  });
});

const connect = async (car: string) => {
  const t = new SimTransport(car, 1);
  await t.connect();
  const elm = new Elm327(t, { timeoutMs: 500 });
  await elm.init();
  return { t, elm };
};

describe('auto-scan against simulated cars', () => {
  it('all-clear Toyota: two modules, no codes, monitors complete', async () => {
    const { elm } = await connect('camry');
    expect(elm.protocolName).toMatch(/CAN \(11 bit, 500/);
    const r = await runAutoScan(elm);
    expect(r.vin).toBe('4T1C31AK5NU000417');
    expect(r.milOn).toBe(false);
    expect(r.dtcs).toEqual([]);
    expect(r.systems.map((s) => s.status)).toEqual(['ok', 'ok']);
    expect(r.monitors.every((m) => !m.supported || m.complete)).toBe(true);
    expect(r.freezeFrame).toBeNull();
    expect(r.voltage).toBeCloseTo(13.9);
    expect(r.supportedPids).toContain(0x5c);
  });

  it('Mercedes: stored, pending and permanent codes, freeze frame, EVAP incomplete', async () => {
    const { elm } = await connect('benz');
    const r = await runAutoScan(elm);
    expect(r.milOn).toBe(true);
    expect(r.dtcs.map((d) => `${d.code}:${d.status}`)).toEqual(['P0442:confirmed', 'P0446:confirmed', 'P0456:pending', 'P0442:permanent']);
    expect(r.systems).toEqual([
      { ecu: '7E8', system: 'Engine', status: 'fault', dtcCount: 3 },
      { ecu: '7E9', system: 'Transmission', status: 'ok', dtcCount: 0 },
    ]);
    expect(r.freezeFrame?.dtc).toBe('P0442');
    expect(r.freezeFrame?.values.find((v) => v.pid === 0x0c)?.value).toBe(750);
    expect(r.monitors.find((m) => m.name.startsWith('Evap'))?.complete).toBe(false);
  });

  it('older ISO 9141 Honda: legacy frames, multi-line VIN, no mode 0A', async () => {
    const { elm } = await connect('accord');
    expect(elm.family).toBe('legacy');
    const r = await runAutoScan(elm);
    expect(r.vin).toBe('1HGCM56404A000318');
    expect(r.dtcs.map((d) => d.code)).toEqual(['P0300', 'P0302', 'P0171']);
    expect(r.systems[0]).toMatchObject({ system: 'Engine', status: 'fault' });
    expect(r.freezeFrame?.dtc).toBe('P0302');
  });

  it('clearing codes turns the light off but keeps permanent codes and resets monitors', async () => {
    const { elm } = await connect('benz');
    await clearCodes(elm);
    const r = await runAutoScan(elm);
    expect(r.milOn).toBe(false);
    expect(r.dtcs.map((d) => `${d.code}:${d.status}`)).toEqual(['P0442:permanent']);
    expect(r.monitors.filter((m) => m.supported).some((m) => !m.complete)).toBe(true);
  });

  it('reads live data', async () => {
    const { elm } = await connect('camry');
    const rpm = await readLive(elm, 0x0c);
    expect(rpm).toBeGreaterThan(500);
    expect(rpm).toBeLessThan(1100);
  });

  it('survives a clone adapter that swallows the first ATZ', async () => {
    const t = new SimTransport('camry', 1);
    t.dropNext = 1;
    const elm = new Elm327(t, { timeoutMs: 200 });
    await elm.init();
    expect(elm.ecus).toEqual(['7E8', '7EA']);
  });

  it('tells the tech to turn the ignition on', async () => {
    const t = new SimTransport('camry', 1);
    t.ignitionOn = false;
    const elm = new Elm327(t, { timeoutMs: 200 });
    await expect(elm.init()).rejects.toThrow(/ignition/i);
  });
});
