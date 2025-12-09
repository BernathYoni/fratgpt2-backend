import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client';
import { requireAdmin } from '../middleware/requireAdmin';
import { stripe } from '../routes/billing'; // Import stripe instance

// Define schemas for validation
const createAffiliateSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(3).optional(), // Affiliate code, e.g., MIKEFREE
  payoutRate: z.number().min(0).optional(),
  paymentManager: z.string().optional(),
});

const updateAffiliateSchema = z.object({
  name: z.string().min(1).optional(),
  payoutRate: z.number().min(0).optional(),
  amountPaid: z.number().min(0).optional(),
  paymentManager: z.string().optional(),
});

export async function affiliateRoutes(server: FastifyInstance) {
  // POST /admin/affiliates - Create a new affiliate
  server.post('/', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      server.log.info('[ADMIN/AFFILIATES] Creating new affiliate');
      const { name, code, payoutRate, paymentManager } = createAffiliateSchema.parse(request.body);

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
      
      server.log.info(`[ADMIN/AFFILIATES] Using baseCouponId: ${baseCouponId}`);

      // Create Stripe Promotion Code
      let stripePromo;
      try {
        stripePromo = await stripe.promotionCodes.create({
          coupon: baseCouponId, // Link to your pre-configured free trial coupon
          code: affiliateCode,
          // max_redemptions: 1000, // Removed to inherit limits from the coupon itself
          active: true,
        });
        server.log.info(`[ADMIN/AFFILIATES] Stripe Promotion Code created: ${stripePromo.id}`);
      } catch (stripeError: any) {
        server.log.error({ err: stripeError }, `[ADMIN/AFFILIATES] Failed to create Stripe Promotion Code. Coupon ID: ${baseCouponId}`);
        server.log.error(`[ADMIN/AFFILIATES] Stripe Error Message: ${stripeError.message}`);
        // Fallback or rethrow? If we can't create the promo code, we probably shouldn't create the affiliate.
        // For now, let's rethrow to be handled by the main catch block
        throw stripeError;
      }

      // Create affiliate in DB
      const affiliate = await prisma.affiliate.create({
        data: {
          name,
          code: affiliateCode,
          payoutRate: payoutRate ?? 5.00,
          paymentManager,
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
        const unpaidSignups = aff.payoutRate > 0 ? Math.max(0, Math.floor(unpaidBalance / aff.payoutRate)) : 0;
        
        return {
          ...aff,
          referredUsersCount: aff._count.referredUsers,
          unpaidBalance,
          unpaidSignups,
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

  // PUT /admin/affiliates/:id - Update affiliate
  server.put('/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      server.log.info(`[ADMIN/AFFILIATES] Updating affiliate ${id}`);
      const { name, payoutRate, paymentManager } = updateAffiliateSchema.parse(request.body);

      const affiliate = await prisma.affiliate.findUnique({ where: { id } });
      if (!affiliate) {
        return reply.code(404).send({ error: 'Affiliate not found' });
      }

      const updatedAffiliate = await prisma.affiliate.update({
        where: { id },
        data: {
          name: name ?? undefined,
          payoutRate: payoutRate ?? undefined,
          paymentManager: paymentManager ?? undefined,
        },
      });

      server.log.info(`[ADMIN/AFFILIATES] Affiliate ${id} updated.`);
      return reply.send(updatedAffiliate);
    } catch (error) {
      server.log.error({ err: error }, `[ADMIN/AFFILIATES] Error updating affiliate ${id}`);
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: error.errors });
      }
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // POST /admin/affiliates/:id/archive - Toggle archive status
  server.post('/:id/archive', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      server.log.info(`[ADMIN/AFFILIATES] Toggling archive status for affiliate ${id}`);

      const affiliate = await prisma.affiliate.findUnique({ where: { id } });
      if (!affiliate) {
        return reply.code(404).send({ error: 'Affiliate not found' });
      }

      const updatedAffiliate = await prisma.affiliate.update({
        where: { id },
        data: { archived: !affiliate.archived },
      });

      // Optionally: Deactivate/Activate Stripe Promo Code
      if (updatedAffiliate.stripePromoId) {
        try {
          await stripe.promotionCodes.update(updatedAffiliate.stripePromoId, {
            active: !updatedAffiliate.archived
          });
          server.log.info(`[ADMIN/AFFILIATES] Stripe promo code ${updatedAffiliate.stripePromoId} active status set to ${!updatedAffiliate.archived}`);
        } catch (stripeError: any) {
          server.log.warn(`[ADMIN/AFFILIATES] Failed to update Stripe promo code status: ${stripeError.message}`);
        }
      }

      server.log.info(`[ADMIN/AFFILIATES] Affiliate ${id} archived status: ${updatedAffiliate.archived}`);
      return reply.send(updatedAffiliate);
    } catch (error) {
      server.log.error({ err: error }, `[ADMIN/AFFILIATES] Error archiving affiliate ${id}`);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // DELETE /admin/affiliates/:id - Delete affiliate
  server.delete('/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      server.log.info(`[ADMIN/AFFILIATES] Deleting affiliate ${id}`);

      const affiliate = await prisma.affiliate.findUnique({ where: { id } });
      if (!affiliate) {
        return reply.code(404).send({ error: 'Affiliate not found' });
      }

      // Set referred users' affiliateId to null first (avoid FK constraint error)
      await prisma.user.updateMany({
        where: { affiliateId: id },
        data: { affiliateId: null }
      });

      // Try to deactivate promo code
      if (affiliate.stripePromoId) {
        try {
          await stripe.promotionCodes.update(affiliate.stripePromoId, { active: false });
        } catch (e) {
            server.log.warn(`[ADMIN/AFFILIATES] Could not deactivate promo code on Stripe: ${e}`);
        }
      }

      await prisma.affiliate.delete({ where: { id } });

      server.log.info(`[ADMIN/AFFILIATES] Affiliate ${id} deleted.`);
      return reply.code(204).send();
    } catch (error) {
      server.log.error({ err: error }, `[ADMIN/AFFILIATES] Error deleting affiliate ${id}`);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
