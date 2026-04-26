// Vitest stub for `monaco-editor`. The renderer's `TextDiffView`
// statically references the package so that Vite (in production) can
// bundle it, but the tests never mount the editor — they pass an
// explicit `monacoLoader` prop. Aliasing the import here avoids
// pulling Monaco's entire ESM tree into vite-node test runs.
export const editor = {
  createDiffEditor() {
    throw new Error('monaco-editor stub: createDiffEditor should not be called in tests');
  },
  createModel() {
    throw new Error('monaco-editor stub: createModel should not be called in tests');
  },
};

export default { editor };
