import { LLMResponse, ParseConfidence, ParseAttempt, ParserOptions } from './types';

/**
 * Expert-level multi-stage parser for LLM responses with performance timing
 * Implements 6 parsing strategies with graceful degradation
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
    console.log(`[PARSER:${providerName.toUpperCase()}] Raw response type: ${typeof rawResponse}`);

    // STAGE 0: Check for empty response
    if (!rawResponse || rawResponse.trim().length === 0) {
      console.error(`[PARSER:${providerName.toUpperCase()}] ❌❌❌ EMPTY RESPONSE DETECTED ❌❌❌`);
      console.error(`[PARSER:${providerName.toUpperCase()}] rawResponse value: "${rawResponse}"`);
      console.error(`[PARSER:${providerName.toUpperCase()}] rawResponse type: ${typeof rawResponse}`);
      console.error(`[PARSER:${providerName.toUpperCase()}] rawResponse is null: ${rawResponse === null}`);
      console.error(`[PARSER:${providerName.toUpperCase()}] rawResponse is undefined: ${rawResponse === undefined}`);
      console.error(`[PARSER:${providerName.toUpperCase()}] rawResponse length: ${rawResponse?.length ?? 'N/A'}`);
      console.error(`[PARSER:${providerName.toUpperCase()}] ⚠️  POSSIBLE CAUSES:`);
      console.error(`[PARSER:${providerName.toUpperCase()}]    1. API quota/rate limit exceeded`);
      console.error(`[PARSER:${providerName.toUpperCase()}]    2. Content policy violation (safety filter)`);
      console.error(`[PARSER:${providerName.toUpperCase()}]    3. Image too large or corrupted`);
      console.error(`[PARSER:${providerName.toUpperCase()}]    4. API key invalid or expired`);
      console.error(`[PARSER:${providerName.toUpperCase()}]    5. Network timeout during generation`);
      console.error(`[PARSER:${providerName.toUpperCase()}]    6. Provider API error (check logs above)`);
      return this.createErrorResponse('EMPTY_RESPONSE', 'The AI returned an empty response', attempts);
    }

    // STAGE 1: Direct JSON parse
    let stageStart = Date.now();
    const directAttempt = this.attemptDirectParse(rawResponse);
    attempts.push(directAttempt);
    console.log(`[PARSER:${providerName.toUpperCase()}] ⏱️  Stage 1 (direct parse): ${Date.now() - stageStart}ms`);
    if (directAttempt.success) {
      const totalTime = Date.now() - parseStartTime;
      console.log(`[PARSER:${providerName.toUpperCase()}] ✅ SUCCESS via direct parse (${totalTime}ms total)`);
      return this.finalizeResponse(directAttempt.result, ParseConfidence.HIGH, 'direct_json', attempts);
    }

    // STAGE 2: Regex extraction
    stageStart = Date.now();
    const regexAttempt = this.attemptRegexExtraction(rawResponse);
    attempts.push(regexAttempt);
    console.log(`[PARSER:${providerName.toUpperCase()}] ⏱️  Stage 2 (regex): ${Date.now() - stageStart}ms`);
    if (regexAttempt.success) {
      const totalTime = Date.now() - parseStartTime;
      console.log(`[PARSER:${providerName.toUpperCase()}] ✅ SUCCESS via regex extraction (${totalTime}ms total)`);
      return this.finalizeResponse(regexAttempt.result, ParseConfidence.HIGH, 'regex', attempts);
    }

    // STAGE 3: Cleanup and retry
    stageStart = Date.now();
    const cleanupAttempt = this.attemptCleanupParse(rawResponse);
    attempts.push(cleanupAttempt);
    console.log(`[PARSER:${providerName.toUpperCase()}] ⏱️  Stage 3 (cleanup): ${Date.now() - stageStart}ms`);
    if (cleanupAttempt.success) {
      const totalTime = Date.now() - parseStartTime;
      console.log(`[PARSER:${providerName.toUpperCase()}] ✅ SUCCESS via cleanup parse (${totalTime}ms total)`);
      return this.finalizeResponse(cleanupAttempt.result, ParseConfidence.MEDIUM, 'cleanup', attempts);
    }

    // STAGE 4: Aggressive extraction
    stageStart = Date.now();
    const aggressiveAttempt = this.attemptAggressiveExtraction(rawResponse);
    attempts.push(aggressiveAttempt);
    console.log(`[PARSER:${providerName.toUpperCase()}] ⏱️  Stage 4 (aggressive): ${Date.now() - stageStart}ms`);
    if (aggressiveAttempt.success) {
      const totalTime = Date.now() - parseStartTime;
      console.log(`[PARSER:${providerName.toUpperCase()}] ✅ SUCCESS via aggressive extraction (${totalTime}ms total)`);
      return this.finalizeResponse(aggressiveAttempt.result, ParseConfidence.MEDIUM, 'aggressive', attempts);
    }

    // STAGE 5: Partial extraction (if enabled)
    if (this.config.fallbackToPartial) {
      stageStart = Date.now();
      const partialAttempt = this.attemptPartialExtraction(rawResponse);
      attempts.push(partialAttempt);
      console.log(`[PARSER:${providerName.toUpperCase()}] ⏱️  Stage 5 (partial): ${Date.now() - stageStart}ms`);
      if (partialAttempt.success) {
        const totalTime = Date.now() - parseStartTime;
        console.warn(`[PARSER:${providerName.toUpperCase()}] ⚠️  PARTIAL SUCCESS via extraction (${totalTime}ms total)`);
        return this.finalizeResponse(partialAttempt.result, ParseConfidence.LOW, 'partial', attempts);
      }
    }

    // STAGE 6: All parsing failed - return structured error
    const totalTime = Date.now() - parseStartTime;
    console.error(`[PARSER:${providerName.toUpperCase()}] ❌ All parsing strategies failed (${totalTime}ms wasted)`);
    return this.createErrorResponse('PARSE_FAILED', 'Could not parse AI response after multiple attempts', attempts);
  }

  /**
   * STRATEGY 1: Direct JSON.parse()
   */
  private attemptDirectParse(text: string): ParseAttempt {
    try {
      const parsed = JSON.parse(text);
      const validation = this.validateResponse(parsed);

      if (validation.valid || !this.config.strictValidation) {
        return {
          method: 'direct_json',
          success: true,
          result: this.coerceToValidFormat(parsed, validation.warnings),
          timestamp: new Date(),
        };
      }

      return {
        method: 'direct_json',
        success: false,
        error: `Validation failed: ${validation.warnings.join(', ')}`,
        timestamp: new Date(),
      };
    } catch (error: any) {
      return {
        method: 'direct_json',
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * STRATEGY 2: Regex extraction - find first {...}
   */
  private attemptRegexExtraction(text: string): ParseAttempt {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          method: 'regex',
          success: false,
          error: 'No JSON object found in response',
          timestamp: new Date(),
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const validation = this.validateResponse(parsed);

      if (validation.valid || !this.config.strictValidation) {
        return {
          method: 'regex',
          success: true,
          result: this.coerceToValidFormat(parsed, validation.warnings),
          timestamp: new Date(),
        };
      }

      return {
        method: 'regex',
        success: false,
        error: `Validation failed: ${validation.warnings.join(', ')}`,
        timestamp: new Date(),
      };
    } catch (error: any) {
      return {
        method: 'regex',
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * STRATEGY 3: Cleanup text and retry
   */
  private attemptCleanupParse(text: string): ParseAttempt {
    try {
      let cleaned = text;

      // Remove markdown code blocks
      cleaned = this.removeMarkdownCodeBlocks(cleaned);

      // Fix common JSON issues
      cleaned = this.fixCommonJSONIssues(cleaned);

      // Extract JSON substring
      const extracted = this.extractJSONSubstring(cleaned);
      if (!extracted) {
        return {
          method: 'cleanup',
          success: false,
          error: 'Could not extract JSON after cleanup',
          timestamp: new Date(),
        };
      }

      const parsed = JSON.parse(extracted);
      const validation = this.validateResponse(parsed);

      if (validation.valid || !this.config.strictValidation) {
        const warnings = ['Applied text cleanup and fixes', ...validation.warnings];
        return {
          method: 'cleanup',
          success: true,
          result: this.coerceToValidFormat(parsed, warnings),
          timestamp: new Date(),
        };
      }

      return {
        method: 'cleanup',
        success: false,
        error: `Validation failed: ${validation.warnings.join(', ')}`,
        timestamp: new Date(),
      };
    } catch (error: any) {
      return {
        method: 'cleanup',
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * STRATEGY 4: Aggressive extraction - try multiple patterns
   */
  private attemptAggressiveExtraction(text: string): ParseAttempt {
    const patterns = [
      /\{[\s\S]*?"shortAnswer"[\s\S]*?"steps"[\s\S]*?\}/,  // Find JSON with both required fields
      /\{[\s\S]*?"steps"[\s\S]*?"shortAnswer"[\s\S]*?\}/,  // Reverse order
      /\{[^}]*"shortAnswer"[^}]*\}/,                        // Just shortAnswer
    ];

    for (const pattern of patterns) {
      try {
        const match = text.match(pattern);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const validation = this.validateResponse(parsed);

          if (validation.valid || !this.config.strictValidation) {
            const warnings = ['Used aggressive pattern matching', ...validation.warnings];
            return {
              method: 'aggressive',
              success: true,
              result: this.coerceToValidFormat(parsed, warnings),
              timestamp: new Date(),
            };
          }
        }
      } catch {
        continue;
      }
    }

    return {
      method: 'aggressive',
      success: false,
      error: 'No valid JSON found with any pattern',
      timestamp: new Date(),
    };
  }

  /**
   * STRATEGY 5: Partial extraction - extract what we can
   */
  private attemptPartialExtraction(text: string): ParseAttempt {
    const warnings: string[] = [];
    let shortAnswer: string | undefined;
    let steps: string[] | undefined;

    // Try to extract shortAnswer
    const shortAnswerPatterns = [
      /"shortAnswer"\s*:\s*"([^"]*)"/,
      /"answer"\s*:\s*"([^"]*)"/,
      /"result"\s*:\s*"([^"]*)"/,
    ];

    for (const pattern of shortAnswerPatterns) {
      const match = text.match(pattern);
      if (match) {
        shortAnswer = match[1];
        warnings.push('Extracted shortAnswer from malformed JSON');
        break;
      }
    }

    // Try to extract steps array
    const stepsMatch = text.match(/"steps"\s*:\s*\[([\s\S]*?)\]/);
    if (stepsMatch) {
      try {
        const stepsText = stepsMatch[1];
        steps = stepsText
          .split(',')
          .map((s: string) => s.trim().replace(/^["']|["']$/g, ''))
          .filter((s: string) => s.length > 0 && s !== 'null' && s !== 'undefined');

        if (steps.length > 0) {
          warnings.push('Extracted steps from malformed JSON');
        } else {
          steps = undefined;
        }
      } catch {
        steps = undefined;
      }
    }

    // Check if we got anything useful
    if (shortAnswer || steps) {
      return {
        method: 'partial',
        success: true,
        result: {
          shortAnswer: shortAnswer || 'Unable to extract answer',
          steps: steps || ['Unable to extract detailed steps'],
          warnings,
          partialFailure: true,
        },
        timestamp: new Date(),
      };
    }

    return {
      method: 'partial',
      success: false,
      error: 'Could not extract any valid data',
      timestamp: new Date(),
    };
  }

  /**
   * Validate parsed response structure
   */
  private validateResponse(parsed: any): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    if (!parsed || typeof parsed !== 'object') {
      warnings.push('Response is not an object');
      return { valid: false, warnings };
    }

    if (!parsed.shortAnswer && !parsed.answer && !parsed.result) {
      warnings.push('Missing shortAnswer field');
    }

    if (!parsed.steps && !parsed.explanation) {
      warnings.push('Missing steps array');
    } else if (parsed.steps && !Array.isArray(parsed.steps)) {
      warnings.push('steps is not an array');
    } else if (parsed.steps && parsed.steps.length === 0) {
      warnings.push('steps array is empty');
    }

    return { valid: warnings.length === 0, warnings };
  }

  /**
   * Coerce parsed response to valid format
   */
  private coerceToValidFormat(parsed: any, existingWarnings: string[] = []): any {
    const warnings = [...existingWarnings];

    // Coerce shortAnswer
    let shortAnswer: string;
    if (typeof parsed.shortAnswer === 'string') {
      shortAnswer = parsed.shortAnswer;
    } else if (parsed.shortAnswer !== undefined) {
      shortAnswer = String(parsed.shortAnswer);
      warnings.push('shortAnswer was coerced to string');
    } else if (parsed.answer) {
      shortAnswer = String(parsed.answer);
      warnings.push('Used "answer" field instead of "shortAnswer"');
    } else if (parsed.result) {
      shortAnswer = String(parsed.result);
      warnings.push('Used "result" field instead of "shortAnswer"');
    } else {
      shortAnswer = 'No answer provided';
      warnings.push('shortAnswer was missing');
    }

    // Coerce steps
    let steps: string[];
    if (Array.isArray(parsed.steps)) {
      steps = parsed.steps
        .map((s: any) => (typeof s === 'string' ? s : String(s)))
        .filter((s: string) => s.length > 0 && s !== 'null' && s !== 'undefined');

      if (steps.length === 0) {
        steps = ['No steps provided'];
        warnings.push('steps array was empty');
      }
    } else if (parsed.steps) {
      steps = [String(parsed.steps)];
      warnings.push('steps was not an array, converted to single-item array');
    } else if (parsed.explanation) {
      steps = Array.isArray(parsed.explanation)
        ? parsed.explanation.map((e: any) => String(e))
        : [String(parsed.explanation)];
      warnings.push('Used "explanation" field instead of "steps"');
    } else {
      steps = ['No steps provided'];
      warnings.push('steps was missing');
    }

    return {
      shortAnswer,
      steps,
      warnings,
    };
  }

  /**
   * Finalize response with metadata
   */
  private finalizeResponse(
    result: any,
    confidence: ParseConfidence,
    method: string,
    attempts: ParseAttempt[]
  ): LLMResponse {
    return {
      shortAnswer: result.shortAnswer,
      steps: result.steps,
      confidence,
      parseMethod: method,
      parseAttempts: this.config.logAllAttempts ? attempts : undefined,
      warnings: result.warnings,
      partialFailure: result.partialFailure,
    };
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
      error: errorCode,
      confidence: ParseConfidence.FAILED,
      parseMethod: 'none',
      parseAttempts: this.config.logAllAttempts ? attempts : undefined,
    };
  }

  // ============================================================================
  // TEXT CLEANING UTILITIES
  // ============================================================================

  /**
   * Remove markdown code blocks
   */
  private removeMarkdownCodeBlocks(text: string): string {
    return text.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1');
  }

  /**
   * Fix common JSON issues
   */
  private fixCommonJSONIssues(text: string): string {
    let fixed = text;

    // Remove trailing commas before closing braces/brackets
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

    // Remove comments (// and /* */)
    fixed = fixed.replace(/\/\/.*$/gm, '');
    fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');

    // Fix common typos
    fixed = fixed.replace(/'/g, '"'); // Single quotes to double quotes (risky but common)

    return fixed;
  }

  /**
   * Extract JSON substring with balanced braces
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

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') depth++;
        if (char === '}') depth--;

        if (depth === 0) {
          return text.substring(firstBrace, i + 1);
        }
      }
    }

    return null;
  }
}
