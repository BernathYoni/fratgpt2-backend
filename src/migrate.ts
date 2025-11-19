import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runMigrations() {
  try {
    console.log('🔄 Running database migrations...');
    await execAsync('npx prisma migrate deploy');
    console.log('✅ Migrations completed successfully');

    console.log('🌱 Seeding database...');
    await execAsync('npx tsx src/seed.ts');
    console.log('✅ Database seeded successfully');
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    // Don't exit - let the server start anyway
  }
}

runMigrations();
