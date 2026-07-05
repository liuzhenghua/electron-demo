# 大型 SDK 外置与动态安装

## 适用场景

当 Electron 应用依赖包含大型二进制文件的 SDK，并且安装包体积主要由这些 SDK 构成时，可以将 SDK 改为外置运行时。应用安装包只保留业务代码和安装器，首次启动后再根据操作系统与 CPU 架构下载运行时。

该方案适合以下情况：

- SDK 包含数十或数百 MB 的平台二进制文件。
- 不同平台只需要各自的运行时，不需要携带其他平台文件。
- 用户首次启动时通常可以联网。
- 应用能够在运行时未就绪前禁用相关功能。

如果应用必须完全离线使用，或 SDK 是启动界面的必要依赖，应优先提供包含运行时的完整安装包，或同时提供精简版与离线版。

## 目标架构

```text
应用安装包
├── UI 和业务代码
├── RuntimeManager
└── 解压与完整性校验依赖

配置服务
└── 返回静态下载目录，不转发大文件

静态文件服务器 / CDN
├── manifest.json
├── sdk-a-js.tgz
├── sdk-a-darwin-arm64.tgz
└── sdk-a-win32-x64.tgz

用户数据目录
└── runtimes/<runtime>/<version>/<platform>/
    ├── .installed.json
    └── node_modules/
```

职责边界：

- `RuntimeManager`：平台识别、状态管理、下载、校验、解压、加载和重试。
- 配置服务：返回下载目录，可以动态切换 CDN 或文件服务器。
- 静态文件服务器：直接承载运行时压缩包。
- UI：展示安装状态，在对应运行时可用前阻止调用。

不要让业务模块自行下载 SDK，也不要让配置服务代理数百 MB 的文件流。

## 改造步骤

### 1. 确认体积来源

分别统计 SDK 的 JavaScript 包、平台包和打包产物体积。重点检查：

- `dependencies` 中是否存在 SDK 主包。
- SDK 是否通过 `optionalDependencies` 引入平台二进制。
- 打包工具是否通过 `asarUnpack` 复制或展开二进制文件。
- 构建机器是否意外安装了多个平台包。

只有确认平台二进制是主要体积来源后，才值得引入动态安装流程。

### 2. 从生产依赖中移除 SDK

SDK 可以保留为开发依赖，供本地开发直接导入；生产安装包必须排除 SDK 主包和平台包。同时删除不再需要的 `asarUnpack` 规则。

打包后应检查 `app.asar` 和资源目录，确认不存在 SDK 主包及平台二进制。仅修改动态 `import()` 并不能阻止打包工具收集生产依赖。

### 3. 固定兼容版本

SDK 版本应由客户端构建配置确定，例如：

```dotenv
SDK_A_VERSION=1.2.3
SDK_B_VERSION=4.5.6
```

镜像制作和客户端打包必须使用相同版本。构建时将版本写入随包配置，客户端按该版本查找安装目录和 manifest 条目。

不建议让后端直接指定任意 SDK 版本。SDK 升级可能改变 JavaScript API、事件结构、权限模型或二进制参数。若必须支持远程升级，应增加客户端兼容版本白名单、灰度发布和一键回滚。

### 4. 制作平台镜像

每个平台只准备必要的包，例如：

```text
darwin-arm64
darwin-x64
win32-x64
win32-arm64
linux-x64
linux-arm64
linux-x64-musl
```

不要只用 `process.platform` 判断平台，还需要考虑 `process.arch`，Linux 可能还要区分 glibc 与 musl。

镜像目录必须包含 manifest：

```json
{
  "schemaVersion": 1,
  "packages": {
    "sdk-a@1.2.3=>sdk-a": {
      "file": "sdk-a@1.2.3.tgz",
      "integrity": "sha512-..."
    }
  }
}
```

manifest 至少记录逻辑包、实际文件名和 SHA-512。npm alias 等场景中，下载包名与安装后的目录名可能不同，因此两者需要分别记录。

### 5. 确定下载地址

推荐优先级：

1. 本地或系统环境变量，供排障和私有部署覆盖。
2. 后端配置接口返回的静态文件地址。
3. 最近一次成功获取并缓存的地址。
4. 安装包内置地址。
5. 公共包仓库兜底。

后端响应示例：

```json
{
  "data": {
    "runtimeDownloadBaseUrl": "https://cdn.example.com/desktop-runtimes/"
  }
}
```

生产环境应使用 HTTPS。`file://` 可以用于本机集成测试，但不能作为分发给其他用户的默认地址。

