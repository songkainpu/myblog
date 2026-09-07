---
title: "Codex 接第三方模型报 unknown tool type: namespace：一次完整排查"
date: 2026-09-07T00:00:00+08:00
draft: false
description: "记录 Codex Desktop 接入第三方模型后遇到 unknown tool type: namespace 时，从版本降级、最小配置到抓包和本地代理的完整排查过程。"
tags: ["Codex", "DeepSeek", "LLM", "代理", "排障"]
categories: ["技术"]
cover:
  image: "/images/posts/codex-third-party-model-namespace/cover.png"
  alt: "Codex 请求经过本地代理转换后发往第三方模型"
  relative: false
---

为了节省调用成本，我把日常写代码使用的模型从 OpenAI GPT 切到了公司网关后的 DeepSeek。原以为只需要改一下 `base_url` 和模型名，Codex 升级后却突然变成了每发一条消息就报错：

```text
unknown tool type: namespace
```

模型一句话都没有返回，请求在推理开始前就被拒绝。更奇怪的是，同一份配置下：

- Codex Desktop 报错；
- 终端里的交互式 `codex` 也报错；
- `codex exec` 却能正常工作。

三个入口共用一份配置，结果却完全不同。问题显然不只是“第三方模型不兼容 Codex”这么简单：如果真是模型或网关完全不支持，`codex exec` 也不该例外。

我先从版本差异查起，随后清空工具配置做最小环境对照，最后把几个入口发出的真实请求逐项摆在一起比较。下面按实际排查顺序展开。

## 坑一：以为是 Codex 版本问题

看到 `unknown tool type: namespace` 时，我的第一反应是：`namespace` 会不会是 Codex 新版本刚引入的工具类型，而 DeepSeek 还没来得及支持？

如果这个猜测成立，降级应该能解决问题。但对照结果恰好相反：npm 安装的较老稳定版仍然报同样的错，而另一个看起来更新的内置 CLI 在特定入口下反而正常。

这说明“版本新旧”并不是决定条件。真正值得追的变量变成了：**这些调用究竟走了哪条请求链路？**

## 坑二：以为是工具太多触发了折叠

第二个猜测是工具数量。我的配置里有 browser、computer-use 和多个 MCP server，会不会是工具太多，Codex 才把它们折叠成 `namespace`？

于是我清空了额外工具配置，只保留最小环境。结果 Desktop 入口照样报错。

这个实验排除了“工具数量触发折叠”的假设。`namespace` 是否出现，与安装了多少工具没有直接关系；至少在这次环境里，决定因素仍然是客户端入口。

## 真正的开关：`originator`

把几个入口发出的请求并排比较后，差异变得很清楚：

| 入口 | 观察到的 `originator` | 工具类型 | 第三方模型结果 |
| --- | --- | --- | --- |
| `codex exec` | `codex_exec` | `function` | 正常 |
| TypeScript SDK | `codex_sdk_ts` | `custom` | 拒绝 `custom` |
| Desktop / 交互式 `codex` | `Codex Desktop` | `namespace` | 拒绝 `namespace` |

这里最容易误判的一点是：终端中的交互式 `codex` 并不等于 `codex exec`。前者走 app-server 链路，在我的测试中使用了与 Desktop 相同的客户端身份，因此也会触发 `namespace`；后者是一次性执行入口，只发送了标准 `function`。

在 SDK 场景中，设置内部环境变量：

```bash
CODEX_INTERNAL_ORIGINATOR_OVERRIDE=codex_exec
```

可以让请求采用 `codex_exec` 对应的工具形式。但这个办法对 Desktop 无效：GUI 通过 `clientInfo.name` 提供的身份优先级更高，环境变量无法覆盖。

由于这是内部变量，不应把它当作稳定公开配置依赖。升级后如果行为变化，仍需重新抓包确认。

## 我是怎么把问题锁定到 `originator` 的

我在本机启动了一个 mock server，把 Codex 的 `base_url` 临时指向它，记录实际请求体。在失败请求的 `tools` 数组中，我看到了多个 `namespace` 类型工具：其中包括 multi-agent 工具，也包括被打包成 namespace 的 MCP server。

随后做单变量对照：请求内容、模型配置和工具配置保持不变，只改变 `originator`。当 `originator` 切换为 `codex_exec` 时，工具定义变为 `function`，请求可以被第三方模型接受。

这一轮实验比反复修改版本和配置更有价值，因为它同时解释了三个现象：

- 为什么 Desktop 和交互式 CLI 一起失败；
- 为什么 `codex exec` 正常；
- 为什么 SDK 报的是另一个工具类型 `custom`。

抓包时应只记录定位问题所需字段，并对 Authorization、Cookie、提示词和业务数据做脱敏；不要把完整请求日志直接发到公共 issue。

## 解决方案：在中间增加请求转换代理

既然上游会发送第三方模型不认识的工具类型，而 Desktop 又无法通过环境变量切换身份，最直接的兼容方案是在本机增加一层代理：接收 Codex 请求，清理不兼容字段，再转发到公司网关。

![Codex 请求经过本地代理清理后转发到第三方模型](/images/posts/codex-third-party-model-namespace/proxy-flow.svg)

代理对 `tools` 做了两项处理：

1. 移除 `type = "namespace"` 的工具；
2. 移除 `web_search` 工具中网关不认识的 `external_web_access` 字段。

