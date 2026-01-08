# Payout Reminder Emails

This document explains how the payout reminder email system works and how to set it up.

## Overview

The payout reminder system sends automated emails to agents on Sundays, informing them about their weekly or monthly earnings and when they will receive their payout.

## Features

- **Weekly Reminders**: Sent to agents with `WEEKLY` payout plan
- **Monthly Reminders**: Sent to agents with `MONTHLY` payout plan
- **Automatic Payment Method Detection**: Uses agent's preferred payment method from their last payout
- **Professional Email Templates**: Branded HTML emails with earnings summary

## Email Content

### Weekly Reminder
- Period: Monday to Sunday of current week
- Total earnings for the week
- Number of deliveries completed
- Payment method and details
- Notification that payout will be transferred on Monday

### Monthly Reminder
- Period: 1st to last day of current month
- Total earnings for the month
- Number of deliveries completed
- Payment method and details
- Notification that payout will be transferred on Monday

## Setup

### Manual Execution

You can manually trigger the payout reminder emails:

```bash
cd backend
npm run send:payout-reminders
```

### Automated Scheduling (Cron Job)

To automatically send emails every Sunday, set up a cron job:

#### Linux/Mac

1. Open crontab:
```bash
crontab -e
```

2. Add the following line (runs every Sunday at 9:00 AM):
```cron
0 9 * * 0 cd /path/to/backend && npm run send:payout-reminders >> /var/log/payout-reminders.log 2>&1
```

#### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create a new task
3. Set trigger: Weekly on Sunday at 9:00 AM
4. Set action: Run program
   - Program: `npm`
   - Arguments: `run send:payout-reminders`
   - Start in: `D:\ads\NextJS\backend`

#### Using PM2 (Recommended for Production)

If you're using PM2, you can create a cron job:

```bash
pm2 start src/scripts/send-payout-reminders.ts --name "payout-reminders" --cron "0 9 * * 0" --no-autorestart
```

## Configuration

### Email Settings

Make sure your SMTP settings are configured in `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=delivionetwork@gmail.com
```

### Time Zone

The script uses the server's local time zone. Make sure your server's time zone is set correctly.

## How It Works

1. **Agent Selection**: The script finds all active, approved agents with email addresses
2. **Payout Calculation**: For each agent, it calculates their earnings based on their payout plan:
   - Weekly: Monday to Sunday of current week
   - Monthly: 1st to last day of current month
3. **Payment Method**: Retrieves the agent's preferred payment method from their last successful payout
4. **Email Sending**: Sends personalized email with earnings summary and payout information
5. **Logging**: Logs all successes and failures for monitoring

## Email Template Features

- **Responsive Design**: Works on desktop and mobile
- **Branded Header**: Includes Delivio logo and gradient header
- **Earnings Summary**: Large, prominent display of total earnings
- **Payment Details**: Shows payment method and account details
- **Clear Call-to-Action**: Informs agent when payout will be processed

## Monitoring

The script logs:
- Number of agents found
- Number of emails sent successfully
- Number of failures
- Individual failure reasons

Check logs for:
```bash
# If using file logging
tail -f /var/log/payout-reminders.log

# If using PM2
pm2 logs payout-reminders
```

## Troubleshooting

### Emails Not Sending

1. Check SMTP configuration in `.env`
2. Verify email credentials are correct
3. Check server logs for errors
4. Test email service manually:
   ```bash
   npm run send:payout-reminders
   ```

### Agents Not Receiving Emails

1. Verify agent has valid email address
2. Check agent is approved and not blocked
3. Verify agent has earnings > 0 for the period
4. Check spam folder

### Payment Method Not Showing

- If agent has no previous payouts, defaults to "UPI - Not configured"
- Agent should complete at least one payout to set preferred method

## API Usage

You can also trigger reminders programmatically:

```typescript
import { payoutReminderService } from './services/payout-reminder.service';

// Send all reminders
const results = await payoutReminderService.sendAllPayoutReminders();

// Send only weekly reminders
const weeklyResults = await payoutReminderService.sendWeeklyPayoutReminders();

// Send only monthly reminders
const monthlyResults = await payoutReminderService.sendMonthlyPayoutReminders();
```

## Notes

- Emails are sent on Sunday, informing agents that payout will be processed on Monday
- Only agents with earnings > 0 receive emails
- Payment method is retrieved from the last successful payout
- All errors are logged but don't stop the process for other agents


