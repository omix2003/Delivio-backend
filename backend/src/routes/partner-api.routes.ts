import { Router } from 'express';
import { authenticateApiKey } from '../middleware/apiKey.middleware';
import { validate } from '../middleware/validation.middleware';
import { partnerController } from '../controllers/partner.controller';
import { createOrderSchema } from '../utils/validation.schemas';

const router = Router();

// External API routes - use API key authentication instead of JWT
// These routes are for partners to integrate programmatically

// All routes require API key authentication
router.use(authenticateApiKey);

// External order creation endpoint
router.post('/orders', validate(createOrderSchema), partnerController.createOrderExternal);
router.get('/orders/:id', partnerController.getOrderDetailsExternal);

export default router;


























