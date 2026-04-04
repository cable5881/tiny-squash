import { json } from '../../_lib/auth.js';
import { getEffectivePlan, updatePreferences } from '../../_lib/db.js';
import { requireAuth } from '../../_lib/quota.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  let preferences = {};
  try { preferences = JSON.parse(auth.user.preferences || '{}'); } catch (_) {}
  return json({ preferences, plan: getEffectivePlan(auth.user) });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  const plan = getEffectivePlan(auth.user);
  if (plan !== 'pro' && auth.user.role !== 'admin') {
    return json({ error: 'pro_required', message: '偏好设置是 Pro 专属功能' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const prefs = {
      quality: typeof body.quality === 'number' ? Math.min(1, Math.max(0.1, body.quality)) : undefined,
      format: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(body.format) ? body.format : undefined,
      maxWidth: typeof body.maxWidth === 'number' && body.maxWidth > 0 ? body.maxWidth : null,
    };
    // 过滤 undefined
    const cleaned = Object.fromEntries(Object.entries(prefs).filter(([_, v]) => v !== undefined));
    await updatePreferences(env.DB, auth.session.sub, cleaned);
    return json({ ok: true, preferences: cleaned });
  } catch (err) {
    console.error('Preferences update error:', err);
    return json({ error: 'internal_error' }, { status: 500 });
  }
}
