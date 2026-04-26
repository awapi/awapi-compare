import { startServer } from './server.js';
import { initMetrics } from './metrics.js';

const port = Number(process.env.PORT ?? 9090);

initMetrics();

startServer({ port }).then(() => {
  console.log(`alpha v2 listening on :${port}`);
});
