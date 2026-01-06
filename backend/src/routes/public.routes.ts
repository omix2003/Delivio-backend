import { Router } from 'express';
import { publicController } from '../controllers/public.controller';
import { adminController } from '../controllers/admin.controller';

const router = Router();

// Public routes (no authentication required)
router.get('/orders/:id/track', publicController.trackOrder);
router.get('/directions', publicController.getDirections);
router.get('/pricing-profiles', adminController.getPricingProfiles); // Public access to pricing profiles
router.post('/contact', publicController.submitContact);

export default router;


