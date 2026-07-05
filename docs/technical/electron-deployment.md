# Electron 部署、远程 UI 与动态配置

本文面向已经了解主进程、渲染进程、preload 和 IPC 的读者。第一次接触 Electron 时，请先阅读 [Electron 基础与工程边界](electron-basics.md)。

## 适用目标

本方案用于同时满足以下需求：

- Electron 安装包保留可离线启动的内置 UI。
- Web UI 可以独立部署和更新，不必每次发布桌面安装包。
- 后端 API 地址可以由远程配置动态切换。
- SDK、模型或其他大型运行时可以使用独立静态文件服务器。
- 远程内容不能直接获得 Node.js 或系统权限。

Web 更新、后端切换和 Electron 主进程升级应分开治理。远程 Web 适合更新界面和普通业务逻辑；主进程、preload、原生模块和系统权限相关逻辑仍应通过签名后的桌面版本发布。

## 推荐架构

```text
Electron 安装包
├── 主进程与最小 preload
├── 内置 UI（离线和故障兜底）
├── 内置 runtime-config.json
└── 已签名的应用版本

稳定配置服务 CONFIG_SERVER
└── 返回 UI、API、运行时下载地址和策略

Web 静态服务器 / CDN
└── 独立部署 UI_SERVER

业务后端
└── 动态配置 API_SERVER

运行时文件服务器 / CDN
└── RUNTIME_DOWNLOAD_BASE_URL
```

配置服务应使用稳定域名。若业务后端地址本身需要动态更新，不要再依赖业务后端返回自己的替代地址，否则旧后端不可用时客户端无法发现新地址。可使用独立配置服务、稳定 DNS 域名或受控的服务发现入口。

## 配置模型

建议区分以下变量：

```dotenv
# 稳定配置入口，通常随桌面包发布
CONFIG_SERVER=https://config.example.com/desktop/

# 远程 Web UI；为空时使用包内 UI
UI_SERVER=https://app.example.com/

# 业务后端
API_SERVER=https://api.example.com/

# 外置 SDK 或大型运行时
RUNTIME_DOWNLOAD_BASE_URL=https://cdn.example.com/desktop-runtimes/
```

打包时将默认值写入包内 `runtime-config.json`：

```json
{
  "environment": "production",
  "configServer": "https://config.example.com/desktop/",
  "uiServer": "https://app.example.com/",
  "apiServer": "https://api.example.com/",
  "runtimeDownloadBaseUrl": "https://cdn.example.com/desktop-runtimes/"
}
```

敏感密钥不能写入该文件。安装包内的配置可以被用户读取，只适合保存公开地址、版本和非敏感策略。

## 配置优先级

推荐优先级由高到低为：

1. 企业管理策略或命令行参数。
2. 系统环境变量、用户数据目录中的本地覆盖配置。
3. 远程配置服务返回的有效配置。
4. 最近一次验证成功的远程配置缓存。
5. 安装包内置配置。
6. 应用代码中的安全默认值。

本地覆盖便于私有部署和排障；远程配置便于切换服务；缓存和内置配置保证配置服务故障时仍能启动。

远程配置示例：

```json
{
  "schemaVersion": 1,
  "environment": "production",
  "uiServer": "https://app.example.com/releases/stable/",
  "apiServer": "https://api.example.com/",
  "runtimeDownloadBaseUrl": "https://cdn.example.com/desktop-runtimes/",
  "expiresAt": "2026-12-31T00:00:00Z"
}
```

客户端必须校验字段类型、URL 协议、允许的域名和配置过期时间。高安全场景应对配置内容签名，并在客户端内置公钥验证；HTTPS 不能替代配置签名对误配置和源站泄露的防护。

## 远程 UI 动态更新

### 部署方式

Web UI 使用普通静态站点或 CDN 独立部署。Production 打包时可以指定默认地址：

```bash
UI_SERVER=https://app.example.com/ npm run dist
```

主进程启动时：

1. 解析配置优先级，获得候选 `uiServer`。
2. 检查是否为允许的 HTTPS 来源。
3. 尝试加载远程 UI，并设置短超时。
4. 加载失败、证书错误或版本不兼容时回退包内 `index.html`。
5. 记录本次来源，供诊断页面展示。

不要在应用启动时先下载 Web 文件再覆盖安装目录。直接从版本化 CDN 加载，或下载到用户数据目录并做签名校验；应用安装目录可能只读且会被升级覆盖。

### 缓存与版本发布

推荐使用不可变版本目录：

```text
/releases/2026.07.05/index.html
/releases/2026.07.05/assets/app.<hash>.js
/releases/2026.07.05/assets/app.<hash>.css
/channels/stable.json
```

静态资源文件名带内容哈希并设置长期缓存；HTML 和 channel 文件使用短缓存或 `no-cache`。发布过程先上传完整版本，再原子更新 channel 指针，避免用户加载到一半新、一半旧的资源。

保留最近若干版本，出现问题时只需回滚 channel 指针。不要覆盖已经发布的版本目录。

### 兼容性约束

远程 UI 可能比桌面主进程更新，因此 preload API 必须版本化：

```js
window.desktop.getCapabilities()
// { apiVersion: 2, features: ['runtime-status', 'open-directory'] }
```

Web UI 应按 capability 渐进启用功能，不能假设所有已安装客户端都具有最新 IPC。远程配置可以声明 UI 所需的最低桌面版本；不满足时加载兼容 UI 或提示升级桌面应用。

## 远程 UI 安全边界

