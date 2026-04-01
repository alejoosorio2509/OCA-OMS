module.exports = {
  apps : [{
    name: "ansALEJO",
    script: "npx",
    args: "serve -s dist -l 5173",
    interpreter: "none",
    env: {
      NODE_ENV: "production",
    }
  }]
}