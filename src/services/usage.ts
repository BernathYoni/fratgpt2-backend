import { prisma } from '../db/client';
import { Plan, ChatMode } from '@prisma/client';
import { CostCalculator } from '../utils/costCalculator';

// Plan limits (monthly)
const PLAN_LIMITS = {
  FREE: {
    type: 'solves' as const,
    limit: 20, // 20 solves per month
  },
  BASIC: {
    type: 'cost' as const,
    limit: 4.00, // $4.00 per month (80% of $5)
  },
  PRO: {
    type: 'cost' as const,
    limit: 16.00, // $16.00 per month (80% of $20)
  },
};

export interface UsageCheckResult {
  allowed: boolean;
  plan: Plan;
  limitType: 'solves' | 'cost';
  limit: number;
  used: number;
  remaining: number;
  monthlyCost?: number; // For BASIC/PRO plans
  modeAllowed?: boolean; // For Expert mode restrictions
  modeRestrictionReason?: string;
}

export class UsageService {
  /**
   * Check if user can make another solve request (with mode restriction check)
   */
  static async checkLimit(userId: string, mode?: ChatMode): Promise<UsageCheckResult> {
    const plan = await this.getUserPlan(userId);
    const planConfig = PLAN_LIMITS[plan];
    const currentMonth = this.getMonthStart();

    // Check mode restrictions
    if (mode === 'EXPERT' && !CostCalculator.allowsExpertMode(plan)) {
      return {
        allowed: false,
        plan,
        limitType: planConfig.type,
        limit: planConfig.limit,
        used: 0,
        remaining: 0,
        modeAllowed: false,
        modeRestrictionReason: `Expert mode is only available for PRO plan subscribers. Current plan: ${plan}`,
      };
    }

    // Get monthly usage (all records for current month)
    const monthlyUsage = await prisma.usage.findMany({
      where: {
        userId,
        date: { gte: currentMonth },
      },
    });

    if (planConfig.type === 'solves') {
      // FREE plan: count total solves this month
      const totalSolves = monthlyUsage.reduce((sum, u) => sum + u.solvesUsed, 0);
      const remaining = Math.max(0, planConfig.limit - totalSolves);

      return {
        allowed: totalSolves < planConfig.limit,
        plan,
        limitType: 'solves',
        limit: planConfig.limit,
        used: totalSolves,
        remaining,
        modeAllowed: true,
      };
    } else {
      // BASIC/PRO plan: check monthly cost
      const totalCost = monthlyUsage.reduce((sum, u) => sum + u.totalMonthlyCost, 0);
      const remaining = Math.max(0, planConfig.limit - totalCost);

      return {
        allowed: totalCost < planConfig.limit,
        plan,
        limitType: 'cost',
        limit: planConfig.limit,
        used: totalCost,
        remaining,
        monthlyCost: totalCost,
        modeAllowed: true,
      };
    }
  }

