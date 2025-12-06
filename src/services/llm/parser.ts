import { LLMResponse, ParseConfidence, ParseAttempt, ParserOptions, AnswerType } from './types';

/**
 * Expert-level multi-stage parser for LLM responses with performance timing
 * Implements various parsing strategies with graceful degradation
 */
export class ExpertParser {
  private config: Required<ParserOptions>;

  constructor(options?: ParserOptions) {
    this.config = {
      maxRetries: options?.maxRetries ?? 3,
      enableSelfHealing: options?.enableSelfHealing ?? false, // Disabled by default (no circular dependency)
      fallbackToPartial: options?.fallbackToPartial ?? true,
      strictValidation: options?.strictValidation ?? false,
      logAllAttempts: options?.logAllAttempts ?? true,
    };
  }

  /**
   * Main entry point: Parse raw LLM response with cascading strategies
   */
  async parse(rawResponse: string, providerName: string = 'unknown'): Promise<LLMResponse> {
    const parseStartTime = Date.now(); // ⏱️ Track total parse time
    const attempts: ParseAttempt[] = [];

    console.log(`[PARSER:${providerName.toUpperCase()}] 🔍 Starting multi-stage parse`);
    console.log(`[PARSER:${providerName.toUpperCase()}] Raw response length: ${rawResponse.length}`);

    // STAGE 0: Check for empty response
    if (!rawResponse || rawResponse.trim().length === 0) {
      return this.createErrorResponse('EMPTY_RESPONSE', 'The AI returned an empty response', attempts);
    }

    // Attempt parsing through various strategies
    const strategies = [
      this.attemptDirectParse.bind(this),
      this.attemptCleanupParse.bind(this),
      this.attemptRegexExtraction.bind(this),
    ];

    for (const strategy of strategies) {
      const stageStart = Date.now();
      const attempt = strategy(rawResponse);
      attempts.push(attempt);
      console.log(`[PARSER:${providerName.toUpperCase()}] ⏱️  Stage (${attempt.method}): ${Date.now() - stageStart}ms`);
      if (attempt.success) {
        const totalTime = Date.now() - parseStartTime;
        console.log(`[PARSER:${providerName.toUpperCase()}] ✅ SUCCESS via ${attempt.method} (${totalTime}ms total)`);
        return this.finalizeResponse(attempt.result, ParseConfidence.HIGH, attempt.method, attempts);
      }
    }

    // STAGE Fallback: Partial extraction (if enabled and all other strategies failed)
    if (this.config.fallbackToPartial) {
      const stageStart = Date.now();
      const partialAttempt = this.attemptPartialExtraction(rawResponse);
      attempts.push(partialAttempt);
      console.log(`[PARSER:${providerName.toUpperCase()}] ⏱️  Stage (partial): ${Date.now() - stageStart}ms`);
      if (partialAttempt.success) {
        const totalTime = Date.now() - parseStartTime;
        console.warn(`[PARSER:${providerName.toUpperCase()}] ⚠️  PARTIAL SUCCESS via extraction (${totalTime}ms total)`);
        return this.finalizeResponse(partialAttempt.result, ParseConfidence.LOW, 'partial', attempts);
      }
    }

    // All parsing failed - return structured error
    const totalTime = Date.now() - parseStartTime;
    console.error(`[PARSER:${providerName.toUpperCase()}] ❌ All parsing strategies failed (${totalTime}ms wasted)`);
    return this.createErrorResponse('PARSE_FAILED', 'Could not parse AI response after multiple attempts', attempts);
  }

  /**
   * Strategy: Direct JSON.parse()
   */
  private attemptDirectParse(text: string): ParseAttempt {
    try {
      const parsed = JSON.parse(text);
      return this.processParsedJson(parsed, 'direct_json');
    } catch (error: any) {
      return { method: 'direct_json', success: false, error: error.message, timestamp: new Date() };
    }
  }

  /**
   * Strategy: Cleanup text and retry
   */
  private attemptCleanupParse(text: string): ParseAttempt {
    try {
      let cleaned = this.removeMarkdownCodeBlocks(text);
      cleaned = this.fixCommonJSONIssues(cleaned);
      const extracted = this.extractJSONSubstring(cleaned);
      
      if (!extracted) {
        return { method: 'cleanup', success: false, error: 'Could not extract JSON after cleanup', timestamp: new Date() };
      }

      const parsed = JSON.parse(extracted);
      return this.processParsedJson(parsed, 'cleanup', ['Applied text cleanup']);
    } catch (error: any) {
      return { method: 'cleanup', success: false, error: error.message, timestamp: new Date() };
    }
  }

