import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client';
import { authenticate } from '../utils/auth';

/**
 * Admin-only middleware
 *
 * Ensures the authenticated user has ADMIN role.
 * Must be used AFTER JWT authentication.
 *
 * Usage:
 * server.get('/admin/endpoint', { preHandler: requireAdmin }, async (request, reply) => {
 *   // Only admins reach here
 * });
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Get authenticated user ID (assumes JWT middleware already ran)
    const { userId } = await authenticate(request);

    // Query user from database
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      return reply.code(401).send({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if user is admin
    if (user.role !== 'ADMIN') {
      request.log.warn(`[REQUIRE-ADMIN] ❌ Access denied for non-admin user: ${user.email}`);
      return reply.code(403).send({
        error: 'Forbidden: Admin access required',
        code: 'ADMIN_REQUIRED'
      });
    }

    request.log.info(`[REQUIRE-ADMIN] ✓ Admin verified: ${user.email}`);

    // Attach user to request for downstream handlers
    (request as any).user = user;

  } catch (error) {
    request.log.error(`[REQUIRE-ADMIN] Error: ${error}`);
    return reply.code(401).send({
      error: 'Unauthorized',
      code: 'AUTH_FAILED'
    });
  }
}
