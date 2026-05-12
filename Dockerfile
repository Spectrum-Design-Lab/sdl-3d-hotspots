FROM node:22-alpine
RUN apk add --no-cache openssl libc6-compat

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

ARG NPM_TOKEN

COPY package.json package-lock.json* .npmrc ./

RUN if [ -n "$NPM_TOKEN" ]; then echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" >> .npmrc; fi \
    && npm ci \
    && rm -f .npmrc

COPY . .

RUN npm run build && npm prune --omit=dev && npm cache clean --force

CMD ["npm", "run", "docker-start"]
