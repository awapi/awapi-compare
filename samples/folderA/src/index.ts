import { startServer } from './server.js';

const port = Number(process.env.PORT ?? 8080);

startServer({ port }).then(() => {
  console.log(`alpha listening on :${port}`);
});
