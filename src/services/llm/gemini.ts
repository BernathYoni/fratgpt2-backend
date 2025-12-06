import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './types';
import { ExpertParser } from './parser';
import { AnswerFormatter } from './answerFormatter';
import { SYSTEM_PROMPT_V1, SYSTEM_PROMPT_V2 } from './prompts';


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
      v2Flag: options?.v2,
    });

    // Get the model - newer SDK versions default to v1beta which supports all models
    const model = this.client.getGenerativeModel({ model: modelName });

    // Build the prompt
    const parts: any[] = [];

    // Select system prompt based on v2 flag
    console.log(`[GEMINI] [${requestId}] 📝 System Prompt Selected: ${options?.v2 ? 'V2 (Structured)' : 'V1 (Legacy)'}`);
    let systemPromptContent: string;
    if (options?.v2) {
      systemPromptContent = SYSTEM_PROMPT_V2;
      // SYSTEM_PROMPT_V2 already contains the AnswerFormatter logic
    } else {
      systemPromptContent = SYSTEM_PROMPT_V1 + AnswerFormatter.buildStructuredAnswerPrompt();
    }
    parts.push({ text: systemPromptContent });

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

    // Log detailed token usage
    const usageMetadata = (response as any).usageMetadata;
    if (usageMetadata) {
      console.log('[GEMINI] 📊 DETAILED TOKEN USAGE:');
      console.log('[GEMINI]    Prompt tokens:', usageMetadata.promptTokenCount ?? 0);
      console.log('[GEMINI]    Response tokens:', usageMetadata.candidatesTokenCount ?? 0);
      console.log('[GEMINI]    Thinking tokens:', usageMetadata.thoughtsTokenCount ?? 0, '(internal reasoning)');
      console.log('[GEMINI]    Total tokens:', usageMetadata.totalTokenCount ?? 0);
      if (usageMetadata.promptTokensDetails) {
        console.log('[GEMINI]    Prompt breakdown:');
        usageMetadata.promptTokensDetails.forEach((detail: any) => {
          console.log(`[GEMINI]      - ${detail.modality}: ${detail.tokenCount} tokens`);
        });
      }
    }

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

    // Extract actual token usage from API response
    const responseUsage = (response as any).usageMetadata;
    if (responseUsage) {
      parsed.tokenUsage = {
        inputTokens: responseUsage.promptTokenCount || 0,
        outputTokens: responseUsage.candidatesTokenCount || 0,
        totalTokens: responseUsage.totalTokenCount || 0,
        thinkingTokens: responseUsage.thoughtsTokenCount || undefined,
      };
      // Keep backward compatibility
      parsed.tokensUsed = parsed.tokenUsage.totalTokens;
      console.log(`[GEMINI] [${requestId}] 📊 Token usage extracted:`, parsed.tokenUsage);
    } else {
      console.warn(`[GEMINI] [${requestId}] ⚠️  No usage metadata found in response`);
    }

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
