import { neon } from '@neondatabase/serverless';

const REQUIRED_PASSWORD = process.env.SK22_PASSWORD || 'maihong';

function getSql() {
  const conn = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!conn) {
    throw new Error('Missing DATABASE_URL or POSTGRES_URL environment variable from Neon.');
  }
  return neon(conn);
}

async function ensureImageTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS csk22_images (
      filename TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL DEFAULT 'image/webp',
      base64_data TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      label TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

function checkAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const customToken = (req.headers['x-sk22-password'] || '').trim();
  const provided = customToken || bearerToken;
  return provided === REQUIRED_PASSWORD;
}

function sanitizeFilename(raw) {
  return String(raw || 'image.webp')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-sk22-password');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const sql = getSql();
    await ensureImageTable(sql);

    // 1. GET: Phục vụ file ảnh trực tiếp tại /SK22/image/<filename> HOẶC liệt kê kho ảnh (?list=1)
    if (req.method === 'GET') {
      const { file, list } = req.query || {};

      if (list === '1' || list === 'true') {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        const rows = await sql`
          SELECT filename, mime_type, size_bytes, label, created_at
          FROM csk22_images
          ORDER BY created_at DESC
        `;
        return res.status(200).json({
          ok: true,
          images: rows.map(r => ({
            filename: r.filename,
            url: '/SK22/image/' + r.filename,
            mimeType: r.mime_type,
            sizeBytes: r.size_bytes,
            label: r.label || r.filename,
            createdAt: r.created_at
          }))
        });
      }

      if (!file) {
        return res.status(400).json({ ok: false, error: 'Missing file parameter' });
      }

      const cleanFile = sanitizeFilename(Array.isArray(file) ? file.join('-') : file);
      const rows = await sql`
        SELECT mime_type, base64_data
        FROM csk22_images
        WHERE filename = ${cleanFile}
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        return res.status(404).send('Image not found in /SK22/image/');
      }

      const imgBuffer = Buffer.from(rows[0].base64_data, 'base64');
      res.setHeader('Content-Type', rows[0].mime_type || 'image/webp');
      res.setHeader('Content-Length', imgBuffer.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).send(imgBuffer);
    }

    // 2. POST: Nhận ảnh upload từ máy tính / điện thoại vào /SK22/image/<filename>
    if (req.method === 'POST') {
      if (!checkAuth(req)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized: Sai mật khẩu SK22 Member' });
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const dataUrl = String(body.dataUrl || body.base64 || '');
      if (!dataUrl) {
        return res.status(400).json({ ok: false, error: 'Thiếu dữ liệu ảnh upload (dataUrl).' });
      }

      let mimeType = body.mimeType || 'image/webp';
      let rawBase64 = dataUrl;
      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        rawBase64 = match[2];
      }

      const ext = mimeType.includes('png') ? 'png' : (mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'webp');
      const prefix = sanitizeFilename(body.prefix || 'sk22').replace(/\.(webp|jpg|jpeg|png)$/i, '');
      const uniqueName = `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const sizeBytes = Math.round((rawBase64.length * 3) / 4);
      const label = String(body.label || uniqueName).slice(0, 120);

      await sql`
        INSERT INTO csk22_images (filename, mime_type, base64_data, size_bytes, label, created_at)
        VALUES (${uniqueName}, ${mimeType}, ${rawBase64}, ${sizeBytes}, ${label}, NOW())
        ON CONFLICT (filename)
        DO UPDATE SET
          mime_type = EXCLUDED.mime_type,
          base64_data = EXCLUDED.base64_data,
          size_bytes = EXCLUDED.size_bytes,
          label = EXCLUDED.label,
          created_at = NOW()
      `;

      const publicUrl = `/SK22/image/${uniqueName}`;
      return res.status(200).json({
        ok: true,
        filename: uniqueName,
        url: publicUrl,
        sizeBytes,
        label
      });
    }

    // 3. DELETE: Xóa ảnh khỏi /SK22/image/
    if (req.method === 'DELETE') {
      if (!checkAuth(req)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      const { file } = req.query || {};
      const cleanFile = sanitizeFilename(file);
      await sql`DELETE FROM csk22_images WHERE filename = ${cleanFile}`;
      return res.status(200).json({ ok: true, deleted: cleanFile });
    }

    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } catch (err) {
    console.error('[CSK22 Image API Error]:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Internal Server Error' });
  }
}
