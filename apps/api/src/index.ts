import { buildServer } from './server.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = await buildServer({ config });

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `API listening on ${config.host}:${config.port} (data source: ${config.dataSource})`,
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    process.exit(0);
  });
}
