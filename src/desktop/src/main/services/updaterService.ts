import { app } from 'electron';
import { NotImplementedError } from './errors.js';

export interface UpdaterCheckResult {
  available: boolean;
  version?: string;
  url?: string;
}

const GITHUB_API_LATEST =
  'https://api.github.com/repos/awapi/awapi-compare/releases/latest';

function parseVersion(v: string): [number, number, number] {
  const parts = v.replace(/^v/, '').split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function isNewer(remote: string, local: string): boolean {
  const [rMaj, rMin, rPat] = parseVersion(remote);
  const [lMaj, lMin, lPat] = parseVersion(local);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

export class UpdaterService {
  async check(): Promise<UpdaterCheckResult> {
    try {
      const res = await fetch(GITHUB_API_LATEST, {
        headers: { 'User-Agent': `awapi-compare/${app.getVersion()}` },
      });
      if (!res.ok) return { available: false };

      const data = (await res.json()) as { tag_name?: string; html_url?: string };
      const remoteTag = data.tag_name ?? '';
      const remoteVersion = remoteTag.replace(/^v/, '');
      const localVersion = app.getVersion();

      const available = isNewer(remoteVersion, localVersion);
      return available
        ? { available: true, version: remoteVersion, url: data.html_url }
        : { available: false };
    } catch {
      return { available: false };
    }
  }

  download(): Promise<void> {
    throw new NotImplementedError('updater.download', 'Phase 9');
  }

  install(): Promise<void> {
    throw new NotImplementedError('updater.install', 'Phase 9');
  }
}
