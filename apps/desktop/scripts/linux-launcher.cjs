/**
 * electron-builder afterPack 钩子（Linux）：把可执行文件 deva 换成一个启动脚本，真正的 Electron 改名为 deva-bin。
 *
 * 为什么：Electron 33 在 Linux 上默认走 XWayland（缩放发糊、输入法上不了屏），Wayland 会话得带
 * `--ozone-platform=wayland --enable-wayland-ime --wayland-text-input-version=3` 启动。
 * 这些参数在主进程里 app.commandLine.appendSwitch 不生效——Ozone 平台在执行 main 脚本之前就选定了
 * （实测：参数能传到子进程，窗口却仍是 XWayland），只能在启动 Electron 之前加，故套一层脚本。
 *
 * AppImage 的 AppRun 固定 exec "$APPDIR/deva"，linux-unpacked 直接运行 deva 也一样经过本脚本。
 * 用户自己传的参数排在后面，同名参数后者覆盖（Chromium 取最后一个），设了 ELECTRON_OZONE_PLATFORM_HINT 则不指定平台。
 */
const fs = require('fs')
const path = require('path')

const LAUNCHER = `#!/usr/bin/env bash
# Deva 启动脚本（构建时由 scripts/linux-launcher.cjs 生成）：Wayland 会话下补上原生 Wayland 与输入法参数
HERE="$(dirname "$(readlink -f "$0")")"
flags=()
if [ "$XDG_SESSION_TYPE" = wayland ] || [ -n "$WAYLAND_DISPLAY" ]; then
  [ -z "$ELECTRON_OZONE_PLATFORM_HINT" ] && flags+=(--ozone-platform=wayland)
  flags+=(--enable-wayland-ime --wayland-text-input-version=3)
fi
exec "$HERE/__BIN__" "\${flags[@]}" "$@"
`

exports.default = async function linuxLauncher(context) {
  if (context.electronPlatformName !== 'linux') return
  const name = context.packager.executableName
  const exe = path.join(context.appOutDir, name)
  const bin = `${name}-bin`
  fs.renameSync(exe, path.join(context.appOutDir, bin))
  fs.writeFileSync(exe, LAUNCHER.replace('__BIN__', bin), { mode: 0o755 })
}
