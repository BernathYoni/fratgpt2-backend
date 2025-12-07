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

const PLAN_PRICES: Record<string, number> = {
  FREE: 0,
  BASIC: 5,
  PRO: 20,
};

export async function adminRoutes(server: FastifyInstance) {
  /**
   * GET /admin/financials
   */
  server.get('/financials', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { startDate, endDate } = dateRangeSchema.parse(request.query);
      const start = new Date(startDate);
      const end = new Date(endDate);

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

      const geminiTotalCost = costs.geminiFlash.cost + costs.geminiPro.cost;
      const geminiInputTokens = Number(costs.geminiFlash.inputTokens) + Number(costs.geminiPro.inputTokens);
      const geminiOutputTokens = Number(costs.geminiFlash.outputTokens) + Number(costs.geminiPro.outputTokens);

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
   */
  server.get('/metrics', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { startDate, endDate } = dateRangeSchema.parse(request.query);
      const start = new Date(startDate);
      const end = new Date(endDate);

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
   */
  server.get('/user-search', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { email, startDate, endDate } = userSearchSchema.parse(request.query);
      const start = new Date(startDate);
      const end = new Date(endDate);

      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          subscriptions: {
            orderBy: { createdAt: 'desc' }
          }
        }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // 1. Calculate Revenue for the selected period
      let estimatedRevenue = 0;
      const ONE_DAY_MS = 1000 * 60 * 60 * 24;

      // Process subscription history & Revenue
      const subscriptionHistory = user.subscriptions.map(sub => {
        const subStart = new Date(sub.createdAt);
        const subEnd = sub.status === 'CANCELED' ? new Date(sub.updatedAt) : new Date();
        
        // Intersection of [subStart, subEnd] and [queryStart, queryEnd] for revenue calculation
        // We use 'end' (query end date) as the max boundary for calculation, assuming ACTIVE means active until now/query end.
        // If sub is ACTIVE, effective end date for calculation is the query end date (or now).
        let effectiveSubEnd = sub.status === 'CANCELED' || sub.status === 'PAST_DUE' ? new Date(sub.updatedAt) : new Date();
        
        // Revenue overlap calculation
        const overlapStart = new Date(Math.max(subStart.getTime(), start.getTime()));
        const overlapEnd = new Date(Math.min(effectiveSubEnd.getTime(), end.getTime()));

        if (overlapStart < overlapEnd) {
          const daysOverlap = (overlapEnd.getTime() - overlapStart.getTime()) / ONE_DAY_MS;
          const monthlyPrice = PLAN_PRICES[sub.plan] || 0;
          // Revenue = (Days / 30) * MonthlyPrice
          estimatedRevenue += (daysOverlap / 30) * monthlyPrice;
        }

        // Duration for display (Total duration of the sub, not just overlap)
        const totalDiffTime = Math.abs(subEnd.getTime() - subStart.getTime());
        const totalDiffDays = Math.ceil(totalDiffTime / ONE_DAY_MS);
        const months = (totalDiffDays / 30).toFixed(1);

        return {
          plan: sub.plan,
          status: sub.status,
          startDate: sub.createdAt,
          endDate: sub.status === 'CANCELED' ? sub.updatedAt : null,
          durationMonths: months
        };
      });

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

      const geminiTotalCost = costs.geminiFlash.cost + costs.geminiPro.cost;
      const totalCost = costs.total.cost;
      
      const geminiPercent = totalCost > 0 ? (geminiTotalCost / totalCost) * 100 : 0;
      const openaiPercent = totalCost > 0 ? (costs.openai.cost / totalCost) * 100 : 0;
      const claudePercent = totalCost > 0 ? (costs.claude.cost / totalCost) * 100 : 0;

      // 2. Calculate Cost Percentage of Revenue
      // avoid division by zero
      const costToRevenuePercentage = estimatedRevenue > 0 ? (totalCost / estimatedRevenue) * 100 : (totalCost > 0 ? 9999 : 0);

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt,
          subscriptionHistory,
        },
        totalCost,
        estimatedRevenue,
        costToRevenuePercentage,
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
   */
  server.post('/reset-stats', { preHandler: requireAdmin }, async (request, reply) => {
    const userEmail = (request as any).user?.email || 'unknown';
    try {
      console.log(`[ADMIN/RESET] Request received from ${userEmail}`);
      console.log('[ADMIN/RESET] Resetting all stats data...');

      const deletedAdminStats = await prisma.adminStats.deleteMany({});
      console.log(`[ADMIN/RESET] Deleted ${deletedAdminStats.count} AdminStats records`);

      const deletedUsage = await prisma.usage.deleteMany({});
      console.log(`[ADMIN/RESET] Deleted ${deletedUsage.count} Usage records`);

      console.log(`[ADMIN/RESET] Success. Stats wiped by ${userEmail}`);

      return reply.send({
        success: true,
        deletedAdminStats: deletedAdminStats.count,
        deletedUsage: deletedUsage.count,
      });
    } catch (error) {
      console.error(`[ADMIN/RESET] FAILED for user ${userEmail}:`, error);
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  /**
   * GET /admin/logs
   */
  server.get('/logs', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { page = 1, limit = 50 } = request.query as { page?: number; limit?: number };
      const skip = (Number(page) - 1) * Number(limit);

      // Fetch User Messages (Solves)
      const userMessages = await prisma.message.findMany({
        where: { role: 'USER' },
        include: {
          chatSession: {
            include: {
              user: true,
            },
          },
          attachments: true,
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: skip,
      });

      const totalLogs = await prisma.message.count({ where: { role: 'USER' } });

      // Enrich with Assistant Responses and Calculate Costs
      const logs = await Promise.all(userMessages.map(async (msg) => {
        const nextUserMessage = await prisma.message.findFirst({
          where: {
            chatSessionId: msg.chatSessionId,
            role: 'USER',
            createdAt: { gt: msg.createdAt },
          },
          orderBy: { createdAt: 'asc' },
        });

        const responses = await prisma.message.findMany({
          where: {
            chatSessionId: msg.chatSessionId,
            role: 'ASSISTANT',
            createdAt: {
              gt: msg.createdAt,
              lt: nextUserMessage ? nextUserMessage.createdAt : undefined,
            },
          },
          orderBy: { createdAt: 'asc' },
        });

        // Calculate Cost
        let totalCost = 0;
        const providerCosts: Record<string, number> = {};

        const outputs = responses.map(r => {
          let cost = 0;
          const metadata = r.metadata as any;
          
          if (metadata && metadata.tokenUsage) {
             const tokens = metadata.tokenUsage;
             let modelKey = 'GEMINI_PRO';
             
             if (r.provider === 'GEMINI') {
                modelKey = msg.chatSession.mode === 'FAST' ? 'GEMINI_FLASH' : 'GEMINI_PRO';
             } else if (r.provider === 'OPENAI') {
                modelKey = 'OPENAI';
             } else if (r.provider === 'CLAUDE') {
                modelKey = 'CLAUDE';
             }
             
             cost = CostCalculator.calculateModelCost(modelKey as any, {
                inputTokens: tokens.inputTokens || 0,
                outputTokens: tokens.outputTokens || 0,
                thinkingTokens: tokens.thinkingTokens || 0
             });
             
             totalCost += cost;
             providerCosts[r.provider!] = (providerCosts[r.provider!] || 0) + cost;
          }

          return {
            id: r.id,
            provider: r.provider,
            shortAnswer: r.shortAnswer,
            confidence: r.confidence,
            structuredAnswer: r.structuredAnswer,
            metadata: r.metadata,
            cost
          };
        });
        
        return {
          id: msg.id,
          createdAt: msg.createdAt,
          user: {
            id: msg.chatSession.user.id,
            email: msg.chatSession.user.email,
          },
          mode: msg.chatSession.mode,
          input: {
            text: msg.content,
            images: msg.attachments.map(a => ({
              id: a.id,
              source: a.source,
              hasImage: !!a.imageData,
              regionData: a.regionData,
            })),
          },
          outputs,
          totalCost,
          providerCosts
        };
      }));

      return reply.send({
        logs,
        pagination: {
          total: totalLogs,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(totalLogs / Number(limit)),
        }
      });

    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
