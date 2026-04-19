const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
delete pkg.scripts;
delete pkg.devDependencies;
delete pkg.packageManager;

pkg.main = './index.js';
pkg.types = './index.d.ts';

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
