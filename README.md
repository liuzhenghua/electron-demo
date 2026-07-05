# Electron Demo

基于 Electron、React 和 Vite 的桌面聊天客户端示例，配套独立 Node.js 模型 API 服务，并支持构建前端 Web 镜像和服务端镜像。

## 环境要求

- Node.js 22 或更高版本
- npm
- 构建容器时需要 Docker Buildx/BuildKit 和 Docker Compose

## 本地开发

安装依赖并准备配置：

```bash
npm ci
npm --prefix server ci
cp .env.example .env
cp server/.env.example server/.env
```

分别启动后端服务和桌面客户端：

```bash
# 终端一
npm run server

# 终端二
npm run dev
```

根目录 `.env` 中的 `ELECTRON_UI_URL` 用于配置 Electron 开发页面地址。前端未显式配置 `VITE_SERVER_URL` 时，Electron 使用 `http://127.0.0.1:4123`；Web 页面使用当前页面主机的 `4123` 端口。

## 构建桌面应用

```bash
npm run build   # 只构建前端静态资源
npm run pack    # 生成未安装的应用目录
npm run dist:development  # 使用 packaging/desktop/development.env
npm run dist:test         # 使用 packaging/desktop/test.env
npm run dist              # 使用 packaging/desktop/production.env
```

桌面打包配置统一位于 `packaging/desktop/`，使用对应环境的 `*.env` 文件配置后端服务地址。配置说明和覆盖优先级见 [桌面打包说明](packaging/desktop/README.md)。

Claude 和 Codex SDK 采用启动后动态安装，下载源、镜像制作和安装目录验证见 [SDK 运行时动态安装](docs/runtime-installation.md)。

可复用于其他桌面应用的架构说明见 [通用技术文档](docs/technical/README.md)。

构建产物分别位于 `dist/` 和 `release/`。不同环境构建会覆盖前一次产物，需要保留时请在下一次构建前复制或重命名。

## 构建容器镜像

```bash
cp scripts/.env.example scripts/.env
./scripts/build-images.sh            # 构建全部镜像
./scripts/build-images.sh frontend   # 只构建 Web 前端镜像
./scripts/build-images.sh server     # 只构建 API 服务镜像
```

镜像名称、标签、npm registry 和前端服务地址在 `scripts/.env` 中配置。详细的 Compose 命令及变量说明见 [scripts/README.md](scripts/README.md)。

## 服务端

模型列表、上游地址和演示密钥配置位于 `server/data/models.json`。接口、环境变量及生产安全注意事项见 [server/README.md](server/README.md)。
