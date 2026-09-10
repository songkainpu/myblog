---
title: "让 AI Agent 走出浏览器：Android、iOS、WebView 与 Unity 的统一操作接口"
date: 2026-06-16T20:18:45+08:00
draft: false
tags: ["AI", "Agent", "MCP", "UI 自动化", "Android", "iOS", "Unity"]
categories: ["技术"]
cover:
  image: "/images/covers/ai-agent-out-of-browser-unified-ui-automation.png"
  alt: "统一接口连接手机、浏览器与游戏应用"
  relative: false
---

在建设全自动化的 AI Native 需求产出流程时，我们遇到了一个很现实的问题：

**现有 Skill 类 Agent 操作 Web 页面比较成熟，但一旦需求涉及 Android、iOS 或 Unity 应用，自动化链路就会断掉。**

Agent 可以分析需求、编写代码、启动服务，也可以在浏览器里验证结果，但移动端和游戏应用中的点击、输入、滚动、截图与结果检查仍需人工接管。

为了解决这个问题，我们实现了一组面向 Agent 的跨技术栈 UI 操作 MCP：

- Android Native MCP
- Android WebView MCP
- iOS Native MCP
- iOS WebView MCP
- iOS Browser MCP
- Unity Poco MCP

它们底层分别连接 ADB、Chrome DevTools Protocol、Appium/XCUITest 和 Poco，但向 Agent 提供一致的观察与操作方式。本文介绍整体设计和各平台的实现细节。

## 移动端 UI 自动化面对的差异

浏览器 Agent 之所以发展得较快，一个重要原因是 Web 天然具有相对统一的交互基础：

- DOM 提供结构化页面信息；
- 元素通常具有文本、属性和选择器；
- JavaScript 可以直接执行交互；
- CDP 等协议提供了成熟的调试和自动化能力。

但 App 世界没有统一的 DOM。

Android 原生页面暴露的是 UIAutomator 层级，iOS 原生页面依赖 XCUITest 的可访问性树，WebView 需要切换到 Web 上下文，不过这套能力与浏览器类似，Unity 游戏内 UI 又存在于引擎自己的节点树中。即使都是一个“点击”动作，底层实现也可能分别是：

- 执行一次 ADB tap；
- 查找一个 DOM 节点并触发 click；
- 通过 Appium 操作 XCUITest 元素；
- 根据 Poco 节点坐标点击游戏画面。

系统需要统一页面信息、动作语义和会话管理，使 Agent 能在不同平台上连续完成任务。

## 统一 Agent 协议，保留平台实现

每种运行环境对应一个独立的 MCP Server，分别管理自身依赖和平台逻辑。

每个 Server 只负责一个明确的平台场景，但对外提供相同的工具：

```text
get_platform_info
open_session
close_session
list_sessions
get_interactive_elements
execute_action
take_screenshot
```

Agent 的工作循环如下：

![Agent UI 自动化的观察—行动闭环](/images/ai-agent-unified-ui-automation-loop.svg)

动作层同样采用统一语义，包括：

```text
click
input_text
scroll
drag
wait
press_key
long_click
click_position
kill_app
```

Agent 使用统一的观察和操作接口，底层平台差异由各自的适配器处理。

## 架构：Session、Hierarchy、Executor 与 Capture

每个平台内部都被拆成四个主要部分：

![单平台 MCP Server 的内部架构](/images/ai-agent-mcp-architecture.svg)

### SessionManager

`SessionManager` 是公共控制层，负责：

- 创建和关闭会话；
- 保存平台连接及配置摘要；
- 串行化同一会话中的操作；
- 分发统一动作；
- 将底层结果和异常转换为结构化响应；
- 管理截图路径及会话状态。

设备连接、Appium Driver、WebView 调试通道和 Poco 连接需要跨越多个 Agent 步骤持续存在，因此由会话统一管理。

同时，每个会话拥有独立锁，避免同一设备上的“读取页面”和“点击元素”并发执行，引发状态错乱。

### Hierarchy Adapter

Hierarchy Adapter 负责把各平台完全不同的页面结构，转换成 Agent 易于消费的交互元素列表。例如：

```text
[0] Button "登录" pos=(312, 688) size=(120x48) [clickable]
[1] TextField "请输入手机号" pos=(196, 520) size=(320x44)
[2] ScrollView pos=(195, 410) size=(390x620) [scrollable]
```

每个元素还会进入当前页面的 `selector map`，Agent 可以直接使用较短的 index 发起操作，而不必把冗长、易错的平台选择器传来传去。

这一步也能显著压缩上下文。相比把完整 XML、DOM 或 Unity 节点树交给模型，只返回当前可见、可能交互的元素，信息密度更高，Token 消耗也更可控。

### Action Executor

Executor 接收统一动作，再转换为平台调用。

例如 `click(index=0)`：

