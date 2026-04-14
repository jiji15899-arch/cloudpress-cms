/**
 * CloudPress CMS — cp-comments-post.js
 * WordPress wp-comments-post.php 대체
 *
 * POST /cp-comments-post → D1 댓글 저장
 * PHP 불필요 — Cloudflare Workers 에서 직접 처리
 *
 * @package CloudPress
 */

import { cpCurrentUser } from './cp-auth.js';

export async function handleCommentsPost(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    const ct = request.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      body = await request.json();
    } else {
      const form = await request.formData();
      body = Object.fromEntries(form);
    }
  } catch {
    return jsonErr('요청 형식 오류');
  }

  const { comment_post_ID, comment_content, comment_author, comment_author_email } = body;

  if (!comment_post_ID)                           return jsonErr('포스트 ID가 없습니다.');
  if (!comment_content?.trim())                   return jsonErr('댓글 내용을 입력하세요.');

  // 스팸 방지: 빈 honeypot 확인
  if (body.cp_comment_nonce_name)                 return jsonErr('잘못된 요청입니다.');

  // 포스트 존재 여부 확인
  const post = await env.DB.prepare(
    `SELECT ID, comment_status FROM cp_posts WHERE ID=? AND post_status='publish' LIMIT 1`
  ).bind(comment_post_ID).first();

  if (!post)                                       return jsonErr('포스트를 찾을 수 없습니다.', 404);
  if (post.comment_status !== 'open')              return jsonErr('댓글이 닫혀 있습니다.', 403);

  // 로그인 사용자 정보 우선
  const user   = await cpCurrentUser(env, request);
  const author = user?.name  || comment_author?.trim()        || '익명';
  const email  = user?.email || comment_author_email?.trim()  || '';

  // 댓글 저장
  const commentId = 'cmt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  await env.DB.prepare(
    `INSERT INTO cp_comments
      (comment_ID, comment_post_ID, comment_author, comment_author_email,
       comment_content, comment_approved, user_id, comment_date)
     VALUES (?,?,?,?,?,?,?,datetime('now'))`
  ).bind(
    commentId, comment_post_ID, author, email,
    comment_content.trim(),
    user ? '1' : '0', // 로그인 사용자는 자동 승인
    user?.id || null
  ).run();

  // 댓글 수 갱신
  await env.DB.prepare(
    `UPDATE cp_posts
     SET comment_count = (SELECT COUNT(*) FROM cp_comments WHERE comment_post_ID=? AND comment_approved='1')
     WHERE ID=?`
  ).bind(comment_post_ID, comment_post_ID).run();

  // JSON 또는 리다이렉트 응답
  const accept = request.headers.get('Accept') || '';
  if (accept.includes('application/json')) {
    return new Response(JSON.stringify({ ok: true, commentId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const referer = request.headers.get('Referer') || '/';
  return Response.redirect(referer + `#comment-${commentId}`, 303);
}

function jsonErr(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
