import { Response } from 'express';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../types';

const svc = () => require('../services/agent.service').agentService;

export const agentController = {
  async getAssignedPickups(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await svc().getAssignedPickups(req.user!.userId);
      sendSuccess(res, data, 'Pickups fetched');
    } catch (err: any) { sendError(res, err.message, 400); }
  },
  async getPickupById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await svc().getPickupById(req.params.id, req.user!.userId);
      sendSuccess(res, data, 'Pickup fetched');
    } catch (err: any) { sendError(res, err.message, 400); }
  },
  async acceptPickup(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await svc().acceptPickup(req.params.id, req.user!.userId);
      sendSuccess(res, data, 'Pickup accepted, OTP sent');
    } catch (err: any) { sendError(res, err.message, 400); }
  },
  async verifyOTP(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await svc().verifyOTPAndConfirmPickup(req.params.id, req.user!.userId, req.body.otp);
      sendSuccess(res, data, 'Pickup confirmed');
    } catch (err: any) { sendError(res, err.message, 400); }
  },
  async getProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await svc().getProfile(req.user!.userId);
      sendSuccess(res, data, 'Profile fetched');
    } catch (err: any) { sendError(res, err.message, 400); }
  },

  // ── Marketplace Deliveries (L2 Fulfillment) ───────────────────
  async getMarketplaceDeliveries(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await svc().getMarketplaceDeliveries(req.user!.userId);
      sendSuccess(res, data, 'Deliveries fetched');
    } catch (err: any) { sendError(res, err.message, 400); }
  },
  
  async updateDeliveryStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { status } = req.body;
      if (!status) throw new Error('status is required');
      const data = await svc().updateDeliveryStatus(req.params.id, req.user!.userId, status);
      sendSuccess(res, data, 'Delivery status updated');
    } catch (err: any) { sendError(res, err.message, 400); }
  },
};
