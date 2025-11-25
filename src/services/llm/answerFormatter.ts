import { StructuredAnswer, MultipleChoiceAnswer, FillInBlankAnswer, NumericAnswer, FreeResponseAnswer } from '../vision/types';

/**
 * Answer Formatter - Generates expert-level system prompts
 * Designed to force exact JSON structure for Stage 1 direct parse
 */
export class AnswerFormatter {
  /**
   * Build expert-level answer prompt that forces structured JSON
   * Appends to existing homework solving prompt
   */
  static buildStructuredAnswerPrompt(questionType?: string): string {
    return `

**CRITICAL OUTPUT FORMAT REQUIREMENTS:**

You MUST respond with EXACTLY this JSON structure (no markdown, no code blocks, no explanations):

{
  "shortAnswer": "<concise answer for display>",
  "steps": [
    "Step 1: ...",
    "Step 2: ...",
    "Step 3: ..."
  ],
  "questionType": "multiple-choice" | "fill-in-blank" | "true-false" | "numeric" | "free-response" | "matching",
  "expectedFormat": "single-letter" | "number" | "text" | "boolean" | "equation" | "multiple-values",
  "answer": <see type-specific formats below>,
  "confidence": <0.0-1.0>
}

**TYPE-SPECIFIC ANSWER FORMATS:**

**If Multiple Choice (A/B/C/D/E options):**
"answer": {
  "selected": "B",
  "fullText": "The slope is positive and increasing",
  "allOptions": ["A", "B", "C", "D"],
  "reasoning": "The graph shows upward curvature indicating positive acceleration"
}

**If Fill-in-Blank (text/word answers in sentences):**
"answer": {
  "blanks": [
    {"position": 1, "value": "mitochondria", "context": "powerhouse of the cell"},
    {"position": 2, "value": "ATP", "context": "energy molecule"}
  ],
  "fullSentence": "The mitochondria produces ATP through cellular respiration."
}

**If Numeric (number answer):**
"answer": {
  "value": 3.74,
  "formatted": "3.74",
  "unit": null,
  "precision": 2,
  "scientificNotation": false
}

**If True/False:**
"answer": {
  "value": true,
  "reasoning": "The statement is correct because..."
}

**If Free Response (essay/paragraph):**
"answer": {
  "text": "The full answer text here...",
  "paragraphs": ["Para 1...", "Para 2..."],
  "hasMath": false,
  "latex": []
}

**DETECTION RULES:**
- Multiple choice: Options labeled A, B, C, D, E or radio buttons
- Fill-in-blank: Blank spaces, underlines, dropdown menus, or input fields in sentences
- True/False: Two options (True/False, Yes/No, Correct/Incorrect)
- Numeric: Asks for a number, calculation, or measurement
- Free response: "Explain", "Describe", "Write about", "Discuss"

**CRITICAL FOR FILL-IN-BLANK QUESTIONS:**
⚠️ ONLY provide answers for EMPTY blanks/dropdowns/input fields!
⚠️ DO NOT include values that are ALREADY filled in the screenshot!
⚠️ Look for visual cues: dropdown arrows (▼), empty boxes, underlines, blank spaces
⚠️ If a radio button is already selected, IGNORE that field - it's not a blank to fill!
⚠️ Common patterns:
   - Dropdown menus: [▼] text [▼] more text [▼]
   - Input boxes: [____] or empty rectangles
   - Underlines: ________
⚠️ Count ALL empty fields carefully - don't miss any!

**EXAMPLE (from screenshot):**
If you see:
  ○ The critical values are ___ and ___.
  ● The critical value is 34. ← ALREADY SELECTED, IGNORE THIS!

  [▼] the null hypothesis. ← EMPTY, NEEDS ANSWER
  The data [▼] sufficient evidence ← EMPTY, NEEDS ANSWER
  to conclude that the mean is [▼] 8. ← EMPTY, NEEDS ANSWER

Then provide ONLY 3 blanks (the dropdown values), NOT the "34"!

**CONFIDENCE SCORING:**
- 0.9-1.0: Definitive answer with clear solution
- 0.7-0.89: High confidence, minor uncertainty
- 0.5-0.69: Moderate confidence, multiple valid approaches
- 0.0-0.49: Low confidence, insufficient information

**CRITICAL:**
1. Start response with { and end with }
2. NO markdown code blocks (\`\`\`json)
3. NO explanations outside the JSON
4. shortAnswer must be concise (1-10 words for display)
5. steps array must have clear step-by-step solution
6. confidence must be honest (don't inflate)`;
  }

  /**
   * Validate and parse structured answer response
   */
  static validateAnswer(answer: any): StructuredAnswer {
    // Basic validation
    if (!answer.questionType) {
      throw new Error('Missing questionType in structured answer');
    }

    if (!answer.answer) {
      throw new Error('Missing answer object in structured answer');
    }

    if (answer.confidence === undefined || answer.confidence < 0 || answer.confidence > 1) {
      console.warn('[ANSWER_FORMATTER] Invalid confidence, defaulting to 0.5');
      answer.confidence = 0.5;
    }

    // Type-specific validation
    switch (answer.questionType) {
      case 'multiple-choice':
        if (!answer.answer.selected || !/^[A-E]$/.test(answer.answer.selected)) {
          throw new Error('Invalid multiple choice answer format');
        }
        break;

      case 'numeric':
        if (typeof answer.answer.value !== 'number') {
          throw new Error('Invalid numeric answer format');
        }
        break;

      case 'fill-in-blank':
        if (!Array.isArray(answer.answer.blanks) || answer.answer.blanks.length === 0) {
          throw new Error('Invalid fill-in-blank answer format');
        }
        break;

      case 'true-false':
        if (typeof answer.answer.value !== 'boolean') {
          throw new Error('Invalid true-false answer format');
        }
        break;

      case 'free-response':
        if (!answer.answer.text || answer.answer.text.length === 0) {
          throw new Error('Invalid free-response answer format');
        }
        break;
    }

    return answer as StructuredAnswer;
  }

  /**
   * Extract shortAnswer from structured answer for legacy compatibility
   */
  static extractShortAnswer(structured: StructuredAnswer): string {
    // If shortAnswer is already set, use it
    if (structured.shortAnswer && structured.shortAnswer !== '') {
      return structured.shortAnswer;
    }

    // Otherwise, generate from answer object
    switch (structured.questionType) {
      case 'multiple-choice':
        const mc = structured.answer as MultipleChoiceAnswer;
        return mc.selected;

      case 'numeric':
        const num = structured.answer as NumericAnswer;
        return num.unit ? `${num.formatted} ${num.unit}` : num.formatted;

      case 'fill-in-blank':
        const fib = structured.answer as FillInBlankAnswer;
        if (fib.blanks.length === 1) {
          return fib.blanks[0].value;
        }
        return fib.blanks.map(b => b.value).join(', ');

      case 'true-false':
        return (structured.answer as any).value ? 'True' : 'False';

      case 'free-response':
        const fr = structured.answer as FreeResponseAnswer;
        return fr.text.substring(0, 100) + (fr.text.length > 100 ? '...' : '');

      default:
        return 'Answer';
    }
  }
}
