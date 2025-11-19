import { FastifyInstance } from 'fastify';
import { authenticate } from '../utils/auth';
import { UsageService } from '../services/usage';

export async function usageRoutes(server: FastifyInstance) {
  // GET /usage/stats
  server.get('/stats', async (request, reply) => {
    try {
      const { userId } = await authenticate(request);
      const stats = await UsageService.getStats(userId);
      return reply.send(stats);
    } catch (error) {
      server.log.error(error);
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // GET /usage/check
  server.get('/check', async (request, reply) => {
    try {
      const { userId } = await authenticate(request);
      const check = await UsageService.checkLimit(userId);
      return reply.send(check);
    } catch (error) {
      server.log.error(error);
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}
