---
title: "给 Codex Desktop 加一个 Context 用量仪表盘：Windows 和 macOS 实现"
date: 2026-08-20T00:00:00+08:00
draft: false
description: "为 Codex Desktop 提供 Windows 和 macOS 原生悬浮 Context Inspector，展示准确 Context 总量与带证据等级的本地估算。"
tags: ["Codex", "Context", "Windows", "macOS", "插件", "WPF", "AppKit"]
categories: ["技术"]
---

本文记录一个 Windows 和 macOS 本地实验项目：在 Codex Desktop 输入框附近持续显示当前 Context 使用情况，并进一步拆解 Skill、MCP server/tool、消息和工具结果的大致占用。

## 为什么想做这件事

短任务里，我们通常不会在意 Context。提需求、改代码、跑测试，一轮工作很快结束。

但当一个 Codex task 持续几小时甚至几天，Context 就不再只是底层模型概念，而会变成一种需要管理的工作资源。系统指令、项目规则、对话历史、工具调用、Skill 指令、MCP tool schema，以及历史压缩生成的摘要，都在共享同一个有限窗口。

这时我经常想知道：

- 当前 task 到底用了多少 Context？
- 距离窗口上限还有多远？
- 最近安装的 Skill 或启用的 MCP server，大约增加了多少负担？
- 是哪一类工具结果正在快速挤占空间？
- 现在应该继续工作、主动 compact，还是另开一个 task？

只看到一个百分比并不够。它像汽车仪表盘上的剩余油量，能告诉你还剩多少，却解释不了油耗来自哪里。

于是，最初“在输入框旁边放一个 Context 按钮”的小想法，逐渐变成了一个 Context 可观测性工具。

## 最终做出来的东西

这个实验项目叫 `Codex Context Inspector`。它在 Codex Desktop 的输入框附近显示一个紧凑状态，例如：

```text
Context 37.3%
```

悬停或点击后，可以继续查看：

- 当前输入 Context；
- 模型窗口大小；
- 剩余空间与缓存输入；
- 系统指令、Skill、MCP 工具、消息和工具结果的本地估算；
- 每一个可见 Skill 的估算；
- 按 MCP server 和 tool 展开的估算。

面板大致如下：

```text
Context usage                         37.3%
Current input                         96.3k
Model window                         258.4k
Remaining                            162.1k
Cached input                          94.0k

Estimated breakdown
System & policies                  ≈   7.0k
Skills                             ≈   4.5k
MCP / plugin tools                ≈   7.5k
User messages                     ≈   1.4k
Assistant messages                ≈   0.9k
Other tool results                ≈  52.6k
Compaction summary                ≈   3.6k
Unattributed / hidden             ≈   2.0k
```

整个工具在本机运行，不把会话内容上传到外部服务。

目前有两个原生 sidecar：Windows 版使用 .NET 8 WPF，macOS 版使用 Swift + AppKit，核心数据模型和 Skill 查询协议保持一致。也就是说，平台不同，Context 的证据等级和计算语义不变。

## 第一条原则：不要给估算披上准确值的外衣

这个项目最重要的设计决定，不是展示尽可能多的数字，而是先说明每个数字的证据等级。

| 类型 | 含义 | 示例 |
| --- | --- | --- |
| Exact | 直接来自 Codex 本地 token 记录 | 当前输入、缓存输入、模型窗口 |
| Derived | 由准确字段确定性计算 | 剩余空间、使用百分比 |
| Estimated | 根据本地可见记录估算 | Skill、MCP tool、消息和工具结果 |
| Unavailable | 当前没有足够证据 | 无法识别的数据结构 |

准确总量的计算很简单：

```text
used       = last_token_usage.input_tokens
window     = model_context_window
remaining  = max(0, window - used)
percent    = used / window × 100%
```

一个很容易踩的坑是把 `total_token_usage` 当成当前 Context。它表示整个 session 的累计消耗，可能远大于模型窗口；真正对应当前请求携带 Context 的，是最新的 `last_token_usage.input_tokens`。

至于 Skill 和 MCP tool 的逐项占用，Codex 并没有直接提供精确账单。因此面板统一用 `≈` 标识，并采用一个透明的近似：

```text
estimated_tokens ≈ ceil(UTF-8 bytes / 4)
```

这不是模型 tokenizer，只适合观察相对量级。它的意义是帮助判断“哪里可能偏大”，而不是声称某个 Skill 精确占用了多少 token。

## 为什么是插件加原生 Overlay

