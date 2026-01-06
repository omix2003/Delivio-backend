import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireAgent, requireAgentOrAdmin } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { agentController } from '../controllers/agent.controller';
import { scanningController } from '../controllers/scanning.controller';
import { verificationController } from '../controllers/verification.controller';
import { scheduleController } from '../controllers/schedule.controller';
import { walletController } from '../controllers/wallet.controller';
import { uploadSingle } from '../middleware/upload.middleware';
import {
  updateLocationSchema,
  updateStatusSchema,
  agentProfileUpdateSchema,
  updateOrderStatusSchema,
} from '../utils/validation.schemas';

const router = Router();

// Test route without authentication to verify routes are registered
router.get('/test', (req, res) => {
  res.json({ message: 'Agent routes are working!', path: req.path, timestamp: new Date().toISOString() });
});

// All routes require authentication
router.use(authenticate);

// Agent profile routes - require agent role
router.get('/profile', requireAgent, agentController.getProfile);
router.put('/profile', requireAgent, validate(agentProfileUpdateSchema), agentController.updateProfile);

// Agent location - require agent role
router.post('/location', requireAgent, validate(updateLocationSchema), agentController.updateLocation);

// Agent status - allow both agent and admin roles
router.post('/status', requireAgentOrAdmin, validate(updateStatusSchema), agentController.updateStatus);

// Agent metrics
router.get('/metrics', requireAgent, agentController.getMetrics);

// Agent order management
router.get('/orders', requireAgent, agentController.getAvailableOrders);
router.get('/my-orders', requireAgent, agentController.getMyOrders);
router.get('/orders/:id', requireAgent, agentController.getOrderDetails);
router.post('/orders/:id/accept', requireAgent, agentController.acceptOrder);
router.post('/orders/:id/reject', requireAgent, agentController.rejectOrder);
router.put('/orders/:id/status', requireAgent, validate(updateOrderStatusSchema), agentController.updateOrderStatus);

// Agent document management
router.get('/documents', requireAgent, agentController.getDocuments);
router.post('/documents', requireAgent, (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err) {
      // Handle multer errors
      if (err instanceof Error) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: 'File upload error' });
    }
    next();
  });
}, agentController.uploadDocument);
router.delete('/documents/:id', requireAgent, agentController.deleteDocument);

// Support tickets
router.get('/support/tickets', requireAgent, agentController.getSupportTickets);
router.post('/support/tickets', requireAgent, agentController.createSupportTicket);

// Barcode/QR Scanning
router.post('/scan/barcode', requireAgent, scanningController.scanBarcode);
router.post('/scan/qr', requireAgent, scanningController.scanQRCode);
router.post('/scan/pickup-otp', requireAgent, scanningController.verifyPickupWithOTP);

// Delivery Verification
router.post('/orders/:id/generate-verification', requireAgent, verificationController.generateVerification);
router.post('/orders/:id/verify-otp', requireAgent, verificationController.verifyWithOTP);
router.post('/orders/:id/verify-qr', requireAgent, verificationController.verifyWithQR);
router.get('/orders/:id/verification', requireAgent, verificationController.getVerification);

// Payments & Payroll - REMOVED: Agents now see earnings directly in wallet

    // Schedule & Calendar
    router.post('/schedule', requireAgent, scheduleController.setSchedule);
    router.get('/schedule', requireAgent, scheduleController.getSchedule);
    router.get('/schedule/availability', requireAgent, scheduleController.checkAvailability);
    router.get('/calendar', requireAgent, scheduleController.getCalendar);

    // Wallet & Payouts
    router.get('/wallet', requireAgent, walletController.getAgentWallet);
    router.get('/wallet/transactions', requireAgent, walletController.getAgentWalletTransactions);
    router.get('/payouts', requireAgent, walletController.getAgentPayouts);

    export default router;