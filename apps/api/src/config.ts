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
  /** Signs access tokens and keys OTP hashes. Rotating it logs everyone out. */
  tokenSecret: string;
  /**
   * Returns one-time codes in API responses so the flow can be exercised with
   * no SMS provider. Refused when NODE_ENV is production.
   */
  authDevMode: boolean;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataSource = (env['DATA_SOURCE'] ?? 'seed') as Config['dataSource'];
  if (dataSource === 'postgres' && !env['DATABASE_URL']) {
    throw new Error('DATA_SOURCE=postgres requires DATABASE_URL');
  }
  // A default signing secret in production would let anyone mint a token for
  // any collector, so refuse to start rather than run insecurely.
  if (env['NODE_ENV'] === 'production') {
    for (const key of ['TOKEN_SECRET', 'PHONE_SALT'] as const) {
      if (!env[key]) throw new Error(`${key} must be set in production`);
    }
    if ((env['AUTH_DEV_MODE'] ?? 'false') === 'true') {
      throw new Error('AUTH_DEV_MODE must not be enabled in production');
    }
  }
  return {
    port: Number(env['PORT'] ?? 3001),
    host: env['HOST'] ?? '0.0.0.0',
    dataSource,
    databaseUrl: env['DATABASE_URL'],
    corsOrigins: (env['CORS_ORIGINS'] ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    phoneSalt: env['PHONE_SALT'] ?? 'dev-only-salt-change-me',
    tokenSecret: env['TOKEN_SECRET'] ?? 'dev-only-token-secret-change-me',
    authDevMode: (env['AUTH_DEV_MODE'] ?? (env['NODE_ENV'] === 'production' ? 'false' : 'true')) === 'true',
    logLevel: env['LOG_LEVEL'] ?? 'info',
  };
}
