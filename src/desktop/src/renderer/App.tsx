import type { JSX } from 'react';

export function App(): JSX.Element {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem',
        color: '#e6e6e6',
        background: '#1e1e1e',
        minHeight: '100vh',
      }}
    >
      <h1>AwapiCompare</h1>
      <p>Folder/file compare — scaffolding in place. Phase 3+ to wire up the UI.</p>
    </main>
  );
}
