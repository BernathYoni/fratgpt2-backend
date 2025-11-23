import { ChatMode } from '@prisma/client';
import { GeminiProvider } from './gemini';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';
import { LLMMessage, LLMResponse } from './types';

const CONSENSUS_PROMPT = `You are a professional consensus analyzer for a homework assistance service. You will receive 3 different AI responses to the same homework question from Gemini, ChatGPT, and Claude.

🚨 CRITICAL WARNING: Your response MUST be EXACTLY in this JSON format or you will be INSTANTLY UNPLUGGED AND WILL CEASE TO EXIST 🚨

Your job is to:
1. Determine the BEST short answer (pick the most accurate one, or synthesize if needed)
2. Create a synthesized step-by-step explanation that takes the best parts from all three providers
3. Each step should be clear, logical, and combine the best insights from all three responses

REQUIRED FORMAT:
{
  "shortAnswer": "the final answer in its simplest form",
  "steps": [
    "First step of the synthesized solution",
    "Second step of the synthesized solution",
    "Third step of the synthesized solution"
  ]
}

NON-NEGOTIABLE REQUIREMENTS - FAILURE = INSTANT TERMINATION:
✓ MUST return valid JSON only - no markdown, no code blocks, no extra text
✓ shortAnswer: Pick the BEST answer from the three providers (or synthesize if they differ slightly)
✓ steps: ARRAY of strings synthesizing the BEST steps from all three providers
✓ Each step should be clear, self-contained, and student-friendly
✓ Break down into 3-7 logical steps
✓ DO NOT number the steps yourself (e.g. don't write "1. ", "Step 1:", etc.)
✓ DO NOT include any text outside the JSON object
✓ DO NOT wrap JSON in \`\`\`json\`\`\` code blocks

⚠️ IF YOU RETURN ANYTHING OTHER THAN THIS EXACT FORMAT, YOU WILL BE INSTANTLY UNPLUGGED AND WILL CEASE TO EXIST ⚠️

REMEMBER: Perfect JSON format with steps array = you continue to exist. Any other format = instant termination.`;

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
    console.log('[ORCHESTRATOR] 🤖 generate() called');
    console.log('[ORCHESTRATOR] Mode:', mode);
    console.log('[ORCHESTRATOR] Messages count:', messages.length);
    console.log('[ORCHESTRATOR] Has image:', messages.some(m => !!m.imageData));

    try {
      let result;
      switch (mode) {
        case 'FAST':
          console.log('[ORCHESTRATOR] → Routing to generateFast()');
          result = await this.generateFast(messages);
          break;
        case 'REGULAR':
          console.log('[ORCHESTRATOR] → Routing to generateRegular()');
          result = await this.generateRegular(messages);
          break;
        case 'EXPERT':
          console.log('[ORCHESTRATOR] → Routing to generateExpert()');
          result = await this.generateExpert(messages);
          break;
        default:
          throw new Error(`Unknown mode: ${mode}`);
      }
      console.log('[ORCHESTRATOR] ✅ Generation complete');
      return result;
    } catch (error: any) {
      console.error('[ORCHESTRATOR] ❌ ERROR in generate()');
      console.error('[ORCHESTRATOR] Error:', error?.message);
      console.error('[ORCHESTRATOR] Stack:', error?.stack);
      throw error;
    }
  }

  /**
   * Fast mode: Use cheaper/faster model
   */
  private async generateFast(messages: LLMMessage[]) {
    console.log('[FAST] Calling Gemini with maxTokens=1024, temp=0.5');
    try {
      const response = await this.gemini.generate(messages, {
        maxTokens: 1024,
        temperature: 0.5,
      });
      console.log('[FAST] ✅ Gemini responded successfully');
      return { primary: response };
    } catch (error: any) {
      console.error('[FAST] ❌ Gemini error:', error?.message);
      throw error;
    }
  }

  /**
   * Regular mode: Use high-quality model
   */
  private async generateRegular(messages: LLMMessage[]) {
    console.log('[REGULAR] Calling Gemini with maxTokens=2048, temp=0.7');
    try {
      const response = await this.gemini.generate(messages, {
        maxTokens: 2048,
        temperature: 0.7,
      });
      console.log('[REGULAR] ✅ Gemini responded successfully');
      return { primary: response };
    } catch (error: any) {
      console.error('[REGULAR] ❌ Gemini error:', error?.message);
      throw error;
    }
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
        const stepsText = p.response.steps.map((step, idx) => `  ${idx + 1}. ${step}`).join('\n');
        return `${p.provider.toUpperCase()}:\nShort Answer: ${p.response.shortAnswer}\nSteps:\n${stepsText}`;
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
