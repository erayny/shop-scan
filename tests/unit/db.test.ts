import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, exportAll, importAll, forgetCustomer, newReportId, vehicleKey, type ScanRecord } from '../../src/db';

const scan = (over: Partial<ScanRecord> = {}): ScanRecord => ({
  reportId: 'SS20260101120000', vehicleKey: 'WDDNG8GB0AA000215', vin: 'WDDNG8GB0AA000215',
  year: '2010', make: 'Mercedes-Benz', model: 'S550', plate: 'TEST123',
  customerName: 'Pat Example', customerTel: '555-0100', odometer: '84700', odometerUnit: 'mi',
  technician: 'Tech', roNumber: '1001', startedAt: 1767268800000, status: 'complete', result: null, notes: '',
  ...over,
});

describe('on-device database', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });

  it('makes report ids and vehicle keys', () => {
    expect(newReportId(new Date(2026, 10, 25, 9, 5, 7))).toBe('SS20261125090507');
    expect(vehicleKey('wddng8gb0aa000215', '')).toBe('WDDNG8GB0AA000215');
    expect(vehicleKey('', 'ab 12 cd')).toBe('PLATE:AB12CD');
  });

  it('exports and restores a backup without duplicating scans', async () => {
    await db.scans.add(scan());
    const json = await exportAll();
    await db.scans.clear();
    expect(await importAll(json)).toBe(1);
    await importAll(json);
    expect(await db.scans.count()).toBe(1);
  });

  it('rejects files that are not backups', async () => {
    await expect(importAll('{"hello":1}')).rejects.toThrow(/not a Shop Scan backup/);
    await expect(importAll('not json')).rejects.toThrow();
  });

  it('forgets a customer everywhere', async () => {
    await db.scans.add(scan());
    await db.scans.add(scan({ reportId: 'SS2', customerName: 'Someone Else' }));
    await db.vehicles.put({ key: 'K', vin: '', year: '', make: '', model: '', plate: '', customerName: 'Pat Example', customerTel: '1', updatedAt: 1 });
    expect(await forgetCustomer('Pat Example')).toBe(1);
    expect((await db.scans.where('customerName').equals('Pat Example').count())).toBe(0);
    expect((await db.vehicles.get('K'))!.customerTel).toBe('');
    expect((await db.scans.where('customerName').equals('Someone Else').count())).toBe(1);
  });
});
