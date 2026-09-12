import { readFileSync, writeFileSync } from "fs";
const f = "D:/FILES/project/KomuniPH/web/js/profile.js";
let c = readFileSync(f, "utf8");

const marker1 = '  return `\n    <div class="profile-card"';
const marker2 = '      <div id="profile-edit" style="display:none">';

const idx1 = c.indexOf(marker1);
const idx2 = c.indexOf(marker2);

if (idx1 === -1 || idx2 === -1) {
  console.log("ERROR: markers not found", idx1, idx2);
  process.exit(1);
}

const before = c.slice(0, idx1);
const after = c.slice(idx2 + marker2.length - '<div id="profile-edit" style="display:none">'.length + '      <div id="profile-edit" style="display:none">'.length);

console.log("Found at", idx1, idx2);
console.log("Before length:", before.length, "After length:", after.length);
