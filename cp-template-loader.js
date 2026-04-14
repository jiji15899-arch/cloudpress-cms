/**
 * CloudPress CMS — cp-template-loader.js
 * WordPress template-loader.php 대체
 *
 * 쿼리 타입에 따라 적절한 테마 템플릿을 선택하고 응답을 반환한다.
 * 테마 파일은 KV 또는 D1(cp_theme_files 테이블)에 저장되어 있다.
 *
 * 템플릿 우선순위 (WordPress 계층 구조 동일):
 *   single → single-{type} → singular → archive → index
 *
 * @package CloudPress
 */

import { CPError } from './cp-load.js';

/**
 * @param {CPContext} cp
 * @returns {Response}
 */
export function cpTemplateLoader(cp) {
  const { queried } = cp;

  try {
    switch (queried?.type) {
      case 'single':
      case 'page':
      case 'frontpage':
        return renderThemeTemplate(cp, ['single', 'singular', 'index']);

      case 'home':
      case 'archive':
      case 'category':
      case 'tag':
        return renderThemeTemplate(cp, ['archive', 'index']);

      case 'search':
        return renderThemeTemplate(cp, ['search', 'index']);

      case 'feed':
        return renderFeed(cp);

      case 'sitemap':
        return renderSitemap(cp);

      case 'robots':
        return renderRobots(cp);

      case '404':
        return render404(cp);

      default:
        return renderThemeTemplate(cp, ['index']);
    }
  } catch (e) {
    if (e instanceof CPError) {
      return errorResponse(e.status, e.message);
    }
    return errorResponse(500, e.message || '서버 오류');
  }
}

// ── 테마 템플릿 렌더링 ────────────────────────────────────────────
/**
 * 활성 테마의 템플릿을 D1/KV에서 찾아 렌더링
 * 테마 파일이 없으면 기본 내장 템플릿을 사용
 * @param {CPContext} cp
 * @param {string[]} candidates
 * @returns {Response}
 */
async function renderThemeTemplate(cp, candidates) {
  const activeTheme = cp.settings.get('active_theme') || 'default';

  // KV에서 테마 파일 로드 시도
  for (const tpl of candidates) {
    const cacheKey = `theme:${activeTheme}:${tpl}.html`;
    try {
      const content = await cp.env.CACHE.get(cacheKey, { type: 'text' });
      if (content) {
        const rendered = injectVars(content, cp);
        return new Response(rendered, {
          status: cp.queried?.type === '404' ? 404 : 200,
          headers: cp.headers,
        });
      }
    } catch (_) {}
  }

  // 기본 내장 템플릿 (테마 없을 때)
  return new Response(buildDefaultTemplate(cp), {
    status: cp.queried?.type === '404' ? 404 : 200,
    headers: cp.headers,
  });
}

// ── RSS 피드 ──────────────────────────────────────────────────────
function renderFeed(cp) {
  const siteName   = cp.settings.get('site_name')   || 'CloudPress';
  const siteUrl    = cp.settings.get('site_domain')  || cp.url.origin;
  const siteDesc   = cp.settings.get('blogdescription') || '';
  const posts      = cp.queried?.posts || [];
  const items      = posts.map(p => `
    <item>
      <title><![CDATA[${esc(p.post_title)}]]></title>
      <link>https://${siteUrl}/${p.post_name}/</link>
      <guid isPermaLink="true">https://${siteUrl}/${p.post_name}/</guid>
      <pubDate>${new Date(p.post_date).toUTCString()}</pubDate>
      <description><![CDATA[${esc(p.post_excerpt || p.post_content?.slice(0, 200) || '')}]]></description>
    </item>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(siteName)}</title>
  <link>https://${siteUrl}</link>
  <description>${esc(siteDesc)}</description>
  <language>ko-KR</language>
  <atom:link href="https://${siteUrl}/feed/" rel="self" type="application/rss+xml"/>
  ${items}
</channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}

// ── 사이트맵 ──────────────────────────────────────────────────────
function renderSitemap(cp) {
  const siteUrl = cp.settings.get('site_domain') || cp.url.hostname;
  const urls    = [
    `<url><loc>https://${siteUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}

// ── robots.txt ────────────────────────────────────────────────────
function renderRobots(cp) {
  const siteUrl = cp.settings.get('site_domain') || cp.url.hostname;
  const txt     = `User-agent: *\nAllow: /\nSitemap: https://${siteUrl}/cp-sitemap.xml\n`;
  return new Response(txt, { headers: { 'Content-Type': 'text/plain' } });
}

// ── 404 ───────────────────────────────────────────────────────────
function render404(cp) {
  const html = buildDefaultTemplate(cp, true);
  return new Response(html, { status: 404, headers: cp.headers });
}

// ── 에러 ──────────────────────────────────────────────────────────
function errorResponse(status, message) {
  const safe = String(message).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return new Response(
    `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>오류</title></head>
     <body><h1>오류 ${status}</h1><p>${safe}</p></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// ── 기본 내장 템플릿 (테마 없을 때 fallback) ──────────────────────
function buildDefaultTemplate(cp, is404 = false) {
  const siteName = cp.settings.get('site_name') || 'CloudPress';
  const posts    = cp.queried?.posts || [];
  const post     = cp.queried?.post;

  const postItems = posts.map(p => `
    <article>
      <h2><a href="/${p.post_name}/">${esc(p.post_title)}</a></h2>
      <p class="meta">${p.post_date?.slice(0, 10) || ''} · ${esc(p.author_name || '')}</p>
      <div class="excerpt">${esc(p.post_excerpt || p.post_content?.slice(0, 200) || '')}</div>
    </article>`).join('');

  const body = is404
    ? '<h1>404 — 페이지를 찾을 수 없습니다.</h1><p><a href="/">홈으로 돌아가기</a></p>'
    : post
      ? `<article><h1>${esc(post.post_title)}</h1><div class="content">${post.post_content || ''}</div></article>`
      : postItems || '<p>게시물이 없습니다.</p>';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(post?.post_title || siteName)}</title>
  <style>
    *{box-sizing:border-box}body{font-family:sans-serif;max-width:860px;margin:0 auto;padding:20px;color:#333}
    h1,h2{line-height:1.3}a{color:#0070f3;text-decoration:none}a:hover{text-decoration:underline}
    .meta{color:#888;font-size:.85rem}article{margin-bottom:2rem;border-bottom:1px solid #eee;padding-bottom:1.5rem}
    header{border-bottom:2px solid #0070f3;margin-bottom:2rem;padding-bottom:1rem}
    header a{color:inherit}
  </style>
</head>
<body>
  <header><h1><a href="/">${esc(siteName)}</a></h1></header>
  <main>${body}</main>
</body>
</html>`;
}

// ── 템플릿 변수 삽입 ──────────────────────────────────────────────
function injectVars(template, cp) {
  const siteName = cp.settings.get('site_name') || 'CloudPress';
  return template
    .replace(/\{\{site_name\}\}/g,  esc(siteName))
    .replace(/\{\{site_url\}\}/g,   cp.url.origin)
    .replace(/\{\{charset\}\}/g,    'utf-8');
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
