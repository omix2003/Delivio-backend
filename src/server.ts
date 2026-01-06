import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
// Optional Redis import - app works without it
// Use a function to lazily load Redis to avoid module load errors
let redisModuleCache: any = null;

const loadRedisModule = (): any => {
  if (redisModuleCache !== null) {
    return redisModuleCache;
  }
  
  try {
    redisModuleCache = require('./lib/redis');
    return redisModuleCache;
  } catch (error: any) {
    // Module not found - provide fallback
    redisModuleCache = {
      getRedisClient: () => null,
      isRedisConnected: () => false,
      testRedisConnection: async () => false,
      getRedisStatus: () => ({ connected: false, status: 'not_available', message: 'Redis module not available' }),
    };
    console.warn('⚠️  Redis module not available, running without Redis');
    return redisModuleCache;
  }
};

const getRedisClient = () => loadRedisModule().getRedisClient();
const isRedisConnected = () => loadRedisModule().isRedisConnected();
const testRedisConnection = () => loadRedisModule().testRedisConnection();
const getRedisStatus = () => loadRedisModule().getRedisStatus();
import { errorHandler } from './middleware/error.middleware';
import { initializeWebSocket } from './lib/websocket';
import { prisma } from './lib/prisma';
import { checkMaintenanceMode } from './middleware/maintenance.middleware';
import authRoutes from './routes/auth.routes';
import agentRoutes from './routes/agent.routes';
import partnerRoutes from './routes/partner.routes';
import partnerApiRoutes from './routes/partner-api.routes';
import adminRoutes from './routes/admin.routes';
import logisticsProviderRoutes from './routes/logistics-provider.routes';
// NOTIFICATIONS DISABLED
// import notificationRoutes from './routes/notification.routes';
import publicRoutes from './routes/public.routes';
import ratingRoutes from './routes/rating.routes';

// Load environment variables
dotenv.config();

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log the error but don't crash the server
  if (reason instanceof Error) {
    console.error('Error details:', {
      name: reason.name,
      message: reason.message,
      stack: reason.stack,
    });
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
  console.error('Error details:', {
    name: error.name,
    message: error.message,
    stack: error.stack,
  });
  // In production, you might want to gracefully shutdown
  // For now, we'll just log it
});

const app = express();
// Only create HTTP server if not running on Vercel (serverless)
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
const httpServer = !isVercel ? http.createServer(app) : null;
const PORT = process.env.PORT || 5000;

// Initialize Redis connection (optional - app will work without it)
if (process.env.REDIS_ENABLED === 'false') {
  // Redis is disabled
} else if (getRedisClient) {
  try {
    getRedisClient();
  } catch (error) {
    // Redis initialization failed, but we'll continue without it
  }
}

// CORS configuration - support multiple origins
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    const allowedOrigins = process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : ['http://localhost:3000'];
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
};

// Middleware
app.use(cors(corsOptions));
// JSON parser with error handling
app.use(express.json({
  strict: true
}));
app.use(express.urlencoded({ extended: true }));

// Helper function to set CORS headers for static files
const staticFileCors = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Get the origin from the request
  const requestOrigin = req.headers.origin;
  const allowedOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : ['http://localhost:3000'];
  
  // Set CORS headers for static files
  if (requestOrigin && (allowedOrigins.includes(requestOrigin) || allowedOrigins.includes('*'))) {
    res.header('Access-Control-Allow-Origin', requestOrigin);
  } else if (allowedOrigins.length > 0) {
    res.header('Access-Control-Allow-Origin', allowedOrigins[0]);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
};

// Serve static files from uploads directory with CORS headers
app.use('/uploads', staticFileCors, express.static(path.join(process.cwd(), 'uploads')));

// Also serve static files at /api/uploads for frontend compatibility
app.use('/api/uploads', staticFileCors, express.static(path.join(process.cwd(), 'uploads')));

// Custom JSON error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      error: 'Invalid JSON',
      message: 'The request body contains invalid JSON. Please ensure you use double quotes for property names and values, and check for trailing commas.',
      details: err.message
    });
  }
  next(err);
});

// Request logging middleware (removed verbose logs)
app.use((req, res, next) => {
  next();
});

