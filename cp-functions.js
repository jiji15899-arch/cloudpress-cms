/**
 * CloudPress CMS — cp-functions.js
 * WordPress wp-settings.php + query.php 핵심 함수 대체
 *
 * - URL 기반 쿼리 파싱 (포스트/페이지/아카이브/검색)
 * - D1(DB) 기반 콘텐츠 조회
 * - 훅/필터 시스템 (플러그인 호환)
 *
 * @package CloudPress
 */

// ── 훅/필터 시스템 (WordPress add_action/apply_filters 호환) ──────
const _hooks   = new Map(); // action hooks
const _filters = new Map(); // filter hooks

export function cpAddAction(tag, fn, priority = 10) {
  if (!_hooks.has(tag)) _hooks.set(tag, []);
  _hooks.get(tag).push({ fn, priority });
  _hooks.get(tag).sort((a, b) => a.priority - b.priority);
}

export function cpDoAction(tag, ...args) {
  const handlers = _hooks.get(tag) || [];
  for (const { fn } of handlers) fn(...args);
}

export function cpAddFilter(tag, fn, priority = 10) {
  if (!_filters.has(tag)) _filters.set(tag, []);
  _filters.get(tag).push({ fn, priority });
  _filters.get(tag).sort((a, b) => a.priority - b.priority);
}

export function cpApplyFilters(tag, value, ...args) {
  const handlers = _filters.get(tag) || [];
  for (const { fn } of handlers) value = fn(value, ...args);
  return value;
}

// ── 메인 쿼리 파서 ────────────────────────────────────────────────
/**
 * URL 경로를 분석해 cp.query / cp.queried 를 채운다
 * @param {CPContext} cp
 */
export async function cpQuery(cp) {
  const { url, env } = cp;
  const path = url.pathname.replace(/\/+$/, '') || '/';

  cp.query = parseQuery(url);

  // ── 정적/기능 경로 ────────────────────────────────────────────
  if (path === '/cp-sitemap.xml') { cp.queried = { type: 'sitemap' }; return; }
  if (path === '/robots.txt')     { cp.queried = { type: 'robots'  }; return; }
  if (path === '/feed' || path === '/feed/rss2') {
    cp.queried = { type: 'feed' };
    cp.queried.posts = await queryPosts(env, { limit: 20, status: 'publish' });
    return;
  }

  // ── 검색 ──────────────────────────────────────────────────────
  if (cp.query.s) {
    cp.queried = { type: 'search', s: cp.query.s };
    cp.queried.posts = await searchPosts(env, cp.query.s, cp.query.paged);
    return;
  }

  // ── 단일 포스트/페이지 (/year/month/slug 또는 /slug) ──────────
  const postMatch = path.match(/^\/(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)\/?$/);
  if (postMatch) {
    const slug = postMatch[4];
    const post = await getPostBySlug(env, slug, 'post');
    cp.queried = post
      ? { type: 'single', post, postType: 'post' }
      : { type: '404' };
    return;
  }

  const pageMatch = path.match(/^\/([^/]+)\/?$/);
  if (pageMatch && path !== '/') {
    const slug = pageMatch[1];
    // 페이지 우선
    const page = await getPostBySlug(env, slug, 'page');
    if (page) { cp.queried = { type: 'page', post: page, postType: 'page' }; return; }
    // 포스트
    const post = await getPostBySlug(env, slug, 'post');
    if (post) { cp.queried = { type: 'single', post, postType: 'post' }; return; }
    // 카테고리
    const cat = await getTermBySlug(env, slug, 'category');
    if (cat) {
      cp.queried = { type: 'category', term: cat };
      cp.queried.posts = await queryPosts(env, { termId: cat.id, taxonomy: 'category', paged: cp.query.paged });
      return;
    }
    // 태그
    const tag = await getTermBySlug(env, slug, 'post_tag');
    if (tag) {
      cp.queried = { type: 'tag', term: tag };
      cp.queried.posts = await queryPosts(env, { termId: tag.id, taxonomy: 'post_tag', paged: cp.query.paged });
      return;
    }
    cp.queried = { type: '404' };
    return;
  }

  // ── 홈 ───────────────────────────────────────────────────────
  const frontPage = cp.settings.get('page_on_front');
  if (frontPage) {
    const page = await getPostById(env, frontPage);
    if (page) { cp.queried = { type: 'frontpage', post: page }; return; }
  }

  cp.queried = { type: 'home' };
  cp.queried.posts = await queryPosts(env, {
    status: 'publish',
    postType: 'post',
    paged: cp.query.paged,
    limit: parseInt(cp.settings.get('posts_per_page') || '10'),
  });
}

// ── URL 쿼리 파싱 ─────────────────────────────────────────────────
function parseQuery(url) {
  const q = {};
  for (const [k, v] of url.searchParams) q[k] = v;
  q.paged = parseInt(q.paged || q.page || '1', 10);
  return q;
}

