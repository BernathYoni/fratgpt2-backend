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
  sourceUrl: z.string().optional(),
});

const sendMessageSchema = z.object({
  message: z.string().min(1),
  imageData: z.string().optional(),
  captureSource: z.enum(['SCREEN', 'SNIP']).optional(),
  mode: z.enum(['REGULAR', 'FAST', 'EXPERT']).optional(), // Allow mode switching for new captures
});

const interactionSchema = z.object({
  type: z.string(),
  metadata: z.record(z.any()).optional(),
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
      const { mode, message, imageData, captureSource, sourceUrl } = startChatSchema.parse(request.body);
      const ipAddress = (request.headers['x-forwarded-for'] as string) || request.ip;

      console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ Parsed in ${Date.now() - parseStart}ms`);
      console.log('[CHAT/START] Mode:', mode);
      console.log('[CHAT/START] Message:', message);
      console.log('[CHAT/START] Has image:', !!imageData);
      console.log('[CHAT/START] Source URL:', sourceUrl || 'N/A');
      console.log('[CHAT/START] IP Address:', ipAddress);

      // Check rate limits and mode restrictions
      const limitCheckStart = Date.now();
      console.log(`[CHAT/START] [${new Date().toISOString()}] 📊 Checking rate limits...`);
      const limitCheck = await UsageService.checkLimit(userId, mode as ChatMode);
      console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ Limit check complete in ${Date.now() - limitCheckStart}ms`);

      if (!limitCheck.modeAllowed) {
        console.log(`[CHAT/START] [${new Date().toISOString()}] ❌ Mode not allowed:`, limitCheck.modeRestrictionReason);
        return reply.code(403).send({
          error: limitCheck.modeRestrictionReason,
          code: 'MODE_RESTRICTED',
          plan: limitCheck.plan,
        });
      }

      if (!limitCheck.allowed) {
        console.log(`[CHAT/START] [${new Date().toISOString()}] ❌ Rate limit exceeded`);
        if (limitCheck.limitType === 'solves') {
          return reply.code(429).send({
            error: `Monthly limit reached (${limitCheck.used}/${limitCheck.limit} solves)`,
            code: 'MONTHLY_LIMIT_REACHED',
            plan: limitCheck.plan,
            limit: limitCheck.limit,
            used: limitCheck.used,
            remaining: 0,
          });
        } else {
          return reply.code(429).send({
            error: `Monthly cost limit reached ($${limitCheck.used.toFixed(2)}/$${limitCheck.limit.toFixed(2)})`,
            code: 'MONTHLY_COST_LIMIT_REACHED',
            plan: limitCheck.plan,
            limit: limitCheck.limit,
            used: limitCheck.used,
            remaining: 0,
          });
        }
      }

      console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ Rate limit check passed:`, {
        plan: limitCheck.plan,
        limitType: limitCheck.limitType,
        used: limitCheck.used,
        limit: limitCheck.limit,
        remaining: limitCheck.remaining,
      });

      // Create chat session
      const dbStart = Date.now();
      console.log(`[CHAT/START] [${new Date().toISOString()}] 💾 Creating chat session...`);
      const session = await prisma.chatSession.create({
        data: {
          userId,
          mode: mode as ChatMode,
          title: message.substring(0, 50),
          sourceUrl,
          ipAddress,
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

      let regionData = null; // Initialize regionData to prevent TS error after removing region detection block

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
      console.log(`[CHAT/START] 🔍 DEBUG: mode = "${mode}"`);
      console.log(`[CHAT/START] 🔍 DEBUG: result.providers exists = ${!!result.providers}`);
      console.log(`[CHAT/START] 🔍 DEBUG: result.providers count = ${result.providers?.length || 0}`);
      console.log(`[CHAT/START] 🔍 DEBUG: Will save multi-provider = ${(mode === 'EXPERT' || mode === 'REGULAR') && !!result.providers}`);
      if (result.providers) {
        console.log(`[CHAT/START] 🔍 DEBUG: Provider list:`, result.providers.map(p => ({
          provider: p.provider,
          hasResponse: !!p.response,
          shortAnswer: p.response?.shortAnswer?.substring(0, 50),
        })));
      }
      if ((mode === 'EXPERT' || mode === 'REGULAR') && result.providers) {
        // Save all provider responses (no consensus)
        console.log(`[CHAT/START] 💾 Entering EXPERT/multi-provider save block - saving ${result.providers.length} messages`);
        for (const provider of result.providers) {
          console.log(`[CHAT/START] 💾 Saving message for provider: ${provider.provider.toUpperCase()}`);
          console.log(`[CHAT/START] 💾   - shortAnswer: ${provider.response.shortAnswer?.substring(0, 100)}...`);
          
          // Use structured answer from response
          let structuredAnswer = provider.response.structuredAnswer || null;
          let questionType = provider.response.questionType || null;
          let answerFormat = null;
          let confidence = provider.response.confidence || null;

          await prisma.message.create({
            data: {
              chatSessionId: session.id,
              role: 'ASSISTANT',
              content: provider.response.shortAnswer || 'No answer',
              shortAnswer: provider.response.shortAnswer,
              provider: provider.provider.toUpperCase() as any,
              metadata: { 
                ...(provider.error ? { error: provider.error } : {}), 
                tokenUsage: provider.response.tokenUsage as any
              },
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
        console.log(`[CHAT/START] 💾 Entering FAST/REGULAR single-save block`);
        console.log(`[CHAT/START] 💾 Mode: ${mode}`);
        console.log(`[CHAT/START] 💾 Will save only PRIMARY response (GEMINI)`);
        console.log(`[CHAT/START] 💾 Primary shortAnswer: ${result.primary.shortAnswer?.substring(0, 100)}...`);
        if (result.providers) {
          console.log(`[CHAT/START] ⚠️  WARNING: result.providers exists with ${result.providers.length} providers, but NOT saving them because mode !== 'EXPERT'`);
          console.log(`[CHAT/START] ⚠️  This means OpenAI and Claude responses are being IGNORED!`);
        }
        
        // Use structured answer from response
        let structuredAnswer = result.primary.structuredAnswer || null;
        let questionType = result.primary.questionType || null;
        let answerFormat = null;
        let confidence = result.primary.confidence || null;

        await prisma.message.create({
          data: {
            chatSessionId: session.id,
            role: 'ASSISTANT',
            content: result.primary.shortAnswer || 'No answer',
            shortAnswer: result.primary.shortAnswer,
            metadata: { tokenUsage: result.primary.tokenUsage as any },
            provider: mode === 'FAST' ? 'GEMINI' : 'GEMINI',
            questionType,
            answerFormat,
            structuredAnswer: structuredAnswer as any,
            confidence,
            questionRegions: regionData as any,
          },
        });
      }

      // Log what was actually saved
      const savedMessagesCount = await prisma.message.count({
        where: { chatSessionId: session.id, role: 'ASSISTANT' }
      });
      console.log(`[CHAT/START] 💾 Total ASSISTANT messages saved in DB: ${savedMessagesCount}`);
      console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ Assistant message(s) saved in ${Date.now() - saveStart}ms`);

      // Track usage with token costs
      const usageStart = Date.now();
      console.log(`[CHAT/START] [${new Date().toISOString()}] 📊 Tracking usage and costs...`);

      try {
        // Extract token usage from LLM response(s)
        const tokenUsage: any = {};

        if ((mode === 'EXPERT' || mode === 'REGULAR') && result.providers) {
          // Expert and Regular modes - both use 3 providers now
          for (const provider of result.providers) {
            if (provider.response.tokenUsage) {
              const tokens = provider.response.tokenUsage;

              if (provider.provider === 'gemini') {
                // Gemini Pro for Regular, Gemini Exp 1206 for Expert
                tokenUsage.geminiPro = {
                  input: tokens.inputTokens,
                  output: tokens.outputTokens,
                };
              } else if (provider.provider === 'openai') {
                tokenUsage.openai = {
                  input: tokens.inputTokens,
                  output: tokens.outputTokens,
                };
              } else if (provider.provider === 'claude') {
                // REGULAR mode uses Sonnet, EXPERT mode uses Opus
                if (mode === 'EXPERT') {
                  tokenUsage.claudeOpus = {
                    input: tokens.inputTokens,
                    output: tokens.outputTokens,
                    thinking: tokens.thinkingTokens || 0,
                  };
                } else {
                  tokenUsage.claudeSonnet = {
                    input: tokens.inputTokens,
                    output: tokens.outputTokens,
                    thinking: tokens.thinkingTokens || 0,
                  };
                }
              }
            }
          }
        } else if (mode === 'FAST') {
          // Fast mode uses Gemini Flash only
          if (result.primary?.tokenUsage) {
            tokenUsage.geminiFlash = {
              input: result.primary.tokenUsage.inputTokens,
              output: result.primary.tokenUsage.outputTokens,
            };
          }
        }

        // Increment usage with token tracking
        await UsageService.incrementSolve(userId, mode as ChatMode, tokenUsage);
        console.log(`[CHAT/START] [${new Date().toISOString()}] ✅ Usage tracked in ${Date.now() - usageStart}ms`);
      } catch (error) {
        console.error(`[CHAT/START] [${new Date().toISOString()}] ❌ Failed to track usage:`, error);
        // Don't fail the request if usage tracking fails
      }

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
      console.log(`[CHAT/START] 📤 RETURNING TO EXTENSION:`);
      console.log(`[CHAT/START] 📤   Total messages: ${fullSession?.messages.length || 0}`);
      console.log(`[CHAT/START] 📤   Messages breakdown:`, fullSession?.messages.map(m => ({
        role: m.role,
        provider: m.provider,
        shortAnswerLength: m.shortAnswer?.length || 0
      })));

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

  // POST /chat/start-stream - Start a new chat session with SSE streaming
  server.post('/start-stream', async (request, reply) => {
    console.log('\n' + '='.repeat(80));
    console.log(`[CHAT/START-STREAM] [${new Date().toISOString()}] 🚀 New streaming chat request`);

    try {
      // 1. Authenticate & Setup
      const { userId } = await authenticate(request);
      const { mode, message, imageData, captureSource, sourceUrl } = startChatSchema.parse(request.body);
      const ipAddress = (request.headers['x-forwarded-for'] as string) || request.ip;

      // Rate Limit Check
      const limitCheck = await UsageService.checkLimit(userId, mode as ChatMode);
      if (!limitCheck.modeAllowed) {
        return reply.code(403).send({ error: limitCheck.modeRestrictionReason, code: 'MODE_RESTRICTED' });
      }
      if (!limitCheck.allowed) {
        return reply.code(429).send({ error: 'Limit exceeded', code: 'LIMIT_EXCEEDED' });
      }

      // Create Session & User Message
      const session = await prisma.chatSession.create({
        data: { userId, mode: mode as ChatMode, title: message.substring(0, 50), sourceUrl, ipAddress },
      });
      await prisma.message.create({
        data: {
          chatSessionId: session.id,
          role: 'USER',
          content: message,
          attachments: imageData ? { create: { type: 'IMAGE', source: captureSource || 'SCREEN', imageData } } : undefined,
        },
      });

      // Prepare Headers for SSE
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const llmMessages: LLMMessage[] = [{ role: 'user', content: message, imageData }];

      // 2. Start Final Answer Generation (Background)
      const finalAnswerPromise = orchestrator.generate(mode as ChatMode, llmMessages);

      // 3. Stream Thoughts (Foreground)
      let thinkingUsage: any = null;
      try {
        for await (const chunk of orchestrator.streamThoughts(llmMessages)) {
          if (typeof chunk === 'string') {
            reply.raw.write(`event: thought\ndata: ${JSON.stringify(chunk)}\n\n`);
          } else {
            // Capture usage object
            thinkingUsage = chunk;
            console.log('[CHAT/START-STREAM] 🧠 Thinking Usage Captured:', thinkingUsage);
          }
        }
      } catch (e) {
        console.error('[CHAT/START-STREAM] Thinking stream error:', e);
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: 'Thinking stream failed' })}\n\n`);
      }

      // 4. Await Final Answer & Save
      const result = await finalAnswerPromise;
      let regionData = null; // Legacy placeholder

      // Save Assistant Messages
      if ((mode === 'EXPERT' || mode === 'REGULAR') && result.providers) {
        for (const provider of result.providers) {
           await prisma.message.create({
            data: {
              chatSessionId: session.id,
              role: 'ASSISTANT',
              content: provider.response.shortAnswer || 'No answer',
              shortAnswer: provider.response.shortAnswer,
              provider: provider.provider.toUpperCase() as any,
              metadata: { 
                ...(provider.error ? { error: provider.error } : {}), 
                tokenUsage: provider.response.tokenUsage as any,
                // Attach thinking usage to GEMINI provider only
                ...(provider.provider.toUpperCase() === 'GEMINI' && thinkingUsage ? { thinkingUsage } : {})
              },
              questionType: provider.response.questionType,
              structuredAnswer: provider.response.structuredAnswer as any,
              confidence: provider.response.confidence,
              questionRegions: regionData as any,
            },
          });
        }
      } else {
        await prisma.message.create({
          data: {
            chatSessionId: session.id,
            role: 'ASSISTANT',
            content: result.primary.shortAnswer || 'No answer',
            shortAnswer: result.primary.shortAnswer,
            metadata: { 
              tokenUsage: result.primary.tokenUsage as any,
              ...(thinkingUsage ? { thinkingUsage } : {})
            },
            provider: 'GEMINI',
            questionType: result.primary.questionType,
            structuredAnswer: result.primary.structuredAnswer as any,
            confidence: result.primary.confidence,
            questionRegions: regionData as any,
          },
        });
      }

      // Usage Tracking
      try {
        const tokenUsage: any = {};
        
        // Add Thinking Usage (Gemini 3 Flash)
        if (thinkingUsage) {
            tokenUsage.gemini3Flash = { 
                input: thinkingUsage.inputTokens, 
                output: thinkingUsage.outputTokens 
            };
        }

        // Add Chat Usage
        if (mode === 'FAST' && result.primary?.tokenUsage) {
            tokenUsage.geminiFlash = { input: result.primary.tokenUsage.inputTokens, output: result.primary.tokenUsage.outputTokens };
        } else if ((mode === 'REGULAR' || mode === 'EXPERT') && result.providers) {
             for (const provider of result.providers) {
                if (provider.response.tokenUsage) {
                  const tokens = provider.response.tokenUsage;
                  if (provider.provider === 'gemini') tokenUsage.geminiPro = { input: tokens.inputTokens, output: tokens.outputTokens };
                  else if (provider.provider === 'openai') tokenUsage.openai = { input: tokens.inputTokens, output: tokens.outputTokens };
                  else if (provider.provider === 'claude') {
                      if (mode === 'EXPERT') tokenUsage.claudeOpus = { input: tokens.inputTokens, output: tokens.outputTokens, thinking: tokens.thinkingTokens };
                      else tokenUsage.claudeSonnet = { input: tokens.inputTokens, output: tokens.outputTokens, thinking: tokens.thinkingTokens };
                  }
                }
             }
        }
        
        await UsageService.incrementSolve(userId, mode as ChatMode, tokenUsage);
      } catch (e) { console.error('Usage tracking failed', e); }

      // Fetch Full Session
      const fullSession = await prisma.chatSession.findUnique({
        where: { id: session.id },
        include: { messages: { include: { attachments: true }, orderBy: { createdAt: 'asc' } } },
      });

      // Send Final Result
      reply.raw.write(`event: result\ndata: ${JSON.stringify(fullSession)}\n\n`);
      reply.raw.write(`event: done\ndata: [DONE]\n\n`);
      reply.raw.end();

    } catch (error: any) {
      console.error('[CHAT/START-STREAM] Critical Error:', error);
      if (!reply.raw.headersSent) {
          return reply.code(500).send({ error: 'Internal server error' });
      } else {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: 'Internal server error' })}\n\n`);
          reply.raw.end();
      }
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
      if ((effectiveMode === 'EXPERT' || effectiveMode === 'REGULAR') && result.providers) {
        // Save all provider responses (no consensus)
        for (const provider of result.providers) {
          // Use structured answer from response
          let structuredAnswer = provider.response.structuredAnswer || null;
          let questionType = provider.response.questionType || null;
          let answerFormat = null;
          let confidence = provider.response.confidence || null;

          await prisma.message.create({
            data: {
              chatSessionId: session.id,
              role: 'ASSISTANT',
              content: provider.response.shortAnswer || 'No answer',
              shortAnswer: provider.response.shortAnswer,
              provider: provider.provider.toUpperCase() as any,
              metadata: { ...(provider.error ? { error: provider.error } : {}), tokenUsage: provider.response.tokenUsage as any },
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
        let structuredAnswer = result.primary.structuredAnswer || null;
        let questionType = result.primary.questionType || null;
        let answerFormat = null;
        let confidence = result.primary.confidence || null;

        await prisma.message.create({
          data: {
            chatSessionId: session.id,
            role: 'ASSISTANT',
            content: result.primary.shortAnswer || 'No answer',
            shortAnswer: result.primary.shortAnswer,
            metadata: { tokenUsage: result.primary.tokenUsage as any },
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

  // POST /chat/:sessionId/interaction - Log a user interaction (e.g. tab switch)
  server.post('/:sessionId/interaction', async (request, reply) => {
    try {
      const { userId } = await authenticate(request);
      const { sessionId } = request.params as { sessionId: string };
      const { type, metadata } = interactionSchema.parse(request.body);

      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
      });

      if (!session || session.userId !== userId) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      await prisma.interaction.create({
        data: {
          chatSessionId: session.id,
          type,
          metadata: metadata || undefined,
        },
      });

      return reply.send({ success: true });
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
