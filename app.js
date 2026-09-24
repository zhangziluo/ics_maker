/* ============================================================
 * app.js — 知识科普ICS生成器核心逻辑
 * 依赖：events.js（须先于本文件引入）
 * ============================================================ */

/* ---------- 工具函数 ---------- */
function getEventLink(event) {
  if (event.link && event.link.trim()) return event.link.trim();
  const kw = event.text.slice(0, 20).replace(/[·•·/\\]/g, ' ').trim();
  return `https://baike.baidu.com/search?word=${encodeURIComponent(kw)}`;
}

function escapeForICS(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function pad2(n) { return String(n).padStart(2, '0'); }

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/* ---------- 农历换算：用浏览器内置的中国农历(Intl)把公历日期映射成农历 ---------- */
let _lunarFmt;
function initLunarFmt() {
  if (_lunarFmt !== undefined) return _lunarFmt;
  try {
    _lunarFmt = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric", timeZone: "UTC" });
  } catch (e) { _lunarFmt = false; }
  return _lunarFmt;
}
function solarToLunar(date) {
  const fmt = initLunarFmt();
  if (!fmt) return null;
  try {
    const parts = fmt.formatToParts(date);
    let monthStr = "", dayNum = 0;
    for (const p of parts) {
      if (p.type === "month") monthStr = p.value;
      else if (p.type === "day") dayNum = parseInt(p.value, 10);
    }
    const isLeapMonth = monthStr.indexOf("闰") === 0;
    const name = isLeapMonth ? monthStr.slice(1) : monthStr;
    const m = LUNAR_MONTH_NUM[name];
    if (!m || !dayNum) return null;
    return { m: m, d: dayNum, isLeap: isLeapMonth };
  } catch (e) { return null; }
}
function buildLunarFestivalDB(year) {
  const out = {};
  if (!initLunarFmt()) return out;
  const daysInYear = isLeap(year) ? 366 : 365;
  const start = Date.UTC(year, 0, 1);
  for (let i = 0; i < daysInYear; i++) {
    const dt = new Date(start + i * 86400000);
    const lun = solarToLunar(dt);
    if (!lun || lun.isLeap) continue;
    let items = LUNAR_FESTIVALS[lun.m + "." + lun.d];
    const next = solarToLunar(new Date(start + (i + 1) * 86400000));
    if (next && next.m === 1 && next.d === 1) items = (items || []).concat([LUNAR_NEW_YEAR_EVE]);
    if (items && items.length) {
      const skey = (dt.getUTCMonth() + 1) + "." + dt.getUTCDate();
      out[skey] = (out[skey] || []).concat(items);
    }
  }
  return out;
}

/* ---------- 自实现历法换算（不依赖 ICU） ---------- */
function gregToJdn(y, m, d) {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}
function jdnToGreg(j) {
  const a = j + 32044, b = Math.floor((4 * a + 3) / 146097), c = a - Math.floor(146097 * b / 4);
  const d = Math.floor((4 * c + 3) / 1461), e = c - Math.floor(1461 * d / 4), m = Math.floor((5 * e + 2) / 153);
  return { y: 100 * b + d - 4800 + Math.floor(m / 10), m: m + 3 - 12 * Math.floor(m / 10), d: e - Math.floor((153 * m + 2) / 5) + 1 };
}
/* 伊斯兰历 表格/算术历（教内标准，30年11闰，纪元 1 Muharram 1 AH = 622-07-16） */
function hijriToJdn(y, m, d) {
  return d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + 1948439;
}
function jdnToHijri(jdn) {
  let y = Math.floor((30 * (jdn - 1948440) + 10646) / 10631), m = 1;
  while (m < 12 && hijriToJdn(y, m + 1, 1) <= jdn) m++;
  return { y: y, m: m, d: jdn - hijriToJdn(y, m, 1) + 1 };
}
/* 傣历（纪元 638-03-22 = 傣历0年元旦；19年7闰，闰九月） */
function daiNewYearJdn(y) { return Math.floor((394479457 * y + 1609723) / 1080000) + 1954166; }
function daiIsLeap(y) { const s = (y + 1) % 19; return s === 0 || s === 2 || s === 5 || s === 8 || s === 10 || s === 13 || s === 16; }
const DAI_ORDER = [6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5];
function daiMonthLen(y, m) {
  if (m === 8) return daiIsLeap(y) ? 29 : ((daiNewYearJdn(y + 1) - daiNewYearJdn(y) === 355) ? 30 : 29);
  if (m === 6 || m === 10 || m === 12 || m === 2 || m === 4) return 29;
  return 30;
}
function daiToJdn(y, m, d) {
  let j = daiNewYearJdn(y);
  const leap = daiIsLeap(y);
  for (let i = 0; i < DAI_ORDER.length; i++) {
    const mm = DAI_ORDER[i];
    if (mm === m) return j + d - 1;
    j += daiMonthLen(y, mm);
    if (leap && mm === 9) j += 30;
  }
  return j + d - 1;
}
function daiFestJdn(gy, code) {
  const dy = gy - 638;
  if (code === "ny") return daiNewYearJdn(dy);
  const pp = code.split(".");
  return daiToJdn(dy, parseInt(pp[0], 10), parseInt(pp[1], 10));
}
/* ---------- 少数民族节日：多历法换算 ---------- */
let _islamicFmt;
function initIslamicFmt() {
  if (_islamicFmt !== undefined) return _islamicFmt;
  try { _islamicFmt = new Intl.DateTimeFormat("zh-CN-u-ca-islamic", { month: "numeric", day: "numeric", timeZone: "UTC" }); }
  catch (e) { _islamicFmt = false; }
  return _islamicFmt;
}
function lunarSolarMap(year) {
  const map = {};
  if (!initLunarFmt()) return map;
  const n = isLeap(year) ? 366 : 365;
  const start = Date.UTC(year, 0, 1);
  for (let i = 0; i < n; i++) {
    const dt = new Date(start + i * 86400000);
    const lun = solarToLunar(dt);
    if (lun && !lun.isLeap) { const k = lun.m + "." + lun.d; if (!map[k]) map[k] = (dt.getUTCMonth() + 1) + "." + dt.getUTCDate(); }
  }
  return map;
}
function islamicSolarMap(year) {
  const map = {};
  const n = isLeap(year) ? 366 : 365;
  const start = Date.UTC(year, 0, 1);
  for (let i = 0; i < n; i++) {
    const dt = new Date(start + i * 86400000);
    const h = jdnToHijri(gregToJdn(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()));
    const k = h.m + "." + h.d;
    if (!map[k]) map[k] = (dt.getUTCMonth() + 1) + "." + dt.getUTCDate();
  }
  return map;
}
function ethGroupDb(year, groups) {
  const byDay = {};
  const lmap = lunarSolarMap(year);
  const imap = islamicSolarMap(year);
  groups.forEach(function (g) {
    g.fests.forEach(function (f) {
      const name = f[0], md = f[1], t = f[2], desc = f[3];
      let sk = null;
      if (t === "s") sk = md;
      else if (t === "l") sk = lmap[md];
      else if (t === "i") sk = imap[md];
      else if (t === "d") { if (md === "ny") { const gg = jdnToGreg(daiNewYearJdn(year - 638)); sk = gg.m + "." + gg.d; } else { const pp = md.split("."); const lm = ((parseInt(pp[0], 10) + 9) % 12) || 12; sk = lmap[lm + "." + pp[1]]; } }
      if (!sk) return;
      if (!byDay[sk]) byDay[sk] = { names: [], fests: [] };
      byDay[sk].names.push(g.name);
      byDay[sk].fests.push(name + "（" + g.name + "）｜" + desc);
    });
  });
  const out = {};
  for (const sk in byDay) out[sk] = [{ year: byDay[sk].names.join("·"), text: byDay[sk].fests.join("；"), link: "" }];
  return out;
}
function assembleIcs(evs, prodId, calName, calDesc) {
  const C = String.fromCharCode(13, 10);
  return "BEGIN:VCALENDAR" + C + "VERSION:2.0" + C + "PRODID:-//" + prodId + "//CN" + C + "CALSCALE:GREGORIAN" + C + "METHOD:PUBLISH" + C + "X-WR-CALNAME:" + calName + C + "X-WR-CALDESC:" + calDesc + C + evs.join(C) + C + "END:VCALENDAR";
}
function downloadIcs(ics, filename) {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
function ethDateLabel(f) {
  const md = f[1], t = f[2];
  if (t === "x") return md;
  if (t === "d") return md === "ny" ? "傣历新年" : ("傣历" + md.replace(".", "月") + "日");
  if (t === "h") return "伊斯兰历" + md.replace(".", "月") + "日";
  const p = md.split(".");
  const pre = t === "l" ? "农历" : (t === "i" ? "伊斯兰历" : "公历");
  return pre + p[0] + "月" + p[1] + "日";
}
function setEthStats(msg) { const box = document.getElementById("ethGenStats"); if (box) box.textContent = msg; }
function renderEthList() {
  const box = document.getElementById("ethList");
  if (!box) return;
  const se = document.getElementById("ethSearch");
  const q = (se && se.value ? se.value : "").trim().toLowerCase();
  const list = ETHNIC_GROUPS.filter(function (g) {
    if (!q) return true;
    if (g.name.toLowerCase().indexOf(q) >= 0) return true;
    if ((g.area || "").toLowerCase().indexOf(q) >= 0) return true;
    return g.fests.some(function (f) { return (f[0] + f[3]).toLowerCase().indexOf(q) >= 0; });
  });
  if (!list.length) { box.innerHTML = `<div class="know-empty">没有匹配的民族或节日，换个关键词试试</div>`; return; }
  box.innerHTML = list.map(function (g) {
    const idx = ETHNIC_GROUPS.indexOf(g);
    const rows = g.fests.map(function (f) {
      return `<div class="eth-fest"><span class="eth-fest-name">${f[0]}</span><span class="eth-fest-date">${ethDateLabel(f)}</span><div class="eth-fest-desc">${f[3]}</div></div>`;
    }).join("");
    return `<details class="eth-card"><summary><span class="eth-emoji">${g.emoji}</span><span class="eth-name">${g.name}</span><span class="eth-area">${g.area || ""}</span><span class="eth-count">${g.fests.length}个节日</span></summary><div class="eth-fests">${rows}</div><button class="btn-primary btn-sm" style="margin:8px 12px 12px;" onclick="generateEthICS(${idx})">📥 生成该民族节日ICS</button></details>`;
  }).join("");
}
function generateEthICS(idx) {
  const g = ETHNIC_GROUPS[idx];
  if (!g) return;
  const eb = document.getElementById("ethGenYear");
  const year = parseInt(eb && eb.value) || new Date().getFullYear();
  const db = ethGroupDb(year, [g]);
  const cnt = Object.keys(db).length;
  if (!cnt) { setEthStats("⚠️ 无法换算「" + g.name + "」的节日日期"); return; }
  setEthStats("生成中...");
  const d = Object.assign({}, db); d.themeKey = "ethnic";
  const evs = buildEvents(year, d, "🎎", true);
  downloadIcs(assembleIcs(evs, "EthnicICS", g.name + "传统节日", g.name + "传统节日提醒"), g.name + "_" + year + ".ics");
  addSub(g.name + "传统节日", year, evs.length);
  setEthStats("✅ 已生成「" + g.name + "」" + evs.length + " 条节日（" + year + "年）");
  showToast("✅ 已生成「" + g.name + "」ICS");
}
function generateEthAllICS() {
  const eb = document.getElementById("ethGenYear");
  const year = parseInt(eb && eb.value) || new Date().getFullYear();
  const db = ethGroupDb(year, ETHNIC_GROUPS);
  const cnt = Object.keys(db).length;
  if (!cnt) { setEthStats("⚠️ 无法换算节日日期"); return; }
  setEthStats("生成中...");
  const d = Object.assign({}, db); d.themeKey = "ethnic";
  const evs = buildEvents(year, d, "🎎", true);
  downloadIcs(assembleIcs(evs, "EthnicICS", "少数民族传统节日", "中国55个少数民族传统节日"), "少数民族传统节日_" + year + ".ics");
  addSub("少数民族传统节日", year, evs.length);
  setEthStats("✅ 已生成全部民族节日 " + evs.length + " 条（" + year + "年）");
  showToast("✅ 已生成「少数民族传统节日」ICS");
}
/* 生成指定年、指定主题库的所有VEVENT，返回字符串数组 */
function buildEvents(year, db, emoji, onlyWithContent) {
  const daysInMonth = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const evs = [];
  let uidBase = Date.now();
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const themeFillers = {
    world: '今天在历史上是平静的一天',
    science: '今天科学史上暂无特别发现',
    astronomy: '今天暂无特别天象',
    art: '今天艺术史上暂无特别事件',
    literature: '今天文学史上暂无特别作品',
    computer: '今天计算机史上暂无特别事件',
    music: '今天音乐史上暂无特别事件',
    medicine: '今天医学史上暂无特别进展',
  };
  const fillerText = db.themeKey === "festival" ? "今天暂无传统节日" : (themeFillers[db.themeKey] || themeFillers.world);

  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= daysInMonth[m - 1]; d++) {
      const key = `${m}.${d}`;
      const events = db[key];
      let selected;
      if (events && events.length > 0) {
        selected = events[0];
      } else if (onlyWithContent) {
        continue;
      } else {
        selected = { year: "—", text: fillerText };
      }
      const dateStr = `${year}${pad2(m)}${pad2(d)}`;
      const title = `${emoji} ${selected.year} · ${selected.text.slice(0, 45)}`;
      const link = getEventLink(selected);
      let ev = 'BEGIN:VEVENT\r\n';
      ev += `UID:${uidBase++}@${db.themeKey}.local\r\n`;
      ev += `DTSTAMP:${dtstamp}\r\n`;
      ev += `DTSTART;TZID=Asia/Shanghai:${dateStr}T120000\r\n`;
      ev += `SUMMARY:${escapeForICS(title)}\r\n`;
      ev += `URL:${link}\r\n`;
      ev += `DESCRIPTION:${emoji} ${selected.year} - ${escapeForICS(selected.text)}\\n\\n🔗 ${link}\r\n`;
      ev += 'BEGIN:VALARM\r\n';
      ev += 'TRIGGER:-PT0S\r\n';
      ev += 'ACTION:DISPLAY\r\n';
      ev += `DESCRIPTION:${escapeForICS(title)}\r\n`;
      ev += 'END:VALARM\r\n';
      ev += 'END:VEVENT';
      evs.push(ev);
    }
  }
  return evs;
}

