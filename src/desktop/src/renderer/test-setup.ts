import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

afterEach(async () => {
  // Only run RTL cleanup in jsdom-environment tests; in node-only tests
  // there is no document to scrub and importing RTL would try to touch
  // window APIs that don't exist.
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});
