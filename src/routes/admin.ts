import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client';
import { requireAdmin } from '../middleware/requireAdmin';
import { CostCalculator } from '../utils/costCalculator';

const statsQuerySchema = z.object({
  period: z.enum(['today', 'yesterday', 'week', 'month', '6months', 'year', 'all']).optional().default('today'),
});

const userCostsQuerySchema = z.object({
  limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 50),
});

/**
 * Calculate date range for different time periods
 */
function getDateRange(period: string): { startDate: Date; endDate: Date } {
  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  let startDate: Date;

  switch (period) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'yesterday':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      endDate.setDate(endDate.getDate() - 1);
      break;
    case 'week':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      break;
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      break;
    case '6months':
      startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      break;
    case 'year':
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      break;
    case 'all':
      startDate = new Date(2020, 0, 1); // Beginning of time for the app
      break;
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  return { startDate, endDate };
}

export async function adminRoutes(server: FastifyInstance) {
  /**
   * GET /admin/stats?period=today|yesterday|week|month|6months|year|all
   *
   * Aggregate AdminStats for the given period and calculate costs
   */
  server.get('/stats', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      console.log('[ADMIN/STATS] Admin stats request');

      const { period } = statsQuerySchema.parse(request.query);
      console.log(`[ADMIN/STATS] Period: ${period}`);

      const { startDate, endDate } = getDateRange(period);
      console.log(`[ADMIN/STATS] Date range: ${startDate.toISOString()} - ${endDate.toISOString()}`);

      // Query AdminStats for the period
      const statsRecords = await prisma.adminStats.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          date: true,
          geminiFlashInputTokens: true,
          geminiFlashOutputTokens: true,
          geminiProInputTokens: true,
          geminiProOutputTokens: true,
          openaiInputTokens: true,
          openaiOutputTokens: true,
          claudeInputTokens: true,
          claudeOutputTokens: true,
          claudeThinkingTokens: true,
        },
      });

      console.log(`[ADMIN/STATS] Found ${statsRecords.length} stats records`);

      // If no records, return zeros
      if (statsRecords.length === 0) {
        return reply.send({
          period,
          dateRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
          },
          geminiFlash: {
            inputTokens: 0,
            outputTokens: 0,
            cost: 0,
            percentageOfTotal: 0,
          },
          geminiPro: {
            inputTokens: 0,
            outputTokens: 0,
            cost: 0,
            percentageOfTotal: 0,
          },
          openai: {
            inputTokens: 0,
            outputTokens: 0,
            cost: 0,
            percentageOfTotal: 0,
          },
          claude: {
            inputTokens: 0,
            outputTokens: 0,
            thinkingTokens: 0,
            cost: 0,
            percentageOfTotal: 0,
          },
          total: {
            cost: 0,
            tokens: 0,
          },
        });
      }

      // Aggregate costs using CostCalculator
      const costs = CostCalculator.aggregateCosts(statsRecords);

      // Transform to frontend-expected format
      const models = [
        {
          model: 'gemini-flash',
          inputTokens: Number(costs.geminiFlash.inputTokens),
          outputTokens: Number(costs.geminiFlash.outputTokens),
          cost: costs.geminiFlash.cost,
          percentage: costs.geminiFlash.percentageOfTotal || 0,
        },
        {
          model: 'gemini-pro',
          inputTokens: Number(costs.geminiPro.inputTokens),
          outputTokens: Number(costs.geminiPro.outputTokens),
          cost: costs.geminiPro.cost,
          percentage: costs.geminiPro.percentageOfTotal || 0,
        },
        {
          model: 'gpt-4',
          inputTokens: Number(costs.openai.inputTokens),
          outputTokens: Number(costs.openai.outputTokens),
          cost: costs.openai.cost,
          percentage: costs.openai.percentageOfTotal || 0,
        },
        {
          model: 'claude',
          inputTokens: Number(costs.claude.inputTokens),
          outputTokens: Number(costs.claude.outputTokens),
          thinkingTokens: Number(costs.claude.thinkingTokens || 0),
          cost: costs.claude.cost,
          percentage: costs.claude.percentageOfTotal || 0,
        },
      ];

      return reply.send({
        totalCost: costs.total.cost,
        models,
        period,
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: error.errors });
      }
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/usage-overview
   *
   * Total users, active subscriptions by plan, estimated revenue
   */
  server.get('/usage-overview', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      console.log('[ADMIN/USAGE] Usage overview request');

      // Total users
      const totalUsers = await prisma.user.count();

      // Active subscriptions by plan
      const subscriptions = await prisma.subscription.groupBy({
        by: ['plan'],
        where: {
          status: 'ACTIVE',
        },
        _count: {
          plan: true,
        },
      });

      const subscriptionsByPlan = {
        FREE: 0,
        BASIC: 0,
        PRO: 0,
      };

      subscriptions.forEach(sub => {
        subscriptionsByPlan[sub.plan] = sub._count.plan;
      });

      // Estimate monthly revenue
      // Updated pricing: BASIC = $5/month, PRO = $20/month
      const BASIC_PRICE = 5.00;
      const PRO_PRICE = 20.00;
      const estimatedRevenue =
        (subscriptionsByPlan.BASIC * BASIC_PRICE) +
        (subscriptionsByPlan.PRO * PRO_PRICE);

      return reply.send({
        totalUsers,
        activeSubscriptions: {
          free: subscriptionsByPlan.FREE,
          basic: subscriptionsByPlan.BASIC,
          pro: subscriptionsByPlan.PRO,
          total: subscriptionsByPlan.FREE + subscriptionsByPlan.BASIC + subscriptionsByPlan.PRO,
        },
        estimatedMonthlyRevenue: estimatedRevenue,
      });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/user-costs?limit=50
   *
   * Top users by monthly cost
   */
  server.get('/user-costs', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      console.log('[ADMIN/USER-COSTS] User costs request');

      const { limit } = userCostsQuerySchema.parse(request.query);
      console.log(`[ADMIN/USER-COSTS] Limit: ${limit}`);

      // Get current month's date range
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      // Get usage records for current month
      const usageRecords = await prisma.usage.findMany({
        where: {
          date: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              subscriptions: {
                where: { status: 'ACTIVE' },
                select: { plan: true },
                take: 1,
              },
            },
          },
        },
      });

      // Group by user and calculate total monthly cost
      const userCostsMap = new Map<string, {
        userId: string;
        email: string;
        plan: string;
        monthlyCost: number;
        tokensUsed: number;
        geminiFlashInputTokens: number;
        geminiFlashOutputTokens: number;
        geminiProInputTokens: number;
        geminiProOutputTokens: number;
        openaiInputTokens: number;
        openaiOutputTokens: number;
        claudeInputTokens: number;
        claudeOutputTokens: number;
        claudeThinkingTokens: number;
      }>();

      usageRecords.forEach(usage => {
        const userId = usage.user.id;
        const existing = userCostsMap.get(userId);

        if (existing) {
          // Aggregate tokens
          existing.geminiFlashInputTokens += usage.geminiFlashInputTokens;
          existing.geminiFlashOutputTokens += usage.geminiFlashOutputTokens;
          existing.geminiProInputTokens += usage.geminiProInputTokens;
          existing.geminiProOutputTokens += usage.geminiProOutputTokens;
          existing.openaiInputTokens += usage.openaiInputTokens;
          existing.openaiOutputTokens += usage.openaiOutputTokens;
          existing.claudeInputTokens += usage.claudeInputTokens;
          existing.claudeOutputTokens += usage.claudeOutputTokens;
          existing.claudeThinkingTokens += usage.claudeThinkingTokens;
          existing.tokensUsed += usage.tokensUsed;
        } else {
          userCostsMap.set(userId, {
            userId: usage.user.id,
            email: usage.user.email,
            plan: usage.user.subscriptions[0]?.plan || 'FREE',
            monthlyCost: 0, // Will be calculated next
            tokensUsed: usage.tokensUsed,
            geminiFlashInputTokens: usage.geminiFlashInputTokens,
            geminiFlashOutputTokens: usage.geminiFlashOutputTokens,
            geminiProInputTokens: usage.geminiProInputTokens,
            geminiProOutputTokens: usage.geminiProOutputTokens,
            openaiInputTokens: usage.openaiInputTokens,
            openaiOutputTokens: usage.openaiOutputTokens,
            claudeInputTokens: usage.claudeInputTokens,
            claudeOutputTokens: usage.claudeOutputTokens,
            claudeThinkingTokens: usage.claudeThinkingTokens,
          });
        }
      });

      // Calculate costs for each user
      const userCosts = Array.from(userCostsMap.values()).map(user => {
        const costs = CostCalculator.calculateTotalCosts(user);
        return {
          userId: user.userId,
          email: user.email,
          plan: user.plan,
          monthlyCost: costs.total.cost,
          tokensUsed: user.tokensUsed,
          breakdown: {
            geminiFlash: {
              inputTokens: user.geminiFlashInputTokens,
              outputTokens: user.geminiFlashOutputTokens,
              cost: costs.geminiFlash.cost,
            },
            geminiPro: {
              inputTokens: user.geminiProInputTokens,
              outputTokens: user.geminiProOutputTokens,
              cost: costs.geminiPro.cost,
            },
            openai: {
              inputTokens: user.openaiInputTokens,
              outputTokens: user.openaiOutputTokens,
              cost: costs.openai.cost,
            },
            claude: {
              inputTokens: user.claudeInputTokens,
              outputTokens: user.claudeOutputTokens,
              thinkingTokens: user.claudeThinkingTokens,
              cost: costs.claude.cost,
            },
          },
        };
      });

      // Sort by monthly cost descending
      userCosts.sort((a, b) => b.monthlyCost - a.monthlyCost);

      // Return top N users
      return reply.send({
        month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
        topUsers: userCosts.slice(0, limit),
        totalUsers: userCosts.length,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: error.errors });
      }
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
