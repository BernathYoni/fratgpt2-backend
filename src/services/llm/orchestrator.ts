import { ChatMode } from '@prisma/client';
import { GeminiProvider } from './gemini';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';
import { LLMMessage, LLMResponse } from './types';

const CONSENSUS_PROMPT = `You are a consensus analyzer for FratGPT. You will receive 3 different AI responses to the same homework question from Gemini, ChatGPT, and Claude.

Your job is to:
1. Determine the BEST short answer (pick the most accurate one, or synthesize if needed)
2. Create a combined explanation that takes the best parts from all three
3. Note if there are any significant disagreements

Response format:
{
  "shortAnswer": "the final answer",
  "explanation": "combined explanation drawing from all three responses",
  "disagreement": "brief note if models disagreed significantly, otherwise empty string"
}`;

interface ProviderResult {
  provider: string;
  response: LLMResponse;
  error?: string;
}

export class LLMOrchestrator {
  private gemini: GeminiProvider;
  private openai: OpenAIProvider;
  private claude: ClaudeProvider;

  constructor() {
    this.gemini = new GeminiProvider(process.env.GEMINI_API_KEY || '');
    this.openai = new OpenAIProvider(process.env.OPENAI_API_KEY || '');
    this.claude = new ClaudeProvider(process.env.ANTHROPIC_API_KEY || '');
  }

  /**
   * Generate response based on mode
   */
  async generate(mode: ChatMode, messages: LLMMessage[]): Promise<{
    primary: LLMResponse;
    providers?: ProviderResult[];
    consensus?: LLMResponse;
  }> {
    switch (mode) {
      case 'FAST':
        return this.generateFast(messages);
      case 'REGULAR':
        return this.generateRegular(messages);
      case 'EXPERT':
        return this.generateExpert(messages);
      default:
        throw new Error(`Unknown mode: ${mode}`);
    }
  }

  /**
   * Fast mode: Use cheaper/faster model
   */
  private async generateFast(messages: LLMMessage[]) {
    const response = await this.gemini.generate(messages, {
      maxTokens: 1024,
      temperature: 0.5,
    });

    return { primary: response };
  }

  /**
   * Regular mode: Use high-quality model
   */
  private async generateRegular(messages: LLMMessage[]) {
    const response = await this.gemini.generate(messages, {
      maxTokens: 2048,
      temperature: 0.7,
    });

    return { primary: response };
  }

  /**
   * Expert mode: Call all 3 providers, then consensus
   */
  private async generateExpert(messages: LLMMessage[]) {
    // Call all providers in parallel
    const results = await Promise.allSettled([
      this.gemini.generate(messages).then(r => ({ provider: 'gemini', response: r })),
      this.openai.generate(messages).then(r => ({ provider: 'openai', response: r })),
      this.claude.generate(messages).then(r => ({ provider: 'claude', response: r })),
    ]);

    const providers: ProviderResult[] = results.map((result, idx) => {
      const providerName = ['gemini', 'openai', 'claude'][idx];
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          provider: providerName,
          response: {
            shortAnswer: 'Error',
            explanation: 'Failed to get response',
          },
          error: result.reason?.message || 'Unknown error',
        };
      }
    });

    // Create consensus
    const consensus = await this.createConsensus(providers, messages);

    return {
      primary: consensus,
      providers,
      consensus,
    };
  }

  /**
   * Create consensus from multiple provider responses
   */
  private async createConsensus(providers: ProviderResult[], originalMessages: LLMMessage[]): Promise<LLMResponse> {
    const providersText = providers
      .map(p => {
        if (p.error) {
          return `${p.provider.toUpperCase()}: [Error: ${p.error}]`;
        }
        return `${p.provider.toUpperCase()}:\nShort Answer: ${p.response.shortAnswer}\nExplanation: ${p.response.explanation}`;
      })
      .join('\n\n---\n\n');

    const consensusMessages: LLMMessage[] = [
      {
        role: 'user',
        content: `Original question: ${originalMessages[originalMessages.length - 1]?.content || 'N/A'}\n\nHere are the responses from three AI models:\n\n${providersText}`,
      },
    ];

    // Use Gemini Flash for consensus (cheaper)
    const consensusResponse = await this.gemini.generate(consensusMessages, {
      systemPrompt: CONSENSUS_PROMPT,
      maxTokens: 1024,
      temperature: 0.3,
    });

    return consensusResponse;
  }
}
