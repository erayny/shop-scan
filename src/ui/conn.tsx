import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Elm327 } from '../obd/elm327';
import { BleTransport, type Transport } from '../obd/transport';
import { SimTransport } from '../obd/sim';

export type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type InitStep = 'bluetooth' | 'reset' | 'protocol' | 'ecus';

interface Conn {
  status: ConnStatus;
  elm: Elm327 | null;
  adapterName: string;
  protocol: string;
  error: string;
  step: InitStep | null;
  stepDetail: string;
  log: string[];
  isDemo: boolean;
  connect: (kind: 'ble' | { sim: string }) => Promise<boolean>;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<Conn | null>(null);

export function ConnProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnStatus>('disconnected');
  const [elm, setElm] = useState<Elm327 | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState<InitStep | null>(null);
  const [stepDetail, setStepDetail] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const transportRef = useRef<Transport | null>(null);

  const connect = useCallback(async (kind: 'ble' | { sim: string }) => {
    setError(''); setLog([]); setStatus('connecting'); setStep('bluetooth'); setStepDetail('');
    const t: Transport = kind === 'ble' ? new BleTransport() : new SimTransport(kind.sim, 25);
    transportRef.current = t;
    try {
      await t.connect();
      const e = new Elm327(t, { log: (l) => setLog((prev) => [...prev.slice(-200), l]) });
      t.onDisconnect(() => {
        if (transportRef.current !== t) return;
        setStatus('disconnected'); setElm(null); setStep(null);
      });
      await e.init((s, d) => { setStep(s); setStepDetail(d ?? ''); });
      setElm(e); setIsDemo(kind !== 'ble'); setStatus('connected');
      return true;
    } catch (err) {
      const msg = (err as Error).message;
      // User closed the browser's device chooser: not an error worth shouting about.
      if ((err as Error).name === 'NotFoundError') { setStatus('disconnected'); setStep(null); return false; }
      setError(msg); setStatus('error');
      t.disconnect().catch(() => {});
      return false;
    }
  }, []);

  const disconnect = useCallback(async () => {
    const t = transportRef.current;
    transportRef.current = null;
    setElm(null); setStatus('disconnected'); setStep(null);
    await t?.disconnect().catch(() => {});
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
