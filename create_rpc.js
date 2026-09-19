const { Client } = require('pg');
require('dotenv').config();

const createRpcSql = `
CREATE OR REPLACE FUNCTION place_marketplace_order(
  p_customer_id UUID,
  p_order_number VARCHAR,
  p_subtotal NUMERIC,
  p_discount_amount NUMERIC,
  p_delivery_charges NUMERIC,
  p_gst_amount NUMERIC,
  p_total_amount NUMERIC,
  p_coupon_id UUID,
  p_coupon_code VARCHAR,
  p_payment_method VARCHAR,
  p_payment_status VARCHAR,
  p_delivery_address_snapshot JSONB,
  p_delivery_slot VARCHAR,
  p_notes TEXT,
  p_cart_items JSONB
) RETURNS jsonb AS $$
DECLARE
  v_order_id UUID;
  v_item JSONB;
  v_product RECORD;
BEGIN
  -- Validate stock for all items first
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_items)
  LOOP
    SELECT * INTO v_product FROM marketplace_products WHERE id = (v_item->>'product_id')::UUID FOR UPDATE;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found', v_item->>'product_id';
    END IF;

    IF v_product.stock_quantity < (v_item->>'quantity')::INT THEN
      RAISE EXCEPTION 'Insufficient stock for %', v_product.name;
    END IF;
  END LOOP;

  -- Insert Order
  INSERT INTO marketplace_orders (
    order_number, customer_id, status, subtotal, discount_amount, delivery_charges, gst_amount, total_amount, coupon_id, coupon_code, payment_method, payment_status, delivery_address_snapshot, delivery_slot, notes
  ) VALUES (
    p_order_number, p_customer_id, 'confirmed', p_subtotal, p_discount_amount, p_delivery_charges, p_gst_amount, p_total_amount, p_coupon_id, p_coupon_code, p_payment_method, p_payment_status, p_delivery_address_snapshot, p_delivery_slot, p_notes
  ) RETURNING id INTO v_order_id;

  -- Process Items and Deduct Stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_items)
  LOOP
    SELECT * INTO v_product FROM marketplace_products WHERE id = (v_item->>'product_id')::UUID;
    
    -- Insert Order Item
    INSERT INTO marketplace_order_items (
      order_id, product_id, product_name, product_image, unit, quantity, price, subtotal
    ) VALUES (
      v_order_id,
      v_product.id,
      v_product.name,
      v_product.image_url,
      v_product.unit,
      (v_item->>'quantity')::INT,
      v_product.selling_price,
      v_product.selling_price * (v_item->>'quantity')::INT
    );

    -- Deduct Stock
    UPDATE marketplace_products
    SET 
      stock_quantity = stock_quantity - (v_item->>'quantity')::INT,
      total_sold = COALESCE(total_sold, 0) + (v_item->>'quantity')::INT,
      updated_at = NOW()
    WHERE id = v_product.id;

    -- Log transaction
    INSERT INTO inventory_transactions (
      product_id, action, previous_quantity, quantity_change, new_quantity, notes
    ) VALUES (
      v_product.id,
      'sold',
      v_product.stock_quantity,
      -((v_item->>'quantity')::INT),
      v_product.stock_quantity - (v_item->>'quantity')::INT,
      'Sold via order #' || p_order_number
    );
  END LOOP;

  -- Handle Coupon Usage
  IF p_coupon_id IS NOT NULL THEN
    INSERT INTO coupon_usage (coupon_id, customer_id, order_id)
    VALUES (p_coupon_id, p_customer_id, v_order_id);
    
    UPDATE coupons
    SET used_count = COALESCE(used_count, 0) + 1
    WHERE id = p_coupon_id;
  END IF;

  RETURN jsonb_build_object('id', v_order_id, 'order_number', p_order_number);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Expose to PostgREST
NOTIFY pgrst, 'reload schema';
`;

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(createRpcSql);
    console.log('RPC place_marketplace_order created successfully.');
  } catch(e) {
    console.error('Error creating RPC:', e.message);
  } finally {
    await client.end();
  }
}
run();
