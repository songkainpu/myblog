---
title: "给 Codex Desktop 加一个 Context 用量仪表盘：Windows 和 macOS 实现"
date: 2026-08-20T00:00:00+08:00
draft: false
description: "为 Codex Desktop 提供 Windows 和 macOS 原生悬浮 Context Inspector，展示当前 Context 用量，并估算 Skill、MCP 工具和对话内容的占用。"
tags: ["Codex", "Context", "Windows", "macOS", "插件", "WPF", "AppKit"]
categories: ["技术"]
cover:
  image: "/images/covers/codex-context-inspector-windows.png"
  alt: "悬浮仪表盘展示上下文用量与分类"
  relative: false
---

长时间使用 Codex Desktop 处理一个任务时，系统指令、Skill、MCP 工具定义、对话历史和工具结果会逐渐占用 Context。一个使用百分比能告诉我窗口还剩多少空间，但无法解释这些空间主要用在了哪里。

我做了一个本地实验项目 **Codex Context Inspector**，在 Codex Desktop 输入框附近显示 Context 用量，展开后可以查看分类明细。Windows 版使用 WPF，macOS 版使用 AppKit；两端采用相同的数据口径。

## 界面：用量常驻，明细按需展开

平时，Inspector 只显示一个紧凑的悬浮标签，例如 `Context 37.3%`。鼠标悬停时展开详情，点击后可以固定面板，方便在工作过程中查看。

![macOS Context Inspector 完整界面截图](/images/codex-context-inspector-macos-overview.png)

*macOS 版的悬浮标签和详情面板。截图中的对话内容已做模糊处理。*

面板分为两部分：上半部分显示当前输入 token 数、模型窗口大小、剩余空间和缓存输入；下半部分估算系统指令、Skill、MCP 工具、消息和工具结果的占用。Skill 可以逐项查看，MCP 工具可以按 server 和 tool 展开。

![macOS Context Inspector 详情面板](/images/codex-context-inspector-macos-details.png)

*总量来自 Codex 本地记录，分类估算用 `≈` 标识。*

这些信息适合用来观察 Context 的构成和变化。例如，工具结果的估算占比较高时，可以进一步检查是否有大量输出留在会话中。分类数字只能提供线索，不能作为逐项计费依据。

## 数据口径：总量取自记录，分项依靠估算

Inspector 能直接读取 Codex 记录的输入 token 数，但无法取得每个 Skill、每个工具结果的精确占用。因此，总量和分类明细需要分开理解。

### 当前用量取最新一次输入

Codex 的本地会话记录是 rollout JSONL 文件。Inspector 从中读取最新的 `event_msg/token_count`，使用以下字段计算用量：

```text
used       = last_token_usage.input_tokens
window     = model_context_window
remaining  = max(0, window - used)
percent    = used / window × 100%
```

这里使用 `last_token_usage.input_tokens`，因为它表示最近一次请求的输入量。`total_token_usage` 是整个 session 的累计消耗，可能远大于模型窗口，不能用来计算当前 Context 百分比。

因此，面板展示的是**最近一次已记录请求的 Context 用量**。这里的“准确”指直接采用 Codex 记录的数字，不代表能实时测量尚未发送的输入内容。

### 分类明细用于观察量级

Skill、MCP 工具、消息和工具结果的分项数据来自本地可见内容，采用统一的粗略换算：

```text
estimated_tokens ≈ ceil(UTF-8 bytes / 4)
```

这不是模型的实际 tokenizer，不同语言和内容类型都可能产生误差。面板用四种标签区分数据来源：

| 标签 | 含义 | 示例 |
| --- | --- | --- |
| Exact | 直接来自 Codex 本地记录 | 当前输入、缓存输入、模型窗口 |
| Derived | 由记录中的字段计算 | 剩余空间、使用百分比 |
| Estimated | 根据本地可见内容估算 | Skill、MCP 工具、消息和工具结果 |
| Unavailable | 缺少足够证据 | 无法识别或读取的数据 |

历史记录还可能包含已经被 compact 掉的内容，直接相加会高估当前占用。Inspector 会先计算原始估算；当估算之和超过当前总量时，按比例缩放各项。无法由可见内容解释的差额归入 `Unattributed / hidden`，各层明细之和与总量保持一致。

这种对齐只保证展示上的数值一致，不能恢复模型当前实际携带的全部内容，也不会让分类估算变得精确。

## 实现：独立悬浮窗连接本地会话数据

