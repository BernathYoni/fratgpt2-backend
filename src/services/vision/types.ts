/**
 * Vision Analysis Types
 * Used for region detection and question identification
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QuestionComponent {
  questionText?: BoundingBox;
  chart?: BoundingBox;
  table?: BoundingBox;
  diagram?: BoundingBox;
  options?: Array<{
    box: BoundingBox;
    label: string; // 'A', 'B', 'C', 'D', 'E'
  }>;
  fillInBlanks?: Array<{
    box: BoundingBox;
    position: number; // 1, 2, 3...
  }>;
}

export interface QuestionRegion {
  id: number;
  type: 'multiple-choice' | 'fill-in-blank' | 'true-false' | 'numeric' | 'free-response' | 'matching';
  boundingBox: BoundingBox;
  components: QuestionComponent;
  confidence: number; // 0.0-1.0
  questionNumber?: string; // 'Question 3 of 10', '#5', etc.
}

export interface ExcludeRegion {
  type: 'navigation' | 'header' | 'footer' | 'ad' | 'sidebar' | 'button';
  boundingBox: BoundingBox;
}

export interface RegionDetectionResponse {
  questionCount: number;
  regions: QuestionRegion[];
  excludeRegions: ExcludeRegion[];
  imageWidth: number;
  imageHeight: number;
  hasMultipleQuestions: boolean;
  recommendedAction: 'solve-all' | 'ask-user' | 'solve-active';
}

export interface StructuredAnswer {
  questionType: 'multiple-choice' | 'fill-in-blank' | 'true-false' | 'numeric' | 'free-response' | 'matching';
  expectedFormat: 'single-letter' | 'number' | 'text' | 'boolean' | 'equation' | 'multiple-values';
  answer: MultipleChoiceAnswer | FillInBlankAnswer | NumericAnswer | FreeResponseAnswer;
  confidence: number; // 0.0-1.0
  shortAnswer: string; // Legacy field for display
  steps: string[]; // Step-by-step solution
}

export interface MultipleChoiceAnswer {
  selected: string; // 'A', 'B', 'C', 'D', 'E'
  fullText: string; // Full text of selected option
  allOptions: string[]; // ['A', 'B', 'C', 'D']
  reasoning: string; // Why this answer is correct
}

export interface FillInBlankAnswer {
  blanks: Array<{
    position: number;
    value: string;
    context?: string; // Sentence context around the blank
  }>;
  fullSentence?: string; // Complete sentence with blanks filled
}

export interface NumericAnswer {
  value: number;
  formatted: string; // '3.74', '1.5e-10', '42'
  unit?: string; // 'meters', 'kg', 'seconds'
  precision?: number; // Decimal places
  scientificNotation?: boolean;
}

export interface FreeResponseAnswer {
  text: string;
  paragraphs?: string[]; // Multi-paragraph answers
  hasMath?: boolean; // Contains equations
  latex?: string[]; // LaTeX equations if present
}
