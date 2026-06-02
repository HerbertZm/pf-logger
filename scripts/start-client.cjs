/**
 * Wait for the API to accept TCP connections, then start Vite.
 * Avoids ECONNREFUSED spam when the browser loads before ts-node-dev is ready.
 */
require('dotenv/config');
const { execSync, spawn } = require('child_process');
const path = require('path');

const port = Number(process.env['PORT']) || 8080;
const host = '127.0.0.1';

execSync(`npx wait-on tcp:${host}:${port} -t 60000`, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
});

const vite = spawn('npx', ['vite', 'client'], {
    stdio: 'inherit',
    shell: true,
    cwd: path.join(__dirname, '..'),
});

vite.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 0);
});
