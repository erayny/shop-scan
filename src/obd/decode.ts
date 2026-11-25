// Pure decoders for OBD-II (SAE J1979) responses read through an ELM327 with headers on.

export interface Message { ecu: string; data: number[] }

export type ProtocolFamily = 'can11' | 'can29' | 'legacy';

/** ATDPN answer ("A6", "6", "3"...) to a protocol family and a readable name. */
export function protocolInfo(dpn: string): { family: ProtocolFamily; name: string } {
  const n = dpn.trim().toUpperCase().replace(/^A/, '');
  const names: Record<string, [ProtocolFamily, string]> = {
    '1': ['legacy', 'SAE J1850 PWM'],
    '2': ['legacy', 'SAE J1850 VPW'],
    '3': ['legacy', 'ISO 9141-2'],
    '4': ['legacy', 'ISO 14230-4 KWP (5 baud init)'],
    '5': ['legacy', 'ISO 14230-4 KWP (fast init)'],
    '6': ['can11', 'ISO 15765-4 CAN (11 bit, 500 kbaud)'],
    '7': ['can29', 'ISO 15765-4 CAN (29 bit, 500 kbaud)'],
    '8': ['can11', 'ISO 15765-4 CAN (11 bit, 250 kbaud)'],
    '9': ['can29', 'ISO 15765-4 CAN (29 bit, 250 kbaud)'],
  };
  const hit = names[n];
  return hit ? { family: hit[0], name: hit[1] } : { family: 'can11', name: `Protocol ${dpn.trim()}` };
}

const hexBytes = (s: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i + 1 < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
  return out;
};

/**
 * Turn the ELM327 response lines (headers on, spaces may be on or off) into
 * one message per ECU reply, reassembling ISO-TP multi-frame on CAN.
 */
export function parseFrames(lines: string[], family: ProtocolFamily): Message[] {
  const clean = lines
    .map((l) => l.replace(/\s+/g, '').toUpperCase())
    .filter((l) => /^[0-9A-F]+$/.test(l));
  if (family === 'legacy') {
    // 3 header bytes (priority, target, source), data, checksum.
    return clean
      .map(hexBytes)
      .filter((b) => b.length >= 5)
      .map((b) => ({ ecu: hex2(b[2]), data: b.slice(3, -1) }));
  }
  const hdrLen = family === 'can29' ? 8 : 3;
  const assembling = new Map<string, { len: number; data: number[] }>();
  const out: Message[] = [];
  for (const line of clean) {
    if (line.length <= hdrLen) continue;
    const header = line.slice(0, hdrLen);
    const ecu = family === 'can29' ? header.slice(6, 8) : header;
    const b = hexBytes(line.slice(hdrLen));
    const type = b[0] >> 4;
    if (type === 0) {
      out.push({ ecu, data: b.slice(1, 1 + (b[0] & 0x0f)) });
    } else if (type === 1) {
      const len = ((b[0] & 0x0f) << 8) | b[1];
      assembling.set(ecu, { len, data: b.slice(2) });
    } else if (type === 2) {
      const a = assembling.get(ecu);
      if (!a) continue;
      a.data.push(...b.slice(1));
      if (a.data.length >= a.len) {
        out.push({ ecu, data: a.data.slice(0, a.len) });
        assembling.delete(ecu);
      }
    }
  }
  // Incomplete multi-frame: return what arrived rather than nothing.
  for (const [ecu, a] of assembling) out.push({ ecu, data: a.data });
  return out;
}

export const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/** Readable name for the module behind an ECU id. */
export function ecuName(ecu: string): string {
  const e = ecu.toUpperCase();
  const map: Record<string, string> = {
    '7E8': 'Engine', '10': 'Engine',
    '7E9': 'Transmission', '18': 'Transmission',
    '7EA': 'Hybrid / powertrain module 3', '1A': 'Hybrid / powertrain module 3',
    '7EB': 'Powertrain module 4', '7EC': 'Powertrain module 5',
    '7ED': 'Powertrain module 6', '7EE': 'Powertrain module 7', '7EF': 'Powertrain module 8',
    '28': 'Brakes (ABS)',
  };
  return map[e] ?? `Module ${e}`;
}

