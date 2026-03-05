const fs = require('fs');
const src = fs.readFileSync('communion/dashboard.html', 'utf8');
const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
const m = re.exec(src);
if (!m) { console.log('No script found'); process.exit(); }
const code = m[1];

// Check for duplicate const declarations (same name declared twice)
const consts = {};
const cr = /\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
let cm;
while ((cm = cr.exec(code)) !== null) {
  const name = cm[1];
  consts[name] = (consts[name] || 0) + 1;
}
const dupes = Object.entries(consts).filter(([, c]) => c > 1);
if (dupes.length) {
  console.log('Possible duplicate const names (may be in different scopes):');
  dupes.slice(0, 20).forEach(([n, c]) => console.log(' ', n, 'x' + c));
} else {
  console.log('No duplicate const names found');
}

// Try to syntax-check the script body
try {
  new Function(code);
  console.log('Script syntax OK');
} catch (e) {
  console.log('Script syntax ERROR:', e.message.slice(0, 200));
}
