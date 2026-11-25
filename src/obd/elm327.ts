import type { Transport } from './transport';
import { parseFrames, protocolInfo, type Message, type ProtocolFamily } from './decode';

export class ObdError extends Error {}

const FATAL = ['UNABLE TO CONNECT', 'BUS ERROR', 'CAN ERROR', 'BUS BUSY', 'FB ERROR', 'DATA ERROR', 'STOPPED', 'ERR'];

export interface ElmOptions { timeoutMs?: number; log?: (line: string) => void }

/** Talks to an ELM327-compatible adapter: one command at a time, waits for the '>' prompt. */
export class Elm327 {
  private buf = '';
  private waiter: ((text: string) => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  family: ProtocolFamily = 'can11';
  protocolName = '';
  adapterVersion = '';
  ecus: string[] = [];
  private timeoutMs: number;
  private log: (line: string) => void;

  constructor(private t: Transport, opts: ElmOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.log = opts.log ?? (() => {});
    t.onData((chunk) => this.onChunk(chunk));
  }

  get adapterName() { return this.t.name; }

  private onChunk(chunk: string) {
    this.buf += chunk;
    const i = this.buf.indexOf('>');
    if (i >= 0 && this.waiter) {
      const text = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      const w = this.waiter;
      this.waiter = null;
      w(text);
    }
  }

  /** Send one command; resolves with the cleaned reply lines. Commands are serialised. */
  send(cmd: string, timeoutMs = this.timeoutMs): Promise<string[]> {
    const run = async () => {
      this.buf = '';
      this.log(`> ${cmd}`);
      const reply = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiter = null;
          reject(new ObdError(`No answer from the adapter to ${cmd}`));
        }, timeoutMs);
        this.waiter = (text) => { clearTimeout(timer); resolve(text); };
      });
      await this.t.write(cmd + '\r');
      const text = await reply;
      const lines = text
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter((l) => l && l.replace(/\s/g, '') !== cmd.replace(/\s/g, '')) // echo
        .filter((l) => !/^SEARCHING/.test(l) && !/^BUS INIT/.test(l));
      lines.forEach((l) => this.log(`  ${l}`));
      const fatal = lines.find((l) => FATAL.some((f) => l.toUpperCase().startsWith(f)));
      if (fatal) throw new ObdError(fatal);
      return lines;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  /** Send an OBD request and return one parsed message per ECU reply (empty on NO DATA). */
  async request(cmd: string, timeoutMs?: number): Promise<Message[]> {
    const lines = await this.send(cmd, timeoutMs);
    if (lines.some((l) => l.toUpperCase().includes('NO DATA')) || lines.includes('?')) return [];
    return parseFrames(lines, this.family);
  }

  /** Reset and configure the adapter, then find the car's protocol and its ECUs. */
  async init(onStep: (step: 'reset' | 'protocol' | 'ecus', detail?: string) => void = () => {}): Promise<void> {
    onStep('reset');
    let tries = 0;
    for (;;) {
      try {
        const r = await this.send('ATZ', this.timeoutMs + 1000);
        this.adapterVersion = r.find((l) => /ELM|OBD|v\d/i.test(l)) ?? '';
        break;
      } catch (e) {
        if (++tries >= 2) throw e; // clones often swallow the first command
      }
    }
    for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATAT1', 'ATSP0']) await this.send(c);
    onStep('protocol');
    // The first request triggers the protocol search; give it time.
    const first = await this.send('0100', this.timeoutMs * 3).catch((e) => {
      throw new ObdError(`${(e as Error).message}. Is the ignition on?`);
    });
    if (first.some((l) => l.includes('NO DATA'))) throw new ObdError('The car did not answer. Turn the ignition on and try again.');
    const dpn = (await this.send('ATDPN'))[0] ?? '';
    const info = protocolInfo(dpn);
    this.family = info.family;
    this.protocolName = info.name;
    this.ecus = [...new Set(parseFrames(first, this.family).map((m) => m.ecu))].sort();
    if (this.ecus.length === 0) throw new ObdError('The car did not answer. Turn the ignition on and try again.');
    onStep('ecus', `${this.ecus.length} module${this.ecus.length > 1 ? 's' : ''} answered`);
  }

  async voltage(): Promise<number | null> {
    try {
      const r = await this.send('ATRV');
      const m = r.join(' ').match(/(\d+(?:\.\d+)?)\s*V/i);
      return m ? parseFloat(m[1]) : null;
    } catch { return null; }
  }

  async close() { await this.t.disconnect(); }
}
