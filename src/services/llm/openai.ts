import OpenAI from 'openai';
import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './types';
import { ExpertParser } from './parser';
import { AnswerFormatter } from './answerFormatter';

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
    const startTime = Date.now();
    const requestId = options?.requestId || 'SINGLE';
    // Select model based on mode:
    // EXPERT: gpt-5.1 (GPT-5.1 - latest flagship model)
    // REGULAR: gpt-5-mini (GPT-5 mini - faster, cost-effective)
    // Default: gpt-4o
    let model: string;
    if (options?.mode === 'EXPERT') {
      model = 'gpt-5.1';
    } else if (options?.mode === 'REGULAR') {
      model = 'gpt-5-mini';
    } else {
      model = 'gpt-4o';
    }

    console.log(`[OPENAI] [${new Date().toISOString()}] [${requestId}] 🚀 Starting generation`);
    console.log(`[OPENAI] [${requestId}] 📊 Model:`, model);
    console.log(`[OPENAI] [${requestId}] ⚙️  Config:`, {
      temperature: options?.temperature || 0.7,
      maxTokens: options?.maxTokens || 2048,
    });

    // Build messages array with structured answer requirements
    const systemPrompt = (options?.systemPrompt || SYSTEM_PROMPT) + AnswerFormatter.buildStructuredAnswerPrompt();
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const msg of messages) {
      if (msg.imageData && msg.role === 'user') {
        const imageSize = msg.imageData.length;
        console.log(`[OPENAI] [${requestId}] 🖼️  Image detected, size:`, (imageSize / 1024).toFixed(2), 'KB');

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

    const apiStart = Date.now();
    console.log(`[OPENAI] [${new Date().toISOString()}] [${requestId}] 📤 Sending request to OpenAI API...`);
    const completion = await this.client.chat.completions.create({
      model,
      messages: openaiMessages,
      temperature: options?.temperature || 0.7,
      max_completion_tokens: options?.maxTokens || 2048, // GPT-5+ uses max_completion_tokens
      response_format: { type: 'json_object' },
    });
    const apiDuration = Date.now() - apiStart;

    console.log(`[OPENAI] [${new Date().toISOString()}] [${requestId}] 📥 Received response from OpenAI API in ${apiDuration}ms`);
    console.log('[OPENAI] 🔍 FULL API RESPONSE OBJECT:');
    console.log('[OPENAI] ═══════════════════════════════════════════════════════════');
    console.log(JSON.stringify(completion, null, 2));
    console.log('[OPENAI] ═══════════════════════════════════════════════════════════');

    console.log('[OPENAI] 🔍 Choices count:', completion.choices?.length ?? 0);
    console.log('[OPENAI] 🔍 Finish reason:', completion.choices[0]?.finish_reason);
    console.log('[OPENAI] 📊 DETAILED TOKEN USAGE:');
    console.log('[OPENAI]    Prompt tokens:', completion.usage?.prompt_tokens ?? 0);
    console.log('[OPENAI]    Completion tokens:', completion.usage?.completion_tokens ?? 0);
    console.log('[OPENAI]    Total tokens:', completion.usage?.total_tokens ?? 0);
    if (completion.usage?.prompt_tokens_details?.cached_tokens) {
      console.log('[OPENAI]    Cached tokens:', completion.usage.prompt_tokens_details.cached_tokens, '(saved money!)');
    }
    if (completion.usage?.completion_tokens_details?.reasoning_tokens) {
      console.log('[OPENAI]    Reasoning tokens:', completion.usage.completion_tokens_details.reasoning_tokens);
    }

    if (completion.choices[0]?.finish_reason && completion.choices[0].finish_reason !== 'stop') {
      console.error('[OPENAI] ⚠️  WARNING: Finish reason is not stop:', completion.choices[0].finish_reason);
      console.error('[OPENAI] ⚠️  This may indicate content was filtered or generation failed');
    }

    console.log('[OPENAI] 🔍 CRITICAL: Extracting text from completion...');
    console.log('[OPENAI] 🔍 choices array exists:', !!completion.choices);
    console.log('[OPENAI] 🔍 choices[0] exists:', !!completion.choices[0]);
    console.log('[OPENAI] 🔍 choices[0].message exists:', !!completion.choices[0]?.message);
    console.log('[OPENAI] 🔍 choices[0].message.content exists:', completion.choices[0]?.message?.content !== undefined);

    const text = completion.choices[0]?.message?.content || '';

    console.log('[OPENAI] 🔍 text variable type:', typeof text);
    console.log('[OPENAI] 🔍 text length:', text?.length ?? 'N/A');
    console.log('[OPENAI] 🔍 text is null:', text === null);
    console.log('[OPENAI] 🔍 text is undefined:', text === undefined);
    console.log('[OPENAI] 🔍 text is empty string:', text === '');

    if (!text || text.trim().length === 0) {
      console.error('[OPENAI] ❌❌❌ EMPTY TEXT EXTRACTED ❌❌❌');
      console.error('[OPENAI] completion.choices[0]:', JSON.stringify(completion.choices[0], null, 2));
    }

    console.log('[OPENAI] 📝 RAW RESPONSE TEXT:');
    console.log('[OPENAI] ═══════════════════════════════════════════════════════════');
    console.log(text);
    console.log('[OPENAI] ═══════════════════════════════════════════════════════════');

    // Use ExpertParser for robust multi-stage parsing
    const parseStart = Date.now();
    console.log(`[OPENAI] [${new Date().toISOString()}] [${requestId}] 🔍 Starting response parsing...`);
    const parser = new ExpertParser({
      enableSelfHealing: false,
      fallbackToPartial: true,
      strictValidation: false,
      logAllAttempts: true,
    });

    const parsed = await parser.parse(text, 'openai');
    const parseDuration = Date.now() - parseStart;
    console.log(`[OPENAI] [${new Date().toISOString()}] [${requestId}] ✅ Parsing complete in ${parseDuration}ms`);

    // Extract actual token usage from API response
    if (completion.usage) {
      parsed.tokenUsage = {
        inputTokens: completion.usage.prompt_tokens || 0,
        outputTokens: completion.usage.completion_tokens || 0,
        totalTokens: completion.usage.total_tokens || 0,
      };
      // Keep backward compatibility
      parsed.tokensUsed = parsed.tokenUsage.totalTokens;
      console.log(`[OPENAI] [${requestId}] 📊 Token usage extracted:`, parsed.tokenUsage);
    } else {
      console.warn(`[OPENAI] [${requestId}] ⚠️  No usage data found in response`);
    }

    // Log parse quality
    if (parsed.confidence && parsed.confidence < 0.9) {
      console.warn('[OPENAI] ⚠️  Low confidence parse:', {
        confidence: parsed.confidence,
        method: parsed.parseMethod,
        warnings: parsed.warnings,
      });
    }

    if (parsed.parseAttempts && parsed.parseAttempts.length > 1) {
      console.log('[OPENAI] 📊 Parse attempts:', parsed.parseAttempts.map(a => ({
        method: a.method,
        success: a.success,
        error: a.error,
      })));
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[OPENAI] [${new Date().toISOString()}] [${requestId}] ✅ Total generation time: ${totalDuration}ms (API: ${apiDuration}ms, Parse: ${parseDuration}ms)`);

    return parsed;
  }
}
