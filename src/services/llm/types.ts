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

// Enhanced LLM response with metadata
export interface LLMResponse {
  shortAnswer: string;
  steps: string[];
  tokensUsed?: number;

  // Parse metadata
  confidence?: ParseConfidence;
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
}

// Parser configuration
export interface ParserOptions {
  maxRetries?: number;              // Default: 3
  enableSelfHealing?: boolean;      // Default: true
  fallbackToPartial?: boolean;      // Default: true
  strictValidation?: boolean;       // Default: false
  logAllAttempts?: boolean;         // Default: true
}
