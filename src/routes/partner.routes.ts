import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requirePartner } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { partnerController } from '../controllers/partner.controller';
import { partnerPayoutController } from '../controllers/partner-payout.controller';
import { warehouseController } from '../controllers/warehouse.controller';
import { restaurantController } from '../controllers/restaurant.controller';
import { updateWebhookSchema, createOrderSchema, updateOrderSchema, bulkOrderSchema, deleteBulkOrdersSchema, createWarehouseSchema, updateWarehouseSchema, createRestaurantSchema, updateRestaurantSchema } from '../utils/validation.schemas';

const router = Router();

// All routes require authentication and partner role
router.use(authenticate);
router.use(requirePartner);

// Partner profile routes
router.get('/profile', partnerController.getProfile);
router.get('/logistics-providers', partnerController.getLogisticsProviders);
router.put('/webhook', validate(updateWebhookSchema), partnerController.updateWebhook);
router.post('/regenerate-api-key', partnerController.regenerateApiKey);

// Partner order routes
// Specific routes must come before generic /orders/:id routes
router.post('/orders', validate(createOrderSchema), partnerController.createOrder);
router.post('/orders/bulk', validate(bulkOrderSchema), partnerController.createBulkOrders);
router.delete('/orders/bulk', validate(deleteBulkOrdersSchema), partnerController.deleteBulkOrders);
router.get('/orders', partnerController.getOrders);
// Generic order routes must come after specific routes
router.get('/orders/:id', partnerController.getOrderDetails);
router.get('/orders/:id/agent-location', partnerController.getOrderAgentLocation);
router.put('/orders/:id', validate(updateOrderSchema), partnerController.updateOrder);
router.post('/orders/:id/cancel', partnerController.cancelOrder);

// Partner dashboard and analytics
router.get('/dashboard', partnerController.getDashboardMetrics);
router.get('/analytics', partnerController.getAnalytics);
router.get('/analytics/heatmap', partnerController.getOrderHeatmap);

// Support tickets
router.get('/support/tickets', partnerController.getSupportTickets);
router.post('/support/tickets', partnerController.createSupportTicket);

// Payout routes (partners track payouts, not revenue)
router.get('/payouts/summary', partnerPayoutController.getPayoutSummary);
router.get('/payouts', partnerPayoutController.getPayouts);

// Warehouse management routes (available to all partners except FOOD_DELIVERY)
router.post('/warehouses', validate(createWarehouseSchema), warehouseController.createWarehouse);
router.get('/warehouses', warehouseController.getWarehouses);
router.get('/warehouses/my-warehouses', warehouseController.getMyWarehouses);
router.get('/warehouses/available-for-drop', warehouseController.getAvailableDropWarehouses); // Available to all partners
router.get('/warehouses/:id', warehouseController.getWarehouseById);
router.put('/warehouses/:id', validate(updateWarehouseSchema), warehouseController.updateWarehouse);
router.delete('/warehouses/:id', warehouseController.deleteWarehouse);

// Restaurant management routes (available only to FOOD_DELIVERY partners)
router.post('/restaurants', validate(createRestaurantSchema), restaurantController.createRestaurant);
router.get('/restaurants', restaurantController.getRestaurants);
router.get('/restaurants/my-restaurants', restaurantController.getMyRestaurants);
router.get('/restaurants/available-for-pickup', restaurantController.getAvailableRestaurants);
router.get('/restaurants/:id', restaurantController.getRestaurantById);
router.put('/restaurants/:id', validate(updateRestaurantSchema), restaurantController.updateRestaurant);
router.delete('/restaurants/:id', restaurantController.deleteRestaurant);

// Pricing profile routes (must come after all specific routes to avoid route conflicts)
router.put('/pricing', partnerController.updatePricingProfile);
router.put('/:id/pricing', partnerController.updatePricingProfile); // Alternative route

// NOTE: Legacy logistics routes removed - use /api/logistics-provider/* routes instead
// These routes were for partners with LOGISTICS_PROVIDER category, which has been migrated
// to the new LOGISTICS_PROVIDER role with separate routes

export default router;