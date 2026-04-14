/**
 * CloudPress CMS — cp-config-sample.js
 * WordPress wp-config-sample.php 대체
 *
 * ⚠️  이 파일을 직접 수정하지 마세요.
 *     환경 변수 / Secrets 는 wrangler.toml 또는
 *     Cloudflare Dashboard > Pages/Workers > Settings > Variables 에서 설정합니다.
 *
 * PHP의 define() 상수 대신 Cloudflare Workers env 바인딩을 사용합니다.
 * MariaDB/MySQL 없음 — D1(SQLite) + KV 로 완전 대체.
 *
 * @package CloudPress
 */

/**
 * ─────────────────────────────────────────────────────────────────
 * 필수 Cloudflare 바인딩 (wrangler.toml / Dashboard 에서 설정)
 * ─────────────────────────────────────────────────────────────────
 *
 * [D1 Database]
 *   binding      = "DB"
 *   database_name = "cloudpress-db"
 *   database_id   = "<your-d1-id>"
 *
 * [KV Namespaces]
 *   SESSIONS  — 세션 토큰 저장 (TTL 7일)
 *   CACHE     — 설정/페이지 캐시 (TTL 60~600초)
 *
 * [Secrets (wrangler secret put)]
 *   CF_API_TOKEN   — Cloudflare API 토큰 (D1/KV/DNS 권한)
 *   CF_ACCOUNT_ID  — Cloudflare 계정 ID
 *
 * ─────────────────────────────────────────────────────────────────
 * WordPress 상수 → CloudPress 대응표
 * ─────────────────────────────────────────────────────────────────
 * define('DB_NAME',     ...)  → env.DB (D1 바인딩)
 * define('DB_USER',     ...)  → 불필요 (D1은 자격증명 없음)
 * define('DB_PASSWORD', ...)  → 불필요
 * define('DB_HOST',     ...)  → 불필요
 * define('WP_DEBUG',    true) → env.CP_DEBUG = "true"
 * define('WP_SITEURL',  ...)  → settings 테이블: site_domain
 * define('WP_HOME',     ...)  → settings 테이블: site_domain
 * define('AUTH_KEY',    ...)  → env.CP_AUTH_KEY (Secret)
 * define('table_prefix',...)  → 고정값 "cp_"  (변경 불필요)
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * CP 설정 상수 (런타임에서 env로 덮어씌워짐)
 */
export const CP_CONFIG = {
  /** D1 테이블 접두사 (wp_ → cp_) */
  TABLE_PREFIX: 'cp_',

  /** 기본 언어 */
  WPLANG: 'ko_KR',

  /** 디버그 모드 (env.CP_DEBUG = "true" 로 활성화) */
  DEBUG: false,

  /** 자동 업데이트 비활성화 (Cloudflare 환경에서 불필요) */
  AUTOMATIC_UPDATER_DISABLED: true,

  /** 파일 시스템 직접 쓰기 불가 (Cloudflare Workers 제약) */
  DISALLOW_FILE_EDIT: true,
  DISALLOW_FILE_MODS: false, // 테마/플러그인은 KV 경유로 허용

  /** 포스트 리비전 최대 개수 */
  WP_POST_REVISIONS: 5,

  /** 휴지통 보관 일수 */
  EMPTY_TRASH_DAYS: 30,
};

/**
 * 런타임에서 env를 받아 CP_CONFIG 를 갱신
 * @param {object} env — Workers env 바인딩
 */
export function initConfig(env) {
  if (env?.CP_DEBUG === 'true') CP_CONFIG.DEBUG = true;
  if (env?.TABLE_PREFIX)        CP_CONFIG.TABLE_PREFIX = env.TABLE_PREFIX;
}
