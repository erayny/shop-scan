import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Elm327 } from '../obd/elm327';
import { J2534Link } from '../obd/j2534';
import type { ObdLink } from '../obd/link';
import { BleTransport, type Transport } from '../obd/transport';
import { SimTransport } from '../obd/sim';

export type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type InitStep = 'bluetooth' | 'reset' | 'protocol' | 'ecus';
export type ConnectKind = 'ble' | { sim: string } | { j2534: string };

interface Conn {
  status: ConnStatus;
  elm: ObdLink | null;
  adapterName: string;
  protocol: string;
  error: string;
  step: InitStep | null;
  stepDetail: string;
  log: string[];
  isDemo: boolean;
  connect: (kind: ConnectKind) => Promise<boolean>;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<Conn | null>(null);

export function ConnProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnStatus>('disconnected');
  const [elm, setElm] = useState<ObdLink | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState<InitStep | null>(null);
  const [stepDetail, setStepDetail] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const linkRef = useRef<ObdLink | Transport | null>(null);

  const onStep = (s: 'reset' | 'protocol' | 'ecus', d?: string) => { setStep(s); setStepDetail(d ?? ''); };

  const connect = useCallback(async (kind: ConnectKind) => {
    setError(''); setLog([]); setStatus('connecting'); setStepDetail('');

    if (typeof kind === 'object' && 'j2534' in kind) {
      setStep('reset');
      const link = new J2534Link();
      linkRef.current = link;
      try {
        await link.init(kind.j2534, onStep);
        setElm(link); setIsDemo(link.adapterName.startsWith('Demo')); setStatus('connected');
        return true;
      } catch (err) {
        setError((err as Error).message); setStatus('error');
        return false;
      }
    }

    setStep('bluetooth');
    const t: Transport = kind === 'ble' ? new BleTransport() : new SimTransport(kind.sim, 25);
    linkRef.current = t;
    try {
      await t.connect();
      const e = new Elm327(t, { log: (l) => setLog((prev) => [...prev.slice(-200), l]) });
      t.onDisconnect(() => {
        if (linkRef.current !== t) return;
        setStatus('disconnected'); setElm(null); setStep(null);
      });
      await e.init(onStep);
      setElm(e); setIsDemo(kind !== 'ble'); setStatus('connected');
      return true;
    } catch (err) {
      // User closed the browser's device chooser: not an error worth shouting about.
      if ((err as Error).name === 'NotFoundError') { setStatus('disconnected'); setStep(null); return false; }
      setError((err as Error).message); setStatus('error');
      t.disconnect().catch(() => {});
      return false;
    }
  }, []);

  const disconnect = useCallback(async () => {
    const l = linkRef.current;
    linkRef.current = null;
    setElm(null); setStatus('disconnected'); setStep(null);
    if (l && 'close' in l) await l.close().catch(() => {});
    else if (l) await l.disconnect().catch(() => {});
  }, []);

  return (
    <Ctx.Provider value={{
      status, elm, adapterName: elm?.adapterName ?? '', protocol: elm?.protocolName ?? '',
      error, step, stepDetail, log, isDemo, connect, disconnect,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useConn(): Conn {
  const c = useContext(Ctx);
  if (!c) throw new Error('useConn outside ConnProvider');
  return c;
}