加载远程页面的 BrowserWindow 必须使用：

```js
new BrowserWindow({
  webPreferences: {
    preload,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true
  }
})
```

还必须落实：

- preload 只暴露明确、最小、可校验的 API，不暴露 `ipcRenderer`、文件系统或任意命令执行。
- 每个 IPC handler 校验调用来源、参数类型、长度、枚举值和文件路径范围。
- 仅允许配置白名单中的 HTTPS origin；禁止任意 URL、`javascript:` 和不受控重定向。
- 使用严格 CSP，限制脚本、连接、frame 和资源来源。
- 拒绝意外导航；外部链接交给系统浏览器并限制协议。
- 默认拒绝新窗口、权限请求、媒体采集和设备访问，按业务逐项开放。
- 不忽略证书错误，不在生产环境关闭 `webSecurity`。
- 对远程内容与高权限本地页面使用不同 BrowserWindow 和不同 preload。

远程 UI 本质上是可快速变化的代码。只要它能调用高权限 preload，Web 发布权限就等同于部分桌面代码发布权限。因此 Web CI/CD 也需要代码审查、制品留档、来源保护和快速回滚。

## 后端地址动态更新

推荐由稳定配置服务下发 `apiServer`，客户端将其用于所有后端请求。流程如下：

```text
启动
  -> 读取本地覆盖
  -> 请求 CONFIG_SERVER
  -> 校验并缓存配置
  -> 初始化 API Client
  -> 请求业务后端
```

API Client 应集中管理 base URL，不要在 React 组件、主进程 handler 或多个模块中分别读取环境变量。地址变化时通过单一配置对象重建客户端。

需要考虑：

- 配置请求设置 3–5 秒超时，不能无限阻塞窗口创建。
- 仅在完整校验后覆盖上次成功配置。
- 缓存使用临时文件加原子重命名，防止进程退出造成半写入。
- API 切换过程中停止或完成旧地址上的请求，不把同一事务拆到两个后端。
- 不自动把认证令牌发送给不在允许列表中的新域名。
- 后端地址变化后重新评估 CORS、证书固定、代理和登录会话范围。

如果配置服务和业务后端使用同一个域名，应至少通过稳定 DNS 或网关保证入口不随后端集群变化。

## 启动流程

推荐完整启动顺序：

```text
app.whenReady()
  -> 读取包内配置和本地覆盖
  -> 创建窗口并加载内置启动页
  -> 并行获取远程配置、检查运行时、恢复用户状态
  -> 校验 UI_SERVER 与 API_SERVER
  -> 加载远程 UI；失败则加载内置 UI
  -> 后台安装缺失运行时
  -> 向 UI 推送配置与运行时状态
```

窗口应尽快可见。远程配置、远程 UI 和大型运行时下载都不能让用户长时间面对空白窗口。

## Electron 更新与 Web 更新的边界

必须通过 Electron 安装包更新的内容：

- 主进程代码
- preload 与 IPC 权限边界
- Electron/Node.js 版本
- 原生模块和代码签名权限
- 自动更新器、安全修复和系统集成

可以通过远程 Web 更新的内容：

- 页面布局与样式
- 普通业务交互
- 使用已有 preload capability 的功能
- 后端接口驱动的内容和开关

若 Web 新功能需要新增系统能力，应先发布兼容的桌面版本，覆盖率达到要求后再开启远程 UI 功能。

## 发布与回滚

建议将发布拆为三个独立通道：

1. Electron 通道：签名安装包、自动更新、分阶段发布。
2. Web 通道：不可变制品、stable/beta channel、快速回滚。
3. 配置通道：审核后的地址和开关变更、版本记录、过期时间。

每次配置变更应记录操作人、时间、旧值、新值和回滚目标。配置服务不应提供未经审核的任意 URL 输入。

## 可观测性

诊断信息至少包含：

- 当前桌面版本和平台
- 当前 UI 来源、UI 版本及是否使用内置回退
- 当前 API host，不记录 token 和完整敏感 URL
- 配置来源：本地、远程、缓存或包内
- 配置获取耗时和失败类型
- 运行时版本、安装状态和下载来源

日志必须脱敏。用户可复制诊断摘要，但不应暴露 API key、认证头、签名 URL 查询参数或本地敏感路径。

## 验收清单

- 无网络时能够加载内置 UI，并给出可理解的离线状态。
- 远程 UI 404、超时、证书失败时自动回退内置 UI。
- 配置服务不可用时使用缓存或包内配置。
- 远程配置中的非法协议和非白名单域名被拒绝。
- Web UI 无法访问 Node.js、任意 IPC、任意文件或命令执行。
- preload API 有版本和 capability 协商。
- Web 版本可以原子发布并在数分钟内回滚。
- API 地址切换不会把令牌发送到未授权域名。
- Electron 主进程安全更新仍能通过签名安装包发布。
- 日志和诊断信息不包含密钥或签名下载 URL。

## 常见反模式

- 将 `nodeIntegration` 打开给远程页面。
- 把完整 `ipcRenderer` 暴露到 `window`。
- 远程配置返回任意 URL 后不校验直接加载。
- 只部署远程 UI，不保留包内故障页或兼容 UI。
- 让业务后端负责发现业务后端的新地址，形成启动死锁。
- 使用远程 Web 更新主进程权限逻辑。
- 覆盖 CDN 上的已有版本文件，导致缓存内容不可预测。
- 将 API key、更新签名私钥或长期下载凭证写入构建环境并打进客户端。
