import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All notification routes require authentication
router.use(authenticate);

// GET /api/notifications - Get user notifications
router.get('/', notificationController.getNotifications);

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', notificationController.markAsRead);

// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', notificationController.markAllAsRead);

console.log('🔔 Notification routes registered:');
console.log('  GET /api/notifications');
console.log('  PUT /api/notifications/:id/read');
console.log('  PUT /api/notifications/read-all');

export default router;















