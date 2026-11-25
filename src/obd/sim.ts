// A simulated ELM327 adapter plugged into a simulated car. Used for the demo
// mode, for training, and by every test. VINs are synthetic.
import type { Transport } from './transport';
import { hex2 } from './decode';

interface SimEcu { id: string; stored: string[]; pending: string[]; permanent: string[] }
export interface SimCar {
  key: string;
  label: string;
  vin: string;
  dpn: '6' | '3';
  ecus: SimEcu[];
  milOn: boolean;
  /** readiness bytes B, C, D of mode 01 PID 01 (see J1979) */
  readiness: [number, number, number];
  freeze: { dtc: string; values: Record<number, number[]> } | null;
  supportsMode0A: boolean;
  voltage: number;
}

const enc = (code: string): number[] => {
  const t = 'PCBU'.indexOf(code[0]);
  const a = (t << 6) | (parseInt(code[1], 16) << 4) | parseInt(code[2], 16);
  return [a, parseInt(code.slice(3), 16)];
};

export const SIM_CARS: SimCar[] = [
  {
    key: 'camry', label: '2022 Toyota Camry Hybrid — all clear', vin: '4T1C31AK5NU000417', dpn: '6',
    ecus: [{ id: '7E8', stored: [], pending: [], permanent: [] }, { id: '7EA', stored: [], pending: [], permanent: [] }],
    milOn: false, readiness: [0x07, 0xe5, 0x00], freeze: null, supportsMode0A: true, voltage: 13.9,
  },
  {
    key: 'benz', label: '2010 Mercedes-Benz S550 — EVAP leak, light on', vin: 'WDDNG8GB0AA000215', dpn: '6',
    ecus: [
      { id: '7E8', stored: ['P0442', 'P0446'], pending: ['P0456'], permanent: ['P0442'] },
      { id: '7E9', stored: [], pending: [], permanent: [] },
    ],
    milOn: true, readiness: [0x07, 0xe5, 0x04],
    freeze: { dtc: 'P0442', values: { 0x04: [0x4d], 0x05: [0x7b], 0x06: [0x84], 0x07: [0x80], 0x0c: [0x0b, 0xb8], 0x0d: [0x00], 0x0f: [0x3c], 0x11: [0x24] } },
    supportsMode0A: true, voltage: 12.4,
  },
  {
    key: 'accord', label: '2004 Honda Accord — misfire and lean (older protocol)', vin: '1HGCM56404A000318', dpn: '3',
    ecus: [{ id: '10', stored: ['P0300', 'P0302', 'P0171'], pending: [], permanent: [] }],
    milOn: true, readiness: [0x07, 0x65, 0x01],
    freeze: { dtc: 'P0302', values: { 0x04: [0x60], 0x05: [0xb4], 0x06: [0x9c], 0x07: [0x99], 0x0c: [0x0c, 0x80], 0x0d: [0x2d], 0x0f: [0x48], 0x11: [0x30] } },
    supportsMode0A: false, voltage: 12.1,
  },
];

const SUPPORTED_00 = [0x04, 0x05, 0x06, 0x07, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x1f, 0x20];
const SUPPORTED_20 = [0x2f, 0x33, 0x40];
const SUPPORTED_40 = [0x42, 0x46, 0x5c];
const bitmap = (base: number, pids: number[]) => {
  const b = [0, 0, 0, 0];
  pids.forEach((p) => { const i = p - base - 1; b[i >> 3] |= 0x80 >> (i & 7); });
  return b;
};

/** Live value generator (metric) for the simulator, smooth with a little noise. */
function liveBytes(pid: number, t: number, misfire: boolean): number[] | null {
  const s = t / 1000;
  const jitter = (n: number) => (Math.sin(s * 7.3) + Math.sin(s * 3.1)) * n;
  const rpm = 750 + 120 * Math.max(0, Math.sin(s / 3)) + jitter(misfire ? 60 : 8);
  switch (pid) {
    case 0x04: return [Math.round((22 + jitter(2)) * 2.55)];
    case 0x05: return [Math.round(Math.min(90, 40 + s * 2)) + 40];
    case 0x06: return [Math.round(128 + (misfire ? 14 : 1) + jitter(3))];
    case 0x07: return [Math.round(128 + (misfire ? 18 : 2))];
    case 0x0b: return [Math.round(32 + jitter(2))];
    case 0x0c: { const v = Math.round(rpm * 4); return [v >> 8, v & 0xff]; }
    case 0x0d: return [0];
    case 0x0e: return [Math.round((10 + jitter(1.5) + 64) * 2)];
    case 0x0f: return [28 + 40];
    case 0x10: { const v = Math.round((3.1 + jitter(0.2)) * 100); return [v >> 8, v & 0xff]; }
    case 0x11: return [Math.round(15 * 2.55)];
    case 0x1f: { const v = Math.round(s); return [v >> 8, v & 0xff]; }
    case 0x2f: return [Math.round(0.62 * 255)];
    case 0x33: return [101];
    case 0x42: { const v = Math.round((13.9 + jitter(0.05)) * 1000); return [v >> 8, v & 0xff]; }
    case 0x46: return [21 + 40];
    case 0x5c: return [Math.round(Math.min(95, 35 + s * 2)) + 40];
    default: return null;
  }
}

