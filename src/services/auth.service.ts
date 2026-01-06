import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import { UserRole, PartnerCategory } from '@prisma/client';
import { ConflictError } from '../utils/errors.util';
import { generateId, getUserPrefix } from '../utils/id-generator.util';


export interface RegisterData {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: UserRole;
  partnerCategory?: 'QUICK_COMMERCE' | 'ECOMMERCE' | 'LOCAL_STORE';
  businessName?: string;
  shopName?: string; // Shop name for LOCAL_STORE partners
  address?: string;
  city?: string;
  pincode?: string;
  contactPhone?: string;
  billingEmail?: string;
  categoryMetadata?: Record<string, any>;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  agentId?: string;
  partnerId?: string;
  logisticsProviderId?: string;
}

export const authService = {

    async register(data: RegisterData): Promise<AuthUser>{
      const existingUser = await prisma.user.findUnique({
        where: {email:data.email},
    });
    if(existingUser){
      throw new ConflictError('User with this email already exists');
    }

    // Check if phone already exists
    const existingPhone = await prisma.user.findUnique({
      where: { phone: data.phone },
    });

    if (existingPhone) {
      throw new ConflictError('User with this phone already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 10);

    // Generate user ID based on role
    const userPrefix = getUserPrefix(data.role);
    const userId = await generateId(userPrefix);

    // Create user
    const user = await prisma.user.create({
      data: {
        id: userId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        passwordHash,
        role: data.role,
        emailVerified: data.role === UserRole.ADMIN ? new Date() : null,
        phoneVerified: false,
      },
      include: {
        agent: true,
        partner: true,
      },
    });

    // Create role-specific records if needed
    if (data.role === UserRole.PARTNER) {
      // Generate API key
      const apiKey = `pk_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      // Generate partner ID
      const partnerId = await generateId('PRT');
      
      // Build categoryMetadata for LOCAL_STORE if shopName is provided
      let categoryMetadata = data.categoryMetadata;
      if (data.partnerCategory === PartnerCategory.LOCAL_STORE && data.shopName) {
        categoryMetadata = {
          ...(categoryMetadata || {}),
          shopName: data.shopName,
        };
      }
      
      await prisma.partner.create({
        data: {
          id: partnerId,
          userId: user.id,
          companyName: data.businessName || data.name, // Use businessName if provided, else name
          businessName: data.businessName || data.name,
          category: data.partnerCategory || PartnerCategory.LOCAL_STORE, // Default to LOCAL_STORE if not provided
          apiKey,
          isActive: true,
          address: data.address,
          city: data.city,
          pincode: data.pincode,
          contactPhone: data.contactPhone || data.phone,
          billingEmail: data.billingEmail || data.email,
          categoryMetadata: categoryMetadata || undefined,
        },
      });
    } else if (data.role === UserRole.LOGISTICS_PROVIDER) {
      // Generate API key
      const apiKey = `lgp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      // Generate logistics provider ID
      const logisticsProviderId = await generateId('LGP');
      
      await prisma.logisticsProvider.create({
        data: {
          id: logisticsProviderId,
          userId: user.id,
          companyName: data.businessName || data.name,
          businessName: data.businessName || data.name,
          apiKey,
          isActive: true,
          address: data.address,
          city: data.city,
          pincode: data.pincode,
          contactPhone: data.contactPhone || data.phone,
          billingEmail: data.billingEmail || data.email,
        },
      });
    } else if (data.role === UserRole.AGENT) {
      // Generate agent ID
      const agentId = await generateId('AGT');
      
      // Check if agent auto-approval is enabled
      let isApproved = false;
      try {
        const settings = await prisma.systemSettings.findUnique({
          where: { id: 'system' },
        });
        if (settings?.agentAutoApproval) {
          isApproved = true;
        }
      } catch (error: any) {
        // If table doesn't exist, default to false (requires approval)
        if (error?.code !== 'P2021' && error?.code !== '42P01' && !error?.message?.includes('does not exist')) {
          console.error('[Auth] Error checking agent auto-approval setting:', error);
        }
      }
      
      // Create agent record with default vehicleType (BIKE)
      // Agent can update vehicleType later via profile update endpoint
      await prisma.agent.create({
        data: {
          id: agentId,
          userId: user.id,
          vehicleType: 'BIKE', // Default, can be updated later
          status: 'OFFLINE',
          isApproved, // Auto-approved if setting is enabled, otherwise requires admin approval
          isBlocked: false,
        },
      });
    }

    // Fetch user with relations
    const userWithRelations = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        agent: true,
        partner: true,
        logisticsProvider: true,
      },
    });

    if (!userWithRelations) {
      throw new Error('Failed to create user');
    }

    return {
      id: userWithRelations.id,
      email: userWithRelations.email,
      name: userWithRelations.name,
      role: userWithRelations.role,
      agentId: userWithRelations.agent?.id,
      partnerId: userWithRelations.partner?.id,
      logisticsProviderId: userWithRelations.logisticsProvider?.id,
    };
  },


  async login(credentials: LoginCredentials): Promise<AuthUser | null> {
    // Find user with relations
    const user = await prisma.user.findUnique({
      where: {
        email: credentials.email,
      },
      include: {
        agent: true,
        partner: true,
        logisticsProvider: true,
      },
    });

    if (!user) {
      return null;
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(
      credentials.password,
      user.passwordHash
    );

    if (!isPasswordValid) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      agentId: user.agent?.id,
      partnerId: user.partner?.id,
      logisticsProviderId: user.logisticsProvider?.id,
    };
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    // Find user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!isPasswordValid) {
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    return true;
  },
};


