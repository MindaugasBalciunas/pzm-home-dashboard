ARG BUILD_ARCH=amd64

# ---------- stage 1: build React frontend (pre-rendered) ----------
FROM node:20-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build && npm run prerender

# ---------- stage 2: build C# backend ----------
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS backend
WORKDIR /src
COPY backend/*.csproj ./
RUN dotnet restore
COPY backend/ ./
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

# ---------- stage 3: runtime image ----------
FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini jq \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=backend  /app/publish ./
COPY --from=frontend /src/dist    ./wwwroot
COPY run.sh /run.sh
RUN chmod +x /run.sh

ENV ASPNETCORE_URLS=http://0.0.0.0:8099 \
    ASPNETCORE_ENVIRONMENT=Production \
    HLS_ROOT=/tmp/rtspviewer

EXPOSE 8099

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/run.sh"]
