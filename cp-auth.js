/**
 * CloudPress CMS — cp-auth.js
 * WordPress wp-login.php 대체 (VP 로그인 방식 완전 제거)
 *
 * 인증 방식:
 *   - 이메일 + 비밀번호 → SESSIONS KV (세션 토큰)
 *   - Bearer 토큰 또는 cp_session 쿠키
 *   - 2FA (TOTP) 선택 지원
 *   - VP(Vesta/HestiaCP) 로그인 제거됨
 *
 * @package CloudPress
 */

const SESSION_TTL = 60 * 60 * 24 * 7; // 7일 (초)

// ── 토큰 추출 ──────────────────────────────────────────────────────
export function getSessionToken(request) {
  // Authorization: Bearer <token>
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();

  // 쿠키: cp_session=<token>
  const cookie = request.headers.get('Cookie') || '';
  const match  = cookie.match(/cp_session=([^;]+)/);
  return match ? match[1].trim() : null;
}

// ── 현재 사용자 로드 ───────────────────────────────────────────────
export async function cpCurrentUser(env, request) {
  try {
    const token = getSessionToken(request);
    if (!token) return null;

    const userId = await env.SESSIONS.get(`session:${token}`);
    if (!userId) return null;

    const user = await env.DB.prepare(
      'SELECT id, name, email, role, plan, plan_expires_at, twofa_enabled FROM users WHERE id=?'
    ).bind(userId).first();

    return user || null;
  } catch (e) {
    console.error('[cp-auth] getUser error:', e.message);
    return null;
  }
}

// ── 로그인 처리 ───────────────────────────────────────────────────
export async function cpLogin(env, email, password) {
  if (!email || !password) return { ok: false, error: '이메일과 비밀번호를 입력하세요.' };

  const user = await env.DB.prepare(
    'SELECT id, name, email, role, plan, password_hash, twofa_enabled, twofa_secret FROM users WHERE email=?'
  ).bind(email.toLowerCase().trim()).first();

  if (!user) return { ok: false, error: '이메일 또는 비밀번호가 올바르지 않습니다.' };

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return { ok: false, error: '이메일 또는 비밀번호가 올바르지 않습니다.' };

  // 2FA 활성화 시 pending 상태 반환
  if (user.twofa_enabled) {
    return { ok: true, twofa_required: true, user_id: user.id };
  }

  const token = await createSession(env, user.id);
  return { ok: true, token, user: sanitizeUser(user) };
}

// ── 로그아웃 처리 ─────────────────────────────────────────────────
export async function cpLogout(env, request) {
  const token = getSessionToken(request);
  if (token) {
    try { await env.SESSIONS.delete(`session:${token}`); } catch (_) {}
  }
  return { ok: true };
}

// ── 세션 생성 ─────────────────────────────────────────────────────
export async function createSession(env, userId) {
  const token = generateToken();
  await env.SESSIONS.put(`session:${token}`, userId, { expirationTtl: SESSION_TTL });

  // D1 sessions 테이블에도 기록 (어드민 세션 관리용)
  try {
    const expiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)`
    ).bind(token, userId, expiresAt).run();
  } catch (_) {}

  return token;
}

// ── 회원가입 ──────────────────────────────────────────────────────
export async function cpRegister(env, { name, email, password }) {
  if (!name?.trim())    return { ok: false, error: '이름을 입력하세요.' };
  if (!email?.trim())   return { ok: false, error: '이메일을 입력하세요.' };
  if (!password || password.length < 8) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' };

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email=?')
    .bind(email.toLowerCase().trim()).first();
  if (existing) return { ok: false, error: '이미 사용 중인 이메일입니다.' };

  const id           = 'user_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const password_hash = await hashPassword(password);

  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, plan) VALUES (?,?,?,?,?,?)`
  ).bind(id, name.trim(), email.toLowerCase().trim(), password_hash, 'user', 'free').run();

  const token = await createSession(env, id);
  return { ok: true, token, user: { id, name, email, role: 'user', plan: 'free' } };
}

// ── 권한 확인 헬퍼 ────────────────────────────────────────────────
export function isAdmin(user)     { return user?.role === 'admin'; }
export function isLoggedIn(user)  { return !!user; }

export function requireAuth(user) {
  if (!isLoggedIn(user)) {
    return new Response(JSON.stringify({ ok: false, error: '로그인이 필요합니다.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

export function requireAdminAuth(user) {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ ok: false, error: '관리자 권한이 필요합니다.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

// ── 비밀번호 해시 (Web Crypto API — Cloudflare Workers 지원) ──────
export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt    = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password, stored) {
  if (!stored?.startsWith('pbkdf2:')) return false;
  const [, saltHex, hashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    keyMaterial, 256
  );
  const testHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return testHex === hashHex;
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────
function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeUser(user) {
  const { password_hash, twofa_secret, ...safe } = user;
  return safe;
}
