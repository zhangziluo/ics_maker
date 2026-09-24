# 日历 ICS 工具箱（ics_maker）

纯前端（单文件 `index.html`，无需服务器/后端）的日历与 ICS 工具集，所有数据处理都在浏览器本地完成。

> 唯一的**可选**后端是 Cloudflare Pages Functions（`functions/api/`）：`rss-proxy` 用于 RSS 跨域抓取，`rss-to-ics` 用于 webcal 订阅。**不部署也能用**（RSS 会自动降级为直连），详见「📡 RSS转ICS」。

## 功能

- **📊 Excel转ICS**：上传 Excel / CSV，按表头（标题/日期/时间/地点/备注）生成可导入手机或电脑日历的 `.ics`，支持设置提前提醒。**也支持「📝 直接粘贴 / 手填」的可编辑表格**（从 Excel / 网页复制即自动铺开），没文件也能直接用；在「知识科普」里收藏的条目可在「📋 待加入日程」一键「➡️ 填入粘贴表格」。
- **🧠 知识科普**：历史上的今天、学科知识、农历节日、55 个少数民族传统节日（含藏历、傣历、伊斯兰历等换算）、我的订阅。
- **🌐 赛程目录**：真实 ICS 源目录（分类浏览、复制链接、订阅、下载）、自定义源，以及「📝 粘贴生成 ICS」——网页内可编辑表格，粘贴即自动铺开。该表格与「📊 Excel转ICS → 📝 直接粘贴 / 手填」是**同一份数据**，两个 Tab 在哪边填都一样。
- **📡 RSS转ICS**：输入 RSS / Atom 订阅地址，抓取文章列表预填进可编辑表格（标题/日期/时间/地点/描述/链接/提醒），改好后导出 `.ics`；也可一键生成 **webcal / https 订阅链接**，让日历 App 长期自动刷新。预设少数派、阮一峰周刊、Hacker News、GitHub Releases；支持设置默认时长（30 分 / 1 小时 / 2 小时 / 全天）、时区与 UID 前缀。

## 目录结构（GitHub Pages）

```
ics_maker/
├── index.html          # 工具本体（单文件，含全部 CSS/JS）
├── README.md
├── LICENSE             # MIT
├── app.js / events.js  # （可选）模块化源码副本（index.html 未引用，可删）
├── functions/              # （可选）Cloudflare Pages Functions
│   └── api/
│       ├── rss-proxy.js       # /api/rss-proxy?url=…              跨域抓取订阅源
│       └── rss-to-ics.js      # /api/rss-to-ics?url=…&tz=…         订阅端点（feed → .ics）
└── ics/                # 自托管日历数据（供目录一键下载）
    ├── china-holidays.ics
    └── gaokao.ics
```

## 部署与使用

1. **本地用**：下载 `index.html`，浏览器打开即可（离线可用，SheetJS 走 CDN）。
2. **GitHub Pages**：Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`。
   - 工具：`https://zhangziluo.github.io/ics_maker/`
   - 数据：`https://zhangziluo.github.io/ics_maker/ics/china-holidays.ics`

## 📡 RSS转ICS

把任意 RSS / Atom 订阅（博客、播客、赛事新闻…）的文章列表抓下来 → 预填进可编辑表格 → 修改后一键导出 `.ics`。

- 支持 **RSS 2.0** 与 **Atom 1.0**；解析后前 10 条做只读预览（带勾选框），可「全部加入表格」或「逐条选择加入」。
- 预设源：少数派、阮一峰周刊、Hacker News、GitHub Releases（也可粘贴任意订阅地址）。
- 可编辑表格 7 列：标题 / 日期 / 时间 / 地点 / 描述 / 链接 / 提醒(分)；可逐格修改、删除行、手动加行。
- 映射配置：标题模板（仅标题 / 标题 + 摘要前 20 字）、默认时长（30 分 / 1 小时 / 2 小时 / 全天）、时区覆盖、UID 前缀。
- 日期解析失败的行只在预览里标红提示，**不阻断其他行**；导出时统计跳过的行数与原因。
- **📚 我的订阅源（存在本机浏览器）**：把「地址 + 它自己的映射配置」（时区 / 时长 / 标题模板 / UID 前缀 / limit / remind / ev）整体存成一条；支持改名、一键载入回编辑器、复制该源订阅链接、单条 / 批量测试、导出 / 导入 JSON 备份。订阅链接与缓存预热都从列表**现拼**，不用再手拼。
- **支持 Event RSS 扩展**：条目带 `ev:startdate` 时就用它当**事件时间**（而不是发布时间）。另支持 `ev:enddate`（真实结束）、`ev:duration`、`ev:location` / `ev:city` / `ev:country`（→ 地点）、`ev:eventstatus`（canceled → `STATUS:CANCELLED`）；纯日期的 `ev:startdate` 视为**全天事件**。加 `ev=0` 可关掉。

### 跨域与代理（可选）

浏览器直接抓第三方 RSS 常被 **CORS** 拦。为此提供一个 **Cloudflare Pages Function**：

