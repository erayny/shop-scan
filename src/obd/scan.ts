import { Elm327 } from './elm327';
import {
  decodeDtc, decodeDtcList, decodeMilStatus, decodePidValue, decodeSupported, decodeVin, ecuName, hex2, pidDef,
  type Message, type Monitor,
} from './decode';
import { describeDtc } from './dtc-db';

export type DtcStatus = 'confirmed' | 'pending' | 'permanent';
export interface ScanDtc { ecu: string; system: string; code: string; status: DtcStatus; description: string; known: boolean }
export interface SystemResult { ecu: string; system: string; status: 'ok' | 'fault'; dtcCount: number }
export interface FrozenValue { pid: number; value: number } // metric
export interface FreezeFrame { dtc: string | null; values: FrozenValue[] }
export interface ScanResult {
  protocol: string;
  adapter: string;
  vin: string | null;
  milOn: boolean;
  diesel: boolean;
  monitors: Monitor[];
  systems: SystemResult[];
  dtcs: ScanDtc[];
  freezeFrame: FreezeFrame | null;
  voltage: number | null;
  supportedPids: number[];
}

export type StepId = 'vin' | 'status' | 'stored' | 'pending' | 'permanent' | 'freeze' | 'voltage';
export const SCAN_STEPS: { id: StepId; label: string }[] = [
  { id: 'vin', label: 'Read the VIN' },
  { id: 'status', label: 'Check the warning light and readiness monitors' },
  { id: 'stored', label: 'Read stored codes' },
  { id: 'pending', label: 'Read pending codes' },
  { id: 'permanent', label: 'Read permanent codes' },
  { id: 'freeze', label: 'Read freeze frame' },
  { id: 'voltage', label: 'Check battery voltage' },
];
export type StepStatus = 'pending' | 'running' | 'done' | 'failed';
export type OnStep = (id: StepId, status: StepStatus, detail?: string) => void;

const ENGINE_IDS = ['7E8', '10'];
const pickEngine = (msgs: Message[]) => msgs.find((m) => ENGINE_IDS.includes(m.ecu)) ?? msgs[0];

async function step<T>(id: StepId, onStep: OnStep, fn: () => Promise<T>, detail: (v: T) => string, fallback: T): Promise<T> {
  onStep(id, 'running');
  try {
    const v = await fn();
    onStep(id, 'done', detail(v));
    return v;
  } catch (e) {
    onStep(id, 'failed', (e as Error).message);
    return fallback;
  }
}

export async function readVin(elm: Elm327): Promise<string | null> {
  return decodeVin(await elm.request('0902', 8000));
}

async function readCodes(elm: Elm327, mode: '03' | '07' | '0A', status: DtcStatus): Promise<ScanDtc[]> {
  const msgs = await elm.request(mode, 8000);
  const out: ScanDtc[] = [];
  for (const m of msgs) {
    for (const code of decodeDtcList(m.data, elm.family)) {
      if (out.some((d) => d.ecu === m.ecu && d.code === code)) continue;
      const desc = describeDtc(code);
      out.push({ ecu: m.ecu, system: ecuName(m.ecu), code, status, description: desc.text, known: desc.known });
    }
  }
  return out;
}

export async function readSupportedPids(elm: Elm327): Promise<number[]> {
  const all = new Set<number>();
  for (const base of ['00', '20', '40']) {
    const msgs = await elm.request('01' + base).catch(() => [] as Message[]);
    const pids = msgs.flatMap((m) => decodeSupported(m.data));
    pids.forEach((p) => all.add(p));
    if (!pids.includes(parseInt(base, 16) + 0x20)) break; // next bitmap not supported
  }
  return [...all].sort((a, b) => a - b);
}

const FREEZE_PIDS = [0x04, 0x05, 0x06, 0x07, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11];

export async function runAutoScan(elm: Elm327, onStep: OnStep = () => {}): Promise<ScanResult> {
  const vin = await step('vin', onStep, () => readVin(elm), (v) => v ?? 'Not reported by this vehicle', null);

  const status = await step('status', onStep, async () => {
    const msgs = await elm.request('0101');
    const decoded = msgs.map((m) => ({ ecu: m.ecu, s: decodeMilStatus(m.data) })).filter((x) => x.s);
    const engine = decoded.find((x) => ENGINE_IDS.includes(x.ecu)) ?? decoded[0];
    return { milOn: decoded.some((x) => x.s!.milOn), engine: engine?.s ?? null };
  }, (v) => (v.milOn ? 'Check engine light is ON' : 'Check engine light is off'), { milOn: false, engine: null as ReturnType<typeof decodeMilStatus> });

  const stored = await step('stored', onStep, () => readCodes(elm, '03', 'confirmed'), (v) => `${v.length} found`, []);
  const pending = await step('pending', onStep, () => readCodes(elm, '07', 'pending'), (v) => `${v.length} found`, []);
  const permanent = await step('permanent', onStep, () => readCodes(elm, '0A', 'permanent'), (v) => `${v.length} found`, []);

  const supportedPids = await readSupportedPids(elm).catch(() => [] as number[]);

  const freezeFrame = await step('freeze', onStep, async () => {
    if (stored.length === 0) return null;
    const head = pickEngine(await elm.request('020200'));
    const dtc = head && head.data[0] === 0x42 && head.data.length >= 5 && (head.data[3] || head.data[4])
      ? decodeDtc(head.data[3], head.data[4]) : null;
    if (!dtc) return null;
    const values: FrozenValue[] = [];
    for (const pid of FREEZE_PIDS) {
      if (supportedPids.length && !supportedPids.includes(pid)) continue;
      const m = pickEngine(await elm.request(`02${hex2(pid)}00`).catch(() => []));
      const v = m && decodePidValue(m.data, 2);
      if (v) values.push(v);
    }
    return { dtc, values };
  }, (v) => (v ? `Captured for ${v.dtc}` : 'None stored'), null);

  const voltage = await step('voltage', onStep, () => elm.voltage(), (v) => (v ? `${v.toFixed(1)} V` : 'Not available'), null);

  const dtcs = [...stored, ...pending, ...permanent];
  const systems: SystemResult[] = elm.ecus.map((ecu) => {
    const n = new Set(dtcs.filter((d) => d.ecu === ecu).map((d) => d.code)).size;
    return { ecu, system: ecuName(ecu), status: n ? 'fault' : 'ok', dtcCount: n };
  });

  return {
    protocol: elm.protocolName,
    adapter: elm.adapterName,
    vin,
    milOn: status.milOn,
    diesel: status.engine?.diesel ?? false,
    monitors: status.engine?.monitors ?? [],
    systems,
    dtcs,
    freezeFrame,
    voltage,
    supportedPids,
  };
}

export async function clearCodes(elm: Elm327): Promise<void> {
  await elm.request('04', 8000);
}

export async function readLive(elm: Elm327, pid: number): Promise<number | null> {
  if (!pidDef(pid)) return null;
  const m = pickEngine(await elm.request('01' + hex2(pid)));
  return m ? decodePidValue(m.data)?.value ?? null : null;
}