- Android Native：从 UIAutomator 结果中取元素中心点，通过 ADB tap 点击；
- Android WebView：定位注入了临时 index 的 DOM 元素，执行 JavaScript click；
- iOS Native：在 XCUITest 上下文中完成元素或坐标操作；
- Unity：根据 Poco 节点位置或节点代理完成点击。

Executor 会保留平台能力差异。某个平台无法可靠执行或不支持某项动作时，会返回明确的失败结果。

### Screen Capture

结构化元素告诉 Agent“页面上有什么”，截图则帮助 Agent确认“页面实际看起来怎样”。

Android 使用 ADB screencap，iOS 通过 Appium 获取截图，Unity 使用 Poco snapshot。截图既可以作为视觉模型的输入，也可以作为自动化流程的执行证据。

## 不同技术栈如何接入

### Android Native：UIAutomator + ADB

Android 原生实现通过 `uiautomator dump` 获取当前页面 XML，遍历节点并提取：

- text 与 content description；
- resource id 与控件类型；
- clickable、focusable、scrollable 等状态；
- bounds、中心坐标和尺寸。

操作层则使用 ADB 的 input 能力完成点击、文本输入、滑动、按键和长按。

这条链路依赖少、部署简单，适合作为 Android 原生应用的基础能力。它的限制也很明确：如果应用没有暴露足够的可访问性信息，Agent 能看到的语义就会减少，此时需要结合截图和坐标操作兜底。

### Android WebView：ADB DevTools Socket + CDP

WebView 虽然运行在 Android App 内部，但其内容仍然是 DOM。我们通过 ADB 查找设备上的 DevTools socket，将它转发到本地端口，再通过 CDP 连接目标页面。

连接成功后，在页面中执行一段元素提取脚本：

- 筛选链接、按钮、输入框、可编辑元素以及具有交互样式的节点；
- 排除隐藏、尺寸过小和视口外元素；
- 提取文本、类型、位置和尺寸；
- 为当前轮次元素注入临时 `data-agent-idx`。

后续点击和输入便可以通过这个 index 精确定位 DOM 节点。

### iOS Native：Appium + XCUITest

iOS 原生应用通过 Appium 创建 XCUITest Session，读取页面 source 后解析可访问性节点。

实现中需要特别处理两个坐标空间：

- Appium 返回的逻辑屏幕尺寸；
- 实际截图的像素尺寸。

在 Retina 设备上两者可能不一致。如果后续需要将视觉模型输出的截图坐标映射到设备操作坐标，就必须进行缩放换算，否则“看起来点在按钮上”的坐标可能落到错误位置。

### iOS WebView 与 Safari：上下文切换

iOS 混合应用和 Safari 需要在不同 Context 之间切换。

原生控件存在于 `NATIVE_APP`，网页内容存在于 `WEBVIEW`。实现中会枚举可用 Context，优先切换到指定或首个可用的 WebView，再用 JavaScript 提取页面元素。

对于 Safari 场景，我们还保留原生树回退。当 WebView Context 暂时不可用时，Agent 仍可操作地址栏、系统弹窗等原生浏览器界面。

### Unity：Poco 节点树

Unity 应用无法依赖 Android 或 iOS 的原生 UI 树来完整描述游戏内界面，因此我们通过 Poco SDK 读取 Unity 节点层级。

适配层会提取节点的：

- name、type 与 text；
- 归一化坐标与尺寸；
- clickable 等交互属性。

随后通过 Poco 完成 click、set_text、swipe、long_click 和 snapshot。该实现既可以连接 Unity Editor，也可以通过 Airtest 连接 Android、iOS 或桌面运行环境。

跨平台适配还需要考虑 Flutter、React Native、Unity 等应用技术栈。Agent 应连接能够提供最佳语义信息的层级。

## 按目标元素选择 MCP

混合应用可能同时提供 Native、WebView 和 Unity 的操作通道。`app-runtime-router-mcp` 采集各通道的页面元素和可用状态，再由模型结合用户当前步骤选择执行器。

运行时信号用于发现可用通道：Android 的 DevTools socket 表明 WebView 调试可用，iOS 的 `WEBVIEW_*` 表明存在网页上下文，Poco 连接则提供 Unity 节点。但通道存在并不能确定目标控件属于它。例如，WebView 打开时，目标可能是原生弹窗；后台保留的 WebView Context 也可能与前台页面无关。因此，路由还必须检查各通道实际返回的目标元素。

Router 会将每个技术栈能够看到的元素列表、可用状态和采集错误统一返回。同时，它还会接收用户当前步骤的操作描述，例如：

```text
点击“开始游戏”按钮
```

假设此时 WebView 和 Poco 都可以连接，但它们看到的元素不同：

