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

// SOLVELY-STYLE INTERFACES
export interface SolveStep {
  step_title: string;  // e.g., "Isolate the variable x"
  step_detail: string; // e.g., "Dividing both sides by 3 gives $x = 5$" (LaTeX supported)
}

export interface IdentifiedQuestion {
  id: string;          // "1", "2", "a", "b", or "Q1" - matches source image
  task_summary: string;// "Solve the linear equation for x"
  final_answer: string;// "x = 5" or "7.5" - Simplest form
  steps: SolveStep[];  // Array of steps to solve this specific question
}

export interface SolvelyResponse {
  questions: IdentifiedQuestion[]; 
  main_explanation?: string; // Optional general context if needed
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
  questionType?: string;
  structuredAnswer?: any; // Kept for backward compatibility
  solvelyResponse?: SolvelyResponse; // NEW: The specific multi-question structure
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
