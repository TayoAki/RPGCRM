# RPG Fuel agent: TypeScript Strands agent served over AG-UI by Express.
# The ops store uses the built-in node:sqlite module, which needs Node >= 22.13,
# so the Node 22 line is pinned on purpose (Node 20 images will not work).
FROM node:22-slim

WORKDIR /app

# Install only runtime dependencies from the lockfile. tsx (the TypeScript
# runner used by `npm start`) is a regular dependency, so this is sufficient.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
# Railway overrides PORT at runtime if you set it on the service; 8000 is the default.
ENV PORT=8000
EXPOSE 8000

# Runs `tsx main.ts`. Set RPG_DB_PATH to a path on a mounted volume
# (for example /data/rpg.db) so the SQLite store survives redeploys.
CMD ["npm", "start"]
