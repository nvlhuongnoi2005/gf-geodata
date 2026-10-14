ARG GO_IMAGE=golang:1.27-alpine
ARG RUNTIME_IMAGE=alpine:3.22
FROM ${GO_IMAGE} AS build
WORKDIR /src
COPY api/go.mod ./go.mod
COPY api/go.sum ./go.sum
RUN go mod download
COPY api/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/geodata-upload ./cmd/geodata-upload

FROM ${RUNTIME_IMAGE}
RUN addgroup -S geodata && adduser -S -G geodata geodata
COPY --from=build /out/geodata-upload /usr/local/bin/geodata-upload
USER geodata
EXPOSE 8090
ENTRYPOINT ["/usr/local/bin/geodata-upload"]
