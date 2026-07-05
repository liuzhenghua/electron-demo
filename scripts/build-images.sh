#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env}"
COMPOSE_FILE="${SCRIPT_DIR}/compose.build.yaml"
TARGET="${1:-all}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "缺少构建配置：${ENV_FILE}" >&2
  echo "请先执行：cp ${SCRIPT_DIR}/.env.example ${SCRIPT_DIR}/.env" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker，请先安装并启动 Docker。" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "当前 Docker 未提供 compose 子命令。" >&2
  exit 1
fi

case "${TARGET}" in
  all) services=(frontend server) ;;
  frontend|server) services=("${TARGET}") ;;
  *)
    echo "用法：$0 [all|frontend|server]" >&2
    exit 2
    ;;
esac

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build "${services[@]}"
