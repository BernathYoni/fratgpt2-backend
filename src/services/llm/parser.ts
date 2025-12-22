import { LLMResponse, ParseConfidence, ParseAttempt, ParserOptions } from './types';

export class ExpertParser {
  private config: Required<ParserOptions>;

  constructor(options?: ParserOptions) {
    this.config = {
      maxRetries: options?.maxRetries ?? 3,
      enableSelfHealing: options?.enableSelfHealing ?? false,
      fallbackToPartial: options?.fallbackToPartial ?? true,
      strictValidation: options?.strictValidation ?? false,
      logAllAttempts: options?.logAllAttempts ?? true,
    };
  }

  async parse(rawResponse: string, providerName: string = 'unknown'): Promise<LLMResponse> {
    const attempts: ParseAttempt[] = [];

    if (!rawResponse || rawResponse.trim().length === 0) {
      return this.createErrorResponse('EMPTY_RESPONSE', 'Empty response');
    }

    // STAGE 1: Direct JSON parse
    const directAttempt = this.attemptDirectParse(rawResponse);
    attempts.push(directAttempt);
    if (directAttempt.success) {
      return this.finalizeResponse(directAttempt.result, ParseConfidence.HIGH, 'direct_json');
    }

    // STAGE 2: Regex extraction
    const regexAttempt = this.attemptRegexExtraction(rawResponse);
    attempts.push(regexAttempt);
    if (regexAttempt.success) {
      return this.finalizeResponse(regexAttempt.result, ParseConfidence.HIGH, 'regex');
    }

    // STAGE 3: Partial extraction
    if (this.config.fallbackToPartial) {
      const partialAttempt = this.attemptPartialExtraction(rawResponse);
      attempts.push(partialAttempt);
      if (partialAttempt.success) {
        return this.finalizeResponse(partialAttempt.result, ParseConfidence.LOW, 'partial');
      }
    }

    return this.createErrorResponse('PARSE_FAILED', 'Parsing failed');
  }

  private attemptDirectParse(text: string): ParseAttempt {
    try {
      const parsed = JSON.parse(text);
      return this.processParsedJson(parsed, 'direct_json');
    } catch (error: any) {
      return { method: 'direct_json', success: false, error: error.message, timestamp: new Date() };
    }
  }

  private attemptRegexExtraction(text: string): ParseAttempt {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { method: 'regex', success: false, error: 'No JSON found', timestamp: new Date() };
      const parsed = JSON.parse(jsonMatch[0]);
      return this.processParsedJson(parsed, 'regex');
    } catch (error: any) {
      return { method: 'regex', success: false, error: error.message, timestamp: new Date() };
    }
  }

  private attemptPartialExtraction(text: string): ParseAttempt {
    let shortAnswer: string | undefined;
    const shortAnswerPatterns = [/"shortAnswer"\s*:\s*"([^"]*)"/, /"answer"\s*:\s*"([^"]*)"/];
    
    for (const pattern of shortAnswerPatterns) {
      const match = text.match(pattern);
      if (match) {
        shortAnswer = match[1];
        break;
      }
    }

    if (shortAnswer) {
      return {
        method: 'partial',
        success: true,
        result: { shortAnswer },
        timestamp: new Date(),
      };
    }

    return { method: 'partial', success: false, error: 'No partial data', timestamp: new Date() };
  }

  private processParsedJson(parsed: any, method: string): ParseAttempt {
    let shortAnswer: string = 'No answer';
    let solvelyResponse: any = undefined;

    // CHECK FOR NEW SOLVELY FORMAT
    if (parsed.questions && Array.isArray(parsed.questions)) {
      solvelyResponse = {
        questions: parsed.questions,
        main_explanation: parsed.main_explanation
      };
      
      // Construct a summary shortAnswer from the first question or all questions
      if (parsed.questions.length === 1) {
        shortAnswer = parsed.questions[0].final_answer;
      } else {
        shortAnswer = parsed.questions.map((q: any) => `${q.id}. ${q.final_answer}`).join('\n');
      }

      return {
        method,
        success: true,
        result: {
          shortAnswer,
          questionType: 'MULTI_QUESTION',
          structuredAnswer: parsed, // Keep original for reference
          solvelyResponse
        },
        timestamp: new Date()
      };
    }

    // FALLBACK TO OLD FORMAT LOGIC
    if (parsed.shortAnswer || parsed.answer) {
      shortAnswer = String(parsed.shortAnswer || parsed.answer);
    } else if (parsed.content && typeof parsed.content === 'object') {
       // Fallback: try to construct shortAnswer from content
       if (parsed.content.text) shortAnswer = parsed.content.text;
       else if (parsed.content.choice) shortAnswer = parsed.content.choice;
       else if (parsed.content.value !== undefined) shortAnswer = String(parsed.content.value);
       else if (parsed.content.code) shortAnswer = parsed.content.code;
       else return { method, success: false, error: 'Missing shortAnswer', timestamp: new Date() };
    } else {
      return { method, success: false, error: 'Missing shortAnswer', timestamp: new Date() };
    }

    // Convert old format to SolvelyResponse for consistent UI
    solvelyResponse = {
      questions: [{
        id: "1",
        task_summary: parsed.questionType || "Solve the problem",
        final_answer: shortAnswer,
        steps: parsed.explanation ? [{
          step_title: "Explanation",
          step_detail: parsed.explanation
        }] : []
      }]
    };

    return {
      method,
      success: true,
      result: { 
        shortAnswer,
        questionType: parsed.questionType || parsed.type,
        structuredAnswer: parsed,
        solvelyResponse
      },
      timestamp: new Date(),
    };
  }

  private finalizeResponse(result: any, confidence: ParseConfidence, method: string): LLMResponse {
    return {
      shortAnswer: result.shortAnswer,
      questionType: result.questionType,
      structuredAnswer: result.structuredAnswer,
      solvelyResponse: result.solvelyResponse,
      confidence,
      parseMethod: method,
    };
  }

  private createErrorResponse(errorCode: string, errorMessage: string): LLMResponse {
    return {
      shortAnswer: `Error: ${errorMessage}`,
      error: errorCode,
      confidence: ParseConfidence.FAILED,
      parseMethod: 'none',
    };
  }
}
