import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
delete pkg.scripts;
delete pkg.devDependencies;
delete pkg.packageManager;

pkg.type = 'module';
pkg.main = './index.js';
pkg.types = './index.d.ts';
pkg.exports = {
  '.': {
    types: './index.d.ts',
    import: './index.js',
  },
};

fs.writeFileSync(
  path.join(dist, 'package.json'),
  JSON.stringify(pkg, null, 2) + '\n',
);

for (const file of ['README.md']) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dist, file));
  }
}
