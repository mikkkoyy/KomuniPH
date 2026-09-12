import { readFileSync } from 'fs';
const f = 'D:/FILES/project/KomuniPH/web/js/profile.js';
const lines = readFileSync(f, 'utf8').split('\n');
console.log('Total lines:', lines.length);
console.log('Line 270:', lines[269]);
console.log('Line 271:', lines[270]);