/* ---------- 生成结果提示 ---------- */
/* statsId：把进度写到哪个统计栏（histGenStats / themeGenStats）。
   元素不存在时静默跳过，绝不能让提示写法中断后面的生成+下载流程。 */
function setGenStats(statsId, msg) {
  const box = document.getElementById(statsId) || document.querySelector('.know-gen-stats');
  if (box) box.textContent = msg;
}

/* 生成完整ICS并触发下载 */
function generateICS(year, themeKey, themeName, emoji, statsId) {
  const stat = statsId || 'themeGenStats';
  setGenStats(stat, '生成中...');

  const dbObj = themeKey === "festival" ? buildLunarFestivalDB(year) : (THEME_DATABASES[themeKey] || HIST_EVENTS_DB);
  // 包一层，带 themeKey 方便 fillter / UID 使用
  const db = Object.assign({}, dbObj);
  db.themeKey = themeKey;

  const evs = buildEvents(year, db, emoji, themeKey === "festival" && Object.keys(dbObj).length > 0);
  const ics =
    'BEGIN:VCALENDAR\r\n' +
    'VERSION:2.0\r\n' +
    `PRODID:-//HistoryICS//${themeKey}//CN\r\n` +
    'CALSCALE:GREGORIAN\r\n' +
    'METHOD:PUBLISH\r\n' +
    'X-WR-CALNAME:' + themeName + '\r\n' +
    'X-WR-CALDESC:' + themeName + ' 每日知识提醒\r\n' +
    evs.join('\r\n') + '\r\n' +
    'END:VCALENDAR';

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${themeName}_${year}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  addSub(themeName, year, evs.length);
  const filled = evs.length; // 实际全部生成（含filler在库内处理）
  setGenStats(stat, `✅ 已生成「${themeName}」${filled} 条（${year}年），中午12:00提醒，含百科链接。`);
  showToast(`✅ 已生成「${themeName}」ICS`);
}

