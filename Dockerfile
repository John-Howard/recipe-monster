FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server/ server/
COPY public/ public/
ENV NODE_ENV=production RECIPE_MONSTER_DATA=/data PORT=3443
RUN mkdir -p /data && chown node:node /data
EXPOSE 3443
USER node
CMD ["node", "--no-warnings", "server/index.js"]
