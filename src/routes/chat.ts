import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client';
import { authenticate } from '../utils/auth';
import { UsageService } from '../services/usage';
import { LLMOrchestrator } from '../services/llm/orchestrator';
import { LLMMessage } from '../services/llm/types';
import { ChatMode } from '@prisma/client';

const orchestrator = new LLMOrchestrator();

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
    console.log('\n' + '='.repeat(80));
    console.log('[CHAT/START] 🚀 New chat request received');
    console.log('[CHAT/START] Time:', new Date().toISOString());

    try {
      console.log('[CHAT/START] 🔐 Authenticating...');
      const { userId } = await authenticate(request);
      console.log('[CHAT/START] ✅ Authenticated, userId:', userId);

      console.log('[CHAT/START] 📦 Parsing request body...');
      const { mode, message, imageData, captureSource } = startChatSchema.parse(request.body);
      console.log('[CHAT/START] Mode:', mode);
      console.log('[CHAT/START] Message:', message);
      console.log('[CHAT/START] Has image:', !!imageData);
      console.log('[CHAT/START] Image size:', imageData ? `${(imageData.length / 1024).toFixed(2)} KB` : 'N/A');
      console.log('[CHAT/START] Capture source:', captureSource);

      // Check rate limit
      console.log('[CHAT/START] 📊 Checking rate limit...');
      const usageCheck = await UsageService.checkLimit(userId);
      console.log('[CHAT/START] Rate limit check:', usageCheck);

      if (!usageCheck.allowed) {
        console.log('[CHAT/START] ❌ Rate limit exceeded!');
        return reply.code(429).send({
          error: 'Daily limit reached',
          code: 'DAILY_LIMIT_REACHED',
          plan: usageCheck.plan,
          limit: usageCheck.limit,
          used: usageCheck.used,
        });
      }

      // Create chat session
      console.log('[CHAT/START] 💾 Creating chat session...');
      const session = await prisma.chatSession.create({
        data: {
          userId,
          mode: mode as ChatMode,
          title: message.substring(0, 50),
        },
      });
      console.log('[CHAT/START] ✅ Session created, ID:', session.id);

      // Create user message
      console.log('[CHAT/START] 💾 Creating user message...');
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
      console.log('[CHAT/START] ✅ User message created, ID:', userMessage.id);

      // Build LLM messages
      console.log('[CHAT/START] 🤖 Building LLM message array...');
      const llmMessages: LLMMessage[] = [
        {
          role: 'user',
          content: message,
          imageData,
        },
      ];

      // Generate response
      console.log('[CHAT/START] 🤖 Calling LLM orchestrator.generate()...');
      console.log('[CHAT/START] Mode:', mode);
      const startTime = Date.now();
      const result = await orchestrator.generate(mode as ChatMode, llmMessages);
      const duration = Date.now() - startTime;
      console.log('[CHAT/START] ✅ LLM response received in', duration, 'ms');

      // Save assistant message(s)
      if (mode === 'EXPERT' && result.providers) {
        // Save all provider responses
        for (const provider of result.providers) {
          await prisma.message.create({
            data: {
              chatSessionId: session.id,
              role: 'ASSISTANT',
              content: provider.response.explanation,
              shortAnswer: provider.response.shortAnswer,
              provider: provider.provider.toUpperCase() as any,
              metadata: provider.error ? { error: provider.error } : undefined,
            },
          });
        }

        // Save consensus
        if (result.consensus) {
          await prisma.message.create({
            data: {
              chatSessionId: session.id,
              role: 'ASSISTANT',
              content: result.consensus.explanation,
              shortAnswer: result.consensus.shortAnswer,
              provider: 'CONSENSUS',
            },
          });
        }
      } else {
        // Save single response
        await prisma.message.create({
          data: {
            chatSessionId: session.id,
            role: 'ASSISTANT',
            content: result.primary.explanation,
            shortAnswer: result.primary.shortAnswer,
            provider: mode === 'FAST' ? 'GEMINI' : 'GEMINI',
          },
        });
      }

      // Increment usage
      await UsageService.incrementSolve(userId, mode as ChatMode, result.primary.tokensUsed);

      // Return session with messages
      const fullSession = await prisma.chatSession.findUnique({
        where: { id: session.id },
        include: {
          messages: {
            include: { attachments: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      console.log('[CHAT/START] ✅ SUCCESS - Sending response');
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

      // Check rate limit
      const usageCheck = await UsageService.checkLimit(userId);
      if (!usageCheck.allowed) {
        return reply.code(429).send({
          error: 'Daily limit reached',
          code: 'DAILY_LIMIT_REACHED',
          plan: usageCheck.plan,
          limit: usageCheck.limit,
          used: usageCheck.used,
        });
      }

      // Create user message
      await prisma.message.create({
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
      });

      // Build conversation history for LLM
      const llmMessages: LLMMessage[] = session.messages
        .filter(m => m.provider !== 'GEMINI' && m.provider !== 'OPENAI' && m.provider !== 'CLAUDE')
        .map(m => ({
          role: m.role === 'USER' ? 'user' : 'assistant',
          content: m.content,
          imageData: m.attachments[0]?.imageData || undefined,
        }));

      // Add new message
      llmMessages.push({
        role: 'user',
        content: message,
        imageData,
      });

      // Generate response using effective mode
      const result = await orchestrator.generate(effectiveMode as ChatMode, llmMessages);

      // Save response(s)
      if (effectiveMode === 'EXPERT' && result.providers) {
        for (const provider of result.providers) {
          await prisma.message.create({
            data: {
              chatSessionId: session.id,
              role: 'ASSISTANT',
              content: provider.response.explanation,
              shortAnswer: provider.response.shortAnswer,
              provider: provider.provider.toUpperCase() as any,
              metadata: provider.error ? { error: provider.error } : undefined,
            },
          });
        }

        if (result.consensus) {
          await prisma.message.create({
            data: {
              chatSessionId: session.id,
              role: 'ASSISTANT',
              content: result.consensus.explanation,
              shortAnswer: result.consensus.shortAnswer,
              provider: 'CONSENSUS',
            },
          });
        }
      } else {
        await prisma.message.create({
          data: {
            chatSessionId: session.id,
            role: 'ASSISTANT',
            content: result.primary.explanation,
            shortAnswer: result.primary.shortAnswer,
            provider: 'GEMINI',
          },
        });
      }

      // Increment usage with effective mode
      await UsageService.incrementSolve(userId, effectiveMode as ChatMode, result.primary.tokensUsed);

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
