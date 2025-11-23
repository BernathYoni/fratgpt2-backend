import OpenAI from 'openai';
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

    console.log('[OPENAI] 📝 RAW RESPONSE:');
    console.log('[OPENAI] ═══════════════════════════════════════════════════════════');
    console.log(text);
    console.log('[OPENAI] ═══════════════════════════════════════════════════════════');

    // Parse JSON response with STRICT validation
    try {
      const parsed = JSON.parse(text);

      // VALIDATE: Must have shortAnswer
      if (!parsed.shortAnswer || typeof parsed.shortAnswer !== 'string') {
        console.error('[OPENAI] ❌ CRITICAL: Missing or invalid shortAnswer');
        console.error('[OPENAI] ❌ Raw response:', text);
        throw new Error('Invalid response: missing or invalid shortAnswer');
      }

      // VALIDATE: Must have steps array
      if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        console.error('[OPENAI] ❌ CRITICAL: Missing or invalid steps array');
        console.error('[OPENAI] ❌ Raw response:', text);
        throw new Error('Invalid response: missing or invalid steps array');
      }

      // VALIDATE: All steps must be strings
      if (!parsed.steps.every((step: any) => typeof step === 'string')) {
        console.error('[OPENAI] ❌ CRITICAL: All steps must be strings');
        console.error('[OPENAI] ❌ Raw response:', text);
        throw new Error('Invalid response: all steps must be strings');
      }

      console.log('[OPENAI] ✅ Valid JSON with', parsed.steps.length, 'steps');
      return {
        shortAnswer: parsed.shortAnswer,
        steps: parsed.steps,
        tokensUsed: completion.usage?.total_tokens,
      };
    } catch (error: any) {
      console.error('[OPENAI] ❌ CRITICAL: LLM returned invalid JSON format');
      console.error('[OPENAI] ❌ Error:', error.message);
      console.error('[OPENAI] ❌ Raw response:', text);
      throw new Error(`OpenAI failed to return proper JSON format: ${error.message}`);
    }
  }
}
