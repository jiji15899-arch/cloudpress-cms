/**
 * CloudPress CMS — cp-activate.js
 * WordPress wp-activate.php 대체
 *
 * 이메일 인증 링크 처리 (/cp-activate?key=xxx)
 * D1 기반 — PHP 불필요
 *
 * @package CloudPress
 */

export async function handleActivate(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';

  if (!key) {
    return htmlResponse(400, '잘못된 요청', '인증 키가 없습니다.');
  }

  try {
    // KV에서 인증 키 조회
    const stored = await env.CACHE.get(`activate:${key}`, { type: 'json' });
    if (!stored) {
      return htmlResponse(400, '인증 실패', '인증 링크가 만료되었거나 유효하지 않습니다.');
    }

    const { userId, email } = stored;

    // 사용자 활성화
    await env.DB.prepare(
      `UPDATE users SET email_verified=1, updated_at=datetime('now') WHERE id=? AND email=?`
    ).bind(userId, email).run();

    // 인증 키 삭제
    await env.CACHE.delete(`activate:${key}`);

    return htmlResponse(200, '인증 완료', '이메일 인증이 완료되었습니다. <a href="/auth">로그인</a>하세요.');
  } catch (e) {
    return htmlResponse(500, '서버 오류', e.message);
  }
}

function htmlResponse(status, title, message) {
  return new Response(
    `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
     <title>${title} — CloudPress</title>
     <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
     .box{text-align:center;max-width:420px;padding:40px}h1{font-size:1.4rem}a{color:#0070f3}</style>
     </head><body><div class="box"><h1>${title}</h1><p>${message}</p></div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
