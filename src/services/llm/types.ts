export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  imageData?: string; // base64 encoded
}

export interface LLMResponse {
  shortAnswer: string;
  explanation: string;
  tokensUsed?: number;
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
