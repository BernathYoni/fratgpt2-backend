import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './types';
import { ExpertParser } from './parser';
import { AnswerFormatter } from './answerFormatter';
import { SYSTEM_PROMPT_V1, SYSTEM_PROMPT_V2 } from './prompts';


export class ClaudeProvider implements LLMProvider {
  name = 'claude';
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = options?.requestId || 'SINGLE';
    // Always use Claude Sonnet 4.5 (best quality model)
    const model = 'claude-sonnet-4-5-20250929';

    console.log(`[CLAUDE] [${new Date().toISOString()}] [${requestId}] 🚀 Starting generation`);
    console.log(`[CLAUDE] [${requestId}] 📊 Model:`, model);
    console.log(`[CLAUDE] [${requestId}] ⚙️  Config:`, {
      temperature: options?.temperature || 0.7,
      maxTokens: options?.maxTokens || 2048,
      v2Flag: options?.v2,
    });
    console.log(`[CLAUDE] [${requestId}] 📨 Messages count:`, messages.length);

    // Retry logic for 529 overloaded errors
    const maxRetries = 2;
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const waitTime = Math.pow(2, attempt - 1) * 1000; // Exponential backoff: 1s, 2s
        console.log(`[CLAUDE] [${requestId}] 🔄 Retry attempt ${attempt}/${maxRetries} after ${waitTime}ms wait...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      try {

      // Build messages array
      const claudeMessages: Anthropic.MessageParam[] = [];

      for (const msg of messages) {
        const content: any[] = [];

        if (msg.imageData) {
          const imageSize = msg.imageData.length;
          console.log(`[CLAUDE] [${requestId}] 🖼️  Image detected, size:`, (imageSize / 1024).toFixed(2), 'KB');

          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: msg.imageData.replace(/^data:image\/\w+;base64,/, ''),
            },
          });
        }

        content.push({
          type: 'text',
          text: msg.content,
        });

        claudeMessages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content,
        });
      }

      const apiStart = Date.now();
      console.log(`[CLAUDE] [${new Date().toISOString()}] [${requestId}] 📤 Sending request to Anthropic API...`);
      
      const selectedSystemPrompt = (options?.v2 ? SYSTEM_PROMPT_V2 : SYSTEM_PROMPT_V1) + AnswerFormatter.buildStructuredAnswerPrompt();
      
      const response = await this.client.messages.create({
        model,
        max_tokens: options?.maxTokens || 2048,
        temperature: options?.temperature || 0.7,
        system: selectedSystemPrompt,
        messages: claudeMessages,
      });
      const apiDuration = Date.now() - apiStart;

      console.log(`[CLAUDE] [${new Date().toISOString()}] [${requestId}] 📥 Received response from Anthropic API in ${apiDuration}ms`);
      console.log('[CLAUDE] 🔍 FULL API RESPONSE OBJECT:');
      console.log('[CLAUDE] ═══════════════════════════════════════════════════════════');
      console.log(JSON.stringify(response, null, 2));
      console.log('[CLAUDE] ═══════════════════════════════════════════════════════════');

      console.log('[CLAUDE] 🔍 Response ID:', response.id);
      console.log('[CLAUDE] 🔍 Stop reason:', response.stop_reason);
      console.log('[CLAUDE] 🔍 Content blocks:', response.content?.length ?? 0);
      console.log('[CLAUDE] 📊 DETAILED TOKEN USAGE:');
      console.log('[CLAUDE]    Input tokens:', response.usage.input_tokens);
      console.log('[CLAUDE]    Output tokens:', response.usage.output_tokens);
      console.log('[CLAUDE]    Total tokens:', response.usage.input_tokens + response.usage.output_tokens);

      if (response.stop_reason && response.stop_reason !== 'end_turn') {
        console.error('[CLAUDE] ⚠️  WARNING: Stop reason is not end_turn:', response.stop_reason);
        console.error('[CLAUDE] ⚠️  This may indicate content was filtered or max tokens reached');
      }

      console.log('[CLAUDE] 🔍 CRITICAL: Extracting text from content blocks...');
      console.log('[CLAUDE] 🔍 response.content exists:', !!response.content);
      console.log('[CLAUDE] 🔍 response.content is array:', Array.isArray(response.content));
      console.log('[CLAUDE] 🔍 content blocks count:', response.content?.length ?? 0);

      const textBlocks = response.content.filter((block: any) => block.type === 'text');
      console.log('[CLAUDE] 🔍 text blocks count:', textBlocks.length);

      const text = textBlocks
        .map((block: any) => block.text)
        .join('\n');

      console.log('[CLAUDE] 🔍 text variable type:', typeof text);
      console.log('[CLAUDE] 🔍 text length:', text?.length ?? 'N/A');
      console.log('[CLAUDE] 🔍 text is null:', text === null);
      console.log('[CLAUDE] 🔍 text is undefined:', text === undefined);
      console.log('[CLAUDE] 🔍 text is empty string:', text === '');

      if (!text || text.trim().length === 0) {
        console.error('[CLAUDE] ❌❌❌ EMPTY TEXT EXTRACTED ❌❌❌');
        console.error('[CLAUDE] response.content:', JSON.stringify(response.content, null, 2));
      }

      console.log('[CLAUDE] 📝 RAW RESPONSE TEXT:');
      console.log('[CLAUDE] ═══════════════════════════════════════════════════════════');
      console.log(text);
      console.log('[CLAUDE] ═══════════════════════════════════════════════════════════');

      // Use ExpertParser for robust multi-stage parsing
      const parseStart = Date.now();
      console.log(`[CLAUDE] [${new Date().toISOString()}] [${requestId}] 🔍 Starting response parsing...`);
      const parser = new ExpertParser({
        enableSelfHealing: false,
        fallbackToPartial: true,
        strictValidation: false,
        logAllAttempts: true,
      });

      const parsed = await parser.parse(text, 'claude');
      const parseDuration = Date.now() - parseStart;
      console.log(`[CLAUDE] [${new Date().toISOString()}] [${requestId}] ✅ Parsing complete in ${parseDuration}ms`);

      // Extract actual token usage from API response
      const inputTokens = response.usage.input_tokens || 0;
      const outputTokens = response.usage.output_tokens || 0;
      const totalTokens = inputTokens + outputTokens;

      parsed.tokenUsage = {
        inputTokens,
        outputTokens,
        totalTokens,
      };

      // Keep backward compatibility
      parsed.tokensUsed = totalTokens;
      console.log(`[CLAUDE] [${requestId}] 📊 Token usage extracted:`, parsed.tokenUsage);

      // Log parse quality
      if (parsed.confidence && parsed.confidence < 0.9) {
        console.warn('[CLAUDE] ⚠️  Low confidence parse:', {
          confidence: parsed.confidence,
          method: parsed.parseMethod,
          warnings: parsed.warnings,
        });
      }

      if (parsed.parseAttempts && parsed.parseAttempts.length > 1) {
        console.log('[CLAUDE] 📊 Parse attempts:', parsed.parseAttempts.map(a => ({
          method: a.method,
          success: a.success,
          error: a.error,
        })));
      }

      const totalDuration = Date.now() - startTime;
      console.log(`[CLAUDE] [${new Date().toISOString()}] [${requestId}] ✅ Total generation time: ${totalDuration}ms (API: ${apiDuration}ms, Parse: ${parseDuration}ms)`);

      return parsed;
      } catch (error: any) {
        lastError = error;
        console.error(`[CLAUDE] [${new Date().toISOString()}] [${requestId}] ❌ ERROR on attempt ${attempt + 1}/${maxRetries + 1}`);
        console.error('[CLAUDE] ❌ Error name:', error?.name);
        console.error('[CLAUDE] ❌ Error message:', error?.message);
        console.error('[CLAUDE] ❌ Error status:', error?.status);

        // Check if this is a retryable error (529 overloaded)
        const isOverloaded = error?.status === 529 || error?.message?.includes('overloaded');
        const isRateLimited = error?.status === 429;
        const isRetryable = isOverloaded || isRateLimited;

        if (!isRetryable || attempt === maxRetries) {
          // Not retryable or out of retries, throw immediately
          console.error('[CLAUDE] ❌ Error is not retryable or max retries reached, throwing...');
          throw error;
        }

        console.warn(`[CLAUDE] [${requestId}] ⚠️  Retryable error (${error?.status}), will retry...`);
        // Continue to next iteration of retry loop
      }
    }

    // If we get here, all retries failed
    console.error('[CLAUDE] ❌ All retry attempts exhausted');
    throw lastError;
  }
}