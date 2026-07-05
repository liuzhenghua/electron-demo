# 桌面应用打包配置

本目录集中维护 Electron 安装包的环境配置。修改对应文件中的 `VITE_SERVER_URL` 和 `RUNTIME_DOWNLOAD_BASE_URL` 后执行打包命令：

```bash
npm run dist:development  # development.env
npm run dist:test         # test.env
npm run dist              # production.env
npm run dist:mac          # production.env，macOS x64 + arm64
npm run dist:win          # production.env，Windows x64 + arm64
npm run dist:all          # production.env，macOS/Windows x64 + arm64
```

构建时，环境名称、后端服务地址、SDK 下载源和 `CLAUDE_AGENT_SDK_VERSION`、`CODEX_SDK_VERSION` 会写入包内的 `dist/runtime-config.json`。后端只控制下载地址，不控制 SDK 版本。

后端服务地址按以下优先级生效：

1. 打包命令所在进程的 `VITE_SERVER_URL`
2. 本目录中对应环境的 `*.env`
3. 默认地址 `http://127.0.0.1:4123`

安装包运行后，还可以通过系统环境变量，或应用用户数据目录 `.env` 中的 `SERVER_URL` 覆盖包内地址。根目录 `.env` 仅用于本地开发配置，例如 `ELECTRON_UI_URL`，不决定安装包的默认服务地址。

SDK 下载源的优先级为：运行时环境变量或用户数据目录 `.env`、后端 `/api/app-config`、上次成功获取的后端配置、随包写入的环境配置，最后回退到 npm。`file://` 只适合本机测试；正式分发前必须在后端配置用户能够访问的 HTTP(S) 静态文件服务器。

SDK 默认从 npm 下载。需要使用公司文件服务器时，先准备镜像目录：

```bash
npm run prepare:runtimes

# 本地验证 file:// 下载流程时，写入根目录 .env
RUNTIME_DOWNLOAD_BASE_URL=file:///项目绝对路径/runtime-packages/
RUNTIME_INSTALL_IN_DEVELOPMENT=true
```

将整个 `runtime-packages/` 上传到静态文件服务器后，把 `RUNTIME_DOWNLOAD_BASE_URL` 改成对应的 HTTP 地址，例如 `https://files.example.com/electron-runtimes/`。该目录必须保留 `manifest.json` 和所有 `.tgz` 文件。可通过 `--platform=win32-x64` 等参数准备其他平台，也可以用 `--output=/目标目录` 指定输出位置。

不同环境共用 `release/` 输出目录，连续打包会覆盖同名产物；需要同时保留时，应及时重命名或复制产物。
