import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Graphene from 'gi://Graphene';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DEST = 'org.gnome.Mutter.DisplayConfig';
const PATH = '/org/gnome/Mutter/DisplayConfig';
// AOSP screen_rotation.xml and config_screen_rotation_* (Apache-2.0):
// https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/res/res/
const DURATION = 283;
export default class RotationTransition extends Extension {
    enable() {
        this._active = true;
        this._generation = 0;
        this._transform = null;
        this._enabledAt = GLib.get_monotonic_time();
        this._count = 0;
        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._manager = global.backend.get_monitor_manager();
        this._before = this._manager.connect('monitors-changing', () => this._prepare());
        this._after = this._manager.connect_after('monitors-changed', () => this._changed());
        this._session = Main.sessionMode.connect('updated', () => {
            if (Main.sessionMode.isLocked) this._cleanup();
        });
        this._readState();
    }

    _readState() {
        const generation = this._generation;
        Gio.DBus.session.call(DEST, PATH, DEST, 'GetCurrentState', null, null,
            Gio.DBusCallFlags.NONE, 1500, null, (connection, result) => {
                if (!this._active || generation !== this._generation) return;
                try {
                    const state = connection.call_finish(result).deep_unpack();
                    const logical = state[2];
                    this._singlePanel = logical.length === 1 && logical[0][5].length === 1 &&
                        logical[0][5][0][0].startsWith('DSI') && logical[0][3] < 4;
                    this._transform = this._singlePanel ? logical[0][3] : null;
                } catch (error) { this._record({error: error.message}); }
            });
    }

    _allowed() {
        return this._singlePanel && this._transform !== null &&
            !Main.sessionMode.isLocked && !Main.screenShield?.locked && !Main.screenShield?.active &&
            this._settings.get_boolean('enable-animations') &&
            St.Settings.get().reducedMotion !== St.ReducedMotion.REDUCE &&
            GLib.get_monotonic_time() - this._enabledAt > 2000000;
    }

