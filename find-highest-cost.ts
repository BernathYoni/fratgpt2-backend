#!/usr/bin/env tsx

/**
 * Find the highest cost per solve/chat session
 *
 * This script analyzes the Usage table to find:
 * 1. The single most expensive solve that has occurred
 * 2. Which mode it was (FAST, REGULAR, or EXPERT)
 * 3. Token breakdown per provider
 * 4. When it occurred
 */

import { prisma } from './src/db/client';
import { CostCalculator } from './src/utils/costCalculator';

interface UsageRecord {
  id: string;
  userId: string;
  date: Date;
  solvesUsed: number;
  modeRegularCount: number;
  modeFastCount: number;
  modeExpertCount: number;
  geminiFlashInputTokens: number;
  geminiFlashOutputTokens: number;
  geminiFlashCost: number;
  geminiProInputTokens: number;
  geminiProOutputTokens: number;
  geminiProCost: number;
  openaiInputTokens: number;
  openaiOutputTokens: number;
  openaiCost: number;
  claudeInputTokens: number;
  claudeOutputTokens: number;
  claudeThinkingTokens: number;
  claudeCost: number;
  totalMonthlyCost: number;
}

async function findHighestCostSolve() {
  console.log('🔍 Searching for highest cost per solve...\n');

  // Get all usage records
  const allUsage = await prisma.usage.findMany({
    orderBy: { date: 'desc' },
    include: {
      user: {
        select: {
          email: true,
          role: true,
        }
      }
    }
  });

  if (allUsage.length === 0) {
    console.log('❌ No usage records found in database');
    return;
  }

  console.log(`📊 Total usage records: ${allUsage.length}`);
  console.log(`📅 Date range: ${allUsage[allUsage.length - 1].date.toISOString().split('T')[0]} to ${allUsage[0].date.toISOString().split('T')[0]}\n`);

  // Calculate cost per solve for each record
  interface SolveAnalysis {
    record: typeof allUsage[0];
    costPerSolve: number;
    mode: string;
    breakdown: {
      geminiFlash: number;
      geminiPro: number;
      openai: number;
      claude: number;
    };
  }

  const solveAnalyses: SolveAnalysis[] = [];

  for (const record of allUsage) {
    if (record.solvesUsed === 0) continue;

    const costPerSolve = record.totalMonthlyCost / record.solvesUsed;

    // Determine predominant mode
    let mode = 'MIXED';
    if (record.modeExpertCount > 0 && record.modeExpertCount === record.solvesUsed) {
      mode = 'EXPERT';
    } else if (record.modeRegularCount > 0 && record.modeRegularCount === record.solvesUsed) {
      mode = 'REGULAR';
    } else if (record.modeFastCount > 0 && record.modeFastCount === record.solvesUsed) {
      mode = 'FAST';
    }

    solveAnalyses.push({
      record,
      costPerSolve,
      mode,
      breakdown: {
        geminiFlash: record.geminiFlashCost / record.solvesUsed,
        geminiPro: record.geminiProCost / record.solvesUsed,
        openai: record.openaiCost / record.solvesUsed,
        claude: record.claudeCost / record.solvesUsed,
      }
    });
  }

  // Sort by cost per solve
  solveAnalyses.sort((a, b) => b.costPerSolve - a.costPerSolve);

  // Display top 10 most expensive solves
  console.log('=' .repeat(80));
  console.log('🔥 TOP 10 MOST EXPENSIVE SOLVES (COST PER SOLVE)');
  console.log('='.repeat(80));

  for (let i = 0; i < Math.min(10, solveAnalyses.length); i++) {
    const analysis = solveAnalyses[i];
    const record = analysis.record;

    console.log(`\n#${i + 1} - $${analysis.costPerSolve.toFixed(4)} per solve`);
    console.log(`   📅 Date: ${record.date.toISOString().split('T')[0]}`);
    console.log(`   👤 User: ${record.user.email} (${record.user.role})`);
    console.log(`   🎯 Mode: ${analysis.mode}`);
    console.log(`   📊 Solves on this day: ${record.solvesUsed}`);
    console.log(`   💰 Total cost for day: $${record.totalMonthlyCost.toFixed(4)}`);
    console.log(`   🔢 Mode breakdown: ${record.modeFastCount} Fast, ${record.modeRegularCount} Regular, ${record.modeExpertCount} Expert`);
    console.log(`   \n   💸 Cost breakdown per solve:`);
    console.log(`      Gemini Flash: $${analysis.breakdown.geminiFlash.toFixed(4)}`);
    console.log(`      Gemini Pro:   $${analysis.breakdown.geminiPro.toFixed(4)}`);
    console.log(`      OpenAI:       $${analysis.breakdown.openai.toFixed(4)}`);
    console.log(`      Claude:       $${analysis.breakdown.claude.toFixed(4)}`);
    console.log(`   \n   🎫 Token counts (for day):`);
    console.log(`      Gemini Flash: ${record.geminiFlashInputTokens} in, ${record.geminiFlashOutputTokens} out`);
    console.log(`      Gemini Pro:   ${record.geminiProInputTokens} in, ${record.geminiProOutputTokens} out`);
    console.log(`      OpenAI:       ${record.openaiInputTokens} in, ${record.openaiOutputTokens} out`);
    console.log(`      Claude:       ${record.claudeInputTokens} in, ${record.claudeOutputTokens} out, ${record.claudeThinkingTokens} thinking`);
  }

  // Display summary statistics
  console.log('\n' + '='.repeat(80));
  console.log('📈 SUMMARY STATISTICS');
  console.log('='.repeat(80));

  const totalSolves = allUsage.reduce((sum, r) => sum + r.solvesUsed, 0);
  const totalCost = allUsage.reduce((sum, r) => sum + r.totalMonthlyCost, 0);
  const avgCostPerSolve = totalCost / totalSolves;

  console.log(`\n💰 Total cost across all records: $${totalCost.toFixed(2)}`);
  console.log(`🔢 Total solves: ${totalSolves}`);
  console.log(`📊 Average cost per solve: $${avgCostPerSolve.toFixed(4)}`);
  console.log(`🔥 Highest cost per solve: $${solveAnalyses[0].costPerSolve.toFixed(4)}`);
  console.log(`💚 Lowest cost per solve: $${solveAnalyses[solveAnalyses.length - 1].costPerSolve.toFixed(4)}`);

  // Mode breakdown
  const modeStats = {
    fast: allUsage.reduce((sum, r) => sum + r.modeFastCount, 0),
    regular: allUsage.reduce((sum, r) => sum + r.modeRegularCount, 0),
    expert: allUsage.reduce((sum, r) => sum + r.modeExpertCount, 0),
  };

  console.log(`\n📊 Mode usage breakdown:`);
  console.log(`   FAST:    ${modeStats.fast} solves`);
  console.log(`   REGULAR: ${modeStats.regular} solves`);
  console.log(`   EXPERT:  ${modeStats.expert} solves`);

  console.log('\n✅ Analysis complete!\n');

  await prisma.$disconnect();
}

findHighestCostSolve().catch((error) => {
  console.error('❌ Error running analysis:', error);
  process.exit(1);
});
