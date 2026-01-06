import { Request, Response, NextFunction } from 'express';
import { restaurantService } from '../services/restaurant.service';
import { createRestaurantSchema, updateRestaurantSchema } from '../utils/validation.schemas';
import { getPartnerId } from '../utils/role.util';

export const restaurantController = {
  /**
   * Create a restaurant
   * POST /api/partner/restaurants
   */
  async createRestaurant(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(403).json({ error: 'Only partners can create restaurants' });
      }

      const validatedData = createRestaurantSchema.parse(req.body);
      const restaurant = await restaurantService.createRestaurant(partnerId, validatedData);

      res.status(201).json(restaurant);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation error', details: error.errors });
      }
      if (error.message.includes('Only food delivery partners')) {
        return res.status(403).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * Get restaurants with filters
   * GET /api/partner/restaurants
   */
  async getRestaurants(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = req.query.partnerId as string | undefined;
      const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

      const restaurants = await restaurantService.getRestaurants({
        partnerId,
        isActive,
      });

      res.json(restaurants);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get restaurants available for pickup selection
   * GET /api/partner/restaurants/available-for-pickup
   */
  async getAvailableRestaurants(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      const restaurants = await restaurantService.getAvailableRestaurants(partnerId || undefined);

      res.json(restaurants);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get a single restaurant
   * GET /api/partner/restaurants/:id
   */
  async getRestaurantById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const restaurant = await restaurantService.getRestaurantById(id);

      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      res.json(restaurant);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Update a restaurant
   * PUT /api/partner/restaurants/:id
   */
  async updateRestaurant(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(403).json({ error: 'Only partners can update restaurants' });
      }

      const { id } = req.params;
      const validatedData = updateRestaurantSchema.parse(req.body);

      const restaurant = await restaurantService.updateRestaurant(id, partnerId, validatedData);

      res.json(restaurant);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation error', details: error.errors });
      }
      if (error.message === 'Restaurant not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('Unauthorized')) {
        return res.status(403).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * Delete a restaurant
   * DELETE /api/partner/restaurants/:id
   */
  async deleteRestaurant(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(403).json({ error: 'Only partners can delete restaurants' });
      }

      const { id } = req.params;
      await restaurantService.deleteRestaurant(id, partnerId);

      res.json({ message: 'Restaurant deleted successfully' });
    } catch (error: any) {
      if (error.message === 'Restaurant not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('Unauthorized')) {
        return res.status(403).json({ error: error.message });
      }
      next(error);
    }
  },

  /**
   * Get restaurants owned by the current partner
   * GET /api/partner/restaurants/my-restaurants
   */
  async getMyRestaurants(req: Request, res: Response, next: NextFunction) {
    try {
      const partnerId = getPartnerId(req);
      if (!partnerId) {
        return res.status(403).json({ error: 'Only partners can view their restaurants' });
      }

      const restaurants = await restaurantService.getPartnerRestaurants(partnerId);

      res.json(restaurants);
    } catch (error) {
      next(error);
    }
  },
};
















