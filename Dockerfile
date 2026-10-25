FROM oven/bun:1
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/tanaread.db \
    APP_TIMEZONE=Asia/Jakarta
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
# /data harus berupa volume/disk persisten agar database tidak hilang saat redeploy
RUN mkdir -p /data && chown -R bun:bun /data /app
USER bun
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "src/server.js"]
