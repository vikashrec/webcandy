FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY index.html ./
COPY scripts/ ./scripts/
RUN mkdir -p /var/lib/webcandy && chown -R node:node /var/lib/webcandy /app
USER node
ENV NODE_ENV=production PRIVATE_LEADS_FILE=/var/lib/webcandy/leads.json
EXPOSE 8787 8788
CMD ["node","scripts/leads-api.mjs"]
