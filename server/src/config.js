import 'dotenv/config';

const DEV_ACCESS_SECRET = 'dev-access-secret';
const DEV_REFRESH_SECRET = 'dev-refresh-secret';

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  env: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  jwtSecret: process.env.JWT_SECRET || DEV_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || DEV_REFRESH_SECRET,
  accessTtl: '15m',
  refreshTtl: '30d',
  redisUrl: process.env.REDIS_URL || '',
  cacheTtl: 60,
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@uetms.local',
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'Admin@123',
  },
};

// Deploying without a .env used to start silently with publicly-known JWT
// secrets, which means anyone can forge a SUPER_ADMIN token. Refuse to boot.
export function assertProductionConfig() {
  if (config.env !== 'production') {
    if (config.jwtSecret === DEV_ACCESS_SECRET) {
      console.warn('[config] using the built-in dev JWT secret — set JWT_SECRET before deploying');
    }
    return;
  }

  const problems = [];
  const warnings = [];
  if (!process.env.JWT_SECRET || config.jwtSecret === DEV_ACCESS_SECRET) {
    problems.push('JWT_SECRET is missing or still the built-in dev value');
  }
  if (!process.env.JWT_REFRESH_SECRET || config.jwtRefreshSecret === DEV_REFRESH_SECRET) {
    problems.push('JWT_REFRESH_SECRET is missing or still the built-in dev value');
  }
  if (config.jwtSecret === config.jwtRefreshSecret) {
    problems.push('JWT_SECRET and JWT_REFRESH_SECRET must be different values');
  }
  if (config.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters');
  }
  // CORS_ORIGIN='*' is a warning, not a boot failure: this API authenticates
  // with Bearer tokens rather than cookies, so a permissive origin does not
  // hand an attacker anything. Forged JWTs would, which is why those are fatal.
  if (config.corsOrigin === '*') {
    warnings.push('CORS_ORIGIN is "*" — set it to your real admin/site origins');
  }
  if (config.admin.password === 'Admin@123') {
    problems.push('ADMIN_PASSWORD is still the documented default');
  }
  if (!process.env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set');
  }

  if (warnings.length) {
    console.warn('\n[config] warnings:\n' + warnings.map((p) => `  - ${p}`).join('\n') + '\n');
  }

  if (problems.length) {
    console.error(
      '\n[config] refusing to start in production:\n'
      + problems.map((p) => `  - ${p}`).join('\n')
      + '\n\nSet these in your host\'s environment settings, then redeploy.'
      + '\nGenerate a secret with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n',
    );
    process.exit(1);
  }
}

// CORS_ORIGIN accepts a comma-separated list in production.
export function corsOrigins() {
  if (config.corsOrigin === '*') return '*';
  return config.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
}
