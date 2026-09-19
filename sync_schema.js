const { Client } = require('pg');
require('dotenv').config();

const alters = `
  ALTER TABLE marketplace_products 
    ADD COLUMN IF NOT EXISTS warehouse_inventory_id UUID REFERENCES warehouse_inventory(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS short_description VARCHAR(500),
    ADD COLUMN IF NOT EXISTS min_order_qty INT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS max_order_qty INT DEFAULT 10,
    ADD COLUMN IF NOT EXISTS specifications JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_trending BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_best_seller BOOLEAN DEFAULT FALSE;

  ALTER TABLE marketplace_categories
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS icon_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

  ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS default_address_id UUID,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

  ALTER TABLE customer_addresses
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

  ALTER TABLE cart_items
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

  ALTER TABLE marketplace_orders
    ADD COLUMN IF NOT EXISTS coupon_id UUID,
    ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS delivery_slot VARCHAR(100),
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS packed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS out_for_delivery_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

  ALTER TABLE marketplace_order_items
    ADD COLUMN IF NOT EXISTS product_image TEXT,
    ADD COLUMN IF NOT EXISTS unit VARCHAR(50);

  CREATE TABLE IF NOT EXISTS product_images (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      sort_order INT DEFAULT 0,
      is_primary BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS coupons (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(100) NOT NULL UNIQUE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'flat')),
      discount_value NUMERIC(12, 2) NOT NULL,
      min_order_amount NUMERIC(12, 2) DEFAULT 0,
      max_discount_amount NUMERIC(12, 2),
      usage_limit INT,
      used_count INT DEFAULT 0,
      valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      valid_until TIMESTAMP WITH TIME ZONE,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS coupon_usage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
      customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id UUID REFERENCES marketplace_orders(id) ON DELETE SET NULL,
      used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(coupon_id, customer_id)
  );

  CREATE TABLE IF NOT EXISTS reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
      customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id UUID REFERENCES marketplace_orders(id) ON DELETE SET NULL,
      rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
      title VARCHAR(255),
      comment TEXT,
      images JSONB DEFAULT '[]',
      is_verified_purchase BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(product_id, customer_id, order_id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL CHECK (type IN ('order', 'offer', 'promotion', 'price_drop', 'general')),
      title VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      data JSONB DEFAULT '{}',
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  -- Add FK for default_address_id
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='fk_default_address') THEN
      ALTER TABLE customers ADD CONSTRAINT fk_default_address FOREIGN KEY (default_address_id) REFERENCES customer_addresses(id) ON DELETE SET NULL;
    END IF;
  END
  $$;

  -- Add FK for coupon_id
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='marketplace_orders_coupon_id_fkey') THEN
      ALTER TABLE marketplace_orders ADD CONSTRAINT marketplace_orders_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL;
    END IF;
  END
  $$;

  NOTIFY pgrst, 'reload schema';
`;

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(alters);
    console.log('Schema fully synchronized successfully.');
  } catch(e) {
    console.error('Error applying schema:', e.message);
  } finally {
    await client.end();
  }
}
run();
