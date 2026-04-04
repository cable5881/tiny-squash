import { json } from '../_lib/auth.js';
import { initTables, getPlanLimitsFromDB } from '../_lib/db.js';

/** GET /api/plans — 公开接口：返回当前生效的套餐配置 */
export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) {
    // 无 DB 时返回硬编码默认值
    const { PLAN_LIMITS } = await import('../_lib/db.js');
    return json({ plans: PLAN_LIMITS });
  }

  await initTables(env.DB);
  const plans = await getPlanLimitsFromDB(env.DB);
  return json({ plans });
}
