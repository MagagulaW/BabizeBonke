FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm config set registry https://registry.npmjs.org/ \
 && npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
EXPOSE 4000
CMD ["npm", "start"]