// Health check route
app.get('/health', async (req, res) => {
  let redisStatus = 'disconnected';
  let redisDetails: any = null;
  
  try {
    if (testRedisConnection && getRedisStatus) {
      const isConnected = await testRedisConnection();
      redisStatus = isConnected ? 'connected' : 'disconnected';
      redisDetails = getRedisStatus();
    } else {
      redisStatus = 'not_available';
      redisDetails = { message: 'Redis module not available' };
    }
  } catch (error) {
    redisStatus = 'error';
    redisDetails = { error: 'Failed to check Redis status' };
  }
  
  res.json({ 
    status: 'ok', 
    message: 'Backend server is running',
    redis: redisStatus,
    redisDetails,
  });
});

// API routes
try {
  // Public routes (no authentication) - skip maintenance check
  app.use('/api/public', publicRoutes);
  
  // Auth routes (login/register) - skip maintenance check for login
  app.use('/api/auth', authRoutes);

  // Apply maintenance mode check after auth routes (allows login)
  app.use(checkMaintenanceMode);

  // Verify agentRoutes is actually a router
  const agentRoutesAny = agentRoutes as any;
  if (!agentRoutes || typeof agentRoutes !== 'function') {
    console.error('❌ agentRoutes is not a valid router!', {
      type: typeof agentRoutes,
      value: agentRoutes,
      constructor: agentRoutesAny?.constructor?.name
    });
    throw new Error('agentRoutes is not a valid Express router');
  }
  
  app.use('/api/agent', agentRoutes);
  app.use('/api/partner', partnerRoutes);
  app.use('/api/partner-api', partnerApiRoutes);
  app.use('/api/admin', adminRoutes);
  
  // Verify logisticsProviderRoutes is a valid router
  try {
    if (!logisticsProviderRoutes || typeof logisticsProviderRoutes !== 'function') {
      console.error('❌ logisticsProviderRoutes is not a valid router!', {
        type: typeof logisticsProviderRoutes,
        value: logisticsProviderRoutes,
      });
      throw new Error('logisticsProviderRoutes is not a valid Express router');
    }
    
    app.use('/api/logistics-provider', logisticsProviderRoutes);
    console.log('✅ Logistics provider routes registered at /api/logistics-provider');
    console.log('   Available routes: GET /dashboard, GET /orders, GET /agents, etc.');
    console.log('   Order routes: PUT /orders/:id/destination-warehouse, PUT /orders/:id/transit-status, POST /orders/:id/ready-for-pickup');
  } catch (routeError) {
    console.error('❌ Error registering logistics provider routes:', routeError);
    throw routeError;
  }
  app.use('/api/ratings', ratingRoutes);

  // NOTIFICATIONS DISABLED
  // app.use('/api/notifications', notificationRoutes);
  // console.log('✅ Notification routes registered at /api/notifications');
} catch (error) {
  console.error('❌ Error registering routes:', error);
  console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack');
}

// Debug route to test routing
app.get('/api/test', (req, res) => {
  res.json({ message: 'API routing is working', path: req.path });
});

