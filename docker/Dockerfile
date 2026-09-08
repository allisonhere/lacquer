FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# Internal packages export TypeScript; API/worker run via pinned tsx.
# This foundation image intentionally includes migration tooling.
USER node
FROM base AS api
EXPOSE 3001
CMD ["pnpm", "--filter", "@lacquer/api", "start"]
FROM base AS worker
EXPOSE 3002
CMD ["pnpm", "--filter", "@lacquer/worker", "start"]
FROM base AS web
EXPOSE 5173
CMD ["pnpm", "--filter", "@lacquer/web", "start"]