/* ---------- 主题元数据 ---------- */
const THEME_META = {
  world:      { name: '世界历史', emoji: '📜', desc: '通用历史大事件' },
  science:    { name: '科学史',   emoji: '🔬', desc: '重大发现与发明' },
  astronomy:  { name: '天文日历', emoji: '🔭', desc: '天象与航天里程碑' },
  computer:   { name: '计算机史', emoji: '💻', desc: '技术里程碑' },
  art:        { name: '艺术史',   emoji: '🎨', desc: '名作与艺术家' },
  literature: { name: '文学日历', emoji: '📖', desc: '作家与作品' },
  music:      { name: '音乐史',   emoji: '🎵', desc: '作曲家与首演' },
  medicine:   { name: "医学史",   emoji: "🧬", desc: "医学突破" },
  festival:   { name: "农历节日", emoji: "🏮", desc: "春节、端午、中秋等传统节日" },
};

/* ---------- Tab切换 ---------- */
let currentTheme = 'world';

function switchKnowTab(tab, el) {
  document.querySelectorAll('.know-sub-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['hist', 'theme', 'subs'].forEach(n => {
    document.getElementById('know-' + n).classList.toggle('active', n === tab);
  });
  if (tab === 'subs') renderSubs();
}

function selectTheme(card) {
  document.querySelectorAll('.know-theme-card').forEach(c => c.classList.remove('active'));
  card.classList.add('active');
  currentTheme = card.dataset.theme;
}