  /**
   * Strategy: Regex extraction - find first {...}
   */
  private attemptRegexExtraction(text: string): ParseAttempt {
    try {
      // Prioritize extracting a valid JSON object
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { method: 'regex', success: false, error: 'No JSON object found in response', timestamp: new Date() };
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return this.processParsedJson(parsed, 'regex');
    } catch (error: any) {
      return { method: 'regex', success: false, error: error.message, timestamp: new Date() };
    }
  }

  /**
   * Strategy: Partial extraction (V1 fallback logic for now)
   * This is a last resort to get some information out.
   */
  private attemptPartialExtraction(text: string): ParseAttempt {
    const warnings: string[] = [];
    let shortAnswer: string | undefined;
    let steps: string[] | undefined;
    let type: AnswerType = 'UNKNOWN';
    let content: any = { text: 'Unable to extract content' };

    // Try to extract V2 type and content first
    const typeMatch = text.match(/"type"\s*:\s*"([^"]*)"/);
    if (typeMatch) {
      type = typeMatch[1] as AnswerType;
      warnings.push(`Extracted type: ${type}`);
    }
    const contentMatch = text.match(/"content"\s*:\s*(\{[\s\S]*?\})/);
    if (contentMatch) {
      try {
        content = JSON.parse(contentMatch[1]);
        warnings.push('Extracted content object');
      } catch {/* ignore */}
    }

    // Try to extract V1 shortAnswer if V2 content is not strong
    if (!content.text && !content.choice && !content.value && !content.code) {
        const shortAnswerPatterns = ["shortAnswer"\s*:\s*"([^"]*)", /"answer"\s*:\s*"([^"]*)"/];
        for (const pattern of shortAnswerPatterns) {
          const match = text.match(pattern);
          if (match) {
            shortAnswer = match[1];
            warnings.push('Extracted shortAnswer via regex');
            break;
          }
        }
    }
    
    // Try to extract steps array
    const stepsMatch = text.match(/"steps"\s*:\s*\[([\s\S]*?)\]/);
    if (stepsMatch) {
      try {
        const stepsText = stepsMatch[1];
        steps = stepsText.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(s => s.length > 0);
        if (steps.length > 0) warnings.push('Extracted steps via regex');
      } catch { /* ignore */ }
    }

    // If we got anything useful
    if (type !== 'UNKNOWN' || shortAnswer || steps) {
      return {
        method: 'partial',
        success: true,
        result: {
          type: type,
          content: content,
          shortAnswer: shortAnswer || this.getV2ShortAnswer(type, content), // Fallback to getV2ShortAnswer
          steps: steps || ['Unable to extract detailed steps'],
          warnings,
          partialFailure: true,
        },
        timestamp: new Date(),
      };
    }

