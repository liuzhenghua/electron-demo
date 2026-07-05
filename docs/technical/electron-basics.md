# Electron 基础与工程边界

## Electron 是什么

Electron 用 Web 技术开发桌面应用。它将 Chromium 浏览器和 Node.js 运行时一起打进应用，因此同一套代码可以构建 macOS、Windows 和 Linux 客户端。

可以把 Electron 应用理解为两部分：

- 桌面外壳：创建窗口、访问文件、启动子进程、显示系统菜单，由 Node.js 和 Electron API 驱动。
- Web 页面：负责界面和交互，通常由 React、Vue 或其他前端技术实现。

Electron 不是把普通网站直接转换成桌面程序。桌面权限、进程隔离、安装包、代码签名和升级流程仍需要单独设计。

## 核心进程

### 主进程

每个 Electron 应用只有一个主进程。它通常负责：

- 应用启动和退出
- 创建、销毁窗口
- 读取本地配置和用户数据
- 文件系统、系统菜单、通知和原生能力
- 管理后台任务、SDK 和子进程
- 注册 IPC handler，响应页面请求

主进程拥有较高系统权限，不应加载不可信业务代码，也不应直接执行页面传来的命令。

### 渲染进程

每个窗口通常对应一个渲染进程，运行方式接近浏览器页面。它负责：

- 页面布局和样式
- 用户输入与交互状态
- 调用后端 HTTP API
- 通过受控接口请求桌面能力

渲染进程应按照普通 Web 页面对待。默认不允许直接访问 Node.js、文件系统或任意 Electron API。

### preload

preload 在页面加载前运行，是主进程和渲染进程之间的安全桥梁。它使用 `contextBridge` 暴露少量明确的能力：

```js
contextBridge.exposeInMainWorld('desktop', {
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  openDirectory: () => ipcRenderer.invoke('files:openDirectory')
})
```

不要直接暴露 `ipcRenderer`、`require`、文件系统对象或“执行任意命令”接口。每个能力都应有明确名称、固定参数和有限权限。

## IPC 是什么

IPC 是进程间通信。页面无法直接调用主进程函数，需要通过消息请求：

```text
渲染进程
  -> preload 暴露的 desktop.openDirectory()
  -> ipcRenderer.invoke('files:openDirectory')
  -> 主进程 ipcMain.handle(...)
  -> 校验参数并执行
  -> 返回结果
```

常用模式：

- `invoke/handle`：一次请求对应一次响应，适合读取配置和执行短操作。
- `send/on`：单向事件，适合进度通知和流式输出。
- `MessagePort`：高频或长期双向通信，需要更复杂的生命周期管理。

主进程不能信任 IPC 参数。即使页面由自己开发，也需要校验类型、长度、枚举、URL 和文件路径。

## 一个典型工程

```text
project/
├── electron/
│   ├── main.cjs       # 主进程入口
│   └── preload.cjs    # 页面安全桥梁
├── src/               # Web UI
├── dist/              # Web 构建产物
├── package.json       # 依赖、脚本和桌面打包配置
└── release/           # 安装包或解包应用
```

开发环境通常由前端开发服务器提供页面；生产环境可以加载包内 `dist/index.html`，也可以加载经过安全约束的远程 Web UI。

## 应用启动流程

典型流程如下：

```text
启动可执行文件
  -> 主进程运行
  -> app.whenReady()
  -> 读取配置和用户数据
  -> 创建 BrowserWindow
  -> 注入 preload
  -> 加载本地或远程 UI
  -> 页面通过 IPC 使用桌面能力
```

耗时工作不应阻止窗口出现。远程配置、大文件下载和数据恢复可以在窗口创建后并行执行，并通过状态提示告知用户。

## 开发、构建与打包

三个概念容易混淆：

- 开发：启动前端热更新服务器和 Electron 进程，代码变化立即生效。
- 构建：将 React/Vue 等源码生成 HTML、CSS 和 JavaScript 静态文件。
- 打包：将 Electron、主进程、preload、Web 文件和生产依赖制作成桌面应用或安装包。

Electron 安装包通常较大，因为它包含 Chromium 和 Node.js。大型 SDK、模型或平台二进制还会继续增加体积，可以采用外置运行时方案。

## 常见文件位置

不要把运行数据写入应用安装目录。应用安装目录可能只读，升级时也可能被替换。配置、缓存和下载的运行时应放在：

```js
app.getPath('userData')
app.getPath('cache')
app.getPath('logs')
```

`userData` 的实际路径由应用名称和操作系统决定，常见位置为：

```text
macOS:   ~/Library/Application Support/<应用名>/
Windows: %APPDATA%\<应用名>\
Linux:   ~/.config/<应用名>/
```

## 三类更新

Electron 项目通常存在三种独立更新：

### 桌面应用更新

用于更新主进程、preload、Electron 版本、原生模块和系统权限。需要重新生成、签名并发布安装包，通常通过自动更新器分发。

### Web UI 更新

如果窗口加载远程 Web，可以独立更新页面和普通业务逻辑。远程 UI 不能越过 preload 已定义的权限边界；新增桌面能力仍需要先发布桌面版本。

### 外置运行时更新

用于更新大型 SDK、CLI 或平台二进制。运行时版本应与桌面客户端兼容，并通过 manifest、完整性校验和版本目录管理。

不要把这三种更新混成一套。它们的风险、回滚方式和发布权限不同。

## 最小安全基线

窗口至少使用以下配置：

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

还应做到：

- preload 只暴露最小 API。
- IPC handler 校验来源和所有参数。
- 生产环境只加载允许列表中的 HTTPS 页面。
- 使用 CSP 限制脚本、网络连接和嵌入内容。
- 外部链接交给系统浏览器，不允许窗口随意导航。
- 不关闭 `webSecurity`，不忽略证书错误。
- 密钥不写入 Web 代码、安装包或公开配置。
- macOS 和 Windows 正式安装包进行代码签名。

## 学习与改造顺序

第一次维护 Electron 项目时，建议按以下顺序理解：

1. 找到主进程入口、preload 和页面入口。
2. 确认窗口安全配置和页面加载地址。
3. 列出 preload 暴露的 API 和主进程 IPC handler。
4. 确认配置、用户数据和日志的保存位置。
5. 跑通开发、构建和打包命令。
6. 再改造远程 UI、动态后端地址或 SDK 外置。

## 延伸阅读

- [Electron 部署、远程 UI 与动态配置](electron-deployment.md)
- [大型 SDK 外置与动态安装](sdk-externalization.md)

这两篇文档分别处理应用部署与大体积依赖，不重复讲解 Electron 的基础进程模型。
