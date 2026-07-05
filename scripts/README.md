# 镜像构建脚本

复制配置并构建镜像：

```bash
cp scripts/.env.example scripts/.env
./scripts/build-images.sh            # 构建全部镜像
./scripts/build-images.sh frontend   # 仅构建前端镜像
./scripts/build-images.sh server     # 仅构建服务端镜像
```

脚本固定读取自身目录下的 `.env`，也可用 `ENV_FILE=/path/to/file` 指定其他配置。`.env` 只用于 Compose 变量替换，不会复制进镜像。

也可以直接使用 Compose：

```bash
# 构建全部镜像
docker compose --env-file scripts/.env -f scripts/compose.build.yaml build

# 只构建指定镜像
docker compose --env-file scripts/.env -f scripts/compose.build.yaml build frontend
docker compose --env-file scripts/.env -f scripts/compose.build.yaml build server

# 检查变量替换后的最终配置
docker compose --env-file scripts/.env -f scripts/compose.build.yaml config
```

`compose.build.yaml` 只定义镜像构建，不负责启动容器，因此不使用 `docker compose up`。

`VITE_SERVER_URL` 会在前端构建时写入静态资源，浏览器可以读取，禁止配置访问密钥。留空时，Web 前端访问当前页面主机的 `4123` 端口，Electron 文件模式访问 `127.0.0.1:4123`；前后端域名或协议不同时必须显式配置可由用户浏览器访问的完整地址。

示例配置将 `NPM_REGISTRY` 设为 `https://registry.npmmirror.com`；删除该项或留空时不修改 npm registry，由 npm 使用自身默认源。依赖安装使用 BuildKit cache mount 复用 npm 下载缓存，要求 Docker Buildx/BuildKit。CI 对供应链可控性要求较高时，建议改为内部代理仓库并锁定依赖。
