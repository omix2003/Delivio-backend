import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import {validate} from '../middleware/validation.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { loginSchema, registerSchema, changePasswordSchema } from '../utils/validation.schemas';
import { uploadProfilePicture } from '../middleware/upload.middleware';

const router = Router();

// POST /api/auth/login
router.post('/login', validate(loginSchema), authController.login);
router.post('/register', validate(registerSchema), authController.register);
router.post('/verify-otp', authController.verifyOTP);
router.post('/resend-otp', authController.resendOTP);
router.get('/me', authenticate, authController.getMe);
router.post('/profile-picture', authenticate, (req, res, next) => {
  console.log('[Profile Upload Route] Starting upload middleware');
  uploadProfilePicture(req, res, (err) => {
    if (err) {
      console.error('[Profile Upload Route] Multer error:', err);
      // Handle multer errors
      if (err instanceof Error) {
        console.error('[Profile Upload Route] Error message:', err.message);
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: 'File upload error' });
    }
    console.log('[Profile Upload Route] Upload middleware completed successfully');
    next();
  });
}, authController.uploadProfilePicture);
router.put('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);

export default router;


