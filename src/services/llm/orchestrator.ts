import { ChatMode } from '@prisma/client';
import { GeminiProvider } from './gemini';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';
import { LLMMessage, LLMResponse, ParseConfidence } from './types';

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
    console.log('[REGULAR] Calling Gemini with maxTokens=8192, temp=0.7');
    try {
      const response = await this.gemini.generate(messages, {
        maxTokens: 8192, // Increased from 2048 to account for thinking tokens (2047) + actual response
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
   * Expert mode: Call all 3 providers and return their responses
   */
  private async generateExpert(messages: LLMMessage[]) {
    console.log('[EXPERT] 🚀 Starting Expert mode generation');
    console.log('[EXPERT] 📤 Calling all 3 providers in parallel...');

    // Call all providers in parallel
    const results = await Promise.allSettled([
      this.gemini.generate(messages).then(r => ({ provider: 'gemini', response: r })),
      this.openai.generate(messages).then(r => ({ provider: 'openai', response: r })),
      this.claude.generate(messages).then(r => ({ provider: 'claude', response: r })),
    ]);

    console.log('[EXPERT] 📊 All provider calls completed');
    console.log('[EXPERT] ═══════════════════════════════════════════════════════════');

    const providers: ProviderResult[] = results.map((result, idx) => {
      const providerName = ['gemini', 'openai', 'claude'][idx];

      if (result.status === 'fulfilled') {
        const response = result.value.response;

        console.log(`[EXPERT] ✅ ${providerName.toUpperCase()} SUCCESS`);
        console.log(`[EXPERT]    shortAnswer: "${response.shortAnswer}"`);
        console.log(`[EXPERT]    steps count: ${response.steps.length}`);
        console.log(`[EXPERT]    confidence: ${response.confidence ?? 'N/A'}`);
        console.log(`[EXPERT]    parseMethod: ${response.parseMethod ?? 'N/A'}`);

        // Log warnings if present
        if (response.warnings && response.warnings.length > 0) {
          console.warn(`[EXPERT]    ⚠️  warnings:`, response.warnings);
        }

        // Check parse quality
        if (response.confidence && response.confidence < ParseConfidence.MEDIUM) {
          console.warn(`[EXPERT]    ⚠️  LOW QUALITY PARSE for ${providerName}`);
        }

        if (response.error) {
          console.error(`[EXPERT]    ❌ Parse error: ${response.error}`);
        }

        return result.value;
      } else {
        console.error(`[EXPERT] ❌ ${providerName.toUpperCase()} FAILED (Network/API error)`);
        console.error(`[EXPERT]    Error: ${result.reason?.message || 'Unknown error'}`);
        console.error(`[EXPERT]    Stack: ${result.reason?.stack || 'No stack trace'}`);
        return {
          provider: providerName,
          response: {
            shortAnswer: 'Error',
            steps: ['Failed to get response from this provider'],
            error: 'NETWORK_ERROR',
            confidence: ParseConfidence.FAILED,
          },
          error: result.reason?.message || 'Unknown error',
        };
      }
    });

    console.log('[EXPERT] ═══════════════════════════════════════════════════════════');

    // Calculate average parse confidence
    const avgConfidence = providers.reduce((sum, p) => sum + (p.response.confidence ?? 0), 0) / providers.length;
    console.log(`[EXPERT] 📊 Average parse confidence: ${avgConfidence.toFixed(2)}`);

    // Use the first successful provider with highest confidence as primary
    const sortedProviders = [...providers].sort((a, b) => {
      const confA = a.response.confidence ?? 0;
      const confB = b.response.confidence ?? 0;
      return confB - confA;
    });

    const primaryProvider = sortedProviders.find(p => !p.error && !p.response.error);
    const primary = primaryProvider ? primaryProvider.response : providers[0].response;

    console.log('[EXPERT] ✅ Expert mode complete - returning all provider responses');
    console.log(`[EXPERT] Primary provider: ${primaryProvider?.provider ?? 'none'}`);

    return {
      primary,
      providers,
    };
  }

}
