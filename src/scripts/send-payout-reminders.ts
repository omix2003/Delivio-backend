/**
 * Script to send payout reminder emails to agents
 * This script should be run on Sundays via cron job
 * 
 * Usage:
 *   npm run send:payout-reminders
 * 
 * Or schedule with cron:
 *   0 9 * * 0 cd /path/to/backend && npm run send:payout-reminders
 *   (Runs every Sunday at 9:00 AM)
 */

import { payoutReminderService } from '../services/payout-reminder.service';
import { logger } from '../lib/logger';

async function main() {
  try {
    console.log('📧 Starting payout reminder email job...');
    console.log(`⏰ Time: ${new Date().toISOString()}\n`);

    const results = await payoutReminderService.sendAllPayoutReminders();

    // Print summary
    console.log('\n📊 Summary:');
    console.log(`   Weekly reminders: ${results.weekly.filter(r => r.success).length} sent, ${results.weekly.filter(r => !r.success).length} failed`);
    console.log(`   Monthly reminders: ${results.monthly.filter(r => r.success).length} sent, ${results.monthly.filter(r => !r.success).length} failed`);

    // Print failures if any
    const allFailures = [
      ...results.weekly.filter(r => !r.success),
      ...results.monthly.filter(r => !r.success),
    ];

    if (allFailures.length > 0) {
      console.log('\n❌ Failed reminders:');
      allFailures.forEach(failure => {
        console.log(`   - ${failure.agentName} (${failure.email}): ${failure.error}`);
      });
    }

    console.log('\n✅ Payout reminder job completed!');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Fatal error in payout reminder job:', error);
    logger.error('[Payout Reminder Script] Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export default main;


