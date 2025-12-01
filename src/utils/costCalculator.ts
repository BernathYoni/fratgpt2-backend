/**
 * CostCalculator - Calculate API costs from token usage
 *
 * Pricing as of 2025 (per million tokens):
 * FAST Mode:
 * - Gemini 2.0 Flash: $0.10 input, $0.40 output
 *
 * REGULAR Mode:
 * - Gemini 2.5 Pro: $1.25 input, $5.00 output
 * - ChatGPT 4.1 (gpt-4.1-turbo): $10.00 input, $30.00 output
 * - Claude 3.5 Sonnet: $3.00 input, $15.00 output, $3.75 thinking
 *
 * EXPERT Mode:
 * - Gemini 3.0 (gemini-exp-1206): $10.00 input, $40.00 output (estimated)
 * - ChatGPT 5.1 (chatgpt-4o-latest): $15.00 input, $60.00 output (estimated)
 * - Claude 3.5 Sonnet: $3.00 input, $15.00 output, $3.75 thinking
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
  claude: ModelCost;
  total: {
    cost: number;
    tokens: number | bigint;
  };
}

export class CostCalculator {
  // Pricing per million tokens (updated 2025)
  private static readonly PRICES = {
    GEMINI_FLASH: {
      INPUT: 0.10,   // $0.10 per 1M input tokens
      OUTPUT: 0.40,  // $0.40 per 1M output tokens
    },
    GEMINI_PRO: {
      INPUT: 1.25,   // $1.25 per 1M input tokens
      OUTPUT: 5.00,  // $5.00 per 1M output tokens
    },
    OPENAI: {
      INPUT: 10.00,  // $10.00 per 1M input tokens (GPT-4 Turbo)
      OUTPUT: 30.00, // $30.00 per 1M output tokens
    },
    CLAUDE: {
      INPUT: 3.00,    // $3.00 per 1M input tokens (Claude 3.5 Sonnet)
      OUTPUT: 15.00,  // $15.00 per 1M output tokens
      THINKING: 3.75, // $3.75 per 1M thinking tokens (extended thinking)
    },
  };

  /**
   * Check if a plan allows Expert mode
   */
  static allowsExpertMode(plan: string): boolean {
    return plan === 'PRO';
  }

  /**
   * Calculate cost for Fast mode (Gemini Flash)
   */
  static calculateFastModeCost(tokens: TokenCosts): { totalCost: number } {
    const cost = this.calculateModelCost('GEMINI_FLASH', tokens);
    return { totalCost: cost };
  }

  /**
   * Calculate cost for Regular mode (Gemini Pro)
   */
  static calculateRegularModeCost(tokens: TokenCosts): { totalCost: number } {
    const cost = this.calculateModelCost('GEMINI_PRO', tokens);
    return { totalCost: cost };
  }

  /**
   * Calculate cost for a specific model by string name
   */
  static calculateCost(
    model: 'gpt-4o' | 'claude-3.5-sonnet',
    tokens: TokenCosts
  ): { totalCost: number } {
    const modelKey = model === 'gpt-4o' ? 'OPENAI' : 'CLAUDE';
    const cost = this.calculateModelCost(modelKey, tokens);
    return { totalCost: cost };
  }

  /**
   * Calculate cost for a specific model
   */
  static calculateModelCost(
    model: 'GEMINI_FLASH' | 'GEMINI_PRO' | 'OPENAI' | 'CLAUDE',
    tokens: TokenCosts
  ): number {
    const prices = this.PRICES[model];
    const inputTokens = Number(tokens.inputTokens);
    const outputTokens = Number(tokens.outputTokens);
    const thinkingTokens = Number(tokens.thinkingTokens || 0);

    // Convert to millions and apply pricing
    const inputCost = (inputTokens / 1_000_000) * prices.INPUT;
    const outputCost = (outputTokens / 1_000_000) * prices.OUTPUT;
    const thinkingCost = model === 'CLAUDE' && thinkingTokens > 0 && 'THINKING' in prices
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
    claudeInputTokens: number | bigint;
    claudeOutputTokens: number | bigint;
    claudeThinkingTokens: number | bigint;
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

    const openaiCost = this.calculateModelCost('OPENAI', {
      inputTokens: data.openaiInputTokens,
      outputTokens: data.openaiOutputTokens,
    });

    const claudeCost = this.calculateModelCost('CLAUDE', {
      inputTokens: data.claudeInputTokens,
      outputTokens: data.claudeOutputTokens,
      thinkingTokens: data.claudeThinkingTokens,
    });

    // Calculate total cost
    const totalCost = geminiFlashCost + geminiProCost + openaiCost + claudeCost;

    // Calculate total tokens
    const totalTokens =
      Number(data.geminiFlashInputTokens) + Number(data.geminiFlashOutputTokens) +
      Number(data.geminiProInputTokens) + Number(data.geminiProOutputTokens) +
      Number(data.openaiInputTokens) + Number(data.openaiOutputTokens) +
      Number(data.claudeInputTokens) + Number(data.claudeOutputTokens) + Number(data.claudeThinkingTokens);

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
      claude: {
        inputTokens: data.claudeInputTokens,
        outputTokens: data.claudeOutputTokens,
        thinkingTokens: data.claudeThinkingTokens,
        cost: claudeCost,
        percentageOfTotal: totalCost > 0 ? (claudeCost / totalCost) * 100 : 0,
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
      claudeInputTokens: number | bigint;
      claudeOutputTokens: number | bigint;
      claudeThinkingTokens: number | bigint;
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
        claudeInputTokens: BigInt(acc.claudeInputTokens) + BigInt(record.claudeInputTokens),
        claudeOutputTokens: BigInt(acc.claudeOutputTokens) + BigInt(record.claudeOutputTokens),
        claudeThinkingTokens: BigInt(acc.claudeThinkingTokens) + BigInt(record.claudeThinkingTokens),
      }),
      {
        geminiFlashInputTokens: 0n,
        geminiFlashOutputTokens: 0n,
        geminiProInputTokens: 0n,
        geminiProOutputTokens: 0n,
        openaiInputTokens: 0n,
        openaiOutputTokens: 0n,
        claudeInputTokens: 0n,
        claudeOutputTokens: 0n,
        claudeThinkingTokens: 0n,
      }
    );

    return this.calculateTotalCosts(aggregated);
  }
}