// ── D1 콘텐츠 조회 함수들 ─────────────────────────────────────────

export async function getPostBySlug(env, slug, postType = 'post') {
  try {
    return await env.DB.prepare(
      `SELECT p.*, u.display_name as author_name
       FROM cp_posts p
       LEFT JOIN cp_users u ON p.post_author = u.ID
       WHERE p.post_name=? AND p.post_type=? AND p.post_status='publish'
       LIMIT 1`
    ).bind(slug, postType).first();
  } catch { return null; }
}

export async function getPostById(env, id) {
  try {
    return await env.DB.prepare(
      `SELECT p.*, u.display_name as author_name
       FROM cp_posts p
       LEFT JOIN cp_users u ON p.post_author = u.ID
       WHERE p.ID=? AND p.post_status='publish'
       LIMIT 1`
    ).bind(id).first();
  } catch { return null; }
}

export async function queryPosts(env, {
  status   = 'publish',
  postType = 'post',
  termId   = null,
  taxonomy = null,
  paged    = 1,
  limit    = 10,
  authorId = null,
} = {}) {
  const offset = (Math.max(1, paged) - 1) * limit;
  try {
    if (termId && taxonomy) {
      const { results } = await env.DB.prepare(
        `SELECT p.*, u.display_name as author_name
         FROM cp_posts p
         LEFT JOIN cp_users u ON p.post_author = u.ID
         INNER JOIN cp_term_relationships tr ON p.ID = tr.object_id
         INNER JOIN cp_term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
         WHERE tt.term_id=? AND tt.taxonomy=? AND p.post_type='post'
           AND p.post_status=?
         ORDER BY p.post_date DESC LIMIT ? OFFSET ?`
      ).bind(termId, taxonomy, status, limit, offset).all();
      return results ?? [];
    }
    const authorClause = authorId ? 'AND p.post_author=?' : '';
    const params       = authorId
      ? [postType, status, limit, offset, authorId]
      : [postType, status, limit, offset];
    const { results } = await env.DB.prepare(
      `SELECT p.*, u.display_name as author_name
       FROM cp_posts p
       LEFT JOIN cp_users u ON p.post_author = u.ID
       WHERE p.post_type=? AND p.post_status=? ${authorClause}
       ORDER BY p.post_date DESC LIMIT ? OFFSET ?`
    ).bind(...params).all();
    return results ?? [];
  } catch (e) {
    console.error('[cp-functions] queryPosts error:', e.message);
    return [];
  }
}

export async function searchPosts(env, keyword, paged = 1, limit = 10) {
  const offset = (Math.max(1, paged) - 1) * limit;
  const q      = `%${keyword}%`;
  try {
    const { results } = await env.DB.prepare(
      `SELECT p.*, u.display_name as author_name
       FROM cp_posts p
       LEFT JOIN cp_users u ON p.post_author = u.ID
       WHERE p.post_status='publish' AND p.post_type='post'
         AND (p.post_title LIKE ? OR p.post_content LIKE ?)
       ORDER BY p.post_date DESC LIMIT ? OFFSET ?`
    ).bind(q, q, limit, offset).all();
    return results ?? [];
  } catch { return []; }
}

export async function getTermBySlug(env, slug, taxonomy) {
  try {
    return await env.DB.prepare(
      `SELECT t.*, tt.taxonomy, tt.count
       FROM cp_terms t
       INNER JOIN cp_term_taxonomy tt ON t.term_id = tt.term_id
       WHERE t.slug=? AND tt.taxonomy=?
       LIMIT 1`
    ).bind(slug, taxonomy).first();
  } catch { return null; }
}

// ── 메타 데이터 조회 ──────────────────────────────────────────────
export async function getPostMeta(env, postId, metaKey = null) {
  try {
    if (metaKey) {
      const row = await env.DB.prepare(
        'SELECT meta_value FROM cp_postmeta WHERE post_id=? AND meta_key=? LIMIT 1'
      ).bind(postId, metaKey).first();
      return row?.meta_value ?? null;
    }
    const { results } = await env.DB.prepare(
      'SELECT meta_key, meta_value FROM cp_postmeta WHERE post_id=?'
    ).bind(postId).all();
    return Object.fromEntries((results ?? []).map(r => [r.meta_key, r.meta_value]));
  } catch { return null; }
}

export async function getUserMeta(env, userId, metaKey = null) {
  try {
    if (metaKey) {
      const row = await env.DB.prepare(
        'SELECT meta_value FROM cp_usermeta WHERE user_id=? AND meta_key=? LIMIT 1'
      ).bind(userId, metaKey).first();
      return row?.meta_value ?? null;
    }
    const { results } = await env.DB.prepare(
      'SELECT meta_key, meta_value FROM cp_usermeta WHERE user_id=?'
    ).bind(userId).all();
    return Object.fromEntries((results ?? []).map(r => [r.meta_key, r.meta_value]));
  } catch { return null; }
}
