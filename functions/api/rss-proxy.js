/**
 * Cloudflare Pages Function —— RSS / Atom 代理
 *
 * 路由：/api/rss-proxy?url=<encodeURIComponent(feedUrl)>
 * 作用：由边缘函数代替浏览器抓取第三方 RSS / Atom，绕过浏览器 CORS 限制。
 * 返回：200 { xml: "<原始 XML 字符串>" }；出错返回 { error: "..." } + 相应状态码。
 *
 * 注意：本文件只在 Cloudflare Pages（或支持同名 Functions 约定的平台）上生效。
 *      GitHub Pages / 本地双击打开 index.html 时该端点不存在，
 *      前端会自动降级为直连 fetch（仅对 CORS 友好的源有效）。
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS_HEADERS)
  });
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url).searchParams.get('url');
  if (!url || !url.match(/^https?:\/\/.+/i)) {
    return jsonResponse({ error: 'invalid url' }, 400);
  }

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS2ICS/1.0)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) {
      return jsonResponse({ error: 'upstream HTTP ' + resp.status }, 502);
    }
    const text = await resp.text();
    return jsonResponse({ xml: text }, 200);
  } catch (e) {
    return jsonResponse({ error: (e && e.message) ? e.message : String(e) }, 502);
  }
}
