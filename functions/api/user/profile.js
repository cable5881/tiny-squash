import { json } from '../../_lib/auth.js';
import { initTables, getUserBySub, getEffectivePlan, getUserStats, updateUserName } from '../../_lib/db.js';
import { requireAuth } from '../../_lib/quota.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  try {
    const user = auth.user;
    const plan = getEffectivePlan(user);
    const stats = await getUserStats(env.DB, user.id);
    let preferences = {};
    try { preferences = JSON.parse(user.preferences || '{}'); } catch (_) {}

    return json({
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      plan,
      planExpiresAt: user.plan_expires_at,
      preferences,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      stats,
    });
  } catch (err) {
    console.error('Profile get error:', err);
    return json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    if (body.name && typeof body.name === 'string') {
      await updateUserName(env.DB, auth.session.sub, body.name.trim().slice(0, 50));
    }
    return json({ ok: true });
  } catch (err) {
    console.error('Profile update error:', err);
    return json({ error: 'internal_error' }, { status: 500 });
  }
}
