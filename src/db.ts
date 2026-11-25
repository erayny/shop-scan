import Dexie, { type Table } from 'dexie';
import type { ScanResult } from './obd/scan';
import type { Units } from './obd/decode';

export interface Settings {
  id: 'shop';
  name: string; tel: string; email: string; address: string;
  technician: string; units: Units;
}
export const DEFAULT_SETTINGS: Settings = {
  id: 'shop', name: '', tel: '', email: '', address: '', technician: '', units: 'imperial',
};

/** Last known details for a vehicle, for autofill on the next visit. */
export interface Vehicle {
  key: string; // VIN, or "PLATE:<plate>" when the car reports no VIN
  vin: string; year: string; make: string; model: string; plate: string;
  customerName: string; customerTel: string; updatedAt: number;
}

/** A scan is a snapshot: everything the report needs, as it was at the time. */
export interface ScanRecord {
  id?: number;
  reportId: string;
  vehicleKey: string;
  vin: string; year: string; make: string; model: string; plate: string;
  customerName: string; customerTel: string;
  odometer: string; odometerUnit: 'mi' | 'km';
  technician: string; roNumber: string;
  startedAt: number;
  status: 'running' | 'complete' | 'failed';
  result: ScanResult | null;
  notes: string;
  clearedAt?: number;
}

class ShopDb extends Dexie {
  settings!: Table<Settings, string>;
  vehicles!: Table<Vehicle, string>;
  scans!: Table<ScanRecord, number>;
  constructor() {
    super('shop-scan');
    this.version(1).stores({
      settings: 'id',
      vehicles: 'key, vin, plate, customerName, updatedAt',
      scans: '++id, reportId, vehicleKey, startedAt, vin, plate, customerName',
    });
  }
}

export const db = new ShopDb();

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('shop')) ?? DEFAULT_SETTINGS;
}

export function vehicleKey(vin: string, plate: string): string {
  if (vin) return vin.toUpperCase();
  if (plate) return 'PLATE:' + plate.toUpperCase().replace(/\s+/g, '');
  return 'UNKNOWN:' + Date.now();
}

export function newReportId(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `SS${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Everything on the tablet, as one JSON file (backup before a tablet dies). */
export async function exportAll(): Promise<string> {
  return JSON.stringify({
    app: 'shop-scan', version: 1, exportedAt: new Date().toISOString(),
    settings: await db.settings.toArray(), vehicles: await db.vehicles.toArray(), scans: await db.scans.toArray(),
  }, null, 1);
}

export async function importAll(json: string): Promise<number> {
  const data = JSON.parse(json);
  if (data.app !== 'shop-scan') throw new Error('That file is not a Shop Scan backup.');
  await db.transaction('rw', db.settings, db.vehicles, db.scans, async () => {
    await db.settings.bulkPut(data.settings ?? []);
    await db.vehicles.bulkPut(data.vehicles ?? []);
    for (const s of data.scans ?? []) {
      const { id: _drop, ...rest } = s;
      if (!(await db.scans.where('reportId').equals(rest.reportId).first())) await db.scans.add(rest);
    }
  });
  return (data.scans ?? []).length;
}

/** Remove one customer's name and phone from every record on the tablet. */
export async function forgetCustomer(name: string): Promise<number> {
  let n = 0;
  await db.transaction('rw', db.vehicles, db.scans, async () => {
    n += await db.scans.where('customerName').equals(name).modify({ customerName: '', customerTel: '' });
    await db.vehicles.where('customerName').equals(name).modify({ customerName: '', customerTel: '' });
  });
  return n;
}
