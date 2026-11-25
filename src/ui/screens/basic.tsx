import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Bluetooth, Car, FileText, Gauge, Settings as Cog, Stethoscope, Download, Upload } from 'lucide-react';
import { useConn } from '../conn';
import { Button, ButtonLink, Field, StatusPill, StepList, useToast, type StepState } from '../kit';
import { bluetoothAvailable } from '../../obd/transport';
import { SIM_CARS } from '../../obd/sim';
import { db, getSettings, exportAll, importAll, forgetCustomer, DEFAULT_SETTINGS, type Settings } from '../../db';
import { BRAND } from '../../brand';

// S01 Home
export function Home() {
  const conn = useConn();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { db.scans.count().then(setCount); }, []);
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>{BRAND.name}</h1>
        <Link to="/connect"><StatusPill status={conn.status} label={conn.status === 'connected' ? `Connected · ${conn.adapterName}` : undefined} /></Link>
      </div>
      <div className="tiles">
        <Link className="tile" to={conn.status === 'connected' ? '/scan/new' : '/connect?next=scan'}>
          <Stethoscope size={32} aria-hidden /><b>Diagnose</b><span>Scan a car and print the report</span>
        </Link>
        <Link className="tile" to={conn.status === 'connected' ? '/live' : '/connect?next=live'}>
          <Gauge size={32} aria-hidden /><b>Live data</b><span>Watch sensors in real time</span>
        </Link>
        <Link className="tile" to="/reports">
          <FileText size={32} aria-hidden /><b>Reports</b><span>{count === null ? 'Past scans' : `${count} saved scan${count === 1 ? '' : 's'}`}</span>
        </Link>
        <Link className="tile" to="/settings">
          <Cog size={32} aria-hidden /><b>Settings</b><span>Shop details, units, backup</span>
        </Link>
      </div>
    </>
  );
}

// S02 Connect adapter
export function Connect() {
  const conn = useConn();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const [sim, setSim] = useState(SIM_CARS[1].key);
  const order = ['bluetooth', 'reset', 'protocol', 'ecus'] as const;
  const idx = conn.step ? order.indexOf(conn.step) : -1;
  const stateOf = (i: number): StepState => {
    if (conn.status === 'connected') return 'done';
    if (conn.status === 'error' && i === idx) return 'failed';
    if (i < idx) return 'done';
    if (i === idx && conn.status === 'connecting') return 'running';
    return 'pending';
  };
  const go = async (kind: 'ble' | { sim: string }) => {
    const ok = await conn.connect(kind);
    if (ok && next === 'scan') nav('/scan/new');
    if (ok && next === 'live') nav('/live');
  };
  const busy = conn.status === 'connecting';
  return (
    <>
      <h1>Connect adapter</h1>
      <p className="muted">Plug the Bluetooth OBD adapter into the port under the dash, turn the ignition on (engine can be off), then connect.</p>
      <div className="row">
        <StatusPill status={conn.status} />
        {conn.status === 'connected' && <span className="small muted">{conn.adapterName} · {conn.protocol}</span>}
      </div>
      <StepList steps={[
        { label: 'Bluetooth', state: stateOf(0), detail: idx === 0 && busy ? 'Pick your adapter in the list' : undefined },
        { label: 'Adapter reset', state: stateOf(1) },
        { label: 'Find the car’s protocol', state: stateOf(2), detail: idx === 2 && busy ? 'This can take up to 15 seconds' : undefined },
        { label: 'Vehicle modules', state: stateOf(3), detail: conn.status === 'connected' ? conn.stepDetail : undefined },
      ]} />
      {conn.status === 'error' && <p className="err" role="alert" style={{ fontSize: 'var(--fs-base)' }}>{conn.error}</p>}
      {conn.status === 'connected' ? (
        <div className="row">
          <ButtonLink to="/scan/new">Start a scan</ButtonLink>
          <ButtonLink to="/live" variant="secondary">Live data</ButtonLink>
          <Button variant="ghost" onClick={() => conn.disconnect()}>Disconnect</Button>
        </div>
      ) : (
        <>
          <div className="row">
            <Button onClick={() => go('ble')} loading={busy} disabled={!bluetoothAvailable()}><Bluetooth size={20} aria-hidden /> Connect Bluetooth adapter</Button>
          </div>
          {!bluetoothAvailable() && <p className="small muted" style={{ marginTop: 8 }}>This browser has no Bluetooth access. On the shop tablet, open this app in Chrome. You can still try the demo car below.</p>}
          <div className="card" style={{ marginTop: 24 }}>
            <h3><Car size={18} aria-hidden style={{ verticalAlign: -3 }} /> No adapter handy? Use a demo car</h3>
            <p className="small muted">For training and trying the app. Results are simulated and marked DEMO on the report.</p>
            <div className="row">
              <select aria-label="Demo car" value={sim} onChange={(e) => setSim(e.target.value)} className="chip" style={{ minHeight: 48 }}>
                {SIM_CARS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <Button variant="secondary" onClick={() => go({ sim })} disabled={busy}>Connect demo car</Button>
            </div>
          </div>
        </>
      )}
      {conn.log.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary>Adapter log</summary>
          <div className="log">{conn.log.join('\n')}</div>
        </details>
      )}
    </>
  );
}

