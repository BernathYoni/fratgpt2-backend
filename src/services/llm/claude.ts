import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './types';
import { ExpertParser } from './parser';

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

      console.log('[CLAUDE] 📝 RAW RESPONSE:');
      console.log('[CLAUDE] ═══════════════════════════════════════════════════════════');
      console.log(text);
      console.log('[CLAUDE] ═══════════════════════════════════════════════════════════');

      // Use ExpertParser for robust multi-stage parsing
      const parser = new ExpertParser({
        enableSelfHealing: false,
        fallbackToPartial: true,
        strictValidation: false,
        logAllAttempts: true,
      });

      const parsed = await parser.parse(text, 'claude');

      // Add token usage
      parsed.tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

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

      return parsed;
    } catch (error: any) {
      console.error('[CLAUDE] ❌ ERROR in generate:');
      console.error('[CLAUDE] ❌ Error name:', error?.name);
      console.error('[CLAUDE] ❌ Error message:', error?.message);
      console.error('[CLAUDE] ❌ Error status:', error?.status);
      console.error('[CLAUDE] ❌ Full error:', error);
      throw error; // Re-throw so orchestrator can catch it
    }
  }
}
