import { GoogleGenerativeAI } from '@google/generative-ai';
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

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = options?.requestId || 'SINGLE';
    const modelName = options?.maxTokens && options.maxTokens < 2000
      ? 'gemini-2.0-flash-001'
      : 'gemini-2.5-pro';

    console.log(`[GEMINI] [${new Date().toISOString()}] [${requestId}] 🚀 Starting generation`);
    console.log(`[GEMINI] [${requestId}] 📊 Model:`, modelName);
    console.log(`[GEMINI] [${requestId}] ⚙️  Config:`, {
      temperature: options?.temperature || 0.7,
      maxTokens: options?.maxTokens || 2048,
    });

    const model = this.client.getGenerativeModel({ model: modelName });

    // Build the prompt
    const parts: any[] = [];

    // Add system prompt with structured answer requirements
    const systemPrompt = (options?.systemPrompt || SYSTEM_PROMPT) + AnswerFormatter.buildStructuredAnswerPrompt();
    parts.push({ text: systemPrompt });

    // Add conversation history
    for (const msg of messages) {
      if (msg.imageData) {
        const imageSize = msg.imageData.length;
        console.log(`[GEMINI] [${requestId}] 🖼️  Image detected, size:`, (imageSize / 1024).toFixed(2), 'KB');
        console.log(`[GEMINI] [${requestId}] 🖼️  Image format:`, msg.imageData.substring(0, 30) + '...');

        parts.push({
          inlineData: {
            mimeType: 'image/png',
            data: msg.imageData.replace(/^data:image\/\w+;base64,/, ''),
          },
        });
      }
      parts.push({ text: `${msg.role}: ${msg.content}` });
    }

    const apiStart = Date.now();
    console.log(`[GEMINI] [${new Date().toISOString()}] [${requestId}] 📤 Sending request to Gemini API...`);
    const result = await model.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: options?.temperature || 0.7,
        maxOutputTokens: options?.maxTokens || 2048,
      },
    });
    const apiDuration = Date.now() - apiStart;

    console.log(`[GEMINI] [${new Date().toISOString()}] [${requestId}] 📥 Received response from Gemini API in ${apiDuration}ms`);
    console.log(`[GEMINI] [${requestId}] 🔍 FULL API RESPONSE OBJECT:`);
    console.log(`[GEMINI] [${requestId}] ═══════════════════════════════════════════════════════════`);
    console.log(JSON.stringify(result, null, 2));
    console.log('[GEMINI] ═══════════════════════════════════════════════════════════');

    const response = result.response;

    console.log('[GEMINI] 🔍 Response object type:', typeof response);
    console.log('[GEMINI] 🔍 Response candidates:', response.candidates?.length ?? 0);

    // Check for safety blocks or finish reasons
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      console.log('[GEMINI] 🔍 Candidate finish reason:', candidate.finishReason);
      console.log('[GEMINI] 🔍 Candidate safety ratings:', JSON.stringify(candidate.safetyRatings, null, 2));

      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        console.error('[GEMINI] ⚠️  WARNING: Finish reason is not STOP:', candidate.finishReason);
        console.error('[GEMINI] ⚠️  This may indicate content was blocked or generation failed');
      }
    }

    console.log('[GEMINI] 🔍 CRITICAL: About to call response.text()...');
    console.log('[GEMINI] 🔍 response object exists:', !!response);
    console.log('[GEMINI] 🔍 response.text is function:', typeof response.text === 'function');

    let text;
    try {
      text = response.text();
      console.log('[GEMINI] ✅ response.text() succeeded');
    } catch (error: any) {
      console.error('[GEMINI] ❌❌❌ CRITICAL ERROR: response.text() FAILED ❌❌❌');
      console.error('[GEMINI] Error:', error.message);
      console.error('[GEMINI] Error stack:', error.stack);
      console.error('[GEMINI] Response object:', JSON.stringify(response, null, 2));
      throw error;
    }

    console.log('[GEMINI] 🔍 text variable type:', typeof text);
    console.log('[GEMINI] 🔍 text length:', text?.length ?? 'N/A');
    console.log('[GEMINI] 🔍 text is null:', text === null);
    console.log('[GEMINI] 🔍 text is undefined:', text === undefined);
    console.log('[GEMINI] 🔍 text is empty string:', text === '');

    console.log('[GEMINI] 📝 RAW RESPONSE TEXT:');
    console.log('[GEMINI] ═══════════════════════════════════════════════════════════');
    console.log(text);
    console.log('[GEMINI] ═══════════════════════════════════════════════════════════');

    // Use ExpertParser for robust multi-stage parsing
    const parseStart = Date.now();
    console.log(`[GEMINI] [${new Date().toISOString()}] [${requestId}] 🔍 Starting response parsing...`);
    const parser = new ExpertParser({
      enableSelfHealing: false, // Disabled to avoid circular dependency
      fallbackToPartial: true,
      strictValidation: false,
      logAllAttempts: true,
    });

    const parsed = await parser.parse(text, 'gemini');
    const parseDuration = Date.now() - parseStart;
    console.log(`[GEMINI] [${new Date().toISOString()}] [${requestId}] ✅ Parsing complete in ${parseDuration}ms`);

    // Add token usage
    parsed.tokensUsed = (response as any).usageMetadata?.totalTokenCount;

    // Log parse quality
    if (parsed.confidence && parsed.confidence < 0.9) {
      console.warn('[GEMINI] ⚠️  Low confidence parse:', {
        confidence: parsed.confidence,
        method: parsed.parseMethod,
        warnings: parsed.warnings,
      });
    }

    if (parsed.parseAttempts && parsed.parseAttempts.length > 1) {
      console.log('[GEMINI] 📊 Parse attempts:', parsed.parseAttempts.map(a => ({
        method: a.method,
        success: a.success,
        error: a.error,
      })));
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[GEMINI] [${new Date().toISOString()}] [${requestId}] ✅ Total generation time: ${totalDuration}ms (API: ${apiDuration}ms, Parse: ${parseDuration}ms)`);

    return parsed;
  }
}
