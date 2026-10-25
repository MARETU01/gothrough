# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
ARG GO_VERSION=1.27

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY --from=frontend /src/frontend/dist/ ./internal/webassets/dist/
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -tags embedweb -trimpath -ldflags="-s -w" -o /out/gothrough ./cmd

FROM alpine:3 AS runtime
RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app \
    && mkdir -p /app/config /data/uploads /data/temp_uploads \
    && ln -s /data/uploads /app/uploads \
    && ln -s /data/temp_uploads /app/temp_uploads \
    && chown -R app:app /data
WORKDIR /app
COPY --from=backend /out/gothrough /app/gothrough
COPY config/config.yaml /app/config/config.yaml
USER 10001:10001
EXPOSE 8080
VOLUME ["/data"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/gothrough"]
