import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Node needs a WebSocket implementation for the Neon pool (used for transactions).
neonConfig.webSocketConstructor = ws;

let poolFactory = (connectionString) => new Pool({ connectionString });

/** Tests swap in a plain `pg` pool pointed at a local database. */
export function setPoolFactory(factory) {
  poolFactory = factory;
}

export function connectionString() {
  const raw = (process.env.DATABASE_URL || process.env.ConnectionStrings__DefaultConnection || '').trim();
  // Values copied from a .env file sometimes keep their quotes.
  const url = raw.replace(/^["']|["']$/g, '');
  if (!url) {
    throw new Error('DATABASE_URL is not set. Add it in Vercel > Settings > Environment Variables, then redeploy.');
  }
  return url;
}

function wrap(runner) {
  const query = async (text, params = []) => (await runner.query(text, params)).rows;
  return {
    query,
    one: async (text, params) => (await query(text, params))[0] ?? null,
    scalar: async (text, params) => {
      const row = (await query(text, params))[0];
      return row ? Object.values(row)[0] : null;
    },
  };
}

/**
 * One pool per request: serverless instances freeze between invocations, so sockets
 * must not outlive the request that opened them.
 */
export function createDb() {
  let pool = null;
  const getPool = () => (pool ??= poolFactory(connectionString()));

  const db = {
    ...wrap({ query: (text, params) => getPool().query(text, params) }),
    inTransaction: false,

    /** Runs `fn` inside a transaction; nested calls join the outer transaction. */
    async tx(fn) {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const t = { ...wrap(client), inTransaction: true };
        t.tx = (inner) => inner(t);
        const result = await fn(t);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async end() {
      if (pool) await pool.end().catch(() => {});
      pool = null;
    },
  };
  return db;
}
