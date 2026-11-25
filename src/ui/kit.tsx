import { useEffect, useRef, useState, createContext, useContext, useCallback, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Circle, Loader2, Minus, Wrench, XCircle } from 'lucide-react';
import type { ConnStatus } from './conn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'primary', size = 'md', loading, children, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'sm'; loading?: boolean }) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} aria-busy={loading || undefined} disabled={rest.disabled || loading} {...rest}>
      {loading && <Loader2 className="spin" size={18} aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ to, variant = 'primary', children }: { to: string; variant?: Variant; children: ReactNode }) {
  return <Link className={`btn btn-${variant} btn-md`} to={to}>{children}</Link>;
}

const PILL_TEXT: Record<ConnStatus, string> = {
  connected: 'Connected', connecting: 'Connecting…', disconnected: 'Not connected', error: 'Connection failed',
};
export function StatusPill({ status, label }: { status: ConnStatus; label?: string }) {
  return (
    <span className={`pill pill-${status}`} role="status" aria-live="polite">
      <span className="dot" aria-hidden />
      {label ?? PILL_TEXT[status]}
    </span>
  );
}

export type StepState = 'pending' | 'running' | 'done' | 'failed';
export function StepList({ steps }: { steps: { label: string; state: StepState; detail?: string }[] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i} className={`step step-${s.state}`} aria-current={s.state === 'running' ? 'step' : undefined}>
          <span className="step-icon" aria-hidden>
            {s.state === 'pending' && <Circle size={22} />}
            {s.state === 'running' && <Loader2 size={22} className="spin" />}
            {s.state === 'done' && <CheckCircle2 size={22} />}
            {s.state === 'failed' && <XCircle size={22} />}
          </span>
          <span className="step-label">{s.label}</span>
          {s.detail && <span className="step-detail">{s.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

export function SystemRow({ system, ecu, status, count }: { system: string; ecu?: string; status: 'ok' | 'fault' | 'none'; count: number }) {
  return (
    <div className={`sysrow sys-${status}`}>
      <span className="sys-name">{system}{ecu && <span className="mono muted sys-ecu"> {ecu}</span>}</span>
      <span className="sys-status">
        {status === 'ok' && <CheckCircle2 size={20} aria-label="No faults" />}
        {status === 'fault' && <Wrench size={20} aria-label="Faults found" />}
        {status === 'none' && <Minus size={20} aria-label="No response" />}
        <b>{status === 'none' ? '—' : count}</b>
      </span>
    </div>
  );
}

const BADGE: Record<string, string> = { confirmed: 'Stored', pending: 'Pending', permanent: 'Permanent' };
export function StatusBadge({ status }: { status: 'confirmed' | 'pending' | 'permanent' | 'mil' }) {
  return <span className={`badge badge-${status}`}>{status === 'mil' ? 'Check engine light ON' : BADGE[status]}</span>;
}

export function Field({ label, id, hint, error, ...rest }: { label: string; id: string; hint?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const desc = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${error ? 'field-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-describedby={desc} aria-invalid={!!error || undefined} {...rest} />
      {hint && <span id={`${id}-hint`} className="hint">{hint}</span>}
      {error && <span id={`${id}-err`} className="err">{error}</span>}
    </div>
  );
}

export function Dialog({ open, title, children, onClose, actions }: { open: boolean; title: string; children: ReactNode; onClose: () => void; actions: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="dlg-title">
      <h2 id="dlg-title">{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">{actions}</div>
    </dialog>
  );
}

type Toast = { id: number; kind: 'info' | 'success' | 'error'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Sparkline({ values, min, max }: { values: number[]; min?: number; max?: number }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 100 30" aria-hidden />;
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((Math.min(hi, Math.max(lo, v)) - lo) / span) * 28 - 1}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--c-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children}</div>;
}

export const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
