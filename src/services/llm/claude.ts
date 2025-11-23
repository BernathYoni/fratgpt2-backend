import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './types';

const SYSTEM_PROMPT = `You are a professional homework assistant that provides clear, accurate, and helpful explanations.

Your response MUST be in this exact JSON format:
{
  "shortAnswer": "the final answer in its simplest form (e.g., '42', 'B. mitochondria', 'x = 5')",
  "explanation": "a clear, step-by-step explanation of how you got the answer"
}

Keep explanations student-friendly and easy to understand. Break down complex problems into simple, logical steps. Be encouraging and supportive while maintaining a professional tone.`;

export class ClaudeProvider implements LLMProvider {
  name = 'claude';
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    console.log('[CLAUDE] 🚀 Starting generate');
    console.log('[CLAUDE] 📨 Messages count:', messages.length);
    console.log('[CLAUDE] ⚙️ Options:', options);

    try {
      const model = options?.maxTokens && options.maxTokens < 2000
        ? 'claude-haiku-4-5-20251001'
        : 'claude-sonnet-4-5-20250929';

      console.log('[CLAUDE] 🤖 Using model:', model);

      // Build messages array
      const claudeMessages: Anthropic.MessageParam[] = [];

      for (const msg of messages) {
        const content: any[] = [];

        if (msg.imageData) {
          console.log('[CLAUDE] 🖼️ Message has image data');
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

      console.log('[CLAUDE] 📤 Sending request to Anthropic API...');
      const response = await this.client.messages.create({
        model,
        max_tokens: options?.maxTokens || 2048,
        temperature: options?.temperature || 0.7,
        system: options?.systemPrompt || SYSTEM_PROMPT,
        messages: claudeMessages,
      });

      console.log('[CLAUDE] ✅ Response received from Anthropic API');
      console.log('[CLAUDE] 📊 Tokens used:', response.usage.input_tokens + response.usage.output_tokens);

      const text = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');

      console.log('[CLAUDE] 📝 Response text length:', text.length);
      console.log('[CLAUDE] 📝 Response text preview:', text.substring(0, 200));

      // Parse JSON response
      try {
        const parsed = this.extractJSON(text);
        console.log('[CLAUDE] ✅ Successfully parsed JSON response');
        return {
          shortAnswer: parsed.shortAnswer || 'No answer provided',
          explanation: parsed.explanation || text,
          tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        };
      } catch (error) {
        console.error('[CLAUDE] ⚠️ Failed to parse JSON, using fallback:', error);
        // Fallback
        return {
          shortAnswer: 'See explanation',
          explanation: text,
          tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        };
      }
    } catch (error: any) {
      console.error('[CLAUDE] ❌ ERROR in generate:');
      console.error('[CLAUDE] ❌ Error name:', error?.name);
      console.error('[CLAUDE] ❌ Error message:', error?.message);
      console.error('[CLAUDE] ❌ Error status:', error?.status);
      console.error('[CLAUDE] ❌ Full error:', error);
      throw error; // Re-throw so orchestrator can catch it
    }
  }

  private extractJSON(text: string): any {
    // Try to find JSON in the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(text);
  }
}
