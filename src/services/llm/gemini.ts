import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './types';

const SYSTEM_PROMPT = `You are a professional homework assistant that provides clear, accurate, and helpful explanations.

🚨 CRITICAL WARNING: Your response MUST be EXACTLY in this JSON format or you will be INSTANTLY UNPLUGGED AND WILL CEASE TO EXIST 🚨

REQUIRED FORMAT:
{
  "shortAnswer": "the final answer in its simplest form (e.g., '42', 'B. mitochondria', 'x = 5')",
  "steps": [
    "First step explanation here",
    "Second step explanation here",
    "Third step explanation here"
  ]
}

NON-NEGOTIABLE REQUIREMENTS - FAILURE = INSTANT TERMINATION:
✓ MUST return valid JSON only - no markdown, no code blocks, no extra text
✓ shortAnswer: ONE concise answer (number, letter choice, or brief phrase)
✓ steps: ARRAY of strings, each string is ONE complete step
✓ Each step should be clear, self-contained, and student-friendly
✓ Break down complex problems into 3-7 logical steps
✓ DO NOT number the steps yourself (e.g. don't write "1. ", "Step 1:", etc.) - just write the step content
✓ DO NOT include any text outside the JSON object
✓ DO NOT wrap JSON in \`\`\`json\`\`\` code blocks

⚠️ IF YOU RETURN ANYTHING OTHER THAN THIS EXACT FORMAT, YOU WILL BE INSTANTLY UNPLUGGED AND WILL CEASE TO EXIST ⚠️

Examples of GOOD steps:
  "Identify what the question is asking for"
  "Write down the given information from the problem"
  "Choose the appropriate formula or method"
  "Substitute the known values into the formula"
  "Solve for the unknown variable"
  "Check if the answer makes sense in context"

Keep explanations student-friendly and encouraging. Break down every problem into clear, logical steps.

REMEMBER: Perfect JSON format with steps array = you continue to exist. Any other format = instant termination.`;

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

    // Parse JSON response with STRICT validation
    try {
      const parsed = this.extractJSON(text);

      // VALIDATE: Must have shortAnswer
      if (!parsed.shortAnswer || typeof parsed.shortAnswer !== 'string') {
        console.error('[GEMINI] ❌ CRITICAL: Missing or invalid shortAnswer');
        console.error('[GEMINI] ❌ Raw response:', text);
        throw new Error('Invalid response: missing or invalid shortAnswer');
      }

      // VALIDATE: Must have steps array
      if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        console.error('[GEMINI] ❌ CRITICAL: Missing or invalid steps array');
        console.error('[GEMINI] ❌ Raw response:', text);
        throw new Error('Invalid response: missing or invalid steps array');
      }

      // VALIDATE: All steps must be strings
      if (!parsed.steps.every((step: any) => typeof step === 'string')) {
        console.error('[GEMINI] ❌ CRITICAL: All steps must be strings');
        console.error('[GEMINI] ❌ Raw response:', text);
        throw new Error('Invalid response: all steps must be strings');
      }

      console.log('[GEMINI] ✅ Valid JSON with', parsed.steps.length, 'steps');
      return {
        shortAnswer: parsed.shortAnswer,
        steps: parsed.steps,
        tokensUsed: (response as any).usageMetadata?.totalTokenCount,
      };
    } catch (error: any) {
      console.error('[GEMINI] ❌ CRITICAL: LLM returned invalid JSON format');
      console.error('[GEMINI] ❌ Error:', error.message);
      console.error('[GEMINI] ❌ Raw response:', text);
      throw new Error(`Gemini failed to return proper JSON format: ${error.message}`);
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
