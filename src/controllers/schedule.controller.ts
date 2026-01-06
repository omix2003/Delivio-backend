import { Request, Response, NextFunction } from 'express';
import { scheduleService } from '../services/schedule.service';
import { getAgentId } from '../utils/role.util';
import { AppError } from '../utils/errors.util';

export const scheduleController = {
  // POST /api/agent/schedule - Set agent schedule
  async setSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const { date, startTime, endTime, isAvailable, notes } = req.body;

      if (!date) {
        throw new AppError('Date is required', 400);
      }

      const scheduleDate = new Date(date);
      const schedule = await scheduleService.setAgentSchedule(
        agentId,
        scheduleDate,
        startTime,
        endTime,
        isAvailable !== undefined ? isAvailable : true,
        notes
      );

      res.json({
        success: true,
        schedule,
      });
    } catch (error: any) {
      next(error);
    }
  },

  // GET /api/agent/schedule - Get agent schedule
  async getSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        throw new AppError('startDate and endDate are required', 400);
      }

      const schedule = await scheduleService.getAgentSchedule(
        agentId,
        new Date(startDate as string),
        new Date(endDate as string)
      );

      res.json({
        success: true,
        schedule,
      });
    } catch (error: any) {
      next(error);
    }
  },

  // GET /api/agent/calendar - Get calendar view (monthly/weekly)
  async getCalendar(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const { viewType, startDate } = req.query;

      if (!viewType || !startDate) {
        throw new AppError('viewType and startDate are required', 400);
      }

      if (viewType !== 'MONTHLY' && viewType !== 'WEEKLY') {
        throw new AppError('viewType must be MONTHLY or WEEKLY', 400);
      }

      const calendar = await scheduleService.getAgentCalendar(
        agentId,
        viewType as 'MONTHLY' | 'WEEKLY',
        new Date(startDate as string)
      );

      res.json({
        success: true,
        calendar,
      });
    } catch (error: any) {
      next(error);
    }
  },

  // GET /api/agent/schedule/availability - Check availability
  async checkAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = getAgentId(req);
      if (!agentId) {
        return res.status(404).json({ error: 'Agent profile not found' });
      }

      const { date, time } = req.query;

      if (!date) {
        throw new AppError('Date is required', 400);
      }

      const isAvailable = await scheduleService.isAgentAvailable(
        agentId,
        new Date(date as string),
        time as string | undefined
      );

      res.json({
        success: true,
        isAvailable,
      });
    } catch (error: any) {
      next(error);
    }
  },
};



