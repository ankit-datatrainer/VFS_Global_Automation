import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const result = spawnSync(python, ['-m', 'pytest', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
if (result.error) console.error('Python test environment unavailable. Install requirements-dev.txt first.');
process.exit(result.status ?? 1);
