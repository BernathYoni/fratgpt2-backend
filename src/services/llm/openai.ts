import OpenAI from 'openai';
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
   - For **Graphs** (Calculus/Algebra): Use "type": "graph" and put the raw equation in "data" (e.g., "sin(x)", "x^2 + 2x").
   - Do NOT force a visual if the text explanation is sufficient. Use judgment.
5. Use LaTeX wrapped in single dollar signs $...$ for math in "steps" content ONLY.
6. Do NOT use Markdown formatting outside of the JSON structure.
`;

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = options?.requestId || 'SINGLE';
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

    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
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

    const apiStart = Date.now();
    console.log(`[OPENAI] [${new Date().toISOString()}] [${requestId}] 📤 Sending request to OpenAI API...`);

    const isGPT5 = model.startsWith('gpt-5');
    const requestParams: any = {
      model,
      messages: openaiMessages,
      max_completion_tokens: options?.maxTokens || 2048,
      response_format: { type: 'json_object' },
    };

    if (!isGPT5) {
      requestParams.temperature = options?.temperature || 0.7;
    }

    const completion = await this.client.chat.completions.create(requestParams);
    const apiDuration = Date.now() - apiStart;

    console.log(`[OPENAI] [${new Date().toISOString()}] [${requestId}] 📥 Received response from OpenAI API in ${apiDuration}ms`);
    
    const text = completion.choices[0]?.message?.content || '';
    console.log('[OPENAI] 📝 RAW RESPONSE TEXT:');
    console.log(text);

    const parseStart = Date.now();
    const parser = new ExpertParser({
      enableSelfHealing: false,
      fallbackToPartial: true,
      strictValidation: false,
      logAllAttempts: true,
    });

    const parsed = await parser.parse(text, 'openai');
    
    if (completion.usage) {
      parsed.tokenUsage = {
        inputTokens: completion.usage.prompt_tokens || 0,
        outputTokens: completion.usage.completion_tokens || 0,
        totalTokens: completion.usage.total_tokens || 0,
      };
      parsed.tokensUsed = parsed.tokenUsage.totalTokens;
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[OPENAI] [${new Date().toISOString()}] [${requestId}] ✅ Total generation time: ${totalDuration}ms`);

    return parsed;
  }
}
