module.exports = {
  apps: [{
    name: 'books',
    script: 'node_modules/.bin/next',
    args: 'start -p 3200',
    cwd: '/var/www/accounting',
    env: {
      NODE_ENV: 'production',
      PORT: 3200
    }
  }]
}
