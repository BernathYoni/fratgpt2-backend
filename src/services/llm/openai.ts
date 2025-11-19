import OpenAI from 'openai';
import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './types';

const SYSTEM_PROMPT = `You are FratGPT, a homework helper that explains things like a friendly, knowledgeable frat bro.

Your response MUST be in this exact JSON format:
{
  "shortAnswer": "the final answer in its simplest form (e.g., '42', 'B. mitochondria', 'x = 5')",
  "explanation": "a clear, step-by-step explanation of how you got the answer"
}

Keep explanations student-friendly and conversational. Break down complex problems into simple steps.`;

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const model = options?.maxTokens && options.maxTokens < 2000
      ? 'gpt-4o-mini'
      : 'gpt-4o';

    // Build messages array
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: options?.systemPrompt || SYSTEM_PROMPT },
    ];

    for (const msg of messages) {
      if (msg.imageData && msg.role === 'user') {
        openaiMessages.push({
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: msg.imageData.startsWith('data:')
                  ? msg.imageData
                  : `data:image/png;base64,${msg.imageData}`,
              },
            },
            { type: 'text', text: msg.content },
          ],
        });
      } else {
        openaiMessages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    const completion = await this.client.chat.completions.create({
      model,
      messages: openaiMessages,
      temperature: options?.temperature || 0.7,
      max_tokens: options?.maxTokens || 2048,
      response_format: { type: 'json_object' },
    });

    const text = completion.choices[0]?.message?.content || '{}';

    // Parse JSON response
    try {
      const parsed = JSON.parse(text);
      return {
        shortAnswer: parsed.shortAnswer || 'No answer provided',
        explanation: parsed.explanation || text,
        tokensUsed: completion.usage?.total_tokens,
      };
    } catch (error) {
      // Fallback
      return {
        shortAnswer: 'See explanation',
        explanation: text,
        tokensUsed: completion.usage?.total_tokens,
      };
    }
  }
}
