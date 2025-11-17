import fs from 'node:fs';
fs.cpSync('./packages/engine-cli/src/dashboard', './packages/engine-cli/dist/dashboard', {
    recursive: true,
    filter: (src) => !src.endsWith('.ts'),
});
console.log('Copied dashboard to dist');
