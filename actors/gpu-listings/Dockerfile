FROM apify/actor-node:24

COPY package.json pnpm-lock.yaml* ./
RUN corepack enable \
 && pnpm install --prod --no-frozen-lockfile \
 && node --version

COPY . ./

CMD ["node", "src/main.js"]
