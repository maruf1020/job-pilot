# One image for both the web app and the worker. Based on the Playwright image so the
# worker can drive headless Chromium for the scraping and deep-fetch steps.
#   web:    docker run IMAGE npm run start
#   worker: docker run IMAGE npm run worker
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS base
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
# postinstall runs `prisma generate`, which needs the schema (copied above)
RUN npm ci --include=dev

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

FROM base AS runner
RUN groupadd --gid 1001 app && useradd --uid 1001 --gid app --shell /bin/bash --create-home app
COPY --from=build --chown=app:app /app ./
USER app
EXPOSE 3012
CMD ["npm", "run", "start"]
