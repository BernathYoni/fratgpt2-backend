/**
 * CostCalculator - Calculate API costs from token usage
 *
 * Pricing as of Dec 2025 (per million tokens):
 * FAST Mode:
 * - Gemini 3 Flash Preview: $0.50 input, $3.00 output
 *
 * EXPERT Mode:
 * - Gemini 3.0 Pro: $10.00 input, $40.00 output (estimated)
 * - GPT-5.2: $1.25 input, $10.00 output (GPT-5 pricing as proxy)
 * - Claude 4.5 Opus: $5.00 input, $25.00 output, $6.25 thinking (estimated)
 *
 * LEGACY/REGULAR Mode (Deprecated but kept for history):
 * - Gemini 2.5 Pro: $1.25 input, $5.00 output
 * - GPT-5 mini: $0.25 input, $2.00 output
 * - Claude 4.5 Sonnet: $3.00 input, $15.00 output
 * 
 * ADMIN CHATBOT:
 * - GPT-5.2: $1.25 input, $10.00 output
 */

export interface TokenCosts {
  inputTokens: number | bigint;
  outputTokens: number | bigint;
  thinkingTokens?: number | bigint;
}

export interface ModelCost {
  inputTokens: number | bigint;
  outputTokens: number | bigint;
  thinkingTokens?: number | bigint;
  cost: number;
  percentageOfTotal?: number;
}

export interface TotalCosts {
  geminiFlash: ModelCost;
  geminiPro: ModelCost;
  openai: ModelCost;
  claudeSonnet: ModelCost;
  claudeOpus: ModelCost;
  adminChatbot: ModelCost;
  total: {
    cost: number;
    tokens: number | bigint;
  };
}

export class CostCalculator {
  // Pricing per million tokens (updated Dec 2025)
  private static readonly PRICES = {
    GEMINI_FLASH: {
      INPUT: 0.10,   // $0.10 (Legacy Gemini 2.0 Flash)
      OUTPUT: 0.40,  // $0.40
    },
    GEMINI_PRO: {
      INPUT: 1.25,   // $1.25 (Legacy Gemini 2.5 Pro)
      OUTPUT: 5.00,  // $5.00
    },
    GEMINI_EXPERT: {
      INPUT: 10.00,  // $10.00 (Gemini 3.0 Pro)
      OUTPUT: 40.00, // $40.00
    },
    GEMINI_3_FLASH: {
      INPUT: 0.50,   // $0.50 (Gemini 3 Flash Preview - FAST Mode & Thinking)
      OUTPUT: 3.00,  // $3.00
    },
    OPENAI_MINI: {
      INPUT: 0.25,   // $0.25 (Legacy GPT-5 mini)
      OUTPUT: 2.00,  // $2.00
    },
    OPENAI_PRO: {
      INPUT: 1.25,   // $1.25 (GPT-5.2)
      OUTPUT: 10.00, // $10.00
    },
    OPENAI_ADMIN: {
      INPUT: 1.25,   // $1.25 (GPT-5.2 for Admin)
      OUTPUT: 10.00, // $10.00
    },
    CLAUDE_SONNET: {
      INPUT: 3.00,    // $3.00 (Legacy Claude 4.5 Sonnet)
      OUTPUT: 15.00,  // $15.00
      THINKING: 3.75, // $3.75
    },
    CLAUDE_OPUS: {
      INPUT: 5.00,    // $5.00 (Claude 4.5 Opus)
      OUTPUT: 25.00,  // $25.00
      THINKING: 6.25, // $6.25
    },
  };

