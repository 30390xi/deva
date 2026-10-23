import { app } from 'electron'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Linux AppImage 的桌面集成：AppImage 本身不安装任何东西，不经 AppImageLauncher / Gear Lever 这类工具，
 * 启动器（GNOME / KDE 菜单、rofi、fuzzel…）里就找不到 Deva。这里在启动时把 AppImage 自带的
 * deva.desktop 与各尺寸图标写到用户目录（~/.local/share/applications、~/.local/share/icons/hicolor），
 * Exec 指向当前 AppImage 的实际路径。
 *
 * - 只管自己写的文件（带 MARKER）：用户 / 其他工具放的同名 deva.desktop 不碰。
 * - 每次启动按需重写：AppImage 挪了位置或换了新版本，Exec 跟着更新。
 * - 用户删掉了我们写的 deva.desktop 就不再补回（userData 里留有「集成过」的记号）。
 * 失败一律静默：只是启动器里没有入口，不影响应用本身。
 */

const DESKTOP_FILE = 'deva.desktop'
const MARKER = 'X-Deva-AppImage-Integration=true'

/** desktop entry 的 Exec 参数转义：双引号内转义 " ` $ \，再按字符串值规则把 \ 加倍；% 写成 %%。 */
function quoteExecArg(arg: string): string {
  const quoted = arg.replace(/[\\"`$]/g, '\\$&').replace(/\\/g, '\\\\').replace(/%/g, '%%')
  return `"${quoted}"`
}

export async function integrateAppImage(): Promise<void> {
  const appImage = process.env.APPIMAGE
  const appDir = process.env.APPDIR
  if (process.platform !== 'linux' || !app.isPackaged || !appImage || !appDir) return
  try {
    const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
    const appsDir = join(dataHome, 'applications')
    const target = join(appsDir, DESKTOP_FILE)
    const flag = join(app.getPath('userData'), 'appimage-integrated')

    if (existsSync(target)) {
      if (!(await readFile(target, 'utf8')).includes(MARKER)) return
    } else if (existsSync(flag)) {
      return
    }

    // 以 AppImage 内嵌的 desktop 为底（名称 / 分类 / StartupWMClass 与 electron-builder 配置一致），只换 Exec
    const bundled = await readFile(join(appDir, DESKTOP_FILE), 'utf8')
    const lines = bundled
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('Exec=') && !l.startsWith('TryExec='))
    lines.push(`Exec=${quoteExecArg(appImage)} %U`, `TryExec=${appImage}`, MARKER)
    const content = lines.join('\n') + '\n'

    await copyIcons(appDir, join(dataHome, 'icons', 'hicolor'))

    const prev = existsSync(target) ? await readFile(target, 'utf8') : ''
    if (prev !== content) {
      await mkdir(appsDir, { recursive: true })
      await writeFile(target, content)
      execFile('update-desktop-database', [appsDir], () => {}) // 可选：没装就算了，多数启动器直接扫目录
    }
    if (!existsSync(flag)) await writeFile(flag, '')
  } catch {
    /* 写不了：启动器里没有入口，应用照常运行 */
  }
}

/** 把 AppImage 里 usr/share/icons/hicolor/<尺寸>/apps/deva.png 拷到用户图标目录（内容不变则跳过）。 */
async function copyIcons(appDir: string, destRoot: string): Promise<void> {
  const srcRoot = join(appDir, 'usr', 'share', 'icons', 'hicolor')
  for (const size of await readdir(srcRoot)) {
    const src = join(srcRoot, size, 'apps', 'deva.png')
    if (!existsSync(src)) continue
    const dest = join(destRoot, size, 'apps', 'deva.png')
    const data = await readFile(src)
    if (existsSync(dest) && data.equals(await readFile(dest))) continue
    await mkdir(join(destRoot, size, 'apps'), { recursive: true })
    await writeFile(dest, data)
  }
}
