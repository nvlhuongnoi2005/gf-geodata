FROM registry.internal/base/golang:1.27-alpine AS build
WORKDIR /src
COPY api/go.mod api/go.sum ./
RUN go mod download
COPY api ./
RUN CGO_ENABLED=0 go build -o /out/geodata-api ./cmd/geodata-api
RUN CGO_ENABLED=0 go build -o /out/geodata-migrate ./cmd/geodata-migrate

FROM registry.internal/base/alpine:3.21
RUN addgroup -S geodata && adduser -S geodata -G geodata
USER geodata
COPY --from=build /out/geodata-api /usr/local/bin/geodata-api
COPY --from=build /out/geodata-migrate /usr/local/bin/geodata-migrate
COPY api/migrations /migrations
EXPOSE 8090
ENTRYPOINT ["/usr/local/bin/geodata-api"]
