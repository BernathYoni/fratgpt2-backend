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
    const startTime = Date.now();
    console.log(`[ORCHESTRATOR] [${new Date().toISOString()}] 🤖 generate() called`);
    console.log('[ORCHESTRATOR] Mode:', mode);
    console.log('[ORCHESTRATOR] Messages count:', messages.length);
    console.log('[ORCHESTRATOR] Has image:', messages.some(m => !!m.imageData));

    try {
      let result;
      switch (mode) {
        case 'FAST':
          console.log(`[ORCHESTRATOR] [${new Date().toISOString()}] → Routing to generateFast()`);
          result = await this.generateFast(messages);
          break;
        case 'REGULAR':
          console.log(`[ORCHESTRATOR] [${new Date().toISOString()}] → Routing to generateRegular()`);
          result = await this.generateRegular(messages);
          break;
        case 'EXPERT':
          console.log(`[ORCHESTRATOR] [${new Date().toISOString()}] → Routing to generateExpert()`);
          result = await this.generateExpert(messages);
          break;
        default:
          throw new Error(`Unknown mode: ${mode}`);
      }
      const duration = Date.now() - startTime;
      console.log(`[ORCHESTRATOR] [${new Date().toISOString()}] ✅ Generation complete in ${duration}ms`);
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
    const startTime = Date.now();
    console.log(`[FAST] [${new Date().toISOString()}] Calling Gemini with maxTokens=4096, temp=0.5`);
    try {
      const response = await this.gemini.generate(messages, {
        maxTokens: 4096, // Increased from 1024 to allow for longer responses
        temperature: 0.5,
        mode: 'FAST', // Ensure Flash model is used
      });
      const duration = Date.now() - startTime;
      console.log(`[FAST] [${new Date().toISOString()}] ✅ Gemini responded successfully in ${duration}ms`);
      return { primary: response };
    } catch (error: any) {
      console.error(`[FAST] [${new Date().toISOString()}] ❌ Gemini error:`, error?.message);
      throw error;
    }
  }

  /**
   * Regular mode: Call all 3 providers with mid-tier models
   */
  private async generateRegular(messages: LLMMessage[]) {
    const startTime = Date.now();
    const requestId = `REGULAR-${Date.now()}`;
    console.log(`[REGULAR] [${new Date().toISOString()}] [${requestId}] 🚀 Starting Regular mode with 3 providers`);
    console.log(`[REGULAR] [${new Date().toISOString()}] [${requestId}] 📤 Calling all 3 providers in parallel...`);

    // Call all providers in parallel with Regular-mode models
    const regularOptions = {
      maxTokens: 8192,
      temperature: 0.7,
      requestId,
      mode: 'REGULAR' as const, // Gemini 2.5 Pro, GPT-4 Turbo, Claude Sonnet 4.5
    };

    const parallelStart = Date.now();
    console.log(`[REGULAR] [${new Date().toISOString()}] [${requestId}] ⏱️ GEMINI START at ${Date.now() - parallelStart}ms`);
    console.log(`[REGULAR] [${new Date().toISOString()}] [${requestId}] ⏱️ OPENAI START at ${Date.now() - parallelStart}ms`);
    console.log(`[REGULAR] [${new Date().toISOString()}] [${requestId}] ⏱️ CLAUDE START at ${Date.now() - parallelStart}ms`);

    const results = await Promise.allSettled([
      this.gemini.generate(messages, regularOptions).then(r => {
        const elapsed = Date.now() - parallelStart;
        console.log(`[REGULAR] [${new Date().toISOString()}] [${requestId}] ⏱️ GEMINI DONE at ${elapsed}ms`);
        return { provider: 'gemini', response: r };
      }),
      this.openai.generate(messages, regularOptions).then(r => {
        const elapsed = Date.now() - parallelStart;
        console.log(`[REGULAR] [${new Date().toISOString()}] [${requestId}] ⏱️ OPENAI DONE at ${elapsed}ms`);
        return { provider: 'openai', response: r };
      }),
      this.claude.generate(messages, regularOptions).then(r => {
        const elapsed = Date.now() - parallelStart;
        console.log(`[REGULAR] [${new Date().toISOString()}] [${requestId}] ⏱️ CLAUDE DONE at ${elapsed}ms`);
        return { provider: 'claude', response: r };
      }),
    ]);
    const parallelDuration = Date.now() - parallelStart;

    console.log(`[REGULAR] [${new Date().toISOString()}] 📊 All provider calls completed in ${parallelDuration}ms`);
    console.log('[REGULAR] ═══════════════════════════════════════════════════════════');

    const providers: ProviderResult[] = results.map((result, idx) => {
      const providerName = ['gemini', 'openai', 'claude'][idx];

      if (result.status === 'fulfilled') {
        const response = result.value.response;

        console.log(`[REGULAR] ✅ ${providerName.toUpperCase()} SUCCESS`);
        console.log(`[REGULAR]    shortAnswer: "${response.shortAnswer}"`);
        console.log(`[REGULAR]    steps count: ${response.steps.length}`);
        console.log(`[REGULAR]    confidence: ${response.confidence ?? 'N/A'}`);

        if (response.warnings && response.warnings.length > 0) {
          console.warn(`[REGULAR]    ⚠️  warnings:`, response.warnings);
        }

        return result.value;
      } else {
        console.error(`[REGULAR] ❌ ${providerName.toUpperCase()} FAILED`);
        console.error(`[REGULAR]    Error: ${result.reason?.message || 'Unknown error'}`);
        return {
          provider: providerName,
          response: {
            shortAnswer: 'Error',
            steps: ['Failed to get response from this provider'],
            error: 'NETWORK_ERROR',
          },
          error: result.reason?.message || 'Unknown error',
        };
      }
    });

    console.log('[REGULAR] ═══════════════════════════════════════════════════════════');

    // Use the first successful provider with highest confidence as primary
    const sortedProviders = [...providers].sort((a, b) => {
      const confA = a.response.confidence ?? 0;
      const confB = b.response.confidence ?? 0;
      return confB - confA;
    });

    const primaryProvider = sortedProviders.find(p => !p.error && !p.response.error);
    const primary = primaryProvider ? primaryProvider.response : providers[0].response;

    const totalDuration = Date.now() - startTime;
    console.log(`[REGULAR] [${new Date().toISOString()}] ✅ Regular mode complete in ${totalDuration}ms - returning all provider responses`);
    console.log(`[REGULAR] Primary provider: ${primaryProvider?.provider ?? 'none'}`);

    return {
      primary,
      providers,
    };
  }

  /**
   * Expert mode: Call all 3 providers and return their responses
   */
  private async generateExpert(messages: LLMMessage[]) {
    const startTime = Date.now();
    const requestId = `EXPERT-${Date.now()}`; // Unique ID for this expert request
    console.log(`[EXPERT] [${new Date().toISOString()}] [${requestId}] 🚀 Starting Expert mode generation`);
    console.log(`[EXPERT] [${new Date().toISOString()}] [${requestId}] 📤 Calling all 3 providers in parallel...`);

    // Call all providers in parallel with increased token limits to handle thinking tokens
    const expertOptions = {
      maxTokens: 8192,
      temperature: 0.7,
      requestId, // Pass request ID to providers
      mode: 'EXPERT' as const, // Use Pro models for expert mode
    };

    const parallelStart = Date.now();
    console.log(`[EXPERT] [${new Date().toISOString()}] [${requestId}] ⏱️ GEMINI START at ${Date.now() - parallelStart}ms`);
    console.log(`[EXPERT] [${new Date().toISOString()}] [${requestId}] ⏱️ OPENAI START at ${Date.now() - parallelStart}ms`);
    console.log(`[EXPERT] [${new Date().toISOString()}] [${requestId}] ⏱️ CLAUDE START at ${Date.now() - parallelStart}ms`);

    const results = await Promise.allSettled([
      this.gemini.generate(messages, expertOptions).then(r => {
        const elapsed = Date.now() - parallelStart;
        console.log(`[EXPERT] [${new Date().toISOString()}] [${requestId}] ⏱️ GEMINI DONE at ${elapsed}ms`);
        return { provider: 'gemini', response: r };
      }),
      this.openai.generate(messages, expertOptions).then(r => {
        const elapsed = Date.now() - parallelStart;
        console.log(`[EXPERT] [${new Date().toISOString()}] [${requestId}] ⏱️ OPENAI DONE at ${elapsed}ms`);
        return { provider: 'openai', response: r };
      }),
      this.claude.generate(messages, expertOptions).then(r => {
        const elapsed = Date.now() - parallelStart;
        console.log(`[EXPERT] [${new Date().toISOString()}] [${requestId}] ⏱️ CLAUDE DONE at ${elapsed}ms`);
        return { provider: 'claude', response: r };
      }),
    ]);
    const parallelDuration = Date.now() - parallelStart;

    console.log(`[EXPERT] [${new Date().toISOString()}] 📊 All provider calls completed in ${parallelDuration}ms`);
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

    const totalDuration = Date.now() - startTime;
    console.log(`[EXPERT] [${new Date().toISOString()}] ✅ Expert mode complete in ${totalDuration}ms - returning all provider responses`);
    console.log(`[EXPERT] Primary provider: ${primaryProvider?.provider ?? 'none'}`);

    return {
      primary,
      providers,
    };
  }

}