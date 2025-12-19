
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.join(__dirname, '.env') });

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('No GEMINI_API_KEY found');
    return;
  }

  const client = new GoogleGenerativeAI(apiKey);

  console.log('--- Testing gemini-2.5-pro ---');
  try {
    const model = client.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const result = await model.generateContent('Hello, are you there?');
    console.log('Response text:', result.response.text());
  } catch (error: any) {
    console.error('Error with gemini-2.5-pro:', error.message);
  }
  
  console.log('\n--- Testing gemini-1.5-pro ---');
  try {
    const model = client.getGenerativeModel({ model: 'gemini-1.5-pro' });
    const result = await model.generateContent('Hello, are you there?');
    console.log('Response text:', result.response.text());
  } catch (error: any) {
    console.error('Error with gemini-1.5-pro:', error.message);
  }
}

test();
