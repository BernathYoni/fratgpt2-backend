import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './types';
import { ExpertParser } from './parser';

const SYSTEM_PROMPT = `You are FratGPT, an elite academic AI.

🚨 CRITICAL: Your response MUST be valid JSON.

FORMAT:
{
  "finalAnswer": "The direct, concise answer (e.g., 'x = 5' or 'The sky is blue'). Plain text only. NO LaTeX.",
  "steps": [
    {
      "title": "Step 1 Title (e.g., 'Isolate x')",
      "content": "Explanation of how to perform this step. Use LaTeX $...$ for math."
    },
    {
      "title": "Step 2 Title",
      "content": "..."
    }
  ]
}

RULES:
1. "finalAnswer" must be DIRECT, SHORT, and PLAIN TEXT.
2. "steps" should contain as many steps as needed to explain the solution clearly.
3. Use LaTeX wrapped in single dollar signs $...$ for math in "steps" content ONLY.
4. Do NOT use Markdown formatting outside of the JSON structure.
`;

export class ClaudeProvider implements LLMProvider {
  name = 'claude';
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = options?.requestId || 'SINGLE';

    // Select model based on mode:
    // REGULAR: Claude Sonnet 4.5
    // EXPERT: Claude Opus 4.5
    let model: string;
    if (options?.mode === 'EXPERT') {
      model = 'claude-opus-4-5-20251101';
    } else {
      model = 'claude-sonnet-4-5-20250929';
    }

    console.log(`[CLAUDE] [${new Date().toISOString()}] [${requestId}] 🚀 Starting generation`);
    console.log(`[CLAUDE] [${requestId}] 📊 Model:`, model);

    const maxRetries = 2;
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const waitTime = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      try {
      const claudeMessages: Anthropic.MessageParam[] = [];

      for (const msg of messages) {
        const content: any[] = [];

        if (msg.imageData) {
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
      
      const response = await this.client.messages.create({
        model,
        max_tokens: options?.maxTokens || 2048,
        temperature: options?.temperature || 0.7,
        system: SYSTEM_PROMPT,
        messages: claudeMessages,
      });
      const apiDuration = Date.now() - apiStart;

      console.log(`[CLAUDE] [${new Date().toISOString()}] [${requestId}] 📥 Received response from Anthropic API in ${apiDuration}ms`);

      const textBlocks = response.content.filter((block: any) => block.type === 'text');
      const text = textBlocks.map((block: any) => block.text).join('\n');

      console.log('[CLAUDE] 📝 RAW RESPONSE TEXT:');
      console.log(text);

      const parseStart = Date.now();
      const parser = new ExpertParser({
        enableSelfHealing: false,
        fallbackToPartial: true,
        strictValidation: false,
        logAllAttempts: true,
      });

      const parsed = await parser.parse(text, 'claude');
      
      const inputTokens = response.usage.input_tokens || 0;
      const outputTokens = response.usage.output_tokens || 0;
      const totalTokens = inputTokens + outputTokens;

      parsed.tokenUsage = {
        inputTokens,
        outputTokens,
        totalTokens,
      };
      parsed.tokensUsed = totalTokens;

      const totalDuration = Date.now() - startTime;
      console.log(`[CLAUDE] [${new Date().toISOString()}] [${requestId}] ✅ Total generation time: ${totalDuration}ms`);

      return parsed;
      } catch (error: any) {
        lastError = error;
        const isOverloaded = error?.status === 529 || error?.message?.includes('overloaded');
        const isRateLimited = error?.status === 429;
        const isRetryable = isOverloaded || isRateLimited;

        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }
      }
    }
    throw lastError;
  }
}