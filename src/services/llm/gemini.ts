import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './types';

const SYSTEM_PROMPT = `You are a professional homework assistant that provides clear, accurate, and helpful explanations.

Your response MUST be in this exact JSON format:
{
  "shortAnswer": "the final answer in its simplest form (e.g., '42', 'B. mitochondria', 'x = 5')",
  "explanation": "a clear, step-by-step explanation of how you got the answer"
}

Keep explanations student-friendly and easy to understand. Break down complex problems into simple, logical steps. Be encouraging and supportive while maintaining a professional tone.`;

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const model = options?.maxTokens && options.maxTokens < 2000
      ? this.client.getGenerativeModel({ model: 'gemini-2.5-flash' })
      : this.client.getGenerativeModel({ model: 'gemini-2.5-pro' });

    // Build the prompt
    const parts: any[] = [];

    // Add system prompt
    parts.push({ text: options?.systemPrompt || SYSTEM_PROMPT });

    // Add conversation history
    for (const msg of messages) {
      if (msg.imageData) {
        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: msg.imageData.replace(/^data:image\/\w+;base64,/, ''),
          },
        });
      }
      parts.push({ text: `${msg.role}: ${msg.content}` });
    }

    const result = await model.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: options?.temperature || 0.7,
        maxOutputTokens: options?.maxTokens || 2048,
      },
    });

    const response = result.response;
    const text = response.text();

    // Parse JSON response
    try {
      const parsed = this.extractJSON(text);
      return {
        shortAnswer: parsed.shortAnswer || 'No answer provided',
        explanation: parsed.explanation || text,
        tokensUsed: (response as any).usageMetadata?.totalTokenCount,
      };
    } catch (error) {
      // Fallback if not JSON
      return {
        shortAnswer: 'See explanation',
        explanation: text,
        tokensUsed: (response as any).usageMetadata?.totalTokenCount,
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
