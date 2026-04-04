import { json } from '../../_lib/auth.js';
import { initTables, incrementDailyUsage, addCompressLog } from '../../_lib/db.js';
import { resolveIdentity } from '../../_lib/quota.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ ok: true });
  }

  try {
    await initTables(env.DB);
    const identity = await resolveIdentity(request, env);
    const body = await request.json().catch(() => ({}));
    const files = body.files || [];
    const count = files.length || 1;
    const totalOriginal = files.reduce((s, f) => s + (f.originalSize || 0), 0);
    const totalCompressed = files.reduce((s, f) => s + (f.compressedSize || 0), 0);

    await incrementDailyUsage(env.DB, {
      userId: identity.userId,
      guestIp: identity.ip,
      originalBytes: totalOriginal,
      compressedBytes: totalCompressed,
      count,
    });

    // 记录压缩日志（仅登录用户）
    if (identity.userId && files.length > 0) {
      for (const f of files) {
        await addCompressLog(env.DB, identity.userId, {
          fileName: f.fileName || 'unknown',
          originalSize: f.originalSize || 0,
          compressedSize: f.compressedSize || 0,
          format: f.format || 'image/jpeg',
          quality: f.quality || 0.8,
        });
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error('Usage record error:', err);
    return json({ ok: true });
  }
}