/** Two DTC bytes to "P0456". */
export function decodeDtc(a: number, b: number): string {
  const letter = 'PCBU'[a >> 6];
  return `${letter}${(a >> 4) & 0x3}${(a & 0x0f).toString(16).toUpperCase()}${hex2(b)}`;
}

/** Mode 03 / 07 / 0A reply data to a list of codes. */
export function decodeDtcList(data: number[], family: ProtocolFamily): string[] {
  if (data.length < 1) return [];
  // CAN replies carry a count byte after the mode byte; legacy replies do not.
  const start = family === 'legacy' ? 1 : 2;
  const codes: string[] = [];
  for (let i = start; i + 1 < data.length; i += 2) {
    if (data[i] === 0 && data[i + 1] === 0) continue;
    codes.push(decodeDtc(data[i], data[i + 1]));
  }
  return codes;
}

/** Mode 09 PID 02 reply(s) to a 17 character VIN, or null. */
export function decodeVin(messages: Message[]): string | null {
  const bytes: number[] = [];
  for (const m of messages) {
    if (m.data[0] !== 0x49 || m.data[1] !== 0x02) continue;
    bytes.push(...m.data.slice(3)); // skip mode, pid, count/sequence byte
  }
  const text = String.fromCharCode(...bytes.filter((b) => b >= 0x30 && b <= 0x5a));
  const vin = text.slice(-17);
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}

export interface Monitor { name: string; supported: boolean; complete: boolean }
export interface MilStatus { milOn: boolean; dtcCount: number; diesel: boolean; monitors: Monitor[] }

/** Mode 01 PID 01: MIL, stored code count and readiness monitors. */
export function decodeMilStatus(data: number[]): MilStatus | null {
  if (data[0] !== 0x41 || data[1] !== 0x01 || data.length < 6) return null;
  const [A, B, C, D] = data.slice(2, 6);
  const diesel = (B & 0x08) !== 0;
  const monitors: Monitor[] = [];
  const cont = ['Misfire', 'Fuel system', 'Components'];
  cont.forEach((name, i) => monitors.push({ name, supported: !!(B & (1 << i)), complete: !(B & (1 << (i + 4))) }));
  const spark = ['Catalyst', 'Heated catalyst', 'Evaporative system (EVAP)', 'Secondary air', 'A/C refrigerant', 'Oxygen sensor', 'Oxygen sensor heater', 'EGR / VVT'];
  const comp = ['NMHC catalyst', 'NOx / SCR', '', 'Boost pressure', '', 'Exhaust gas sensor', 'Particulate filter', 'EGR / VVT'];
  (diesel ? comp : spark).forEach((name, i) => {
    if (!name) return;
    monitors.push({ name, supported: !!(C & (1 << i)), complete: !(D & (1 << i)) });
  });
  return { milOn: (A & 0x80) !== 0, dtcCount: A & 0x7f, diesel, monitors };
}

/** Mode 01 PID 00/20/40… bitmaps to the set of supported PIDs. */
export function decodeSupported(data: number[]): number[] {
  if (data[0] !== 0x41 || data.length < 6) return [];
  const base = data[1];
  const out: number[] = [];
  for (let i = 0; i < 32; i++) {
    const byte = data[2 + (i >> 3)];
    if (byte & (0x80 >> (i & 7))) out.push(base + i + 1);
  }
  return out;
}

export interface PidDef {
  pid: number; name: string; unit: string; bytes: number;
  f: (b: number[]) => number; kind?: 'temp' | 'speed' | 'pressure';
  min?: number; max?: number;
}

