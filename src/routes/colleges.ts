import { FastifyInstance } from 'fastify';
import { prisma } from '../db/client';
import { requireAdmin } from '../middleware/requireAdmin';

export async function collegeRoutes(server: FastifyInstance) {
  // GET /admin/colleges - List all colleges (ADMIN ONLY - includes stats)
  server.get('/', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { search } = request.query as { search?: string };

      server.log.info(`[ADMIN/COLLEGES] Fetching colleges${search ? ` with search: ${search}` : ''}`);

      const colleges = await prisma.college.findMany({
        where: search ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { state: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
          ],
        } : {},
        include: {
          _count: {
            select: { affiliates: true },
          },
        },
        orderBy: { name: 'asc' },
        take: 100, // Limit results for performance
      });

      server.log.info(`[ADMIN/COLLEGES] Found ${colleges.length} colleges`);
      return reply.send(colleges);
    } catch (error) {
      server.log.error({ err: error }, '[ADMIN/COLLEGES] Error fetching colleges');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // GET /admin/colleges/:id - Get a specific college (ADMIN ONLY)
  server.get('/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      server.log.info(`[ADMIN/COLLEGES] Fetching college ${id}`);

      const college = await prisma.college.findUnique({
        where: { id },
        include: {
          _count: {
            select: { affiliates: true },
          },
        },
      });

      if (!college) {
        return reply.code(404).send({ error: 'College not found' });
      }

      server.log.info(`[ADMIN/COLLEGES] Found college: ${college.name}`);
      return reply.send(college);
    } catch (error) {
      server.log.error({ err: error }, `[ADMIN/COLLEGES] Error fetching college ${id}`);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}

// PUBLIC college search endpoint (no authentication required)
export async function publicCollegeRoutes(server: FastifyInstance) {
  // GET /colleges/search - Public college search for dropdowns
  server.get('/search', async (request, reply) => {
    try {
      const { q } = request.query as { q?: string };

      server.log.info(`[COLLEGES/PUBLIC] Searching colleges${q ? ` with query: ${q}` : ''}`);

      const colleges = await prisma.college.findMany({
        where: q ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { state: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
          ],
        } : {},
        select: {
          id: true,
          name: true,
          state: true,
          city: true,
        },
        orderBy: { name: 'asc' },
        take: 50, // Limit to 50 for public endpoint
      });

      server.log.info(`[COLLEGES/PUBLIC] Found ${colleges.length} colleges`);
      return reply.send(colleges);
    } catch (error) {
      server.log.error({ err: error }, '[COLLEGES/PUBLIC] Error searching colleges');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
