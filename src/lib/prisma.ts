import { PrismaClient } from '@prisma/client';

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
// Learn more: https://pris.ly/d/help/next-js-best-practices

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Validate DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set!');
  console.error('⚠️  Database operations will fail. Please set DATABASE_URL in your environment variables.');
  // Don't throw in production - let the app start and handle errors gracefully
  if (process.env.NODE_ENV === 'development') {
    throw new Error('DATABASE_URL is required');
  }
}

// Initialize Prisma Client with proper error handling
let prismaInstance: PrismaClient;

try {
  prismaInstance =
    globalForPrisma.prisma ||
    new PrismaClient({
      log: ['error'],
      // Connection pool optimization
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      // Add error formatting for better error messages
      errorFormat: 'pretty',
    });

  // Handle Prisma connection errors
  prismaInstance.$on('error' as never, (e: any) => {
    console.error('Prisma Client Error:', {
      message: e.message,
      target: e.target,
    });
  });

  // Test connection on initialization (non-blocking)
  prismaInstance.$connect()
    .then(() => {
      // Prisma Client connected
    })
    .catch((error: any) => {
      console.error('❌ Prisma Client connection failed:', {
        code: error?.code,
        message: error?.message,
      });
      console.warn('⚠️  Server will continue to start, but database operations may fail');
      // Don't throw - let the application start and handle errors gracefully
    });

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prismaInstance;
  }
} catch (error: any) {
  console.error('❌ Failed to initialize Prisma Client:', {
    code: error?.code,
    message: error?.message,
    stack: error?.stack,
  });
  // Create a minimal client that will fail gracefully
  prismaInstance = new PrismaClient({
    log: ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL || 'postgresql://localhost:5432/db',
      },
    },
  });
}

export const prisma = prismaInstance;
export default prisma;




