import { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { prisma } from '../db/client';
import { stripe, PRICE_TO_PLAN } from './billing';

export async function webhookRoutes(server: FastifyInstance) {
  // POST /webhooks/stripe
  server.post('/stripe', async (request, reply) => {
    server.log.info('[WEBHOOK-STRIPE] 🔔 Stripe webhook received');
    const sig = request.headers['stripe-signature'];
    if (!sig) {
      server.log.error('[WEBHOOK-STRIPE] ❌ No signature in request');
      return reply.code(400).send({ error: 'No signature' });
    }

    let event: Stripe.Event;

    try {
      // Use the rawBody buffer attached by the fastify-raw-body plugin
      const rawBody = (request as any).rawBody;
      
      if (!rawBody) {
        throw new Error('Raw body not found');
      }

      event = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || ''
      );
      server.log.info(`[WEBHOOK-STRIPE] ✓ Signature verified`);
    } catch (err: any) {
      server.log.error(`[WEBHOOK-STRIPE] ❌ Signature verification failed: ${err.message}`);
      return reply.code(400).send({ error: `Webhook Error: ${err.message}` });
    }

    server.log.info(`[WEBHOOK-STRIPE] 📨 Event type: ${event.type}`);
    server.log.info(`[WEBHOOK-STRIPE] Event ID: ${event.id}`);

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          server.log.info('[WEBHOOK-STRIPE] 🎉 Processing checkout.session.completed');
          const session = event.data.object as Stripe.Checkout.Session;
          await handleCheckoutCompleted(session, server);
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          server.log.info(`[WEBHOOK-STRIPE] 🔄 Processing ${event.type}`);
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionChange(subscription, server);
          break;
        }

        case 'customer.subscription.deleted': {
          server.log.info('[WEBHOOK-STRIPE] 🗑️ Processing subscription.deleted');
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionDeleted(subscription, server);
          break;
        }

        case 'invoice.payment_succeeded': {
          server.log.info('[WEBHOOK-STRIPE] 💰 Processing invoice.payment_succeeded');
          const invoice = event.data.object as Stripe.Invoice;
          if (invoice.subscription) {
            const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
            await handleSubscriptionChange(subscription, server);
          }
          break;
        }

        case 'invoice.payment_failed': {
          server.log.info('[WEBHOOK-STRIPE] ❌ Processing invoice.payment_failed');
          const invoice = event.data.object as Stripe.Invoice;
          if (invoice.subscription) {
            await handlePaymentFailed(invoice.subscription as string, server);
          }
          break;
        }

        default:
          server.log.info(`[WEBHOOK-STRIPE] ℹ️ Unhandled event type: ${event.type}`);
      }

      server.log.info('[WEBHOOK-STRIPE] ✅ Webhook processed successfully');
      return reply.send({ received: true });
    } catch (error) {
      server.log.error('[WEBHOOK-STRIPE] ❌ Webhook handler error:');
      server.log.error(error);
      return reply.code(500).send({ error: 'Webhook handler failed' });
    }
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, server: FastifyInstance) {
  const userId = session.metadata?.userId;
  const affiliateId = session.metadata?.affiliateId;
  
  server.log.info(`[WEBHOOK-CHECKOUT] 🟢 STARTING CHECKOUT HANDLER`);
  server.log.info(`[WEBHOOK-CHECKOUT] User ID: ${userId || 'NONE'}`);
  server.log.info(`[WEBHOOK-CHECKOUT] Affiliate ID (Metadata): ${affiliateId || 'NONE'}`);
  server.log.info(`[WEBHOOK-CHECKOUT] Session ID: ${session.id}`);

  if (!userId) {
    server.log.warn('[WEBHOOK-CHECKOUT] ⚠️ No userId in metadata, skipping');
    return;
  }

  if (affiliateId) {
    try {
      server.log.info(`[WEBHOOK-CHECKOUT] 🔍 Fetching user ${userId} to check current link/plan...`);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { subscriptions: { where: { status: 'ACTIVE' } } }
      });

      if (!user) {
        server.log.error(`[WEBHOOK-CHECKOUT] ❌ User not found: ${userId}`);
        return;
      }

      server.log.info(`[WEBHOOK-CHECKOUT] User found. Current Affiliate Link: ${user.affiliateId || 'NONE'}`);

      if (user.affiliateId) {
        server.log.info(`[WEBHOOK-CHECKOUT] ℹ️ User ALREADY linked to ${user.affiliateId}. Ignoring metadata link.`);
        return;
      }

      server.log.info(`[WEBHOOK-CHECKOUT] 🔗 Linking user ${userId} to affiliate ${affiliateId}`);
      
      // Update User with affiliate relation
      await prisma.user.update({
        where: { id: userId },
        data: { affiliateId }
      });
      server.log.info(`[WEBHOOK-CHECKOUT] ✅ User linked successfully.`);

      // RACE CONDITION CHECK
      const currentPlan = user.subscriptions[0]?.plan || 'FREE';
      server.log.info(`[WEBHOOK-CHECKOUT] 📊 Current DB Plan: ${currentPlan}`);

      if (currentPlan === 'BASIC' || currentPlan === 'PRO') {
        server.log.info(`[WEBHOOK-CHECKOUT] 🚀 CATCH-UP INCREMENT NEEDED!`);
        server.log.info(`[WEBHOOK-CHECKOUT] Reason: Plan is already ${currentPlan} (Subscription webhook ran first), but user wasn't linked then.`);
        
        await prisma.affiliate.update({
          where: { id: affiliateId },
          data: { signups: { increment: 1 } }
        });
        server.log.info(`[WEBHOOK-CHECKOUT] ✅ Affiliate stats incremented (Catch-up)`);
      } else {
        server.log.info(`[WEBHOOK-CHECKOUT] ⏸️ Skipping increment here. Plan is FREE.`);
        server.log.info(`[WEBHOOK-CHECKOUT] Expectation: handleSubscriptionChange will run next, see the new link, and handle the increment.`);
      }

    } catch (err) {
      server.log.error({ err }, '[WEBHOOK-CHECKOUT] ❌ Failed to link affiliate');
    }
  } else {
    server.log.info(`[WEBHOOK-CHECKOUT] No affiliate ID in metadata. No attribution needed.`);
  }

  server.log.info(`[WEBHOOK-CHECKOUT] ✅ DONE`);
}

