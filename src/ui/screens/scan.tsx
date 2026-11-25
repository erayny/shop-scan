import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { AlertTriangle, CheckCircle2, FileText, MessageSquare, Printer, RefreshCw, Share2, Trash2 } from 'lucide-react';
import { useConn } from '../conn';
import { Button, ButtonLink, Dialog, Empty, Field, StatusBadge, StepList, SystemRow, fmtDate, useToast, type StepState } from '../kit';
import { db, getSettings, newReportId, vehicleKey, type ScanRecord, type Settings, DEFAULT_SETTINGS } from '../../db';
import { readVin, runAutoScan, clearCodes, SCAN_STEPS, type StepId, type ScanDtc } from '../../obd/scan';
import { displayValue, formatNumber, pidDef, vinMake, vinYear } from '../../obd/decode';
import { BRAND } from '../../brand';

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

function useScan(id: string | undefined) {
  const [scan, setScan] = useState<ScanRecord | null | undefined>(undefined);
  useEffect(() => { db.scans.get(Number(id)).then((s) => setScan(s ?? null)); }, [id]);
  return [scan, setScan] as const;
}

// S03 Vehicle & customer
export function NewScan() {
  const conn = useConn();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ vin: '', year: '', make: '', model: '', plate: '', odometer: '', odometerUnit: 'mi' as 'mi' | 'km', customerName: '', customerTel: '', roNumber: '', technician: '' });
  const [readingVin, setReadingVin] = useState(false);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [vinMsg, setVinMsg] = useState('');
  const tried = useRef(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const fillFromVehicle = async (vin: string, plate = '') => {
    const v = (vin && await db.vehicles.get(vin)) || (plate && await db.vehicles.where('plate').equalsIgnoreCase(plate).first());
    setF((p) => ({
      ...p,
      vin: vin || p.vin,
      year: p.year || (v ? v.year : '') || String(vinYear(vin) ?? ''),
      make: p.make || (v ? v.make : '') || (vinMake(vin) ?? ''),
      model: p.model || (v ? v.model : ''),
      plate: p.plate || (v ? v.plate : ''),
      customerName: p.customerName || (v ? v.customerName : ''),
      customerTel: p.customerTel || (v ? v.customerTel : ''),
    }));
    if (v) toast('info', 'Filled in from the last visit');
  };

  const doReadVin = async () => {
    if (!conn.elm) return;
    setReadingVin(true); setVinMsg('');
    try {
      const vin = await readVin(conn.elm);
      if (vin) await fillFromVehicle(vin);
      else setVinMsg('This car does not report its VIN (common before 2005). Type it from the dash or door jamb.');
    } catch (e) { setVinMsg((e as Error).message); }
    setReadingVin(false);
  };

  useEffect(() => {
    getSettings().then((s) => setF((p) => ({ ...p, technician: p.technician || s.technician, odometerUnit: s.units === 'metric' ? 'km' : 'mi' })));
    if (conn.elm && !tried.current) { tried.current = true; doReadVin(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.elm]);

  const vinErr = f.vin && !VIN_RE.test(f.vin.toUpperCase()) ? 'A VIN is 17 letters and numbers, without I, O or Q' : undefined;

  const start = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    const vin = f.vin.toUpperCase();
    const rec: ScanRecord = {
      reportId: newReportId(), vehicleKey: vehicleKey(vin, f.plate),
      ...f, vin, plate: f.plate.toUpperCase(),
      startedAt: Date.now(), status: 'running', result: null, notes: '',
    };
    const id = await db.scans.add(rec);
    nav(`/scan/${id}/run`);
  };

  if (conn.status !== 'connected') {
    return <Empty title="Connect the adapter first"><p>The scan reads the car through the OBD adapter.</p><ButtonLink to="/connect?next=scan">Connect adapter</ButtonLink></Empty>;
  }
  return (
    <>
      <h1>Vehicle and customer</h1>
      <div className="vin-row">
        <Field id="vin" label="VIN" value={f.vin} onChange={set('vin')} onBlur={() => VIN_RE.test(f.vin.toUpperCase()) && fillFromVehicle(f.vin.toUpperCase())}
          maxLength={17} autoCapitalize="characters" spellCheck={false} className="mono" error={vinErr} hint={vinMsg || undefined} />
        <Button variant="secondary" onClick={doReadVin} loading={readingVin}>Read VIN</Button>
      </div>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <Field id="year" label="Year" value={f.year} onChange={set('year')} inputMode="numeric" maxLength={4} />
        <Field id="make" label="Make" value={f.make} onChange={set('make')} />
        <Field id="model" label="Model" value={f.model} onChange={set('model')} />
        <Field id="plate" label="License plate" value={f.plate} onChange={set('plate')} onBlur={() => f.plate && !f.vin && fillFromVehicle('', f.plate)} autoCapitalize="characters" />
        <div className="vin-row">
          <Field id="odo" label="Odometer" value={f.odometer} onChange={set('odometer')} inputMode="numeric" />
          <div className="field" style={{ flex: '0 0 84px' }}>
            <label htmlFor="odo-unit" className="visually-hidden">Odometer unit</label>
            <select id="odo-unit" value={f.odometerUnit} onChange={set('odometerUnit')}><option value="mi">mi</option><option value="km">km</option></select>
          </div>
        </div>
        <Field id="ro" label="Repair order #" value={f.roNumber} onChange={set('roNumber')} />
        <Field id="cust" label="Customer name" value={f.customerName} onChange={set('customerName')} autoComplete="off" />
        <Field id="tel" label="Customer phone" value={f.customerTel} onChange={set('customerTel')} type="tel" autoComplete="off" />
        <Field id="tech" label="Technician" value={f.technician} onChange={set('technician')} />
      </div>
      <div className="row row-end" style={{ marginTop: 24 }}>
        <Button onClick={start} disabled={!!vinErr} loading={starting}>Start scan</Button>
      </div>
    </>
  );
}

// S04 Auto-scan progress
export function RunScan() {
  const { id } = useParams();
  const conn = useConn();
  const nav = useNavigate();
  const [scan] = useScan(id);
  const [states, setStates] = useState<Record<string, { state: StepState; detail?: string }>>({});
  const started = useRef(false);

  useEffect(() => {
    if (!scan || scan.status !== 'running' || !conn.elm || started.current) return;
    started.current = true;
    (async () => {
      try {
        const result = await runAutoScan(conn.elm!, (sid: StepId, st, detail) => setStates((p) => ({ ...p, [sid]: { state: st, detail } })));
        const vin = scan.vin || result.vin || '';
        const upd: Partial<ScanRecord> = { status: 'complete', result, vin };
        if (!scan.vin && result.vin) {
          upd.vehicleKey = vehicleKey(result.vin, scan.plate);
          upd.year = scan.year || String(vinYear(result.vin) ?? '');
          upd.make = scan.make || (vinMake(result.vin) ?? '');
        }
        await db.scans.update(scan.id!, upd);
        const full = { ...scan, ...upd };
        if (vin || scan.plate) {
          await db.vehicles.put({
            key: full.vehicleKey, vin, year: full.year, make: full.make, model: full.model, plate: full.plate,
            customerName: full.customerName, customerTel: full.customerTel, updatedAt: Date.now(),
          });
        }
        nav(`/scan/${scan.id}`, { replace: true });
      } catch (e) {
        await db.scans.update(scan.id!, { status: 'failed' });
        setStates((p) => ({ ...p, error: { state: 'failed', detail: (e as Error).message } }));
      }
    })();
  }, [scan, conn.elm, nav]);

  if (scan === undefined) return null;
  if (scan === null) return <Empty title="Scan not found" />;
  if (scan.status === 'complete') return <Navigate to={`/scan/${scan.id}`} replace />;
  if (!conn.elm) return <Empty title="The adapter is not connected"><p>This scan has not finished. Reconnect and it carries on.</p><ButtonLink to={`/connect?next=${encodeURIComponent(`/scan/${scan.id}/run`)}`}>Reconnect</ButtonLink></Empty>;
  return (
    <>
      <h1>Scanning…</h1>
      <p className="muted">{[scan.year, scan.make, scan.model].filter(Boolean).join(' ') || 'Vehicle'} · keep the ignition on</p>
      <StepList steps={SCAN_STEPS.map((s) => ({ label: s.label, state: states[s.id]?.state ?? 'pending', detail: states[s.id]?.detail }))} />
      {states.error && <p className="err" role="alert">{states.error.detail}</p>}
    </>
  );
}

const vehicleTitle = (s: ScanRecord) => [s.year, s.make, s.model].filter(Boolean).join(' ') || 'Vehicle';

function groupDtcs(dtcs: ScanDtc[]) {
  const groups = new Map<string, ScanDtc[]>();
  for (const d of dtcs) groups.set(d.system, [...(groups.get(d.system) ?? []), d]);
  return [...groups.entries()];
}

function DtcTable({ dtcs }: { dtcs: ScanDtc[] }) {
  return (
    <>
      {groupDtcs(dtcs).map(([system, list]) => (
        <div className="dtc-group" key={system}>
          <h3>{system}</h3>
          <div className="table-head"><span>Code · description</span><span>Status</span></div>
          {list.map((d) => (
            <div className="dtc" key={d.code + d.status + d.ecu}>
              <span className="code">{d.code}</span>
              <span className={d.known ? '' : 'unknown'}>{d.description}</span>
              <StatusBadge status={d.status} />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// S05–S08, S10 Results
export function ScanView() {
  const { id } = useParams();
  const conn = useConn();
  const nav = useNavigate();
  const toast = useToast();
  const [scan] = useScan(id);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  useEffect(() => { getSettings().then(setSettings); }, []);

  if (scan === undefined) return null;
  if (scan === null || !scan.result) return <Empty title="Scan not found or not finished"><ButtonLink to="/reports">All reports</ButtonLink></Empty>;
  const r = scan.result;
  const faults = new Set(r.dtcs.map((d) => d.code)).size;

  const rescan = async () => {
    const { id: _old, ...rest } = scan;
    const newId = await db.scans.add({ ...rest, reportId: newReportId(), startedAt: Date.now(), status: 'running', result: null, notes: '' });
    nav(`/scan/${newId}/run`);
  };
  const doClear = async () => {
    if (!conn.elm) return;
    setClearing(true);
    try {
      await clearCodes(conn.elm);
      await db.scans.update(scan.id!, { clearedAt: Date.now() });
      toast('success', 'Codes cleared. Checking again…');
      setConfirmClear(false);
      await rescan();
    } catch (e) { toast('error', `Could not clear codes: ${(e as Error).message}`); }
    setClearing(false);
  };

  return (
    <>
      <h1>{vehicleTitle(scan)}</h1>
      <p className="muted small">{fmtDate(scan.startedAt)} · {scan.reportId}{scan.vin && <> · <span className="mono">{scan.vin}</span></>}</p>
      <div className={`banner ${faults || r.milOn ? 'banner-bad' : 'banner-ok'}`}>
        {faults || r.milOn ? <AlertTriangle size={36} aria-hidden /> : <CheckCircle2 size={36} aria-hidden />}
        <div>
          <b>{faults ? `${faults} trouble code${faults > 1 ? 's' : ''} found` : 'No trouble codes'}</b>
          <span>{r.milOn ? 'Check engine light is ON.' : 'Check engine light is off.'} {r.voltage ? `Battery ${r.voltage.toFixed(1)} V.` : ''}</span>
        </div>
      </div>
      <div className="row no-print">
        <ButtonLink to={`/scan/${scan.id}/report`}><FileText size={18} aria-hidden /> Customer report</ButtonLink>
        <Button variant="secondary" onClick={rescan} disabled={!conn.elm}><RefreshCw size={18} aria-hidden /> Scan again</Button>
        <Button variant="danger" onClick={() => setConfirmClear(true)} disabled={!conn.elm || faults === 0}><Trash2 size={18} aria-hidden /> Clear codes</Button>
      </div>
      <p className="small no-print" style={{ marginTop: 12 }}><Link to={`/vehicles/${encodeURIComponent(scan.vehicleKey)}`}>Vehicle history (all visits)</Link></p>
      {scan.clearedAt && <p className="small muted" style={{ marginTop: 8 }}>Codes were cleared after this scan ({fmtDate(scan.clearedAt)}).</p>}

      <h2>Systems checked ({r.systems.length})</h2>
      <div className="table-head"><span>System</span><span>Status / codes</span></div>
      {r.systems.map((s) => <SystemRow key={s.ecu} system={s.system} ecu={s.ecu} status={s.status} count={s.dtcCount} />)}
      <p className="small muted" style={{ marginTop: 8 }}>A generic OBD-II scan reads the engine and emissions modules. Airbag, ABS and body modules need a manufacturer-level tool.</p>

      <h2>Trouble codes ({faults})</h2>
      {r.dtcs.length ? <DtcTable dtcs={r.dtcs} /> : <p className="muted">None stored, pending or permanent.</p>}

      {r.freezeFrame && (
        <>
          <h2>Freeze frame <span className="muted small">· conditions when {r.freezeFrame.dtc} was set</span></h2>
          <div className="kv">
            {r.freezeFrame.values.map((v) => {
              const def = pidDef(v.pid)!;
              const d = displayValue(def, v.value, settings.units);
              return [<span key={v.pid + 'n'}>{def.name}</span>, <span key={v.pid + 'v'}>{formatNumber(d.value, d.unit)} {d.unit}</span>];
            })}
          </div>
        </>
      )}

      <h2>Readiness monitors</h2>
      {r.monitors.length ? (
        <>
          <p className="small muted">{r.monitors.filter((m) => m.supported && !m.complete).length === 0 ? 'All supported monitors have run. Ready for an emissions inspection (if the check engine light is off).' : 'Some monitors have not finished. The car may need more driving before an emissions inspection.'}</p>
          <div className="kv">
            {r.monitors.filter((m) => m.supported).map((m) => [
              <span key={m.name}>{m.name}</span>,
              <span key={m.name + 'v'} className={m.complete ? 'mon-ok' : 'mon-no'}>{m.complete ? 'Complete' : 'Not ready'}</span>,
            ])}
          </div>
        </>
      ) : <p className="muted">Not reported.</p>}
      <p className="small muted" style={{ marginTop: 16 }}>Protocol: {r.protocol} · Adapter: {r.adapter}</p>

      <Dialog open={confirmClear} title="Clear trouble codes?" onClose={() => setConfirmClear(false)} actions={<>
        <Button variant="secondary" onClick={() => setConfirmClear(false)}>Cancel</Button>
        <Button variant="danger" onClick={doClear} loading={clearing}>Clear codes</Button>
      </>}>
        <p>This turns off the check engine light and erases the freeze frame.</p>
        <p><b>Readiness monitors reset to “not ready”.</b> The car can fail an emissions inspection until it has been driven enough for them to finish.</p>
        <p className="muted small">Permanent codes stay until the car confirms the repair itself. Clear only after the repair. Engine off, ignition on.</p>
      </Dialog>
    </>
  );
}

// S11 Customer report
export function Report() {
  const { id } = useParams();
  const toast = useToast();
  const [scan, setScan] = useScan(id);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => { getSettings().then(setSettings); }, []);
  if (scan === undefined) return null;
  if (scan === null || !scan.result) return <Empty title="Report not found" />;
  const r = scan.result;
  const demo = r.adapter.startsWith('Demo');
  const odo = scan.odometer ? `${Number(scan.odometer).toLocaleString()} ${scan.odometerUnit}` : '—';
  const summary = () => [
    `${settings.name || BRAND.name} — vehicle scan report ${scan.reportId}`,
    `${vehicleTitle(scan)}${scan.vin ? ` (VIN ${scan.vin})` : ''}`,
    `Scanned ${fmtDate(scan.startedAt)}. Check engine light ${r.milOn ? 'ON' : 'off'}.`,
    r.dtcs.length ? r.dtcs.map((d) => `${d.code} (${d.status}): ${d.description}`).join('\n') : 'No trouble codes found.',
    scan.notes ? `Notes: ${scan.notes}` : '',
    settings.tel ? `Questions? Call ${settings.tel}` : '',
  ].filter(Boolean).join('\n');
  const share = async () => {
    const text = summary();
    if (navigator.share) { try { await navigator.share({ title: `Scan report ${scan.reportId}`, text }); } catch { /* cancelled */ } }
    else { await navigator.clipboard.writeText(text); toast('success', 'Report summary copied'); }
  };
  return (
    <>
      <div className="row no-print" style={{ marginBottom: 16 }}>
        <Button onClick={() => window.print()}><Printer size={18} aria-hidden /> Print / save PDF</Button>
        <Button variant="secondary" onClick={share}><Share2 size={18} aria-hidden /> Share summary</Button>
        {scan.customerTel && <a className="btn btn-secondary btn-md" href={`sms:${scan.customerTel.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(summary())}`}><MessageSquare size={18} aria-hidden /> Text customer</a>}
        <Link to={`/scan/${scan.id}`} className="btn btn-ghost btn-md">Back to results</Link>
      </div>
      <article className="report">
        <header className="rep-head">
          <div className="rep-shop">
            <b>{settings.name || 'Your shop name (set it in Settings)'}</b>
            {settings.address && <div className="small">{settings.address}</div>}
            <div className="small">{[settings.tel, settings.email].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="rep-meta small">
            <div>Report <b className="mono">{scan.reportId}</b></div>
            <div>{fmtDate(scan.startedAt)}</div>
            <div>Technician: {scan.technician || '—'}</div>
          </div>
        </header>
        {demo && <p className="badge badge-pending" style={{ marginTop: 12 }}>DEMO — simulated vehicle, not a real scan</p>}
        <h1 className="rep-title">{vehicleTitle(scan)} — Vehicle Scan Report</h1>
        <div className="rep-info">
          <h3>Vehicle</h3>
          <span>VIN: <span className="mono">{scan.vin || '—'}</span></span><span>Odometer: {odo}</span>
          <span>Plate: {scan.plate || '—'}</span><span>Repair order: {scan.roNumber || '—'}</span>
          <h3>Customer</h3>
          <span>Name: {scan.customerName || '—'}</span><span>Phone: {scan.customerTel || '—'}</span>
        </div>
        <div className={`banner ${r.dtcs.length || r.milOn ? 'banner-bad' : 'banner-ok'}`} style={{ marginTop: 16 }}>
          <div>
            <b>{r.dtcs.length ? (() => { const n = new Set(r.dtcs.map((d) => d.code)).size; return `${n} trouble code${n > 1 ? 's' : ''} found`; })() : 'No trouble codes found'}</b>
            <span>Check engine light {r.milOn ? 'ON' : 'off'}{r.voltage ? ` · Battery ${r.voltage.toFixed(1)} V` : ''}</span>
          </div>
        </div>
        <h2 className="rep-section">Systems checked ({r.systems.length})</h2>
        <div className="table-head"><span>System</span><span>Status / codes</span></div>
        {r.systems.map((s) => <SystemRow key={s.ecu} system={s.system} status={s.status} count={s.dtcCount} />)}
        {r.dtcs.length > 0 && (<><h2 className="rep-section">Trouble codes ({new Set(r.dtcs.map((d) => d.code)).size})</h2><DtcTable dtcs={r.dtcs} /></>)}
        {r.monitors.some((m) => m.supported) && (
          <>
            <h2 className="rep-section">Emissions readiness</h2>
            <div className="kv">
              {r.monitors.filter((m) => m.supported).map((m) => [<span key={m.name}>{m.name}</span>, <span key={m.name + 'v'} className={m.complete ? 'mon-ok' : 'mon-no'}>{m.complete ? 'Complete' : 'Not ready'}</span>])}
            </div>
          </>
        )}
        <h2 className="rep-section">Technician notes</h2>
        <textarea className="no-print" aria-label="Technician notes" value={scan.notes} placeholder="What you found and what you recommend. Printed on the report."
          onChange={(e) => { const notes = e.target.value; setScan({ ...scan, notes }); db.scans.update(scan.id!, { notes }); }} />
        <p className="notes-print" style={{ display: 'none' }}>{scan.notes}</p>
        <style>{'@media print { .notes-print { display: block !important; } }'}</style>
        <div className="sign">
          <span>Customer:</span><span /><span>Technician:</span><span /><span>Date:</span><span />
        </div>
        <footer className="rep-foot">
          Generic OBD-II scan of engine and emissions systems over {r.protocol}. It is a starting point for diagnosis, not a repair estimate. Keep this report with your vehicle records.
        </footer>
      </article>
    </>
  );
}
