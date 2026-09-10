---
title: "一键查看 SSR 状态：可折叠 JSON 树 Bookmarklet"
date: 2026-08-18T17:00:00+08:00
draft: false
description: "用一个可配置的 Bookmarklet，读取 SSR 注入的全局对象或 JSON Script，并转换为可折叠、可搜索、可复制的 JSON 树。"
tags: ["SSR", "Bookmarklet", "JavaScript", "Vue", "前端调试"]
categories: ["技术"]
cover:
  image: "/images/covers/ssr-state-viewer-bookmarklet.png"
  alt: "书签工具展开浏览器中的 JSON 状态树"
  relative: false
---

SSR 页面常把首屏请求结果随 HTML 注入浏览器。为了减少反复打开 Console、查找状态位置和手动输入命令的操作，可以把检查脚本存成 Bookmarklet（书签脚本）：点击书签，直接在当前页面展开一棵可搜索、可复制的 JSON 树。

## 状态来源与功能

SSR 状态没有跨框架统一的名字或载体：Vue SSR 项目可能使用自定义全局变量，Nuxt、Remix 有各自的状态对象，Next.js 等项目还可能使用 JSON Script 节点。书签支持全局变量、嵌套路径和 `script#元素ID`，按配置顺序读取第一个命中项。

面板提供可折叠 JSON 树、类型配色、值搜索和 JSON 复制。可以拖动标题栏调整位置，再次点击书签即可关闭。

## 使用方法

### 1. 存书签

1. `Cmd+Shift+B`（Windows `Ctrl+Shift+B`）打开书签栏
2. 书签栏空白处**右键 → 添加页面**（Chrome）/ **添加网页**（Edge）
3. 名称填 `看State`，网址(URL)粘贴下方脚本（**整段单行，勿断行**）
4. 保存

> 若右键没有「添加页面」：`⋮ → 书签 → 书签管理器 → ⋮ → 添加新书签`。

### 2. 使用

1. 打开目标生产页面
2. 点书签栏 `看State`
3. 面板浮到右上角，拖动标题栏移动，点 ✕ 或再点书签关闭

### 3. 配置读取来源（可选）

若当前页面状态不在默认候选里：

1. 点面板右上角 **⚙ 按钮**；
2. 每行填写一个来源，按顺序读取第一个命中项；
3. 点 **保存并读取**，配置会写入 `localStorage` 并立即生效；
4. 标题栏会显示实际命中的来源，例如 `[script#__NEXT_DATA__]`。

支持三种写法：

```plaintext
__SSR_PAYLOAD__
window.__NUXT__.data
script#__NEXT_DATA__
```

三行分别表示 `window` 顶层属性、`window` 嵌套路径和 JSON Script 元素 ID。这里用 `__SSR_PAYLOAD__` 作为中性示例名。

默认候选仍包括真实项目常用的 `__INITIAL_STATE__`，以及 `__NUXT__`、`__remixContext`、`__INITIAL_DATA__`、`__PRELOADED_STATE__`、`script#__NEXT_DATA__` 和 `script#__NUXT_DATA__`。工具只读取命中的来源，不会覆盖或修改这些业务变量。

> 框架升级也可能改变注入结构。候选列表只提供常见默认值，团队使用自定义来源时，建议把配置同步到项目调试文档。

## 数据转换与展示

读取到的状态可能包含响应式对象、类实例和循环引用。转换时，ref 递归取 `.value`，普通对象枚举自身字段，其他类实例会被跳过；Date、Map 和 Set 有单独的转换逻辑。因此，面板显示的是转换后的数据视图，复制结果不保留所有原始对象信息。

转换过程用 `WeakSet` 跟踪当前递归路径，循环引用标为 `[Circular]`，共享引用仍正常展开。面板先显示加载提示，再通过 `requestAnimationFrame` 延后转换和树渲染；大对象的处理仍在主线程执行。

## 书签代码

下面提供日常使用的完整书签，以及用于阅读转换逻辑的简化示例。两者功能不同。

