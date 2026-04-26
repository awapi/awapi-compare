# Samples

Two sample trees used as ad-hoc fixtures for manual testing of folder/file
comparison. Not part of the automated test suite.

```
samples/
├── folderA/   # baseline (v1)
└── folderB/   # modified (v2)
```

What each pair exercises:

| Path | Scenario |
| --- | --- |
| `README.md` | Markdown with small textual changes |
| `package.json` | JSON with version + dependency changes |
| `config/app.yaml` | YAML with value changes + added list item |
| `config/database.json` | JSON with nested structural changes (added `replica`) |
| `src/index.ts` | TypeScript with added import + call |
| `src/server.ts` | TypeScript with signature change |
| `src/metrics.ts` | File only in `folderB` (right-only) |
| `docs/CHANGELOG.md` | Markdown with prepended section |
| `docs/notes.txt` | Plain text with line-level differences |
| `.env.example` | Dotenv with value changes + new key |
| `only-in-a.md` | File only in `folderA` (left-only) |
| `only-in-b.md` | File only in `folderB` (right-only) |