```json
{
  "user_intent": "点击开始游戏按钮",
  "candidates": [
    {
      "runtime": "android_webview",
      "mcp": "android-webview-mcp",
      "elements_text": "[0] link text=\"用户协议\""
    },
    {
      "runtime": "unity_poco",
      "mcp": "unity-poco-mcp",
      "elements_text": "[0] Button text=\"开始游戏\""
    }
  ]
}
```

大模型可以结合用户的操作描述与各技术栈实际获取到的页面元素，判断 `unity-poco-mcp` 更适合完成当前步骤。

路由结果只对当前页面快照有效。一次点击可能让页面从 Native 跳转到 WebView，也可能从 WebView 返回 Unity 场景。因此，在页面跳转或 UI 发生明显变化后，需要重新获取各技术栈的页面元素，再决定下一步使用哪个 MCP。

## 用 index 引用页面快照中的元素

我们在每次读取页面后，都会建立一份当前页面的 index 到元素信息映射。这样做有三个原因：

第一，减少模型负担。Agent 只需表达“点击第 3 个元素”，不需要拼接 XPath、CSS Selector 或 Poco 查询条件。

第二，统一不同平台。XPath、CSS Selector、resource id 和 Poco 节点查询没有共同格式，但 index 可以成为一次观察结果内的公共引用。

第三，控制选择器有效期。页面变化后，旧 index 可能失效，因此我们明确要求在关键动作前重新读取元素。这比让 Agent 长期持有一个看似稳定、实际已经过期的选择器更容易推理和排障。

## 按平台拆分 MCP Server

每个平台使用独立 Server，主要考虑依赖、部署和故障隔离：

- ADB、Appium、WebSocket、Poco 的依赖彼此独立；
- 不同平台的启动前置条件不同；
- Agent 可以只挂载当前任务需要的工具；
- 工具说明更聚焦，降低模型选错平台的概率；
- 单个平台故障不会扩大到整个服务；
- 测试、版本管理和开源边界更清晰。

多个 MCP Server 遵循相同的生命周期和动作协议，上层 Skill 仍可通过统一接口调用。平台复杂性留在适配器内部，MCP Client 负责组合。

## 执行约束与结果验证

### stdout 对 stdio MCP 很敏感

stdio MCP 使用标准输出传输协议消息，而一些底层 SDK 会直接打印日志。一旦普通日志混入 stdout，就可能破坏协议。

因此，调用底层适配器时需要保护 stdio 通道，将非协议输出重定向到 stderr，并串行处理相关调用。

### 动作后需要验证页面状态

底层返回 click 成功只记录命令已经执行，页面可能仍未进入预期状态。

因此每个关键动作之后，Agent 都应再次获取元素或截图，验证目标状态是否出现。完整执行过程是“观察、行动、再观察”。

## 在 AI Native 研发流程中的位置

Appium、ADB 和 Poco 继续承担底层自动化。这套实现增加了一层 Agent-friendly interface，让 Skill 可以把移动端和 Unity 应用纳入同一条需求产出链路：

![AI Native 研发与交付闭环](/images/ai-agent-native-delivery-loop.svg)

当 Agent 能够操作最终产物，自动化流程才从“代码生成”向“需求交付”迈进一步。

目前这套方案更准确的定位是：为不同客户端技术栈提供统一、可组合、可被 Skill 调用的 UI 执行基础设施。上层仍然需要任务规划、异常恢复、账号与测试数据准备，以及针对具体业务的验收规则。


## 纯视觉与结构化元素的取舍

纯视觉自动化可以补充结构化元素无法覆盖的页面。

以 Midscene 等方案为例，Agent 可以直接根据截图理解页面，并通过坐标完成点击、输入和滑动。它不需要关心页面来自 Native、WebView 还是 Unity，也不依赖控件是否暴露了完整的 DOM、可访问性树或 Poco 节点。对于技术栈复杂、语义树缺失或者页面实现频繁变化的应用，这种方案具有非常明显的优势。

视觉操作通常依赖当前截图中的布局和坐标。同一个任务换到不同分辨率、屏幕比例或系统字体的设备后，原有操作轨迹不一定能够直接复用。它更适合让模型根据每一帧画面重新理解和决策，但较难像结构化元素方案一样形成稳定的选择器、录制回放和跨设备执行能力。

同时，截图会因为时间、电量、网络状态、动态内容和细微渲染差异不断变化。相较于文本化、结构化的元素信息，视觉输入的缓存命中率通常更低，推理成本和执行延迟也更高。

实际使用中可以组合纯视觉和结构化元素：

- 纯视觉负责跨越技术栈边界，处理画布、弱可访问性页面和结构化信息缺失的场景；
- Native、DOM、XCUITest 和 Poco 元素负责提供稳定语义，支持定位复用、录制回放和更低成本的重复执行；
- 当多个结构化技术栈同时存在时，由 Router 结合用户意图和页面元素选择执行器；
- 当结构化元素无法描述目标时，再使用视觉理解和坐标操作兜底。