### 完整书签（一行版）

含折叠、颜色区分、⚙ 可配置读取来源、搜索、复制、loading、拖动，适合日常高频使用：

```javascript
javascript:(function(){var old=document.getElementById('__statePanel');if(old){old.remove();return;}function loadVars(){try{var s=localStorage.getItem('__sp_vars');if(s){var a=JSON.parse(s);if(a&&a.length)return a.filter(Boolean);}}catch(e){}return ['__INITIAL_STATE__','__NUXT__','__remixContext','__INITIAL_DATA__','__PRELOADED_STATE__','script#__NEXT_DATA__','script#__NUXT_DATA__'];}function findState(){var vs=loadVars();for(var i=0;i<vs.length;i++){var n=vs[i].trim();if(!n)continue;try{if(n.indexOf('script#')===0){var el=document.getElementById(n.slice(7));if(el&&el.textContent)return {name:n,value:JSON.parse(el.textContent)};}else{var path=n.replace(/^window\./,'').split('.'),v=window;for(var j=0;j<path.length;j++){if(v==null){v=undefined;break;}v=v[path[j]];}if(v!==undefined)return {name:n,value:v};}}catch(e){}}return null;}var p=document.createElement('div');p.id='__statePanel';p.style.cssText='position:fixed;top:60px;right:20px;width:540px;max-height:700px;background:#1e1e1e;color:#ddd;font:12px/1.5 Menlo,Consolas,monospace;z-index:2147483647;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.5);overflow:hidden;display:flex;flex-direction:column;';var h=document.createElement('div');h.style.cssText='display:flex;align-items:center;gap:6px;padding:8px 10px;background:#2d2d2d;cursor:move;flex-wrap:wrap;';h.innerHTML='<b style="color:#7ee699">State</b><span id="__sp_name" style="color:#888;font-size:11px;"></span><span style="flex:1"></span><button id="__sp_g" title="配置读取来源" style="border:1px solid #555;background:none;color:#ddd;padding:1px 7px;border-radius:4px;cursor:pointer;">⚙</button><input id="__sp_q" placeholder="搜索值" style="width:110px;border:1px solid #555;background:#111;color:#ddd;padding:3px 6px;border-radius:4px;"><button id="__sp_c" style="border:none;background:#0a84ff;color:#fff;padding:3px 8px;border-radius:4px;cursor:pointer;">复制JSON</button><button id="__sp_x" style="border:none;background:none;color:#ddd;cursor:pointer;font-size:14px;">✕</button>';var box=document.createElement('div');box.style.cssText='padding:10px;overflow:auto;max-height:68vh;';p.appendChild(h);p.appendChild(box);document.body.appendChild(p);var cfg=document.createElement('div');cfg.style.cssText='position:absolute;top:40px;left:0;right:0;background:#2d2d2d;padding:12px;display:none;z-index:2;border-bottom:1px solid #444;';cfg.innerHTML='<div style="color:#ddd;margin-bottom:6px;">配置读取来源（全局变量/路径，或 script#元素ID；每行一个）：</div><textarea id="__sp_v" style="width:100%;height:80px;background:#111;color:#7ec699;border:1px solid #555;border-radius:4px;padding:6px;font:12px monospace;box-sizing:border-box;"></textarea><div style="margin-top:8px;text-align:right;"><button id="__sp_sv" style="border:none;background:#0a84ff;color:#fff;padding:4px 12px;border-radius:4px;cursor:pointer;margin-right:6px;">保存并读取</button><button id="__sp_cv" style="border:none;background:#444;color:#ddd;padding:4px 12px;border-radius:4px;cursor:pointer;">取消</button></div>';p.appendChild(cfg);function toPlain(v,seen){if(v===null)return v;var t=typeof v;if(t==='function')return undefined;if(t!=='object')return v;if(v instanceof Date)return v.toISOString();if(v.__v_isRef===true)return toPlain(v.value,seen);if(seen.has(v))return '[Circular]';seen.add(v);var r;if(v instanceof Map){r={};v.forEach(function(x,k){var y=toPlain(x,seen);if(y!==undefined)r[String(k)]=y;});}else if(v instanceof Set){r=[];v.forEach(function(x){var y=toPlain(x,seen);if(y!==undefined)r.push(y);});}else if(Array.isArray(v)){r=[];for(var i=0;i<v.length;i++){var y=toPlain(v[i],seen);r.push(y===undefined?null:y);}}else{var proto=Object.getPrototypeOf(v);if(proto!==Object.prototype&&proto!==null){seen.delete(v);return undefined;}r={};for(var j in v){if(Object.prototype.hasOwnProperty.call(v,j)){var y=toPlain(v[j],seen);if(y!==undefined)r[j]=y;}}}seen.delete(v);return r;}function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}function build(k,v,auto){var wrap=document.createElement('div');var line=document.createElement('div');line.style.cssText='white-space:nowrap;cursor:pointer;';var isObj=(v!==null&&typeof v==='object');if(isObj){var isArr=Array.isArray(v);if(k!==null&&k!==undefined){var ks=document.createElement('span');ks.style.cssText='color:#7fb3d5;';ks.textContent=String(k)+': ';line.appendChild(ks);}var arrow=document.createElement('span');arrow.style.cssText='display:inline-block;width:13px;color:#888;';var cnt=isArr?v.length:Object.keys(v).length;var sum=document.createElement('span');sum.style.cssText='color:#666;';sum.textContent=isArr?'['+cnt+']':'{'+cnt+'}';line.appendChild(arrow);line.appendChild(sum);var child=document.createElement('div');child.style.cssText='padding-left:16px;border-left:1px dotted #444;margin-left:6px;';var opened=!!auto;child.style.display=opened?'block':'none';arrow.textContent=opened?'▾':'▸';line.onclick=function(){opened=!opened;arrow.textContent=opened?'▾':'▸';child.style.display=opened?'block':'none';};wrap.appendChild(line);if(isArr){for(var i=0;i<v.length;i++)child.appendChild(build(i,v[i]));}else{for(var kk in v){if(Object.prototype.hasOwnProperty.call(v,kk))child.appendChild(build(kk,v[kk]));}}wrap.appendChild(child);}else{var label,col;if(v===null){label='null';col='#999';}else if(typeof v==='string'){label='"'+esc(v)+'"';col='#7ec699';}else if(typeof v==='number'){label=String(v);col='#f78c6c';}else if(typeof v==='boolean'){label=String(v);col='#c792ea';}else{label=String(v);col='#999';}if(k!==null&&k!==undefined){var ks2=document.createElement('span');ks2.style.cssText='color:#7fb3d5;';ks2.textContent=String(k)+': ';line.appendChild(ks2);}var vs=document.createElement('span');vs.style.cssText='color:'+col+';';vs.textContent=label;line.appendChild(vs);wrap.appendChild(line);}return wrap;}function contains(v,q){if(v===null||v===undefined)return false;if(typeof v!=='object')return String(v).toLowerCase().indexOf(q.toLowerCase())>-1;for(var k in v){if(Object.prototype.hasOwnProperty.call(v,k)&&contains(v[k],q))return true;}return false;}function filter(v,q){if(v===null||v===undefined)return v;if(typeof v!=='object')return contains(v,q)?v:undefined;if(Array.isArray(v)){var a=[];for(var i=0;i<v.length;i++){if(contains(v[i],q))a.push(filter(v[i],q));}return a;}var o={};for(var k in v){if(Object.prototype.hasOwnProperty.call(v,k)){if(contains(v[k],q))o[k]=filter(v[k],q);}}return o;}function render(data,rootFl){box.innerHTML='';if(data===undefined){var m=document.createElement('div');m.textContent='（没有匹配）';m.style.cssText='color:#888;padding:10px;';box.appendChild(m);return;}box.appendChild(build(null,data,rootFl));}var plain;function stName(s){var e=document.getElementById('__sp_name');if(e)e.textContent=s;}function doLoad(){var hit=findState();if(!hit){stName('');render(undefined,false);var mm=document.createElement('div');mm.style.cssText='color:#f78c6c;padding:10px;';mm.innerHTML='未找到任何候选来源。<br>请点右上角 ⚙ 配置全局路径或 JSON Script ID。';box.appendChild(mm);return;}stName('['+hit.name+']');plain=null;box.innerHTML='<div style="color:#888;padding:20px;text-align:center;font-size:13px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #555;border-top-color:#0a84ff;border-radius:50%;animation:__sp .8s linear infinite;vertical-align:-2px;margin-right:8px;"></span>序列化中…</div>';var val=hit.value;requestAnimationFrame(function(){requestAnimationFrame(function(){plain=toPlain(val,new WeakSet());render(plain,true);});});}document.getElementById('__sp_x').onclick=function(){p.remove();};document.getElementById('__sp_c').onclick=function(){if(!plain)return;var ta=document.createElement('textarea');ta.value=JSON.stringify(plain,null,2);document.body.appendChild(ta);ta.select();try{document.execCommand('copy');alert('已复制');}catch(e){alert('复制失败');}document.body.removeChild(ta);};document.getElementById('__sp_q').oninput=function(){if(!plain)return;var q=this.value;if(!q){render(plain,true);}else if(!contains(plain,q)){render(undefined,false);}else{render(filter(plain,q),true);}};document.getElementById('__sp_g').onclick=function(){cfg.style.display=cfg.style.display==='none'?'block':'none';if(cfg.style.display==='block'){document.getElementById('__sp_v').value=loadVars().join('\n');}};document.getElementById('__sp_cv').onclick=function(){cfg.style.display='none';};document.getElementById('__sp_sv').onclick=function(){var lines=document.getElementById('__sp_v').value.split('\n').map(function(x){return x.trim();}).filter(Boolean);try{localStorage.setItem('__sp_vars',JSON.stringify(lines));}catch(e){}cfg.style.display='none';doLoad();};var sx,sy,ox,oy,drag=false;h.addEventListener('mousedown',function(e){if(e.target.tagName==='INPUT'||e.target.tagName==='BUTTON'||e.target.tagName==='TEXTAREA')return;drag=true;sx=e.clientX;sy=e.clientY;ox=p.offsetLeft;oy=p.offsetTop;});document.addEventListener('mousemove',function(e){if(!drag)return;p.style.left=(ox+e.clientX-sx)+'px';p.style.right='auto';p.style.top=(oy+e.clientY-sy)+'px';});document.addEventListener('mouseup',function(){drag=false;});doLoad();})();
```

