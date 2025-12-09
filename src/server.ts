import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { authRoutes } from './routes/auth';
import { chatRoutes } from './routes/chat';
import { billingRoutes } from './routes/billing';
import { webhookRoutes } from './routes/webhooks';
import { usageRoutes } from './routes/usage';
import { adminRoutes } from './routes/admin';
import { affiliateRoutes } from './routes/affiliates';
import { collegeRoutes, publicCollegeRoutes } from './routes/colleges';

const server = Fastify({
  logger: true,
  bodyLimit: 10485760, // 10MB for images
});

// Global content type parser to keep raw body for Stripe
// This ensures 'request.rawBody' is available for signature verification
server.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  try {
    const json = JSON.parse(body.toString());
    (req as any).rawBody = body; // Attach raw buffer
    done(null, json);
  } catch (err: any) {
    err.statusCode = 400;
    done(err, undefined);
  }
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
    await server.register(affiliateRoutes, { prefix: '/admin/affiliates' });
    await server.register(collegeRoutes, { prefix: '/admin/colleges' });

    // Public routes (no authentication required)
    await server.register(publicCollegeRoutes, { prefix: '/colleges' });

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
