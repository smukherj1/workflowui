# Use the official Bun image
FROM oven/bun:1-alpine AS builder
WORKDIR /app

# Copy dependency files
COPY package.json bun.lock ./

# Install all dependencies (including devDeps for the build)
RUN bun install --frozen-lockfile

# Copy source and config
COPY tsconfig.json ./
COPY src/ ./src/

# Run the build script
RUN bun run build

# Final runner stage
FROM alpine:3.23.3
WORKDIR /app

# Install libstdc++ needed by the server binary produced by bun.
RUN apk add --no-cache libstdc++

# Copy server binary from builder.
COPY --from=builder /app/dist/server ./server

EXPOSE 3001

# Run the standalone server binary produced
# by bun.
CMD ["./server"]
