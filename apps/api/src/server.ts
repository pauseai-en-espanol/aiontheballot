import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);
const app = buildApp({ logger: { level: config.logLevel } });

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  process.exit(0);
};

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void shutdown(signal));
}

await app.listen({ host: config.host, port: config.port });
