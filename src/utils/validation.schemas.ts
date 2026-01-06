import {z} from 'zod';
import {UserRole, AgentStatus, VehicleType} from '@prisma/client';

export const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters long'),
});

export const registerSchema =z.object({
    name: z.string().min(2, 'Name must be atleast 2 character'),
    email:z.string().email('Invallid email Address'),
    phone:z.string()
        .regex(/^\+\d{1,5}\d{10}$/, 'Invalid phone number format. Must be country code + 10 digits')
        .refine((val) => {
            // Extract the 10-digit part (after country code)
            // Country codes can be 1-5 digits, followed by exactly 10 digits
            const match = val.match(/^\+\d{1,5}(\d{10})$/);
            if (!match) return false;
            const digits = match[1];
            return digits.length === 10 && /^\d{10}$/.test(digits);
        }, {
            message: 'Phone number must be exactly 10 digits after country code',
        }),
    password:z.string().min(8, 'Password must be at least 8 characters long'),
    role: z.enum(['AGENT', 'PARTNER', 'ADMIN', 'LOGISTICS_PROVIDER']),
    partnerCategory: z.enum(['QUICK_COMMERCE', 'ECOMMERCE', 'LOCAL_STORE', 'FOOD_DELIVERY', 'LOGISTICS_PROVIDER']).optional(),
    // Common partner fields
    businessName: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    pincode: z.string().optional(),
    contactPhone: z.string().optional(),
    billingEmail: z.string().email().optional(),
    // Category-specific fields (stored in categoryMetadata)
    categoryMetadata: z.record(z.string(), z.any()).optional(),
}).refine((data) => {
    // If role is PARTNER, partnerCategory should be provided
    if (data.role === 'PARTNER' && !data.partnerCategory) {
        return false;
    }
    // If role is not PARTNER or LOGISTICS_PROVIDER, partnerCategory should not be provided
    if (data.role !== 'PARTNER' && data.role !== 'LOGISTICS_PROVIDER' && data.partnerCategory) {
        return false;
    }
    // LOGISTICS_PROVIDER should not have partnerCategory
    if (data.role === 'LOGISTICS_PROVIDER' && data.partnerCategory) {
        return false;
    }
    return true;
}, {
    message: "Partner category is required for partners and should not be provided for other roles",
    path: ["partnerCategory"],
});

export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters long'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: "New password and confirm password don't match",
    path: ["confirmPassword"],
});

export const updateLocationSchema =z.object({
    latitude:z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
    longitude:z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),

});

export const updateStatusSchema =z.object({
    status: z.enum(['OFFLINE', 'ONLINE', 'ON_TRIP']),
    agentId: z.string().optional(), // Optional: for admins to update other agents' status
    });

export const agentProfileUpdateSchema= z.object({
   city: z.string().optional(),
   state: z.string().optional(),
   pincode: z.string().optional(),
   vehicleType: z.enum(['BIKE', 'SCOOTER', 'CAR', 'BICYCLE']).optional(),
   payoutPlan: z.enum(['WEEKLY', 'MONTHLY']).optional(),
});

export const createOrderSchema= z.object({
    // Legacy coordinates (required if warehouse IDs not provided)
    pickupLat: z.number().min(-90).max(90).optional(),
    pickupLng: z.number().min(-180).max(180).optional(),
    dropLat: z.number().min(-90).max(90).optional(),
    dropLng: z.number().min(-180).max(180).optional(),
    // Warehouse/Restaurant selection (new structured addresses)
    pickupWarehouseId: z.string().optional(), // Warehouse ID for pickup
    pickupRestaurantId: z.string().optional(), // Restaurant ID for pickup (food delivery only)
    dropWarehouseId: z.string().optional(), // Warehouse ID for drop
    // Multi-leg logistics flow
    originWarehouseId: z.string().optional(), // Origin logistics warehouse ID
    currentWarehouseId: z.string().optional(), // Current warehouse ID (for tracking)
    transitLegs: z.any().optional(), // JSON array of transit legs
    // Free-text addresses (backwards compatibility)
    pickupAddressText: z.string().optional(), // Free-text pickup address
    dropAddressText: z.string().optional(), // Free-text drop address
    // Customer details
    customerName: z.string().optional(),
    customerPhone: z.string()
        .optional()
        .refine((val) => {
            if (!val || val.trim() === '') return true; // Optional field
            return /^\+\d{1,5}\d{10}$/.test(val);
        }, {
            message: 'Invalid phone number format. Must be country code + 10 digits (e.g., +911234567890)',
        })
        .refine((val) => {
            if (!val || val.trim() === '') return true; // Optional field
            const match = val.match(/^\+\d{1,5}(\d{10})$/);
            if (!match) return false;
            const digits = match[1];
            return digits.length === 10 && /^\d{10}$/.test(digits);
        }, {
            message: 'Phone number must be exactly 10 digits after country code',
        }),
    customerEmail: z.string().email().optional().or(z.literal('')),
    customerAddress: z.string().optional(),
    productType: z.string().optional(),
    payoutAmount: z.number().positive('Payout amount must be positive').optional(), // Optional - will be calculated from pricing profile
    orderAmount: z.number().positive('Order amount must be positive').optional(), // Optional - will be calculated from pricing profile
    paymentType: z.enum(['PREPAID', 'COD']).optional().default('PREPAID'), // Payment type: PREPAID or COD
    orderType: z.enum(['ON_DEMAND', 'B2B_BULK']).optional().default('ON_DEMAND'), // Order type for commission calculation
    commissionRate: z.number().min(0).max(100).optional(), // Custom commission rate (overrides default)
    priority: z.enum(['HIGH', 'NORMAL','LOW']).optional().default('NORMAL'),
    estimatedDuration: z.number().int().positive().optional(),
    pickupWindow: z.string().datetime().optional(), // Scheduled pickup time (for E-commerce)
    isSurge: z.boolean().optional().default(false), // Whether surge pricing applies
}).refine((data) => {
    // Must have either coordinates OR warehouse/restaurant IDs for pickup
    const hasPickupCoords = data.pickupLat !== undefined && data.pickupLng !== undefined;
    const hasPickupWarehouse = !!data.pickupWarehouseId;
    const hasPickupRestaurant = !!data.pickupRestaurantId;
    if (!hasPickupCoords && !hasPickupWarehouse && !hasPickupRestaurant) {
        return false;
    }
    // Must have either coordinates OR warehouse IDs for drop
    const hasDropCoords = data.dropLat !== undefined && data.dropLng !== undefined;
    const hasDropWarehouse = !!data.dropWarehouseId;
    if (!hasDropCoords && !hasDropWarehouse) {
        return false;
    }
    return true;
}, {
    message: "Must provide either coordinates (pickupLat/pickupLng, dropLat/dropLng) or warehouse/restaurant IDs (pickupWarehouseId/pickupRestaurantId, dropWarehouseId)",
    path: ["pickupLat"],
});

