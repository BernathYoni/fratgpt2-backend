import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client';
import { authenticate } from '../utils/auth';
import { UsageService } from '../services/usage';
import { LLMOrchestrator } from '../services/llm/orchestrator';
import { LLMMessage } from '../services/llm/types';
import { ChatMode } from '@prisma/client';
import { RegionDetectionService } from '../services/vision/regionService';
import { AnswerFormatter } from '../services/llm/answerFormatter';

const orchestrator = new LLMOrchestrator();
const regionService = new RegionDetectionService(process.env.GEMINI_API_KEY || '');

const startChatSchema = z.object({
  mode: z.enum(['REGULAR', 'FAST', 'EXPERT']),
  message: z.string().min(1),
  imageData: z.string().optional(), // base64
  captureSource: z.enum(['SCREEN', 'SNIP']).optional(),
});

const sendMessageSchema = z.object({
  message: z.string().min(1),
  imageData: z.string().optional(),
  captureSource: z.enum(['SCREEN', 'SNIP']).optional(),
  mode: z.enum(['REGULAR', 'FAST', 'EXPERT']).optional(), // Allow mode switching for new captures
});

export async function chatRoutes(server: FastifyInstance) {
  // POST /chat/start - Start a new chat session
  server.post('/start', async (request, reply) => {
    const requestStart = Date.now();
    console.log('\n' + '='.repeat(80));
    console.log(`[CHAT/START] [${new Date().toISOString()}] 🚀 New chat request received`);

    try {
      const authStart = Date.now();
      console.log(`[CHAT/START] [${new Date().toISOString()}] 🔐 Authenticating...`);
      const { userId } = await authenticate(request);
      console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ Authenticated in ${Date.now() - authStart}ms, userId: ${userId}`);

      const parseStart = Date.now();
      console.log(`[CHAT/START] [${new Date().toISOString()}] 📦 Parsing request body...`);
      const { mode, message, imageData, captureSource } = startChatSchema.parse(request.body);
      console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ Parsed in ${Date.now() - parseStart}ms`);
      console.log('[CHAT/START] Mode:', mode);
      console.log('[CHAT/START] Message:', message);
      console.log('[CHAT/START] Has image:', !!imageData);
      console.log('[CHAT/START] Image size:', imageData ? `${(imageData.length / 1024).toFixed(2)} KB` : 'N/A');
      console.log('[CHAT/START] Capture source:', captureSource);

      // Rate limiting disabled for testing
      console.log('[CHAT/START] 📊 Rate limiting disabled for testing');

      // Create chat session
      const dbStart = Date.now();
      console.log(`[CHAT/START] [${new Date().toISOString()}] 💾 Creating chat session...`);
      const session = await prisma.chatSession.create({
        data: {
          userId,
          mode: mode as ChatMode,
          title: message.substring(0, 50),
        },
      });
      console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ Session created in ${Date.now() - dbStart}ms, ID: ${session.id}`);

      // Create user message
      const msgStart = Date.now();
      console.log(`[CHAT/START] [${new Date().toISOString()}] 💾 Creating user message...`);
      const userMessage = await prisma.message.create({
        data: {
          chatSessionId: session.id,
          role: 'USER',
          content: message,
          attachments: imageData
            ? {
                create: {
                  type: 'IMAGE',
                  source: captureSource || 'SCREEN',
                  imageData,
                },
              }
            : undefined,
        },
        include: {
          attachments: true,
        },
      });
      console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ User message created in ${Date.now() - msgStart}ms, ID: ${userMessage.id}`);

      // REGION DETECTION - DISABLED (not being used by frontend/extension)
      // Saves ~2.1 seconds per request
      let regionData = null;
      console.log(`[CHAT/START] [${new Date().toISOString()}] ⏭️ Skipping region detection (feature disabled)`);

      // TODO: Re-enable when implementing multi-question support
      // if (RegionDetectionService.shouldDetectRegions(imageData, true)) {
      //   ... region detection code ...
      // }

      // Build LLM messages
      console.log(`[CHAT/START] [${new Date().toISOString()}] 🤖 Building LLM message array...`);
      const llmMessages: LLMMessage[] = [
        {
          role: 'user',
          content: message,
          imageData,
        },
      ];

      // Generate response
      console.log(`[CHAT/START] [${new Date().toISOString()}] 🤖 Calling LLM orchestrator.generate()...`);
      console.log('[CHAT/START] Mode:', mode);
      const llmStart = Date.now();
      const result = await orchestrator.generate(mode as ChatMode, llmMessages);
      const llmDuration = Date.now() - llmStart;
      console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ LLM response received in ${llmDuration}ms`);

      // Save assistant message(s) with structured answer data
      const saveStart = Date.now();
      console.log(`[CHAT/START] [${new Date().toISOString()}] 💾 Saving assistant message(s)...`);
      if (mode === 'EXPERT' && result.providers) {
        // Save all provider responses (no consensus)
        for (const provider of result.providers) {
          // Try to extract structured answer from response
          let structuredAnswer = null;
          let questionType = null;
          let answerFormat = null;
          let confidence = provider.response.confidence || null;

          try {
            // Parse the response to check if it has structured answer
            const parsed = JSON.parse(provider.response.shortAnswer);
            if (parsed.questionType && parsed.answer) {
              structuredAnswer = parsed;
              questionType = parsed.questionType;
              answerFormat = parsed.expectedFormat;
              confidence = parsed.confidence || confidence;
            }
          } catch {
            // Not structured JSON, use legacy format
          }

          await prisma.message.create({
            data: {
              chatSessionId: session.id,
              role: 'ASSISTANT',
              content: JSON.stringify({ steps: provider.response.steps }),
              shortAnswer: provider.response.shortAnswer,
              provider: provider.provider.toUpperCase() as any,
              metadata: provider.error ? { error: provider.error } : undefined,
              questionType,
              answerFormat,
              structuredAnswer: structuredAnswer as any,
              confidence,
              questionRegions: regionData as any,
            },
          });
        }
      } else {
        // Save single response with structured answer
        let structuredAnswer = null;
        let questionType = null;
        let answerFormat = null;
        let confidence = result.primary.confidence || null;

        try {
          // Parse the response to check if it has structured answer
          const parsed = JSON.parse(result.primary.shortAnswer);
          if (parsed.questionType && parsed.answer) {
            structuredAnswer = parsed;
            questionType = parsed.questionType;
            answerFormat = parsed.expectedFormat;
            confidence = parsed.confidence || confidence;
          }
        } catch {
          // Not structured JSON, use legacy format
        }

        await prisma.message.create({
          data: {
            chatSessionId: session.id,
            role: 'ASSISTANT',
            content: JSON.stringify({ steps: result.primary.steps }),
            shortAnswer: result.primary.shortAnswer,
            provider: mode === 'FAST' ? 'GEMINI' : 'GEMINI',
            questionType,
            answerFormat,
            structuredAnswer: structuredAnswer as any,
            confidence,
            questionRegions: regionData as any,
          },
        });
      }
      console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ Assistant message(s) saved in ${Date.now() - saveStart}ms`);

      // Usage tracking disabled for testing
      console.log('[CHAT/START] 📊 Usage tracking disabled for testing');

      // Return session with messages
      const fetchStart = Date.now();
      console.log(`[CHAT/START] [${new Date().toISOString()}] 📥 Fetching full session data...`);
      const fullSession = await prisma.chatSession.findUnique({
        where: { id: session.id },
        include: {
          messages: {
            include: { attachments: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ Session data fetched in ${Date.now() - fetchStart}ms`);

      const totalDuration = Date.now() - requestStart;
      console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ SUCCESS - Total request time: ${totalDuration}ms`);
      console.log('='.repeat(80) + '\n');
      return reply.code(201).send(fullSession);
    } catch (error: any) {
      console.error('\n❌❌❌ ERROR IN /chat/start ❌❌❌');
      console.error('[CHAT/START] Error type:', error?.constructor?.name);
      console.error('[CHAT/START] Error message:', error?.message);
      console.error('[CHAT/START] Error stack:', error?.stack);

      if (error instanceof z.ZodError) {
        console.error('[CHAT/START] Zod validation errors:', JSON.stringify(error.errors, null, 2));
        return reply.code(400).send({ error: 'Invalid input', details: error.errors });
      }

      server.log.error(error);
      console.error('[CHAT/START] Sending 500 Internal Server Error');
      console.error('='.repeat(80) + '\n');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // POST /chat/:sessionId/message - Send a follow-up message
  server.post('/:sessionId/message', async (request, reply) => {
    try {
      const { userId } = await authenticate(request);
      const { sessionId } = request.params as { sessionId: string };
      const { message, imageData, captureSource, mode } = sendMessageSchema.parse(request.body);

      // Get session
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
        include: {
          messages: {
            include: { attachments: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!session || session.userId !== userId) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      // Determine which mode to use: new mode if provided (for new captures), otherwise session mode
      const effectiveMode = mode || session.mode;
      console.log('[CHAT/MESSAGE] Original session mode:', session.mode);
      console.log('[CHAT/MESSAGE] Mode from request:', mode);
      console.log('[CHAT/MESSAGE] Effective mode:', effectiveMode);
      console.log('[CHAT/MESSAGE] Has image:', !!imageData);

      // Update session mode if a new mode was provided (user switched modes for this capture)
      if (mode && mode !== session.mode) {
        console.log('[CHAT/MESSAGE] 🔄 Updating session mode from', session.mode, 'to', mode);
        await prisma.chatSession.update({
          where: { id: session.id },
          data: { mode: mode as ChatMode },
        });
      }

      // Rate limiting disabled for testing
      console.log('[CHAT/MESSAGE] 📊 Rate limiting disabled for testing');

      // Create user message
      const userMessage = await prisma.message.create({
        data: {
          chatSessionId: session.id,
          role: 'USER',
          content: message,
          attachments: imageData
            ? {
                create: {
                  type: 'IMAGE',
                  source: captureSource || 'SCREEN',
                  imageData,
                },
              }
            : undefined,
        },
        include: {
          attachments: true,
        },
      });

      // REGION DETECTION - DISABLED (not being used by frontend/extension)
      // Saves ~2.1 seconds per request
      let regionData = null;
      console.log('[CHAT/MESSAGE] ⏭️ Skipping region detection (feature disabled)');

      // Build conversation history for LLM
      // IMPORTANT: Don't include images from previous messages to avoid token overflow
      // Images can be 500-1000 tokens each, so we only send the NEW image if provided
      const llmMessages: LLMMessage[] = session.messages
        .filter(m => m.provider !== 'GEMINI' && m.provider !== 'OPENAI' && m.provider !== 'CLAUDE')
        .map(m => ({
          role: m.role === 'USER' ? 'user' : 'assistant',
          content: m.content,
          // imageData: REMOVED - don't send old images in conversation history
        }));

      // Add new message (with imageData if provided)
      llmMessages.push({
        role: 'user',
        content: message,
        imageData, // Only send NEW image if user uploaded one
      });

      // Generate response using effective mode
      const result = await orchestrator.generate(effectiveMode as ChatMode, llmMessages);

      // Save response(s) with structured answer data
      if (effectiveMode === 'EXPERT' && result.providers) {
        // Save all provider responses (no consensus)
        for (const provider of result.providers) {
          // Try to extract structured answer from response
          let structuredAnswer = null;
          let questionType = null;
          let answerFormat = null;
          let confidence = provider.response.confidence || null;

          try {
            const parsed = JSON.parse(provider.response.shortAnswer);
            if (parsed.questionType && parsed.answer) {
              structuredAnswer = parsed;
              questionType = parsed.questionType;
              answerFormat = parsed.expectedFormat;
              confidence = parsed.confidence || confidence;
            }
          } catch {
            // Not structured JSON, use legacy format
          }

          await prisma.message.create({
            data: {
              chatSessionId: session.id,
              role: 'ASSISTANT',
              content: JSON.stringify({ steps: provider.response.steps }),
              shortAnswer: provider.response.shortAnswer,
              provider: provider.provider.toUpperCase() as any,
              metadata: provider.error ? { error: provider.error } : undefined,
              questionType,
              answerFormat,
              structuredAnswer: structuredAnswer as any,
              confidence,
              questionRegions: regionData as any,
            },
          });
        }
      } else {
        // Save single response with structured answer
        let structuredAnswer = null;
        let questionType = null;
        let answerFormat = null;
        let confidence = result.primary.confidence || null;

        try {
          const parsed = JSON.parse(result.primary.shortAnswer);
          if (parsed.questionType && parsed.answer) {
            structuredAnswer = parsed;
            questionType = parsed.questionType;
            answerFormat = parsed.expectedFormat;
            confidence = parsed.confidence || confidence;
          }
        } catch {
          // Not structured JSON, use legacy format
        }

        await prisma.message.create({
          data: {
            chatSessionId: session.id,
            role: 'ASSISTANT',
            content: JSON.stringify({ steps: result.primary.steps }),
            shortAnswer: result.primary.shortAnswer,
            provider: 'GEMINI',
            questionType,
            answerFormat,
            structuredAnswer: structuredAnswer as any,
            confidence,
            questionRegions: regionData as any,
          },
        });
      }

      // Usage tracking disabled for testing
      console.log('[CHAT/MESSAGE] 📊 Usage tracking disabled for testing');

      // Return updated session
      const updatedSession = await prisma.chatSession.findUnique({
        where: { id: session.id },
        include: {
          messages: {
            include: { attachments: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      return reply.send(updatedSession);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: error.errors });
      }
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // GET /chat/sessions - Get all chat sessions for user
  server.get('/sessions', async (request, reply) => {
    try {
      const { userId } = await authenticate(request);

      const sessions = await prisma.chatSession.findMany({
        where: { userId },
        include: {
          messages: {
            take: 1,
            orderBy: { createdAt: 'asc' },
            select: {
              content: true,
              createdAt: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      });

      return reply.send(sessions);
    } catch (error) {
      server.log.error(error);
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // GET /chat/:sessionId - Get a specific session with all messages
  server.get('/:sessionId', async (request, reply) => {
    try {
      const { userId } = await authenticate(request);
      const { sessionId } = request.params as { sessionId: string };

      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
        include: {
          messages: {
            include: { attachments: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!session || session.userId !== userId) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      return reply.send(session);
    } catch (error) {
      server.log.error(error);
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}