  /**
   * Increment solve count for a user with cost tracking
   */
  static async incrementSolve(
    userId: string,
    mode: ChatMode,
    tokenUsage: {
      geminiFlash?: { input: number; output: number };
      geminiPro?: { input: number; output: number };
      openai?: { input: number; output: number };
      claude?: { input: number; output: number; thinking?: number };
    }
  ): Promise<void> {
    const today = this.getToday();

    // Calculate costs for each provider used
    let totalCost = 0;
    const updates: any = {
      solvesUsed: { increment: 1 },
      modeRegularCount: mode === 'REGULAR' ? { increment: 1 } : undefined,
      modeFastCount: mode === 'FAST' ? { increment: 1 } : undefined,
      modeExpertCount: mode === 'EXPERT' ? { increment: 1 } : undefined,
    };

    // Gemini Flash
    if (tokenUsage.geminiFlash) {
      const cost = CostCalculator.calculateFastModeCost({
        inputTokens: tokenUsage.geminiFlash.input,
        outputTokens: tokenUsage.geminiFlash.output,
      });
      totalCost += cost.totalCost;
      updates.geminiFlashInputTokens = { increment: tokenUsage.geminiFlash.input };
      updates.geminiFlashOutputTokens = { increment: tokenUsage.geminiFlash.output };
      updates.geminiFlashCost = { increment: cost.totalCost };
      updates.tokensUsed = {
        increment: tokenUsage.geminiFlash.input + tokenUsage.geminiFlash.output,
      };
    }

    // Gemini Pro
    if (tokenUsage.geminiPro) {
      const cost = CostCalculator.calculateRegularModeCost({
        inputTokens: tokenUsage.geminiPro.input,
        outputTokens: tokenUsage.geminiPro.output,
      });
      totalCost += cost.totalCost;
      updates.geminiProInputTokens = { increment: tokenUsage.geminiPro.input };
      updates.geminiProOutputTokens = { increment: tokenUsage.geminiPro.output };
      updates.geminiProCost = { increment: cost.totalCost };
      updates.tokensUsed = {
        increment: (updates.tokensUsed?.increment || 0) + tokenUsage.geminiPro.input + tokenUsage.geminiPro.output,
      };
    }

    // OpenAI
    if (tokenUsage.openai) {
      const cost = CostCalculator.calculateCost('gpt-4o', {
        inputTokens: tokenUsage.openai.input,
        outputTokens: tokenUsage.openai.output,
      });
      totalCost += cost.totalCost;
      updates.openaiInputTokens = { increment: tokenUsage.openai.input };
      updates.openaiOutputTokens = { increment: tokenUsage.openai.output };
      updates.openaiCost = { increment: cost.totalCost };
      updates.tokensUsed = {
        increment: (updates.tokensUsed?.increment || 0) + tokenUsage.openai.input + tokenUsage.openai.output,
      };
    }

    // Claude
    if (tokenUsage.claude) {
      const cost = CostCalculator.calculateCost('claude-3.5-sonnet', {
        inputTokens: tokenUsage.claude.input,
        outputTokens: tokenUsage.claude.output,
      });
      totalCost += cost.totalCost;
      updates.claudeInputTokens = { increment: tokenUsage.claude.input };
      updates.claudeOutputTokens = { increment: tokenUsage.claude.output };
      updates.claudeThinkingTokens = { increment: tokenUsage.claude.thinking || 0 };
      updates.claudeCost = { increment: cost.totalCost };
      updates.tokensUsed = {
        increment: (updates.tokensUsed?.increment || 0) + tokenUsage.claude.input + tokenUsage.claude.output,
      };
    }

    // Update total monthly cost
    updates.totalMonthlyCost = { increment: totalCost };

    await prisma.usage.upsert({
      where: { userId_date: { userId, date: today } },
      create: {
        userId,
        date: today,
        solvesUsed: 1,
        modeRegularCount: mode === 'REGULAR' ? 1 : 0,
        modeFastCount: mode === 'FAST' ? 1 : 0,
        modeExpertCount: mode === 'EXPERT' ? 1 : 0,
        tokensUsed: updates.tokensUsed?.increment || 0,
        geminiFlashInputTokens: tokenUsage.geminiFlash?.input || 0,
        geminiFlashOutputTokens: tokenUsage.geminiFlash?.output || 0,
        geminiFlashCost: updates.geminiFlashCost?.increment || 0,
        geminiProInputTokens: tokenUsage.geminiPro?.input || 0,
        geminiProOutputTokens: tokenUsage.geminiPro?.output || 0,
        geminiProCost: updates.geminiProCost?.increment || 0,
        openaiInputTokens: tokenUsage.openai?.input || 0,
        openaiOutputTokens: tokenUsage.openai?.output || 0,
        openaiCost: updates.openaiCost?.increment || 0,
        claudeInputTokens: tokenUsage.claude?.input || 0,
        claudeOutputTokens: tokenUsage.claude?.output || 0,
        claudeThinkingTokens: tokenUsage.claude?.thinking || 0,
        claudeCost: updates.claudeCost?.increment || 0,
        totalMonthlyCost: totalCost,
      },
      update: updates,
    });

    // Also update AdminStats
    await this.updateAdminStats(today, tokenUsage, totalCost);
  }

