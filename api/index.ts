// Vercel serverless function wrapper for Express app
import { VercelRequest, VercelResponse } from '@vercel/node';
import { app } from '../src/server';

// Export the Express app as a serverless function
export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req, res);
}