export const updateOrderStatusSchema =z.object({
    status: z.enum([
        'SEARCHING_AGENT',
        'ASSIGNED',
        'PICKED_UP',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'CANCELLED',
        'DELAYED',
        'IN_TRANSIT',
        'AT_WAREHOUSE',
        'READY_FOR_PICKUP',
    ]),
    cancellationReason: z.string().optional(),
    transitStatus: z.string().optional(), // For logistics provider internal status
    transitTrackingNumber: z.string().optional(), // Tracking number in logistics provider's system
    expectedWarehouseArrival: z.string().datetime().optional(), // ISO datetime string
});
export const partnerOrderSchema = createOrderSchema;

export const bulkOrderSchema = z.object({
    orders: z.array(createOrderSchema).min(1, 'At least one order is required').max(100, 'Maximum 100 orders per bulk request'),
});

export const deleteBulkOrdersSchema = z.object({
    orderIds: z.array(z.string().min(1, 'Order ID cannot be empty')).min(1, 'At least one order ID is required').max(100, 'Maximum 100 orders per bulk delete request'),
});

export const updateWebhookSchema =z.object({
    webhookUrl: z.string().url('Invalid webhook URL').optional(),
});

export const updateOrderSchema = z.object({
    pickupLat: z.number().min(-90).max(90).optional(),
    pickupLng: z.number().min(-180).max(180).optional(),
    dropLat: z.number().min(-90).max(90).optional(),
    dropLng: z.number().min(-180).max(180).optional(),
    payoutAmount: z.number().positive('Payout amount must be positive').optional(),
    orderAmount: z.number().positive('Order amount must be positive').optional(),
    orderType: z.enum(['ON_DEMAND', 'B2B_BULK']).optional(),
    commissionRate: z.number().min(0).max(100).optional(),
    priority: z.enum(['HIGH', 'NORMAL', 'LOW']).optional(),
    estimatedDuration: z.number().int().positive().optional(),
});

export const approveAgentSchema=z.object({
    isApproved:z.boolean(),
});

export const blockAgentSchema=z.object({
    isBlocked:z.boolean(),
    blockedReason: z.string().optional(),
});

