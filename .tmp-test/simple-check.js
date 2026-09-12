const fs = require('fs');
const f = 'D:/FILES/project/KomuniPH/web/js/profile.js';
const lines = fs.readFileSync(f, 'utf8').split('\n');
const before = lines.slice(0, 270);
const after = lines.slice(333);
console.log('Before:', before.length, 'After:', after.length);