function applyPreset(name) {
  const presets = {
    student: ['science', 'literature', 'astronomy'],
    tech:    ['computer', 'science', 'astronomy'],
    liberal: ['art', 'literature', 'music'],
    med:     ["medicine", "science", "astronomy"],
    festival: ["festival"],
  };
  const themes = presets[name] || [];
  const year = document.getElementById('themeGenYear').value || new Date().getFullYear();
  themes.forEach((theme, idx) => {
    setTimeout(() => {
      const card = document.querySelector(`.know-theme-card[data-theme="${theme}"]`);
      if (card) {
        selectTheme(card);
        const meta = THEME_META[theme];
        generateICS(parseInt(year), theme, meta.name, meta.emoji, 'themeGenStats');
      }
    }, idx * 600);
  });
  showToast(`将依次生成${themes.length}个主题ICS`);
}

/* ---------- 历史上的今天：全年生成 ---------- */
function generateHistYearICS() {
  const year = parseInt(document.getElementById('histGenYear').value) || new Date().getFullYear();
  generateICS(year, 'world', '历史上的今天', '📜', 'histGenStats');
}

/* ---------- 学科知识日历生成 ---------- */
function generateThemeICS() {
  const year = parseInt(document.getElementById('themeGenYear').value) || new Date().getFullYear();
  const meta = THEME_META[currentTheme] || THEME_META.world;
  generateICS(year, currentTheme, meta.name, meta.emoji, 'themeGenStats');
}

