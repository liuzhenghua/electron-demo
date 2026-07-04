FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY data ./data

ENV HOST=0.0.0.0
ENV PORT=4123
EXPOSE 4123

USER node
CMD ["npm", "start"]
