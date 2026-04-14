/**
 * CloudPress CMS — cp-blog-header.js
 * WordPress wp-blog-header.php 대체
 *
 * 테마 로드 + 쿼리 처리 + 템플릿 렌더링을 담당하는 핵심 핸들러
 *
 * @package CloudPress
 */

import { cpLoad }           from './cp-load.js';
import { cpQuery }          from './cp-functions.js';
import { cpTemplateLoader } from './cp-template-loader.js';

export default {
  /**
   * Cloudflare Workers fetch 핸들러
   * @param {Request} request
   * @param {object}  env  — D1(DB), KV(CACHE, SESSIONS) 바인딩
   * @param {object}  ctx  — waitUntil 등 실행 컨텍스트
   */
  async fetch(request, env, ctx) {
    // ── 1. CP 환경 초기화 (cp-load.js) ───────────────────────────
    const cp = await cpLoad(request, env, ctx);

    // ── 2. 쿼리 파싱 (cp-functions.js) ───────────────────────────
    await cpQuery(cp);

    // ── 3. 테마 템플릿 로드 및 응답 반환 ─────────────────────────
    return cpTemplateLoader(cp);
  },
};
