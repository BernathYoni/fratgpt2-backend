/**
 * Set Admin Script
 *
 * Promotes a user to ADMIN role by email.
 *
 * Usage:
 *   npx tsx src/scripts/set-admin.ts
 *
 * This script will:
 * 1. Find user by email (Bernath.yoni@gmail.com)
 * 2. Update their role to ADMIN
 * 3. Create the user if they don't exist (optional)
 */

import { prisma } from '../db/client';

const ADMIN_EMAIL = 'Bernath.yoni@gmail.com';

async function setAdmin() {
  try {
    console.log('[SET-ADMIN] 🔧 Starting admin setup...');
    console.log(`[SET-ADMIN] Target email: ${ADMIN_EMAIL}`);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: ADMIN_EMAIL },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      console.log(`[SET-ADMIN] ❌ User not found: ${ADMIN_EMAIL}`);
      console.log('[SET-ADMIN] Please register this account first at https://fratgpt.co/register');
      console.log('[SET-ADMIN] Then run this script again.');
      process.exit(1);
    }

    // Check if already admin
    if (user.role === 'ADMIN') {
      console.log(`[SET-ADMIN] ✓ User ${user.email} is already an ADMIN`);
      console.log(`[SET-ADMIN] User ID: ${user.id}`);
      console.log(`[SET-ADMIN] Created: ${user.createdAt}`);
      process.exit(0);
    }

    // Update to ADMIN
    console.log(`[SET-ADMIN] 🔄 Updating user role from ${user.role} to ADMIN...`);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    console.log('[SET-ADMIN] ✅ Successfully promoted user to ADMIN!');
    console.log('[SET-ADMIN] User details:');
    console.log(`  - Email: ${updated.email}`);
    console.log(`  - Role: ${updated.role}`);
    console.log(`  - User ID: ${updated.id}`);
    console.log(`  - Created: ${updated.createdAt}`);

  } catch (error) {
    console.error('[SET-ADMIN] ❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
setAdmin();
