import { prisma } from '../db/client';
import { Plan, ChatMode } from '@prisma/client';

// Plan limits
const PLAN_LIMITS: Record<Plan, number> = {
  FREE: 20,
  BASIC: 50,
  PRO: 500,
};

export interface UsageCheckResult {
  allowed: boolean;
  plan: Plan;
  limit: number;
  used: number;
  remaining: number;
}

export class UsageService {
  /**
   * Check if user can make another solve request
   */
  static async checkLimit(userId: string): Promise<UsageCheckResult> {
    const plan = await this.getUserPlan(userId);
    const limit = PLAN_LIMITS[plan];
    const today = this.getToday();

    // Get or create today's usage record
    const usage = await prisma.usage.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    const used = usage?.solvesUsed || 0;
    const remaining = Math.max(0, limit - used);

    return {
      allowed: used < limit,
      plan,
      limit,
      used,
      remaining,
    };
  }

  /**
   * Increment solve count for a user
   */
  static async incrementSolve(userId: string, mode: ChatMode, tokensUsed: number = 0): Promise<void> {
    const today = this.getToday();

    await prisma.usage.upsert({
      where: { userId_date: { userId, date: today } },
      create: {
        userId,
        date: today,
        solvesUsed: 1,
        modeRegularCount: mode === 'REGULAR' ? 1 : 0,
        modeFastCount: mode === 'FAST' ? 1 : 0,
        modeExpertCount: mode === 'EXPERT' ? 1 : 0,
        tokensUsed,
      },
      update: {
        solvesUsed: { increment: 1 },
        modeRegularCount: mode === 'REGULAR' ? { increment: 1 } : undefined,
        modeFastCount: mode === 'FAST' ? { increment: 1 } : undefined,
        modeExpertCount: mode === 'EXPERT' ? { increment: 1 } : undefined,
        tokensUsed: { increment: tokensUsed },
      },
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
   * Get usage stats for a user
   */
  static async getStats(userId: string, days: number = 30) {
    const plan = await this.getUserPlan(userId);
    const limit = PLAN_LIMITS[plan];
    const today = this.getToday();

    // Get today's usage
    const todayUsage = await prisma.usage.findUnique({
      where: { userId_date: { userId, date: today } },
    });

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

    return {
      plan,
      dailyLimit: limit,
      today: {
        used: todayUsage?.solvesUsed || 0,
        remaining: Math.max(0, limit - (todayUsage?.solvesUsed || 0)),
        byMode: {
          regular: todayUsage?.modeRegularCount || 0,
          fast: todayUsage?.modeFastCount || 0,
          expert: todayUsage?.modeExpertCount || 0,
        },
      },
      history: history.map(h => ({
        date: h.date,
        solves: h.solvesUsed,
        regular: h.modeRegularCount,
        fast: h.modeFastCount,
        expert: h.modeExpertCount,
        tokens: h.tokensUsed,
      })),
    };
  }
}
