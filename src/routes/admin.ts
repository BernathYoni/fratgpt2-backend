import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client';
import { requireAdmin } from '../middleware/requireAdmin';
import { CostCalculator } from '../utils/costCalculator';
import geoip from 'geoip-lite';

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

      // Fetch all assistant messages
      // We filter for metadata in memory to avoid TS issues with JsonNull
      const messages = await prisma.message.findMany({
        where: {
          role: 'ASSISTANT',
          createdAt: { gte: start, lte: end },
        },
        include: {
          chatSession: {
            select: { mode: true }
          }
        }
      });

      console.log(`[ADMIN/FINANCIALS] Found ${messages.length} messages in range ${startDate} - ${endDate}`);

      // Initialize aggregators
      const breakdown: Record<string, { 
        totalCost: number, 
        totalTokens: number, 
        models: Record<string, { inputTokens: number, outputTokens: number, cost: number }> 
      }> = {
        gemini: { totalCost: 0, totalTokens: 0, models: {} },
        openai: { totalCost: 0, totalTokens: 0, models: {} },
        claude: { totalCost: 0, totalTokens: 0, models: {} },
      };

      let totalCost = 0;

      for (const msg of messages) {
        const metadata = msg.metadata as any;
        if (!metadata?.tokenUsage || !msg.provider) continue;

        const tokens = metadata.tokenUsage;
        const providerKey = msg.provider.toLowerCase();
        const mode = msg.chatSession.mode;
        
        let modelName = 'Unknown';
        let costKey: any = 'GEMINI_PRO';

        // Determine Model Name and Cost Key based on Mode + Provider
        if (msg.provider === 'GEMINI') {
          if (mode === 'FAST') {
            modelName = 'Gemini 2.0 Flash';
            costKey = 'GEMINI_FLASH';
          } else if (mode === 'REGULAR') {
            modelName = 'Gemini 2.5 Pro';
            costKey = 'GEMINI_PRO';
          } else { // EXPERT
            modelName = 'Gemini 3.0 Pro (Exp)';
            costKey = 'GEMINI_EXPERT';
          }
        } else if (msg.provider === 'OPENAI') {
          if (mode === 'REGULAR') {
            modelName = 'GPT-5 Mini';
            costKey = 'OPENAI_MINI';
          } else { // EXPERT
            modelName = 'GPT-5.1';
            costKey = 'OPENAI_PRO';
          }
        } else if (msg.provider === 'CLAUDE') {
          if (mode === 'EXPERT') {
            modelName = 'Claude Opus 4.5';
            costKey = 'CLAUDE_OPUS';
          } else {
            modelName = 'Claude Sonnet 4.5';
            costKey = 'CLAUDE_SONNET';
          }
        }

        // Calculate Cost
        const cost = CostCalculator.calculateModelCost(costKey, {
          inputTokens: tokens.inputTokens || 0,
          outputTokens: tokens.outputTokens || 0,
          thinkingTokens: tokens.thinkingTokens || 0
        });

        // Update Aggregates
        if (!breakdown[providerKey]) continue;

        if (!breakdown[providerKey].models[modelName]) {
          breakdown[providerKey].models[modelName] = { inputTokens: 0, outputTokens: 0, cost: 0 };
        }

        const modelStats = breakdown[providerKey].models[modelName];
        modelStats.inputTokens += (tokens.inputTokens || 0);
        modelStats.outputTokens += (tokens.outputTokens || 0);
        modelStats.cost += cost;

        breakdown[providerKey].totalCost += cost;
        breakdown[providerKey].totalTokens += (tokens.inputTokens || 0) + (tokens.outputTokens || 0);
        
        totalCost += cost;
      }

      // Format for Frontend
      const providers = {
        gemini: {
          cost: breakdown.gemini.totalCost,
          percentage: totalCost > 0 ? (breakdown.gemini.totalCost / totalCost) * 100 : 0,
          models: breakdown.gemini.models
        },
        openai: {
          cost: breakdown.openai.totalCost,
          percentage: totalCost > 0 ? (breakdown.openai.totalCost / totalCost) * 100 : 0,
          models: breakdown.openai.models
        },
        claude: {
          cost: breakdown.claude.totalCost,
          percentage: totalCost > 0 ? (breakdown.claude.totalCost / totalCost) * 100 : 0,
          models: breakdown.claude.models
        }
      };

      return reply.send({
        totalCost,
        providers
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
          claudeSonnetInputTokens: true,
          claudeSonnetOutputTokens: true,
          claudeSonnetThinkingTokens: true,
          claudeOpusInputTokens: true,
          claudeOpusOutputTokens: true,
          claudeOpusThinkingTokens: true,
        },
      });

      const costs = CostCalculator.calculateTotalCosts({
        geminiFlashInputTokens: usageAggregation._sum.geminiFlashInputTokens || 0,
        geminiFlashOutputTokens: usageAggregation._sum.geminiFlashOutputTokens || 0,
        geminiProInputTokens: usageAggregation._sum.geminiProInputTokens || 0,
        geminiProOutputTokens: usageAggregation._sum.geminiProOutputTokens || 0,
        openaiInputTokens: usageAggregation._sum.openaiInputTokens || 0,
        openaiOutputTokens: usageAggregation._sum.openaiOutputTokens || 0,
        claudeSonnetInputTokens: usageAggregation._sum.claudeSonnetInputTokens || 0,
        claudeSonnetOutputTokens: usageAggregation._sum.claudeSonnetOutputTokens || 0,
        claudeSonnetThinkingTokens: usageAggregation._sum.claudeSonnetThinkingTokens || 0,
        claudeOpusInputTokens: usageAggregation._sum.claudeOpusInputTokens || 0,
        claudeOpusOutputTokens: usageAggregation._sum.claudeOpusOutputTokens || 0,
        claudeOpusThinkingTokens: usageAggregation._sum.claudeOpusThinkingTokens || 0,
      });

      const geminiTotalCost = costs.geminiFlash.cost + costs.geminiPro.cost;
      const claudeTotalCost = costs.claudeSonnet.cost + costs.claudeOpus.cost;
      const totalCost = costs.total.cost;

      const geminiPercent = totalCost > 0 ? (geminiTotalCost / totalCost) * 100 : 0;
      const openaiPercent = totalCost > 0 ? (costs.openai.cost / totalCost) * 100 : 0;
      const claudePercent = totalCost > 0 ? (claudeTotalCost / totalCost) * 100 : 0;

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
            cost: claudeTotalCost,
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

