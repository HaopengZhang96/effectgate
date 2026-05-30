import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function makeTempProject(configText) {
  const dir = await mkdtemp(path.join(tmpdir(), 'effectgate-test-'));
  if (configText) {
    await writeFile(path.join(dir, '.effectgate.yaml'), configText, 'utf8');
  }
  return dir;
}

export async function writeProjectFile(root, relativePath, content) {
  const fullPath = path.join(root, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf8');
  return fullPath;
}

export async function readJsonl(filePath) {
  const text = await readFile(filePath, 'utf8');
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
