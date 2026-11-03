FROM node:24-alpine
WORKDIR /app
COPY server.mjs .
ENV DATA_DIR=/data PORT=8196
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8196
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8196/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server.mjs"]
