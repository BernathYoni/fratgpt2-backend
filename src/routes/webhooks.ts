import { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { prisma } from '../db/client';
import { stripe, PRICE_TO_PLAN } from './billing';

export async function webhookRoutes(server: FastifyInstance) {
  // POST /webhooks/stripe
  server.post('/stripe', async (request, reply) => {
    const sig = request.headers['stripe-signature'];
    if (!sig) {
      return reply.code(400).send({ error: 'No signature' });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        request.body as any,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || ''
      );
    } catch (err: any) {
      server.log.error(`Webhook signature verification failed: ${err.message}`);
      return reply.code(400).send({ error: `Webhook Error: ${err.message}` });
    }

    server.log.info(`Stripe webhook event: ${event.type}`);

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          await handleCheckoutCompleted(session);
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionChange(subscription);
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionDeleted(subscription);
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as Stripe.Invoice;
          if (invoice.subscription) {
            const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
            await handleSubscriptionChange(subscription);
          }
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          if (invoice.subscription) {
            await handlePaymentFailed(invoice.subscription as string);
          }
          break;
        }

        default:
          server.log.info(`Unhandled event type: ${event.type}`);
      }

      return reply.send({ received: true });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Webhook handler failed' });
    }
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  if (!userId) return;

  // Subscription will be handled by subscription.created event
  console.log(`Checkout completed for user ${userId}`);
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId },
  });

  if (!user) {
    console.error(`User not found for Stripe customer ${customerId}`);
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  const plan = PRICE_TO_PLAN[priceId] || 'FREE';
  const status = mapStripeStatus(subscription.status);

  // Upsert subscription
  await prisma.subscription.upsert({
    where: { stripeSubscriptionId: subscription.id },
    create: {
      userId: user.id,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      plan,
      status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    },
    update: {
      stripePriceId: priceId,
      plan,
      status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    },
  });

  console.log(`Updated subscription for user ${user.id}: ${plan} (${status})`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: subscription.id },
    data: { status: 'CANCELED', plan: 'FREE' },
  });

  console.log(`Subscription ${subscription.id} canceled`);
}

async function handlePaymentFailed(subscriptionId: string) {
  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: subscriptionId },
    data: { status: 'PAST_DUE' },
  });

  console.log(`Payment failed for subscription ${subscriptionId}`);
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