  /**
   * Check if a plan allows Expert mode
   */
  static allowsExpertMode(plan: string): boolean {
    return ['PRO', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(plan);
  }

  /**
   * Calculate cost for Fast mode (Gemini 3 Flash)
   */
  static calculateFastModeCost(tokens: TokenCosts): { totalCost: number } {
    // New FAST mode uses Gemini 3 Flash
    const cost = this.calculateModelCost('GEMINI_3_FLASH', tokens);
    return { totalCost: cost };
  }

  /**
   * Calculate cost for Regular mode (Legacy)
   */
  static calculateRegularModeCost(tokens: TokenCosts): { totalCost: number } {
    const cost = this.calculateModelCost('GEMINI_PRO', tokens);
    return { totalCost: cost };
  }

  /**
   * Calculate cost for a specific model by string name
   */
  static calculateCost(
    model: 'gpt-4o' | 'claude-sonnet' | 'claude-opus',
    tokens: TokenCosts
  ): { totalCost: number } {
    let modelKey: string;
    if (model === 'gpt-4o') {
      modelKey = 'OPENAI_PRO';
    } else if (model === 'claude-sonnet') {
      modelKey = 'CLAUDE_SONNET';
    } else if (model === 'claude-opus') {
      modelKey = 'CLAUDE_OPUS';
    } else {
      // Fallback for legacy 'claude-3.5-sonnet'
      modelKey = 'CLAUDE_SONNET';
    }
    const cost = this.calculateModelCost(modelKey as any, tokens);
    return { totalCost: cost };
  }

  /**
   * Calculate cost for a specific model
   */
  static calculateModelCost(
    model: 'GEMINI_FLASH' | 'GEMINI_PRO' | 'GEMINI_EXPERT' | 'GEMINI_3_FLASH' | 'OPENAI_MINI' | 'OPENAI_PRO' | 'CLAUDE_SONNET' | 'CLAUDE_OPUS' | 'OPENAI_ADMIN',
    tokens: TokenCosts
  ): number {
    // Fallback for old keys if necessary or just strict typing
    const prices = this.PRICES[model as keyof typeof CostCalculator.PRICES];

    if (!prices) {
        // Fallback for legacy 'OPENAI' key if passed dynamically
        if (model === 'OPENAI' as any) return this.calculateModelCost('OPENAI_PRO', tokens);
        // Fallback for legacy 'CLAUDE' key
        if (model === 'CLAUDE' as any) return this.calculateModelCost('CLAUDE_SONNET', tokens);
        return 0;
    }

    const inputTokens = Number(tokens.inputTokens);
    const outputTokens = Number(tokens.outputTokens);
    const thinkingTokens = Number(tokens.thinkingTokens || 0);

    // Convert to millions and apply pricing
    const inputCost = (inputTokens / 1_000_000) * prices.INPUT;
    const outputCost = (outputTokens / 1_000_000) * prices.OUTPUT;
    const thinkingCost = (model === 'CLAUDE_SONNET' || model === 'CLAUDE_OPUS') && thinkingTokens > 0 && 'THINKING' in prices
      ? (thinkingTokens / 1_000_000) * prices.THINKING
      : 0;

    return inputCost + outputCost + thinkingCost;
  }

  /**
   * Calculate total costs across all providers
   */
  static calculateTotalCosts(data: {
    geminiFlashInputTokens: number | bigint;
    geminiFlashOutputTokens: number | bigint;
    geminiProInputTokens: number | bigint;
    geminiProOutputTokens: number | bigint;
    openaiInputTokens: number | bigint;
    openaiOutputTokens: number | bigint;
    claudeSonnetInputTokens: number | bigint;
    claudeSonnetOutputTokens: number | bigint;
    claudeSonnetThinkingTokens: number | bigint;
    claudeOpusInputTokens: number | bigint;
    claudeOpusOutputTokens: number | bigint;
    claudeOpusThinkingTokens: number | bigint;
    // Admin Chatbot
    adminChatbotInputTokens?: number | bigint;
    adminChatbotOutputTokens?: number | bigint;
  }): TotalCosts {
    // Calculate per-model costs
    const geminiFlashCost = this.calculateModelCost('GEMINI_FLASH', {
      inputTokens: data.geminiFlashInputTokens,
      outputTokens: data.geminiFlashOutputTokens,
    });

    const geminiProCost = this.calculateModelCost('GEMINI_PRO', {
      inputTokens: data.geminiProInputTokens,
      outputTokens: data.geminiProOutputTokens,
    });

    const openaiCost = this.calculateModelCost('OPENAI_PRO', {
      inputTokens: data.openaiInputTokens,
      outputTokens: data.openaiOutputTokens,
    });

    const claudeSonnetCost = this.calculateModelCost('CLAUDE_SONNET', {
      inputTokens: data.claudeSonnetInputTokens,
      outputTokens: data.claudeSonnetOutputTokens,
      thinkingTokens: data.claudeSonnetThinkingTokens,
    });

    const claudeOpusCost = this.calculateModelCost('CLAUDE_OPUS', {
      inputTokens: data.claudeOpusInputTokens,
      outputTokens: data.claudeOpusOutputTokens,
      thinkingTokens: data.claudeOpusThinkingTokens,
    });

    const adminChatbotCost = this.calculateModelCost('OPENAI_ADMIN', {
      inputTokens: data.adminChatbotInputTokens || 0,
      outputTokens: data.adminChatbotOutputTokens || 0,
    });

    // Calculate total cost
    const totalCost = geminiFlashCost + geminiProCost + openaiCost + claudeSonnetCost + claudeOpusCost + adminChatbotCost;

    // Calculate total tokens
    const totalTokens =
      Number(data.geminiFlashInputTokens) + Number(data.geminiFlashOutputTokens) +
      Number(data.geminiProInputTokens) + Number(data.geminiProOutputTokens) +
      Number(data.openaiInputTokens) + Number(data.openaiOutputTokens) +
      Number(data.claudeSonnetInputTokens) + Number(data.claudeSonnetOutputTokens) + Number(data.claudeSonnetThinkingTokens) +
      Number(data.claudeOpusInputTokens) + Number(data.claudeOpusOutputTokens) + Number(data.claudeOpusThinkingTokens) +
      Number(data.adminChatbotInputTokens || 0) + Number(data.adminChatbotOutputTokens || 0);

    return {
      geminiFlash: {
        inputTokens: data.geminiFlashInputTokens,
        outputTokens: data.geminiFlashOutputTokens,
        cost: geminiFlashCost,
        percentageOfTotal: totalCost > 0 ? (geminiFlashCost / totalCost) * 100 : 0,
      },
      geminiPro: {
        inputTokens: data.geminiProInputTokens,
        outputTokens: data.geminiProOutputTokens,
        cost: geminiProCost,
        percentageOfTotal: totalCost > 0 ? (geminiProCost / totalCost) * 100 : 0,
      },
      openai: {
        inputTokens: data.openaiInputTokens,
        outputTokens: data.openaiOutputTokens,
        cost: openaiCost,
        percentageOfTotal: totalCost > 0 ? (openaiCost / totalCost) * 100 : 0,
      },
      claudeSonnet: {
        inputTokens: data.claudeSonnetInputTokens,
        outputTokens: data.claudeSonnetOutputTokens,
        thinkingTokens: data.claudeSonnetThinkingTokens,
        cost: claudeSonnetCost,
        percentageOfTotal: totalCost > 0 ? (claudeSonnetCost / totalCost) * 100 : 0,
      },
      claudeOpus: {
        inputTokens: data.claudeOpusInputTokens,
        outputTokens: data.claudeOpusOutputTokens,
        thinkingTokens: data.claudeOpusThinkingTokens,
        cost: claudeOpusCost,
        percentageOfTotal: totalCost > 0 ? (claudeOpusCost / totalCost) * 100 : 0,
      },
      adminChatbot: {
        inputTokens: data.adminChatbotInputTokens || 0,
        outputTokens: data.adminChatbotOutputTokens || 0,
        cost: adminChatbotCost,
        percentageOfTotal: totalCost > 0 ? (adminChatbotCost / totalCost) * 100 : 0,
      },
      total: {
        cost: totalCost,
        tokens: totalTokens,
      },
    };
  }

  /**
   * Calculate cost breakdown for a specific time period
   */
  static aggregateCosts(
    records: Array<{
      geminiFlashInputTokens: number | bigint;
      geminiFlashOutputTokens: number | bigint;
      geminiProInputTokens: number | bigint;
      geminiProOutputTokens: number | bigint;
      openaiInputTokens: number | bigint;
      openaiOutputTokens: number | bigint;
      claudeSonnetInputTokens: number | bigint;
      claudeSonnetOutputTokens: number | bigint;
      claudeSonnetThinkingTokens: number | bigint;
      claudeOpusInputTokens: number | bigint;
      claudeOpusOutputTokens: number | bigint;
      claudeOpusThinkingTokens: number | bigint;
      adminChatbotInputTokens?: number | bigint;
      adminChatbotOutputTokens?: number | bigint;
    }>
  ): TotalCosts {
    // Sum up all token counts
    const aggregated = records.reduce(
      (acc, record) => ({
        geminiFlashInputTokens: BigInt(acc.geminiFlashInputTokens) + BigInt(record.geminiFlashInputTokens),
        geminiFlashOutputTokens: BigInt(acc.geminiFlashOutputTokens) + BigInt(record.geminiFlashOutputTokens),
        geminiProInputTokens: BigInt(acc.geminiProInputTokens) + BigInt(record.geminiProInputTokens),
        geminiProOutputTokens: BigInt(acc.geminiProOutputTokens) + BigInt(record.geminiProOutputTokens),
        openaiInputTokens: BigInt(acc.openaiInputTokens) + BigInt(record.openaiInputTokens),
        openaiOutputTokens: BigInt(acc.openaiOutputTokens) + BigInt(record.openaiOutputTokens),
        claudeSonnetInputTokens: BigInt(acc.claudeSonnetInputTokens) + BigInt(record.claudeSonnetInputTokens),
        claudeSonnetOutputTokens: BigInt(acc.claudeSonnetOutputTokens) + BigInt(record.claudeSonnetOutputTokens),
        claudeSonnetThinkingTokens: BigInt(acc.claudeSonnetThinkingTokens) + BigInt(record.claudeSonnetThinkingTokens),
        claudeOpusInputTokens: BigInt(acc.claudeOpusInputTokens) + BigInt(record.claudeOpusInputTokens),
        claudeOpusOutputTokens: BigInt(acc.claudeOpusOutputTokens) + BigInt(record.claudeOpusOutputTokens),
        claudeOpusThinkingTokens: BigInt(acc.claudeOpusThinkingTokens) + BigInt(record.claudeOpusThinkingTokens),
        adminChatbotInputTokens: BigInt(acc.adminChatbotInputTokens as any) + BigInt((record.adminChatbotInputTokens || 0) as any),
        adminChatbotOutputTokens: BigInt(acc.adminChatbotOutputTokens as any) + BigInt((record.adminChatbotOutputTokens || 0) as any),
      }),
      {
        geminiFlashInputTokens: 0n,
        geminiFlashOutputTokens: 0n,
        geminiProInputTokens: 0n,
        geminiProOutputTokens: 0n,
        openaiInputTokens: 0n,
        openaiOutputTokens: 0n,
        claudeSonnetInputTokens: 0n,
        claudeSonnetOutputTokens: 0n,
        claudeSonnetThinkingTokens: 0n,
        claudeOpusInputTokens: 0n,
        claudeOpusOutputTokens: 0n,
        claudeOpusThinkingTokens: 0n,
        adminChatbotInputTokens: 0n,
        adminChatbotOutputTokens: 0n,
      }
    );

    return this.calculateTotalCosts(aggregated);
  }
}
