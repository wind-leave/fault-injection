FROM node:24-bookworm-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
COPY fault-types ./fault-types
RUN npm run build

FROM nginx:stable-alpine AS frontend
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

FROM python:3.12-slim AS backend
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GZ_COMPONENT_DATA_DIR=/data/components
WORKDIR /app
COPY backend ./backend
# The backend and shipped simulation modules currently use only Python's standard library.
RUN groupadd --system gz \
    && useradd --system --gid gz --home-dir /app gz \
    && mkdir -p /data/components \
    && chown -R gz:gz /data
USER gz
EXPOSE 8766
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; r = urllib.request.urlopen('http://127.0.0.1:8766/healthz', timeout=3); assert r.status == 200"]
CMD ["python", "-u", "-c", "from backend.server import serve; serve(host='0.0.0.0', port=8766)"]