// Debug route to list all registered routes
app.get('/api/debug/routes', (req, res) => {
  const routes: any[] = [];
  const agentRoutes: any[] = [];
  
  // Get all registered routes from Express
  app._router?.stack?.forEach((middleware: any) => {
    if (middleware.route) {
      // Direct route
      const routeInfo = {
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods),
        type: 'direct'
      };
      routes.push(routeInfo);
      if (routeInfo.path.includes('/agent')) {
        agentRoutes.push(routeInfo);
      }
    } else if (middleware.name === 'router') {
      // Router middleware
      const basePath = middleware.regexp.source
        .replace('\\/?', '')
        .replace('(?=\\/|$)', '')
        .replace(/\\\//g, '/')
        .replace(/\^/g, '')
        .replace(/\$/g, '');
      
      middleware.handle?.stack?.forEach((handler: any) => {
        if (handler.route) {
          const fullPath = basePath + handler.route.path;
          const routeInfo = {
            path: fullPath,
            methods: Object.keys(handler.route.methods),
            basePath: basePath,
            routePath: handler.route.path,
            type: 'router'
          };
          routes.push(routeInfo);
          if (fullPath.includes('/agent')) {
            agentRoutes.push(routeInfo);
          }
        } else if (handler.name === 'router') {
          // Nested router
          const nestedBasePath = handler.regexp.source
            .replace('\\/?', '')
            .replace('(?=\\/|$)', '')
            .replace(/\\\//g, '/')
            .replace(/\^/g, '')
            .replace(/\$/g, '');
          
          handler.handle?.stack?.forEach((nestedHandler: any) => {
            if (nestedHandler.route) {
              const fullPath = basePath + nestedBasePath + nestedHandler.route.path;
              const routeInfo = {
                path: fullPath,
                methods: Object.keys(nestedHandler.route.methods),
                basePath: basePath,
                nestedBasePath: nestedBasePath,
                routePath: nestedHandler.route.path,
                type: 'nested-router'
              };
              routes.push(routeInfo);
              if (fullPath.includes('/agent')) {
                agentRoutes.push(routeInfo);
              }
            }
          });
        }
      });
    }
  });
  
  res.json({
    message: 'Registered routes',
    totalRoutes: routes.length,
    agentRoutesCount: agentRoutes.length,
    agentRoutes: agentRoutes,
    allRoutes: routes.slice(0, 50), // Limit to first 50 for readability
  });
});

// Error handler - must come before 404 handler
app.use(errorHandler);

// Method not allowed handler - check if route exists with different method
app.use((req, res, next) => {
  // Check if this is a known route path but wrong method
  const knownRoutes = [
    { path: '/api/auth/login', methods: ['POST'] },
    { path: '/api/auth/register', methods: ['POST'] },
    { path: '/api/auth/me', methods: ['GET'] },
    { path: '/api/auth/profile-picture', methods: ['POST'] },
    { path: '/api/auth/change-password', methods: ['PUT'] },
  ];

  const route = knownRoutes.find(r => r.path === req.path);
  if (route && !route.methods.includes(req.method)) {
    return res.status(405).json({
      error: 'Method Not Allowed',
      message: `${req.method} method is not allowed for this route`,
      allowedMethods: route.methods,
      path: req.path,
    });
  }
  next();
});

// 404 handler - must be last (after error handler and method check)
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    method: req.method,
    path: req.originalUrl,
    message: 'The requested route does not exist',
    availableRoutes: [
      'GET /health',
      'GET /api/test',
      'POST /api/auth/login',
      'POST /api/auth/register',
      'GET /api/auth/me',
      'GET /api/agent/profile',
      'GET /api/agent/metrics',
      'POST /api/agent/status'
    ]
  });
});

// Check database connection (non-blocking - server will start even if check fails)
(async () => {
  try {
    // Test database connection
    await prisma.$connect();
  } catch (error: any) {
    console.error('❌ Database connection failed:', {
      code: error?.code,
      message: error?.message,
      name: error?.name,
    });
    
    if (error?.code === 'P1001' || error?.message?.includes('Can\'t reach database server')) {
      console.error('❌ Cannot connect to database server!');
      console.error('⚠️  Please check DATABASE_URL environment variable');
      console.error('⚠️  Server will continue to start but database operations will fail');
    } else {
      console.error('⚠️  Database connection issue:', error?.message);
      console.error('⚠️  Server will continue to start but database operations may fail');
    }
  }
})();

// Initialize periodic delay checker (runs every minute)
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_DELAY_CHECKER === 'true') {
  setInterval(() => {
    (async () => {
      try {
        const { delayCheckerService } = await import('./services/delay-checker.service');
        await delayCheckerService.checkDelayedOrders();
      } catch (error) {
        console.error('[Server] Error in periodic delay check:', error);
      }
    })();
  }, 60000); // Check every minute
}

// Initialize WebSocket server (skip on Vercel - not supported)
if (!isVercel && httpServer) {
  initializeWebSocket(httpServer);
} else if (isVercel) {
  console.warn('⚠️  WebSocket disabled on Vercel (not supported in serverless environment)');
}

// Start HTTP server (skip on Vercel - serverless functions don't need to listen)
if (!isVercel && httpServer) {
  httpServer.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  }).on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use!`);
      console.error(`💡 Solutions:`);
      console.error(`   1. Kill the process using port ${PORT}:`);
      console.error(`      Windows: netstat -ano | findstr :${PORT} (then taskkill /PID <PID> /F)`);
      console.error(`      Mac/Linux: lsof -ti:${PORT} | xargs kill -9`);
      console.error(`   2. Use a different port by setting PORT environment variable:`);
      console.error(`      PORT=5001 npm run dev`);
      process.exit(1);
    } else {
      console.error('❌ Server error:', error);
      process.exit(1);
    }
  });
} else if (isVercel) {
}

// Export app for Vercel serverless function
export { app };



