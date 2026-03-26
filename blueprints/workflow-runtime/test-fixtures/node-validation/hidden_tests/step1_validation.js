const fs = require('fs');
let ok = true;
function fail(msg){ console.error('[STEP1]', msg); ok = false; }

try { if (!fs.existsSync('package.json')) fail('root package.json missing'); } catch(e){ fail(e.message); }
try { const p = require('./package.json'); if (!p.workspaces) fail('workspaces missing in root package.json'); } catch(e){ fail(e.message); }
try { if (!fs.existsSync('turbo.json')) fail('turbo.json missing'); } catch(e){ fail(e.message); }
try { if (!fs.existsSync('tsconfig.base.json')) fail('tsconfig.base.json missing'); } catch(e){ fail(e.message); }
try { ['packages/core-lib/src/index.ts','packages/app-shell/src/index.ts','packages/shared-utils/src/index.ts'].forEach(p => { if (!fs.existsSync(p)) fail(`missing ${p}`); }); } catch(e){ fail(e.message); }
console.log(ok ? 'STEP1_OK' : 'STEP1_FAIL'); process.exit(ok ? 0 : 1);
