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
  
  server.log.info(`[WEBHOOK-CHECKOUT] User ID from metadata: ${userId || 'NONE'}`);
  server.log.info(`[WEBHOOK-CHECKOUT] Affiliate ID from metadata: ${affiliateId || 'NONE'}`);
  server.log.info(`[WEBHOOK-CHECKOUT] Session ID: ${session.id}`);
  server.log.info(`[WEBHOOK-CHECKOUT] Customer ID: ${session.customer}`);
  server.log.info(`[WEBHOOK-CHECKOUT] Payment status: ${session.payment_status}`);

  if (!userId) {
    server.log.warn('[WEBHOOK-CHECKOUT] ⚠️ No userId in metadata, skipping');
    return;
  }

  if (affiliateId) {
    try {
      server.log.info(`[WEBHOOK-CHECKOUT] Linking user ${userId} to affiliate ${affiliateId}`);
      
      // Update User with affiliate relation
      await prisma.user.update({
        where: { id: userId },
        data: { affiliateId }
      });

      // Increment affiliate stats
      await prisma.affiliate.update({
        where: { id: affiliateId },
        data: {
          signups: { increment: 1 }
        }
      });
      server.log.info(`[WEBHOOK-CHECKOUT] ✓ Affiliate stats updated`);
    } catch (err) {
      server.log.error({ err }, '[WEBHOOK-CHECKOUT] ❌ Failed to link affiliate');
    }
  }

  server.log.info(`[WEBHOOK-CHECKOUT] ✅ Checkout completed for user ${userId}`);
  server.log.info('[WEBHOOK-CHECKOUT] Subscription will be handled by subscription.created event');
}

async function handleSubscriptionChange(subscription: Stripe.Subscription, server: FastifyInstance) {
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
  // Check if this is a new upgrade (FREE -> BASIC/PRO)
  // We rely on the user's current subscription in DB (before update) being FREE or null
  // TRIGGER DEPLOYMENT COMMENT
  const currentDbPlan = user.subscriptions[0]?.plan || 'FREE';
  
  if (user.affiliateId && (plan === 'BASIC' || plan === 'PRO') && currentDbPlan === 'FREE') {
    server.log.info(`[WEBHOOK-SUB-CHANGE] 🚀 Detected new upgrade for affiliate user! (Affiliate: ${user.affiliateId})`);
    try {
      await prisma.affiliate.update({
        where: { id: user.affiliateId },
        data: { signups: { increment: 1 } }
      });
      server.log.info(`[WEBHOOK-SUB-CHANGE] ✓ Incremented affiliate signups count`);
    } catch (err) {
      server.log.error({ err }, `[WEBHOOK-SUB-CHANGE] ❌ Failed to increment affiliate stats`);
    }
  }

  server.log.info(`[WEBHOOK-SUB-CHANGE] Price ID from Stripe: ${priceId}`);
  server.log.info(`[WEBHOOK-SUB-CHANGE] Mapped plan (initial): ${plan}`);
  server.log.info(`[WEBHOOK-SUB-CHANGE] Configured Price IDs: ${Object.keys(PRICE_TO_PLAN).join(', ')}`);

  // FAIL-SAFE: If plan is FREE but status is ACTIVE, try to infer from Product Name
  if (plan === 'FREE' && status === 'ACTIVE') {
    server.log.warn(`[WEBHOOK-SUB-CHANGE] ⚠️ Plan mismatch detected. Attempting self-healing via Product Name...`);
    try {
      const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
      const product = price.product as Stripe.Product;
      const productName = product.name.toLowerCase();
      
      server.log.info(`[WEBHOOK-SUB-CHANGE] Found Product Name: "${product.name}"`);

      if (productName.includes('pro')) {
        plan = 'PRO';
        server.log.info(`[WEBHOOK-SUB-CHANGE] ✅ Self-healed plan to PRO`);
      } else if (productName.includes('basic')) {
        plan = 'BASIC';
        server.log.info(`[WEBHOOK-SUB-CHANGE] ✅ Self-healed plan to BASIC`);
      } else {
        server.log.error(`[WEBHOOK-SUB-CHANGE] ❌ Could not infer plan from name "${product.name}". Defaulting to FREE.`);
      }
    } catch (err: any) {
      server.log.error(`[WEBHOOK-SUB-CHANGE] ❌ Failed to retrieve product details: ${err.message}`);
    }
  }

  server.log.info(`[WEBHOOK-SUB-CHANGE] Final Plan: ${plan}`);
  server.log.info(`[WEBHOOK-SUB-CHANGE] Mapped status: ${status}`);
  
  const periodEnd = subscription.current_period_end 
    ? new Date(subscription.current_period_end * 1000) 
    : new Date(); // Default to now if missing

  server.log.info(`[WEBHOOK-SUB-CHANGE] Period end: ${periodEnd.toISOString()}`);

  // Upsert subscription
  const result = await prisma.subscription.upsert({
    where: { stripeSubscriptionId: subscription.id },
    create: {
      userId: user.id,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      plan: plan as any,
      status,
      currentPeriodEnd: periodEnd,
    },
    update: {
      stripePriceId: priceId,
      plan: plan as any,
      status,
      currentPeriodEnd: periodEnd,
    },
  });

  server.log.info(`[WEBHOOK-SUB-CHANGE] ✅ Subscription updated in database (ID: ${result.id})`);
  server.log.info(`[WEBHOOK-SUB-CHANGE] User ${user.email} now has: ${plan} (${status})`);
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