export class SimTransport implements Transport {
  name: string;
  private dataCbs: ((c: string) => void)[] = [];
  private discCbs: (() => void)[] = [];
  private echo = true;
  private headers = false;
  private spaces = true;
  private protocolFound = false;
  private car: SimCar;
  private start = Date.now();
  /** Set to make the next command go unanswered (clone-adapter behaviour, for tests). */
  dropNext = 0;
  ignitionOn = true;

  constructor(carKey: string, private delayMs = 15) {
    const car = SIM_CARS.find((c) => c.key === carKey);
    if (!car) throw new Error(`No simulated car "${carKey}"`);
    this.car = structuredClone(car);
    this.name = `Demo adapter (${car.label.split(' — ')[0]})`;
  }

  async connect() { await this.wait(this.delayMs * 4); }
  async disconnect() { this.discCbs.forEach((cb) => cb()); }
  onData(cb: (c: string) => void) { this.dataCbs.push(cb); }
  onDisconnect(cb: () => void) { this.discCbs.push(cb); }
  unplug() { this.discCbs.forEach((cb) => cb()); }

  private wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  async write(text: string): Promise<void> {
    const cmd = text.replace(/[\r\n\s]/g, '').toUpperCase();
    if (this.dropNext > 0) { this.dropNext--; return; }
    const searching = !this.protocolFound && /^[0-9A-F]+$/.test(cmd);
    await this.wait(searching ? this.delayMs * 10 : this.delayMs);
    const body = this.handle(cmd);
    const out = (this.echo ? cmd + '\r' : '') + (searching && this.ignitionOn ? 'SEARCHING...\r' : '') + body.join('\r') + '\r\r>';
    // BLE adapters deliver in 20-byte notifications; mimic that.
    for (let i = 0; i < out.length; i += 20) {
      const part = out.slice(i, i + 20);
      this.dataCbs.forEach((cb) => cb(part));
    }
  }

  private handle(cmd: string): string[] {
    if (cmd.startsWith('AT')) return this.at(cmd.slice(2));
    if (!/^[0-9A-F]+$/.test(cmd) || cmd.length % 2) return ['?'];
    if (!this.ignitionOn) return ['UNABLE TO CONNECT'];
    this.protocolFound = true;
    const bytes = cmd.match(/../g)!.map((h) => parseInt(h, 16));
    const replies: { ecu: string; data: number[] }[] = [];
    for (const ecu of this.car.ecus) {
      const engine = ecu === this.car.ecus[0];
      const d = this.obd(bytes, ecu, engine);
      if (d) {
        if (Array.isArray(d[0])) (d as number[][]).forEach((x) => replies.push({ ecu: ecu.id, data: x }));
        else replies.push({ ecu: ecu.id, data: d as number[] });
      }
    }
    if (!replies.length) return ['NO DATA'];
    return replies.flatMap((r) => this.frame(r.ecu, r.data));
  }

  private at(c: string): string[] {
    if (c === 'Z') { this.echo = true; this.headers = false; this.spaces = true; this.protocolFound = false; return ['', 'ELM327 v1.5']; }
    if (c === 'E0') { this.echo = false; return ['OK']; }
    if (c === 'E1') { this.echo = true; return ['OK']; }
    if (c === 'H1') { this.headers = true; return ['OK']; }
    if (c === 'H0') { this.headers = false; return ['OK']; }
    if (c === 'S0') { this.spaces = false; return ['OK']; }
    if (c === 'S1') { this.spaces = true; return ['OK']; }
    if (c === 'DPN') return [this.protocolFound ? 'A' + this.car.dpn : 'A0'];
    if (c === 'RV') return [`${this.car.voltage.toFixed(1)}V`];
    if (c === 'I') return ['ELM327 v1.5'];
    return ['OK'];
  }

