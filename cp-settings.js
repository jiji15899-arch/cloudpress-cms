/**
 * CloudPress CMS — cp-settings.js
 * WordPress wp-settings.php 대체
 *
 * - settings 테이블에서 모든 키/값 로드
 * - CACHE KV에 TTL 60초로 캐시
 * - 테마·플러그인 목록 로드
 *
 * @package CloudPress
 */

/** CP 버전 */
export const CP_VERSION       = '1.0.0';
export const CP_DB_VERSION    = 100;
export const CP_REQUIRED_NODE = '18';

/**
 * D1 settings 테이블 전체를 로드해 Map 으로 반환
 * @param {object} env
 * @returns {Promise<Map<string,string>>}
 */
export async function cpSettings(env) {
  const CACHE_KEY = 'cp_settings_all';

  // KV 캐시 우선
  try {
    const cached = await env.CACHE.get(CACHE_KEY, { type: 'json' });
    if (cached) return new Map(Object.entries(cached));
  } catch (_) {}

  // D1 에서 로드
  let rows = [];
  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
    rows = results ?? [];
  } catch (e) {
    console.error('[cp-settings] D1 load failed:', e.message);
  }

  const map = new Map();
  for (const row of rows) {
    map.set(row.key, row.value);
  }

  // KV 에 캐시 저장 (60초)
  try {
    await env.CACHE.put(CACHE_KEY, JSON.stringify(Object.fromEntries(map)), {
      expirationTtl: 60,
    });
  } catch (_) {}

  return map;
}

/**
 * 설정값 가져오기 (없으면 fallback)
 * @param {Map<string,string>} settings
 * @param {string} key
 * @param {string} [fallback='']
 * @returns {string}
 */
export function getSetting(settings, key, fallback = '') {
  return settings.has(key) ? (settings.get(key) ?? fallback) : fallback;
}

/**
 * D1 settings 테이블에서 단일 값 직접 조회 (캐시 우회)
 * @param {object} env
 * @param {string} key
 * @param {string} [fallback='']
 * @returns {Promise<string>}
 */
export async function getSettingDirect(env, key, fallback = '') {
  try {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();
    return row?.value ?? fallback;
  } catch { return fallback; }
}

/**
 * 설정값 저장 (D1 + CACHE 무효화)
 * @param {object} env
 * @param {string} key
 * @param {string} value
 */
export async function setSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).bind(key, String(value)).run();

  // 캐시 무효화
  try { await env.CACHE.delete('cp_settings_all'); } catch (_) {}
}
