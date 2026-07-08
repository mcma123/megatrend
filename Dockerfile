FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY insightful-property-hub/package*.json ./insightful-property-hub/
RUN npm ci
RUN npm ci --prefix insightful-property-hub

COPY . .

RUN npm run build:web
RUN npm run build:mastra

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV MASTRA_HOST=0.0.0.0
ENV MASTRA_PORT=4111
ENV MASTRA_CHAT_URL=http://127.0.0.1:4111/chat
ENV MASTRA_OKF_CHAT_URL=http://127.0.0.1:4111/chat/okf
ENV MASTRA_FACEBOOK_MARKETPLACE_CHAT_URL=http://127.0.0.1:4111/chat/facebook-marketplace

EXPOSE 3000 4111

CMD ["npm", "run", "start:platform"]
