/**
 * Cloudflare Pages Function —— RSS / Atom → ICS（webcal 订阅端点）
 *
 * 路由：GET /api/rss-to-ics?url=<feed>&tz=&dur=&remind=&limit=&title=&uid=&name=
 * 作用：把 RSS / Atom 在边缘直接转成 .ics，供日历客户端「按网址订阅」(webcal:// 或 https://)。
 * 无状态：不落库、不持久化内容；每次请求现取现转，靠 Cache-Control 让边缘缓存兜住客户端轮询。
 *
 * 为什么不用 DOMParser：Workers 运行时没有 DOM / DOMParser，所以这里自带一个精简 XML 解析器，
 * 只提取真正需要的子元素（title / link / pubDate|published|updated / description|summary|content / guid|id）。
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

const DEFAULT_TZ = 'Asia/Shanghai';
const MAX_LIMIT = 300;
const MAX_DESC = 300;

/* ============================================================
 * 参数与安全
 * ============================================================ */
function num(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/* SSRF 防护（尽力而为：拒绝本机 / 内网 / 保留地址） */
function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.slice(-10) === '.localhost') return true;
  if (h.slice(-6) === '.local' || h.slice(-9) === '.internal' || h.slice(-10) === '.home.arpa') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2], c = +m[3], d = +m[4];
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return false;
  }
  if (h.indexOf(':') >= 0) {
    if (h === '::1' || h === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
    if (/^fe80:/.test(h)) return true;
    return false;
  }
  return false;
}

function checkFeedUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return { error: 'url 不是合法的地址' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'url 只支持 http(s) 协议' };
  if (isBlockedHost(u.hostname)) return { error: '出于安全考虑，不允许访问本机 / 内网地址' };
  return { url: u.toString() };
}

function safeTimeZone(tz) {
  const v = ((tz || DEFAULT_TZ) + '').trim() || DEFAULT_TZ;
  try { new Intl.DateTimeFormat('en-US', { timeZone: v }).format(new Date()); return v; } catch (e) { return DEFAULT_TZ; }
}

/* ============================================================
 * 精简 XML 解析器（Workers 无 DOMParser）
 * ============================================================ */
function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, function (m, ent) {
    if (ent.charAt(0) === '#') {
      const code = ent.charAt(1).toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch (e) { return m; }
    }
    if (ent === 'amp') return '&';
    if (ent === 'lt') return '<';
    if (ent === 'gt') return '>';
    if (ent === 'quot') return '"';
    if (ent === 'apos') return "'";
    if (ent === 'nbsp') return ' ';
    return m;
  });
}

function localName(name) {
  const s = String(name || '');
  const i = s.indexOf(':');
  return i < 0 ? s : s.slice(i + 1);
}

function findTagEnd(src, from) {
  let q = '';
  for (let i = from; i < src.length; i++) {
    const ch = src.charAt(i);
    if (q) { if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '>') return i;
  }
  return -1;
}

function parseAttrs(s) {
  const out = {};
  const re = /([^\s=\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(s))) {
    const v = m[2] != null ? m[2] : (m[3] != null ? m[3] : (m[4] || ''));
    out[localName(m[1]).toLowerCase()] = decodeEntities(v);
  }
  return out;
}

