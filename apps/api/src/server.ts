import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

import { loadConfig, type Config } from './config.ts';
import { MemoryRepository } from './repository/memory.ts';
import type { Repository } from './repository/types.ts';
import { PriceService } from './services/prices.ts';
import { LotService } from './services/lots.ts';
import { MatchService } from './services/matching.ts';
import { HandoverService } from './services/handover.ts';
import { LedgerService } from './services/ledger.ts';
import { SyncService } from './services/sync.ts';
import { MlService } from './services/ml.ts';
import { referenceRoutes } from './routes/reference.ts';
import { priceRoutes } from './routes/prices.ts';
import { lotRoutes } from './routes/lots.ts';
import { recyclerRoutes } from './routes/recyclers.ts';
import { handoverRoutes } from './routes/handovers.ts';
import { ledgerRoutes } from './routes/ledger.ts';
import { syncRoutes } from './routes/sync.ts';
import { mlRoutes } from './routes/ml.ts';

export interface BuildOptions {
  config?: Partial<Config>;
  /** Injected by tests and by the seed-mode boot path. */
  repository?: Repository;
}

export async function buildServer(options: BuildOptions = {}): Promise<FastifyInstance> {
  const config = { ...loadConfig(), ...options.config };

  const repo = options.repository ?? (await createRepository(config));

  const prices = new PriceService(repo);
  const lots = new LotService(repo, prices);
  const matching = new MatchService(repo, prices);
  const handovers = new HandoverService(repo, prices);
  const ledger = new LedgerService(repo);
  const sync = new SyncService(repo, prices);
  const ml = new MlService(repo, prices);

  const app = Fastify({
    logger: { level: config.logLevel },
    // Phones on a weak signal upload photo hashes and several lots at once.
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cors, { origin: config.corsOrigins });

  app.get('/health', async () => ({
    status: 'ok',
    dataSource: repo.kind,
    time: new Date().toISOString(),
  }));

  await referenceRoutes(app);
  await priceRoutes(app, prices);
  await lotRoutes(app, lots, matching);
  await recyclerRoutes(app, repo);
  await handoverRoutes(app, handovers, repo);
  await ledgerRoutes(app, ledger, repo);
  await syncRoutes(app, sync);
  await mlRoutes(app, ml);

  app.decorate('config', config);
  app.decorate('repository', repo);

  return app;
}

async function createRepository(config: Config): Promise<Repository> {
  if (config.dataSource === 'seed') return new MemoryRepository();
  // Imported lazily so a seed-mode process never needs @prisma/client to be
  // generated, which keeps `pnpm api:dev` working on a clean checkout.
  const { PrismaRepository } = await import('./repository/prisma.ts');
  return PrismaRepository.connect(config.databaseUrl!);
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    repository: Repository;
  }
}
