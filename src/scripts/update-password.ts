import { prisma } from '../db/client';
import bcrypt from 'bcrypt';

const ADMIN_EMAIL = 'bernath.yoni@gmail.com';
const NEW_PASSWORD = 'Turt!e10';

async function updatePassword() {
  try {
    console.log('[UPDATE-PASSWORD] 🔧 Updating password...');
    console.log(`[UPDATE-PASSWORD] Target email: ${ADMIN_EMAIL}`);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: ADMIN_EMAIL },
    });

    if (!user) {
      console.log(`[UPDATE-PASSWORD] ❌ User not found: ${ADMIN_EMAIL}`);
      process.exit(1);
    }

    console.log('[UPDATE-PASSWORD] ✓ User found');
    console.log('[UPDATE-PASSWORD] 🔐 Hashing new password...');

    // Hash the new password
    const hashedPassword = await bcrypt.hash(NEW_PASSWORD, 10);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashedPassword },
    });

    console.log('[UPDATE-PASSWORD] ✅ Password updated successfully!');
    console.log('[UPDATE-PASSWORD] Account details:');
    console.log(`  - Email: ${user.email}`);
    console.log(`  - New Password: ${NEW_PASSWORD}`);
    console.log(`  - Role: ${user.role}`);
    console.log('\n[UPDATE-PASSWORD] 📝 You can now login at:');
    console.log('  https://fratgpt.co/login');

  } catch (error) {
    console.error('[UPDATE-PASSWORD] ❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

updatePassword();
