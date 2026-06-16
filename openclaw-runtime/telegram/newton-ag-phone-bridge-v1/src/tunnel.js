const { spawn } = require('child_process');

console.log("[Tunnel] Starting SSH tunnel to serveo.net (5.255.123.12)...");

const ssh = spawn('ssh', [
  '-o', 'StrictHostKeyChecking=no',
  '-R', '80:localhost:4444',
  '5.255.123.12'
]);

ssh.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(`[Tunnel stdout] ${output.trim()}`);
});

ssh.stderr.on('data', (data) => {
  const output = data.toString();
  console.error(`[Tunnel stderr] ${output.trim()}`);
});

ssh.on('close', (code) => {
  console.log(`[Tunnel] SSH process exited with code ${code}`);
  process.exit(code);
});