  /**
   * Update AdminStats with daily aggregated usage
   */
  private static async updateAdminStats(
    date: Date,
    tokenUsage: {
      geminiFlash?: { input: number; output: number };
      geminiPro?: { input: number; output: number };
      openai?: { input: number; output: number };
      claude?: { input: number; output: number; thinking?: number };
    },
    totalCost: number
  ): Promise<void> {
    const updates: any = {};

    if (tokenUsage.geminiFlash) {
      const cost = CostCalculator.calculateFastModeCost({
        inputTokens: tokenUsage.geminiFlash.input,
        outputTokens: tokenUsage.geminiFlash.output,
      });
      updates.geminiFlashInputTokens = { increment: tokenUsage.geminiFlash.input };
      updates.geminiFlashOutputTokens = { increment: tokenUsage.geminiFlash.output };
      updates.geminiFlashCost = { increment: cost.totalCost };
    }

    if (tokenUsage.geminiPro) {
      const cost = CostCalculator.calculateRegularModeCost({
        inputTokens: tokenUsage.geminiPro.input,
        outputTokens: tokenUsage.geminiPro.output,
      });
      updates.geminiProInputTokens = { increment: tokenUsage.geminiPro.input };
      updates.geminiProOutputTokens = { increment: tokenUsage.geminiPro.output };
      updates.geminiProCost = { increment: cost.totalCost };
    }

    if (tokenUsage.openai) {
      const cost = CostCalculator.calculateCost('gpt-4o', {
        inputTokens: tokenUsage.openai.input,
        outputTokens: tokenUsage.openai.output,
      });
      updates.openaiInputTokens = { increment: tokenUsage.openai.input };
      updates.openaiOutputTokens = { increment: tokenUsage.openai.output };
      updates.openaiCost = { increment: cost.totalCost };
    }

    if (tokenUsage.claude) {
      const cost = CostCalculator.calculateCost('claude-3.5-sonnet', {
        inputTokens: tokenUsage.claude.input,
        outputTokens: tokenUsage.claude.output,
      });
      updates.claudeInputTokens = { increment: tokenUsage.claude.input };
      updates.claudeOutputTokens = { increment: tokenUsage.claude.output };
      updates.claudeThinkingTokens = { increment: tokenUsage.claude.thinking || 0 };
      updates.claudeCost = { increment: cost.totalCost };
    }

    updates.totalMonthlyCost = { increment: totalCost };

    await prisma.adminStats.upsert({
      where: { date },
      create: {
        date,
        geminiFlashInputTokens: tokenUsage.geminiFlash?.input || 0,
        geminiFlashOutputTokens: tokenUsage.geminiFlash?.output || 0,
        geminiFlashCost: updates.geminiFlashCost?.increment || 0,
        geminiProInputTokens: tokenUsage.geminiPro?.input || 0,
        geminiProOutputTokens: tokenUsage.geminiPro?.output || 0,
        geminiProCost: updates.geminiProCost?.increment || 0,
        openaiInputTokens: tokenUsage.openai?.input || 0,
        openaiOutputTokens: tokenUsage.openai?.output || 0,
        openaiCost: updates.openaiCost?.increment || 0,
        claudeInputTokens: tokenUsage.claude?.input || 0,
        claudeOutputTokens: tokenUsage.claude?.output || 0,
        claudeThinkingTokens: tokenUsage.claude?.thinking || 0,
        claudeCost: updates.claudeCost?.increment || 0,
        totalMonthlyCost: totalCost,
      },
      update: updates,
    });
  }

  /**
   * Get user's current plan
   */
  static async getUserPlan(userId: string): Promise<Plan> {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['ACTIVE', 'TRIALING'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { plan: true },
    });

    return subscription?.plan || 'FREE';
  }

  /**
   * Get today's date at midnight UTC
   */
  private static getToday(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  /**
   * Get the start of the current month (for monthly limits)
   */
  private static getMonthStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  /**
   * Get usage stats for a user (updated for monthly limits)
   */
  static async getStats(userId: string, days: number = 30) {
    const plan = await this.getUserPlan(userId);
    const planConfig = PLAN_LIMITS[plan];
    const today = this.getToday();
    const monthStart = this.getMonthStart();

    // Get monthly usage (for current billing period)
    const monthlyUsage = await prisma.usage.findMany({
      where: {
        userId,
        date: { gte: monthStart },
      },
    });

    // Calculate monthly totals
    const monthlyTotals = monthlyUsage.reduce(
      (acc, u) => ({
        solves: acc.solves + u.solvesUsed,
        cost: acc.cost + u.totalMonthlyCost,
        regular: acc.regular + u.modeRegularCount,
        fast: acc.fast + u.modeFastCount,
        expert: acc.expert + u.modeExpertCount,
        tokens: acc.tokens + u.tokensUsed,
      }),
      { solves: 0, cost: 0, regular: 0, fast: 0, expert: 0, tokens: 0 }
    );

    // Get historical usage
    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - days);

    const history = await prisma.usage.findMany({
      where: {
        userId,
        date: { gte: startDate },
      },
      orderBy: { date: 'desc' },
    });

    // Calculate remaining based on plan type
    let remaining: number;
    if (planConfig.type === 'solves') {
      remaining = Math.max(0, planConfig.limit - monthlyTotals.solves);
    } else {
      remaining = Math.max(0, planConfig.limit - monthlyTotals.cost);
    }

    return {
      plan,
      limitType: planConfig.type,
      monthlyLimit: planConfig.limit,
      monthly: {
        used: planConfig.type === 'solves' ? monthlyTotals.solves : monthlyTotals.cost,
        remaining,
        byMode: {
          regular: monthlyTotals.regular,
          fast: monthlyTotals.fast,
          expert: monthlyTotals.expert,
        },
        cost: monthlyTotals.cost,
        tokens: monthlyTotals.tokens,
      },
      history: history.map(h => ({
        date: h.date,
        solves: h.solvesUsed,
        regular: h.modeRegularCount,
        fast: h.modeFastCount,
        expert: h.modeExpertCount,
        tokens: h.tokensUsed,
        cost: h.totalMonthlyCost,
      })),
    };
  }
}