export const PIDS: PidDef[] = [
  { pid: 0x04, name: 'Engine load', unit: '%', bytes: 1, f: ([a]) => (a * 100) / 255, min: 0, max: 100 },
  { pid: 0x05, name: 'Coolant temperature', unit: '°C', bytes: 1, f: ([a]) => a - 40, kind: 'temp', min: -40, max: 130 },
  { pid: 0x06, name: 'Short term fuel trim (bank 1)', unit: '%', bytes: 1, f: ([a]) => ((a - 128) * 100) / 128, min: -25, max: 25 },
  { pid: 0x07, name: 'Long term fuel trim (bank 1)', unit: '%', bytes: 1, f: ([a]) => ((a - 128) * 100) / 128, min: -25, max: 25 },
  { pid: 0x08, name: 'Short term fuel trim (bank 2)', unit: '%', bytes: 1, f: ([a]) => ((a - 128) * 100) / 128, min: -25, max: 25 },
  { pid: 0x09, name: 'Long term fuel trim (bank 2)', unit: '%', bytes: 1, f: ([a]) => ((a - 128) * 100) / 128, min: -25, max: 25 },
  { pid: 0x0b, name: 'Intake manifold pressure', unit: 'kPa', bytes: 1, f: ([a]) => a, kind: 'pressure', min: 0, max: 255 },
  { pid: 0x0c, name: 'Engine RPM', unit: 'rpm', bytes: 2, f: ([a, b]) => (256 * a + b) / 4, min: 0, max: 7000 },
  { pid: 0x0d, name: 'Vehicle speed', unit: 'km/h', bytes: 1, f: ([a]) => a, kind: 'speed', min: 0, max: 200 },
  { pid: 0x0e, name: 'Ignition timing advance', unit: '°', bytes: 1, f: ([a]) => a / 2 - 64, min: -20, max: 60 },
  { pid: 0x0f, name: 'Intake air temperature', unit: '°C', bytes: 1, f: ([a]) => a - 40, kind: 'temp', min: -40, max: 80 },
  { pid: 0x10, name: 'Mass air flow', unit: 'g/s', bytes: 2, f: ([a, b]) => (256 * a + b) / 100, min: 0, max: 200 },
  { pid: 0x11, name: 'Throttle position', unit: '%', bytes: 1, f: ([a]) => (a * 100) / 255, min: 0, max: 100 },
  { pid: 0x1f, name: 'Run time since start', unit: 's', bytes: 2, f: ([a, b]) => 256 * a + b },
  { pid: 0x2f, name: 'Fuel level', unit: '%', bytes: 1, f: ([a]) => (a * 100) / 255, min: 0, max: 100 },
  { pid: 0x33, name: 'Barometric pressure', unit: 'kPa', bytes: 1, f: ([a]) => a, kind: 'pressure' },
  { pid: 0x42, name: 'Control module voltage', unit: 'V', bytes: 2, f: ([a, b]) => (256 * a + b) / 1000, min: 10, max: 16 },
  { pid: 0x46, name: 'Ambient air temperature', unit: '°C', bytes: 1, f: ([a]) => a - 40, kind: 'temp' },
  { pid: 0x5c, name: 'Engine oil temperature', unit: '°C', bytes: 1, f: ([a]) => a - 40, kind: 'temp', min: -40, max: 150 },
];

export const pidDef = (pid: number) => PIDS.find((p) => p.pid === pid);

/** Mode 01 (offset 2) or mode 02 (offset 3, after frame number) value. */
export function decodePidValue(data: number[], mode: 1 | 2 = 1): { pid: number; value: number } | null {
  const offset = mode === 1 ? 2 : 3;
  if (data[0] !== (mode === 1 ? 0x41 : 0x42)) return null;
  const def = pidDef(data[1]);
  if (!def || data.length < offset + def.bytes) return null;
  return { pid: def.pid, value: def.f(data.slice(offset, offset + def.bytes)) };
}

export type Units = 'imperial' | 'metric';

/** Convert a metric reading into the shop's display units. */
export function displayValue(def: PidDef, metric: number, units: Units): { value: number; unit: string } {
  if (units === 'imperial') {
    if (def.kind === 'temp') return { value: (metric * 9) / 5 + 32, unit: '°F' };
    if (def.kind === 'speed') return { value: metric * 0.621371, unit: 'mph' };
    if (def.kind === 'pressure') return { value: metric * 0.145038, unit: 'psi' };
  }
  return { value: metric, unit: def.unit };
}

