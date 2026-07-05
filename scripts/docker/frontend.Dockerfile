# syntax=docker/dockerfile:1
FROM node:22-alpine AS build

WORKDIR /app
ARG NPM_REGISTRY
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}

COPY package*.json ./
RUN if [ -n "${NPM_REGISTRY}" ]; then \
      npm config set registry "${NPM_REGISTRY}" --location=global; \
    fi
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci
COPY index.html vite.config.mjs ./
COPY src ./src
RUN npm run build

FROM nginx:1.28-alpine
COPY scripts/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
