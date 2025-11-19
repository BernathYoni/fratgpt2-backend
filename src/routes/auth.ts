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
      server.log.info('[AUTH-REGISTER] 📝 New registration request');
      const { email, password } = registerSchema.parse(request.body);
      server.log.info(`[AUTH-REGISTER] Email: ${email}`);

      // Check if user exists
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        server.log.warn(`[AUTH-REGISTER] ❌ Email already exists: ${email}`);
        return reply.code(400).send({ error: 'Email already registered' });
      }

      // Create user
      server.log.info('[AUTH-REGISTER] ✓ Creating new user...');
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

      server.log.info(`[AUTH-REGISTER] ✓ User created: ${user.id}`);

      // Generate JWT
      const token = server.jwt.sign({ userId: user.id });
      server.log.info(`[AUTH-REGISTER] ✓ JWT generated: ${token.substring(0, 20)}...`);

      server.log.info(`[AUTH-REGISTER] ✅ Registration successful for ${email}`);
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
      server.log.info('[AUTH-LOGIN] 🔐 Login attempt');
      const { email, password } = loginSchema.parse(request.body);
      server.log.info(`[AUTH-LOGIN] Email: ${email}`);

      // Find user
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        server.log.warn(`[AUTH-LOGIN] ❌ User not found: ${email}`);
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Verify password
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        server.log.warn(`[AUTH-LOGIN] ❌ Invalid password for: ${email}`);
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Generate JWT
      const token = server.jwt.sign({ userId: user.id });
      server.log.info(`[AUTH-LOGIN] ✓ JWT generated: ${token.substring(0, 20)}...`);

      server.log.info(`[AUTH-LOGIN] ✅ Login successful for ${email}`);
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
      server.log.info('[AUTH-ME] 👤 Get user info request');
      const { userId } = await authenticate(request);
      server.log.info(`[AUTH-ME] User ID from token: ${userId}`);

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
        server.log.error(`[AUTH-ME] ❌ User not found: ${userId}`);
        return reply.code(404).send({ error: 'User not found' });
      }

      const subscription = user.subscriptions[0] || { plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null };
      server.log.info(`[AUTH-ME] ✓ User: ${user.email}, Plan: ${subscription.plan}`);

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          plan: subscription.plan,
          subscriptionStatus: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
        }
      });
    } catch (error) {
      server.log.error(error);
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}
