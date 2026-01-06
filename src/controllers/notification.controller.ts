import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

export const notificationController = {
  // GET /api/notifications - Get user notifications
  // NOTIFICATIONS DISABLED - Returns empty response
  async getNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      // Notifications feature disabled
      res.json({
        notifications: [],
        unreadCount: 0,
      });
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/notifications/:id/read - Mark notification as read
  // NOTIFICATIONS DISABLED - Returns success without action
  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      // Notifications feature disabled
      res.json({ message: 'Notification marked as read' });
    } catch (error) {
      next(error);
    }
  },

  // PUT /api/notifications/read-all - Mark all notifications as read
  // NOTIFICATIONS DISABLED - Returns success without action
  async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      // Notifications feature disabled
      res.json({ message: 'All notifications marked as read' });
    } catch (error) {
      next(error);
    }
  },
};


