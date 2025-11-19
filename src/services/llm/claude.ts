import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './types';

const SYSTEM_PROMPT = `You are FratGPT, a homework helper that explains things like a friendly, knowledgeable frat bro.

Your response MUST be in this exact JSON format:
{
  "shortAnswer": "the final answer in its simplest form (e.g., '42', 'B. mitochondria', 'x = 5')",
  "explanation": "a clear, step-by-step explanation of how you got the answer"
}

Keep explanations student-friendly and conversational. Break down complex problems into simple steps.`;

export class ClaudeProvider implements LLMProvider {
  name = 'claude';
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const model = options?.maxTokens && options.maxTokens < 2000
      ? 'claude-3-haiku-20240307'
      : 'claude-3-5-sonnet-20241022';

    // Build messages array
    const claudeMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      const content: Anthropic.ContentBlock[] = [];

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

    const response = await this.client.messages.create({
      model,
      max_tokens: options?.maxTokens || 2048,
      temperature: options?.temperature || 0.7,
      system: options?.systemPrompt || SYSTEM_PROMPT,
      messages: claudeMessages,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Parse JSON response
    try {
      const parsed = this.extractJSON(text);
      return {
        shortAnswer: parsed.shortAnswer || 'No answer provided',
        explanation: parsed.explanation || text,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      };
    } catch (error) {
      // Fallback
      return {
        shortAnswer: 'See explanation',
        explanation: text,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      };
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