插件适合打包 Skill、Hooks、sidecar 和安装信息，但这个实验没有通过受支持的扩展点把按钮直接注入 Codex Desktop 的 composer。

为了不修改 Codex 安装文件、不注入 DLL，也不依赖 Chromium 内部 DOM，我选择了独立的原生 sidecar。Windows 版是 .NET 8 WPF：

- 使用 Windows UI Automation 定位 Codex 窗口和输入框；
- 用一个不抢焦点的透明 Overlay 跟随输入框移动；
- 从本机会话记录读取 Context 数据；
- 通过当前用户专用的命名管道，让 Skill 和 Overlay 共用同一份报告。

macOS 版没有把 WPF 硬搬过去，而是使用 Swift + AppKit：

- 通过 `com.openai.codex` bundle identifier 和屏幕窗口信息找到 Codex；
- 在用户授予 Accessibility 权限后，遍历 Accessibility tree 定位 composer；
- 使用不激活的 `NSPanel` 显示悬浮 pill 和详情面板，不抢走 Codex 的键盘焦点；
- 通过 Unix Domain Socket 与 Hook、Skill 和后台 sidecar 通信；
- 使用 Universal 2 构建，同时支持 arm64 和 x86_64。

整体关系可以简化为：

![Codex Context Inspector 跨平台架构图](/images/codex-context-inspector-architecture.svg)

*跨平台实现共享同一套 Context 数据语义，平台差异集中在窗口定位、IPC 和 sidecar UI。*

这个方案把插件能力和桌面 UI 解耦，侵入性较低，但也带来明确代价：UI Automation、Accessibility tree、Desktop activity log 和 rollout JSONL 都属于兼容面，宿主更新后可能需要适配。

## macOS 端：把 Windows Overlay 换成原生 AppKit

macOS 版的目标不是重新发明一套 Context 计算，而是复用同一套证据模型：最新 `event_msg/token_count` 仍然提供准确总量，Skill、MCP tool、消息和工具结果仍然只是带 `≈` 的本地估算。真正需要替换的是窗口定位、进程间通信和打包方式。

紧凑状态会直接显示在 Codex 窗口附近，颜色表示当前使用比例：

![macOS Context Inspector 完整界面截图](/images/codex-context-inspector-macos-overview.png)

*macOS 端完整界面：详情面板和 Context pill 都悬浮在 Codex Desktop 窗口上方。截图中的对话内容已做模糊处理。*

![macOS Context Inspector 紧凑悬浮窗](/images/codex-context-inspector-macos-pill.png)

*macOS 原生 pill：绿色表示当前使用比例处于较低区间。*

点击 pill 后可以固定详情面板，查看准确总量以及带 `≈` 标记的本地估算明细：

![macOS Context Inspector 详情面板](/images/codex-context-inspector-macos-details.png)

*详情面板同时展示 Codex 报告的精确字段和 Skills、MCP tools、消息、工具结果等估算项。*

### 1. 为什么选择 Swift + AppKit

macOS 上最敏感的部分是“悬浮在 composer 附近，但不能把 Codex 的焦点抢走”。因此 UI 使用 AppKit 的 `NSPanel`，而不是普通 SwiftUI window：

- 紧凑 pill 是 borderless、non-activating panel；
- 鼠标悬停时展开详情，点击可以 pin；
- 拖动 pill 会保存相对 anchor 的偏移，重启后继续使用；
- Codex 不在前台、窗口不可见或无法确认时，面板会隐藏或进入等待状态；
- 如果没有可靠的 composer bounds，面板会退回 Codex 窗口内的安全位置，并明确不宣称自己绑定到了输入框。

### 2. Accessibility 权限只用于定位界面

要把 pill 放到输入框附近，macOS sidecar 需要用户在“系统设置 → 隐私与安全性 → 辅助功能”中授予 Accessibility 权限。权限用途是读取 Codex 窗口的结构和几何位置，不是读取其他应用的文本内容。

sidecar 会优先寻找前台、聚焦的 Codex 窗口，再在有限深度和节点数内寻找下半部分的可编辑文本区域。无法取得权限时仍可运行，但只能使用窗口级 fallback anchor；这时状态会显示为等待或低置信度定位，而不是伪装成精确贴着 composer。

### 3. macOS 上的当前 task 绑定

macOS 当前 Codex Desktop 版本的 `plugin_hooks` feature 已移除，因此 macOS 版不能把 Hook 当成唯一入口。它的主要路径是读取本地 Desktop activity log：

