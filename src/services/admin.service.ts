import { supabase } from '../config/supabase';
import { getVehicleTypeForWeight } from '../types';


export const adminService = {

  async setRate(dto: any, adminId: string) {
    const { data, error } = await supabase.from('area_rates').insert({
      area: dto.area, category: dto.category, item_name: dto.item_name,
      rate_per_kg: dto.rate_per_kg, unit: dto.unit || 'kg',
      effective_date: dto.effective_date || new Date().toISOString().split('T')[0],
      set_by: adminId,
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async getRates() {
    const { data, error } = await supabase.from('area_rates').select('*').order('area');
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getAllPickups(status?: string) {
    let query = supabase.from('pickup_requests')
      .select('*, farmer:farmer_id(id, name, phone), agent:assigned_agent_id(id, name, phone)')
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getEligibleAgents(weightKg: number) {
    const vehicleType = getVehicleTypeForWeight(weightKg);
    const vehiclePriority = ['bike', 'three_wheeler', 'mini_truck', 'truck'];
    const minIndex = vehiclePriority.indexOf(vehicleType);
    const eligibleVehicles = vehiclePriority.slice(minIndex);

    const { data, error } = await supabase
      .from('agent_profiles')
      .select('*, user:user_id(id, name, phone)')
      .in('vehicle_type', eligibleVehicles)
      .eq('is_available', true);
    if (error) throw new Error(error.message);
    return data || [];
  },

  async assignAgent(pickupId: string, agentId: string, adminId: string) {
    const { data: pickup } = await supabase
      .from('pickup_requests').select('*').eq('id', pickupId).single();
    if (!pickup) throw new Error('Pickup not found');
    if (pickup.status !== 'created') throw new Error('Pickup already assigned or processed');

    const { data: agent } = await supabase
      .from('agent_profiles').select('max_weight_kg').eq('user_id', agentId).single();
    if (!agent) throw new Error('Agent not found');
    if (agent.max_weight_kg < pickup.weight_kg) throw new Error('Agent vehicle cannot handle this weight');

    await supabase.from('pickup_requests')
      .update({ assigned_agent_id: agentId, status: 'assigned' }).eq('id', pickupId);

    await supabase.from('delivery_assignments').insert({
      pickup_id: pickupId, agent_id: agentId, status: 'assigned',
    });

    await supabase.from('status_logs').insert({
      pickup_id: pickupId, old_status: 'created', new_status: 'assigned',
      changed_by: adminId, notes: `Agent assigned by admin`,
    });

    return { message: 'Agent assigned successfully' };
  },

  async approvePickup(pickupId: string, adminId: string) {
    const { data: pickup } = await supabase
      .from('pickup_requests').select('*').eq('id', pickupId).single();
    if (!pickup) throw new Error('Pickup not found');
    if (pickup.status !== 'picked_up') throw new Error('Pickup not yet collected by agent');

    await supabase.from('pickup_requests')
      .update({ status: 'admin_approved' }).eq('id', pickupId);

    await supabase.from('status_logs').insert({
      pickup_id: pickupId, old_status: 'picked_up', new_status: 'admin_approved',
      changed_by: adminId, notes: 'Approved by admin',
    });

    return { message: 'Pickup approved' };
  },

  async generateBill(farmerId: string, month: number, year: number, adminId: string) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;

    const { data: pickups } = await supabase
      .from('pickup_requests').select('*')
      .eq('farmer_id', farmerId).eq('status', 'admin_approved')
      .gte('created_at', startDate).lt('created_at', endDate);

    if (!pickups || pickups.length === 0) throw new Error('No approved pickups for this period');

    const totalWeight = pickups.reduce((s: number, p: any) => s + Number(p.weight_kg), 0);
    const totalAmount = pickups.reduce((s: number, p: any) => s + Number(p.estimated_amount || 0), 0);
    const billNumber = `BILL-${farmerId.slice(0, 6).toUpperCase()}-${year}-${String(month).padStart(2, '0')}`;

    const { data: bill, error } = await supabase.from('bills').insert({
      farmer_id: farmerId, bill_number: billNumber,
      month, year, total_weight_kg: totalWeight,
      total_amount: totalAmount, status: 'payment_pending',
    }).select().single();
    if (error) throw new Error(error.message);

    const items = pickups.map((p: any) => ({
      bill_id: bill.id, pickup_id: p.id,
      item_name: p.item_name, category: p.category,
      weight_kg: p.weight_kg, rate_per_kg: p.rate_per_kg || 0,
      amount: p.estimated_amount || 0,
    }));
    await supabase.from('bill_items').insert(items);

    await supabase.from('pickup_requests')
      .update({ status: 'payment_pending' })
      .in('id', pickups.map((p: any) => p.id));

    await supabase.from('payments').insert({
      bill_id: bill.id, farmer_id: farmerId,
      amount: totalAmount, status: 'pending',
      marked_by: adminId,
    });

    return bill;
  },

  async markPaymentPaid(paymentId: string, dto: any, adminId: string) {
    const { data: payment } = await supabase
      .from('payments').select('*, bill:bill_id(*)').eq('id', paymentId).single();
    if (!payment) throw new Error('Payment not found');
    if (payment.status === 'completed') throw new Error('Payment already completed');

    const { data, error } = await supabase.from('payments').update({
      status: 'completed',
      payout_reference_id: dto.payout_reference_id,
      razorpay_payout_id: dto.razorpay_payout_id || null,
      payment_mode: dto.payment_mode || 'bank_transfer',
      notes: dto.notes || null,
      paid_at: new Date().toISOString(),
      marked_by: adminId,
    }).eq('id', paymentId).select().single();
    if (error) throw new Error(error.message);

    await supabase.from('bills')
      .update({ status: 'paid' }).eq('id', payment.bill_id);

    await supabase.from('pickup_requests')
      .update({ status: 'payment_completed' })
      .eq('farmer_id', payment.farmer_id).eq('status', 'payment_pending');

    return data;
  },

  async getAllFarmers() {
    const { data, error } = await supabase
      .from('users').select('*, farmer_profiles(*), farmer_bank_details(account_holder_name, bank_name, ifsc_code)')
      .eq('role', 'farmer');
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getAllAgents() {
    const { data, error } = await supabase
      .from('users').select('*, agent_profiles(*)')
      .eq('role', 'agent');
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getSummary() {
    const [pickups, bills, payments, product_requests, marketplace_orders] = await Promise.all([
      supabase.from('pickup_requests').select('status', { count: 'exact' }),
      supabase.from('bills').select('status, total_amount'),
      supabase.from('payments').select('status, amount'),
      supabase.from('product_requests').select('status', { count: 'exact' }),
      supabase.from('marketplace_orders').select('status', { count: 'exact' }),
    ]);
    return {
      pickups: pickups.data || [],
      bills: bills.data || [],
      payments: payments.data || [],
      product_requests: product_requests.data || [],
      marketplace_orders: marketplace_orders.data || [],
    };
  },

  async getPendingPayments() {
    const { data, error } = await supabase
      .from('payments')
      .select('*, farmer:farmer_id(id, name, phone), bill:bill_id(bill_number, month, year, total_amount)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  // ── Marketplace Orders (L2 Fulfillment) ──────────────────────
  async getMarketplaceOrders() {
    const { data, error } = await supabase
      .from('marketplace_orders')
      .select('*, customer:customer_id(name, phone, email), assigned_agent:assigned_agent_id(name, phone)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getMarketplaceOrderById(orderId: string) {
    const { data, error } = await supabase
      .from('marketplace_orders')
      .select('*, customer:customer_id(name, phone, email), assigned_agent:assigned_agent_id(name, phone)')
      .eq('id', orderId)
      .single();
    if (error) throw new Error(error.message);

    const { data: items } = await supabase
      .from('marketplace_order_items')
      .select('*')
      .eq('order_id', orderId);

    return { ...data, items: items || [] };
  },

  async updateMarketplaceOrderStatus(orderId: string, status: string, adminId: string) {
    const validStatuses = ['confirmed', 'preparing', 'ready_for_pickup', 'assigned', 'accepted_by_agent', 'picked_up', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned'];
    if (!validStatuses.includes(status)) throw new Error('Invalid status');

    const updateData: any = { status };
    if (status === 'packed' || status === 'preparing') updateData.packed_at = new Date().toISOString();

    const { error } = await supabase
      .from('marketplace_orders')
      .update(updateData)
      .eq('id', orderId);
    if (error) throw new Error(error.message);

    return { message: 'Order status updated successfully' };
  },

  async getAvailableAgentsForDelivery() {
    const { data, error } = await supabase
      .from('agent_profiles')
      .select('*, user:user_id(name, phone, email)')
      .eq('is_available', true);
    if (error) throw new Error(error.message);

    // Fetch their current active orders/pickups to calculate workload
    const agents = [];
    for (const agent of data || []) {
      const { data: orders } = await supabase
        .from('marketplace_orders')
        .select('id')
        .eq('assigned_agent_id', agent.user_id)
        .in('status', ['assigned', 'accepted_by_agent', 'picked_up', 'out_for_delivery']);
      
      const { data: pickups } = await supabase
        .from('pickup_requests')
        .select('id')
        .eq('assigned_agent_id', agent.user_id)
        .in('status', ['assigned', 'otp_generated']);
        
      agents.push({
        ...agent,
        active_deliveries: (orders?.length || 0) + (pickups?.length || 0)
      });
    }

    return agents.sort((a, b) => a.active_deliveries - b.active_deliveries);
  },

  async assignDeliveryAgent(orderId: string, agentId: string, adminId: string) {
    const { error } = await supabase
      .from('marketplace_orders')
      .update({
        assigned_agent_id: agentId,
        assigned_by: adminId,
        assigned_at: new Date().toISOString(),
        status: 'assigned'
      })
      .eq('id', orderId);
      
    if (error) throw new Error(error.message);

    // Record notification for the agent could be added here
    return { message: 'Delivery agent assigned successfully' };
  }
};
