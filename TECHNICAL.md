# Implementation notes / 技术说明

## Lifecycle

`monitors-changing` captures the old stage using its old allocation dimensions;
`global.screen_width/height` already describe the new layout at that point.
The target transform comes from Mutter's orientation manager. Unknown sensor
orientation, an incompatible monitor layout or disabled animation skips the effect.

`monitors-changed` queues one `before-paint` capture of the newly allocated layout,
then prewarms the image for one paint. Native Clutter transitions rotate
fixed-size image actors. v12 removes both opacity transitions and switches the visible layout at half of the eased rotation. The user confirmed that v12 does not flash/dim and remains smooth. Neither `Main.uiGroup` nor the live window groups are
transformed or hidden. The overlay is nonreactive and never takes a modal grab.

Cleanup disconnects paint callbacks, cancels pending sources, destroys the overlay,
balances compositor/work holds, and removes only the scheduling debug flag this
instance added. Completion, disable, lock and the 750 ms deadline use that path.
The deadline is on the GNOME main loop, not an independent process watchdog.

## Scheduling

The tested tablet showed uneven frame dispatch during rotation. Temporarily
setting `Clutter.DrawDebugFlag.DISABLE_DYNAMIC_MAX_RENDER_TIME` made dispatch
more regular. This is a global Clutter debug flag, not a per-actor property. It
is restored after transition cleanup, and left alone if it was already enabled.
Concurrent changes by another extension are not coordinated in this preview.

## Testing boundaries

The engine file is copied byte-for-byte from the v12 no-fade candidate based on the on-device v11 implementation.
`_testTarget` is an internal, one-use test override, not a public API or remote
interface. No helper, simulator, debug console automation, IP, firmware or kernel
patch is included in the extension ZIP.

Avoid invoking display configuration changes from LookingGlass while it is
opening/closing. Use a separate terminal and wait until the console has fully
closed before manually testing rotation. No global grab-disabling patch is made.

## 中文摘要

旋转前后的画面只用于 GPU 动画，真实桌面的坐标和输入不动。临时调度标志在清理时
恢复；它生效期间是合成器全局标志，和其他扩展并发修改的协调尚未实现。

公开扩展不包含测试控制台自动化，也不修改系统全局的输入抓取逻辑。
