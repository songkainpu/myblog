---
title: "一键查看 SSR 状态：可折叠 JSON 树 Bookmarklet"
date: 2026-08-18T17:00:00+08:00
draft: false
description: "用一个可配置的 Bookmarklet，把 SSR 注入 window 的状态转换为可折叠、可搜索、可复制的 JSON 树，并处理 Vue 响应式对象与循环引用。"
tags: ["SSR", "Bookmarklet", "JavaScript", "Vue", "前端调试"]
categories: ["技术"]
---

SSR 页面常把首屏请求结果注入 `window`。遇到线上数据异常时，与其反复打开 Console、手敲变量名，不如把检查动作收进一个 Bookmarklet（书签脚本）：点击书签，直接在当前页面展开一棵可搜索、可复制的 JSON 树。

## 为什么需要这个工具

本项目是 **SSR（服务端渲染）** 应用，很多接口请求在**服务端渲染阶段就已经完成**，结果会写入 `window.__INITIAL_STATE__` 随首屏一起下发给客户端。

这带来一个麻烦：**在生产环境，我们很难知道这些请求具体返回了什么结果。**

- 测试环境：可以让开发在服务端加日志，把请求结果打出来看；
- 生产环境：不适合直接打日志（性能、敏感信息、排查成本等顾虑），所以排查「某个数据为什么不对」时，只能靠频繁点击复现 + 在 Console 手敲 `console.log(window.__INITIAL_STATE__)`，非常低效。

因此做了这个书签：一键把状态以**可折叠的 JSON 树**浮现在页面上，代替反复手敲 log。

## 从“能打印”到“真正好用”

实现时发现 `__INITIAL_STATE__` 并不是一个简单纯 JSON 对象，逐层踩坑并改进：

1. **循环引用**：它是 Vue 3 响应式对象，内部 `ReactiveEffect / Link / Dep` 相互引用成环，直接 `JSON.stringify` 会抛 `Converting circular structure to JSON`。→ 改用带 `WeakSet` 记忆的防循环序列化，真正成环处标为 `[Circular]`。
2. **响应式 / 类实例包裹太重**：展开后满屏 `ReactiveEffect / Route / Link / [Ref]`，业务数据被淹没。→ 增加递归「剥壳」：ref 打平取 `.value`、reactive/proxy 只枚举真实字段、原型非 `Object.prototype` 的类实例直接丢弃，只留纯业务数据。
3. **一大段 JSON 难以阅读**：纯文本刷屏、无层级。→ 改成**可折叠树**，颜色区分类型（字段名蓝 / 字符串绿 / 数字橙 / 布尔紫 / null 灰），逐节点展开收起。
4. **state 较大时点击白屏卡顿**：同步序列化卡死主线程，loading 无法先显示。→ 先绘制面板 + 转圈，再用 `requestAnimationFrame` 把重序列化推迟到下一帧，算完自动替换。
5. **变量名不通用**：不是所有 SSR 都叫 `__INITIAL_STATE__`（Nuxt 用 `__NUXT__`、Next 用 `__NEXT_DATA__`、Remix 用 `__remixContext`…）。→ 增加 **⚙ 可配置变量名**：按顺序探测一批变量名，并支持在面板里自定义、存 `localStorage` 持久化。

## 功能一览

- **一键浮层**：点书签 → 右上角浮出面板，显示状态内容
- **可折叠树**：`▸/▾` 逐节点展开收起
- **颜色区分类型**：字段名蓝 · 字符串绿 · 数字橙 · 布尔紫 · null 灰 · 对象 `{N}` / 数组 `[N]`
- **自动剥响应式外壳**：ref 取 `.value`、reactive 只留真实字段、丢类实例
- **防循环引用**：真的环标 `[Circular]`，共享引用正常展开
- **⚙ 可配置变量名**：默认探测一批常见变量，可自定义并持久化（详见「配置变量名」）
- **搜索定位**：输入关键词，只留下含它的整条路径并全部展开
- **复制 JSON**：一键复制剥壳后的纯数据
- **加载提示**：state 较大时先「序列化中…」，算完替换为树
- **可拖动**：拖标题栏移动；再点一次书签关闭（开关式）

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

### 3. 配置变量名（可选）

若当前页面状态不在默认候选里，或想改成别名：

1. 点面板右上角 **⚙ 按钮** → 弹出配置框
2. 文本框里**每行一个**全局变量名，按顺序取**第一个命中**（非 undefined）的
3. 点 **保存并读取** → 存进 `localStorage` 并立即重读
4. 顶部标题栏会显示当前实际命中的变量名（如 `[__NUXT__]`）

