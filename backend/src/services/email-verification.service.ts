import { prisma } from '../lib/prisma';
import { mailService } from './mail.service';
import { authService } from './auth.service';
import { UserRole } from '@prisma/client';

interface RegistrationData {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: UserRole;
  partnerCategory?: 'QUICK_COMMERCE' | 'ECOMMERCE' | 'LOCAL_STORE';
  businessName?: string;
  shopName?: string;
}

/**
 * Generate a 6-digit OTP
 */
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send OTP email for email verification
 */
export async function sendVerificationOTP(
  email: string,
  name: string,
  registrationData: RegistrationData
): Promise<{ success: boolean; message: string }> {
  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return {
        success: false,
        message: 'User with this email already exists',
      };
    }

    // Check if phone already exists
    const existingPhone = await prisma.user.findUnique({
      where: { phone: registrationData.phone },
    });

    if (existingPhone) {
      return {
        success: false,
        message: 'User with this phone already exists',
      };
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // OTP expires in 10 minutes

    // Delete any existing unverified OTPs for this email
    await prisma.emailVerification.deleteMany({
      where: {
        email,
        verified: false,
      },
    });

    // Create new email verification record
    await prisma.emailVerification.create({
      data: {
        email,
        otp,
        expiresAt,
        registrationData: registrationData as any,
      },
    });

    // Send OTP email
    const emailSent = await mailService.sendOTPEmail(email, otp, name);

    if (!emailSent) {
      console.error(`Failed to send OTP email to ${email}`);
      // Don't fail registration if email fails - user can request resend
    }

    return {
      success: true,
      message: 'OTP sent to your email. Please check your inbox.',
    };
  } catch (error: any) {
    console.error('Error sending verification OTP:', error);
    return {
      success: false,
      message: error.message || 'Failed to send verification OTP',
    };
  }
}

/**
 * Verify OTP and create user account
 */
export async function verifyOTPAndCreateUser(
  email: string,
  otp: string
): Promise<{ success: boolean; message: string; user?: any }> {
  try {
    // Find the verification record
    const verification = await prisma.emailVerification.findFirst({
      where: {
        email,
        otp,
        verified: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!verification) {
      return {
        success: false,
        message: 'Invalid or expired OTP. Please request a new one.',
      };
    }

    // Check if OTP has expired
    if (new Date() > verification.expiresAt) {
      // Delete expired verification
      await prisma.emailVerification.delete({
        where: { id: verification.id },
      });
      return {
        success: false,
        message: 'OTP has expired. Please request a new one.',
      };
    }

    // Mark as verified
    await prisma.emailVerification.update({
      where: { id: verification.id },
      data: {
        verified: true,
        verifiedAt: new Date(),
      },
    });

    // Get registration data
    const registrationData = verification.registrationData as unknown as RegistrationData;

    if (!registrationData) {
      return {
        success: false,
        message: 'Registration data not found. Please register again.',
      };
    }

    // Create user account
    const user = await authService.register(registrationData);

    // Send welcome email (except for ADMIN)
    if (user.role !== UserRole.ADMIN) {
      try {
        await mailService.sendWelcomeEmail(
          user.email,
          user.name,
          user.role as 'AGENT' | 'PARTNER' | 'LOGISTICS_PROVIDER'
        );
      } catch (error) {
        console.error('Failed to send welcome email:', error);
        // Don't fail user creation if welcome email fails
      }
    }

    return {
      success: true,
      message: 'Email verified successfully. Your account has been created.',
      user,
    };
  } catch (error: any) {
    console.error('Error verifying OTP:', error);
    return {
      success: false,
      message: error.message || 'Failed to verify OTP',
    };
  }
}

/**
 * Resend OTP
 */
export async function resendOTP(email: string): Promise<{ success: boolean; message: string }> {
  try {
    // Find the most recent unverified verification
    const verification = await prisma.emailVerification.findFirst({
      where: {
        email,
        verified: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!verification || !verification.registrationData) {
      return {
        success: false,
        message: 'No pending verification found. Please register again.',
      };
    }

    const registrationData = verification.registrationData as unknown as RegistrationData;

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    // Update verification with new OTP
    await prisma.emailVerification.update({
      where: { id: verification.id },
      data: {
        otp,
        expiresAt,
      },
    });

    // Send new OTP email
    const emailSent = await mailService.sendOTPEmail(
      email,
      otp,
      registrationData.name
    );

    if (!emailSent) {
      console.error(`Failed to resend OTP email to ${email}`);
    }

    return {
      success: true,
      message: 'OTP resent to your email. Please check your inbox.',
    };
  } catch (error: any) {
    console.error('Error resending OTP:', error);
    return {
      success: false,
      message: error.message || 'Failed to resend OTP',
    };
  }
}

export const emailVerificationService = {
  sendVerificationOTP,
  verifyOTPAndCreateUser,
  resendOTP,
};

