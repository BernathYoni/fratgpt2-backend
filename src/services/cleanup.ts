import { prisma } from '../db/client';

/**
 * Cleanup service for managing data retention
 */
export class CleanupService {
  /**
   * Delete attachments older than 5 days
   * Run this daily via a cron job or scheduled task
   */
  static async deleteOldAttachments(): Promise<number> {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const result = await prisma.attachment.deleteMany({
      where: {
        createdAt: {
          lt: fiveDaysAgo,
        },
      },
    });

    console.log(`Deleted ${result.count} attachments older than 5 days`);
    return result.count;
  }

  /**
   * Clean up old usage records (optional, keep for analytics)
   * Delete usage records older than 90 days
   */
  static async deleteOldUsageRecords(): Promise<number> {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const result = await prisma.usage.deleteMany({
      where: {
        date: {
          lt: ninetyDaysAgo,
        },
      },
    });

    console.log(`Deleted ${result.count} usage records older than 90 days`);
    return result.count;
  }

  /**
   * Run all cleanup tasks
   */
  static async runAll(): Promise<void> {
    console.log('Starting cleanup job...');
    await this.deleteOldAttachments();
    // Optionally uncomment to clean old usage:
    // await this.deleteOldUsageRecords();
    console.log('Cleanup job completed');
  }
}

// If running as a standalone script
if (require.main === module) {
  CleanupService.runAll()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Cleanup failed:', err);
      process.exit(1);
    });
}
