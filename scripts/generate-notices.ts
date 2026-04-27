#!/usr/bin/env tsx
/**
 * Regenerates THIRD_PARTY_NOTICES.md from the installed production
 * dependency tree. Runs at package time and is safe to run locally.
 *
 * Uses `pnpm licenses list --json --prod` which is shipped with pnpm.
 * Any dep with a non-permissive license causes this script to exit 1,
 * so a forbidden license cannot slip into a release build.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'Apache 2.0',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
  'BlueOak-1.0.0',
]);

interface PnpmLicenseEntry {
  name: string;
  version: string;
  license: string;
  homepage?: string;
  author?: string | { name?: string };
}

type PnpmLicenseReport = Record<string, PnpmLicenseEntry[]>;

function licenseIsAllowed(license: string): boolean {
  // pnpm sometimes reports compound licenses like "(MIT OR Apache-2.0)".
  const tokens = license
    .replace(/[()]/g, '')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((t) => t.trim());
  return tokens.some((t) => ALLOWED.has(t));
}

function main(): void {
  // On Windows, pnpm is shipped as `pnpm.cmd`, which Node's `execFileSync`
  // cannot resolve without a shell. Use `shell: true` so the same call
  // works across macOS, Linux and Windows runners. Arguments are static
  // literals, so this does not introduce a shell-injection risk.
  const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const raw = execFileSync(pnpmBin, ['licenses', 'list', '--prod', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  });
  const report = JSON.parse(raw) as PnpmLicenseReport;

  const rows: PnpmLicenseEntry[] = [];
  for (const entries of Object.values(report)) {
    for (const entry of entries) rows.push(entry);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const forbidden = rows.filter((r) => !licenseIsAllowed(r.license));
  if (forbidden.length > 0) {
    console.error('\nForbidden licenses detected:');
    for (const f of forbidden) console.error(`  - ${f.name}@${f.version}: ${f.license}`);
    console.error('\nAllowed licenses:', [...ALLOWED].join(', '));
    process.exit(1);
  }

  const lines: string[] = [
    '# Third-Party Notices',
    '',
    'AwapiCompare includes third-party open-source software listed below.',
    'The full license texts are included in each dependency\'s package.',
    '',
    '| Package | Version | License |',
    '| --- | --- | --- |',
  ];
  for (const r of rows) {
    lines.push(`| ${r.name} | ${r.version} | ${r.license} |`);
  }
  lines.push('');

  const outPath = resolve(process.cwd(), 'THIRD_PARTY_NOTICES.md');
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.warn(`Wrote ${outPath} with ${rows.length} entries.`);
}

main();
