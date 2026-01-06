import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { mailService } from '../services/mail.service';
import axios from 'axios';

export const publicController = {
  // GET /api/public/orders/:id/track - Public order tracking (no auth required)
  async trackOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: 'Order ID is required' });
      }

      // Find order by ID (first 8 characters match or full ID) - using select to avoid non-existent columns
      const order = await prisma.order.findFirst({
        where: {
          OR: [
            { id: id },
            { id: { startsWith: id.toUpperCase() } },
            { id: { startsWith: id.toLowerCase() } },
          ],
        },
        select: {
          id: true,
          status: true,
          pickupLat: true,
          pickupLng: true,
          dropLat: true,
          dropLng: true,
          priority: true,
          estimatedDuration: true,
          actualDuration: true,
          assignedAt: true,
          pickedUpAt: true,
          deliveredAt: true,
          cancelledAt: true,
          cancellationReason: true,
          createdAt: true,
          updatedAt: true,
          partner: {
            select: {
              companyName: true,
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
          agent: {
            select: {
              id: true,
              user: {
                select: {
                  name: true,
                  phone: true,
                },
              },
            },
          },
        },
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Format response for public tracking
      res.json({
        id: order.id,
        trackingNumber: order.id.substring(0, 8).toUpperCase(),
        status: order.status,
        pickup: order.pickupLat != null && order.pickupLng != null ? {
          latitude: order.pickupLat,
          longitude: order.pickupLng,
        } : null,
        dropoff: order.dropLat != null && order.dropLng != null ? {
          latitude: order.dropLat,
          longitude: order.dropLng,
        } : null,
        priority: order.priority || 'NORMAL',
        estimatedDuration: order.estimatedDuration,
        actualDuration: order.actualDuration,
        assignedAt: order.assignedAt?.toISOString(),
        pickedUpAt: order.pickedUpAt?.toISOString(),
        deliveredAt: order.deliveredAt?.toISOString(),
        cancelledAt: order.cancelledAt?.toISOString(),
        cancellationReason: order.cancellationReason,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        partner: {
          name: order.partner.user.name,
          companyName: order.partner.companyName,
        },
        agent: order.agent ? {
          name: order.agent.user.name,
          phone: order.agent.user.phone,
        } : null,
      });
    } catch (error) {
      next(error);
    }
  },

  // GET /api/public/directions - Proxy for Google Directions API (no auth required)
  async getDirections(req: Request, res: Response, next: NextFunction) {
    try {
      const { origin, destination } = req.query;

      if (!origin || !destination) {
        return res.status(400).json({ error: 'Origin and destination are required' });
      }

      // Check both environment variable names for flexibility
      const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (!googleApiKey) {
        return res.status(500).json({ 
          error: 'Google Maps API key is not configured',
          message: 'Please set GOOGLE_MAPS_API_KEY or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in your backend .env file'
        });
      }

      const url = `https://maps.googleapis.com/maps/api/directions/json`;
      const response = await axios.get(url, {
        params: {
          origin: origin,
          destination: destination,
          key: googleApiKey,
        },
        timeout: 10000, // 10 second timeout
      });

      // Handle different Google Maps API response statuses
      if (response.data.status === 'OK') {
        // Success - return the data
      } else if (response.data.status === 'ZERO_RESULTS') {
        // No route found - this is a valid response, not an error
        return res.status(200).json({
          status: 'ZERO_RESULTS',
          message: 'No route found between the specified locations',
          routes: [],
        });
      } else if (response.data.status === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'Location not found',
          message: response.data.error_message || 'One or both locations could not be found',
        });
      } else if (response.data.status === 'INVALID_REQUEST') {
        return res.status(400).json({
          error: 'Invalid request',
          message: response.data.error_message || 'The request was invalid',
        });
      } else {
        // Other errors (OVER_QUERY_LIMIT, REQUEST_DENIED, UNKNOWN_ERROR)
        return res.status(400).json({
          error: `Directions API error: ${response.data.status}`,
          message: response.data.error_message || 'An error occurred while fetching directions',
        });
      }

      res.json(response.data);
    } catch (error: any) {
      if (error.response) {
        // API returned an error response
        return res.status(error.response.status).json({
          error: 'Directions API error',
          message: error.response.data?.error_message || error.message,
        });
      } else if (error.request) {
        // Request was made but no response received
        return res.status(504).json({
          error: 'Directions API timeout',
          message: 'The request to Google Directions API timed out',
        });
      } else {
        // Something else happened
        next(error);
      }
    }
  },

  // POST /api/public/contact - Submit contact form (no auth required)
  async submitContact(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, email, phone, subject, message } = req.body;

      // Validate required fields
      if (!name || !email || !subject || !message) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Name, email, subject, and message are required',
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: 'Invalid email format',
        });
      }

      // Send contact email
      const emailSent = await mailService.sendContactEmail({
        name,
        email,
        phone: phone || 'Not provided',
        subject,
        message,
      });

      if (!emailSent) {
        console.error('Failed to send contact email');
        // Still return success to user, but log the error
      }

      res.json({
        message: 'Contact form submitted successfully. We will get back to you soon!',
      });
    } catch (error: any) {
      console.error('Contact form error:', error);
      next(error);
    }
  },
};

