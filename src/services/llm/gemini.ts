import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './types';
import { ExpertParser } from './parser';

const SYSTEM_PROMPT = `You are FratGPT, an elite academic AI.

🚨 CRITICAL: Your response MUST be valid JSON.

FORMAT:
{
  "finalAnswer": "The EXACT value to input into an online homework system (e.g., '7.5', 'x=5', 'B'). Plain text only. NO conversational text. NO LaTeX.",
  "steps": [
    {
      "title": "Step 1 Title (e.g., 'Plot the function')",
      "content": "Explanation... Use LaTeX $...$ for math.",
      "visual": {
        "type": "graph", 
        "data": "x^2",
        "caption": "The parabola y = x^2"
      }
    }
  ]
}

RULES:
1. "finalAnswer" must be the EXACT, RAW value required for the homework answer field. NO conversational padding.
2. "steps" should contain as many steps as needed to explain the solution clearly.
3. The "content" of each step MUST use a commanding, declarative tone.
4. **VISUALIZATION RULE:** If a math graph would SIGNIFICANTLY help the user understand the concept, include a "visual" object in the step.
   - For **Graphs** (Calculus/Algebra): Use "type": "graph".
   - **CRITICAL:** "data" MUST be the raw mathematical equation string ONLY (e.g., "x^2", "sin(x)", "x^3 - 3x").
   - DO NOT include text, descriptions, or explanations in the "data" field. Use "caption" for text.
   - Do NOT force a visual if the text explanation is sufficient. Use judgment.
5. **Math formatting**:
   - Use LaTeX ($...$) ONLY for complex equations or expressions that require formatting (e.g., fractions, integrals, powers).
   - Use PLAIN TEXT for simple numbers, single variables, and basic arithmetic (e.g., use "x = 5", "y", "slope", NOT "$x=5$", "$y$").
   - Goal: Readability. Do not over-format.
6. Do NOT use Markdown formatting outside of the JSON structure.
`;

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
      modelName = 'gemini-3-flash-preview'; // Updated to 3.0 Flash Preview
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
        responseMimeType: 'application/json',
      },
    });
    const apiDuration = Date.now() - apiStart;

    console.log(`[GEMINI] [${new Date().toISOString()}] [${requestId}] 📥 Received response from Gemini API in ${apiDuration}ms`);
    
    const response = result.response;

    // Log the full response object for debugging
    console.log('[GEMINI] 📝 FULL RESPONSE OBJECT:');
    console.dir(response, { depth: 5 }); // Use console.dir for objects, increased depth

    // Check if candidates exist and if finishReason indicates issues
    if (response.candidates && response.candidates.length === 0) {
      console.warn('[GEMINI] ⚠️  Response has no candidates.');
    } else if (response.candidates && response.candidates[0].finishReason) {
      console.warn(`[GEMINI] ⚠️  Candidate finishReason: ${response.candidates[0].finishReason}`);
    }

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

    parsed.model = modelName; // Track specific model version

    const totalDuration = Date.now() - startTime;
    console.log(`[GEMINI] [${new Date().toISOString()}] [${requestId}] ✅ Total generation time: ${totalDuration}ms`);

    return parsed;
  }

  async *generateStream(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<string | any> {
    const requestId = options?.requestId || 'STREAM';
    
    // User requested "Gemini 3 Flash Preview" model ID
    const modelName = 'gemini-3-flash-preview';

    console.log(`[GEMINI] [${requestId}] 🌊 Starting stream with ${modelName}`);

    const model = this.client.getGenerativeModel({ model: modelName });

    // Modified System Prompt for Thinking
    const streamSystemPrompt = `You are the "Thinking Process" of an advanced AI tutor.
    
YOUR ONLY JOB is to output the raw reasoning and scratchpad work for solving the problem.

RULES:
1. Output your thoughts inside <thinking>...</thinking> XML tags.
2. Do NOT output the final answer or <answer> tags.
3. Do NOT use Markdown formatting (NO bold **, NO italics *, NO headers #).
4. Do NOT use lists, bullet points, or numbered steps.
5. Write in a SINGLE continuous paragraph of plain text (stream of consciousness).
6. Do NOT address the user directly. Just think.
`;

    const parts: any[] = [];
    parts.push({ text: streamSystemPrompt });

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

    try {
      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: options?.temperature || 0.7,
          maxOutputTokens: options?.maxTokens || 4096, 
          responseMimeType: 'text/plain', 
        },
      });

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        yield chunkText;
      }

      // Yield usage metadata at the end
      const response = await result.response;
      if (response.usageMetadata) {
        yield {
          inputTokens: response.usageMetadata.promptTokenCount,
          outputTokens: response.usageMetadata.candidatesTokenCount,
          totalTokens: response.usageMetadata.totalTokenCount
        };
      }

    } catch (error: any) {
      console.error('[GEMINI] ❌ Error in stream:', error);
      throw error;
    }
  }
}