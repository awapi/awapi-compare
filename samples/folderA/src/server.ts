export interface ServerOptions {
  port: number;
}

export async function startServer(opts: ServerOptions): Promise<void> {
  // minimal stub
  return new Promise((resolve) => setTimeout(resolve, 10));
}
