FROM golang:1.21-alpine AS builder

WORKDIR /build

# Build the parser
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o parser main.go

# Build the server
WORKDIR /build/server
COPY server/go.mod ./
RUN go mod download
COPY server/server.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o server server.go

# Final image
FROM alpine:latest

WORKDIR /app

COPY --from=builder /build/parser /app/parser
COPY --from=builder /build/server/server /app/server

RUN mkdir -p /data/demos /data/parsed

EXPOSE 8080

CMD ["/app/server"]