### 简化示例（纯文本展示）

此示例保留固定候选来源、数据转换、纯文本展示、复制和拖动，省略了可配置来源、折叠树、搜索及加载提示。它用于说明核心逻辑，并非上方完整书签的格式化版本。

```javascript
javascript:(function () {
  // 再次点击书签 = 关闭已打开的面板
  var old = document.getElementById('__statePanel');
  if (old) { old.remove(); return; }

  // ① 按顺序读取全局变量或 JSON Script；候选项可按项目调整
  function readJsonScript(id) {
    var el = document.getElementById(id);
    if (!el || !el.textContent) return undefined;
    try { return JSON.parse(el.textContent); }
    catch (e) { return undefined; }
  }

  var candidates = [
    window.__INITIAL_STATE__,
    window.__NUXT__,
    window.__remixContext,
    window.__INITIAL_DATA__,
    window.__PRELOADED_STATE__,
    readJsonScript('__NEXT_DATA__'),
    readJsonScript('__NUXT_DATA__')
  ];
  var st;
  for (var c = 0; c < candidates.length; c++) {
    if (candidates[c] !== undefined) { st = candidates[c]; break; }
  }
  if (st === undefined) { alert('未找到任何候选状态来源'); return; }

  // ② 把响应式对象剥成纯数据：
  //    ref 取 .value；reactive 只留真实字段；丢弃类实例；防止循环引用
  function toPlain(v, seen) {
    if (v === null) return null;
    var t = typeof v;
    if (t === 'function') return undefined;
    if (t !== 'object') return v;
    if (v instanceof Date) return v.toISOString();
    if (v.__v_isRef === true) return toPlain(v.value, seen);
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    var r;
    if (v instanceof Map) {
      r = {};
      v.forEach(function (x, k) {
        var y = toPlain(x, seen);
        if (y !== undefined) r[String(k)] = y;
      });
    } else if (v instanceof Set) {
      r = [];
      v.forEach(function (x) {
        var y = toPlain(x, seen);
        if (y !== undefined) r.push(y);
      });
    } else if (Array.isArray(v)) {
      r = [];
      for (var i = 0; i < v.length; i++) {
        var y = toPlain(v[i], seen);
        r.push(y === undefined ? null : y);
      }
    } else {
      var proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) {
        seen.delete(v);
        return undefined;
      }
      r = {};
      for (var j in v) {
        if (Object.prototype.hasOwnProperty.call(v, j)) {
          var y = toPlain(v[j], seen);
          if (y !== undefined) r[j] = y;
        }
      }
    }
    seen.delete(v);
    return r;
  }

  // ③ 序列化为带缩进的纯文本（不折叠成树，直接全量展示）
  var txt;
  try {
    txt = JSON.stringify(toPlain(st, new WeakSet()), null, 2);
  } catch (e) {
    txt = '序列化失败: ' + e.message;
  }

  // ④ 创建浮动面板：纯文本展示 + 复制 + 拖动 + 关闭
  var p = document.createElement('div');
  p.id = '__statePanel';
  p.style.cssText =
    'position:fixed;top:60px;right:20px;width:520px;max-height:680px;' +
    'background:#1e1e1e;color:#ddd;font:12px/1.5 Menlo,Consolas,monospace;' +
    'z-index:2147483647;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.5);' +
    'overflow:hidden;display:flex;flex-direction:column;';

  var h = document.createElement('div');
  h.style.cssText = 'display:flex;align-items:center;padding:8px 10px;background:#2d2d2d;cursor:move;';
  h.innerHTML =
    '<b style="flex:1;color:#7ee699">STATE</b>' +
    '<button id="__sp_c" style="border:none;background:#0a84ff;color:#fff;' +
    'padding:3px 8px;border-radius:4px;cursor:pointer;margin-right:8px;">复制JSON</button>' +
    '<button id="__sp_x" style="border:none;background:none;color:#ddd;' +
    'cursor:pointer;font-size:14px;">✕</button>';

  var pre = document.createElement('pre');
  pre.style.cssText = 'margin:0;padding:10px;overflow:auto;max-height:68vh;white-space:pre;';
  pre.textContent = txt;
  p.appendChild(h); p.appendChild(pre);
  document.body.appendChild(p);

  document.getElementById('__sp_x').onclick = function () { p.remove(); };
  document.getElementById('__sp_c').onclick = function () {
    var ta = document.createElement('textarea');
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); alert('已复制'); }
    catch (e) { alert('复制失败'); }
    document.body.removeChild(ta);
  };

  // 拖动
  var sx, sy, ox, oy, drag = false;
  h.addEventListener('mousedown', function (e) {
    if (e.target.tagName === 'BUTTON') return;
    drag = true; sx = e.clientX; sy = e.clientY;
    ox = p.offsetLeft; oy = p.offsetTop;
  });
  document.addEventListener('mousemove', function (e) {
    if (!drag) return;
    p.style.left = (ox + e.clientX - sx) + 'px';
    p.style.right = 'auto';
    p.style.top = (oy + e.clientY - sy) + 'px';
  });
  document.addEventListener('mouseup', function () { drag = false; });
})();
```

## 兼容性说明

- **Chrome / Edge**：完全兼容，推荐
- **Firefox**：可用（复制权限需额外授权一次）
- **Safari**：不同版本和安全设置下表现可能不同；若脚本无法执行，建议改用 Chrome 或 Edge