const resetStatsSchema = z.object({
  scope: z.enum(['all', 'today']).default('all'),
});

  /**
   * POST /admin/reset-stats
   */
  server.post('/reset-stats', { preHandler: requireAdmin }, async (request, reply) => {
    const userEmail = (request as any).user?.email || 'unknown';
    try {
      const { scope } = resetStatsSchema.parse(request.body || {});
      
      console.log(`[ADMIN/RESET] Request received from ${userEmail} with scope: ${scope}`);

      let deletedAdminStats;
      let deletedUsage;

      if (scope === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        console.log('[ADMIN/RESET] Resetting stats for TODAY only...');
        
        // Delete ChatSessions for today (cascades to messages)
        const deletedSessions = await prisma.chatSession.deleteMany({
          where: {
            createdAt: { gte: today }
          }
        });
        console.log(`[ADMIN/RESET] Deleted ${deletedSessions.count} ChatSessions for today`);

        deletedAdminStats = await prisma.adminStats.deleteMany({
          where: {
            date: { gte: today }
          }
        });
        deletedUsage = await prisma.usage.deleteMany({
          where: {
            date: { gte: today }
          }
        });
      } else {
        console.log('[ADMIN/RESET] Resetting ALL stats data...');
        
        // Delete ALL ChatSessions (cascades to messages)
        const deletedSessions = await prisma.chatSession.deleteMany({});
        console.log(`[ADMIN/RESET] Deleted ${deletedSessions.count} ChatSessions (ALL)`);

        deletedAdminStats = await prisma.adminStats.deleteMany({});
        deletedUsage = await prisma.usage.deleteMany({});
      }

      console.log(`[ADMIN/RESET] Success. Stats wiped by ${userEmail}. Scope: ${scope}`);

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
   * GET /admin/users
   */
  server.get('/users', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { page = 1, limit = 50 } = request.query as { page?: number; limit?: number };
      const skip = (Number(page) - 1) * Number(limit);

      const users = await prisma.user.findMany({
        include: {
          subscriptions: {
            where: { status: 'ACTIVE' },
            take: 1,
          },
          usage: true,
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: skip,
      });

      const totalUsers = await prisma.user.count();

      const userList = users.map(user => {
        const activeSub = user.subscriptions[0];
        const plan = activeSub ? activeSub.plan : 'FREE';
        const planSince = activeSub ? activeSub.createdAt : user.createdAt;
        
        // Calculate lifetime stats
        const lifetimeCost = user.usage.reduce((sum, u) => sum + (u.totalMonthlyCost || 0), 0);
        const lifetimeSolves = user.usage.reduce((sum, u) => sum + (u.solvesUsed || 0), 0);

        // Calculate monthly usage stats
        const limits = {
          FREE: { type: 'solves', limit: 20 },
          BASIC: { type: 'cost', limit: 4.00 },
          PRO: { type: 'cost', limit: 16.00 },
        };
        
        const userPlan = plan as keyof typeof limits;
        const limitConfig = limits[userPlan] || limits.FREE;
        
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        const currentUsageRecord = user.usage.find(u => {
          const d = new Date(u.date);
          return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        });
        
        let usageThisMonthPercent = 0;
        if (currentUsageRecord) {
          if (limitConfig.type === 'solves') {
            usageThisMonthPercent = (currentUsageRecord.solvesUsed / limitConfig.limit) * 100;
          } else {
            usageThisMonthPercent = (currentUsageRecord.totalMonthlyCost / limitConfig.limit) * 100;
          }
        }
        
        let totalPercent = 0;
        let monthsCount = 0;
        
        user.usage.forEach(u => {
           let percent = 0;
           if (limitConfig.type === 'solves') {
             percent = (u.solvesUsed / limitConfig.limit) * 100;
           } else {
             percent = (u.totalMonthlyCost / limitConfig.limit) * 100;
           }
           totalPercent += percent;
           monthsCount++;
        });
        
        const averageMonthlyUsagePercent = monthsCount > 0 ? totalPercent / monthsCount : 0;

        return {
          id: user.id,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
          plan,
          planSince,
          lifetimeCost,
          lifetimeSolves,
          usageThisMonthPercent,
          averageMonthlyUsagePercent,
        };
      });

      return reply.send({
        users: userList,
        pagination: {
          total: totalUsers,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(totalUsers / Number(limit)),
        }
      });

    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal server error' });
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
              interactions: true,
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
                if (msg.chatSession.mode === 'FAST') {
                  modelKey = 'GEMINI_FLASH';
                } else if (msg.chatSession.mode === 'REGULAR') {
                  modelKey = 'GEMINI_PRO';
                } else {
                  modelKey = 'GEMINI_EXPERT';
                }
             } else if (r.provider === 'OPENAI') {
                modelKey = msg.chatSession.mode === 'REGULAR' ? 'OPENAI_MINI' : 'OPENAI_PRO';
             } else if (r.provider === 'CLAUDE') {
                modelKey = msg.chatSession.mode === 'EXPERT' ? 'CLAUDE_OPUS' : 'CLAUDE_SONNET';
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
        
        // GeoIP Lookup
        let location = 'Unknown';
        if (msg.chatSession.ipAddress) {
          const geo = geoip.lookup(msg.chatSession.ipAddress);
          if (geo) {
            location = `${geo.city || geo.region}, ${geo.country}`;
          }
        }

        return {
          id: msg.id,
          createdAt: msg.createdAt,
          user: {
            id: msg.chatSession.user.id,
            email: msg.chatSession.user.email,
          },
          mode: msg.chatSession.mode,
          sourceUrl: msg.chatSession.sourceUrl,
          ipAddress: msg.chatSession.ipAddress,
          location: location, // New field
          interactions: msg.chatSession.interactions,
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

  /**
   * GET /admin/stats/misc
   */
  server.get('/stats/misc', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { startDate, endDate } = dateRangeSchema.parse(request.query);
      const start = new Date(startDate);
      const end = new Date(endDate);

      // 1. Fetch User Messages with Attachments (Solves that are Snip or Screen)
      const userMessages = await prisma.message.findMany({
        where: {
          role: 'USER',
          createdAt: { gte: start, lte: end },
          attachments: { some: {} } // Has attachments
        },
        include: {
          chatSession: {
             select: { mode: true }
          },
          attachments: {
             select: { source: true }
          }
        }
      });

      // 2. Fetch all Assistant Messages in the time range to calculate costs
      // We need to match them to the user messages.
      // Optimization: Fetch all assistant messages in relevant sessions
      const relevantSessionIds = [...new Set(userMessages.map(m => m.chatSessionId))];
      
      const assistantMessages = await prisma.message.findMany({
        where: {
          role: 'ASSISTANT',
          createdAt: { gte: start, lte: end },
          chatSessionId: { in: relevantSessionIds }
        },
        select: {
          chatSessionId: true,
          provider: true,
          metadata: true,
          createdAt: true
        }
      });

      // Group assistant messages by session ID
      const sessionResponses: Record<string, typeof assistantMessages> = {};
      for (const am of assistantMessages) {
        if (!sessionResponses[am.chatSessionId]) sessionResponses[am.chatSessionId] = [];
        sessionResponses[am.chatSessionId].push(am);
      }

      // 3. Aggregate Stats
      let snipCount = 0;
      let screenCount = 0;
      let snipTotalCost = 0;
      let screenTotalCost = 0;

      // Mode-specific stats for Snips
      const snipModeStats: Record<string, { count: number, cost: number }> = {
        FAST: { count: 0, cost: 0 },
        REGULAR: { count: 0, cost: 0 },
        EXPERT: { count: 0, cost: 0 }
      };

      for (const userMsg of userMessages) {
        const attachment = userMsg.attachments[0];
        if (!attachment || !attachment.source) continue;

        const source = attachment.source; // 'SNIP' | 'SCREEN'
        const mode = userMsg.chatSession.mode; // 'FAST' | 'REGULAR' | 'EXPERT'

        // Calculate cost for this "solve" (User Message)
        // We sum cost of assistant messages in the same session created AFTER this user message
        const responses = sessionResponses[userMsg.chatSessionId] || [];
        // Filter responses that are after this user message (and ideally before the next user message, but simple "after" is okay for stats)
        const relevantResponses = responses.filter(r => r.createdAt > userMsg.createdAt);

        let solveCost = 0;
        for (const r of relevantResponses) {
          const meta = r.metadata as any;
          if (meta?.tokenUsage && r.provider) {
             let costKey = 'GEMINI_PRO';
             if (r.provider === 'GEMINI') {
                if (mode === 'FAST') costKey = 'GEMINI_FLASH';
                else if (mode === 'REGULAR') costKey = 'GEMINI_PRO';
                else costKey = 'GEMINI_EXPERT';
             } else if (r.provider === 'OPENAI') {
                costKey = mode === 'REGULAR' ? 'OPENAI_MINI' : 'OPENAI_PRO';
             } else if (r.provider === 'CLAUDE') {
                costKey = mode === 'EXPERT' ? 'CLAUDE_OPUS' : 'CLAUDE_SONNET';
             }

             solveCost += CostCalculator.calculateModelCost(costKey as any, {
                inputTokens: meta.tokenUsage.inputTokens || 0,
                outputTokens: meta.tokenUsage.outputTokens || 0,
                thinkingTokens: meta.tokenUsage.thinkingTokens || 0
             });
          }
        }

        // Add to aggregators
        if (source === 'SNIP') {
          snipCount++;
          snipTotalCost += solveCost;
          if (snipModeStats[mode]) {
            snipModeStats[mode].count++;
            snipModeStats[mode].cost += solveCost;
          }
        } else if (source === 'SCREEN') {
          screenCount++;
          screenTotalCost += solveCost;
        }
      }

      return reply.send({
        snips: {
          count: snipCount,
          totalCost: snipTotalCost,
          avgCost: snipCount > 0 ? snipTotalCost / snipCount : 0,
          modes: {
            FAST: {
               avgCost: snipModeStats.FAST.count > 0 ? snipModeStats.FAST.cost / snipModeStats.FAST.count : 0,
               count: snipModeStats.FAST.count
            },
            REGULAR: {
               avgCost: snipModeStats.REGULAR.count > 0 ? snipModeStats.REGULAR.cost / snipModeStats.REGULAR.count : 0,
               count: snipModeStats.REGULAR.count
            },
            EXPERT: {
               avgCost: snipModeStats.EXPERT.count > 0 ? snipModeStats.EXPERT.cost / snipModeStats.EXPERT.count : 0,
               count: snipModeStats.EXPERT.count
            }
          }
        },
        screens: {
          count: screenCount,
          totalCost: screenTotalCost,
          avgCost: screenCount > 0 ? screenTotalCost / screenCount : 0
        },
        totalSolves: snipCount + screenCount
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
