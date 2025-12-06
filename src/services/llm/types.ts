export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  imageData?: string; // base64 encoded
}

// Parsing confidence levels
export enum ParseConfidence {
  HIGH = 0.9,      // Direct JSON parse success
  MEDIUM = 0.7,    // Regex extraction worked
  LOW = 0.5,       // Self-healing worked
  FAILED = 0.0     // All attempts failed
}

// Parse attempt result
export interface ParseAttempt {
  method: string;           // 'direct_json', 'regex', 'cleanup', 'self_heal', etc.
  success: boolean;
  error?: string;
  result?: any;
  timestamp: Date;
}

// Token usage breakdown
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  thinkingTokens?: number; // Claude-specific: extended thinking tokens
}

// Answer Types for V2
export type AnswerType = 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'FILL_IN_THE_BLANK' | 'SHORT_ANSWER' | 'CODING' | 'UNKNOWN';

// Enhanced LLM response with metadata
export interface LLMResponse {
  shortAnswer: string;
  steps: string[];
  tokensUsed?: number; // Deprecated: use tokenUsage instead

  // V2 Structured Data
  type?: AnswerType;
  content?: {
    choice?: string;
    value?: boolean;
    text?: string;
    code?: string;
  };
  debug_raw_answer?: string;

  // Token usage details
  tokenUsage?: TokenUsage;

  // Parse metadata
  confidence?: ParseConfidence | number;
  parseMethod?: string;
  parseAttempts?: ParseAttempt[];
  warnings?: string[];
  partialFailure?: boolean;
  error?: string;
}

export interface LLMProvider {
  name: string;
  generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  requestId?: string; // For tracking parallel requests in EXPERT mode
  mode?: 'FAST' | 'REGULAR' | 'EXPERT'; // To help providers select the right model
  v2?: boolean; // Feature flag for V2 redesign
}

// Parser configuration
export interface ParserOptions {
  maxRetries?: number;              // Default: 3
  enableSelfHealing?: boolean;      // Default: true
  fallbackToPartial?: boolean;      // Default: true
  strictValidation?: boolean;       // Default: false
  logAllAttempts?: boolean;         // Default: true
}