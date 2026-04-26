import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      // Tests never mount the real Monaco editor (the few that touch
      // TextDiffView pass an explicit `monacoLoader` prop). Pointing
      // every `monaco-editor*` specifier — including the `?worker`
      // deep imports — at a tiny stub keeps vite-node from resolving
      // Monaco's heavy ESM tree.
      {
        find: /^monaco-editor(\/.*)?(\?worker)?$/,
        replacement: resolve(
          __dirname,
          'src/desktop/src/renderer/test-stubs/monaco-editor.ts',
        ),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['src/desktop/src/renderer/**/*.test.{ts,tsx}', 'jsdom'],
    ],
    setupFiles: ['./src/desktop/src/renderer/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/dist/**',
        '**/out/**',
        // Barrel files — no logic to cover.
        '**/index.ts',
        // Scaffold areas covered by later phases (Electron-dependent or
        // entry points). Remove each entry once tests are added.
        'src/desktop/**',
        'src/cli/src/index.ts',
        'src/licensing/src/provider.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