```
functions/api/rss-proxy.js   →   GET /api/rss-proxy?url=<encodeURIComponent(feedUrl)>
                                 → 200 { "xml": "<原始 XML>" }
```

前端策略是 **先试代理 → 失败自动直连**：

| 部署方式 | `/api/rss-proxy` | RSS 功能 |
| --- | --- | --- |
| **Cloudflare Pages**（支持 Functions） | 可用 | 任意源都能抓（由边缘函数代取，无跨域问题） |
| **GitHub Pages** / 本地双击打开 | 不存在（404） | 自动降级为浏览器直连，**仅对开放 CORS 的源有效**（如 Hacker News、GitHub `.atom`） |

> 结论：**不部署后端也能用**，只是遇到不开放 CORS 的源时，需要在支持 Functions 的平台部署，或改用「🌐 赛程目录 → 📝 粘贴生成 ICS」。
>
> 代理只做「取回并原样返回」，不解析、不存储、不记录；超时 10 秒，仅接受 `http(s)://` 目标。

### 订阅（webcal / https）

想让它**长期自动更新**，就用订阅而不是每次导出：

```
webcal://ics-maker.pages.dev/api/rss-to-ics?url=<feed>&tz=Asia%2FShanghai&dur=60&limit=50
https://ics-maker.pages.dev/api/rss-to-ics?url=<feed>&tz=Asia%2FShanghai&dur=60&limit=50
```

页面上的「📡 RSS转ICS → 🔗 订阅（webcal）」会按当前映射配置自动拼好这两条链接；可「📋 复制 https」或「🧪 测试链接」（先抓回来数一下事件条数，确认没问题再订阅）。

| 端 | 用哪条 |
| --- | --- |
| iPhone / iPad / macOS / Outlook | `webcal://…`（手机上点一下即可添加） |
| Google 日历（通过网址添加） | `https://…` |

**端点参数**（除 `url` 外都可省略；直接浏览器打开会返回 ICS，参数写错会返回带用法的纯文本说明）

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `url` | 必填 | RSS / Atom 订阅地址（需 encodeURIComponent） |
| `tz` | `Asia/Shanghai` | 时区；事件时间按该时区的**墙上时间**写入 `DTSTART;TZID=` |
| `dur` | `60` | 事件时长（分钟）；`allday` 或 `0` = 全天事件 |
| `remind` | `0` | 提前提醒分钟数；0 = 不加 `VALARM` |
| `limit` | `50`（上限 300） | 最多输出多少条 |
| `title` | `title` | 填 `summary` 则标题追加摘要前 20 字 |
| `uid` | `rss2ics` | UID 后缀 |
| `name` | 取订阅源标题 | 覆盖日历名称 |
| `ev` | `1` | `1` 优先用 Event RSS 的 `ev:startdate` 当事件时间；`0` 只用发布时间 |
| `fresh` | 空 | `1` = 跳过读边缘缓存、重新抓源站并刷新缓存（缓存预热用） |

响应头：`REFRESH-INTERVAL` / `X-PUBLISHED-TTL`（RFC 7986，告诉日历多久刷新一次）、`X-ICS-Cache`（`HIT` / `MISS` / `REFRESH`）、`X-ICS-Events` / `X-ICS-Skipped` / `X-ICS-Total` / `X-ICS-Ev-Items`（条数报告）、`X-Robots-Tag: noindex`。

> 缓存说明：函数响应上的 `Cache-Control` 头**不会**让 Cloudflare CDN 自动缓存，所以端点用 **Cache API（`caches.default`）** 真正缓存生成的 ICS，默认 15 分钟。日历 App 轮询时直接命中边缘缓存，不会反复打源站。

**注意**
- 订阅内容**从订阅源实时派生**，**不包含**页面上手工改的内容；要手工改就用「📥 导出 ICS」。
- 刷新时机由日历 App 决定（Apple 较勤，Google 约 12–24 小时），不是实时。
- 端点只接受 `http(s)`，并拒绝本机 / 内网地址（SSRF 防护）；无状态、不存储任何数据。
- 仅在 **Cloudflare Pages** 上可用；GitHub Pages 上「生成订阅链接」会提示改用导出或先部署。

### 我的订阅源（存在本机浏览器）

「📡 RSS转ICS → 📚 我的订阅源」把**订阅地址 + 它自己的映射配置**（时区 / 时长 / 标题模板 / UID 前缀 / limit / remind / ev）整体存成一条。列表每行：

- **📥 载入**：把该源的地址与配置一次性填回上面的编辑器，直接点「🔍 解析」即可。
- **📋 复制**：现拼该源的 https 订阅链接（要 `webcal://` 把开头换掉即可）。
- **🧪 测试**：立刻抓一次，报事件条数与缓存状态；也可用「🧪 测试全部」。
- **名称**：直接在列表里点着改。
- **⬆️ 导出备份 / ⬇️ 导入备份**：备份格式 `{ version, feeds: [...] }`；导入按 `url` 合并（同名以导入为准），换电脑 / 换浏览器用它恢复。

> 数据只存在本机 `localStorage`（key `rssFeeds`），不上传、不同步。旧版的「预热链接列表」（key `rssWarmUrls`）会在首次打开时**自动迁移**成订阅源（会解析出 url 与各项参数）。