/* ---------- 我的订阅（localStorage） ---------- */
function addSub(name, year, count) {
  let subs = [];
  try { subs = JSON.parse(localStorage.getItem('knowSubs') || '[]'); } catch (e) {}
  subs.unshift({ name, year, count, date: new Date().toLocaleString('zh-CN') });
  if (subs.length > 20) subs = subs.slice(0, 20);
  /* 某些环境（file:// 打开、隐私模式）写 localStorage 会抛错，不能让它影响生成结果提示 */
  try { localStorage.setItem('knowSubs', JSON.stringify(subs)); } catch (e) {}
}

function renderSubs() {
  const list = document.getElementById('subsList');
  let subs = [];
  try { subs = JSON.parse(localStorage.getItem('knowSubs') || '[]'); } catch (e) {}
  if (!subs.length) {
    list.innerHTML = '<div class="know-empty">还没有生成过ICS。去「历史上的今天」或「学科知识」生成一个吧！</div>';
    return;
  }
  list.innerHTML = subs.map((s, i) => `
    <div class="know-sub-card">
      <div class="know-sub-card-info">
        <div class="know-sub-card-name">${s.name}（${s.year}）</div>
        <div class="know-sub-card-meta">${s.count} 条事件 · 生成于 ${s.date}</div>
      </div>
      <div class="know-sub-card-actions">
        <button class="btn-secondary btn-sm" onclick="removeSub(${i})">删除</button>
      </div>
    </div>`).join('');
}

function removeSub(idx) {
  let subs = [];
  try { subs = JSON.parse(localStorage.getItem('knowSubs') || '[]'); } catch (e) {}
  subs.splice(idx, 1);
  localStorage.setItem('knowSubs', JSON.stringify(subs));
  renderSubs();
}

function clearSubs() {
  if (confirm('确定清空所有记录？已下载的ICS文件不会删除。')) {
    localStorage.removeItem('knowSubs');
    renderSubs();
  }
}

