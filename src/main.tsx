import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/styles.css';
import { initLocale } from './i18n';

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

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
