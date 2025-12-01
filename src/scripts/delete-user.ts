import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteUser() {
  try {
    console.log('🔍 Searching for user: Bernath.yoni@gmail.com');
    
    const user = await prisma.user.findUnique({
      where: { email: 'Bernath.yoni@gmail.com' }
    });

    if (!user) {
      console.log('❌ User not found with email: Bernath.yoni@gmail.com');
      return;
    }

    console.log('✓ Found user:', user.email, '(ID:', user.id + ')');
    console.log('🗑️  Deleting user and all associated data...');
    
    const result = await prisma.user.delete({
      where: { email: 'Bernath.yoni@gmail.com' }
    });
    
    console.log('✅ User deleted successfully!');
    console.log('   Email:', result.email);
    console.log('   ID:', result.id);
    console.log('\n📝 Next steps:');
    console.log('   1. Go to https://fratgpt.co/register');
    console.log('   2. Register with email: Bernath.yoni@gmail.com');
    console.log('   3. User will be promoted to ADMIN on next deployment');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

deleteUser();
