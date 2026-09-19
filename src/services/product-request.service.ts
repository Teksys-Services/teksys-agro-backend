import { supabase } from '../config/supabase';
import { notificationService } from './notification.service';

export const productRequestService = {

  // ── Customer Methods ──────────────────────────────────────────

  async create(customerId: string, dto: {
    product_id?: string;
    requested_product_name: string;
    category?: string;
    requested_quantity: number;
    available_quantity?: number;
    unit?: string;
    delivery_address?: string;
    preferred_delivery_date?: string;
    notes?: string;
    contact_number?: string;
  }) {
    const remaining = dto.requested_quantity - (dto.available_quantity || 0);

    const { data, error } = await supabase
      .from('product_requests')
      .insert({
        customer_id: customerId,
        product_id: dto.product_id || null,
        requested_product_name: dto.requested_product_name,
        category: dto.category || null,
        requested_quantity: dto.requested_quantity,
        available_quantity: dto.available_quantity || 0,
        remaining_quantity: remaining > 0 ? remaining : dto.requested_quantity,
        unit: dto.unit || 'kg',
        delivery_address: dto.delivery_address || null,
        preferred_delivery_date: dto.preferred_delivery_date || null,
        notes: dto.notes || null,
        contact_number: dto.contact_number || null,
        status: 'pending',
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Notify all admins about new request
    try {
      const { data: admins } = await supabase
        .from('users')
        .select('id')
        .eq('role', 'admin');
      if (admins && admins.length > 0) {
        for (const admin of admins) {
          await notificationService.create(admin.id, {
            type: 'product_request',
            title: 'New Product Request',
            body: `A customer requested ${dto.requested_quantity} ${dto.unit || 'kg'} of ${dto.requested_product_name}`,
            data: { request_id: data.id },
          });
        }
      }
    } catch { /* notification failure should not block request creation */ }

    return data;
  },

  async getAll(customerId: string, query: { status?: string; page?: number; limit?: number }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    let q = supabase
      .from('product_requests')
      .select('*, marketplace_products(id, name, slug, image_url, selling_price, stock_quantity, unit)', { count: 'exact' })
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (query.status && query.status !== 'all') {
      q = q.eq('status', query.status);
    }

    q = q.range(offset, offset + limit - 1);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    return {
      requests: data || [],
      pagination: { page, limit, total: count || 0, total_pages: Math.ceil((count || 0) / limit) },
    };
  },

  async getById(customerId: string, requestId: string) {
    const { data, error } = await supabase
      .from('product_requests')
      .select('*, marketplace_products(id, name, slug, image_url, selling_price, stock_quantity, unit), users!product_requests_customer_id_fkey(name, phone, email)')
      .eq('id', requestId)
      .eq('customer_id', customerId)
      .single();
    if (error) throw new Error('Request not found');
    return data;
  },

  async update(customerId: string, requestId: string, dto: {
    requested_product_name?: string;
    category?: string;
    requested_quantity?: number;
    unit?: string;
    delivery_address?: string;
    preferred_delivery_date?: string;
    notes?: string;
    contact_number?: string;
  }) {
    // Verify it's pending
    const { data: existing } = await supabase
      .from('product_requests')
      .select('status')
      .eq('id', requestId)
      .eq('customer_id', customerId)
      .single();
    if (!existing) throw new Error('Request not found');
    if (existing.status !== 'pending') throw new Error('Only pending requests can be edited');

    const updateData: any = { ...dto, updated_at: new Date().toISOString() };

    // Recalculate remaining if quantity changed
    if (dto.requested_quantity !== undefined) {
      const { data: req } = await supabase
        .from('product_requests')
        .select('available_quantity')
        .eq('id', requestId)
        .single();
      if (req) {
        updateData.remaining_quantity = Math.max(0, dto.requested_quantity - (req.available_quantity || 0));
      }
    }

    const { data, error } = await supabase
      .from('product_requests')
      .update(updateData)
      .eq('id', requestId)
      .eq('customer_id', customerId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async cancel(customerId: string, requestId: string) {
    const { data: existing } = await supabase
      .from('product_requests')
      .select('status')
      .eq('id', requestId)
      .eq('customer_id', customerId)
      .single();
    if (!existing) throw new Error('Request not found');
    if (existing.status !== 'pending') throw new Error('Only pending requests can be cancelled');

    const { data, error } = await supabase
      .from('product_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('customer_id', customerId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  // ── Admin Methods ─────────────────────────────────────────────

  async getAllAdmin(query: { status?: string; search?: string; page?: number; limit?: number }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    let q = supabase
      .from('product_requests')
      .select('*, marketplace_products(id, name, slug, stock_quantity, unit), users!product_requests_customer_id_fkey(name, phone, email)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (query.status && query.status !== 'all') {
      q = q.eq('status', query.status);
    }
    if (query.search) {
      q = q.ilike('requested_product_name', `%${query.search}%`);
    }

    q = q.range(offset, offset + limit - 1);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    return {
      requests: data || [],
      pagination: { page, limit, total: count || 0, total_pages: Math.ceil((count || 0) / limit) },
    };
  },

  async getByIdAdmin(requestId: string) {
    const { data, error } = await supabase
      .from('product_requests')
      .select('*, marketplace_products(id, name, slug, image_url, selling_price, stock_quantity, unit), users!product_requests_customer_id_fkey(name, phone, email)')
      .eq('id', requestId)
      .single();
    if (error) throw new Error('Request not found');
    return data;
  },

  async updateStatus(requestId: string, status: string, adminNotes?: string) {
    const validStatuses = ['pending', 'under_review', 'accepted', 'partially_fulfilled', 'ready_for_purchase', 'rejected', 'expired', 'completed', 'on_hold', 'cancelled'];
    if (!validStatuses.includes(status)) throw new Error('Invalid status');

    const updateData: any = { status, updated_at: new Date().toISOString() };
    if (adminNotes !== undefined) updateData.admin_notes = adminNotes;

    const { data, error } = await supabase
      .from('product_requests')
      .update(updateData)
      .eq('id', requestId)
      .select('*, users!product_requests_customer_id_fkey(name)')
      .single();
    if (error) throw new Error(error.message);

    // Notify the customer
    try {
      const statusLabels: Record<string, string> = {
        under_review: 'is now under review',
        accepted: 'has been accepted',
        partially_fulfilled: 'has been partially fulfilled',
        ready_for_purchase: 'is ready for purchase!',
        rejected: 'has been rejected',
        expired: 'has expired',
      };
      const label = statusLabels[status];
      if (label) {
        await notificationService.create(data.customer_id, {
          type: 'product_request',
          title: 'Request Update',
          body: `Your request for ${data.requested_product_name} ${label}`,
          data: { request_id: data.id, status },
        });
      }
    } catch { /* non-critical */ }

    return data;
  },

  async checkInventoryMatch() {
    // Fetch pending/accepted requests that have a linked product
    const { data: requests, error } = await supabase
      .from('product_requests')
      .select('id, customer_id, product_id, requested_product_name, requested_quantity, unit')
      .in('status', ['pending', 'under_review', 'accepted'])
      .not('product_id', 'is', null);

    if (error || !requests || requests.length === 0) {
      return { matched: 0 };
    }

    let matched = 0;

    for (const req of requests) {
      // Get current stock
      const { data: product } = await supabase
        .from('marketplace_products')
        .select('stock_quantity')
        .eq('id', req.product_id)
        .single();

      if (product && product.stock_quantity >= req.requested_quantity) {
        // Stock now meets demand → update status
        await supabase
          .from('product_requests')
          .update({
            status: 'ready_for_purchase',
            available_quantity: product.stock_quantity,
            remaining_quantity: 0,
            updated_at: new Date().toISOString(),
          })
          .eq('id', req.id);

        // Notify customer
        try {
          await notificationService.create(req.customer_id, {
            type: 'product_request',
            title: 'Stock Available!',
            body: `${req.requested_quantity} ${req.unit} of ${req.requested_product_name} is now available for purchase!`,
            data: { request_id: req.id, status: 'ready_for_purchase' },
          });
        } catch { }

        matched++;
      }
    }

    return { matched };
  },
};
