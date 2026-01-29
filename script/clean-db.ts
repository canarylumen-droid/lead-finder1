
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

// Read .env manually
let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const match = envContent.match(/DATABASE_URL=["']?([^"'\n]+)["']?/);
      if (match) {
        connectionString = match[1];
      }
    }
  } catch (e) {
    console.error('Failed to read .env', e);
  }
}

if (!connectionString) {
  console.error('DATABASE_URL is missing');
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function clean() {
  const client = await pool.connect();
  try {
    console.log('Fetching tables...');
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE';
    `);

    const tables = res.rows.map(r => r.table_name);
    if (tables.length === 0) {
      console.log('No tables found.');
      return;
    }

    console.log(`Found ${tables.length} tables. Dropping...`);

    // Disable constraints temporarily or just cascade
    for (const table of tables) {
      console.log(`Dropping ${table}...`);
      await client.query(`DROP TABLE IF EXISTS "public"."${table}" CASCADE`);
    }

    console.log('All tables dropped successfully.');
  } catch (err) {
    console.error('Error cleaning DB:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

clean();
