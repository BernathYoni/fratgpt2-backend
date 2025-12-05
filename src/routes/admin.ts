import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client';
import { requireAdmin } from '../middleware/requireAdmin';
import { CostCalculator } from '../utils/costCalculator';

const dateRangeSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

const userSearchSchema = z.object({
  email: z.string().email(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

export async function adminRoutes(server: FastifyInstance) {
  /**
   * GET /admin/financials
   * Returns cost breakdown by provider and total cost for a given timeframe.
   * Calculates cost by tracing token amounts from the Usage table.
   */
  server.get('/financials', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { startDate, endDate } = dateRangeSchema.parse(request.query);
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Aggregate token usage from the Usage table for 100% accuracy
      const usageAggregation = await prisma.usage.aggregate({
        where: {
          date: {
            gte: start,
            lte: end,
          },
        },
        _sum: {
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

      // Calculate costs using the centralized calculator
      const costs = CostCalculator.calculateTotalCosts({
        geminiFlashInputTokens: usageAggregation._sum.geminiFlashInputTokens || 0,
        geminiFlashOutputTokens: usageAggregation._sum.geminiFlashOutputTokens || 0,
        geminiProInputTokens: usageAggregation._sum.geminiProInputTokens || 0,
        geminiProOutputTokens: usageAggregation._sum.geminiProOutputTokens || 0,
        openaiInputTokens: usageAggregation._sum.openaiInputTokens || 0,
        openaiOutputTokens: usageAggregation._sum.openaiOutputTokens || 0,
        claudeInputTokens: usageAggregation._sum.claudeInputTokens || 0,
        claudeOutputTokens: usageAggregation._sum.claudeOutputTokens || 0,
        claudeThinkingTokens: usageAggregation._sum.claudeThinkingTokens || 0,
      });

      // Combine Gemini Flash and Pro costs as requested
      const geminiTotalCost = costs.geminiFlash.cost + costs.geminiPro.cost;
      const geminiInputTokens = Number(costs.geminiFlash.inputTokens) + Number(costs.geminiPro.inputTokens);
      const geminiOutputTokens = Number(costs.geminiFlash.outputTokens) + Number(costs.geminiPro.outputTokens);

      // Percentage calculations
      const totalCost = costs.total.cost;
      const geminiPercent = totalCost > 0 ? (geminiTotalCost / totalCost) * 100 : 0;
      const openaiPercent = totalCost > 0 ? (costs.openai.cost / totalCost) * 100 : 0;
      const claudePercent = totalCost > 0 ? (costs.claude.cost / totalCost) * 100 : 0;

      return reply.send({
        totalCost,
        providers: {
          gemini: {
            cost: geminiTotalCost,
            percentage: geminiPercent,
            inputTokens: geminiInputTokens,
            outputTokens: geminiOutputTokens,
            details: {
              flash: {
                cost: costs.geminiFlash.cost,
                inputTokens: Number(costs.geminiFlash.inputTokens),
                outputTokens: Number(costs.geminiFlash.outputTokens),
              },
              pro: {
                cost: costs.geminiPro.cost,
                inputTokens: Number(costs.geminiPro.inputTokens),
                outputTokens: Number(costs.geminiPro.outputTokens),
              }
            }
          },
          openai: {
            cost: costs.openai.cost,
            percentage: openaiPercent,
            inputTokens: Number(costs.openai.inputTokens),
            outputTokens: Number(costs.openai.outputTokens),
          },
          claude: {
            cost: costs.claude.cost,
            percentage: claudePercent,
            inputTokens: Number(costs.claude.inputTokens),
            outputTokens: Number(costs.claude.outputTokens),
            thinkingTokens: Number(costs.claude.thinkingTokens || 0),
          }
        }
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
   * GET /admin/metrics
   * Returns site-wide usage metrics (solves, snips) for a given timeframe.
   */
  server.get('/metrics', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { startDate, endDate } = dateRangeSchema.parse(request.query);
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Count total solves from Usage table
      const usageAggregation = await prisma.usage.aggregate({
        where: {
          date: {
            gte: start,
            lte: end,
          },
        },
        _sum: {
          solvesUsed: true,
        },
      });

      // Count total snips from Attachment table
      const snipCount = await prisma.attachment.count({
        where: {
          source: 'SNIP',
          createdAt: {
            gte: start,
            lte: end,
          },
        },
      });

      return reply.send({
        totalSolves: usageAggregation._sum.solvesUsed || 0,
        totalSnips: snipCount,
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
   * GET /admin/user-search
   * Search for a user by email and get their cost breakdown for a timeframe.
   */
  server.get('/user-search', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { email, startDate, endDate } = userSearchSchema.parse(request.query);
      const start = new Date(startDate);
      const end = new Date(endDate);

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, createdAt: true }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Aggregate usage for this specific user
      const usageAggregation = await prisma.usage.aggregate({
        where: {
          userId: user.id,
          date: {
            gte: start,
            lte: end,
          },
        },
        _sum: {
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

      const costs = CostCalculator.calculateTotalCosts({
        geminiFlashInputTokens: usageAggregation._sum.geminiFlashInputTokens || 0,
        geminiFlashOutputTokens: usageAggregation._sum.geminiFlashOutputTokens || 0,
        geminiProInputTokens: usageAggregation._sum.geminiProInputTokens || 0,
        geminiProOutputTokens: usageAggregation._sum.geminiProOutputTokens || 0,
        openaiInputTokens: usageAggregation._sum.openaiInputTokens || 0,
        openaiOutputTokens: usageAggregation._sum.openaiOutputTokens || 0,
        claudeInputTokens: usageAggregation._sum.claudeInputTokens || 0,
        claudeOutputTokens: usageAggregation._sum.claudeOutputTokens || 0,
        claudeThinkingTokens: usageAggregation._sum.claudeThinkingTokens || 0,
      });

       // Combine Gemini Flash and Pro costs
      const geminiTotalCost = costs.geminiFlash.cost + costs.geminiPro.cost;
      
      // Percentages for this user
      const totalCost = costs.total.cost;
      const geminiPercent = totalCost > 0 ? (geminiTotalCost / totalCost) * 100 : 0;
      const openaiPercent = totalCost > 0 ? (costs.openai.cost / totalCost) * 100 : 0;
      const claudePercent = totalCost > 0 ? (costs.claude.cost / totalCost) * 100 : 0;


      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt,
        },
        totalCost,
        providers: {
           gemini: {
            cost: geminiTotalCost,
            percentage: geminiPercent,
          },
          openai: {
            cost: costs.openai.cost,
            percentage: openaiPercent,
          },
          claude: {
            cost: costs.claude.cost,
            percentage: claudePercent,
          }
        }
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
   * POST /admin/reset-stats
   * Reset all Usage and AdminStats data (for testing)
   */
  server.post('/reset-stats', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      console.log('[ADMIN/RESET] Resetting all stats data...');

      // Delete all AdminStats records
      const deletedAdminStats = await prisma.adminStats.deleteMany({});
      console.log(`[ADMIN/RESET] Deleted ${deletedAdminStats.count} AdminStats records`);

      // Delete all Usage records
      const deletedUsage = await prisma.usage.deleteMany({});
      console.log(`[ADMIN/RESET] Deleted ${deletedUsage.count} Usage records`);

      return reply.send({
        success: true,
        deletedAdminStats: deletedAdminStats.count,
        deletedUsage: deletedUsage.count,
      });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}