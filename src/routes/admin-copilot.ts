import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import OpenAI from 'openai';
import { prisma } from '../db/client';
import { requireAdmin } from '../middleware/requireAdmin';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string().nullable(),
    tool_calls: z.array(z.any()).optional(),
    tool_call_id: z.string().optional(),
    name: z.string().optional()
  }))
});

export async function adminCopilotRoutes(server: FastifyInstance) {
  server.post('/copilot/chat', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { messages } = chatSchema.parse(request.body);
      const user = (request as any).user;

      // Define Tools
      const tools = [
        {
          type: "function",
          function: {
            name: "get_daily_stats",
            description: "Get signups, revenue estimate, and total solves for a specific date.",
            parameters: {
              type: "object",
              properties: {
                date: { type: "string", description: "ISO date string (YYYY-MM-DD)" }
              },
              required: ["date"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "search_user",
            description: "Find a user by email and get their plan and usage stats.",
            parameters: {
              type: "object",
              properties: {
                email: { type: "string" }
              },
              required: ["email"]
            }
          }
        },
        {
            type: "function",
            function: {
                name: "get_recent_logs",
                description: "Get the most recent system logs (solves, errors).",
                parameters: {
                    type: "object",
                    properties: {
                        limit: { type: "number", description: "Number of logs to fetch (max 20)" }
                    }
                }
            }
        }
      ];

      // Call OpenAI
      // Using gpt-4o as it is the current flagship model supporting tools reliably.
      const runner = await openai.chat.completions.create({
        model: "gpt-4o", 
        messages: [
          { role: "system", content: "You are the FratGPT Admin Copilot. You have read-only access to the database via tools. Answer the admin's questions about business metrics, users, and logs accurately. Keep answers concise." },
          ...messages as any
        ],
        tools: tools as any,
        tool_choice: "auto",
      });

      const responseMessage = runner.choices[0].message;
      let finalContent = responseMessage.content;

      // Track Cost (Input + Output)
      if (runner.usage) {
         await incrementAdminCost(user.id, runner.usage.prompt_tokens, runner.usage.completion_tokens);
      }

      // Handle Tool Calls
      if (responseMessage.tool_calls) {
        const toolMessages = [responseMessage];
        
        for (const toolCall of responseMessage.tool_calls) {
          const fnName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          let result = "Error: Tool failed";

          try {
            if (fnName === 'get_daily_stats') {
               result = await getDailyStats(args.date);
            } else if (fnName === 'search_user') {
               result = await searchUser(args.email);
            } else if (fnName === 'get_recent_logs') {
               result = await getRecentLogs(args.limit || 5);
            }
          } catch (e: any) {
            result = `Error: ${e.message}`;
          }

          toolMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          } as any);
        }

        // Second API Call with Tool Results
        const secondRunner = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are the FratGPT Admin Copilot. You have read-only access to the database via tools. Answer the admin's questions about business metrics, users, and logs accurately. Keep answers concise." },
                ...messages as any,
                ...toolMessages
            ]
        });
        
        finalContent = secondRunner.choices[0].message.content;
        
        if (secondRunner.usage) {
            await incrementAdminCost(user.id, secondRunner.usage.prompt_tokens, secondRunner.usage.completion_tokens);
        }
      }

      return reply.send({ role: 'assistant', content: finalContent });

    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Copilot Error' });
    }
  });
}

// Helper Functions (The "Tools")
async function getDailyStats(dateStr: string) {
    const start = new Date(dateStr);
    start.setHours(0,0,0,0);
    const end = new Date(dateStr);
    end.setHours(23,59,59,999);

    const signups = await prisma.user.count({ where: { createdAt: { gte: start, lte: end } } });
    const usage = await prisma.usage.aggregate({
        where: { date: { gte: start, lte: end } },
        _sum: { solvesUsed: true, totalMonthlyCost: true }
    });

    return JSON.stringify({
        date: dateStr,
        new_users: signups,
        total_solves: usage._sum.solvesUsed || 0,
        total_ai_cost: usage._sum.totalMonthlyCost || 0
    });
}

async function searchUser(email: string) {
    const user = await prisma.user.findUnique({
        where: { email },
        include: { subscriptions: true }
    });
    if (!user) return "User not found";
    return JSON.stringify({
        id: user.id,
        email: user.email,
        role: user.role,
        plan: user.subscriptions[0]?.plan || "FREE",
        joined: user.createdAt
    });
}

async function getRecentLogs(limit: number) {
    const logs = await prisma.message.findMany({
        where: { role: 'USER' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
            id: true,
            createdAt: true,
            content: true,
            chatSession: { select: { mode: true, user: { select: { email: true } } } }
        }
    });
    return JSON.stringify(logs);
}

async function incrementAdminCost(userId: string, input: number, output: number) {
    const today = new Date();
    // Normalize to midnight UTC to match other usage records
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    
    // Admin Pricing (approx $1.25 in / $10 out per 1M)
    const cost = (input / 1000000 * 1.25) + (output / 1000000 * 10.00);

    // Update Usage
    await prisma.usage.upsert({
        where: { userId_date: { userId, date } },
        create: {
            userId, date,
            adminChatbotInputTokens: input,
            adminChatbotOutputTokens: output,
            adminChatbotCost: cost,
            totalMonthlyCost: cost 
        },
        update: {
            adminChatbotInputTokens: { increment: input },
            adminChatbotOutputTokens: { increment: output },
            adminChatbotCost: { increment: cost },
            totalMonthlyCost: { increment: cost }
        }
    });

    // Update AdminStats
    await prisma.adminStats.upsert({
        where: { date },
        create: {
            date,
            adminChatbotInputTokens: input,
            adminChatbotOutputTokens: output,
            adminChatbotCost: cost,
            totalMonthlyCost: cost
        },
        update: {
            adminChatbotInputTokens: { increment: input },
            adminChatbotOutputTokens: { increment: output },
            adminChatbotCost: { increment: cost },
            totalMonthlyCost: { increment: cost }
        }
    });
}
