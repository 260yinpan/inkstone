<p align="center">
  <img src="./public/inkstone-logo.svg" width="112" height="112" alt="Inkstone 项目 Logo" />
</p>

<h1 align="center">Inkstone</h1>

<p align="center">
  一套用于写作、整理、同步和备份个人知识的自托管 Markdown 笔记应用。
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./CONTRIBUTING.md">参与开发</a> ·
  <a href="./LICENSE">LGPL-3.0-only</a> ·
  <a href="https://inkstone-demo.pages.dev/">在线体验</a>
</p>

## 项目简介

Inkstone 是运行在 Cloudflare workers的浏览器笔记本。笔记始终是普通 Markdown 文本；在此基础上，应用提供专注写作、实时预览、全文搜索、双链导航、离线编辑、多设备同步、公开分享和异地备份。

它是一套需要自行部署的完整应用，数据库、附件和运行环境都由部署者掌控。

每个新账号都会自动获得中文版和英文版两篇标准起始笔记。纯前端体验版复用同一份笔记内容，刷新页面后恢复为这两篇起始笔记，不会另外维护一套示例数据。


## 主要功能

| 范围 | 已实现能力 |
| --- | --- |
| 写作 | CodeMirror 6 编辑器、**实时预览**、编辑/分栏/预览布局、双向滚动、大纲、**专注模式**、**打字机模式**、**自动保存**、**版本历史** |
| Markdown | 表格、任务列表、脚注、定义列表、Callout、标签页、**折叠块**、**数学公式**、**Mermaid**、**代码高亮**、**Front Matter**、Pandoc 属性 |
| 整理 | 多级文件夹、正文标签、收藏、置顶、归档、回收站、**Wiki 双链**、反向链接、块引用、笔记嵌入、关系图谱 |
| 搜索 | 基于 D1 FTS5 的全**文搜索**、中文索引、条件筛选、最近笔记和命令面板 |
| **MCP** | 私有远程 MCP、OAuth 2.1 授权、标准 `search`/`fetch`、分段读取、安全写入、客户端授权管理 |
| 可靠性 | 可安装 PWA、离线启动、浏览器本地缓存、**离线写入队列、乐观并发控制**、冲突副本、实时通知和轮询降级 |
| 分享 | 可设置访问口令和有效期的公开笔记链接 |
| 可迁移性 | JSON 与 ZIP 导出、可直接阅读的 **Markdown**、附件导出、**手动或定时 WebDAV/S3 备份** |
| 界面 | **桌面与移动布局**、**深浅主题**、强调色、简体中文和英文 |

## 数据存放位置

| 组件 | 用途 |
| --- | --- |
| Cloudflare D1 | 账号、笔记、文件夹、标签、设置、版本、分享和搜索索引 |
| Cloudflare R2 或 Workers KV | 通过 `FILES` 或 `FILES_KV` 绑定存放附件及上传头像的二进制 |
| Workers KV `OAUTH_KV` | OAuth 客户端注册、授权码、访问令牌、刷新令牌和授权记录；不存放笔记正文 |
| 浏览器 IndexedDB | 本地缓存与尚未上传的离线写入 |
| `SyncHub` Durable Object | 在线客户端之间的实时变更通知 |
| `CredentialVault` Durable Object | 隔离保存用于加密备份凭据的密钥 |
| WebDAV 或 S3 存储 | 用户自行配置的异地备份 |

## 部署教程

1. Fork InKstone 仓库到自己的 GitHub 账号
2. 进入 [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create)
3. 选择 Continue with GitHub 并选择你的仓库
4. 使用 R2 时，构建命令填 `npm run build`，部署命令填 `npm run deploy`
- 如果你打算用 KV 模式，把部署命令改成 `npm run deploy:kv`
5. 等部署完成后，打开生成的 Workers 域名

## 导出与备份

- JSON 导出保留可重新导入的结构化笔记数据。
- ZIP 导出包含结构化数据、可读 Markdown、附件和清单。
- 远程备份支持 WebDAV 与 S3 兼容存储。
- 可以配置多个目标，并选择手动执行或定时运行。
- 登录密码、活动会话、分享口令和备份服务凭据不会进入导出文件。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地 Worker 和前端 |
| `npm run dev:kv` | 使用 KV 附件配置启动本地环境 |
| `npm run dev:demo` | 启动刷新即重置的纯前端体验版 |
| `npm run typecheck` | 执行 TypeScript 项目检查 |
| `npm run test:unit` | 运行 Vitest 单元测试 |
| `npm run i18n:check` | 检查中英文资源键是否完整一致 |
| `npm run comments:check` | 检查源码注释规范 |
| `npm run build` | 类型检查并生成生产构建 |
| `npm run deploy:kv` | 使用 `wrangler.kv.toml` 构建并部署 |
| `npm run deploy:demo` | 构建并部署纯静态体验版 |
| `npm run test:e2e` | 对正在运行的临时本地实例执行 API 端到端测试 |

端到端脚本会在 `http://localhost:7712` 创建、修改并删除数据，只能对专门用于测试的全新本地状态运行。

## 目录结构

```text
src/
├── client/   React 界面、编辑器、预览和本地状态
├── shared/   共享类型、限制、语言资源和 Markdown 工具
└── worker/   Hono API、认证、D1 访问、同步、分享和备份
public/       静态资源
scripts/      仓库检查与端到端验证脚本
tests/        跨模块回归测试
```

## 安全与参与开发

报告安全问题前请阅读 [`SECURITY.md`](./SECURITY.md)。开发环境和贡献要求见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 许可证

Inkstone 使用 [GNU Lesser General Public License v3.0 only](./LICENSE)，SPDX 标识为 `LGPL-3.0-only`。
