# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app
ARG NPM_REGISTRY
COPY package*.json ./
RUN if [ -n "${NPM_REGISTRY}" ]; then \
      npm config set registry "${NPM_REGISTRY}" --location=global; \
    fi
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev
COPY src ./src
COPY data ./data

ENV HOST=0.0.0.0
ENV PORT=4123
EXPOSE 4123

USER node
CMD ["npm", "start"]