```text
~/Library/Logs/com.openai.codex/YYYY/MM/DD/
```

解析器寻找同时满足 `active=true`、`rendererWindowFocused=true`、`rendererWindowVisible=true` 的 `conversationId`，再做两层校验：rollout 文件名必须匹配这个 ID，文件首条 `session_meta.payload.id` 也必须匹配。只有证据链完整时，才会显示对应 session 的 Context。

Hook launcher 仍然保留，作为未来或其他宿主版本重新提供 Hooks 时的兼容路径；当前 macOS 运行不依赖它。这和 Windows 版“Hook 优先、Desktop log fallback”的路径略有不同，但最后都遵守同一个原则：无法确认属于当前 task，就保持 Unknown。

### 4. 本地通信和安装

Windows sidecar 使用当前用户专用命名管道，macOS sidecar 使用当前用户专用的 Unix Domain Socket：

```text
/tmp/codex-context-inspector-<uid>/inspector.sock
```

运行时目录是 `0700`，socket 是 `0600`，并且会校验 peer uid；Hook 失败时 fail-open，不阻塞 Codex。macOS 构建产物是一个 Universal 2 app bundle，个人安装脚本会把它复制到稳定路径：

```text
~/Applications/Codex Context Inspector.app
```

稳定路径有一个实际好处：重新刷新插件缓存时，Accessibility 对这个 app identity 的授权更不容易反复失效。开发环境可以在仓库根目录执行：

```sh
scripts/build-macos.sh
scripts/install-personal-macos.sh
```

安装后首次启动需要按系统提示授予 Accessibility 权限，再重新打开或新建一个 Codex task。macOS 端的 Skill helper、`--inspect-active`、`--inspect-session`、`--probe`、`--self-test` 和 `--log-path` 与 Windows 版保持同一组职责。

### 5. macOS 版当前做到什么程度

现在 macOS 端已经具备：

- Swift Core reader、attribution estimator、session resolver 和 transcript validator；
- 精确 Context 总量与明确标记的分类估算；
- 原生 pill、详情面板、悬停展开、点击 pin、拖动定位和 stale snapshot 展示；
- Accessibility 缺失时的安全 fallback；
- 诊断日志、Unix Socket IPC、Universal 2 构建和本地安装脚本；
- 与 Windows 相同的本地隐私边界：不发网络请求，不把 prompt、assistant 内容和 tool 输出写入插件日志。

这里的“macOS 支持”指的是当前仓库中的本地 sidecar 和插件安装链路已经实现，不代表 Codex Desktop 的本地 JSONL、Desktop activity log 或 Accessibility tree 已经成为稳定公开 API。

## 当前 task 绑定：从窗口到 rollout 的实现

Context Inspector 不扫描“最近修改的 JSONL”，而是先确定用户当前看到的 Codex 窗口，再把窗口信号解析成候选 `conversationId` 或 session 元数据。

Windows 端通过 UI Automation 找到前台 Codex 窗口和 composer；macOS 端优先使用 `com.openai.codex` 的前台窗口、Accessibility focused window 和 `CGWindow` 信息。两端都只接受 active、focused、visible 的窗口，避免把后台 task 当成当前 task。

当前版本的绑定步骤是：

1. **取得候选身份**：Windows/macOS 读取 Desktop activity log 的 `conversationId`；宿主仍提供 Hooks 时，再把 Hook 的 `session_id` 和 `transcript_path` 作为强绑定兼容路径。
2. **校验 transcript 路径**：路径必须位于允许的 Codex sessions root 下，扩展名为 `.jsonl`，并拒绝路径逃逸和符号链接。
3. **校验 rollout 文件名**：文件名中的 session ID 必须与候选 `conversationId` 一致。
4. **校验首条元数据**：rollout 首条 `session_meta.payload.id` 必须再次匹配，不能只相信文件名。
5. **读取 token snapshot**：身份校验通过后，才从该 rollout 读取最新 `event_msg/token_count`，并更新 Overlay 与 Context Usage Skill。

如果任一步无法确认，绑定状态就是 `Unbound`，Overlay 保持等待或显示上一次已确认的 snapshot，不会用另一个 task 的数据填充当前面板。

![Codex Context Inspector 当前 task 绑定流程](/images/codex-context-inspector-task-binding.svg)

*当前 task 绑定先确认窗口和 session 身份，再决定是否展示 Context。*

## 如何读取当前 Context

