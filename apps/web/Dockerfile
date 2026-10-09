FROM oven/bun:1.3
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun --filter '@trade/web' build
EXPOSE 3000
CMD ["bun", "--filter", "@trade/web", "start"]
