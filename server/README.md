# Model API Server

独立部署的模型列表服务，要求 Node.js 20 或更高版本。

复制环境配置：

```bash
cp server/.env.example server/.env
```

演示模型维护在 `data/models.json`，OpenAI 和 Anthropic 必须各配置至少一个模型。敏感值使用 `${环境变量名}` 占位，接口返回前会替换成 `.env` 中的实际值：

```json
{
  "id": "gpt-5.1-codex",
  "name": "GPT-5.1 Codex",
  "model_provider": "openai",
  "endpoint": "https://api.openai.com/v1",
  "api_key": "${OPENAI_API_KEY}",
  "context_window": 200000,
  "multimodal": true
}
```

```dotenv
OPENAI_API_KEY=replace-with-openai-key
```

不同模型可以引用不同变量。任何占位变量缺失时，服务会拒绝启动。

```bash
cd server
npm install
npm start
```

也可以独立构建容器：

```bash
docker build -t model-api ./server
docker run --rm -p 4123:4123 model-api
```

接口：

- `GET /health`：健康检查
- `GET /api/models`：桌面端使用的统一模型列表；`model_provider` 表示请求协议
- `POST /api/chat`：可选的统一会话代理；服务端根据模型的 `model_provider` 调用对应上游
- `GET /openai/v1/models`：OpenAI 格式
- `GET /anthropic/v1/models`：Anthropic 格式
- `GET /v1/models`：默认 OpenAI 格式；携带 `anthropic-version` 请求头时返回 Anthropic 格式

统一接口返回示例：

```json
{
  "data": [
    {
      "id": "claude-sonnet-4-5",
      "name": "Claude Sonnet 4.5",
      "model_provider": "anthropic",
      "endpoint": "https://api.anthropic.com",
      "api_key": "demo-anthropic-key",
      "context_window": 200000,
      "multimodal": true
    }
  ]
}
```

当前为演示配置，`GET /api/models` 会下发每个模型的密钥，供桌面运行时直接调用。生产环境必须为接口增加用户鉴权、HTTPS，并优先下发权限受限的临时凭证。允许通过 `CORS_ORIGIN` 限制跨域来源。桌面端构建时使用 `VITE_SERVER_URL` 指定服务地址。
