import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function migrate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL\n');
    console.log('🔄 Running Phase 2 marketplace migration...\n');

    // 1. Update users role constraint
    console.log('1. Updating users_role_check constraint...');
    await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
    await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('farmer', 'agent', 'admin', 'food_unit', 'customer'));`);
    console.log('   ✅ Constraint updated\n');

    // 2. Create customers table
    console.log('2. Creating marketplace tables...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        avatar_url TEXT,
        date_of_birth DATE,
        gender VARCHAR(20),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('   ✅ customers');

    // 3. Customer addresses
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_addresses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label VARCHAR(50) DEFAULT 'Home',
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        address_line1 TEXT NOT NULL,
        address_line2 TEXT,
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL,
        pincode VARCHAR(20) NOT NULL,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('   ✅ customer_addresses');

    // 4. Categories
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        icon_url TEXT,
        image_url TEXT,
        parent_id UUID REFERENCES marketplace_categories(id),
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('   ✅ marketplace_categories');

    // 5. Products
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category_id UUID REFERENCES marketplace_categories(id),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        mrp NUMERIC(10,2) NOT NULL DEFAULT 0,
        selling_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        discount_percent NUMERIC(5,2) DEFAULT 0,
        unit VARCHAR(50) DEFAULT 'kg',
        weight_value NUMERIC(10,2) DEFAULT 1,
        stock_quantity INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        is_organic BOOLEAN DEFAULT FALSE,
        origin VARCHAR(255),
        delivery_time VARCHAR(100) DEFAULT '30 min',
        avg_rating NUMERIC(3,2) DEFAULT 0,
        total_reviews INT DEFAULT 0,
        total_sold INT DEFAULT 0,
        image_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('   ✅ marketplace_products');

    // 6. Carts
    await client.query(`
      CREATE TABLE IF NOT EXISTS carts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('   ✅ carts');

    // 7. Cart items
    await client.query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
        quantity INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(cart_id, product_id)
      );
    `);
    console.log('   ✅ cart_items');

    // 8. Wishlists
    await client.query(`
      CREATE TABLE IF NOT EXISTS wishlists (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(customer_id, product_id)
      );
    `);
    console.log('   ✅ wishlists');

    // 9. Orders
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number VARCHAR(50) UNIQUE NOT NULL,
        customer_id UUID NOT NULL REFERENCES users(id),
        status VARCHAR(50) DEFAULT 'confirmed',
        subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
        discount_amount NUMERIC(10,2) DEFAULT 0,
        gst_amount NUMERIC(10,2) DEFAULT 0,
        delivery_charges NUMERIC(10,2) DEFAULT 0,
        total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
        payment_method VARCHAR(50) DEFAULT 'cod',
        payment_status VARCHAR(50) DEFAULT 'pending',
        delivery_address_snapshot JSONB NOT NULL,
        coupon_code VARCHAR(50),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('   ✅ marketplace_orders');

    // 10. Order items
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES marketplace_products(id),
        product_name VARCHAR(255) NOT NULL,
        quantity INT NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        subtotal NUMERIC(10,2) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('   ✅ marketplace_order_items');

    // 11. Reviews
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
        customer_id UUID NOT NULL REFERENCES users(id),
        rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        image_urls TEXT[] DEFAULT '{}',
        is_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(product_id, customer_id)
      );
    `);
    console.log('   ✅ marketplace_reviews');

    // 12. Coupons
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_coupons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        discount_type VARCHAR(20) DEFAULT 'percentage',
        discount_value NUMERIC(10,2) NOT NULL,
        min_order_amount NUMERIC(10,2) DEFAULT 0,
        max_discount NUMERIC(10,2),
        usage_limit INT DEFAULT 0,
        used_count INT DEFAULT 0,
        starts_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('   ✅ marketplace_coupons');

    // 13. Notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'system',
        is_read BOOLEAN DEFAULT FALSE,
        data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('   ✅ marketplace_notifications');

    // 14. Product Requests (Demand Requests)
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id UUID REFERENCES marketplace_products(id) ON DELETE SET NULL,
        requested_product_name VARCHAR(255) NOT NULL,
        category VARCHAR(255),
        requested_quantity NUMERIC(10,2) NOT NULL,
        available_quantity NUMERIC(10,2) DEFAULT 0,
        remaining_quantity NUMERIC(10,2) DEFAULT 0,
        unit VARCHAR(50) DEFAULT 'kg',
        warehouse_id UUID,
        delivery_address TEXT,
        preferred_delivery_date DATE,
        notes TEXT,
        contact_number VARCHAR(50),
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','under_review','accepted','partially_fulfilled','ready_for_purchase','rejected','expired')),
        admin_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('   ✅ product_requests');

    console.log('\n🎉 All marketplace tables created successfully!');
    console.log('🎉 Users role constraint updated to include "customer"!');

  } catch (err: any) {
    console.error('❌ Migration error:', err.message);
  } finally {
    await client.end();
  }
}

migrate();
