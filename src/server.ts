import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rawBody = require('fastify-raw-body');
import { authRoutes } from './routes/auth';
import { chatRoutes } from './routes/chat';
import { billingRoutes } from './routes/billing';
import { webhookRoutes } from './routes/webhooks';
import { usageRoutes } from './routes/usage';
import { adminRoutes } from './routes/admin';

const server = Fastify({
  logger: true,
  bodyLimit: 10485760, // 10MB for images
});

async function start() {
  try {
    // Register plugins
    await server.register(cors, {
      origin: [
        process.env.FRONTEND_URL || 'http://localhost:3001',
        /^chrome-extension:\/\//,
      ],
      credentials: true,
    });

    // Register raw-body plugin for Stripe webhooks
    // global: false means we must enable it specifically in the webhook route config
    // encoding: false means rawBody will be a Buffer (required for Stripe)
    await server.register(rawBody, {
      field: 'rawBody',
      global: false,
      encoding: false,
      runFirst: true,
    });

    await server.register(jwt, {
      secret: process.env.JWT_SECRET || 'super-secret-change-in-production',
    });

    await server.register(multipart);

    // Health check
    server.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // Register routes
    await server.register(authRoutes, { prefix: '/auth' });
    await server.register(chatRoutes, { prefix: '/chat' });
    await server.register(billingRoutes, { prefix: '/billing' });
    await server.register(usageRoutes, { prefix: '/usage' });
    await server.register(webhookRoutes, { prefix: '/webhooks' });
    await server.register(adminRoutes, { prefix: '/admin' });

    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

    await server.listen({ port, host });
    console.log(`🚀 Server running on ${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
