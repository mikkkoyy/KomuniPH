const fs = require('fs');
const s = fs.readFileSync('tests/test_creator17_mp3_player.mjs', 'utf8');
const t = "const database = await import('../server/database.js');\nawait database.initDatabase();\n\nconst auth = await import('../server/auth.js');\nawait import('../server/index.js'); // boots HTTP on port 0\n\n\nfunction api";
console.log('sub found:', s.indexOf(t));
console.log('oldBootLength', t.length);
// Show exact slice from the file around the boot
const i = s.indexOf("const database = await import");
console.log(JSON.stringify(s.slice(i, i + 350)));