### 缓存预热 / 定时刷新

日历 App 来取数据时如果边缘缓存是冷的，就得现抓源站（慢，还可能被限速）。两种「热上」的办法：

| 方式 | 怎么用 | 局限 |
| --- | --- | --- |
| 页面内预热 | 「⚡ 订阅预热 / 定时刷新 → ⚡ 全部预热」——预热「📚 我的订阅源」里的**全部**；也可勾「本页打开期间自动预热」（5/15/30/60 分钟） | 自动预热**只在标签页开着时**生效 |
| **定时刷新（推荐）** | 在「📚 我的订阅源」点「📋 复制定时预热清单」，把结果整段替换 `.github/warm-rss.json` 的内容；仓库里的 `.github/workflows/warm-rss.yml` 会每 2 小时按它自动打一次 | GitHub 的定时任务：**仓库 60 天无活动会被停用**，且高峰期会延迟 |

> **为什么不用 Cloudflare cron**：Pages 只支持 `onRequest` 系列处理器，**没有 cron / scheduled**（只有 Workers 有 Cron Triggers）。所以「定时」这一块交给 GitHub Actions，也可以随时在仓库 Actions 页面手动 Run workflow。
>
> 两条路都是给链接加 `fresh=1` 打一次：端点跳过读缓存 → 重新抓源站 → 把新结果写回缓存，日志里能看到 `x-ics-cache=REFRESH`。

## 自托管数据

「赛程目录 → 节假日 / 教育」中的**自托管**条目指向 `ics/` 目录（raw / jsDelivr 直连，CORS 开放，可一键下载）：

| 文件 | 说明 |
| --- | --- |
| `ics/china-holidays.ics` | 中国节假日 |
| `ics/gaokao.ics` | 高考时间 |

目录里带 🔁 的源是 **jsDelivr 镜像**：点它可复制镜像链接；点 ⬇️ 下载时若 raw 直连失败，会**自动改用 jsDelivr 镜像重试**。

- raw：`https://raw.githubusercontent.com/<user>/<repo>/<branch>/<path>`
- 镜像：`https://cdn.jsdelivr.net/gh/<user>/<repo>@<branch>/<path>`

## 内置源一览

| 分类 | 名称 | 来源 | 许可 |
| --- | --- | --- | --- |
| 节假日 | 中国法定节假日 · holiday-cn | NateScarlet/holiday-cn | MIT |
| 节假日 | 中国节假日调休 · lanceliao | lanceliao/china-holiday-calender | 无 LICENSE（仅外链） |
| 节假日 | 各国节假日（中/港/台/美/日/新） | officeholidays.com | 站点条款（外链） |
| 天文 | 中国农历 · 节气 · 传统节日 | infinet/lunar-calendar | BSD-2-Clause |
| 天文 | 月相 | webcal.fi | 站点条款（外链） |
| 体育 | 足球赛程 | fixtur.es | 站点条款（外链） |
| 节假日/教育 | 自托管 .ics | 本仓库 `ics/` | 见各来源 |

## 第三方资源与许可（Licenses and Attribution）

本项目在「赛程目录」中以**外链/订阅**方式引用第三方资源，或在许可允许时**转载**。请遵守各自条款：

| 来源 | 用途 | 许可 | 处理方式 |
| --- | --- | --- | --- |
| [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn) | 中国法定节假日 ICS（含调休/补班） | **MIT** | 可复制/改编/分发，须保留版权与许可证声明 |
| [infinet/lunar-calendar](https://github.com/infinet/lunar-calendar) | 农历 / 二十四节气 / 传统节日 ICS | **BSD-2-Clause** | 可复制/分发，须保留版权与许可声明 |
| [lanceliao/china-holiday-calender](https://github.com/lanceliao/china-holiday-calender) | 中国节假日调休 ICS | **无 LICENSE**（默认保留所有权利） | 仅外链订阅，请勿复制其文件进本仓库 |
| [Office Holidays](https://www.officeholidays.com/) | 多国节假日订阅 | 站点条款 | 仅外链订阅 |
| [WebCal.fi](https://www.webcal.fi/) | 月相与天文日历 | 站点条款 | 仅外链 |
| [Fixtur.es](https://fixtur.es/) | 足球赛程订阅 | 站点条款 | 仅外链 |
| [SheetJS xlsx](https://cdn.sheetjs.com/) | 浏览器端解析 Excel | **Apache-2.0** | 通过 CDN 引入 |

### 转载署名要求

若把第三方数据或 `.ics` 复制进本仓库，请保留其许可与版权声明：

```
MIT License - NateScarlet/holiday-cn
https://github.com/NateScarlet/holiday-cn

BSD 2-Clause License - infinet/lunar-calendar
https://github.com/infinet/lunar-calendar
```

> 说明：节假日、节气、农历等**日期属于事实性信息**，本身不受著作权保护；受保护的是代码与整理成果。稳妥起见，转载时保留署名与许可证即可。

## 许可

本仓库以 **MIT** 许可发布，见 `LICENSE` 文件。第三方资源的许可见上表。
