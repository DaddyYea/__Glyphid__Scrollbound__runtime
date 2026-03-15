# ScrollboundRuntime — RunPod Serverless Docker
# Runs the Communion server (communion/server.ts) on port 3000

FROM node:20-slim

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci

# Copy project files
COPY . .

# Create mount point for persistent data (brain tissue, agents, golden set)
# RunPod should mount a volume here containing dynamic-agents.json
RUN mkdir -p data/communion/golden
VOLUME /app/data

# Expose the communion server port
EXPOSE 3000

# Start the communion server
# --max-old-space-size=4096: RunPod containers typically have limited RAM
# tsx/cjs: TypeScript runtime loader (required — communion/ uses ESM import syntax)
CMD ["node", "--max-old-space-size=4096", "--require", "tsx/cjs", "communion/server.ts"]