  private obd(b: number[], ecu: SimEcu, engine: boolean): number[] | number[][] | null {
    const [mode, pid] = b;
    const car = this.car;
    const legacy = car.dpn === '3';
    const dtcReply = (m: number, codes: string[]) => (legacy
      ? [m, ...codes.flatMap(enc), ...Array(Math.max(0, 6 - codes.length * 2)).fill(0)]
      : [m, codes.length, ...codes.flatMap(enc)]);
    if (mode === 0x01) {
      if (pid === 0x00) return [0x41, 0x00, ...bitmap(0x00, engine ? SUPPORTED_00 : [0x01, 0x04, 0x05, 0x0c])];
      if (!engine) return pid === 0x01 ? [0x41, 0x01, (ecu.stored.length & 0x7f), 0x00, 0x00, 0x00] : null;
      if (pid === 0x20) return [0x41, 0x20, ...bitmap(0x20, SUPPORTED_20)];
      if (pid === 0x40) return [0x41, 0x40, ...bitmap(0x40, SUPPORTED_40)];
      if (pid === 0x01) return [0x41, 0x01, (car.milOn ? 0x80 : 0) | ecu.stored.length, ...car.readiness];
      const v = liveBytes(pid, Date.now() - this.start, car.key === 'accord');
      return v ? [0x41, pid, ...v] : null;
    }
    if (mode === 0x02 && engine) {
      if (!car.freeze || ecu.stored.length === 0) return pid === 0x02 ? [0x42, 0x02, 0x00, 0x00, 0x00] : null;
      if (pid === 0x02) return [0x42, 0x02, 0x00, ...enc(car.freeze.dtc)];
      const v = car.freeze.values[pid];
      return v ? [0x42, pid, 0x00, ...v] : null;
    }
    if (mode === 0x03) {
      if (legacy && ecu.stored.length > 3) {
        const out: number[][] = [];
        for (let i = 0; i < ecu.stored.length; i += 3) out.push(dtcReply(0x43, ecu.stored.slice(i, i + 3)));
        return out;
      }
      return dtcReply(0x43, ecu.stored);
    }
    if (mode === 0x07) return dtcReply(0x47, ecu.pending);
    if (mode === 0x0a) return car.supportsMode0A ? dtcReply(0x4a, ecu.permanent) : null;
    if (mode === 0x04) {
      ecu.stored = []; ecu.pending = [];
      if (engine) {
        car.milOn = false;
        car.freeze = null;
        const [, c] = car.readiness;
        car.readiness = [0x07 | 0x10, c, c]; // monitors reset to incomplete
      }
      return [0x44];
    }
    if (mode === 0x09 && pid === 0x02 && engine) {
      const vin = [...car.vin].map((ch) => ch.charCodeAt(0));
      if (legacy) {
        const padded = [0, 0, 0, ...vin];
        return [1, 2, 3, 4, 5].map((seq) => [0x49, 0x02, seq, ...padded.slice((seq - 1) * 4, seq * 4)]);
      }
      return [0x49, 0x02, 0x01, ...vin];
    }
    return null;
  }

  private frame(ecu: string, data: number[]): string[] {
    const sp = (bytes: number[]) => bytes.map(hex2).join(this.spaces ? ' ' : '');
    if (this.car.dpn === '3') {
      const hdr = [0x48, 0x6b, parseInt(ecu, 16)];
      const all = [...hdr, ...data];
      const sum = all.reduce((a, b) => (a + b) & 0xff, 0);
      return [sp(this.headers ? [...all, sum] : data)];
    }
    if (!this.headers) return [sp(data)];
    const h = ecu + (this.spaces ? ' ' : '');
    if (data.length <= 7) {
      const f = [data.length, ...data];
      while (f.length < 8) f.push(0);
      return [h + sp(f)];
    }
    const lines = [h + sp([0x10 | (data.length >> 8), data.length & 0xff, ...data.slice(0, 6)])];
    let seq = 1;
    for (let i = 6; i < data.length; i += 7) {
      const chunk = data.slice(i, i + 7);
      while (chunk.length < 7) chunk.push(0);
      lines.push(h + sp([0x20 | (seq++ & 0x0f), ...chunk]));
    }
    return lines;
  }
}
