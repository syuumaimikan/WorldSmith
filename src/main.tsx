import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/styles.css';
import { initLocale } from './i18n';
import { loadMods } from './mods/load';

initLocale();

const el = document.getElementById('root');
if (!el) throw new Error('Root element missing');

// Surface anything that escapes React so failures are never silent.
window.addEventListener('error', (e) => {
  console.error('[WorldSmith] uncaught error', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[WorldSmith] unhandled rejection', e.reason);
});

// Right-clicking anything in a game is a game action, not a request for the
// browser's Back/Reload/View-source menu. The one exception is a field you
// are actually typing in, where cut and paste are the point.
window.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement | null;
  if (el && el.closest('input, textarea, [contenteditable="true"], .selectable')) return;
  e.preventDefault();
});

// Mods go in before anything draws, because the content tables they add to
// are what world generation reads. A mod that failed to load is a mod that is
// not there; it must not stop the game from starting.
void loadMods()
  .catch((err) => console.warn('[WorldSmith] mods failed to load', err))
  .finally(() => {
    createRoot(el).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
