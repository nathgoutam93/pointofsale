// electron-builder hook: copies stage/api, stage/web and stage/postgres into the packaged
// app's resources folder. Done here rather than with extraResources, which always leaves out
// node_modules (the API needs its own).
const { cpSync, existsSync } = require('fs');
const { join } = require('path');

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources');
  const stage = join(__dirname, '..', 'stage');
  for (const name of ['api', 'web', 'postgres']) {
    const from = join(stage, name);
    if (!existsSync(from)) throw new Error(`${from} is missing; run "pnpm --filter @pos/desktop stage" first`);
    cpSync(from, join(resources, name), { recursive: true, verbatimSymlinks: false, dereference: true });
  }
};
