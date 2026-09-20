import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl = process.env.DATABASE_URL;

if (!supabaseUrl || !supabaseServiceKey || !dbUrl) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const { Client } = require('pg');

async function migrate() {
  console.log('Starting Marketplace Delivery migration...');
  const client = new Client({ connectionString: dbUrl });
  
  try {
    await client.connect();

    console.log('1. Adding new columns to marketplace_orders...');
    await client.query(`
      ALTER TABLE marketplace_orders 
      ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS agent_accepted_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP WITH TIME ZONE;
    `);
    console.log('   ✅ Columns added');

    console.log('2. Updating status CHECK constraint...');
    await client.query(`
      ALTER TABLE marketplace_orders DROP CONSTRAINT IF EXISTS marketplace_orders_status_check;
      
      ALTER TABLE marketplace_orders ADD CONSTRAINT marketplace_orders_status_check
      CHECK (status IN (
          'confirmed', 'preparing', 'ready_for_pickup', 'assigned', 'accepted_by_agent', 'picked_up', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned'
      ));
    `);
    console.log('   ✅ Constraint updated');

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

migrate();