默认候选（无需配置即可用）：

```plaintext
__INITIAL_STATE__
__NUXT__
__NEXT_DATA__
__remixContext
__INITIAL_DATA__
__PRELOADED_STATE__
```

> 配置存在每个浏览器的 `localStorage`，换浏览器/清缓存会回到默认候选。团队共享请把自定义变量名写进本文档说明。

## 完整代码

存书签时，名称填 `看State`，网址(URL)粘贴代码，**整段单行、勿断行**。

### 版本 A：可折叠树（推荐，功能完整）

含折叠、颜色区分、⚙ 可配置变量名、搜索、复制、loading、拖动，适合日常高频使用：

```javascript
javascript:(function(){var old=document.getElementById('__statePanel');if(old){old.remove();return;}function loadVars(){try{var s=localStorage.getItem('__sp_vars');if(s){var a=JSON.parse(s);if(a&&a.length)return a.filter(Boolean);}}catch(e){}return ['__INITIAL_STATE__','__NUXT__','__NEXT_DATA__','__remixContext','__INITIAL_DATA__','__PRELOADED_STATE__'];}function findState(){var vs=loadVars();for(var i=0;i<vs.length;i++){var n=vs[i].trim();if(n&&window[n]!==undefined)return {name:n,value:window[n]};}return null;}var p=document.createElement('div');p.id='__statePanel';p.style.cssText='position:fixed;top:60px;right:20px;width:540px;max-height:700px;background:#1e1e1e;color:#ddd;font:12px/1.5 Menlo,Consolas,monospace;z-index:2147483647;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.5);overflow:hidden;display:flex;flex-direction:column;';var h=document.createElement('div');h.style.cssText='display:flex;align-items:center;gap:6px;padding:8px 10px;background:#2d2d2d;cursor:move;flex-wrap:wrap;';h.innerHTML='<b style="color:#7ee699">State</b><span id="__sp_name" style="color:#888;font-size:11px;"></span><span style="flex:1"></span><button id="__sp_g" title="配置变量名" style="border:1px solid #555;background:none;color:#ddd;padding:1px 7px;border-radius:4px;cursor:pointer;">⚙</button><input id="__sp_q" placeholder="搜索值" style="width:110px;border:1px solid #555;background:#111;color:#ddd;padding:3px 6px;border-radius:4px;"><button id="__sp_c" style="border:none;background:#0a84ff;color:#fff;padding:3px 8px;border-radius:4px;cursor:pointer;">复制JSON</button><button id="__sp_x" style="border:none;background:none;color:#ddd;cursor:pointer;font-size:14px;">✕</button>';var box=document.createElement('div');box.style.cssText='padding:10px;overflow:auto;max-height:68vh;';p.appendChild(h);p.appendChild(box);document.body.appendChild(p);var cfg=document.createElement('div');cfg.style.cssText='position:absolute;top:40px;left:0;right:0;background:#2d2d2d;padding:12px;display:none;z-index:2;border-bottom:1px solid #444;';cfg.innerHTML='<div style="color:#ddd;margin-bottom:6px;">配置要读取的全局变量名（每行一个，按顺序取第一个命中的）：</div><textarea id="__sp_v" style="width:100%;height:80px;background:#111;color:#7ec699;border:1px solid #555;border-radius:4px;padding:6px;font:12px monospace;box-sizing:border-box;"></textarea><div style="margin-top:8px;text-align:right;"><button id="__sp_sv" style="border:none;background:#0a84ff;color:#fff;padding:4px 12px;border-radius:4px;cursor:pointer;margin-right:6px;">保存并读取</button><button id="__sp_cv" style="border:none;background:#444;color:#ddd;padding:4px 12px;border-radius:4px;cursor:pointer;">取消</button></div>';p.appendChild(cfg);function toPlain(v,seen){if(v===null)return v;var t=typeof v;if(t==='function')return undefined;if(t!=='object')return v;if(v instanceof Date)return v.toISOString();if(v.__v_isRef===true)return toPlain(v.value,seen);if(seen.has(v))return '[Circular]';seen.add(v);var r;if(v instanceof Map){r={};v.forEach(function(x,k){var y=toPlain(x,seen);if(y!==undefined)r[String(k)]=y;});}else if(v instanceof Set){r=[];v.forEach(function(x){var y=toPlain(x,seen);if(y!==undefined)r.push(y);});}else if(Array.isArray(v)){r=[];for(var i=0;i<v.length;i++){var y=toPlain(v[i],seen);r.push(y===undefined?null:y);}}else{var proto=Object.getPrototypeOf(v);if(proto!==Object.prototype&&proto!==null){seen.delete(v);return undefined;}r={};for(var j in v){if(Object.prototype.hasOwnProperty.call(v,j)){var y=toPlain(v[j],seen);if(y!==undefined)r[j]=y;}}}seen.delete(v);return r;}function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}function build(k,v,auto){var wrap=document.createElement('div');var line=document.createElement('div');line.style.cssText='white-space:nowrap;cursor:pointer;';var isObj=(v!==null&&typeof v==='object');if(isObj){var isArr=Array.isArray(v);if(k!==null&&k!==undefined){var ks=document.createElement('span');ks.style.cssText='color:#7fb3d5;';ks.textContent=String(k)+': ';line.appendChild(ks);}var arrow=document.createElement('span');arrow.style.cssText='display:inline-block;width:13px;color:#888;';var cnt=isArr?v.length:Object.keys(v).length;var sum=document.createElement('span');sum.style.cssText='color:#666;';sum.textContent=isArr?'['+cnt+']':'{'+cnt+'}';line.appendChild(arrow);line.appendChild(sum);var child=document.createElement('div');child.style.cssText='padding-left:16px;border-left:1px dotted #444;margin-left:6px;';var opened=!!auto;child.style.display=opened?'block':'none';arrow.textContent=opened?'▾':'▸';line.onclick=function(){opened=!opened;arrow.textContent=opened?'▾':'▸';child.style.display=opened?'block':'none';};wrap.appendChild(line);if(isArr){for(var i=0;i<v.length;i++)child.appendChild(build(i,v[i]));}else{for(var kk in v){if(Object.prototype.hasOwnProperty.call(v,kk))child.appendChild(build(kk,v[kk]));}}wrap.appendChild(child);}else{var label,col;if(v===null){label='null';col='#999';}else if(typeof v==='string'){label='"'+esc(v)+'"';col='#7ec699';}else if(typeof v==='number'){label=String(v);col='#f78c6c';}else if(typeof v==='boolean'){label=String(v);col='#c792ea';}else{label=String(v);col='#999';}if(k!==null&&k!==undefined){var ks2=document.createElement('span');ks2.style.cssText='color:#7fb3d5;';ks2.textContent=String(k)+': ';line.appendChild(ks2);}var vs=document.createElement('span');vs.style.cssText='color:'+col+';';vs.textContent=label;line.appendChild(vs);wrap.appendChild(line);}return wrap;}function contains(v,q){if(v===null||v===undefined)return false;if(typeof v!=='object')return String(v).toLowerCase().indexOf(q.toLowerCase())>-1;for(var k in v){if(Object.prototype.hasOwnProperty.call(v,k)&&contains(v[k],q))return true;}return false;}function filter(v,q){if(v===null||v===undefined)return v;if(typeof v!=='object')return contains(v,q)?v:undefined;if(Array.isArray(v)){var a=[];for(var i=0;i<v.length;i++){if(contains(v[i],q))a.push(filter(v[i],q));}return a;}var o={};for(var k in v){if(Object.prototype.hasOwnProperty.call(v,k)){if(contains(v[k],q))o[k]=filter(v[k],q);}}return o;}function render(data,rootFl){box.innerHTML='';if(data===undefined){var m=document.createElement('div');m.textContent='（没有匹配）';m.style.cssText='color:#888;padding:10px;';box.appendChild(m);return;}box.appendChild(build(null,data,rootFl));}var plain;function stName(s){var e=document.getElementById('__sp_name');if(e)e.textContent=s;}function doLoad(){var hit=findState();if(!hit){stName('');render(undefined,false);var mm=document.createElement('div');mm.style.cssText='color:#f78c6c;padding:10px;';mm.innerHTML='未找到任何候选变量。<br>请点右上角 ⚙ 配置你的全局变量名。';box.appendChild(mm);return;}stName('['+hit.name+']');plain=null;box.innerHTML='<div style="color:#888;padding:20px;text-align:center;font-size:13px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #555;border-top-color:#0a84ff;border-radius:50%;animation:__sp .8s linear infinite;vertical-align:-2px;margin-right:8px;"></span>序列化中…</div>';var val=hit.value;requestAnimationFrame(function(){requestAnimationFrame(function(){plain=toPlain(val,new WeakSet());render(plain,true);});});}document.getElementById('__sp_x').onclick=function(){p.remove();};document.getElementById('__sp_c').onclick=function(){if(!plain)return;var ta=document.createElement('textarea');ta.value=JSON.stringify(plain,null,2);document.body.appendChild(ta);ta.select();try{document.execCommand('copy');alert('已复制');}catch(e){alert('复制失败');}document.body.removeChild(ta);};document.getElementById('__sp_q').oninput=function(){if(!plain)return;var q=this.value;if(!q){render(plain,true);}else if(!contains(plain,q)){render(undefined,false);}else{render(filter(plain,q),true);}};document.getElementById('__sp_g').onclick=function(){cfg.style.display=cfg.style.display==='none'?'block':'none';if(cfg.style.display==='block'){document.getElementById('__sp_v').value=loadVars().join('\n');}};document.getElementById('__sp_cv').onclick=function(){cfg.style.display='none';};document.getElementById('__sp_sv').onclick=function(){var lines=document.getElementById('__sp_v').value.split('\n').map(function(x){return x.trim();}).filter(Boolean);try{localStorage.setItem('__sp_vars',JSON.stringify(lines));}catch(e){}cfg.style.display='none';doLoad();};var sx,sy,ox,oy,drag=false;h.addEventListener('mousedown',function(e){if(e.target.tagName==='INPUT'||e.target.tagName==='BUTTON'||e.target.tagName==='TEXTAREA')return;drag=true;sx=e.clientX;sy=e.clientY;ox=p.offsetLeft;oy=p.offsetTop;});document.addEventListener('mousemove',function(e){if(!drag)return;p.style.left=(ox+e.clientX-sx)+'px';p.style.right='auto';p.style.top=(oy+e.clientY-sy)+'px';});document.addEventListener('mouseup',function(){drag=false;});doLoad();})();
```

