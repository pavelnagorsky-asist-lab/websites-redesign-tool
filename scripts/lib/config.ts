import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* ignore malformed .env */
  }
}

export const PATHS = {
  leads: path.join(ROOT, 'leads'),
  data: path.join(ROOT, 'data'),
  sharedList: path.join(ROOT, 'data', 'shared-list.csv'),
  reports: path.join(ROOT, 'reports'),
};

export const CONFIG = {
  assignee: process.env.ASSIGNEE?.trim() || gitUserName(),
};

function gitUserName(): string {
  try {
    return execSync('git config user.name', { cwd: ROOT }).toString().trim();
  } catch {
    return '';
  }
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
