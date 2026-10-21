const REQUIRED_PASSWORD = process.env.SK22_PASSWORD || 'maihong';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const password = String(body.password || '').trim();

    if (password !== REQUIRED_PASSWORD) {
      return res.status(401).json({
        ok: false,
        error: 'Mật khẩu SK22 Member không chính xác.'
      });
    }

    return res.status(200).json({
      ok: true,
      user: 'SK22 Member',
      role: 'member'
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: 'Bad Request' });
  }
}
