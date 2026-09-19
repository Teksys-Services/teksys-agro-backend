import { supabase } from '../config/supabase';
import { cartService } from './cart.service';
import { inventoryService } from './inventory.service';

function generateOrderNumber(): string {
  const prefix = 'TA';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

export const orderService = {

  async placeOrder(customerId: string, dto: {
    address_id: string;
    payment_method: string;
    delivery_slot?: string;
    coupon_code?: string;
    notes?: string;
  }) {
    // Get cart
    const cart = await cartService.getCart(customerId);
    if (cart.items.length === 0) throw new Error('Cart is empty');

    // Get address
    const { data: address } = await supabase
      .from('customer_addresses')
      .select('*')
      .eq('id', dto.address_id)
      .eq('customer_id', customerId)
      .single();
    if (!address) throw new Error('Address not found');

    // Calculate coupon discount
    let discountAmount = 0;
    let couponId = null;
    let couponCode = null;

    if (dto.coupon_code) {
      const { data: coupon } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', dto.coupon_code.toUpperCase())
        .eq('is_active', true)
        .single();

      if (!coupon) throw new Error('Invalid coupon code');
      if (coupon.valid_until && new Date(coupon.valid_until) < new Date()) throw new Error('Coupon expired');
      if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) throw new Error('Coupon usage limit reached');
      if (cart.subtotal < coupon.min_order_amount) throw new Error(`Minimum order amount is ₹${coupon.min_order_amount}`);

      // Check if already used by customer
      const { data: used } = await supabase
        .from('coupon_usage')
        .select('id')
        .eq('coupon_id', coupon.id)
        .eq('customer_id', customerId)
        .single();
      if (used) throw new Error('Coupon already used');

      if (coupon.discount_type === 'percentage') {
        discountAmount = (cart.subtotal * coupon.discount_value) / 100;
        if (coupon.max_discount_amount && discountAmount > coupon.max_discount_amount) {
          discountAmount = coupon.max_discount_amount;
        }
      } else {
        discountAmount = coupon.discount_value;
      }

      couponId = coupon.id;
      couponCode = coupon.code;
    }

    const subtotal = cart.subtotal;
    const gst = cart.gst;
    const deliveryCharges = cart.delivery_charges;
    const totalAmount = subtotal - discountAmount + gst + deliveryCharges;

    // Validate stock on client side before calling RPC
    const cartItemsData = cart.items.map(item => {
      const product = item.marketplace_products;
      if (!product) throw new Error('Product not available');
      return {
        product_id: product.id,
        quantity: item.quantity,
      };
    });

    const orderNumber = generateOrderNumber();

    // Call atomic RPC
    const { data: orderData, error } = await supabase.rpc('place_marketplace_order', {
      p_customer_id: customerId,
      p_order_number: orderNumber,
      p_subtotal: subtotal,
      p_discount_amount: Math.round(discountAmount * 100) / 100,
      p_delivery_charges: deliveryCharges,
      p_gst_amount: gst,
      p_total_amount: Math.round(totalAmount * 100) / 100,
      p_coupon_id: couponId,
      p_coupon_code: couponCode,
      p_payment_method: dto.payment_method,
      p_payment_status: dto.payment_method === 'cod' ? 'pending' : 'pending',
      p_delivery_address_snapshot: address,
      p_delivery_slot: dto.delivery_slot || null,
      p_notes: dto.notes || null,
      p_cart_items: cartItemsData,
    });

    if (error) {
      if (error.message.includes('Insufficient stock')) {
        throw new Error(error.message);
      }
      throw new Error('Failed to place order: ' + error.message);
    }

    const order = {
      id: orderData.id,
      order_number: orderData.order_number,
    };

    // Clear cart
    await cartService.clearCart(customerId);

    // Create notification
    await supabase.from('notifications').insert({
      user_id: customerId,
      type: 'order',
      title: 'Order Placed Successfully!',
      body: `Your order #${order.order_number} has been confirmed.`,
      data: { order_id: order.id, order_number: order.order_number },
    });

    return order;
  },

  async getOrders(customerId: string, status?: string) {
    let q = supabase
      .from('marketplace_orders')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (status) q = q.eq('status', status);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    // Fetch items for each order
    const orders = [];
    for (const order of data || []) {
      const { data: items } = await supabase
        .from('marketplace_order_items')
        .select('*')
        .eq('order_id', order.id);
      orders.push({ ...order, items: items || [] });
    }

    return orders;
  },

  async getOrderById(customerId: string, orderId: string) {
    const { data: order, error } = await supabase
      .from('marketplace_orders')
      .select('*')
      .eq('id', orderId)
      .eq('customer_id', customerId)
      .single();
    if (error) throw new Error('Order not found');

    const { data: items } = await supabase
      .from('marketplace_order_items')
      .select('*')
      .eq('order_id', orderId);

    return { ...order, items: items || [] };
  },

  async cancelOrder(customerId: string, orderId: string, reason?: string) {
    const { data: order } = await supabase
      .from('marketplace_orders')
      .select('*')
      .eq('id', orderId)
      .eq('customer_id', customerId)
      .single();
    if (!order) throw new Error('Order not found');
    if (!['confirmed', 'packed'].includes(order.status)) {
      throw new Error('Order cannot be cancelled at this stage');
    }

    // Restore stock
    const { data: items } = await supabase
      .from('marketplace_order_items')
      .select('*')
      .eq('order_id', orderId);

    for (const item of items || []) {
      if (item.product_id) {
        const { data: product } = await supabase
          .from('marketplace_products')
          .select('stock_quantity, total_sold')
          .eq('id', item.product_id)
          .single();
        if (product) {
          await supabase.from('marketplace_products')
            .update({
              stock_quantity: product.stock_quantity + item.quantity,
              total_sold: Math.max(0, (product.total_sold || 0) - item.quantity),
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.product_id);

          // Log inventory transaction for cancellation
          await inventoryService.logTransaction(item.product_id, {
            action: 'order_cancelled',
            previous_quantity: product.stock_quantity,
            quantity_change: item.quantity,
            new_quantity: product.stock_quantity + item.quantity,
            notes: `Stock restored from cancelled order`,
          });
        }
      }
    }

    const { data: updated, error } = await supabase
      .from('marketplace_orders')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .select().single();
    if (error) throw new Error(error.message);

    // Notification
    await supabase.from('notifications').insert({
      user_id: customerId,
      type: 'order',
      title: 'Order Cancelled',
      body: `Your order #${order.order_number} has been cancelled.`,
      data: { order_id: orderId, order_number: order.order_number },
    });

    return updated;
  },

  async reorder(customerId: string, orderId: string) {
    const { data: items } = await supabase
      .from('marketplace_order_items')
      .select('product_id, quantity')
      .eq('order_id', orderId);

    const addedItems = [];
    for (const item of items || []) {
      if (item.product_id) {
        try {
          await cartService.addItem(customerId, item.product_id, item.quantity);
          addedItems.push(item.product_id);
        } catch (e) {
          // Skip unavailable items
        }
      }
    }

    return { added_count: addedItems.length, cart: await cartService.getCart(customerId) };
  },

  // Admin methods
  async getAllOrders(query: { page?: number; limit?: number; status?: string }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    let q = supabase
      .from('marketplace_orders')
      .select('*, users(name, email, phone)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (query.status) q = q.eq('status', query.status);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    return {
      orders: data || [],
      pagination: { page, limit, total: count || 0, total_pages: Math.ceil((count || 0) / limit) },
    };
  },

  async updateOrderStatus(orderId: string, status: string) {
    const statusTimestampMap: any = {
      packed: 'packed_at',
      shipped: 'shipped_at',
      out_for_delivery: 'out_for_delivery_at',
      delivered: 'delivered_at',
    };

    const update: any = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (statusTimestampMap[status]) {
      update[statusTimestampMap[status]] = new Date().toISOString();
    }
    if (status === 'delivered') {
      update.payment_status = 'paid';
    }

    const { data, error } = await supabase
      .from('marketplace_orders')
      .update(update)
      .eq('id', orderId)
      .select().single();
    if (error) throw new Error(error.message);

    // Notify customer
    const statusLabels: any = {
      packed: 'packed and ready for shipping',
      shipped: 'shipped',
      out_for_delivery: 'out for delivery',
      delivered: 'delivered',
    };

    if (statusLabels[status]) {
      await supabase.from('notifications').insert({
        user_id: data.customer_id,
        type: 'order',
        title: `Order ${statusLabels[status]}`,
        body: `Your order #${data.order_number} is ${statusLabels[status]}.`,
        data: { order_id: data.id, order_number: data.order_number },
      });
    }

    return data;
  },
};
