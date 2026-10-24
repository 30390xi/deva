# deb 包的 AppArmor 配置（electron-builder 渲染 ${executable} / ${sanitizedProductName}，安装时由 after-install 装到 /etc/apparmor.d/）。
# Ubuntu 24+ 默认禁止非特权进程创建 user namespace，Chromium 沙箱要用它，没有这份配置应用会直接打不开。
# 与 electron-builder 自带模板的区别：同时匹配启动脚本 deva 与真正的 Electron 可执行文件 deva-bin
# （afterPack 把两者换了位置，见 scripts/linux-launcher.cjs）。
abi <abi/4.0>,
include <tunables/global>

profile "${executable}" "/opt/${sanitizedProductName}/{${executable},${executable}-bin}" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/${executable}>
}
