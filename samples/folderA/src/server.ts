export interface ServerOptions {
  port: number;
}

export async function startServer(_opts: ServerOptions): Promise<void> {
  // minimal stub
  return new Promise((resolve) => setTimeout(resolve, 10));
}
