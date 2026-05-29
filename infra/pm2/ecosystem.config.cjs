// PM2 process for BPC broadcast-api (single instance for in-process websockets).
// Build first: npm run build --workspace=@bpc/shared-types && ... broadcast-api

module.exports = {
  apps: [
    {
      name: "bpc-broadcast-api",
      cwd: __dirname + "/../../apps/broadcast-api",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
