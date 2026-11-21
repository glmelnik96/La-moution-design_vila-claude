#!/usr/bin/env node
// marks.js — print a page's window.__MARKS (rest-frame hold times) as JSON.   node tools/marks.js v3.html
'use strict';
const { launch, open } = require('./shoot.js');
(async function () {
  const B = await launch(791, 1406);
  try {
    await open(B.cdp, process.argv[2]);
    process.stdout.write(JSON.stringify(await B.cdp.eval('window.__MARKS || {}')) + '\n');
  } finally { B.close(); }
})().catch((e) => { console.error('ERROR ' + e.message); process.exit(1); });
