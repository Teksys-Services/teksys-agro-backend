import { Router } from 'express';
import { adminController } from '../controllers/admin.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);


router.post('/rates', adminController.setRate);
router.get('/rates', adminController.getRates);
router.get('/pickups', adminController.getAllPickups);
router.get('/pickups/eligible-agents', adminController.getEligibleAgents);
router.post('/pickups/:pickupId/assign', adminController.assignAgent);
router.post('/pickups/:pickupId/approve', adminController.approvePickup);
router.post('/bills/generate', adminController.generateBill);
router.get('/payments/pending', adminController.getPendingPayments);
router.patch('/payments/:paymentId/mark-paid', adminController.markPaymentPaid);
router.get('/farmers', adminController.getAllFarmers);
router.get('/agents', adminController.getAllAgents);
router.get('/summary', adminController.getSummary);

// Marketplace Orders (L2 Fulfillment)
router.get('/marketplace-orders', adminController.getMarketplaceOrders);
router.get('/marketplace-orders/eligible-agents', adminController.getAvailableAgentsForDelivery);
router.get('/marketplace-orders/:id', adminController.getMarketplaceOrderById);
router.patch('/marketplace-orders/:id/status', adminController.updateMarketplaceOrderStatus);
router.post('/marketplace-orders/:id/assign', adminController.assignDeliveryAgent);

export default router;
