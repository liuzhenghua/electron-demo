# 会话存储设计

## 结论

应用使用 Electron `userData/chat-data` 作为自己的持久化目录，不直接解析 Claude Agent SDK 或 Codex SDK 的内部会话文件。

```text
<userData>/chat-data/
├── settings.json
└── conversations/
    └── <conversation-id>.json
```

- `settings.json` 保存跨会话偏好：运行时、各运行时选择的模型、权限模式。
- 每个会话使用独立 JSON 文件，保存可直接还原 UI 的消息、思考过程和工具执行记录。
- 会话文件同时保存 SDK 的 `sessionId` 或 `threadId`，用于下一轮恢复模型上下文。
- “删除所有会话”只删除本应用维护的会话文件和内存关联，不删除 SDK 的全局原始文件，避免影响其他应用或项目。

macOS 打包运行时，目录通常位于：

```text
~/Library/Application Support/Electron Demo/chat-data/
```

实际路径以 `app.getPath('userData')` 返回值为准。

## 模块边界

| 模块 | 职责 |
| --- | --- |
| `electron/chat-store.cjs` | JSON 文件读写、写入串行化、会话查询与删除、设置持久化 |
| `electron/main.cjs` | 注册 IPC、组合模型配置与会话信息、保存 SDK 会话 ID |
| `electron/agent-client.cjs` | 创建或恢复 Claude/Codex 会话，维护当前进程内的 SDK 对象 |
| `electron/preload.cjs` | 向渲染进程暴露受限的会话和设置 API |
| `src/App.jsx` | 会话列表、历史消息恢复、自动保存、删除交互和偏好选择 |

渲染进程不直接访问文件系统，也不接触模型 API Key。

## 数据结构

### settings.json

```json
{
  "runtime": "claude",
  "selectedModels": {
    "claude": "claude-sonnet-4-5",
    "codex": "gpt-5-codex"
  },
  "accessMode": "approval"
}
```

`accessMode` 支持：

- `approval`：敏感工具执行前请求用户批准。
- `full`：允许 Agent 在不询问的情况下执行工具。

### conversations/&lt;id&gt;.json

```json
{
  "id": "087a49d4-47a4-4c66-83ef-3e85281c72ca",
  "title": "总结这篇 Electron 文章",
  "createdAt": "2026-07-05T08:00:00.000Z",
  "updatedAt": "2026-07-05T08:03:00.000Z",
  "runtime": "claude",
  "messages": [
    {
      "role": "user",
      "content": "总结这篇文章"
    },
    {
      "role": "assistant",
      "content": "文章主要介绍……",
      "reasoning": "我先读取文章内容……",
      "activities": [],
      "permissions": [],
      "status": "done",
      "startedAt": 1783238400000,
      "durationMs": 4200
    }
  ],
  "sdkSessions": {
    "claude:claude-sonnet-4-5:approval": "claude-session-id",
    "codex:gpt-5-codex:approval": "codex-thread-id"
  }
}
```

SDK 会话索引使用 `<runtime>:<modelId>:<accessMode>`，避免切换模型或权限模式后错误续接旧上下文。

## 会话流程

### 启动与加载

1. Electron 主进程初始化 `ChatStore` 并创建数据目录。
2. 渲染进程并行读取 `settings.json` 和会话摘要列表。
3. 按 `updatedAt` 倒序展示会话，并加载最近一条会话的完整 JSON。
4. 如果没有历史会话，创建一个空白会话。
5. 上次异常退出时仍为 `thinking`、`answering` 或工具执行中的记录，在 UI 恢复时标记为已结束或执行中断，避免永久显示运行状态。

### 发送与自动保存

1. 用户发送首条消息后，使用消息前 28 个字符生成会话标题。
2. 消息、思考增量和工具结果进入 React 状态。
3. 状态变化后延迟 250ms 保存，减少流式输出期间的磁盘写入次数。
4. 切换会话或卸载聊天组件时执行最后一次保存。
5. `ChatStore` 对同一会话的写操作串行化，防止 UI 消息和 SDK 会话 ID 并发写入时互相覆盖。

### SDK 上下文恢复

Codex SDK 自身将线程保存在 `~/.codex/sessions`。应用保存其 `threadId`，进程重启后调用：

```js
codex.resumeThread(threadId, threadOptions)
```

Claude Agent SDK 返回 `session_id`。应用保存该 ID，后续请求通过：

```js
query({ prompt, options: { resume: sessionId } })
```

应用会话文件负责恢复 UI；SDK 原始会话负责恢复模型上下文。两者缺一时的行为：

- 只有应用文件：历史消息仍可展示，但 SDK 无法续接原上下文，将创建新 SDK 会话。
- 只有 SDK 文件：应用没有对应索引，不主动扫描或导入。

### 删除

单个会话通过侧栏右键菜单删除；全部会话通过“设置 → 数据管理”删除。

删除过程会：

1. 清除 Agent 客户端中的内存线程或会话引用。
2. 将会话 ID 标记为已删除，阻止组件卸载时的延迟保存重新创建文件。
3. 删除应用的会话 JSON。
4. 删除当前会话后选择下一条；没有剩余会话时创建空白会话。

## IPC 接口

| 接口 | 用途 |
| --- | --- |
| `conversations:list` | 获取会话摘要列表 |
| `conversations:get` | 获取完整会话 |
| `conversations:save` | 新建或更新会话 |
| `conversations:delete` | 删除单个会话 |
| `conversations:deleteAll` | 删除所有应用会话 |
| `conversations:openDirectory` | 使用系统文件管理器打开应用会话目录 |
| `settings:get` | 读取偏好设置 |
| `settings:update` | 合并更新偏好设置 |

## 约束与后续扩展

- 当前 JSON 适合本地单用户和中小规模会话；如果需要全文搜索、跨设备同步或大量会话，应迁移到 SQLite，并保留现有 IPC 边界。
- 会话文件可能包含用户输入、模型输出和工具结果，应视为敏感本地数据。未来增加导出或同步时需要显式授权，并过滤凭据。
- 不应依赖 SDK 内部文件格式。SDK 升级时只需验证 `threadId/sessionId` 的恢复接口。
- 当前删除不清理 Claude/Codex 的全局会话文件。如需提供深度清理，必须先确认文件归属，并作为独立、明确提示风险的操作实现。
