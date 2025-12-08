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
  affiliateCode: z.string().optional(),
});

export async function billingRoutes(server: FastifyInstance) {
  // POST /billing/create-checkout-session
  server.post('/create-checkout-session', async (request, reply) => {
    server.log.info('[BILLING-CHECKOUT] 📥 Received request to /create-checkout-session'); // <--- Added this
    try {
      server.log.info('[BILLING-CHECKOUT] 💳 Validating authentication...');
      const { userId } = await authenticate(request);
      server.log.info(`[BILLING-CHECKOUT] User ID: ${userId}`);

      server.log.info('[BILLING-CHECKOUT] 🔍 Parsing request body...');
      const body = request.body;
      server.log.info({ body }, '[BILLING-CHECKOUT] Request body content'); // Log entire body

      const { priceId, affiliateCode } = checkoutSchema.parse(body);
      server.log.info(`[BILLING-CHECKOUT] Price ID: ${priceId}`);
      if (affiliateCode) server.log.info(`[BILLING-CHECKOUT] Affiliate Code: ${affiliateCode}`);

      const user = await prisma.user.findUnique({ 
        where: { id: userId },
        include: { affiliate: true } // Include affiliate relation
      });
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

      // Resolve affiliate
      let discounts = undefined;
      let metadata: any = { userId };

      let targetAffiliate = null;

      // 1. Try explicit affiliate code from request
      if (affiliateCode) {
        targetAffiliate = await prisma.affiliate.findUnique({ where: { code: affiliateCode } });
        if (!targetAffiliate) {
          server.log.warn(`[BILLING-CHECKOUT] ⚠️ Affiliate code not found: ${affiliateCode}`);
        } else {
          server.log.info(`[BILLING-CHECKOUT] ✓ Found affiliate from code: ${targetAffiliate.code}`);
        }
      } 
      
      // 2. Fallback to user's linked affiliate
      if (!targetAffiliate && user.affiliate) {
        targetAffiliate = user.affiliate;
        server.log.info(`[BILLING-CHECKOUT] ✓ Using linked affiliate: ${targetAffiliate.code}`);
      }

      // Apply discount if affiliate has a promo ID
      if (targetAffiliate && targetAffiliate.stripePromoId) {
        server.log.info(`[BILLING-CHECKOUT] ✓ Applying affiliate promo: ${targetAffiliate.stripePromoId}`);
        discounts = [{ promotion_code: targetAffiliate.stripePromoId }];
        metadata.affiliateId = targetAffiliate.id;
      } else if (targetAffiliate) {
        server.log.warn(`[BILLING-CHECKOUT] ⚠️ Affiliate ${targetAffiliate.code} has no Stripe Promo ID`);
        metadata.affiliateId = targetAffiliate.id; // Still track it in metadata even if no discount
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
        metadata: metadata,
        discounts: discounts,
        allow_promotion_codes: !discounts, // Allow manual codes only if no affiliate discount is forced
      });

      server.log.info(`[BILLING-CHECKOUT] ✓ Checkout session created: ${session.id}`);
      server.log.info(`[BILLING-CHECKOUT] Redirect URL: ${session.url}`);
      server.log.info(`[BILLING-CHECKOUT] ✅ Checkout session ready for ${user.email}`);

      return reply.send({ url: session.url });
    } catch (error: any) {
      server.log.error('[BILLING-CHECKOUT] ❌ Error creating checkout session:');
      server.log.error(error);
      const errorMessage = error?.message || 'Failed to create checkout session';
      return reply.code(500).send({ error: errorMessage });
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