    _prepare() {
        this._cleanup();
        if (!this._allowed() || Main.uiGroup.opacity !== 255 ||
            Main.uiGroup.rotation_angle_z !== 0) return;
        try {
            // Display dimensions are already NEW; the stage allocation is OLD.
            const width = Math.round(global.stage.width);
            const height = Math.round(global.stage.height);
            const newWidth = global.screen_width;
            const newHeight = global.screen_height;
            const swapped = width === newHeight && height === newWidth;
            const same = width === newWidth && height === newHeight;
            if (!same && !swapped) return;
            const orientation = global.backend.get_orientation_manager().get_orientation();
            const testTarget = this._testTarget;
            this._testTarget = null;
            if (orientation === Meta.Orientation.UNDEFINED && testTarget == null) return;
            const target = testTarget ?? Meta.orientation_to_transform(orientation);
            // Never guess which way a manual rotation went while the sensor is undefined.
            if ((((target - this._transform + 4) % 2) === 1) !== swapped) return;
            if (target === this._transform) return;
            let turns = (target - this._transform + 4) % 4;
            if (turns === 3) turns = -1;
            // Align the old image with the new physical output before the first frame.
            const angle = turns * 90;
            // Snapshot preparation can inflate the new frame clock's render
            // estimate. Use periodic dispatch only for this transition.
            const flag = Clutter.DrawDebugFlag.DISABLE_DYNAMIC_MAX_RENDER_TIME;
            const flags = Clutter.get_debug_flags();
            if (!(flags[1] & flag)) {
                Clutter.add_debug_flags(0, flag, 0);
                this._fixedScheduling = true;
            }
            const started = GLib.get_monotonic_time();
            const rect = new Mtk.Rectangle({x: 0, y: 0, width, height});
            const [,,,nativeScale] = global.stage.get_capture_final_size(rect);
            // Full-resolution images remain in GPU memory for this transition only.
            const captureScale = nativeScale;
            const content = global.stage.paint_to_content(rect, captureScale, null,
                Clutter.PaintFlag.NO_CURSORS);
            this._old = {width, height, target, from: this._transform, started, angle,
                captureScale, captureMs: (GLib.get_monotonic_time() - started) / 1000};
            this._overlay = new St.Widget({reactive: false, can_focus: false,
                width: newWidth, height: newHeight, style: 'background-color: #171717;'});
            this._overlay.set_clip(0, 0, newWidth, newHeight);
            this._snapshot = new Clutter.Actor({width, height, content, reactive: false,
                rotation_angle_z: angle,
                x: (newWidth - width) / 2, y: (newHeight - height) / 2});
            this._snapshot.set_pivot_point(0.5, 0.5);
            this._overlay.add_child(this._snapshot);
            global.stage.add_child(this._overlay);
            global.stage.set_child_above_sibling(this._overlay, null);
            global.compositor.disable_unredirect();
            global.begin_work();
            this._compositorHeld = true;
            // Align before the new output's first frame, without a D-Bus wait.
            this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 750, () => {
                this._timeout = 0;
                this._cleanup();
                this._record({version: 12, aborted: 'deadline', overlayReleased: true});
                return GLib.SOURCE_REMOVE;
            });
        } catch (error) {
            this._cleanup();
            this._record({error: error.message});
        }
    }

    _changed() {
        const old = this._old;
        if (old && this._allowed()) {
            this._transform = old.target;
            this._beforePaint = global.stage.connect('before-paint', () => {
                global.stage.disconnect(this._beforePaint);
                this._beforePaint = 0;
                try {
                    // Layout is now allocated, but the first new output frame
                    // has not been painted. Prepare both textures for that frame.
                    this._prepareNewImage();
                    this._firstPaint = global.stage.connect('after-paint', () => {
                        global.stage.disconnect(this._firstPaint);
                        this._firstPaint = 0;
                        this._startIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                            this._startIdle = 0;
                            if (this._old && this._allowed()) {
                                try { this._animate(); }
                                catch (error) { this._cleanup(); this._record({error: error.message}); }
                            } else this._cleanup();
                            return GLib.SOURCE_REMOVE;
                        });
                    });
                } catch (error) { this._cleanup(); this._record({error: error.message}); }
            });
        } else this._cleanup();
        this._readState();
    }

    _prepareNewImage() {
        const old = this._old;
        const settings = St.Settings.get();
        const factor = settings.slow_down_factor;
        const duration = Math.round((Math.abs(old.angle) === 180 ? 383 : DURATION) * factor);
        const report = {version: 12, count: ++this._count, from: old.from, to: old.target,
            beforeSize: [old.width, old.height], afterSize: [global.screen_width, global.screen_height],
            captureMs: old.captureMs, captureScale: old.captureScale,
            configurationMs: (GLib.get_monotonic_time() - old.started) / 1000,
            durationMs: duration, slowDownFactor: factor, mechanism: 'opaque-snapshots-no-opacity-animation', scheduling: 'periodic-during-transition-only'};
        const width = global.screen_width;
        const height = global.screen_height;
        const captureStart = GLib.get_monotonic_time();
        this._overlay.hide();
        let content;
        try {
            const rect = new Mtk.Rectangle({x: 0, y: 0, width, height});
            const [,,,scale] = global.stage.get_capture_final_size(rect);
            content = global.stage.paint_to_content(rect, scale, null, Clutter.PaintFlag.NO_CURSORS);
        } finally { this._overlay.show(); }
        report.newCaptureMs = (GLib.get_monotonic_time() - captureStart) / 1000;
        this._next = new Clutter.Actor({width, height, content, reactive: false,
            rotation_angle_z: old.angle, opacity: 255});
        this._next.set_pivot_point(0.5, 0.5);
        this._overlay.insert_child_below(this._next, this._snapshot);
        // Allocate only our own actors so their first frame can warm the
        // texture/blending pipeline before the animation clock starts.
        this._next.allocate(new Clutter.ActorBox({x1: 0, y1: 0, x2: width, y2: height}));
        this._snapshot.opacity = 255;
        this._report = report;
    }

    _animate() {
        const old = this._old;
        const report = this._report;
        const factor = report.slowDownFactor;
        report.warmupMs = (GLib.get_monotonic_time() - old.started) / 1000 - report.configurationMs;
        const frameTimes = [];
        const animationStarted = GLib.get_monotonic_time();
        let lastFrame = null;
        this._paintStats = global.stage.connect('after-paint', () => {
            const now = GLib.get_monotonic_time();
            if (lastFrame !== null) frameTimes.push((now - lastFrame) / 1000);
            lastFrame = now;
        });
        const transition = (actor, property, target, ms, delay, controls) => {
            const pspec = actor.find_property(property);
            const native = new Clutter.PropertyTransition({property_name: property,
                interval: new Clutter.Interval({value_type: pspec.value_type}),
                duration: Math.round(ms * factor), delay: Math.round(delay * factor),
                remove_on_complete: true});
            native.set_cubic_bezier_progress(
                new Graphene.Point({x: controls[0], y: controls[1]}),
                new Graphene.Point({x: controls[2], y: controls[3]}));
            actor.add_transition(property, native);
            native.set_to(target);
            return native;
        };
        // Native Clutter property transitions do all per-frame interpolation in C.
        // JavaScript only starts the transition and cleans up once it is finished.
        const rotateDuration = Math.abs(old.angle) === 180 ? 383 : DURATION;
        transition(this._snapshot, 'rotation-angle-z', 0, rotateDuration, 0, [0.2, 0, 0, 1]);
        const last = transition(this._next, 'rotation-angle-z', 0, rotateDuration, 0, [0.2, 0, 0, 1]);
        // Both images stay fully opaque. At half of the eased rotation,
        // switch layouts without any alpha dip or brightness adjustment.
        // Cubic Bezier (0.2, 0, 0, 1) reaches 50% at 20% elapsed time.
        last.add_marker('opaque-layout-swap', 0.2);
        last.connect('marker-reached::opaque-layout-swap', () => {
            if (this._old === old && this._snapshot)
                this._snapshot.hide();
        });
        last.connect('completed', () => {
            this._cleanup();
            this._record({...report, interpolation: 'native-clutter-cubic-bezier', frameIntervalsMs: frameTimes,
                actualWallMs: (GLib.get_monotonic_time() - animationStarted) / 1000,
                completed: true, overlayReleased: !this._overlay, sceneUntouched: true});
            this._readState();
        });
    }

    _record(value) {
        try {
            const dir = GLib.build_filenamev([GLib.get_user_state_dir(), 'mipad-rotation-transition']);
            GLib.mkdir_with_parents(dir, 0o700);
            GLib.file_set_contents(`${dir}/status.json`, JSON.stringify(value));
        } catch (error) { console.warn(`Rotation transition: ${error.message}`); }
    }

    _cleanup() {
        this._generation++;
        if (this._fixedScheduling) {
            Clutter.remove_debug_flags(0, Clutter.DrawDebugFlag.DISABLE_DYNAMIC_MAX_RENDER_TIME, 0);
            this._fixedScheduling = false;
        }
        if (this._beforePaint) global.stage.disconnect(this._beforePaint);
        this._beforePaint = 0;
        this._report = null;
        if (this._paintStats) global.stage.disconnect(this._paintStats);
        this._paintStats = 0;
        if (this._timeline) this._timeline.stop();
        this._timeline = null;
        if (this._compositorHeld) {
            this._compositorHeld = false;
            global.end_work();
            global.compositor.enable_unredirect();
        }
        if (this._firstPaint) global.stage.disconnect(this._firstPaint);
        this._firstPaint = 0;
        if (this._startIdle) GLib.source_remove(this._startIdle);
        this._startIdle = 0;
        if (this._repaint) Clutter.threads_remove_repaint_func(this._repaint);
        this._repaint = 0;
        if (this._timeout) GLib.source_remove(this._timeout);
        this._timeout = 0;
        const overlay = this._overlay;
        this._overlay = null;
        this._snapshot = null;
        this._next = null;
        this._old = null;
        overlay?.destroy();
    }

    disable() {
        this._active = false;
        this._manager.disconnect(this._before);
        this._manager.disconnect(this._after);
        Main.sessionMode.disconnect(this._session);
        this._cleanup();
        this._settings = null;
        this._manager = null;
    }
}