/* ---------- 按日期浏览（Byabbe / 维基） ---------- */
const KNOW_HIST_CACHE = {};
function initKnowHistDate() {
  const d = document.getElementById('knowHistDate');
  if (!d.value) {
    const n = new Date();
    d.value = `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`;
  }
}
function knowHistMD() {
  const v = document.getElementById('knowHistDate').value;
  let m, d;
  if (v) { [_, m, d] = v.split('-'); }
  else { const n = new Date(); m = pad2(n.getMonth() + 1); d = pad2(n.getDate()); }
  return { m: String(+m), d: String(+d), m0: m, d0: d };
}
function typeLabel(t) {
  return { events: '事件', births: '出生', deaths: '逝世' }[t] || t;
}
function stripHtml(s) { const d = document.createElement('div'); d.innerHTML = s; return d.textContent || ''; }

async function loadKnowHist() {
  initKnowHistDate();
  const box = document.getElementById('knowHistResult');
  const src = document.getElementById('knowHistSource').value;
  const typ = document.getElementById('knowHistType').value;
  const { m, d, m0, d0 } = knowHistMD();
  box.innerHTML = '<div class="know-empty">加载中…</div>';
  try {
    let items = [];
    if (src === 'byabbe') {
      const types = typ === 'all' ? ['events', 'births', 'deaths'] : [typ];
      for (const t of types) {
        const k = `byabbe-${m}-${d}-${t}`;
        let arr = KNOW_HIST_CACHE[k];
        if (!arr) {
          const r = await fetch(`https://byabbe.se/on-this-day/${m}/${d}/${t}.json`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = await r.json();
          arr = (j[t] || []).map(x => ({ year: x.year, text: x.description, type: t, link: '' }));
          KNOW_HIST_CACHE[k] = arr;
        }
        items = items.concat(arr);
      }
    } else if (src === 'zhwiki') {
      const types = typ === 'all' ? ['events', 'births', 'deaths'] : [typ];
      for (const tt of types) {
        try {
          const r = await fetch(`https://zh.wikipedia.org/api/rest_v1/feed/onthisday/${tt}/${m0}/${d0}`);
          if (!r.ok) continue;
          const j = await r.json();
          (j[tt] || []).forEach(x => items.push({
            year: x.year, text: x.text || '', type: tt,
            link: (x.pages && x.pages[0] && x.pages[0].content_urls?.desktop?.page) || '',
          }));
        } catch (e) {}
      }
    }
    if (!items.length) { box.innerHTML = '<div class="know-empty">这天没抓到内容，换来源或类型试试</div>'; return; }
    items.sort((a, b) => String(a.year).localeCompare(String(b.year)));
    box.innerHTML = items.slice(0, 30).map(it => `
      <div class="nav-card">
        <div class="nav-card-header"><div class="nav-card-title">${it.year} ｜ ${typeLabel(it.type)}</div></div>
        <div class="nav-card-note">${escapeHtml(it.text || '')}</div>
        <div class="nav-card-actions">
          ${it.link ? `<a class="btn-secondary btn-sm" href="${it.link}" target="_blank" rel="noopener">🔗 维基</a>` : ''}
          <button class="btn-primary btn-sm" onclick="addHistToExcel('${encodeURIComponent(it.year + ' ' + stripHtml(it.text || '').slice(0, 80))}')">＋加入日程</button>
        </div>
      </div>`).join('');
  } catch (e) {
    box.innerHTML = `<div class="result error">加载失败：${e.message}</div>`;
  }
}

function randomKnowHist() {
  const box = document.getElementById('knowHistResult');
  const cards = box.querySelectorAll('.nav-card');
  if (!cards.length) { loadKnowHist().then(randomKnowHist); return; }
  cards.forEach(c => c.style.outline = '');
  const i = Math.floor(Math.random() * cards.length);
  cards[i].style.outline = '2px solid #7b1fa2';
  cards[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function addHistToExcel(enc) {
  const txt = decodeURIComponent(enc);
  const { m, d } = knowHistMD();
  const y = new Date().getFullYear();
  if (!window._histPending) window._histPending = [];
  window._histPending.push({
    标题: '历史上的今天：' + txt.slice(0, 50),
    日期: `${y}-${pad2(m)}-${pad2(d)}`,
    时间: '12:00', 地点: '', 备注: txt,
  });
  if (typeof updatePendingBar === 'function') updatePendingBar();
  if (typeof switchMainTab === 'function') switchMainTab('excel');
}

/* ---------- 通用提示 ---------- */
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 页面初始化 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initKnowHistDate();
  renderSubs();
});
