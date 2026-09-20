import { Router } from 'express';
import { agentController } from '../controllers/agent.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);


router.get('/profile', agentController.getProfile);
router.get('/pickups', agentController.getAssignedPickups);
router.get('/pickups/:id', agentController.getPickupById);
router.post('/pickups/:id/accept', agentController.acceptPickup);
router.post('/pickups/:id/verify-otp', agentController.verifyOTP);

// Marketplace Deliveries (L2 Fulfillment)
router.get('/marketplace-deliveries', agentController.getMarketplaceDeliveries);
router.patch('/marketplace-deliveries/:id/status', agentController.updateDeliveryStatus);

export default router;
