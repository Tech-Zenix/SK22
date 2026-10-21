import { neon } from '@neondatabase/serverless';

const REQUIRED_PASSWORD = process.env.SK22_PASSWORD || 'maihong';

function getSql() {
  const conn = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!conn) {
    throw new Error('Missing DATABASE_URL or POSTGRES_URL environment variable from Neon.');
  }
  return neon(conn);
}

async function ensureSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS csk22_store (
      id TEXT PRIMARY KEY DEFAULT 'main',
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT NOT NULL DEFAULT 'SK22 Member'
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS csk22_history (
      id BIGSERIAL PRIMARY KEY,
      payload JSONB NOT NULL,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-sk22-password');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const sql = getSql();
    await ensureSchema(sql);

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT payload, updated_at
        FROM csk22_store
        WHERE id = 'main'
        LIMIT 1
      `;
      if (!rows || rows.length === 0) {
        return res.status(200).json({
          ok: true,
          data: null,
          updatedAt: null
        });
      }
      return res.status(200).json({
        ok: true,
        data: rows[0].payload,
        updatedAt: rows[0].updated_at
      });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const authHeader = req.headers['authorization'] || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const customToken = (req.headers['x-sk22-password'] || '').trim();
      const providedPassword = customToken || bearerToken;

      if (providedPassword !== REQUIRED_PASSWORD) {
        return res.status(401).json({
          ok: false,
          error: 'Unauthorized: Sai mật khẩu SK22 Member'
        });
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const payload = body.data && typeof body.data === 'object' ? body.data : body;

      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.students)) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid payload schema: thiếu danh sách students.'
        });
      }

      payload.updatedAt = new Date().toISOString();

      const upserted = await sql`
        INSERT INTO csk22_store (id, payload, updated_at, updated_by)
        VALUES ('main', ${JSON.stringify(payload)}::jsonb, NOW(), 'SK22 Member')
        ON CONFLICT (id)
        DO UPDATE SET
          payload = EXCLUDED.payload,
          updated_at = NOW(),
          updated_by = 'SK22 Member'
        RETURNING updated_at
      `;

      await sql`
        INSERT INTO csk22_history (payload, saved_at)
        VALUES (${JSON.stringify(payload)}::jsonb, NOW())
      `;
      await sql`
        DELETE FROM csk22_history
        WHERE id NOT IN (
          SELECT id FROM csk22_history ORDER BY saved_at DESC LIMIT 20
        )
      `;

      return res.status(200).json({
        ok: true,
        updatedAt: upserted[0]?.updated_at || payload.updatedAt
      });
    }

    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[CSK22 API Error]:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Internal Server Error'
    });
  }
}
