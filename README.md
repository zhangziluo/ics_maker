# 日历 ICS 工具箱（ics_maker）

纯前端（单文件 `index.html`，无需服务器/后端）的日历与 ICS 工具集，所有数据处理都在浏览器本地完成。

> 唯一的**可选**后端是 `functions/api/rss-proxy.js`（Cloudflare Pages Function），仅用于 RSS 抓取时绕过跨域；**不部署也能用**，详见下文「📡 RSS转ICS → 跨域与代理」。

## 功能

- **📊 Excel转ICS**：上传 Excel / CSV，按表头（标题/日期/时间/地点/备注）生成可导入手机或电脑日历的 `.ics`，支持设置提前提醒。
- **🧠 知识科普**：历史上的今天、学科知识、农历节日、55 个少数民族传统节日（含藏历、傣历、伊斯兰历等换算）、我的订阅。
- **🌐 赛程目录**：真实 ICS 源目录（分类浏览、复制链接、订阅、下载）、自定义源，以及「📝 粘贴生成 ICS」——网页内可编辑表格，粘贴即自动铺开。
- **📡 RSS转ICS**：输入 RSS / Atom 订阅地址，抓取文章列表预填进可编辑表格（标题/日期/时间/地点/描述/链接/提醒），改好后导出 `.ics`。预设少数派、阮一峰周刊、Hacker News、GitHub Releases；支持设置默认时长（30 分 / 1 小时 / 2 小时 / 全天）、时区与 UID 前缀。

## 目录结构（GitHub Pages）

```
ics_maker/
├── index.html          # 工具本体（单文件，含全部 CSS/JS）
├── README.md
├── LICENSE             # MIT
├── app.js / events.js  # （可选）模块化源码副本（index.html 未引用，可删）
├── functions/          # （可选）Cloudflare Pages Functions：RSS 跨域代理
│   └── api/rss-proxy.js   #   /api/rss-proxy?url=…
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
