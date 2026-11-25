import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Pause, Play } from 'lucide-react';
import { useConn } from '../conn';
import { Button, ButtonLink, Dialog, Empty, Field, Sparkline, StatusBadge, StatusPill, StepList, SystemRow, fmtDate } from '../kit';
import { db, getSettings, type ScanRecord, type Vehicle, DEFAULT_SETTINGS, type Settings } from '../../db';
import { PIDS, displayValue, formatNumber, pidDef } from '../../obd/decode';
import { readLive, readSupportedPids } from '../../obd/scan';

const title = (s: { year: string; make: string; model: string }) => [s.year, s.make, s.model].filter(Boolean).join(' ') || 'Vehicle';

// S12 Report history
export function Reports() {
  const [scans, setScans] = useState<ScanRecord[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { db.scans.orderBy('startedAt').reverse().toArray().then(setScans); }, []);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!scans) return [];
    return scans.filter((s) => s.status !== 'failed' && (!t || [s.vin, s.plate, s.customerName, s.make, s.model, s.reportId, s.roNumber].some((x) => x?.toLowerCase().includes(t))));
  }, [scans, q]);
  if (!scans) return null;
  return (
    <>
      <h1>Reports</h1>
      <input className="search" type="search" placeholder="Search VIN, plate, customer, make, RO #" aria-label="Search reports" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.length === 0 ? (
        <Empty title={scans.length ? 'No reports match' : 'No scans yet'}>{!scans.length && <><p>Scans you run are saved here.</p><ButtonLink to="/connect?next=scan">Start the first scan</ButtonLink></>}</Empty>
      ) : (
        <ul className="list">
          {shown.map((s) => {
            const n = new Set(s.result?.dtcs.map((d) => d.code)).size;
            return (
              <li key={s.id}>
                <Link to={s.status === 'running' ? `/scan/${s.id}/run` : `/scan/${s.id}`}>
                  <span>
                    <b>{title(s)}</b>{s.plate && <span className="muted"> · {s.plate}</span>}
                    <div className="small muted">{fmtDate(s.startedAt)}{s.customerName && ` · ${s.customerName}`}</div>
                  </span>
                  {s.status === 'running'
                    ? <span className="mon-no" style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Not finished · resume</span>
                    : <span className={n ? 'err' : 'mon-ok'} style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{n ? `${n} code${n > 1 ? 's' : ''}` : 'No codes'}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// S13 Vehicle history
export function VehicleHistory() {
  const { key } = useParams();
  const [v, setV] = useState<Vehicle | null>(null);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  useEffect(() => {
    const k = decodeURIComponent(key ?? '');
    db.vehicles.get(k).then((x) => setV(x ?? null));
    db.scans.where('vehicleKey').equals(k).reverse().sortBy('startedAt').then(setScans);
  }, [key]);
  if (!v && !scans.length) return <Empty title="No history for this vehicle" />;
  const head = v ?? scans[0];
  return (
    <>
      <h1>{title(head)}</h1>
      <p className="muted small">{head.vin && <span className="mono">{head.vin}</span>} {head.plate && ` · ${head.plate}`} {head.customerName && ` · ${head.customerName}`}</p>
      <h2>Visits ({scans.length})</h2>
      <ul className="list">
        {scans.map((s) => (
          <li key={s.id}>
            <Link to={`/scan/${s.id}`}>
              <span>{fmtDate(s.startedAt)}{s.odometer && <span className="muted"> · {s.odometer} {s.odometerUnit}</span>}</span>
              <span className="small">{s.result?.dtcs.map((d) => d.code).filter((c, i, a) => a.indexOf(c) === i).join(', ') || 'No codes'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

// S09 Live data
const DEFAULT_LIVE = [0x0c, 0x05, 0x06, 0x07, 0x11, 0x42];
export function Live() {
  const conn = useConn();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [supported, setSupported] = useState<number[] | null>(null);
  const [picked, setPicked] = useState<number[]>(DEFAULT_LIVE);
  const [running, setRunning] = useState(true);
  const [series, setSeries] = useState<Record<number, { t: number; v: number }[]>>({});
  const pickedRef = useRef(picked); pickedRef.current = picked;
  const runRef = useRef(running); runRef.current = running;

  useEffect(() => { getSettings().then(setSettings); }, []);
  useEffect(() => {
    if (!conn.elm) return;
    readSupportedPids(conn.elm).then((s) => { setSupported(s); setPicked((p) => p.filter((x) => s.includes(x))); });
  }, [conn.elm]);

  useEffect(() => {
    if (!conn.elm || !supported) return;
    let alive = true;
    (async () => {
      while (alive) {
        if (!runRef.current || pickedRef.current.length === 0) { await new Promise((r) => setTimeout(r, 200)); continue; }
        for (const pid of pickedRef.current) {
          if (!alive) break;
          try {
            const v = await readLive(conn.elm!, pid);
            if (v !== null) setSeries((p) => ({ ...p, [pid]: [...(p[pid] ?? []).slice(-59), { t: Date.now(), v }] }));
          } catch { await new Promise((r) => setTimeout(r, 300)); }
        }
      }
    })();
    return () => { alive = false; };
  }, [conn.elm, supported]);

  if (!conn.elm) return <Empty title="Connect the adapter first"><ButtonLink to="/connect?next=live">Connect adapter</ButtonLink></Empty>;
  const toggle = (pid: number) => setPicked((p) => (p.includes(pid) ? p.filter((x) => x !== pid) : [...p, pid]));
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Live data</h1>
        <Button variant="secondary" onClick={() => setRunning(!running)}>{running ? <><Pause size={18} aria-hidden /> Pause</> : <><Play size={18} aria-hidden /> Resume</>}</Button>
      </div>
      <p className="small muted">Fewer sensors update faster. Tap to add or remove.</p>
      <div className="pid-picker" role="group" aria-label="Sensors">
        {PIDS.filter((p) => !supported || supported.includes(p.pid)).map((p) => (
          <button key={p.pid} className="chip" aria-pressed={picked.includes(p.pid)} onClick={() => toggle(p.pid)}>{p.name}</button>
        ))}
      </div>
      {supported === null ? <p className="muted">Asking the car which sensors it supports…</p> : (
        <div className="cards">
          {picked.map((pid) => {
            const def = pidDef(pid)!;
            const pts = series[pid] ?? [];
            const last = pts[pts.length - 1];
            const stale = !last || Date.now() - last.t > 3000;
            const d = last ? displayValue(def, last.v, settings.units) : { value: NaN, unit: displayValue(def, 0, settings.units).unit };
            const conv = (x: number) => displayValue(def, x, settings.units).value;
            return (
              <div key={pid} className={`value-card ${stale ? 'stale' : ''}`} aria-live="off">
                <div className="small muted">{def.name}</div>
                <div><span className="v">{last ? formatNumber(d.value, d.unit) : '—'}</span> <span className="muted">{d.unit}</span></div>
                <Sparkline values={pts.map((p) => conv(p.v))} min={def.min !== undefined ? conv(def.min) : undefined} max={def.max !== undefined ? conv(def.max) : undefined} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// Design system check page (/design): every primitive, every state.
export function DesignGallery() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <h1>Design system</h1>
      <h2>Buttons</h2>
      <div className="row"><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button disabled>Disabled</Button><Button loading>Loading</Button><Button size="sm">Small</Button></div>
      <h2>Status pill</h2>
      <div className="row"><StatusPill status="connected" /><StatusPill status="connecting" /><StatusPill status="disconnected" /><StatusPill status="error" /></div>
      <h2>Badges</h2>
      <div className="row"><StatusBadge status="confirmed" /><StatusBadge status="pending" /><StatusBadge status="permanent" /><StatusBadge status="mil" /></div>
      <h2>System rows</h2>
      <SystemRow system="Engine" ecu="7E8" status="fault" count={3} /><SystemRow system="Transmission" ecu="7E9" status="ok" count={0} /><SystemRow system="Module 7EB" status="none" count={0} />
      <h2>Steps</h2>
      <StepList steps={[{ label: 'Done step', state: 'done', detail: 'detail' }, { label: 'Running step', state: 'running' }, { label: 'Failed step', state: 'failed', detail: 'What went wrong' }, { label: 'Pending step', state: 'pending' }]} />
      <h2>Fields</h2>
      <div className="form-grid"><Field id="d1" label="Default" placeholder="Type here" /><Field id="d2" label="With hint" hint="Helpful hint" /><Field id="d3" label="With error" error="This needs fixing" defaultValue="bad" /><Field id="d4" label="Disabled" disabled /></div>
      <h2>Live value</h2>
      <div className="cards"><div className="value-card"><div className="small muted">Engine RPM</div><span className="v">752</span> <span className="muted">rpm</span><Sparkline values={[700, 760, 740, 780, 750, 755, 748]} /></div><div className="value-card stale"><div className="small muted">Stale value</div><span className="v">88</span> <span className="muted">°F</span></div></div>
      <h2>Dialog</h2>
      <Button variant="secondary" onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog open={open} title="Danger confirm" onClose={() => setOpen(false)} actions={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => setOpen(false)}>Confirm</Button></>}><p>Explains the consequences first.</p></Dialog>
    </>
  );
}