### 6. 实现安装状态机

每个运行时至少包含以下状态：

```text
checking -> pending -> installing -> ready
                            |
                            └-> error -> installing
```

状态应包含：

- 运行时标识和展示名称
- 当前阶段
- 下载或安装进度
- 可展示的错误信息
- 重试入口

多个大型运行时建议顺序安装，避免同时争抢带宽和磁盘 IO。应用窗口不必等待安装完成，但依赖该运行时的操作必须暂时禁用。

### 7. 安全下载和原子安装

推荐流程：

1. 在用户数据目录创建临时安装目录。
2. 下载压缩包并持续上报进度。
3. 计算 SHA-512，与 manifest 中的值比较。
4. 将文件解压到临时目录中的目标包路径。
5. 所有包完成后写入 `.installed.json`。
6. 将临时目录原子重命名为正式版本目录。
7. 失败时删除临时目录，保留已安装的旧版本。

不要仅以目录存在判断安装成功，必须检查完成标记中的运行时版本与平台。解压库还应防止路径穿越，下载地址必须限制为允许的协议。

### 8. 从绝对路径加载 SDK

外置 SDK 不在应用自身的 `node_modules` 中，普通包名导入通常无法找到它。应定位 SDK 的 `package.json`，读取 ESM 或 CommonJS 入口，再从绝对路径加载：

```js
const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
const exported = packageJson.exports?.['.']
const relativeEntry = exported?.import || exported?.default || packageJson.module || packageJson.main
const sdk = await import(pathToFileURL(path.join(packageRoot, relativeEntry)).href)
```

需要同时兼容：

- 只声明 ESM `exports.import` 的包
- 使用 `exports.default` 的包
- 使用 `module` 或 `main` 的旧包
- 主包通过相对位置寻找平台二进制的情况

平台包必须保持包管理器安装后的目录结构，否则 SDK 可能无法定位二进制文件。

## 安装目录

运行时应写入 Electron 的 `app.getPath('userData')`，不要写入应用安装目录。应用安装目录可能只读，升级或卸载也可能覆盖内容。

建议结构：

```text
<userData>/runtimes/<runtime>/<version>/<platform>/
├── .installed.json
├── package.json
└── node_modules/
```

版本目录允许新旧版本并存，升级成功后再清理不再使用的旧版本。清理时不要删除当前进程正在使用的版本。

## UI 要求

对非技术用户，安装过程应表现为普通的应用初始化：

- 应用窗口正常打开，不展示 npm、包名或终端信息。
- 底部或设置页显示“正在准备运行环境”和进度。
- 当前运行时未就绪时禁用发送或执行按钮。
- 失败时显示简短原因和“重试”按钮。
- 安装成功后自动解除禁用，不要求重启应用。

如果某个运行时不是所有用户都会使用，可以改成首次选择时安装，以减少首次启动的等待时间。

## 升级与回滚

SDK 升级建议遵循：

1. 在 CI 中生成新版本的全部平台镜像。
2. 验证 manifest 和静态文件可访问。
3. 使用新版本构建测试客户端。
4. 完成 SDK API、权限和流式事件回归测试。
5. 发布客户端；旧版本镜像继续保留。
6. 稳定后再清理不受支持的旧版本。

客户端版本与 SDK 版本应形成明确的兼容矩阵。不要覆盖同名压缩包；文件路径或 manifest 键必须包含版本。

## 验收清单

- 打包产物中不包含外置 SDK 和平台二进制。
- macOS、Windows、Linux 能选择正确的平台包。
- 新用户首次启动能够看到进度并完成安装。
- 断网、超时、磁盘不足和校验失败时可以重试。
- 下载中断后不存在错误的 `.installed.json`。
- 重启应用能够复用已安装版本，不重复下载。
- 下载源接口不可用时能够使用缓存或包内地址。
- 静态文件地址不可用时能够明确提示，而不是无限等待。
- SDK 能从外置路径加载并完成一次真实业务调用。
- 新版本安装失败时，旧版本目录不被破坏。

## 不适合直接照搬的部分

以下内容需要根据 SDK 调整：

- 平台包命名和 npm alias 规则
- glibc 与 musl 的区分方式
- SDK 查找原生二进制的相对目录约束
- 是否允许多个版本同时加载
- SDK 的许可证是否允许重新托管压缩包
- 企业代理、证书和鉴权下载要求

在接入第三方 SDK 前，应确认其分发许可和完整性来源。若运行时文件需要鉴权，优先使用短期签名 URL，不要将长期密钥写入桌面安装包或 manifest。
