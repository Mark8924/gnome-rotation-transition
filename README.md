# Smooth Screen Rotation for GNOME

**Smooth, Android-style portrait ↔ landscape transitions for GNOME Shell 51.**

[中文说明](#中文说明) · **Experimental preview** · GPL-3.0-or-later

## Download

### [Download the installable GNOME extension](https://github.com/Mark8924/gnome-rotation-transition/releases/download/v0.1.0-preview.1/nabu-rotation-transition%40mipad5.local.shell-extension.zip)

[Release notes and SHA-256](https://github.com/Mark8924/gnome-rotation-transition/releases/tag/v0.1.0-preview.1)

GNOME can rotate a tablet display, but the orientation change can look abrupt.
This extension adds a short, whole-screen 90° transition without opacity animation. Both images remain opaque; the layout switches partway through the rotation.
It animates fixed-size GPU snapshots, without shrinking the desktop or rotating
its live input coordinate system.

## Tested configuration

| Item | Verified configuration |
| --- | --- |
| Device | Xiaomi Pad 5 / nabu, Snapdragon 860 / Adreno 640 |
| Desktop | GNOME Shell 51.1 + Mutter 51.1, Wayland |
| OS / kernel | Arch Linux ARM, 7.2.10-0-krjy |
| Display | One internal DSI panel, 1600 × 2560, 200% scale, 120 Hz |

**Desktop unresponsiveness after rotation is under investigation. This is not a stable release. The no-fade v12 layout switch has not yet received on-device visual confirmation.** The performance measurements below are from its v11 predecessor.

The test system also has unrelated local Mutter/input/wake fixes. A stock
GNOME 51 installation, other devices, X11, external displays, mirroring,
fractional scaling and other GNOME releases have **not** been validated.
The extension deliberately skips configurations other than one DSI panel.

## Install

Save work before logging out. Install as your normal desktop user, **without sudo**.

```sh
gnome-extensions install --force ~/Downloads/nabu-rotation-transition\@mipad5.local.shell-extension.zip
```

Log out and back in, then enable:

```sh
gnome-extensions enable nabu-rotation-transition@mipad5.local
```

Alternatively, clone the source and run `./install.sh` (Python 3 required).
Updating an already loaded extension also requires a fresh GNOME session.
The UUID is retained for compatibility with the original Xiaomi Pad 5 installation.

**Auto-rotation must already work.** This extension does not enable sensors,
force tablet mode, change orientation lock or install touch/keyboard drivers.
Enable GNOME animations and disable Reduced Motion if you want the transition.
There is a two-second startup grace period. Locked/blank screens are skipped.
Manual rotations while sensor orientation is unknown may also skip the animation.

## Disable / uninstall

```sh
gnome-extensions disable nabu-rotation-transition@mipad5.local
gnome-extensions uninstall nabu-rotation-transition@mipad5.local
```

Disabling releases this extension's actors, temporary scheduling flag and signals.
If a separate GUI/input issue prevents using the desktop, these commands can be
run from another TTY or an existing SSH session as the same user:

```sh
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus \
  gnome-extensions disable nabu-rotation-transition@mipad5.local
```

The optional last-transition diagnostic file is retained at
`~/.local/state/mipad-rotation-transition/status.json`; remove that file manually
if no longer wanted. It contains timing/dimensions, not screen pixels.

## How it works

- Takes old/new desktop snapshots into GPU-backed image actors, only while rotating.
- Uses native Clutter property transitions, with AOSP-style timing and easing:
  283 ms for 90°, 383 ms for 180°; no scaling or opacity animation.
- Warms the new image before starting the animation clock.
- Temporarily bypasses Clutter's dynamic maximum render-time estimate during
  the transition. The flag is global while set, and restored on cleanup if
  this extension set it. It is not a permanent performance setting.
- Never calls `pushModal`, grabs input, runs a keyboard simulator, or modifies
  live desktop transforms. No background polling, network requests or telemetry.
- A 750 ms GLib deadline cleans up if completion is missed. This depends on a
  responsive GNOME main loop; it cannot recover a blocked compositor/driver.

On the tested 120 Hz tablet, many measured animation intervals were close to
8.3 ms and the user reported smooth rotation. This is **not** a universal
120 FPS guarantee. Snapshot preparation still adds latency and temporarily
uses GPU memory; rapid rotation, busy apps and different drivers need more testing.

## Development and reporting

```sh
node --test lifecycle.test.mjs
python3 build.py
```

The lifecycle tests use mocks: they verify cleanup and failure handling, not real
GPU output. The v12 no-fade variant builds on the tablet-tested v11 engine. The new opaque layout switch is still being evaluated.
See [technical notes](TECHNICAL.md) and [release notes](CHANGELOG.md).

Report your GNOME/Mutter versions, device, GPU/driver, session type, monitor count,
resolution/scale and a short reproduction. Review diagnostic data before posting;
do not upload your full desktop capture or unrelated system logs.

## License and acknowledgements

GPL-3.0-or-later. Animation parameters follow AOSP resources; see [NOTICE](NOTICE).
This is an independent community experiment, not an official GNOME or Xiaomi project.

---

# 中文说明

**为 GNOME Shell 51 添加接近 Android 的横竖屏平滑旋转动画。实验性预览版。**

### [下载可直接安装的扩展包](https://github.com/Mark8924/gnome-rotation-transition/releases/download/v0.1.0-preview.1/nabu-rotation-transition%40mipad5.local.shell-extension.zip)

[版本说明与校验值](https://github.com/Mark8924/gnome-rotation-transition/releases/tag/v0.1.0-preview.1)

旋转时对新旧桌面画面做约 283 毫秒的整屏旋转，不做淡入淡出，不缩小桌面，
不改变真实桌面的输入坐标。实际测试中，米板 5 的 120 Hz 屏幕上多数动画帧间隔
接近 8.3 毫秒，主观流畅度良好；这不代表所有机器都能达到 120 帧。

## 适配范围

**旋转后桌面无响应的问题仍在排查，本项目不是稳定版；v12 无淡出切换尚未完成实机确认。**

目前只在小米平板 5、Arch Linux ARM、GNOME Shell/Mutter 51.1、Wayland、
7.2.10-0-krjy 内核、单块 DSI 内屏、1600×2560、200% 缩放下验证过。
测试系统还有其他输入和唤醒相关的本地 Mutter 补丁，**原版 GNOME 51、其他设备和
显卡、X11、外屏、多屏、镜像及小数缩放都没有验证**，不能据此保证兼容。
当前代码只为单块 DSI 内屏启用动画。

自动旋转本身必须先能正常工作。本扩展不负责传感器、键盘、触屏驱动或平板模式，
也不修改旋转锁定。遵循 GNOME 的动画和减少动态效果设置；启动后等两秒再生效，
锁屏和息屏时跳过。传感器方向未知时，手动旋转可能直接切换而不播放动画。

## 安装与卸载

下载上方 ZIP，用普通用户执行，**不用 sudo**：

```sh
gnome-extensions install --force ~/Downloads/nabu-rotation-transition\@mipad5.local.shell-extension.zip
```

先保存工作，注销再登录，然后启用：

```sh
gnome-extensions enable nabu-rotation-transition@mipad5.local
```

也可以下载源码后运行 `./install.sh`，需要 Python 3。
更新已加载的旧版后，同样需要注销再登录。UUID 保持不变，方便原有米板安装更新。

关闭和卸载：

```sh
gnome-extensions disable nabu-rotation-transition@mipad5.local
gnome-extensions uninstall nabu-rotation-transition@mipad5.local
```

关闭后释放动画画面、事件和本扩展临时添加的渲染调度标志。不锁 CPU/GPU 频率，
不常驻轮询，不访问网络，不上传或保存截图。最后一次动画的耗时和尺寸记录保存在
`~/.local/state/mipad-rotation-transition/status.json`，可以手动删除。

750 毫秒的清理保护需要 GNOME 主循环还能正常运行，无法救活真正卡住的合成器或驱动。
如遇桌面异常，可以通过其他 TTY 或已有 SSH 执行上方英文部分的停用命令。

## 原理与当前状态

只在旋转期间捕获 GPU 画面，用 Clutter 原生动画做旋转与不透明切换。旋转时暂时绕开
动态最大渲染耗时估计，结束后恢复；该标志在生效期间影响整个合成器，不是永久调度修改。
这版在实机流畅的 v11 基础上取消透明度动画；v12 不透明布局切换的观感仍待验证，也需要更多设备、连续快速旋转和重负载验证。
不抓取输入，不运行虚拟键盘，也不会把测试控制台或设备管理脚本安装到系统。

遇到问题请提供设备、GNOME/Mutter 版本、驱动、分辨率/缩放和复现方法。
不要公开完整桌面截图或含隐私的系统日志。项目采用 GPL-3.0-or-later，
动画参数参考 AOSP，归属见 NOTICE；非 GNOME 或小米官方项目。
