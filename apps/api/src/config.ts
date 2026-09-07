export interface Config {
  port: number;
  host: string;
  /** 'seed' runs entirely in memory off the synthetic dataset; 'postgres' uses Prisma. */
  dataSource: 'seed' | 'postgres';
  databaseUrl?: string;
  corsOrigins: string[];
  /**
   * Salt for phone-number hashing. The raw number never reaches the server, but
   * the salt still must not be the default outside development.
   */
  phoneSalt: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataSource = (env['DATA_SOURCE'] ?? 'seed') as Config['dataSource'];
  if (dataSource === 'postgres' && !env['DATABASE_URL']) {
    throw new Error('DATA_SOURCE=postgres requires DATABASE_URL');
  }
  return {
    port: Number(env['PORT'] ?? 3001),
    host: env['HOST'] ?? '0.0.0.0',
    dataSource,
    databaseUrl: env['DATABASE_URL'],
    corsOrigins: (env['CORS_ORIGINS'] ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    phoneSalt: env['PHONE_SALT'] ?? 'dev-only-salt-change-me',
    logLevel: env['LOG_LEVEL'] ?? 'info',
  };
}
