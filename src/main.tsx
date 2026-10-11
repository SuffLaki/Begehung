import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';

// Vorschau: alte Service Worker/Zwischenspeicher entfernen (sonst zeigt der Browser einen alten Stand)
if (import.meta.env.VITE_PREVIEW_BANNER && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then(async (regs) => {
    if (!regs.length) return;
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
    window.location.reload();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
