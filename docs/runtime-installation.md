# SDK 运行时动态安装

桌面安装包不再内置 Claude Agent SDK 和 Codex SDK。应用启动后根据操作系统与 CPU 架构下载对应运行时，在底部显示安装进度，安装完成后才允许发送消息。

## 下载地址

应用按以下优先级确定 SDK 下载地址：

1. 系统环境变量或应用用户数据目录 `.env` 中的 `RUNTIME_DOWNLOAD_BASE_URL`
2. 后端 `GET /api/app-config` 返回的 `runtimeDownloadBaseUrl`
3. 上次成功获取并缓存的后端配置
4. 打包时写入 `dist/runtime-config.json` 的地址
5. npm 官方仓库

正式环境建议由后端返回公司静态文件服务器或 CDN 地址。后端只下发地址，不转发 SDK 文件。

```json
{
  "data": {
    "runtimeDownloadBaseUrl": "https://files.example.com/electron-runtimes/"
  }
}
```

## 准备运行时文件

SDK 版本由构建配置确定，后端接口只返回下载地址，不控制版本。可以在根目录 `.env` 和 `packaging/desktop/*.env` 中配置：

```dotenv
CLAUDE_AGENT_SDK_VERSION=0.3.201
CODEX_SDK_VERSION=0.142.5
```

`prepare:runtimes` 读取根目录 `.env` 中的版本；桌面打包读取对应环境的 `packaging/desktop/*.env`，并将版本写入 `dist/runtime-config.json`。制作镜像和打包时必须使用相同版本。

在项目根目录执行：

```bash
# 当前操作系统和 CPU 架构
npm run prepare:runtimes

# 指定其他平台
npm run prepare:runtimes -- --platform=win32-x64
npm run prepare:runtimes -- --platform=linux-x64
```

文件默认生成到项目根目录的 `runtime-packages/`。该目录包含：

- `manifest.json`：文件名和 SHA-512 完整性信息
- Claude SDK 及当前平台的原生运行时 `.tgz`
- Codex SDK 及当前平台的原生运行时 `.tgz`

上传到公司文件服务器时必须完整保留 `manifest.json` 和所有 `.tgz` 文件。可以直接访问以下地址验证文件服务器：

```text
https://files.example.com/electron-runtimes/manifest.json
```

## 本地 file:// 测试

本地开发可在根目录 `.env` 中配置：

```dotenv
RUNTIME_DOWNLOAD_BASE_URL=file:///项目绝对路径/runtime-packages/
RUNTIME_INSTALL_IN_DEVELOPMENT=true
```

Production 包也可以暂时在 `packaging/desktop/production.env` 中配置 `file://` 地址。该地址只在相同电脑上有效，分发前必须替换为用户能够访问的 HTTP(S) 地址。

## 去哪里验证已安装的运行时

应用下载并解压后的文件位于 Electron 用户数据目录下的 `runtimes/`，不是项目中的 `runtime-packages/`。常见路径如下：

```text
# macOS
~/Library/Application Support/Electron Demo/runtimes/

# Windows
%APPDATA%\Electron Demo\runtimes\

# Linux
~/.config/Electron Demo/runtimes/
```

目录结构示例：

```text
runtimes/
├── claude/
│   └── 0.3.201/
│       └── darwin-arm64/
│           ├── .installed.json
│           └── node_modules/
└── codex/
    └── 0.142.5/
        └── darwin-arm64/
            ├── .installed.json
            └── node_modules/
```

验证时检查：

1. Claude 和 Codex 对应目录均存在。
2. 平台目录内存在 `.installed.json`。
3. `.installed.json` 中的 `version`、`platform` 与当前应用一致。
4. `node_modules/` 中同时存在 SDK 主包和当前平台的原生包。
5. 应用底部不再显示安装状态，输入框可以正常发送消息。

macOS 可以执行：

```bash
find "$HOME/Library/Application Support/Electron Demo/runtimes" -name .installed.json -print
```

应用还会在用户数据目录保存 `runtime-source.json`，用于缓存最近一次从后端成功获取的 HTTP(S) 或 `file://` 下载地址。删除某个版本的运行时目录并重启应用，可以重新验证下载与安装流程。

## 安装安全与失败处理

- SDK 版本由客户端固定，不会自动安装未知的最新版。
- 每个下载文件都按 `manifest.json` 或 npm 元数据执行 SHA-512 校验。
- 文件先下载并解压到临时目录，全部成功后再切换为正式目录。
- 下载中断或校验失败不会留下可用标记；应用底部会显示失败状态和“重试”按钮。
- Claude 和 Codex 顺序安装，避免两个大文件同时占用带宽。

## 相关配置

- SDK 版本、平台映射和安装逻辑：`electron/runtime-manager.cjs`
- 后端配置接口：`server/src/app.cjs`
- 后端下载地址环境变量：`server/.env` 中的 `RUNTIME_DOWNLOAD_BASE_URL`
- 桌面打包环境：`packaging/desktop/*.env`
- 镜像准备脚本：`scripts/prepare-runtime-packages.cjs`
