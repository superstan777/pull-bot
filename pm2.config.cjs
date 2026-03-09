module.exports = {
  apps: [
    {
      name: "pull-bot",
      script: "tsx",
      args: "src/server.ts",
      env_file: ".env",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      error_file: "logs/error.log",
      out_file: "logs/out.log",
    },
  ],
};
