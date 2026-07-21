import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  env: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  jwtSecret: process.env.JWT_SECRET || 'dev-access-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
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
