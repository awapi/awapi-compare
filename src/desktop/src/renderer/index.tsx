import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';
import { THEME_STORAGE_KEY } from './state/themeStore.js';

// Set data-theme before React renders to avoid a flash of the default dark theme.
try {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored);
  }
} catch {
  // localStorage unavailable — leave the CSS default (dark) in place
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Defensive guard: prevent the browser from navigating the window to
// file:// URLs when a drag-drop misses the wired drop target. Drop
// targets that want to handle the event still call preventDefault
// in their own handlers; this listener is a no-op for them because
// drop events bubble.
window.addEventListener('dragover', (e: DragEvent) => {
  e.preventDefault();
});
window.addEventListener('drop', (e: DragEvent) => {
  e.preventDefault();
});

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