export function formatNumber(v: number, unit: string): string {
  const digits = unit === 'V' || unit === 'g/s' || unit === 'psi' ? 1 : Math.abs(v) < 10 && unit === '%' ? 1 : 0;
  return v.toFixed(digits);
}

/** Model year from VIN position 10 (with the position-7 rule for 1980/2010 cycles). */
export function vinYear(vin: string): number | null {
  if (vin.length !== 17) return null;
  const codes = 'ABCDEFGHJKLMNPRSTVWXY123456789';
  const i = codes.indexOf(vin[9]);
  if (i < 0) return null;
  const base = /[A-Z]/.test(vin[6]) ? 2010 : 1980;
  let y = base + i;
  const next = new Date().getFullYear() + 1;
  if (y > next) y -= 30;
  return y;
}

const WMI: [string, string][] = [
  ['1HG', 'Honda'], ['2HG', 'Honda'], ['JHM', 'Honda'], ['5FN', 'Honda'], ['19X', 'Honda'], ['5J6', 'Honda'],
  ['JH4', 'Acura'], ['19U', 'Acura'],
  ['4T', 'Toyota'], ['5T', 'Toyota'], ['JT', 'Toyota'], ['2T', 'Toyota'], ['JTH', 'Lexus'], ['2T2', 'Lexus'],
  ['1FA', 'Ford'], ['1FM', 'Ford'], ['1FT', 'Ford'], ['3FA', 'Ford'], ['2FM', 'Ford'], ['1LN', 'Lincoln'],
  ['1G1', 'Chevrolet'], ['1GC', 'Chevrolet'], ['2G1', 'Chevrolet'], ['3GN', 'Chevrolet'], ['1GN', 'Chevrolet'],
  ['1GT', 'GMC'], ['1GK', 'GMC'], ['1G4', 'Buick'], ['1G6', 'Cadillac'],
  ['1C4', 'Chrysler / Jeep / Dodge'], ['1C6', 'Ram'], ['1C3', 'Chrysler / Dodge'], ['2C3', 'Chrysler / Dodge'], ['1J4', 'Jeep'], ['1J8', 'Jeep'],
  ['1N4', 'Nissan'], ['1N6', 'Nissan'], ['JN', 'Nissan'], ['5N1', 'Nissan'], ['3N1', 'Nissan'],
  ['KM8', 'Hyundai'], ['5NP', 'Hyundai'], ['KMH', 'Hyundai'], ['KNA', 'Kia'], ['KND', 'Kia'], ['5XY', 'Kia'],
  ['WDD', 'Mercedes-Benz'], ['WDB', 'Mercedes-Benz'], ['WDC', 'Mercedes-Benz'], ['4JG', 'Mercedes-Benz'], ['W1K', 'Mercedes-Benz'], ['W1N', 'Mercedes-Benz'],
  ['WBA', 'BMW'], ['WBS', 'BMW'], ['5UX', 'BMW'], ['WBX', 'BMW'],
  ['WAU', 'Audi'], ['WA1', 'Audi'], ['WVW', 'Volkswagen'], ['3VW', 'Volkswagen'], ['1VW', 'Volkswagen'], ['WVG', 'Volkswagen'],
  ['JF', 'Subaru'], ['4S3', 'Subaru'], ['4S4', 'Subaru'], ['JM', 'Mazda'], ['3MZ', 'Mazda'],
  ['5YJ', 'Tesla'], ['7SA', 'Tesla'], ['YV', 'Volvo'], ['SAL', 'Land Rover'], ['SAJ', 'Jaguar'],
  ['JA', 'Mitsubishi'], ['ZFA', 'Fiat'], ['WP0', 'Porsche'], ['WP1', 'Porsche'],
];

export function vinMake(vin: string): string | null {
  const v = vin.toUpperCase();
  const hit = [...WMI].sort((a, b) => b[0].length - a[0].length).find(([p]) => v.startsWith(p));
  return hit ? hit[1] : null;
}
