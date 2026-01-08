import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';

interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename?: string;
    path?: string;
    cid?: string;
    href?: string;
  }>;
}

class MailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    // Check if email configuration is available
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;
      const smtpFrom = process.env.SMTP_FROM || smtpUser || 'delivionetwork@gmail.com';

    // If SMTP is not configured, create a test transporter (for development)
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPassword) {
      console.warn('⚠️  SMTP configuration not found. Email service will use test account.');
      // Create a test account for development (ethereal.email)
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        auth: {
          user: 'ethereal.user@ethereal.email',
          pass: 'ethereal.pass',
        },
      });
      return;
    }

    // Create production transporter
    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort, 10),
      secure: parseInt(smtpPort, 10) === 465, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
      // For Gmail and similar services
      ...(smtpHost.includes('gmail') && {
        service: 'gmail',
      }),
    });
  }

  async sendMail(options: MailOptions): Promise<boolean> {
    try {
      if (!this.transporter) {
        console.error('❌ Mail transporter not initialized');
        return false;
      }

      const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER || 'delivionetwork@gmail.com';

      const mailOptions = {
        from: `Delivio <${smtpFrom}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || this.stripHtml(options.html),
        attachments: options.attachments || [],
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully to ${options.to}:`, info.messageId);
      return true;
    } catch (error: any) {
      console.error('❌ Error sending email:', error);
      // Don't throw error - just log it so registration can continue
      return false;
    }
  }

  /**
   * Get logo as attachment with CID for embedding in emails
   * Falls back to external URL if file cannot be read
   */
  private async getLogoAttachment(): Promise<{ cid: string; url: string }> {
    const cid = 'delivio-logo@delivio';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const logoUrl = `${frontendUrl}/logo.png`;

    // Try to read logo from next-app public folder (relative to backend)
    const logoPath = path.join(process.cwd(), '..', 'next-app', 'public', 'logo.png');
    
    try {
      if (fs.existsSync(logoPath)) {
        console.log(`✅ Logo found at: ${logoPath}`);
        return {
          cid,
          url: `cid:${cid}`, // Use CID for attachment
        };
      } else {
        console.warn(`⚠️  Logo not found at: ${logoPath}, using external URL: ${logoUrl}`);
      }
    } catch (error) {
      console.warn('⚠️  Could not read logo file, using external URL:', error);
    }

    // Fallback to external URL
    return { cid, url: logoUrl };
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  }

  async sendOTPEmail(email: string, otp: string, name: string): Promise<boolean> {
    const logoInfo = await this.getLogoAttachment();
    const logoPath = path.join(process.cwd(), '..', 'next-app', 'public', 'logo.png');
    const attachments: MailOptions['attachments'] = [];
    
    // Try to attach logo if file exists
    try {
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: 'logo.png',
          path: logoPath,
          cid: logoInfo.cid,
        });
      }
    } catch (error) {
      // Continue without attachment, will use external URL
    }
    
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Email Verification - Delivio</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1F3C88 0%, #2FBF71 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <img src="${logoInfo.url}" alt="Delivio Logo" style="max-width: 180px; height: auto; margin-bottom: 15px;" />
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Delivery Management Platform</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
            <h2 style="color: #333; margin-top: 0;">Verify Your Email Address</h2>
            
            <p>Hello ${name},</p>
            
            <p>Thank you for registering with Delivio! To complete your registration, please verify your email address using the OTP below:</p>
            
            <div style="background: white; border: 2px dashed #1F3C88; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
              <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">Your Verification Code</p>
              <h1 style="margin: 0; color: #1F3C88; font-size: 36px; letter-spacing: 8px; font-weight: bold;">${otp}</h1>
            </div>
            
            <p style="color: #666; font-size: 14px;">This code will expire in <strong>10 minutes</strong>. Please enter it in the verification page to complete your registration.</p>
            
            <p style="color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
              If you didn't create an account with Delivio, please ignore this email.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>&copy; ${new Date().getFullYear()} Delivio. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    return this.sendMail({
      to: email,
      subject: 'Verify Your Email - Delivio',
      html,
      attachments,
    });
  }

  async sendWelcomeEmail(
    email: string,
    name: string,
    role: 'AGENT' | 'PARTNER' | 'LOGISTICS_PROVIDER'
  ): Promise<boolean> {
    const logoInfo = await this.getLogoAttachment();
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const logoPath = path.join(process.cwd(), '..', 'next-app', 'public', 'logo.png');
    const attachments: MailOptions['attachments'] = [];
    
    // Try to attach logo if file exists
    try {
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: 'logo.png',
          path: logoPath,
          cid: logoInfo.cid,
        });
      }
    } catch (error) {
      // Continue without attachment, will use external URL
    }
    
    const roleInfo = {
      AGENT: {
        title: 'Delivery Agent',
        description: 'You can now start accepting delivery orders and earn money!',
        nextSteps: [
          'Complete your profile and upload required documents',
          'Get approved by our admin team',
          'Go online and start accepting orders',
        ],
      },
      PARTNER: {
        title: 'Business Partner',
        description: 'You can now start creating and managing delivery orders!',
        nextSteps: [
          'Set up your business profile',
          'Configure your API keys and webhooks',
          'Start creating delivery orders',
        ],
      },
      LOGISTICS_PROVIDER: {
        title: 'Logistics Provider',
        description: 'You can now manage multi-leg deliveries and warehouses!',
        nextSteps: [
          'Set up your warehouses',
          'Configure your logistics network',
          'Start managing multi-leg deliveries',
        ],
      },
    };

    const info = roleInfo[role];

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to Delivio</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1F3C88 0%, #2FBF71 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <img src="${logoInfo.url}" alt="Delivio Logo" style="max-width: 180px; height: auto; margin-bottom: 15px;" />
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to Delivio!</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Your account has been verified</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
            <h2 style="color: #333; margin-top: 0;">Hello ${name}! 👋</h2>
            
            <p>Congratulations! Your email has been successfully verified and your account is now active.</p>
            
            <div style="background: white; border-left: 4px solid #1F3C88; padding: 20px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1F3C88;">You're now a ${info.title}</h3>
              <p style="margin-bottom: 0;">${info.description}</p>
            </div>
            
            <h3 style="color: #333;">Next Steps:</h3>
            <ul style="color: #666;">
              ${info.nextSteps.map((step) => `<li style="margin-bottom: 10px;">${step}</li>`).join('')}
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${frontendUrl}/login" 
                 style="display: inline-block; background: #1F3C88; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                Login to Your Account
              </a>
            </div>
            
            <p style="color: #666; font-size: 14px; margin-top: 30px;">
              If you have any questions or need assistance, please don't hesitate to contact our support team.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>&copy; ${new Date().getFullYear()} Delivio. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    return this.sendMail({
      to: email,
      subject: 'Welcome to Delivio - Your Account is Verified!',
      html,
      attachments,
    });
  }

  async sendContactEmail(data: {
    name: string;
    email: string;
    phone: string;
    subject: string;
    message: string;
  }): Promise<boolean> {
    const adminEmail = process.env.CONTACT_EMAIL || process.env.SMTP_USER || 'delivionetwork@gmail.com';
    const logoInfo = await this.getLogoAttachment();
    const logoPath = path.join(process.cwd(), '..', 'next-app', 'public', 'logo.png');
    const attachments: MailOptions['attachments'] = [];
    
    // Try to attach logo if file exists
    try {
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: 'logo.png',
          path: logoPath,
          cid: logoInfo.cid,
        });
      }
    } catch (error) {
      // Continue without attachment, will use external URL
    }
    
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Contact Form Submission - Delivio</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1F3C88 0%, #2FBF71 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <img src="${logoInfo.url}" alt="Delivio Logo" style="max-width: 180px; height: auto; margin-bottom: 15px;" />
            <h1 style="color: white; margin: 0; font-size: 28px;">New Contact Form Submission</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Delivio Contact Form</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #333; margin-top: 0; border-bottom: 2px solid #1F3C88; padding-bottom: 10px;">Contact Details</h2>
              
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #666; width: 120px;">Name:</td>
                  <td style="padding: 8px 0; color: #333;">${data.name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #666;">Email:</td>
                  <td style="padding: 8px 0; color: #333;">
                    <a href="mailto:${data.email}" style="color: #1F3C88; text-decoration: none;">${data.email}</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #666;">Phone:</td>
                  <td style="padding: 8px 0; color: #333;">
                    ${data.phone !== 'Not provided' ? `<a href="tel:${data.phone}" style="color: #1F3C88; text-decoration: none;">${data.phone}</a>` : 'Not provided'}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #666;">Subject:</td>
                  <td style="padding: 8px 0; color: #333;">${data.subject}</td>
                </tr>
              </table>
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 8px;">
              <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #1F3C88; padding-bottom: 10px;">Message</h3>
              <p style="color: #666; white-space: pre-wrap; line-height: 1.8;">${data.message}</p>
            </div>
            
            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center;">
              <p style="color: #999; font-size: 12px; margin: 0;">
                This email was sent from the Delivio contact form.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;

    return this.sendMail({
      to: adminEmail,
      subject: `Contact Form: ${data.subject} - ${data.name}`,
      html,
      attachments,
      text: `
New Contact Form Submission

Name: ${data.name}
Email: ${data.email}
Phone: ${data.phone}
Subject: ${data.subject}

Message:
${data.message}
      `,
    });
  }

  /**
   * Send weekly payout reminder email to agent
   * Sent on Sunday, informing about earnings for the week
   */
  async sendWeeklyPayoutReminder(data: {
    email: string;
    name: string;
    amount: number;
    periodStart: Date;
    periodEnd: Date;
    orderCount: number;
    paymentMethod: string;
    paymentDetails?: string; // UPI ID, Bank Account, etc.
  }): Promise<boolean> {
    const logoInfo = await this.getLogoAttachment();
    const logoPath = path.join(process.cwd(), '..', 'next-app', 'public', 'logo.png');
    const attachments: MailOptions['attachments'] = [];
    
    try {
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: 'logo.png',
          path: logoPath,
          cid: logoInfo.cid,
        });
      }
    } catch (error) {
      // Continue without attachment
    }

    const formatDate = (date: Date): string => {
      return date.toLocaleDateString('en-IN', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    };

    const formatCurrency = (amount: number): string => {
      return `₹${amount.toFixed(2)}`;
    };

    const formatPaymentMethod = (method: string): string => {
      const methods: Record<string, string> = {
        'BANK_TRANSFER': 'Bank Transfer',
        'UPI': 'UPI',
        'MOBILE_MONEY': 'Mobile Money',
      };
      return methods[method] || method;
    };

    const mondayDate = new Date(data.periodEnd);
    mondayDate.setDate(mondayDate.getDate() + 1); // Next day (Monday)

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Weekly Payout Reminder - Delivio</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1F3C88 0%, #2FBF71 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <img src="${logoInfo.url}" alt="Delivio Logo" style="max-width: 180px; height: auto; margin-bottom: 15px;" />
            <h1 style="color: white; margin: 0; font-size: 28px;">Weekly Payout Reminder</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Your earnings summary</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
            <h2 style="color: #333; margin-top: 0;">Hello ${data.name}! 👋</h2>
            
            <p>Great news! Here's your weekly earnings summary for the period:</p>
            
            <div style="background: white; border-left: 4px solid #2FBF71; padding: 20px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0 0 10px 0; color: #666; font-size: 14px; font-weight: bold;">Period</p>
              <p style="margin: 0; color: #333; font-size: 16px;">
                ${formatDate(data.periodStart)} - ${formatDate(data.periodEnd)}
              </p>
            </div>

            <div style="background: linear-gradient(135deg, #2FBF71 0%, #1F3C88 100%); padding: 25px; border-radius: 8px; margin: 25px 0; text-align: center;">
              <p style="margin: 0 0 10px 0; color: rgba(255,255,255,0.9); font-size: 14px;">Total Earnings This Week</p>
              <h1 style="margin: 0; color: white; font-size: 42px; font-weight: bold;">${formatCurrency(data.amount)}</h1>
              <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">${data.orderCount} ${data.orderCount === 1 ? 'delivery' : 'deliveries'} completed</p>
            </div>

            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0;">
              <div style="display: flex; align-items: center; margin-bottom: 10px;">
                <span style="font-size: 24px; margin-right: 10px;">💰</span>
                <h3 style="margin: 0; color: #856404;">Payout Information</h3>
              </div>
              <p style="margin: 10px 0; color: #856404;">
                <strong>Your payout of ${formatCurrency(data.amount)} will be transferred to your preferred payment method on Monday, ${formatDate(mondayDate)}.</strong>
              </p>
              <p style="margin: 10px 0 0 0; color: #856404; font-size: 14px;">
                Payment Method: <strong>${formatPaymentMethod(data.paymentMethod)}</strong>
                ${data.paymentDetails ? `<br/>Details: <strong>${data.paymentDetails}</strong>` : ''}
              </p>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e0e0e0;">
              <h3 style="color: #333; margin-top: 0;">What's Next?</h3>
              <ul style="color: #666; padding-left: 20px;">
                <li style="margin-bottom: 8px;">Your earnings will be processed automatically on Monday</li>
                <li style="margin-bottom: 8px;">You'll receive a confirmation once the transfer is complete</li>
                <li style="margin-bottom: 8px;">Keep delivering to earn more next week!</li>
              </ul>
            </div>

            <p style="color: #666; font-size: 14px; margin-top: 30px;">
              If you have any questions about your payout, please contact our support team.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>&copy; ${new Date().getFullYear()} Delivio. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    return this.sendMail({
      to: data.email,
      subject: `Weekly Payout Reminder - ${formatCurrency(data.amount)} | Delivio`,
      html,
      attachments,
    });
  }

  /**
   * Send monthly payout reminder email to agent
   * Sent on Sunday before month-end, informing about earnings for the month
   */
  async sendMonthlyPayoutReminder(data: {
    email: string;
    name: string;
    amount: number;
    periodStart: Date;
    periodEnd: Date;
    orderCount: number;
    paymentMethod: string;
    paymentDetails?: string; // UPI ID, Bank Account, etc.
  }): Promise<boolean> {
    const logoInfo = await this.getLogoAttachment();
    const logoPath = path.join(process.cwd(), '..', 'next-app', 'public', 'logo.png');
    const attachments: MailOptions['attachments'] = [];
    
    try {
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: 'logo.png',
          path: logoPath,
          cid: logoInfo.cid,
        });
      }
    } catch (error) {
      // Continue without attachment
    }

    const formatDate = (date: Date): string => {
      return date.toLocaleDateString('en-IN', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    };

    const formatCurrency = (amount: number): string => {
      return `₹${amount.toFixed(2)}`;
    };

    const formatPaymentMethod = (method: string): string => {
      const methods: Record<string, string> = {
        'BANK_TRANSFER': 'Bank Transfer',
        'UPI': 'UPI',
        'MOBILE_MONEY': 'Mobile Money',
      };
      return methods[method] || method;
    };

    const mondayDate = new Date(data.periodEnd);
    mondayDate.setDate(mondayDate.getDate() + 1); // Next day (Monday)

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Monthly Payout Reminder - Delivio</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1F3C88 0%, #2FBF71 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <img src="${logoInfo.url}" alt="Delivio Logo" style="max-width: 180px; height: auto; margin-bottom: 15px;" />
            <h1 style="color: white; margin: 0; font-size: 28px;">Monthly Payout Reminder</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Your monthly earnings summary</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
            <h2 style="color: #333; margin-top: 0;">Hello ${data.name}! 👋</h2>
            
            <p>Excellent work this month! Here's your monthly earnings summary:</p>
            
            <div style="background: white; border-left: 4px solid #1F3C88; padding: 20px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0 0 10px 0; color: #666; font-size: 14px; font-weight: bold;">Period</p>
              <p style="margin: 0; color: #333; font-size: 16px;">
                ${formatDate(data.periodStart)} - ${formatDate(data.periodEnd)}
              </p>
            </div>

            <div style="background: linear-gradient(135deg, #1F3C88 0%, #2FBF71 100%); padding: 25px; border-radius: 8px; margin: 25px 0; text-align: center;">
              <p style="margin: 0 0 10px 0; color: rgba(255,255,255,0.9); font-size: 14px;">Total Earnings This Month</p>
              <h1 style="margin: 0; color: white; font-size: 42px; font-weight: bold;">${formatCurrency(data.amount)}</h1>
              <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">${data.orderCount} ${data.orderCount === 1 ? 'delivery' : 'deliveries'} completed</p>
            </div>

            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 20px; margin: 25px 0;">
              <div style="display: flex; align-items: center; margin-bottom: 10px;">
                <span style="font-size: 24px; margin-right: 10px;">💰</span>
                <h3 style="margin: 0; color: #856404;">Payout Information</h3>
              </div>
              <p style="margin: 10px 0; color: #856404;">
                <strong>Your payout of ${formatCurrency(data.amount)} will be transferred to your preferred payment method on Monday, ${formatDate(mondayDate)}.</strong>
              </p>
              <p style="margin: 10px 0 0 0; color: #856404; font-size: 14px;">
                Payment Method: <strong>${formatPaymentMethod(data.paymentMethod)}</strong>
                ${data.paymentDetails ? `<br/>Details: <strong>${data.paymentDetails}</strong>` : ''}
              </p>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e0e0e0;">
              <h3 style="color: #333; margin-top: 0;">What's Next?</h3>
              <ul style="color: #666; padding-left: 20px;">
                <li style="margin-bottom: 8px;">Your monthly earnings will be processed automatically on Monday</li>
                <li style="margin-bottom: 8px;">You'll receive a confirmation once the transfer is complete</li>
                <li style="margin-bottom: 8px;">Keep up the great work and continue earning!</li>
              </ul>
            </div>

            <p style="color: #666; font-size: 14px; margin-top: 30px;">
              If you have any questions about your payout, please contact our support team.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>&copy; ${new Date().getFullYear()} Delivio. All rights reserved.</p>
          </div>
        </body>
      </html>
    `;

    return this.sendMail({
      to: data.email,
      subject: `Monthly Payout Reminder - ${formatCurrency(data.amount)} | Delivio`,
      html,
      attachments,
    });
  }
}

export const mailService = new MailService();


