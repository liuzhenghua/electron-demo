# 通用技术文档

本目录记录可复用于其他应用的架构方案和工程实践，不依赖当前项目的具体业务配置。

- [Electron 基础与工程边界](electron-basics.md)：面向第一次接触 Electron 的开发者，介绍进程模型、preload、IPC、打包、安全和更新边界。
- [大型 SDK 外置与动态安装](sdk-externalization.md)：将包含原生二进制的大型 SDK 从桌面安装包拆出，在应用启动后按平台安全安装。
- [Electron 部署、远程 UI 与动态配置](electron-deployment.md)：内置 UI 兜底、`UI_SERVER` Web 动态更新、后端地址远程配置及安全边界。

当前项目的具体配置、命令和验证路径见 [SDK 运行时动态安装](../runtime-installation.md)。
