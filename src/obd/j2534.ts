// Client for Liftside Bridge: a small Windows program that drives a J2534
// pass-thru device (e.g. a MaxiFlash) and serves this app on 127.0.0.1.
// The bridge speaks plain JSON over same-origin HTTP.
import type { Message, ProtocolFamily } from './decode';
import type { ObdLink } from './link';
import { ObdError } from './elm327';

export interface J2534Device { name: string; vendor: string; library: string; protocols: string }

async function call<T>(path: string, body?: unknown, timeoutMs = 20000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`./api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ObdError(data.error || `Bridge error ${r.status}`);
    return data as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new ObdError('Liftside Bridge did not answer in time.');
    if (e instanceof ObdError) throw e;
    throw new ObdError('Cannot reach Liftside Bridge. Is it still running on this PC?');
  } finally {
    clearTimeout(timer);
  }
}

/** Devices registered with Windows as J2534 pass-thru, or null when not running inside the bridge. */
export async function bridgeDevices(): Promise<J2534Device[] | null> {
  try {
    const r = await fetch('./api/devices');
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    return ((await r.json()) as { devices: J2534Device[] }).devices;
  } catch {
    return null;
  }
}

interface ConnectReply { device: string; protocol: string; family: ProtocolFamily; ecus: string[] }

export class J2534Link implements ObdLink {
  adapterName = '';
  protocolName = '';
  family: ProtocolFamily = 'can11';
  ecus: string[] = [];

  /** Open the device and find the car's CAN setup (11/29 bit, 500/250 kbaud). */
  async init(device: string, onStep: (step: 'reset' | 'protocol' | 'ecus', detail?: string) => void = () => {}) {
    onStep('reset');
    onStep('protocol');
    const r = await call<ConnectReply>('connect', { device }, 30000);
    this.adapterName = r.device;
    this.protocolName = r.protocol;
    this.family = r.family;
    this.ecus = r.ecus;
    onStep('ecus', `${r.ecus.length} module${r.ecus.length > 1 ? 's' : ''} answered`);
  }

  async request(cmd: string, timeoutMs = 3000): Promise<Message[]> {
    const r = await call<{ replies: { ecu: string; data: string }[] }>('request', { hex: cmd, timeoutMs }, timeoutMs + 5000);
    return r.replies.map((x) => ({ ecu: x.ecu, data: (x.data.match(/../g) ?? []).map((h) => parseInt(h, 16)) }));
  }

  async voltage(): Promise<number | null> {
    try { return (await call<{ volts: number | null }>('voltage')).volts; } catch { return null; }
  }

  async close() { await call('disconnect', {}).catch(() => {}); }
}
