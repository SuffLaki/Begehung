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

let started = false;

export default function App() {
  const route = useRoute();
  const loaded = useApp((s) => s.settingsLoaded);
  const theme = useApp((s) => s.settings.theme);

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
    const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  }, [theme]);

  if (!loaded) return <div className="app"><Loading /></div>;

  const [a, b, c] = route;
  let screen;
  if (!a) screen = <Home />;
  else if (a === 'list') screen = <InspectionList />;
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
      {screen}
      <DialogHost />
      <Toasts />
    </div>
  );
}