项目由插件和一个独立运行的原生辅助程序（sidecar）组成。插件负责打包 Skill、Hooks 和安装信息；sidecar 负责窗口定位、读取数据和展示面板。界面使用原生悬浮窗，不修改 Codex 安装文件，也不向内部 DOM 注入按钮。

![Codex Context Inspector 跨平台架构图](/images/codex-context-inspector-architecture.svg)

*两端采用相同的数据口径，分别实现窗口定位、悬浮界面和本地通信。*

数据展示经过三个步骤：定位前台 Codex 窗口，确认窗口对应的任务，再读取该任务的 token 记录。

### 先确认当前任务

本地可能有多个任务同时写入记录。最近修改的 JSONL 文件可能属于后台任务，因此不能仅凭文件时间选择数据源。

Inspector 使用当前窗口的活动状态和会话身份建立绑定。Windows 版优先接收宿主 Hook 提供的 `session_id` 和 `transcript_path`，也支持从 Desktop activity log 读取 `conversationId`。本文实现的 macOS 版本主要使用 Desktop activity log，Hook 保留为兼容路径。

取得候选身份后，还需要校验会话文件：路径必须位于允许的 sessions 目录内，文件名中的 ID 和首条 `session_meta.payload.id` 都必须与候选身份一致。校验通过后，才读取其中的 Context 数据。

![Codex Context Inspector 当前 task 绑定流程](/images/codex-context-inspector-task-binding.svg)

*窗口、任务身份和会话文件匹配后，才更新面板。*

无法确认当前任务时，面板进入等待状态；如果保留了上一次确认的数据，则将其标记为旧快照。缺少数据不会被当成 Context 使用量为 0。

### 再读取最新用量

长任务的会话文件可能很大。读取器最多扫描文件尾部 8 MiB，从后向前寻找最新的合法 token 事件，并跳过尚未写完的记录。结果按文件长度和修改时间缓存，避免每次刷新都重新扫描。

悬浮面板与 Skill 查询共用同一份报告，因此在界面中查看和通过 Skill 查询时，数据口径一致。

## Windows 与 macOS 的平台实现

两个版本的主要差异在桌面集成部分：

| 部分 | Windows | macOS |
| --- | --- | --- |
| 原生界面 | .NET 8 WPF 透明 Overlay | Swift + AppKit `NSPanel` |
| 输入框定位 | Windows UI Automation | Accessibility tree |
| 本地通信 | 当前用户专用命名管道 | 当前用户专用 Unix Domain Socket |
| 支持范围 | Windows 10/11 x64 | macOS 13+，arm64 / x86_64 |

两端的悬浮窗都尽量保留 Codex 的键盘焦点，让用户查看用量后继续输入。Codex 不在前台或窗口不可见时，面板会隐藏或进入等待状态。

macOS 版需要在“系统设置 → 隐私与安全性 → 辅助功能”中授予权限，以读取 Codex 窗口的结构和位置。无法定位输入框时，面板退回窗口内的备用位置，并标明定位状态。

![macOS Context Inspector 紧凑悬浮窗](/images/codex-context-inspector-macos-pill.png)

*macOS 版的紧凑标签支持拖动，并保存相对窗口锚点的偏移。*

macOS 版提供 Universal 2 构建。开发环境可在项目仓库根目录执行：

```sh
scripts/build-macos.sh
scripts/install-personal-macos.sh
```

安装脚本会将应用复制到 `~/Applications/Codex Context Inspector.app`。固定安装路径有助于保留辅助功能授权，减少插件缓存更新后的重复配置。首次启动后按系统提示授予权限，再重新打开或新建一个 Codex 任务。

## 使用边界

Inspector 在本机读取和处理会话数据，不向外部服务上传内容。插件诊断日志不记录 prompt、assistant message、命令或工具输出；路径会脱敏，任务和 session ID 只保留前缀。

项目仍处于实验阶段，使用时需要考虑以下限制：

- **依赖非公开接口。** Desktop activity log、rollout JSONL 和可访问性树可能随 Codex Desktop 更新而变化，需要持续适配。
- **分类数据是粗略估算。** 它适合观察相对量级，不能提供精确的 token 归因。
- **复杂桌面环境仍需验证。** Windows 多窗口、混合 DPI、休眠恢复，以及 macOS 多 Space、权限变更和日志轮转，还需要更长期的测试。

如果后续 Codex 提供稳定的当前任务用量接口，可以替换本地日志和会话文件的读取部分，保留现有的面板与分类展示。

代码与安装说明见 [codex-context-inspector 仓库](https://github.com/songkainpu/codex-context-inspector)。
