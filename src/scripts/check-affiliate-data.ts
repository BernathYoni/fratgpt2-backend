
import { prisma } from '../db/client';

async function checkData() {
  const email = 'gmail@gmail.com';
  const affiliateCode = 'REF-XQ1Y1C';

  console.log('--- Checking User ---');
  const user = await prisma.user.findUnique({
    where: { email },
    include: { affiliate: true, subscriptions: true }
  });
  console.log('User:', user ? {
    id: user.id,
    email: user.email,
    affiliateId: user.affiliateId,
    affiliate: user.affiliate,
    subscriptions: user.subscriptions
  } : 'Not found');

  console.log('\n--- Checking Affiliate ---');
  const affiliate = await prisma.affiliate.findUnique({
    where: { code: affiliateCode },
    include: { _count: { select: { referredUsers: true } } }
  });
  console.log('Affiliate:', affiliate);
}

checkData()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