/* 把 XML 解析成 { name, attrs, children, text } 树（CDATA 原样、普通文本解实体） */
function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { stack[stack.length - 1].text += decodeEntities(src.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += (e < 0 ? src.slice(lt + 9) : src.slice(lt + 9, e));
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt + 2); i = e < 0 ? n : e + 1; continue; }

    const gt = findTagEnd(src, lt + 1);
    if (gt < 0) break;
    let inner = src.slice(lt + 1, gt);
    const selfClose = inner.charAt(inner.length - 1) === '/';
    if (selfClose) inner = inner.slice(0, -1);
    const closing = inner.charAt(0) === '/';
    if (closing) inner = inner.slice(1);

    const nameEnd = inner.search(/[\s]/);
    const rawName = (nameEnd < 0 ? inner : inner.slice(0, nameEnd)).trim();
    if (rawName) {
      if (closing) {
        for (let k = stack.length - 1; k > 0; k--) {
          if (localName(stack[k].name).toLowerCase() === localName(rawName).toLowerCase()) { stack.length = k; break; }
        }
      } else {
        const el = { name: rawName, attrs: parseAttrs(nameEnd < 0 ? '' : inner.slice(nameEnd)), children: [], text: '' };
        stack[stack.length - 1].children.push(el);
        if (!selfClose) stack.push(el);
      }
    }
    i = gt + 1;
  }
  return root;
}

/* ============================================================
 * Feed → 中间结构
 * ============================================================ */
function lname(el) { return localName(el.name).toLowerCase(); }

function childByLocal(el, names) {
  for (let i = 0; i < el.children.length; i++) {
    if (names.indexOf(lname(el.children[i])) >= 0) return el.children[i];
  }
  return null;
}

function textOf(el) { return el ? String(el.text || '').trim() : ''; }

