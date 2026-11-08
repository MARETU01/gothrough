import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Use a unique ignored data root and explicit config. Never load local user config.
const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(frontend, '.e2e-runtime');
mkdirSync(runtime, { recursive: true });
const directory = mkdtempSync(path.join(runtime, 'run-'));
const executable = path.join(directory, process.platform === 'win32' ? 'server.exe' : 'server');
const config = path.join(directory, 'config.yaml');
writeFileSync(config, `server:\n  host: 127.0.0.1\n  port: 19815\n  tls:\n    enabled: false\nstorage:\n  data_dir: ${JSON.stringify(directory)}\nauth:\n  password: e2e-only-password\nlogging:\n  level: error\n`);
execFileSync('go', ['build', '-o', executable, './cmd'], { cwd: path.dirname(frontend), stdio: 'inherit' });
// Do not inherit GOTHROUGH_* settings from a user's real deployment.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GOTHROUGH_')));
const child = spawn(executable, ['-config', config], { cwd: directory, env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { process.stderr.write(String(error)); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(); });
process.on('exit', () => { child.kill(); });