    return { method: 'partial', success: false, error: 'Could not extract any valid data', timestamp: new Date() };
  }

  /**
   * Core processing logic: Validates and coerces parsed JSON into LLMResponse format.
   * This function now intelligently handles both V1 and V2 structures.
   */
  private processParsedJson(parsed: any, method: string, extraWarnings: string[] = []): ParseAttempt {
    const warnings = [...extraWarnings];
    let result: Partial<LLMResponse> = {}; // Use Partial to build the response

    // Prioritize V2 structure
    if (parsed.type && typeof parsed.type === 'string' && parsed.content && typeof parsed.content === 'object') {
      const answerType: AnswerType = parsed.type as AnswerType;
      result.type = answerType;
      result.content = parsed.content;
      result.steps = Array.isArray(parsed.steps) ? parsed.steps : [];
      result.confidence = parsed.confidence;
      result.debug_raw_answer = parsed.debug_raw_answer;
      result.shortAnswer = parsed.debug_raw_answer || this.getV2ShortAnswer(answerType, parsed.content);
      warnings.push('Parsed as V2 structured response');
    } 
    // Fallback to V1 structure
    else if (parsed.shortAnswer !== undefined || parsed.answer !== undefined) {
      result.shortAnswer = String(parsed.shortAnswer || parsed.answer || 'No short answer provided');
      result.steps = Array.isArray(parsed.steps) 
        ? parsed.steps.map((s: any) => String(s)).filter((s: string) => s.length > 0)
        : (parsed.explanation && Array.isArray(parsed.explanation) ? parsed.explanation.map((s: any) => String(s)) : []);
      if (result.steps.length === 0 && (parsed.steps || parsed.explanation)) {
         result.steps = ['No detailed steps provided'];
         warnings.push('Steps array was empty or malformed in V1 fallback');
      }
      warnings.push('Parsed as V1 fallback response');
    } else {
      return { method, success: false, error: 'Unknown JSON structure, neither V1 nor V2 recognized', timestamp: new Date() };
    }

    // Normalize steps - ensure it's always an array of strings
    if (!Array.isArray(result.steps)) {
      result.steps = [];
      warnings.push('Steps was not an array, set to empty');
    } else {
      result.steps = result.steps.map(s => String(s)).filter(s => s.length > 0);
    }
    
    // Ensure shortAnswer is always a string
    if (typeof result.shortAnswer !== 'string') {
        result.shortAnswer = String(result.shortAnswer || 'Unknown Answer');
        warnings.push('shortAnswer was coerced to string');
    }

    // Assign warnings
    result.warnings = warnings;

    // Final validation and coercion
    return { method, success: true, result: this.coerceFinalResponse(result as LLMResponse), timestamp: new Date() };
  }

  /**
   * Helper to ensure the final LLMResponse conforms to the interface
   */
  private coerceFinalResponse(response: LLMResponse): LLMResponse {
    return {
      shortAnswer: response.shortAnswer || 'No answer provided',
      steps: response.steps || [],
      type: response.type || 'UNKNOWN',
      content: response.content || {},
      confidence: response.confidence || ParseConfidence.FAILED,
      debug_raw_answer: response.debug_raw_answer,
      tokenUsage: response.tokenUsage,
      parseMethod: response.parseMethod,
      parseAttempts: response.parseAttempts,
      warnings: response.warnings,
      partialFailure: response.partialFailure,
      error: response.error,
    };
  }

  /**
   * Helper to generate a string fallback for V2 answers
   */
  private getV2ShortAnswer(type: AnswerType, content: any): string {
    switch (type) {
      case 'MULTIPLE_CHOICE': return content.choice ? `Choice: ${content.choice}` : 'Unknown Choice';
      case 'TRUE_FALSE': return content.value !== undefined ? `Value: ${String(content.value).toUpperCase()}` : 'Unknown Value';
      case 'FILL_IN_THE_BLANK':
      case 'SHORT_ANSWER': return content.text || 'No answer text';
      case 'CODING': return 'Code provided (see details)';
      case 'UNKNOWN': return content.text || 'Unknown Answer Type';
      default: return 'See details';
    }
  }

  /**
   * Finalize response with metadata
   */
  private finalizeResponse(
    result: Partial<LLMResponse>, // Accept partial response
    confidence: ParseConfidence,
    method: string,
    attempts: ParseAttempt[]
  ): LLMResponse {
    const finalResult = this.coerceFinalResponse(result as LLMResponse);
    finalResult.confidence = confidence;
    finalResult.parseMethod = method;
    finalResult.parseAttempts = this.config.logAllAttempts ? attempts : undefined;
    // Warnings are already part of result.warnings
    return finalResult;
  }

  /**
   * Create structured error response
   */
  private createErrorResponse(errorCode: string, errorMessage: string, attempts: ParseAttempt[]): LLMResponse {
    return {
      shortAnswer: `Error: ${errorMessage}`,
      steps: [
        'The AI returned an unparseable response',
        'Please try again with a different question or mode',
        `Error code: ${errorCode}`,
      ],
      type: 'UNKNOWN', // Default to UNKNOWN on error
      content: { text: errorMessage },
      confidence: ParseConfidence.FAILED,
      parseMethod: 'none',
      parseAttempts: this.config.logAllAttempts ? attempts : undefined,
      error: errorCode,
    };
  }

  // --- TEXT CLEANING UTILITIES ---

  /**
   * Remove markdown code blocks (```json...``` or ```...```)
   */
  private removeMarkdownCodeBlocks(text: string): string {
    return text.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1');
  }

  /**
   * Fix common JSON issues like trailing commas or comments.
   */
  private fixCommonJSONIssues(text: string): string {
    let fixed = text;
    fixed = fixed.replace(/,(\s*[\}\]])/g, '$1'); // Remove trailing commas
    fixed = fixed.replace(/\/\/.*$/gm, ''); // Remove single-line comments
    fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments
    fixed = fixed.replace(/'/g, '"'); // Convert single quotes to double quotes (common LLM mistake)
    return fixed;
  }

  /**
   * Extracts the outermost JSON object from a string, handling nested braces.
   * This is a robust way to find JSON even with surrounding text.
   */
  private extractJSONSubstring(text: string): string | null {
    const firstBrace = text.indexOf('{');
    if (firstBrace === -1) return null;

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = firstBrace; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      // Toggle inString state only if not escaped
      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') depth--;

        if (depth === 0) {
          return text.substring(firstBrace, i + 1);
        }
      }
    }
    // If we reach here, braces are unbalanced or string is not properly closed
    return null;
  }
}
