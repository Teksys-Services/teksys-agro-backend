const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  console.log('Testing customer_addresses...');
  const { data: addresses, error: err1 } = await supabase.from('customer_addresses').select('*').limit(1);
  console.log('Addresses:', addresses);
  if (err1) console.error('Error fetching addresses:', err1);

  console.log('\nTesting carts...');
  const { data: carts, error: err2 } = await supabase.from('carts').select('*').limit(1);
  console.log('Carts:', carts);
  if (err2) console.error('Error fetching carts:', err2);
  
  const { data: mc, error: err3 } = await supabase.from('marketplace_carts').select('*').limit(1);
  console.log('\nMarketplace Carts:', mc);
  if (err3) console.error('Error fetching marketplace carts:', err3);
}
test();
