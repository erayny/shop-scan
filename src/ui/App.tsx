import { HashRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router';
import { ChevronLeft, Stethoscope } from 'lucide-react';
import { ConnProvider, useConn } from './conn';
import { StatusPill, ToastProvider } from './kit';
import { Home, Connect, SettingsScreen } from './screens/basic';
import { NewScan, RunScan, ScanView, Report } from './screens/scan';
import { Reports, VehicleHistory, Live, DesignGallery } from './screens/more';
import { BRAND } from '../brand';

function Shell() {
  const conn = useConn();
  const loc = useLocation();
  const nav = useNavigate();
  const home = loc.pathname === '/';
  return (
    <>
      <header className="topbar">
        {!home && <button className="back btn-ghost" style={{ color: 'inherit', border: 0 }} onClick={() => nav(-1)} aria-label="Back"><ChevronLeft size={24} /></button>}
        <Link to="/" className="brand"><Stethoscope size={22} aria-hidden /> {BRAND.name}</Link>
        <span className="spacer" />
        <Link to="/connect" aria-label="Adapter connection"><StatusPill status={conn.status} /></Link>
      </header>
      {conn.isDemo && conn.status === 'connected' && <div className="demo-banner">Demo car connected: results are simulated.</div>}
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/scan/new" element={<NewScan />} />
          <Route path="/scan/:id/run" element={<RunScan />} />
          <Route path="/scan/:id/report" element={<Report />} />
          <Route path="/scan/:id" element={<ScanView />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/vehicles/:key" element={<VehicleHistory />} />
          <Route path="/live" element={<Live />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/design" element={<DesignGallery />} />
          <Route path="*" element={<p>Page not found. <Link to="/">Home</Link></p>} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <ConnProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </ConnProvider>
    </HashRouter>
  );
}
