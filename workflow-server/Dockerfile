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
FROM oven/bun:1-alpine
WORKDIR /app

# Copy dependency files
COPY package.json bun.lock ./

# Install only production dependencies
RUN bun install --frozen-lockfile --production

# Copy built assets from builder
COPY --from=builder /app/dist ./dist

EXPOSE 3001

# Run the app using Bun's runtime
CMD ["bun", "dist/index.js"]