// S14 Settings
export function SettingsScreen() {
  const toast = useToast();
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [forget, setForget] = useState('');
  useEffect(() => { getSettings().then(setS); }, []);
  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setS({ ...s, [k]: e.target.value });
  const save = async () => { await db.settings.put(s); toast('success', 'Settings saved'); };
  const doExport = async () => {
    const blob = new Blob([await exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shop-scan-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try { const n = await importAll(await f.text()); toast('success', `Backup restored (${n} scans)`); }
    catch (e) { toast('error', (e as Error).message); }
  };
  return (
    <>
      <h1>Settings</h1>
      <h2>Shop details (printed on every report)</h2>
      <div className="form-grid">
        <Field id="shop-name" label="Shop name" value={s.name} onChange={set('name')} autoComplete="organization" />
        <Field id="shop-tel" label="Phone" value={s.tel} onChange={set('tel')} type="tel" />
        <Field id="shop-email" label="Email" value={s.email} onChange={set('email')} type="email" />
        <Field id="shop-address" label="Address" value={s.address} onChange={set('address')} />
        <Field id="shop-tech" label="Default technician" value={s.technician} onChange={set('technician')} />
        <div className="field">
          <label htmlFor="units">Units</label>
          <select id="units" value={s.units} onChange={set('units')}>
            <option value="imperial">Miles, °F, psi</option>
            <option value="metric">Kilometres, °C, kPa</option>
          </select>
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}><Button onClick={save}>Save settings</Button></div>

      <h2>Backup</h2>
      <p className="muted small">All scans live on this tablet only. Export a backup now and then, and keep it somewhere safe.</p>
      <div className="row">
        <Button variant="secondary" onClick={doExport}><Download size={18} aria-hidden /> Export backup</Button>
        <label className="btn btn-secondary btn-md"><Upload size={18} aria-hidden /> Restore backup
          <input type="file" accept="application/json" className="visually-hidden" onChange={(e) => doImport(e.target.files?.[0])} />
        </label>
      </div>

      <h2>Privacy</h2>
      <p className="muted small">Remove a customer’s name and phone number from every saved scan and vehicle.</p>
      <div className="row">
        <input className="search" style={{ maxWidth: 320, margin: 0 }} aria-label="Customer name to remove" placeholder="Customer name, exactly as saved" value={forget} onChange={(e) => setForget(e.target.value)} />
        <Button variant="danger" disabled={!forget.trim()} onClick={async () => {
          const n = await forgetCustomer(forget.trim());
          toast('success', `Removed from ${n} scan${n === 1 ? '' : 's'}`); setForget('');
        }}>Remove customer</Button>
      </div>
    </>
  );
}
