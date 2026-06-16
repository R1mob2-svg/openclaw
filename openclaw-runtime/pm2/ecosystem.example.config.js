module.exports = {
  apps: [
    {
      name: "gravityclaw-backend",
      script: "./server.js",
      env: {
        NODE_ENV: "production",
        PORT: 18790
      }
    },
    {
      name: "ag-phone-bridge-worker",
      script: "./index.js"
    },
    {
      name: "intercom",
      script: "./app.js",
      env: {
        PORT: 4444
      }
    }
  ]
};
