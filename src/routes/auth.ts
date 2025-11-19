import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client';
import { hashPassword, verifyPassword, authenticate } from '../utils/auth';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(server: FastifyInstance) {
  // POST /auth/register
  server.post('/register', async (request, reply) => {
    try {
      const { email, password } = registerSchema.parse(request.body);

      // Check if user exists
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply.code(400).send({ error: 'Email already registered' });
      }

      // Create user
      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          subscriptions: {
            create: {
              plan: 'FREE',
              status: 'ACTIVE',
            },
          },
        },
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
        },
      });

      // Generate JWT
      const token = server.jwt.sign({ userId: user.id });

      return reply.code(201).send({ user, token });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: error.errors });
      }
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // POST /auth/login
  server.post('/login', async (request, reply) => {
    try {
      const { email, password } = loginSchema.parse(request.body);

      // Find user
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Verify password
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Generate JWT
      const token = server.jwt.sign({ userId: user.id });

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        token,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: error.errors });
      }
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // GET /auth/me
  server.get('/me', async (request, reply) => {
    try {
      const { userId } = await authenticate(request);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
          subscriptions: {
            where: { status: 'ACTIVE' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              plan: true,
              status: true,
              currentPeriodEnd: true,
            },
          },
        },
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const subscription = user.subscriptions[0] || { plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null };

      return reply.send({
        id: user.id,
        email: user.email,
        role: user.role,
        plan: subscription.plan,
        subscriptionStatus: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
      });
    } catch (error) {
      server.log.error(error);
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}