// Warehouse management schemas
export const createWarehouseSchema = z.object({
    name: z.string().min(1, 'Warehouse name is required'),
    address: z.string().min(1, 'Address is required'),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
    country: z.string().optional().default('India'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    contactName: z.string().optional(),
    contactPhone: z.string()
        .optional()
        .refine((val) => {
            if (!val) return true; // Optional field, allow empty
            // Validate format: country code + 10 digits
            return /^\+\d{1,5}\d{10}$/.test(val);
        }, {
            message: 'Invalid phone number format. Must be country code + 10 digits (e.g., +911234567890)',
        })
        .refine((val) => {
            if (!val) return true; // Optional field, allow empty
            // Extract the 10-digit part (after country code)
            const match = val.match(/^\+\d{1,5}(\d{10})$/);
            if (!match) return false;
            const digits = match[1];
            return digits.length === 10 && /^\d{10}$/.test(digits);
        }, {
            message: 'Phone number must be exactly 10 digits after country code',
        }),
    contactEmail: z.string().email().optional().or(z.literal('')),
    metadata: z.record(z.string(), z.any()).optional(),
});

export const updateWarehouseSchema = createWarehouseSchema.partial().extend({
    isActive: z.boolean().optional(),
});

// Restaurant management schemas
export const createRestaurantSchema = z.object({
    name: z.string().min(1, 'Restaurant name is required'),
    address: z.string().min(1, 'Address is required'),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
    country: z.string().optional().default('India'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    contactName: z.string().optional(),
    contactPhone: z.string()
        .optional()
        .refine((val) => {
            if (!val) return true; // Optional field, allow empty
            // Validate format: country code + 10 digits
            return /^\+\d{1,5}\d{10}$/.test(val);
        }, {
            message: 'Invalid phone number format. Must be country code + 10 digits (e.g., +911234567890)',
        })
        .refine((val) => {
            if (!val) return true; // Optional field, allow empty
            // Extract the 10-digit part (after country code)
            const match = val.match(/^\+\d{1,5}(\d{10})$/);
            if (!match) return false;
            const digits = match[1];
            return digits.length === 10 && /^\d{10}$/.test(digits);
        }, {
            message: 'Phone number must be exactly 10 digits after country code',
        }),
    contactEmail: z.string().email().optional().or(z.literal('')),
    metadata: z.record(z.string(), z.any()).optional(),
});

export const updateRestaurantSchema = createRestaurantSchema.partial().extend({
    isActive: z.boolean().optional(),
});

// Logistics Provider order creation schema
export const createLogisticsOrderSchema = z.object({
    partnerId: z.string(), // E-commerce partner who owns the order
    originWarehouseId: z.string(), // Origin warehouse
    dropLat: z.number().min(-90).max(90),
    dropLng: z.number().min(-180).max(180),
    dropAddressText: z.string().optional(),
    dropWarehouseId: z.string().optional(), // Final delivery warehouse (if applicable)
    transitTrackingNumber: z.string().optional(), // External tracking number
    expectedWarehouseArrival: z.string().datetime().optional(), // Expected arrival at final warehouse
    orderAmount: z.number().positive().optional(),
    priority: z.enum(['HIGH', 'NORMAL', 'LOW']).optional().default('NORMAL'),
});

// Logistics Provider transit update schema
export const updateTransitStatusSchema = z.object({
    transitStatus: z.string().min(1, 'Transit status is required'), // e.g., "Dispatched", "In Transit", "At Hub", "Out for Delivery"
    currentWarehouseId: z.string().optional().or(z.literal('')).nullable(), // Current warehouse location - allow empty string
    transitLegs: z.array(z.object({
        from: z.string(),
        to: z.string(),
        status: z.string(),
        updatedAt: z.string().datetime(),
    })).optional().nullable(),
    expectedWarehouseArrival: z.string().datetime().optional().or(z.literal('')).nullable(), // Allow empty string
}).passthrough(); // Allow additional fields to pass through

// Mark order ready for pickup schema
export const markReadyForPickupSchema = z.object({
    warehouseId: z.string(), // Warehouse where order is ready
    notes: z.string().optional(), // Additional notes for agent
});

// Admin partner update schema
export const updatePartnerSchema = z.object({
    category: z.enum(['QUICK_COMMERCE', 'ECOMMERCE', 'LOCAL_STORE', 'FOOD_DELIVERY']).optional(),
    isActive: z.boolean().optional(),
    companyName: z.string().min(1).optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    pincode: z.string().optional(),
    contactPhone: z.string().optional(),
    billingEmail: z.string().email().optional().or(z.literal('')),
    webhookUrl: z.string().url().optional().or(z.literal('')),
});

// Logistics Agent schemas
export const createLogisticsAgentSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    phone: z.string()
        .regex(/^\+\d{1,5}\d{10}$/, 'Invalid phone number format. Must be country code + 10 digits')
        .refine((val) => {
            const match = val.match(/^\+\d{1,5}(\d{10})$/);
            if (!match) return false;
            const digits = match[1];
            return digits.length === 10 && /^\d{10}$/.test(digits);
        }, {
            message: 'Phone number must be exactly 10 digits after country code',
        }),
    email: z.string().email().optional().or(z.literal('')),
    vehicleType: z.enum(['TRUCK', 'CARGO_CARRIER', 'CAR', 'BIKE', 'SCOOTER', 'BICYCLE']),
    vehicleNumber: z.string().min(1, 'Vehicle number is required'),
    maxOrders: z.number().int().positive().default(5),
    area: z.string().optional(),
    areaLatitude: z.number().optional(),
    areaLongitude: z.number().optional(),
    areaRadiusKm: z.number().positive().optional(),
});

export const updateLogisticsAgentSchema = createLogisticsAgentSchema.partial();

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;
export type CreateRestaurantInput = z.infer<typeof createRestaurantSchema>;
export type UpdateRestaurantInput = z.infer<typeof updateRestaurantSchema>;
export type CreateLogisticsOrderInput = z.infer<typeof createLogisticsOrderSchema>;
export type UpdateTransitStatusInput = z.infer<typeof updateTransitStatusSchema>;
export type MarkReadyForPickupInput = z.infer<typeof markReadyForPickupSchema>;
