import { prisma } from './db/client';
import { hashPassword } from './utils/auth';
import { COMMON_US_COLLEGES } from './services/collegeSeeds';

/**
 * Seed script for development
 * Creates test users with different subscription plans
 */

async function main() {
  console.log('🌱 Seeding database...');

  // Create test users
  const users = [
    {
      email: 'free@test.com',
      password: 'password123',
      plan: 'FREE' as const,
    },
    {
      email: 'basic@test.com',
      password: 'password123',
      plan: 'BASIC' as const,
    },
    {
      email: 'pro@test.com',
      password: 'password123',
      plan: 'PRO' as const,
    },
  ];

  for (const userData of users) {
    const passwordHash = await hashPassword(userData.password);

    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {},
      create: {
        email: userData.email,
        passwordHash,
        subscriptions: {
          create: {
            plan: userData.plan,
            status: 'ACTIVE',
          },
        },
      },
    });

    console.log(`✅ Created user: ${user.email} (${userData.plan})`);
  }

  // Create some usage data for testing
  const freeUser = await prisma.user.findUnique({ where: { email: 'free@test.com' } });
  if (freeUser) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await prisma.usage.upsert({
      where: {
        userId_date: {
          userId: freeUser.id,
          date: today,
        },
      },
      update: {},
      create: {
        userId: freeUser.id,
        date: today,
        solvesUsed: 5,
        modeRegularCount: 3,
        modeFastCount: 2,
        modeExpertCount: 0,
        tokensUsed: 5000,
      },
    });

    console.log(`✅ Created usage data for free@test.com (5/20 solves used)`);
  }

  // Seed colleges
  console.log('');
  console.log('🏫 Seeding colleges...');
  let collegeCount = 0;
  for (const collegeData of COMMON_US_COLLEGES) {
    await prisma.college.upsert({
      where: { name: collegeData.name },
      update: {},
      create: {
        name: collegeData.name,
        state: collegeData.state,
        city: collegeData.city,
      },
    });
    collegeCount++;
  }
  console.log(`✅ Created ${collegeCount} colleges`);

  console.log('');
  console.log('🎉 Seed complete!');
  console.log('');
  console.log('Test accounts:');
  console.log('  free@test.com / password123  (Free plan, 20/day)');
  console.log('  basic@test.com / password123 (Basic plan, 50/day)');
  console.log('  pro@test.com / password123   (Pro plan, 500/day)');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