`RolloutUsageReader` 从 session rollout JSONL 的尾部寻找最新 `event_msg/token_count`，再读取其中的 `last_token_usage` 和 `model_context_window`。

实现中还做了几层保护：

- 最多扫描文件尾部 8 MiB，避免长 session 每次全量读取；
- 使用共享读取，不阻塞 Codex 继续写入；
- 起点落在半条记录时丢弃残段；
- 从后向前寻找最新合法 token event；
- 忽略部分写入的末行；
- 按文件长度和修改时间缓存结果。

这里说的“准确”，只表示数值直接来自 Codex 当前记录，并不表示承载它的本地 JSONL 格式是稳定公开协议。

## 分项估算如何与准确总量对齐

归因模块会从本地可见记录中寻找这些证据：

- 基础指令；
- Skill catalog 与已加载的 `SKILL.md`；
- MCP server/tool schema；
- tool call 参数与输出；
- user/assistant message；
- compaction replacement history。

但历史 JSONL 中可能仍包含已经被 compact 掉的记录，所以原始估算之和可能大于当前准确总量。

为避免面板出现“分项相加超过总量”的假象，算法会：

1. 先计算各类可见证据的原始估算；
2. 把可见目标限制为 `min(exact_used, raw_total)`；
3. 按原始权重分摊到类别、server 和 tool；
4. 将无法解释的差额放入 `Unattributed / hidden`；
5. 保证每层子项之和与父项一致。

因此，面板展示的是一张与准确总量对齐的“可见证据地图”，而不是伪造出来的精确账单。

## 日志把“空数据”变成了可诊断问题

早期版本没有结构化日志，UI 上一个 0 可以对应十几种原因。后来我给定位、绑定、读取和展示各自增加了状态记录，包括：

- sidecar 生命周期；
- UIA 定位失败原因；
- Hook 是否到达和被接受；
- Desktop log fallback 状态；
- task/session 绑定变化；
- snapshot 与异常 0 值；
- Skill 查询结果。

日志不记录 prompt、assistant message、命令和 tool output；路径会脱敏，task 和 session id 只保留前缀。

这次故障最终就是靠下面几类事件串起来的：

```text
ui.unbound
hook.received             # 新 task 中缺失
fallback.desktop_log_status = resolved
fallback.binding_updated
snapshot.displayed
```

当关键链路都有独立证据后，“为什么没有数据”才从猜谜变成了可以逐层验证的问题。

## 验证结果

我没有只在开发对话里验证，而是覆盖了多个实际切换场景：

| 场景 | 结果 |
| --- | --- |
| 当前开发 task | 自动解析并显示 snapshot |
| 新建 task | 首次产生 session 后自动绑定 |
| 两个其他 task 之间切换 | 分别绑定到不同 conversation id |
| sidecar 重启 | 恢复当前 task，无需手动执行 Hook |
| 同名或标题变化的 task | 按 conversation id 校正，不沿用旧 session |
| Skill 查询 | 与 Overlay 使用同一份总量和分项估算 |
| 固定 fixture 自检 | `116,726 / 258,400`，计算通过 |
| macOS Universal 2 构建 | arm64 与 x86_64 构建完成，`--self-test` 通过 |

对应的故障修复提交为：

```text
45acd77 fix: auto-bind context inspector sessions on Windows
```

## 已知限制

这仍然是 Windows 和 macOS 的本地实验实现，而不是稳定产品：

- Windows 目前只面向 Windows 10/11 x64；macOS 目前面向 macOS 13+ 的 arm64/x86_64；两者都依赖 Codex Desktop；
- Windows UIA 和 macOS Accessibility 都依赖当前 Desktop 的可访问性树；
- Desktop activity log 和 rollout JSONL 不是稳定公开接口；
- UTF-8/4 不是模型 tokenizer，所有分类和明细都只是估算；
- attribution 会在本地读取有界 transcript 内容；
- Windows 的多窗口、混合 DPI、休眠恢复，以及 macOS 的多 Space、权限变更和日志轮转仍需更长期测试；

如果未来 Codex 提供稳定的 active-task token usage 接口，本地日志与 transcript adapter 应该优先被替换；macOS 的 Accessibility 定位也可以退化成更简单、受支持的窗口锚点。

## 代码仓库

- [codex-context-inspector](https://github.com/songkainpu/codex-context-inspector)

## 参考资料

- [OpenAI：Plugins](https://learn.chatgpt.com/docs/plugins)
- [OpenAI：Hooks](https://learn.chatgpt.com/docs/hooks)
