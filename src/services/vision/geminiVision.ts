import { GoogleGenerativeAI } from '@google/generative-ai';
import { RegionDetectionResponse } from './types';
import { ExpertParser } from '../llm/parser';

/**
 * Gemini Vision Service for Region Detection
 * Uses Gemini 2.0 Flash for fast, cost-effective vision analysis
 */
export class GeminiVisionService {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private parser: ExpertParser;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    // Use Gemini 2.0 Flash for vision (fast + cheap)
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-001' });  // Use stable version, not exp
    this.parser = new ExpertParser();
  }

  /**
   * Detect question regions in screenshot
   * Returns structured JSON with bounding boxes
   */
  async detectRegions(imageBase64: string): Promise<RegionDetectionResponse> {
    console.log('[VISION] 🔍 Starting region detection with Gemini 2.0 Flash');
    const startTime = Date.now();

    try {
      // Remove data:image prefix if present
      const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

      // Expert-level system prompt designed for Stage 1 direct JSON parse
      const prompt = this.buildRegionDetectionPrompt();

      console.log('[VISION] 📤 Sending image to Gemini Vision API...');
      const result = await this.model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Data,
          },
        },
      ]);

      const response = await result.response;
      const rawText = response.text();

      const duration = Date.now() - startTime;
      console.log(`[VISION] 📥 Received response from Gemini Vision (${duration}ms)`);
      console.log('[VISION] 🔍 Raw response preview:', rawText.substring(0, 200));

      // Use ExpertParser to extract JSON (same as answer parsing)
      console.log('[VISION] 🔧 Parsing response with ExpertParser...');
      const parseStart = Date.now();
      const parsed = await this.parser.parse(rawText, 'gemini-vision');
      const parseDuration = Date.now() - parseStart;

      console.log(`[VISION] ✅ Parse complete (${parseDuration}ms)`);
      console.log('[VISION] Parse confidence:', parsed.confidence);
      console.log('[VISION] Parse method:', parsed.parseMethod);

      if (parsed.error) {
        console.error('[VISION] ❌ Parse error:', parsed.error);
        throw new Error(`Failed to parse region detection response: ${parsed.error}`);
      }

      // Extract region data from parsed shortAnswer (contains the JSON)
      const regionData = JSON.parse(parsed.shortAnswer);

      console.log('[VISION] 📊 Region detection results:');
      console.log(`[VISION]    Platform: ${regionData.platform}`);
      console.log(`[VISION]    Questions found: ${regionData.questionCount}`);
      console.log(`[VISION]    Has multiple questions: ${regionData.hasMultipleQuestions}`);
      console.log(`[VISION]    Recommended action: ${regionData.recommendedAction}`);

      const totalDuration = Date.now() - startTime;
      console.log(`[VISION] ✅ Region detection complete (${totalDuration}ms total)`);

      return regionData as RegionDetectionResponse;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`[VISION] ❌ Region detection failed after ${duration}ms`);
      console.error('[VISION] Error:', error.message);
      console.error('[VISION] Stack:', error.stack);
      throw error;
    }
  }

  /**
   * Expert-level prompt designed to force exact JSON structure
   * Goal: Hit Stage 1 direct JSON parse (0-1ms parse time)
   */
  private buildRegionDetectionPrompt(): string {
    return `You are an expert homework page analyzer. Analyze this screenshot and detect all question regions.

**CRITICAL OUTPUT REQUIREMENTS:**
1. You MUST respond with ONLY valid JSON - no markdown, no explanations, no code blocks
2. Start your response with { and end with }
3. Do NOT wrap in \`\`\`json or any other formatting
4. Follow the exact schema below

**ANALYSIS TASKS:**
1. Identify the platform (Pearson, Khan Academy, McGraw-Hill, Canvas, Blackboard, or generic)
2. Count total questions visible on screen
3. For each question, provide bounding box coordinates (x, y, width, height) in pixels
4. Detect question type: multiple-choice, fill-in-blank, true-false, numeric, free-response, matching
5. Identify components: question text, charts, tables, diagrams, answer options, input fields
6. Mark regions to EXCLUDE: navigation bars, headers, footers, ads, sidebars, buttons

**BOUNDING BOX RULES:**
- x, y = top-left corner (0, 0 is top-left of image)
- width, height = dimensions in pixels
- Estimate based on visual layout (precision not critical)
- Include ALL relevant parts (text + charts + options)

**EXACT JSON SCHEMA:**
{
  "platform": "pearson" | "khan" | "mcgraw" | "cengage" | "canvas" | "blackboard" | "generic",
  "questionCount": <number>,
  "regions": [
    {
      "id": <number starting at 1>,
      "type": "multiple-choice" | "fill-in-blank" | "true-false" | "numeric" | "free-response" | "matching",
      "boundingBox": {"x": <number>, "y": <number>, "width": <number>, "height": <number>},
      "components": {
        "questionText": {"x": <number>, "y": <number>, "width": <number>, "height": <number>},
        "chart": {"x": <number>, "y": <number>, "width": <number>, "height": <number>} | null,
        "table": {"x": <number>, "y": <number>, "width": <number>, "height": <number>} | null,
        "diagram": {"x": <number>, "y": <number>, "width": <number>, "height": <number>} | null,
        "options": [
          {"box": {"x": <number>, "y": <number>, "width": <number>, "height": <number>}, "label": "A"}
        ] | null,
        "fillInBlanks": [
          {"box": {"x": <number>, "y": <number>, "width": <number>, "height": <number>}, "position": 1}
        ] | null
      },
      "confidence": <0.0-1.0>,
      "questionNumber": "<string like 'Question 3 of 10' or '#5' or null>"
    }
  ],
  "excludeRegions": [
    {"type": "navigation" | "header" | "footer" | "ad" | "sidebar" | "button", "boundingBox": {"x": <number>, "y": <number>, "width": <number>, "height": <number>}}
  ],
  "imageWidth": <number>,
  "imageHeight": <number>,
  "hasMultipleQuestions": <boolean>,
  "recommendedAction": "solve-all" | "ask-user" | "solve-active"
}

**RECOMMENDED ACTION LOGIC:**
- "solve-all": Only 1 question detected → auto-solve
- "ask-user": 2-4 questions detected → show selector UI
- "solve-active": 5+ questions detected → likely a test page, solve the highlighted/active question

**IMPORTANT:**
- Preserve colors in your analysis (they may be important for charts/graphs)
- If uncertain about a region, set confidence < 0.7
- For single-question pages, questionCount = 1 and regions array has 1 element
- Return ONLY the JSON object, nothing else`;
  }
}
