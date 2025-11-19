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
});

export async function chatRoutes(server: FastifyInstance) {
  // POST /chat/start - Start a new chat session
  server.post('/start', async (request, reply) => {
    try {
      const { userId } = await authenticate(request);
      const { mode, message, imageData, captureSource } = startChatSchema.parse(request.body);

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

      // Create chat session
      const session = await prisma.chatSession.create({
        data: {
          userId,
          mode: mode as ChatMode,
          title: message.substring(0, 50),
        },
      });

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

      // Build LLM messages
      const llmMessages: LLMMessage[] = [
        {
          role: 'user',
          content: message,
          imageData,
        },
      ];

      // Generate response
      const result = await orchestrator.generate(mode as ChatMode, llmMessages);

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

      return reply.code(201).send(fullSession);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: error.errors });
      }
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // POST /chat/:sessionId/message - Send a follow-up message
  server.post('/:sessionId/message', async (request, reply) => {
    try {
      const { userId } = await authenticate(request);
      const { sessionId } = request.params as { sessionId: string };
      const { message, imageData, captureSource } = sendMessageSchema.parse(request.body);

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
          content: m.role === 'ASSISTANT' ? m.explanation || m.content : m.content,
          imageData: m.attachments[0]?.imageData,
        }));

      // Add new message
      llmMessages.push({
        role: 'user',
        content: message,
        imageData,
      });

      // Generate response
      const result = await orchestrator.generate(session.mode, llmMessages);

      // Save response(s)
      if (session.mode === 'EXPERT' && result.providers) {
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

      // Increment usage
      await UsageService.incrementSolve(userId, session.mode, result.primary.tokensUsed);

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
