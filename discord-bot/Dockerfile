FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install
COPY orbit_discord_bot.js .
CMD ["node", "orbit_discord_bot.js"]
