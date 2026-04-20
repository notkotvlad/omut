// CORS и стандартные ответы Worker.

export function corsHeaders(env, req) {
  const allow = (env.ALLOWED_ORIGINS || '*').trim();
  const origin = req.headers.get('Origin') || '';
  let allowOrigin = '*';
  if (allow !== '*') {
    const list = allow.split(',').map(s => s.trim()).filter(Boolean);
    allowOrigin = list.includes(origin) ? origin : list[0] || '*';
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

export function jsonResponse(body, { status = 200, env, req, cacheControl } = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...(env && req ? corsHeaders(env, req) : {}),
  };
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(code, message, { status = 500, env, req, extra } = {}) {
  return jsonResponse(
    { error: { code, message, ...(extra || {}) }, ok: false },
    { status, env, req, cacheControl: 'no-store' },
  );
}

export function preflight(req, env) {
  return new Response(null, { status: 204, headers: corsHeaders(env, req) });
}
