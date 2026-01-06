import { Router } from 'express';
import { logisticsProviderController } from '../controllers/logistics-provider.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireLogisticsProvider } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { createWarehouseSchema, updateWarehouseSchema, createLogisticsAgentSchema, updateLogisticsAgentSchema, updateTransitStatusSchema, markReadyForPickupSchema } from '../utils/validation.schemas';

const router = Router();

// Public route for agents to update their own status (no auth required)
router.post('/agents/update-status-by-phone', logisticsProviderController.updateAgentStatusByPhone);

// All routes below require authentication and logistics provider role
router.use(authenticate);
router.use(requireLogisticsProvider);

// Profile
router.get('/profile', logisticsProviderController.getProfile);

// Dashboard
router.get('/dashboard', logisticsProviderController.getDashboard);

// Orders
router.get('/orders', logisticsProviderController.getOrders);
// Specific order routes must come before the generic /orders/:id route
router.post('/orders/:id/assign-agent', logisticsProviderController.assignOrderToAgent);
router.put('/orders/:id/transit-status', validate(updateTransitStatusSchema), logisticsProviderController.updateTransitStatus);
router.post('/orders/:id/ready-for-pickup', validate(markReadyForPickupSchema), logisticsProviderController.markReadyForPickup);
router.put('/orders/:id/destination-warehouse', logisticsProviderController.updateDestinationWarehouse);
// Generic order detail route must come last
router.get('/orders/:id', logisticsProviderController.getOrderDetails);

// Agents
router.get('/agents', logisticsProviderController.getAgents);
router.post('/agents', validate(createLogisticsAgentSchema), logisticsProviderController.createAgent);
router.put('/agents/:id', validate(updateLogisticsAgentSchema), logisticsProviderController.updateAgent);
router.put('/agents/:id/status', logisticsProviderController.updateAgentStatus);
router.delete('/agents/:id', logisticsProviderController.deleteAgent);

// Scanning
router.post('/scan/origin-warehouse', logisticsProviderController.scanAtOriginWarehouse);
router.post('/scan/destination-warehouse', logisticsProviderController.scanAtDestinationWarehouse);

// Warehouses
router.get('/warehouses', logisticsProviderController.getWarehouses);
router.get('/warehouses/:id', logisticsProviderController.getWarehouseById);
router.post('/warehouses', validate(createWarehouseSchema), logisticsProviderController.createWarehouse);
router.put('/warehouses/:id', validate(updateWarehouseSchema), logisticsProviderController.updateWarehouse);
router.delete('/warehouses/:id', logisticsProviderController.deleteWarehouse);

export default router;

