FROM node:18-alpine

WORKDIR /app

COPY package.json .
RUN npm install

COPY . .

# 创建数据目录
RUN mkdir -p data

EXPOSE 3000

CMD ["node", "server.js"]
