import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client';
import { requireAdmin } from '../middleware/requireAdmin';
import { stripe } from '../routes/billing'; // Import stripe instance

// Define schemas for validation
const createAffiliateSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(3).optional(), // Affiliate code, e.g., MIKEFREE
});

const updateAffiliateSchema = z.object({
  name: z.string().min(1).optional(),
  payoutRate: z.number().min(0).optional(),
  amountPaid: z.number().min(0).optional(),
});

export async function affiliateRoutes(server: FastifyInstance) {
  // POST /admin/affiliates - Create a new affiliate
  server.post('/', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      server.log.info('[ADMIN/AFFILIATES] Creating new affiliate');
      const { name, code } = createAffiliateSchema.parse(request.body);

      // Generate a unique code if not provided
      let affiliateCode = code;
      if (!affiliateCode) {
        // Simple random string generation for now
        affiliateCode = 'REF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        server.log.info(`[ADMIN/AFFILIATES] Generated code: ${affiliateCode}`);
      }

      // Check if code already exists
      const existingAffiliate = await prisma.affiliate.findUnique({ where: { code: affiliateCode } });
      if (existingAffiliate) {
        server.log.warn(`[ADMIN/AFFILIATES] Code ${affiliateCode} already exists`);
        return reply.code(409).send({ error: 'Affiliate code already exists. Please choose another or leave blank to auto-generate.' });
      }

      // TODO: Create a Stripe Coupon for the free trial if one doesn't exist
      // For now, assume a base coupon ID (e.g., 'free_trial_coupon_id')
      // This part would ideally be set up once, and we just create Promotion Codes linking to it.
      // Let's use a dummy ID for now and note that a Stripe Coupon must exist.
      const baseCouponId = process.env.STRIPE_AFFILIATE_COUPON_ID || 'dummy_affiliate_coupon_id'; // Configure this env var

      // Create Stripe Promotion Code
      const stripePromo = await stripe.promotionCodes.create({
        coupon: baseCouponId, // Link to your pre-configured free trial coupon
        code: affiliateCode,
        max_redemptions: 1000, // Or unlimited, depends on business logic
        active: true,
      });
      server.log.info(`[ADMIN/AFFILIATES] Stripe Promotion Code created: ${stripePromo.id}`);

      // Create affiliate in DB
      const affiliate = await prisma.affiliate.create({
        data: {
          name,
          code: affiliateCode,
          referralLink: `${process.env.FRONTEND_URL}/?ref=${affiliateCode}`,
          stripePromoId: stripePromo.id,
          stripeCouponId: baseCouponId,
        },
      });

      server.log.info(`[ADMIN/AFFILIATES] Affiliate ${affiliate.name} created with code ${affiliate.code}`);
      return reply.code(201).send(affiliate);
    } catch (error) {
      server.log.error({ err: error }, '[ADMIN/AFFILIATES] Error creating affiliate');
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: error.errors });
      }
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // GET /admin/affiliates - List all affiliates
  server.get('/', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      server.log.info('[ADMIN/AFFILIATES] Fetching all affiliates');
      const affiliates = await prisma.affiliate.findMany({
        include: {
          _count: {
            select: { referredUsers: true }, // Count users linked to this affiliate
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const result = affiliates.map(aff => {
        // Calculate conversions from Stripe data, or use our signups/conversions
        // For simplicity, we'll use 'signups' from our DB as the base for payout
        const unpaidBalance = (aff.signups * aff.payoutRate) - aff.amountPaid;
        return {
          ...aff,
          referredUsersCount: aff._count.referredUsers,
          unpaidBalance,
        };
      });

      server.log.info(`[ADMIN/AFFILIATES] Found ${result.length} affiliates`);
      return reply.send(result);
    } catch (error) {
      server.log.error({ err: error }, '[ADMIN/AFFILIATES] Error fetching affiliates');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // POST /admin/affiliates/:id/mark-paid - Mark an affiliate as paid
  server.post('/:id/mark-paid', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      server.log.info(`[ADMIN/AFFILIATES] Marking affiliate ${id} as paid`);

      const affiliate = await prisma.affiliate.findUnique({ where: { id } });
      if (!affiliate) {
        return reply.code(404).send({ error: 'Affiliate not found' });
      }

      const newAmountPaid = (affiliate.signups * affiliate.payoutRate); // Pay out for all current signups
      
      const updatedAffiliate = await prisma.affiliate.update({
        where: { id },
        data: { amountPaid: newAmountPaid },
      });

      server.log.info(`[ADMIN/AFFILIATES] Affiliate ${id} marked paid. New amountPaid: ${updatedAffiliate.amountPaid}`);
      return reply.send(updatedAffiliate);
    } catch (error) {
      server.log.error({ err: error }, `[ADMIN/AFFILIATES] Error marking affiliate ${id} paid`);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
