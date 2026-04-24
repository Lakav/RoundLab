FROM golang:1.21-alpine AS builder

WORKDIR /src

# --- Build parser CLI ---
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/parser ./

# --- Build HTTP server ---
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/server.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./

# --- Final image ---
FROM alpine:latest
RUN apk add --no-cache ca-certificates && mkdir -p /data/demos /data/parsed
WORKDIR /app
COPY --from=builder /out/parser /app/parser
COPY --from=builder /out/server /app/server

EXPOSE 8080
CMD ["/app/server"]
