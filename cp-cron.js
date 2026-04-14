/**
 * CloudPress CMS — cp-cron.js
 * WordPress wp-cron.php 대체
 *
 * PHP HTTP 요청 기반 cron 대신 Cloudflare Cron Triggers(scheduled) 사용.
 * wrangler.toml 에 cron 스케줄 등록 필요:
 *
 *   [triggers]
 *   crons = ["* * * * *"]   # 1분마다
 *
 * @package CloudPress
 */

export default {
  /**
   * Cloudflare Cron Trigger 핸들러
   * @param {ScheduledController} controller
   * @param {object} env
   * @param {object} ctx
   */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCronJobs(env, controller.scheduledTime));
  },
};

/**
 * 예약된 작업 실행
 * @param {object} env
 * @param {number} scheduledTime
 */
async function runCronJobs(env, scheduledTime) {
  if (!env?.DB) return;

  const now = new Date(scheduledTime);
  console.log('[cp-cron] 실행:', now.toISOString());

  // ── 만료된 세션 정리 (1시간마다) ─────────────────────────────
  if (now.getMinutes() === 0) {
    await cleanExpiredSessions(env);
  }

  // ── 예약 발행 포스트 처리 (1분마다) ──────────────────────────
  await publishScheduledPosts(env, now);

  // ── 휴지통 자동 비우기 (1일마다 자정) ────────────────────────
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    await emptyTrash(env);
  }

  // ── 플러그인 크론 작업 실행 ───────────────────────────────────
  await runPluginCrons(env, now);
}

async function cleanExpiredSessions(env) {
  try {
    await env.DB.prepare(
      `DELETE FROM sessions WHERE expires_at < datetime('now')`
    ).run();
    console.log('[cp-cron] 만료 세션 정리 완료');
  } catch (e) {
    console.error('[cp-cron] 세션 정리 오류:', e.message);
  }
}

async function publishScheduledPosts(env, now) {
  try {
    const isoNow = now.toISOString().replace('T', ' ').slice(0, 19);
    const { results } = await env.DB.prepare(
      `SELECT ID FROM cp_posts
       WHERE post_status='future' AND post_date <= ?`
    ).bind(isoNow).all();

    for (const row of (results ?? [])) {
      await env.DB.prepare(
        `UPDATE cp_posts SET post_status='publish', updated_at=datetime('now') WHERE ID=?`
      ).bind(row.ID).run();
      console.log('[cp-cron] 포스트 발행:', row.ID);
    }
  } catch (e) {
    console.error('[cp-cron] 예약 발행 오류:', e.message);
  }
}

async function emptyTrash(env) {
  try {
    // 30일 이상 된 휴지통 포스트 삭제
    await env.DB.prepare(
      `DELETE FROM cp_posts
       WHERE post_status='trash'
         AND updated_at < datetime('now', '-30 days')`
    ).run();
    console.log('[cp-cron] 휴지통 비우기 완료');
  } catch (e) {
    console.error('[cp-cron] 휴지통 오류:', e.message);
  }
}

async function runPluginCrons(env, now) {
  // 플러그인이 등록한 크론 작업을 D1에서 로드해 실행
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM cp_cron_jobs
       WHERE next_run <= ? AND active=1
       ORDER BY next_run ASC LIMIT 20`
    ).bind(now.toISOString()).all();

    for (const job of (results ?? [])) {
      console.log('[cp-cron] 플러그인 크론:', job.hook);
      // 플러그인 훅 실행은 플러그인 시스템에서 처리
      // 다음 실행 시간 갱신
      const interval = job.interval_seconds || 3600;
      const nextRun  = new Date(now.getTime() + interval * 1000).toISOString();
      await env.DB.prepare(
        `UPDATE cp_cron_jobs SET next_run=?, last_run=? WHERE id=?`
      ).bind(nextRun, now.toISOString(), job.id).run();
    }
  } catch (_) {
    // cp_cron_jobs 테이블이 없는 경우 무시
  }
}
