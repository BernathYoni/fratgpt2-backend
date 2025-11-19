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
      server.log.info('[BILLING-CHECKOUT] 💳 New checkout session request');
      const { userId } = await authenticate(request);
      server.log.info(`[BILLING-CHECKOUT] User ID: ${userId}`);

      const { priceId } = checkoutSchema.parse(request.body);
      server.log.info(`[BILLING-CHECKOUT] Price ID: ${priceId}`);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        server.log.error(`[BILLING-CHECKOUT] ❌ User not found: ${userId}`);
        return reply.code(404).send({ error: 'User not found' });
      }
      server.log.info(`[BILLING-CHECKOUT] ✓ User found: ${user.email}`);

      // Get or create Stripe customer
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        server.log.info('[BILLING-CHECKOUT] Creating new Stripe customer...');
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: user.id },
        });
        customerId = customer.id;
        server.log.info(`[BILLING-CHECKOUT] ✓ Stripe customer created: ${customerId}`);

        await prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: customerId },
        });
        server.log.info('[BILLING-CHECKOUT] ✓ Customer ID saved to database');
      } else {
        server.log.info(`[BILLING-CHECKOUT] ✓ Using existing customer: ${customerId}`);
      }

      // Create checkout session
      server.log.info('[BILLING-CHECKOUT] Creating Stripe checkout session...');
      const successUrl = `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${process.env.FRONTEND_URL}/subscribe`;
      server.log.info(`[BILLING-CHECKOUT] Success URL: ${successUrl}`);
      server.log.info(`[BILLING-CHECKOUT] Cancel URL: ${cancelUrl}`);

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
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId },
      });

      server.log.info(`[BILLING-CHECKOUT] ✓ Checkout session created: ${session.id}`);
      server.log.info(`[BILLING-CHECKOUT] Redirect URL: ${session.url}`);
      server.log.info(`[BILLING-CHECKOUT] ✅ Checkout session ready for ${user.email}`);

      return reply.send({ url: session.url });
    } catch (error) {
      server.log.error('[BILLING-CHECKOUT] ❌ Error creating checkout session:');
      server.log.error(error);
      return reply.code(500).send({ error: 'Failed to create checkout session' });
    }
  });

  // POST /billing/create-portal-session
  server.post('/create-portal-session', async (request, reply) => {
    try {
      server.log.info('[BILLING-PORTAL] 🏪 New portal session request');
      const { userId } = await authenticate(request);
      server.log.info(`[BILLING-PORTAL] User ID: ${userId}`);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user?.stripeCustomerId) {
        server.log.warn(`[BILLING-PORTAL] ❌ No Stripe customer for user: ${userId}`);
        return reply.code(400).send({ error: 'No billing account found' });
      }

      server.log.info(`[BILLING-PORTAL] ✓ User: ${user.email}, Customer: ${user.stripeCustomerId}`);
      server.log.info('[BILLING-PORTAL] Creating billing portal session...');

      const returnUrl = `${process.env.FRONTEND_URL}/dashboard`;
      server.log.info(`[BILLING-PORTAL] Return URL: ${returnUrl}`);

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: returnUrl,
      });

      server.log.info(`[BILLING-PORTAL] ✓ Portal session created: ${session.id}`);
      server.log.info(`[BILLING-PORTAL] Portal URL: ${session.url}`);
      server.log.info(`[BILLING-PORTAL] ✅ Portal ready for ${user.email}`);

      return reply.send({ url: session.url });
    } catch (error) {
      server.log.error('[BILLING-PORTAL] ❌ Error creating portal session:');
      server.log.error(error);
      return reply.code(500).send({ error: 'Failed to create portal session' });
    }
  });
}

export { stripe, PRICE_TO_PLAN };
