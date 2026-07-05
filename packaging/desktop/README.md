# 桌面应用打包配置

本目录集中维护 Electron 安装包的环境配置。修改对应文件中的 `VITE_SERVER_URL` 后执行打包命令：

```bash
npm run dist:development  # development.env
npm run dist:test         # test.env
npm run dist              # production.env
```

构建时，环境名称和服务地址会写入包内的 `dist/runtime-config.json`。地址末尾的 `/` 会自动移除。

服务地址按以下优先级生效：

1. 打包命令所在进程的 `VITE_SERVER_URL`
2. 本目录中对应环境的 `*.env`
3. 默认地址 `http://127.0.0.1:4123`

安装包运行后，还可以通过系统环境变量，或应用用户数据目录 `.env` 中的 `SERVER_URL` 覆盖包内地址。根目录 `.env` 仅用于本地开发配置，例如 `ELECTRON_UI_URL`，不决定安装包的默认服务地址。

不同环境共用 `release/` 输出目录，连续打包会覆盖同名产物；需要同时保留时，应及时重命名或复制产物。
