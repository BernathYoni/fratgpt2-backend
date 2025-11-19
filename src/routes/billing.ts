import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Stripe from 'stripe';
import { prisma } from '../db/client';
import { authenticate } from '../utils/auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

// Price ID to Plan mapping
const PRICE_TO_PLAN: Record<string, 'BASIC' | 'PRO'> = {
  [process.env.STRIPE_PRICE_BASIC || 'price_1SQdkDCDxzHnrj8R0nSwZApT']: 'BASIC',
  [process.env.STRIPE_PRICE_PRO || 'price_1SRQyxCDxzHnrj8RmTIm9ye6']: 'PRO',
};

const checkoutSchema = z.object({
  priceId: z.string(),
});

export async function billingRoutes(server: FastifyInstance) {
  // POST /billing/create-checkout-session
  server.post('/create-checkout-session', async (request, reply) => {
    try {
      const { userId } = await authenticate(request);
      const { priceId } = checkoutSchema.parse(request.body);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Get or create Stripe customer
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: user.id },
        });
        customerId = customer.id;
        await prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: customerId },
        });
      }

      // Create checkout session
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: `${process.env.FRONTEND_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/subscribe`,
        metadata: { userId },
      });

      return reply.send({ url: session.url });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Failed to create checkout session' });
    }
  });

  // POST /billing/create-portal-session
  server.post('/create-portal-session', async (request, reply) => {
    try {
      const { userId } = await authenticate(request);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user?.stripeCustomerId) {
        return reply.code(400).send({ error: 'No billing account found' });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${process.env.FRONTEND_URL}/dashboard`,
      });

      return reply.send({ url: session.url });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Failed to create portal session' });
    }
  });
}

export { stripe, PRICE_TO_PLAN };
