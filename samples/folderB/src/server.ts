export interface ServerOptions {
  port: number;
  host?: string;
}

export async function startServer(opts: ServerOptions): Promise<void> {
  // minimal stub with host support
  const host = opts.host ?? '0.0.0.0';
  console.log(`binding ${host}:${opts.port}`);
  return new Promise((resolve) => setTimeout(resolve, 10));
}
