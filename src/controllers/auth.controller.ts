import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { emailVerificationService } from '../services/email-verification.service';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { UserRole } from '@prisma/client';
import fs from 'fs';

export const authController = {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      // Check if registration is enabled
      try {
        const settings = await prisma.systemSettings.findUnique({
          where: { id: 'system' },
        });
        if (settings && !settings.registrationEnabled) {
          return res.status(403).json({
            error: 'Registration is currently disabled',
            message: 'New user registration is temporarily disabled. Please contact support for assistance.',
          });
        }
      } catch (error: any) {
        // If table doesn't exist, allow registration (fail open)
        if (error?.code !== 'P2021' && error?.code !== '42P01' && !error?.message?.includes('does not exist')) {
          console.error('[Auth] Error checking registration settings:', error);
        }
      }

      const { name, email, phone, password, role, partnerCategory, businessName, shopName } = req.body;

      // For ADMIN role, skip email verification and create user directly
      if (role === UserRole.ADMIN) {
        const user = await authService.register({
          name,
          email,
          phone,
          password,
          role,
          partnerCategory: partnerCategory as 'QUICK_COMMERCE' | 'ECOMMERCE' | 'LOCAL_STORE' | undefined,
          businessName,
          shopName,
        });
        const token = jwt.sign({
          id: user.id,
          email: user.email,
          role: user.role,
          agentId: user.agentId,
          partnerId: user.partnerId,
          logisticsProviderId: user.logisticsProviderId,
        },
          process.env.JWT_SECRET || 'djfhfudfhcnuyedufcy5482dfdf',
          { expiresIn: '7d' }
        );
        return res.status(201).json({
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            agentId: user.agentId,
            partnerId: user.partnerId,
            logisticsProviderId: user.logisticsProviderId,
          },
          token,
        });
      }

      // For other roles, send OTP for email verification
      const result = await emailVerificationService.sendVerificationOTP(
        email,
        name,
        {
          name,
          email,
          phone,
          password,
          role,
          partnerCategory: partnerCategory as 'QUICK_COMMERCE' | 'ECOMMERCE' | 'LOCAL_STORE' | undefined,
          businessName,
          shopName,
        }
      );

      if (!result.success) {
        return res.status(400).json({
          error: result.message,
        });
      }

      res.status(200).json({
        message: result.message,
        email,
      });
    } catch (error) {
      next(error);
    }
  },



  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = await authService.login({ email, password });

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Generate JWT token
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
          agentId: user.agentId,
          partnerId: user.partnerId,
          logisticsProviderId: user.logisticsProviderId,
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          agentId: user.agentId,
          partnerId: user.partnerId,
          logisticsProviderId: user.logisticsProviderId,
        },
        token,
      });
    } catch (error) {
      next(error);
    }
  },


  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
          agent: true,
          partner: true,
          notifications: true,
          logisticsProvider: true,
        },
      });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        agentId: user.agent?.id,
        partnerId: user.partner?.id,
        logisticsProviderId: user.logisticsProvider?.id,
        agent: user.agent ? {
          status: user.agent.status,
          vehicleType: user.agent.vehicleType,
          isApproved: user.agent.isApproved,
          rating: user.agent.rating,
        } : null,
        partner: user.partner ? {
          companyName: user.partner.companyName,
          isActive: user.partner.isActive,
        } : null,
        logisticsProvider: user.logisticsProvider ? {
          companyName: user.logisticsProvider.companyName,
          isActive: user.logisticsProvider.isActive,
          verified: true
        } : null,
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/auth/profile-picture - Upload profile picture
  async uploadProfilePicture(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        console.error('[Profile Upload] Unauthorized - no user');
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!req.file) {
        console.error('[Profile Upload] No file uploaded');
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Generate file URL (relative to /uploads/profiles/)
      const fileUrl = `/uploads/profiles/${req.file.filename}`;

      // Update user profile picture
      const user = await prisma.user.update({
        where: { id: req.user.id },
        data: { profilePicture: fileUrl },
        select: {
          id: true,
          profilePicture: true,
        },
      });

      res.json({
        url: fileUrl,
        message: 'Profile picture uploaded successfully',
      });
    } catch (error: any) {
      console.error('[Profile Upload] Error:', error);
      console.error('[Profile Upload] Error message:', error?.message);
      console.error('[Profile Upload] Error stack:', error?.stack);

      // Clean up uploaded file if there's an error
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          console.error('[Profile Upload] Error deleting file:', unlinkError);
        }
      }
      next(error);
    }
  },

  // PUT /api/auth/change-password - Change password
  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { currentPassword, newPassword } = req.body;

      await authService.changePassword(req.user.id, currentPassword, newPassword);

      res.json({
        message: 'Password changed successfully',
      });
    } catch (error: any) {
      if (error.message === 'Current password is incorrect') {
        return res.status(400).json({ error: error.message });
      }
      if (error.message === 'User not found') {
        return res.status(404).json({ error: error.message });
      }
      next(error);
    }
  },

  // POST /api/auth/verify-otp - Verify OTP and create user account
  async verifyOTP(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({
          error: 'Email and OTP are required',
        });
      }

      const result = await emailVerificationService.verifyOTPAndCreateUser(email, otp);

      if (!result.success) {
        return res.status(400).json({
          error: result.message,
        });
      }

      if (!result.user) {
        return res.status(500).json({
          error: 'User creation failed',
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        {
          id: result.user.id,
          email: result.user.email,
          role: result.user.role,
          agentId: result.user.agentId,
          partnerId: result.user.partnerId,
          logisticsProviderId: result.user.logisticsProviderId,
        },
        process.env.JWT_SECRET || 'djfhfudfhcnuyedufcy5482dfdf',
        { expiresIn: '7d' }
      );

      res.status(201).json({
        message: result.message,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
          agentId: result.user.agentId,
          partnerId: result.user.partnerId,
          logisticsProviderId: result.user.logisticsProviderId,
        },
        token,
      });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/auth/resend-otp - Resend OTP
  async resendOTP(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          error: 'Email is required',
        });
      }

      const result = await emailVerificationService.resendOTP(email);

      if (!result.success) {
        return res.status(400).json({
          error: result.message,
        });
      }

      res.json({
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  },

};


