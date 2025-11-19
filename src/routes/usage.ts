import { FastifyInstance } from 'fastify';
import { authenticate } from '../utils/auth';
import { UsageService } from '../services/usage';

export async function usageRoutes(server: FastifyInstance) {
  // GET /usage/stats
  server.get('/stats', async (request, reply) => {
    try {
      server.log.info('[USAGE-STATS] 📊 Stats request received');
      const { userId } = await authenticate(request);
      server.log.info(`[USAGE-STATS] User ID: ${userId}`);

      const stats = await UsageService.getStats(userId);
      server.log.info(`[USAGE-STATS] ✓ Stats retrieved - Today: ${stats.today}, Total: ${stats.total}`);
      server.log.info('[USAGE-STATS] ✅ Stats sent successfully');

      return reply.send(stats);
    } catch (error) {
      server.log.error('[USAGE-STATS] ❌ Error fetching stats:', error);
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // GET /usage/check
  server.get('/check', async (request, reply) => {
    try {
      server.log.info('[USAGE-CHECK] 🔍 Limit check request received');
      const { userId } = await authenticate(request);
      server.log.info(`[USAGE-CHECK] User ID: ${userId}`);

      const check = await UsageService.checkLimit(userId);
      server.log.info(`[USAGE-CHECK] ✓ Check complete - Allowed: ${check.allowed}, Remaining: ${check.remaining}`);
      server.log.info('[USAGE-CHECK] ✅ Check result sent');

      return reply.send(check);
    } catch (error) {
      server.log.error('[USAGE-CHECK] ❌ Error checking limit:', error);
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}