function stripHtml(s) {
  /* 与前端保持一致：前端用 div.innerHTML + textContent，浏览器不会为标签补空格，
     所以这里也把标签替换成 ''（而不是 ' '），避免中文被切成「这是 摘要 内容」。 */
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* 在 root 的直接子元素里找 rss / feed / rdf:RDF */
function findDocElement(root) {
  for (let i = 0; i < root.children.length; i++) {
    const n = lname(root.children[i]);
    if (n === 'rss' || n === 'feed' || n === 'rdf') return root.children[i];
  }
  return null;
}

/* 收集条目：Atom(entry) / RSS 2.0(channel>item) / RSS 1.0(RDF 下 item) */
function collectItems(doc) {
  const direct = doc.children.filter(function (c) { return lname(c) === 'item' || lname(c) === 'entry'; });
  if (direct.length) return direct;
  const chan = childByLocal(doc, ['channel']);
  if (chan) {
    const viaChan = chan.children.filter(function (c) { return lname(c) === 'item' || lname(c) === 'entry'; });
    if (viaChan.length) return viaChan;
  }
  return [];
}

/* ---------- Event RSS（ev: 命名空间）辅助 ---------- */
/* 纯日期（2005-10-08 / 20051008）→ 全天事件；带时间 → 定时事件 */
function isDateOnly(s) {
  return /^\d{4}-?\d{2}-?\d{2}$/.test(String(s || '').trim());
}
/* 任意日期写法 → YYYYMMDD */
function ymd8(s) {
  return String(s || '').trim().replace(/[-/]/g, '').replace(/[^0-9]/g, '').slice(0, 8);
}
function parseDateValue(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
/* ISO 8601 duration（PT2H30M / P1D / PT45M）→ 毫秒 */
function parseIsoDuration(s) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(String(s || '').trim());
  if (!m) return null;
  const ms = ((((+m[1] || 0) * 7 + (+m[2] || 0)) * 24 + (+m[3] || 0)) * 60 + (+m[4] || 0)) * 60000 +
    Math.round((+m[5] || 0) * 1000);
  return ms > 0 ? ms : null;
}
function evStatusOf(s) {
  const v = String(s || '').trim().toLowerCase();
  if (v === 'canceled' || v === 'cancelled') return 'CANCELLED';
  if (v === 'tentative') return 'TENTATIVE';
  return '';
}

/* 单条条目 → 事件对象
   优先用 Event RSS 扩展（ev:startdate 等，解析器按 localName 匹配，所以 ev:startdate → 'startdate'）；
   没有 ev: 时退回发布时间（pubDate / published / updated）。
   useEv=false 可强制忽略 ev: 扩展。 */
function itemToPost(el, useEv) {
  const title = textOf(childByLocal(el, ['title']));

  // link：Atom 取 <link href>（优先 rel=alternate），RSS 取 <link> 文本
  let link = '';
  for (let i = 0; i < el.children.length; i++) {
    const c = el.children[i];
    if (lname(c) !== 'link') continue;
    const href = c.attrs.href || '';
    const rel = (c.attrs.rel || '').toLowerCase();
    if (href && (!rel || rel === 'alternate')) { link = href; break; }
    if (href && !link) link = href;
    if (!href && !link) link = textOf(c);
  }

  /* ---- Event RSS 扩展 ---- */
  const evStartRaw = useEv ? textOf(childByLocal(el, ['startdate'])) : '';
  const evEndRaw = useEv ? textOf(childByLocal(el, ['enddate'])) : '';
  const evDurRaw = useEv ? textOf(childByLocal(el, ['duration'])) : '';
  const status = useEv ? evStatusOf(textOf(childByLocal(el, ['eventstatus']))) : '';
  const place = useEv ? [textOf(childByLocal(el, ['location'])), textOf(childByLocal(el, ['street'])),
    textOf(childByLocal(el, ['city'])), textOf(childByLocal(el, ['region'])),
    textOf(childByLocal(el, ['country']))].filter(Boolean).join(', ') : '';

  /* ---- 开始时间：ev:startdate 优先，其次 pubDate / published / updated ---- */
  let dateRaw = '', allDayYmd = '';
  if (evStartRaw) {
    if (isDateOnly(evStartRaw)) allDayYmd = ymd8(evStartRaw);
    else dateRaw = evStartRaw;
  }
  if (!allDayYmd && !dateRaw) {
    const dateNames = ['pubdate', 'published', 'updated', 'date', 'issued', 'created'];
    for (let i = 0; i < dateNames.length && !dateRaw; i++) {
      const c = childByLocal(el, [dateNames[i]]);
      if (c) dateRaw = textOf(c);
    }
    if (dateRaw && isDateOnly(dateRaw)) { allDayYmd = ymd8(dateRaw); dateRaw = ''; }
  }
  const date = parseDateValue(dateRaw);

  /* ---- 结束时间：ev:enddate → ev:duration ---- */
  let endDate = null, endAllDayYmd = '';
  if (evEndRaw) {
    if (isDateOnly(evEndRaw)) endAllDayYmd = ymd8(evEndRaw);
    else endDate = parseDateValue(evEndRaw);
  } else if (evDurRaw) {
    const ms = parseIsoDuration(evDurRaw);
    if (ms && date) endDate = new Date(date.getTime() + ms);
    else if (ms && allDayYmd) {
      const days = Math.round(ms / 86400000);
      if (days > 1) {
        const d = new Date(Date.UTC(+allDayYmd.slice(0, 4), +allDayYmd.slice(4, 6) - 1, +allDayYmd.slice(6, 8)));
        d.setUTCDate(d.getUTCDate() + days - 1);
        endAllDayYmd = ymd8(d.toISOString().slice(0, 10));
      }
    }
  }
  if (endDate && date && endDate.getTime() <= date.getTime()) endDate = null;

  /* ---- 摘要：description | summary | content ---- */
  let raw = '';
  const sumNames = ['description', 'summary', 'content'];
  for (let i = 0; i < sumNames.length && !raw; i++) {
    const c = childByLocal(el, [sumNames[i]]);
    if (c) raw = textOf(c);
  }
  const description = stripHtml(raw).slice(0, MAX_DESC);

  const id = textOf(childByLocal(el, ['guid', 'id'])) || link || title || '';

  return {
    id: id, title: title, link: link, description: description,
    date: date, allDayYmd: allDayYmd, endDate: endDate, endAllDayYmd: endAllDayYmd,
    location: stripHtml(place).slice(0, 120), status: status,
    fromEv: !!(evStartRaw || evEndRaw || evDurRaw)
  };
}

function parseFeed(xml, useEv) {
  const root = parseXml(xml);
  const doc = findDocElement(root);
  if (!doc) throw new Error('没有找到 rss / feed / rdf 根元素');
  const isAtom = lname(doc) === 'feed';

  /* 元信息（标题/描述）所在位置：Atom 在 feed 上；RSS 2.0 / RSS 1.0 在 channel 上 */
  let meta = doc;
  if (lname(doc) !== 'feed') meta = childByLocal(doc, ['channel']) || doc;
  const title = textOf(childByLocal(meta, ['title'])) || 'RSS 订阅';
  const subtitle = textOf(childByLocal(meta, ['subtitle', 'description']));

  const items = collectItems(doc).map(function (el) { return itemToPost(el, useEv); });
  return { title: title, description: stripHtml(subtitle).slice(0, 200), items: items };
}

/* ============================================================
 * ICS 生成
 * ============================================================ */
function hash36(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* RFC 5545 文本转义：反斜杠必须最先处理 */
function escapeIcs(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/* RFC 5545 折行：按「八位字节」折到 75 以内，不切坏多字节字符（中文 3 字节） */
function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75; // 首行 75；续行以 " " 开头，故内容上限 74
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) { parts.push(cur); cur = ''; curBytes = 0; limit = 74; }
    cur += ch;
    curBytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/* 某个瞬时在目标时区的「墙上时间」，如 2026-09-24T17:30+08:00 → 20260924 / 17 / 30 */
function wallClock(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p = {};
  const parts = fmt.formatToParts(date);
  for (let i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
  const hh = p.hour === '24' ? '00' : p.hour;
  return { date: p.year + p.month + p.day, hh: hh, mi: p.minute };
}

/* YYYYMMDD + 1 天（按日历日期推进，避开夏令时） */
function nextDayYmd(ymd) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/* ============================================================
 * 边缘缓存（Cache API）
 * 注意：函数返回的 Response 上带 Cache-Control **不会**让 Cloudflare CDN 自动缓存；
 * 真正生效的是 caches.default（Cache API）。缓存键 = 去掉 fresh 之后的完整 URL。
 * ============================================================ */
const CACHE_TTL = 900; /* 秒：15 分钟 */

async function cacheGet(key) {
  try {
    if (typeof caches === 'undefined') return null;
    const hit = await caches.default.match(key);
    return hit || null;
  } catch (e) { return null; }
}
async function cachePut(key, resp) {
  try {
    if (typeof caches === 'undefined') return;
    await caches.default.put(key, resp);
  } catch (e) { /* 缓存不可用就静默忽略，不影响主流程 */ }
}

const HELP = [
  '参数（除 url 外都可省略）：',
  '  url     必填，RSS / Atom 订阅地址（需 encodeURIComponent）',
  '  tz      时区，默认 Asia/Shanghai',
  '  dur     事件时长（分钟），默认 60；填 allday 或 0 = 全天事件',
  '  remind  提前提醒（分钟），默认 0（不提醒）',
  '  limit   最多输出多少条，默认 50（上限 300）',
  '  title   title（仅标题，默认）| summary（标题 + 摘要前 20 字）',
  '  uid     UID 后缀，默认 rss2ics',
  '  name    覆盖日历名称（默认取订阅源标题）',
  '  ev      1（默认）优先用 Event RSS 的 ev:startdate 当作事件时间；0 = 只用发布时间',
  '  fresh   1 = 跳过读缓存、重新抓取并刷新缓存（用于缓存预热 / 强制刷新）',
  '',
  '示例：/api/rss-to-ics?url=https%3A%2F%2Fsspai.com%2Ffeed&tz=Asia%2FShanghai&dur=60&limit=30'
].join('\n');

function textError(msg, status) {
  return new Response('❌ ' + msg + '\n\n' + HELP + '\n', {
    status: status || 400,
    headers: Object.assign({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }, CORS_HEADERS)
  });
}

/* feed + 配置 → { ics, events, skipped, total } */
function buildIcs(feed, opt) {
  const CRLF = '\r\n';
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const calName = opt.nameOverride || feed.title || 'RSS 订阅';
  const slice = feed.items.slice(0, opt.limit);
  const seen = {};
  const out = [];
  let events = 0;
  let skipped = 0;

  let evItems = 0;

  for (let i = 0; i < slice.length; i++) {
    const it = slice[i];
    if (!it.date && !it.allDayYmd) { skipped++; continue; }
    if (it.fromEv) evItems++;

    let uid = 'rss' + hash36(it.id || it.link || it.title);
    if (seen[uid]) { seen[uid]++; uid = uid + '-' + seen[uid]; } else { seen[uid] = 1; }

    const title = it.title || '无标题';
    let summary = title;
    if (opt.titleMode === 'summary' && it.description) summary = title + ' - ' + it.description.slice(0, 20);

    const allDayEv = !!it.allDayYmd || opt.allDay;
    out.push('BEGIN:VEVENT');
    out.push('UID:' + uid + '@' + opt.uidPrefix);
    out.push('DTSTAMP:' + dtstamp);
    if (allDayEv) {
      const sYmd = it.allDayYmd || wallClock(it.date, opt.timeZone).date;
      /* 日期型 ev:enddate 按「含末日」理解（Event RSS 年代的习惯），
         而 iCal 的 DTEND 对全天是**独占**的 → 末日再 +1 天 */
      let eYmd = it.endAllDayYmd ? nextDayYmd(it.endAllDayYmd) : nextDayYmd(sYmd);
      if (eYmd <= sYmd) eYmd = nextDayYmd(sYmd);
      out.push('DTSTART;VALUE=DATE:' + sYmd);
      out.push('DTEND;VALUE=DATE:' + eYmd);
    } else {
      const s = wallClock(it.date, opt.timeZone);
      /* 有 ev:enddate 就用真实结束时间，否则用 URL 上的 dur 参数 */
      const endMs = it.endDate ? it.endDate.getTime() : (it.date.getTime() + opt.durMin * 60000);
      const e = wallClock(new Date(endMs), opt.timeZone);
      out.push('DTSTART;TZID=' + opt.timeZone + ':' + s.date + 'T' + s.hh + s.mi + '00');
      out.push('DTEND;TZID=' + opt.timeZone + ':' + e.date + 'T' + e.hh + e.mi + '00');
    }
    out.push('SUMMARY:' + escapeIcs(summary));
    if (it.description) out.push('DESCRIPTION:' + escapeIcs(it.description));
    if (it.location) out.push('LOCATION:' + escapeIcs(it.location));
    if (it.status) out.push('STATUS:' + it.status);
    if (it.link) out.push('URL:' + it.link);
    if (opt.remind > 0) {
      out.push('BEGIN:VALARM');
      out.push('TRIGGER:-PT' + opt.remind + 'M');
      out.push('ACTION:DISPLAY');
      out.push('DESCRIPTION:' + escapeIcs(summary));
      out.push('END:VALARM');
    }
    out.push('END:VEVENT');
    events++;
  }

  const head = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RSS2ICS//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeIcs(calName),
    'X-WR-CALDESC:' + escapeIcs(feed.description || ('RSS 订阅：' + opt.feedUrl)),
    'X-WR-TIMEZONE:' + opt.timeZone,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H'
  ];
  const tail = ['END:VCALENDAR'];

  const ics = head.concat(out, tail).map(foldLine).join(CRLF) + CRLF;
  return { ics: ics, events: events, skipped: skipped, total: feed.items.length, evItems: evItems };
}

export async function onRequest(context) {
  const request = context.request;
  const waitUntil = typeof context.waitUntil === 'function' ? function (p) { context.waitUntil(p); } : null;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return textError('只支持 GET 请求', 405);
  }

  const q = new URL(request.url).searchParams;
  const raw = (q.get('url') || '').trim();
  if (!raw) return textError('缺少 url 参数', 400);
  const chk = checkFeedUrl(raw);
  if (chk.error) return textError(chk.error, 400);

  const timeZone = safeTimeZone(q.get('tz'));
  const durRaw = ((q.get('dur') || '60') + '').trim().toLowerCase();
  const allDay = durRaw === 'allday' || durRaw === 'all' || durRaw === '0';
  const useEv = !/^(0|false|no|off)$/i.test(((q.get('ev') || '1') + '').trim());
  const fresh = /^(1|true|yes|on)$/i.test(((q.get('fresh') || '') + '').trim());
  const opt = {
    timeZone: timeZone,
    allDay: allDay,
    durMin: allDay ? 0 : num(durRaw, 60, 1, 1440),
    remind: num(q.get('remind'), 0, 0, 10080),
    limit: num(q.get('limit'), 50, 1, MAX_LIMIT),
    titleMode: ((q.get('title') || '') + '').trim().toLowerCase() === 'summary' ? 'summary' : 'title',
    uidPrefix: (((q.get('uid') || '') + '').trim().replace(/^@/, '')) || 'rss2ics',
    nameOverride: ((q.get('name') || '') + '').trim(),
    feedUrl: chk.url
  };

  /* ---------- 命中间缘缓存就直接返回（fresh=1 时跳过，用于预热/强刷） ---------- */
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.delete('fresh');   /* fresh 只决定"读不读缓存"，不能进缓存键，否则预热会另开一份 */
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

  if (!fresh) {
    const hit = await cacheGet(cacheKey);
    if (hit) {
      const h = new Headers(hit.headers);
      h.set('X-ICS-Cache', 'HIT');
      h.set('Access-Control-Allow-Origin', '*');
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: h });
      return new Response(hit.body, { status: 200, headers: h });
    }
  }

  let xml;
  try {
    const resp = await fetch(chk.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS2ICS/1.0)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return textError('订阅源返回 HTTP ' + resp.status + '（' + chk.url + '）', 502);
    xml = await resp.text();
  } catch (e) {
    return textError('抓取订阅源失败：' + ((e && e.message) || e), 502);
  }

  if (!/<(rss|feed|rdf)[\s:>]/i.test(xml)) {
    return textError('返回内容不是 RSS / Atom（可能被登录页或反爬页拦截）', 502);
  }

  let feed;
  try {
    feed = parseFeed(xml, useEv);
  } catch (e) {
    return textError('解析订阅源失败：' + ((e && e.message) || e), 502);
  }
  if (!feed.items.length) return textError('订阅源里没有条目', 502);

  const built = buildIcs(feed, opt);
  if (!built.events) return textError('没有可用事件：' + feed.items.length + ' 条里都取不到有效日期', 502);

  const headers = Object.assign({
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="rss.ics"',
    'Cache-Control': 'public, max-age=' + CACHE_TTL + ', s-maxage=' + CACHE_TTL + ', stale-while-revalidate=3600',
    'X-Robots-Tag': 'noindex',
    'X-ICS-Cache': fresh ? 'REFRESH' : 'MISS',
    'X-ICS-Events': String(built.events),
    'X-ICS-Skipped': String(built.skipped),
    'X-ICS-Total': String(built.total),
    'X-ICS-Ev-Items': String(built.evItems)
  }, CORS_HEADERS);

  /* 写回（或刷新）边缘缓存；用同一套响应头，命中时再改写 X-ICS-Cache */
  const stored = new Response(built.ics, { status: 200, headers: headers });
  const put = cachePut(cacheKey, stored);
  if (waitUntil) waitUntil(put); else await put;

  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: headers });
  return new Response(built.ics, { status: 200, headers: headers });
}




