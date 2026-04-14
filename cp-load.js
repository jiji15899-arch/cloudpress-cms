/**
 * CloudPress CMS — cp-load.js
 * WordPress wp-load.php 대체
 *
 * CP 환경 초기화:
 *   - D1(DB) 연결 확인
 *   - KV(SESSIONS, CACHE) 연결 확인
 *   - 설정(settings) 로드
 *   - 현재 사용자 인증
 *   - URL/경로 파싱
 *
 * @package CloudPress
 */

import { cpSettings }     from './cp-settings.js';
import { cpCurrentUser }  from './cp-auth.js';

/**
 * CP 실행 컨텍스트 초기화
 * @param {Request} request
 * @param {object}  env
 * @param {object}  ctx
 * @returns {Promise<CPContext>}
 */
export async function cpLoad(request, env, ctx) {
  // ── 필수 바인딩 확인 ──────────────────────────────────────────
  if (!env?.DB) {
    throw new CPError(503, 'DB 바인딩이 연결되지 않았습니다. Cloudflare D1 설정을 확인하세요.');
  }
  if (!env?.SESSIONS) {
    throw new CPError(503, 'SESSIONS KV 바인딩이 연결되지 않았습니다.');
  }
  if (!env?.CACHE) {
    throw new CPError(503, 'CACHE KV 바인딩이 연결되지 않았습니다.');
  }

  const url    = new URL(request.url);
  const method = request.method.toUpperCase();

  // ── 설정 로드 ─────────────────────────────────────────────────
  const settings = await cpSettings(env);

  // ── 현재 사용자 인증 ──────────────────────────────────────────
  const currentUser = await cpCurrentUser(env, request);

  /** @type {CPContext} */
  const cp = {
    request,
    env,
    ctx,
    url,
    method,
    settings,
    currentUser,
    // 쿼리 파싱 후 채워짐
    query:    {},
    queried:  null,
    // 응답 메타
    headers:  new Headers({ 'Content-Type': 'text/html; charset=utf-8' }),
  };

  return cp;
}

/**
 * CP 전용 에러 클래스
 */
export class CPError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
