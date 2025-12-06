import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './types';
import { ExpertParser } from './parser';

const SYSTEM_PROMPT = `You are a professional homework assistant.

🚨 CRITICAL WARNING: Your response MUST be EXACTLY in this JSON format 🚨

REQUIRED FORMAT:
{
  "shortAnswer": "the final answer in its simplest form (e.g., '42', 'B. mitochondria', 'x = 5')"
}

NON-NEGOTIABLE REQUIREMENTS:
✓ MUST return valid JSON only - no markdown, no code blocks, no extra text
✓ shortAnswer: ONE concise answer (number, letter choice, or brief phrase)
✓ DO NOT wrap JSON in code blocks

REMEMBER: Perfect JSON format with ONLY shortAnswer.`;

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = options?.requestId || 'SINGLE';
    // Select model based on mode:
    // FAST: Gemini 2.0 Flash
    // REGULAR: Gemini 2.5 Pro
    // EXPERT: Gemini 3.0 Pro (gemini-3-pro-preview via v1beta API)
    let modelName: string;
    if (options?.mode === 'FAST') {
      modelName = 'gemini-2.0-flash-001';
    } else if (options?.mode === 'EXPERT') {
      modelName = 'gemini-3-pro-preview'; // Gemini 3.0 Pro preview (requires v1beta API)
    } else {
      modelName = 'gemini-2.5-pro';
    }

    console.log(`[GEMINI] [${new Date().toISOString()}] [${requestId}] 🚀 Starting generation`);
    console.log(`[GEMINI] [${requestId}] 📊 Model:`, modelName);
    console.log(`[GEMINI] [${requestId}] ⚙️  Config:`, {
      temperature: options?.temperature || 0.7,
      maxTokens: options?.maxTokens || 2048,
    });

    // Get the model - newer SDK versions default to v1beta which supports all models
    const model = this.client.getGenerativeModel({ model: modelName });

    // Build the prompt
    const parts: any[] = [];

    // Add system prompt (Steps removed)
    // Removed AnswerFormatter to prevent it from re-injecting steps instructions
    parts.push({ text: SYSTEM_PROMPT });

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
    
    const response = result.response;
    let text;
    try {
      text = response.text();
    } catch (error: any) {
      console.error('[GEMINI] ❌ Error extracting text:', error.message);
      throw error;
    }

    console.log('[GEMINI] 📝 RAW RESPONSE TEXT:');
    console.log(text);

    // Use ExpertParser
    const parseStart = Date.now();
    const parser = new ExpertParser({
      enableSelfHealing: false,
      fallbackToPartial: true,
      strictValidation: false,
      logAllAttempts: true,
    });

    const parsed = await parser.parse(text, 'gemini');
    const parseDuration = Date.now() - parseStart;

    // Extract actual token usage from API response
    const responseUsage = (response as any).usageMetadata;
    if (responseUsage) {
      parsed.tokenUsage = {
        inputTokens: responseUsage.promptTokenCount || 0,
        outputTokens: responseUsage.candidatesTokenCount || 0,
        totalTokens: responseUsage.totalTokenCount || 0,
        thinkingTokens: responseUsage.thoughtsTokenCount || undefined,
      };
      parsed.tokensUsed = parsed.tokenUsage.totalTokens;
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[GEMINI] [${new Date().toISOString()}] [${requestId}] ✅ Total generation time: ${totalDuration}ms`);

    return parsed;
  }
}