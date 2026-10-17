import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./transition-v12.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default class', 'class');

function harness() {
    const calls = [];
    let flags = 0;
    const stage = {width:1280,height:800,connect:()=>41,disconnect:id=>calls.push(['disconnect',id]),
        get_capture_final_size:()=>[0,0,0,2],
        paint_to_content:()=>{throw new Error('simulated GPU capture failure');}};
    const global = {stage, screen_width:800, screen_height:1280,
        backend:{get_orientation_manager:()=>({get_orientation:()=>0})},
        compositor:{enable_unredirect:()=>calls.push(['unredirect']),disable_unredirect:()=>calls.push(['hold'])},
        end_work:()=>calls.push(['endWork']),begin_work:()=>calls.push(['beginWork'])};
    const Clutter = {DrawDebugFlag:{DISABLE_DYNAMIC_MAX_RENDER_TIME:512},
        get_debug_flags:()=>[0,flags,0],
        add_debug_flags:(_d,f)=>{flags|=f;calls.push(['addFlag',f]);},
        remove_debug_flags:(_d,f)=>{flags&=~f;calls.push(['removeFlag',f]);},
        PaintFlag:{NO_CURSORS:1}};
    const GLib = {get_monotonic_time:()=>3000000,source_remove:id=>calls.push(['removeSource',id])};
    const Main = {uiGroup:{opacity:255,rotation_angle_z:0},sessionMode:{isLocked:false},screenShield:{locked:false,active:false}};
    const Meta = {Orientation:{UNDEFINED:-1},orientation_to_transform:x=>x};
    const Mtk = {Rectangle:class{constructor(args){Object.assign(this,args);}}};
    const St = {Settings:{get:()=>({reducedMotion:0,slow_down_factor:1})},ReducedMotion:{REDUCE:1}};
    const Graphene = {Point:class {constructor(args){Object.assign(this,args);}}};
    const Extension = class {};
    const Rotation = new Function('Clutter','Gio','Graphene','GLib','Meta','Mtk','St','Main','Extension','global',
        `${source}\nreturn RotationTransition;`)(Clutter,{}, Graphene,GLib,Meta,Mtk,St,Main,Extension,global);
    const instance = new Rotation();
    instance._generation=0;
    instance._record=value=>calls.push(['record',value]);
    return {instance,calls,Clutter,Main,get flags(){return flags;}};
}

test('cleanup balances holds and removes all pending stage callbacks and sources once',()=>{
    const h=harness(), x=h.instance;
    h.Clutter.add_debug_flags(0,512);
    Object.assign(x,{_fixedScheduling:true,_compositorHeld:true,_beforePaint:11,_firstPaint:12,_paintStats:13,_startIdle:21,_timeout:22,
        _overlay:{destroy:()=>h.calls.push(['destroy'])},_old:{},_next:{},_snapshot:{}});
    x._cleanup();x._cleanup();
    assert.equal(h.flags,0);
    for(const name of ['endWork','unredirect','destroy','removeFlag'])
        assert.equal(h.calls.filter(c=>c[0]===name).length,1,name);
    assert.deepEqual(h.calls.filter(c=>c[0]==='disconnect').map(c=>c[1]).sort(),[11,12,13]);
    assert.deepEqual(h.calls.filter(c=>c[0]==='removeSource').map(c=>c[1]).sort(),[21,22]);
    for(const key of ['_overlay','_old','_next','_snapshot'])assert.equal(x[key],null,key);
});

test('capture failure rolls back the scheduling flag before creating an overlay',()=>{
    const h=harness(),x=h.instance;
    x._allowed=()=>true;x._transform=3;x._prepare();
    assert.equal(h.flags,0);assert.equal(x._overlay,null);
    assert.equal(h.calls.filter(c=>c[0]==='removeFlag').length,1);
    assert.ok(h.calls.some(c=>c[0]==='record'&&c[1].error==='simulated GPU capture failure'));
});

test('a preexisting scheduling flag is not cleared on capture failure',()=>{
    const h=harness(),x=h.instance;
    h.Clutter.add_debug_flags(0,512);
    x._allowed=()=>true;x._transform=3;x._prepare();
    assert.equal(h.flags,512);
    assert.equal(h.calls.filter(c=>c[0]==='removeFlag').length,0);
});

test('locked or blank screens and startup grace period skip animation',()=>{
    const h=harness(),x=h.instance;
    Object.assign(x,{_singlePanel:true,_transform:3,_enabledAt:0,_settings:{get_boolean:()=>true}});
    assert.equal(x._allowed(),true);
    x._enabledAt=2000000;assert.equal(x._allowed(),false);
    x._enabledAt=0;h.Main.sessionMode.isLocked=true;assert.equal(x._allowed(),false);
    h.Main.sessionMode.isLocked=false;h.Main.screenShield.active=true;assert.equal(x._allowed(),false);
    h.Main.screenShield.active=false;x._singlePanel=false;assert.equal(x._allowed(),false);
});


test('no-fade animation uses rotation only and an opaque layout switch',()=>{
    const h=harness(),x=h.instance, transitions=[];
    h.Clutter.Interval=class {};
    h.Clutter.PropertyTransition=class {
        constructor(args){this.property=args.property_name;this.handlers={};transitions.push(this);}
        set_cubic_bezier_progress(){}
        set_to(value){this.target=value;}
        add_marker(name,progress){this.marker={name,progress};}
        connect(name,callback){this.handlers[name]=callback;}
    };
    const actor=()=>({opacity:255,find_property:()=>({value_type:'double'}),add_transition(){},hide(){this.hidden=true;}});
    x._old={angle:90,started:0};x._report={slowDownFactor:1,configurationMs:0};
    x._snapshot=actor();x._next=actor();
    x._animate();
    assert.deepEqual(transitions.map(t=>t.property),['rotation-angle-z','rotation-angle-z']);
    assert.equal(x._snapshot.opacity,255);assert.equal(x._next.opacity,255);
    assert.deepEqual(transitions[1].marker,{name:'opaque-layout-swap',progress:0.2});
    transitions[1].handlers['marker-reached::opaque-layout-swap']();
    assert.equal(x._snapshot.hidden,true);
});
