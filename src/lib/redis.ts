import Redis from 'ioredis';

let redis: Redis | null = null;

if (process.env.REDIS_URL) {
  console.log('[REDIS] Initializing Redis connection...');
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  redis.on('error', (err) => {
    console.warn('[REDIS] Connection error:', err.message);
  });

  redis.on('connect', () => {
    console.log('[REDIS] Connected successfully');
  });
} else {
  console.warn('[REDIS] No REDIS_URL found. Running without cache.');
}

export { redis };