### 版本 B：不折叠 + 带注释（简版，便于阅读/修改）

下面是**格式化、带注释的可读版**（专用来看逻辑和二次修改，不是直接粘进书签；要放书签请用上方版本 A 的单行版）：

```javascript
javascript:(function () {
  // 再次点击书签 = 关闭已打开的面板
  var old = document.getElementById('__statePanel');
  if (old) { old.remove(); return; }

  // ① 探测全局状态变量：按顺序取第一个命中的（可自行增删候选名）
  var st = window.__INITIAL_STATE__
        || window.__NUXT__
        || window.__NEXT_DATA__
        || window.__remixContext
        || window.__INITIAL_DATA__
        || window.__PRELOADED_STATE__;
  if (st === undefined) { alert('未找到任何状态变量'); return; }

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

## 常见问题

| 现象 | 原因 / 解决 |
| --- | --- |
| 点书签没反应 | 确认当前是业务页（有状态注入），不是空白页/登录页 |
| 提示「未找到任何候选变量」 | 状态变量名不叫这几个，点 ⚙ 自定义你的变量名 |
| 弹「此页面没有 window.__INITIAL_STATE__」 | 该变量确实不存在，试试 ⚙ 配置或换业务页 |
| 复制按钮没反应 | 个别 http 页面禁剪贴板，手动全选复制 |
| 某字段显示 `[Circular]` | 该对象真的成环了；共享引用会正常展开 |
| loading 一闪而过 | state 较小，序列化太快属正常现象 |

## 使用前先确认安全边界

这个工具读取的是当前页面已经暴露给浏览器的状态，不会额外请求服务端；但状态中仍可能包含用户标识、鉴权信息或业务敏感字段。

- 只在自己有权限调试的页面使用；
- 复制 JSON 后，不要直接粘贴到公开群、工单或外部 AI 服务；
- 对外分享前先做脱敏，尤其检查 token、手机号、邮箱、内部 ID 和实验配置；
- Bookmarklet 运行在当前页面上下文中，可能受 CSP、浏览器权限和页面自身脚本影响。

## 兼容性说明

- **Chrome / Edge**：完全兼容，推荐
- **Firefox**：可用（复制权限需额外授权一次）
- **Safari**：不同版本和安全设置下表现可能不同；若脚本无法执行，建议改用 Chrome 或 Edge

## 后续优化方向

- 刷新后自动浮出、免手工点 → 改 **Tampermonkey（油猴）** 脚本自动注入
- 多团队统一、常驻面板 → 升级为 **Chrome DevTools 扩展**
- 加**序列化耗时统计**，评估状态体量与性能

