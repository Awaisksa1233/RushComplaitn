module.exports = {
  apps: [
    {
      name: "rush-customer-portal",
      script: "dist/server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },
      kill_timeout: 10000,
      max_memory_restart: "512M",
    },
  ],
};
