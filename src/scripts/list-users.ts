import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function listUsers() {
  try {
    console.log('📋 Listing all users in database:\n');

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    if (users.length === 0) {
      console.log('❌ No users found in database');
      console.log('\n📝 Create the first admin user:');
      console.log('   1. Go to https://fratgpt.co/register');
      console.log('   2. Register with: Bernath.yoni@gmail.com');
      return;
    }

    let counter = 1;
    for (const user of users) {
      console.log(counter + '. ' + user.email);
      console.log('   Role: ' + user.role);
      console.log('   ID: ' + user.id);
      console.log('   Created: ' + user.createdAt.toISOString());
      console.log('');
      counter++;
    }

    console.log('Total users: ' + users.length);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

listUsers();
