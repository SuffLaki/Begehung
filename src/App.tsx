import { useEffect } from 'react';
import { useRoute } from './router';
import { useApp } from './state/appStore';
import { requestPersistence } from './storage/db';
import { startJobWatcher } from './sync/jobs';
import { DialogHost, Loading, Toasts } from './ui/kit';
import Home from './screens/Home';
import InspectionList from './screens/InspectionList';
import InspectionForm from './screens/InspectionForm';
import Templates from './screens/Templates';
import SettingsScreen from './screens/Settings';
import InspectionShell from './screens/inspection/InspectionShell';
import PdfWizard from './screens/PdfWizard';
import PdfPreview from './screens/PdfPreview';
import FinishCheck from './screens/FinishCheck';
import Meldungen from './screens/Meldungen';
import Splash, { OfflineNotice } from './ui/Splash';
import { applyLogo } from './brand/logos';

let started = false;

export default function App() {
  const route = useRoute();
  const loaded = useApp((s) => s.settingsLoaded);
  const theme = useApp((s) => s.settings.theme);
  const design = useApp((s) => s.settings.design ?? 'trasse');
  const textSize = useApp((s) => s.settings.textSize ?? 'normal');
  const appLogo = useApp((s) => s.settings.appLogo);

  useEffect(() => {
    if (started) return;
    started = true;
    void useApp.getState().initSettings();
    void requestPersistence();
    startJobWatcher();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    root.setAttribute('data-design', design);
    if (design === 'klassisch') root.removeAttribute('data-styled'); else root.setAttribute('data-styled', '');
    root.setAttribute('data-text', textSize);
    const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const bar = design === 'trasse' ? (dark ? '#133a2e' : '#18493a') : design === 'magenta' ? (dark ? '#6e003b' : '#b8005f') : dark ? '#000000' : '#f2f2f7';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar);
  }, [theme, design, textSize]);

  useEffect(() => { if (loaded) void applyLogo(appLogo); }, [loaded, appLogo]);

  if (!loaded) return <div className="app"><Loading /><Splash /></div>;

  const [a, b, c] = route;
  let screen;
  if (!a) screen = <Home />;
  else if (a === 'list') screen = <InspectionList />;
  else if (a === 'meldungen') screen = <Meldungen />;
  else if (a === 'new') screen = <InspectionForm />;
  else if (a === 'templates') screen = <Templates />;
  else if (a === 'settings') screen = <SettingsScreen />;
  else if (a === 'i' && b) {
    if (c === 'meta') screen = <InspectionForm editId={b} />;
    else if (c === 'pdf') screen = <PdfWizard id={b} />;
    else if (c === 'preview') screen = <PdfPreview id={b} />;
    else if (c === 'finish') screen = <FinishCheck id={b} />;
    else screen = <InspectionShell id={b} tab={c ?? 'overview'} />;
  } else screen = <Home />;

  return (
    <div className="app">
      {import.meta.env.VITE_PREVIEW_BANNER && <div className="preview-banner">VORSCHAU – noch nicht veröffentlicht</div>}
      {screen}
      <DialogHost />
      <Toasts />
      <OfflineNotice />
      <Splash />
    </div>
  );
}