核心转换逻辑如下：

```python
def transform_tools(tools):
    """处理第三方模型不兼容的工具定义，返回 (新工具列表, 是否修改)。"""
    if not isinstance(tools, list):
        return tools, False

    changed = False
    result = []

    for tool in tools:
        if not isinstance(tool, dict):
            result.append(tool)
            continue

        tool_type = tool.get("type")

        if tool_type == "namespace":
            changed = True
            if MODE == "flatten":
                namespace = tool.get("name", "ns")
                for child in tool.get("tools", []):
                    if isinstance(child, dict) and child.get("type") == "function":
                        child = dict(child)
                        child["name"] = f"{namespace}__{child.get('name', '')}"
                        result.append(child)
            continue

        if tool_type == "web_search" and "external_web_access" in tool:
            tool = dict(tool)
            tool.pop("external_web_access", None)
            changed = True

        result.append(tool)

    return result, changed
```

我最初选择的是 `strip` 模式，也就是直接丢弃 namespace 工具。优点是实现简单，能够快速验证根因；代价也很明确：**被移除的工具在这一轮对话中不可用。**

如果希望保留能力，可以把 namespace 内的 function 展开到顶层，并为工具名增加 namespace 前缀。但这不只是改一遍请求：模型返回工具调用后，代理还要把名称映射回原始结构，并正确处理流式响应、并发调用和错误结果。只做单向 flatten 很可能造成“模型会调用、客户端接不住”的新问题。

## 代理实现中还要注意什么

### 不要把关闭 TLS 校验写成默认方案

我的内网网关使用自签名证书，初次转发时遇到了：

```text
SSL: CERTIFICATE_VERIFY_FAILED
```

临时关闭校验可以用于验证链路，却不适合作为长期配置。更稳妥的办法是把公司的根证书加入代理使用的信任链，并显式指定 CA 文件。否则本地代理到网关之间失去服务端身份校验，会留下中间人攻击风险。

### 只监听本机地址

代理应绑定 `127.0.0.1` 或 Unix Domain Socket，不要默认监听 `0.0.0.0`。它承载模型密钥和完整请求内容，一旦暴露到局域网，风险远高于普通开发服务。

### 不要记录敏感请求体

调试阶段可以记录工具类型和字段名，但不应长期保存 Authorization、完整 prompt、代码、文件内容或模型回复。日志最好采用字段白名单，并对请求 ID 做截断。

### 处理流式传输和超时

一个能通过简单请求的代理不一定能稳定承载 Codex。至少还要确认：

- SSE 流是否原样转发；
- 客户端断开时上游连接是否及时关闭；
- 超时是否覆盖长时间推理；
- `Content-Length` 是否在改写 body 后重新计算；
- 压缩请求是否先解压、改写，再正确编码。

## 为什么没有直接使用现成代理

我也考虑过 CC Switch 一类本地路由工具。它们适合切换 endpoint、模型和密钥，但这次问题发生在请求体结构里，需要修改 `tools` 数组和具体字段。如果代理只做路由和鉴权替换，就无法解决 `namespace` 不兼容。

判断一个现成工具能否解决问题，关键不是它是否“支持 Codex”，而是它是否提供**请求体转换**能力，并且能否同时处理流式响应与工具调用名称映射。

## 一套更高效的排查顺序

回头看，这类兼容问题可以按下面的顺序排查，避免在版本和配置上来回试错：

![从错误现象到定位 originator 的排查路径](/images/posts/codex-third-party-model-namespace/troubleshooting.svg)

1. 用最小 prompt 分别测试 Desktop、交互式 CLI 和 `codex exec`；
2. 记录各入口的状态码与服务端原始错误；
3. 将 `base_url` 指向本地 mock server，脱敏后比较请求体；
4. 重点对比 `originator`、`tools[].type` 和非标准字段；
5. 做单变量实验，不要同时升级版本、删工具、换模型；
6. 用最小转换规则验证根因，再决定 strip、flatten 还是更换兼容网关；
7. 每次 Codex 或网关升级后运行一组回归请求。

如果一次性任务已经能通过 `codex exec` 完成，它也是一个很实用的临时绕行方案：不需要代理，也不会牺牲额外工具。但它不能替代 Desktop 的完整交互体验。

## 写在最后

这次排查最费时间的不是写代理，而是连续推翻两个看似合理的假设：先是版本，再是工具数量。真正让问题收敛的，是把不同入口的真实请求放在一起比较，并且一次只改变一个变量。

`unknown tool type: namespace` 表面上像一句信息不足的服务端报错，背后其实是客户端工具协议与第三方兼容层之间的能力错位。遇到类似问题时，与其猜某个配置项，不如先确认请求究竟发了什么。协议兼容问题，最终都要回到线上的真实字节。

在我当时的环境里，完整链路是：Codex 根据 `originator` 选择工具组织方式，Desktop 和交互式 CLI 发出了网关不支持的 `namespace`，SDK 则可能发出 `custom`；`codex exec` 使用标准 `function`，所以能够正常工作。Desktop 无法靠内部环境变量切换身份后，我最终用本地代理移除不兼容的工具和字段，让请求恢复正常。

这个结论只对应当时使用的 Codex 版本和第三方网关，并不是一份永久不变的协议说明。客户端或接口升级后，字段和行为都可能变化，仍应以实际请求为准。