async function handleSubscriptionChange(subscription: Stripe.Subscription, server: FastifyInstance) {
  server.log.info(`[WEBHOOK-SUB-CHANGE] 🟢 STARTING SUBSCRIPTION HANDLER`);
  const customerId = subscription.customer as string;
  server.log.info(`[WEBHOOK-SUB-CHANGE] Subscription ID: ${subscription.id}`);
  server.log.info(`[WEBHOOK-SUB-CHANGE] Customer ID: ${customerId}`);
  server.log.info(`[WEBHOOK-SUB-CHANGE] Stripe status: ${subscription.status}`);

  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId },
    include: { 
      subscriptions: {
        where: { status: 'ACTIVE' },
        take: 1
      }
    }
  });

  if (!user) {
    server.log.error(`[WEBHOOK-SUB-CHANGE] ❌ User not found for Stripe customer ${customerId}`);
    return;
  }

  server.log.info(`[WEBHOOK-SUB-CHANGE] ✓ User found: ${user.email} (${user.id})`);

  const priceId = subscription.items.data[0]?.price.id;
  let plan: string = PRICE_TO_PLAN[priceId] || 'FREE';
  const status = mapStripeStatus(subscription.status);

  // Affiliate Tracking Logic
  const currentDbPlan = user.subscriptions[0]?.plan || 'FREE';
  server.log.info(`[WEBHOOK-SUB-CHANGE] 📊 Plan Transition: ${currentDbPlan} -> ${plan}`);
  
  if (user.affiliateId) {
    server.log.info(`[WEBHOOK-SUB-CHANGE] 🔗 User is linked to affiliate: ${user.affiliateId}`);
    
    if ((plan === 'BASIC' || plan === 'PRO') && currentDbPlan === 'FREE') {
      server.log.info(`[WEBHOOK-SUB-CHANGE] 🚀 UPGRADE DETECTED! (FREE -> ${plan})`);
      server.log.info(`[WEBHOOK-SUB-CHANGE] Incrementing stats for affiliate ${user.affiliateId}...`);
      
      try {
        await prisma.affiliate.update({
          where: { id: user.affiliateId },
          data: { signups: { increment: 1 } }
        });
        server.log.info(`[WEBHOOK-SUB-CHANGE] ✅ Affiliate signups incremented`);
      } catch (err) {
        server.log.error({ err }, `[WEBHOOK-SUB-CHANGE] ❌ Failed to increment affiliate stats`);
      }
    } else {
      server.log.info(`[WEBHOOK-SUB-CHANGE] No upgrade detected (or already paid). Skipping increment.`);
    }
  } else {
    server.log.info(`[WEBHOOK-SUB-CHANGE] ℹ️ User is NOT linked to any affiliate. Skipping attribution.`);
    if ((plan === 'BASIC' || plan === 'PRO') && currentDbPlan === 'FREE') {
      server.log.warn(`[WEBHOOK-SUB-CHANGE] ⚠️ Note: This was an upgrade, but no affiliate was linked. If this was a referral, handleCheckoutCompleted should catch it.`);
    }
  }

  server.log.info(`[WEBHOOK-SUB-CHANGE] Price ID from Stripe: ${priceId}`);
  server.log.info(`[WEBHOOK-SUB-CHANGE] Mapped plan (initial): ${plan}`);
  // ... rest of the function ...
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, server: FastifyInstance) {
  server.log.info(`[WEBHOOK-SUB-DELETE] Subscription ID: ${subscription.id}`);

  const result = await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: subscription.id },
    data: { status: 'CANCELED', plan: 'FREE' },
  });

  server.log.info(`[WEBHOOK-SUB-DELETE] ✅ Updated ${result.count} subscription(s) to CANCELED/FREE`);
  server.log.info(`[WEBHOOK-SUB-DELETE] Subscription ${subscription.id} canceled`);
}

async function handlePaymentFailed(subscriptionId: string, server: FastifyInstance) {
  server.log.warn(`[WEBHOOK-PAYMENT-FAIL] Subscription ID: ${subscriptionId}`);

  const result = await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: subscriptionId },
    data: { status: 'PAST_DUE' },
  });

  server.log.warn(`[WEBHOOK-PAYMENT-FAIL] ⚠️ Updated ${result.count} subscription(s) to PAST_DUE`);
  server.log.warn(`[WEBHOOK-PAYMENT-FAIL] Payment failed for subscription ${subscriptionId}`);
}

function mapStripeStatus(status: Stripe.Subscription.Status): 'ACTIVE' | 'TRIALING' | 'CANCELED' | 'PAST_DUE' {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'canceled':
    case 'unpaid':
      return 'CANCELED';
    case 'past_due':
      return 'PAST_DUE';
    default:
      return 'ACTIVE';
  }
}
