# RPG Fuel UI: Next.js (App Router) production build.
FROM node:22-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Full install (dev dependencies are needed for `next build`: Tailwind, TypeScript).
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# `next start` listens on $PORT, which Railway injects.
# AGENT_URL must point at the agent service (see README.md).
CMD ["npm", "start"]
