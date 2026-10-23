/**
 * electron-builder afterPack 钩子入口（只能配一个）：各平台的处理各自判断平台，不相干的直接跳过。
 */
const adhocSign = require('./adhoc-sign.cjs').default
const linuxLauncher = require('./linux-launcher.cjs').default

exports.default = async function afterPack(context) {
  await adhocSign(context)
  await linuxLauncher(context)
}
