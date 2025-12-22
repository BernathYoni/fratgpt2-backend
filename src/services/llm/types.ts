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

// Enhanced LLM response with metadata
export interface LLMResponse {
  shortAnswer: string;
  tokensUsed?: number; // Deprecated: use tokenUsage instead

  // Token usage details
  tokenUsage?: TokenUsage;

  // Parse metadata
  confidence?: ParseConfidence;
  parseMethod?: string;
  parseAttempts?: ParseAttempt[];
  warnings?: string[];
  partialFailure?: boolean;
  error?: string;

  // Structured answer fields
  questionType?: string; // Deprecated but kept for compatibility
  structuredAnswer?: any;
  steps?: Array<{ title: string; content: string }>; // New field for step-by-step logic
}

export interface LLMProvider {
  name: string;
  generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
  generateStream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<string | TokenUsage>;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  requestId?: string; // For tracking parallel requests in EXPERT mode
  mode?: 'FAST' | 'REGULAR' | 'EXPERT'; // To help providers select the right model
}

// Parser configuration
export interface ParserOptions {
  maxRetries?: number;              // Default: 3
  enableSelfHealing?: boolean;      // Default: true
  fallbackToPartial?: boolean;      // Default: true
  strictValidation?: boolean;       // Default: false
  logAllAttempts?: boolean;         // Default: true
}
