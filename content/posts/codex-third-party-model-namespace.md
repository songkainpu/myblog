---
title: "Codex 接第三方模型报 unknown tool type: namespace：一次完整排查"
date: 2026-09-07T00:00:00+08:00
draft: false
description: "解释 Codex Desktop 接入第三方模型时 namespace/custom 工具不兼容的原因，以及不同客户端入口的请求差异和处理方法。"
tags: ["Codex", "DeepSeek", "LLM", "代理", "排障"]
categories: ["技术"]
cover:
  image: "/images/posts/codex-third-party-model-namespace/cover.png"
  alt: "Codex 请求经过本地代理转换后发往第三方模型"
  relative: false
---

公司现在什么都讲究省钱，而且是每一分钱都要省。模型调用费当然也不能例外，所以我一直使用 Codex + DeepSeek。休了几天假回来，Codex 升级后却突然变成了每发一条消息就报错：

```text
unknown tool type: namespace
```

模型一句话都没有返回，请求在推理开始前就被拒绝。更奇怪的是，同一份配置下：

- Codex Desktop 报错；
- 终端里的交互式 `codex` 也报错；
- `codex exec` 却能正常工作。

三个入口共用一份配置，结果却完全不同，说明网关的兼容情况还与客户端入口有关。

要解释这个差异，需要看版本、工具配置和不同入口实际发出的请求。

## 排除版本和工具数量

`namespace` 看起来像 Codex 新版本引入的工具类型，但 npm 安装的较老稳定版仍然报错，另一个看起来更新的内置 CLI 在特定入口下反而正常。因此，问题不能简单归因于版本升级。

清空 browser、computer-use 和 MCP server 等额外工具配置后，Desktop 入口仍然发送 `namespace` 并被网关拒绝，工具数量没有改变请求类型。

差异来自客户端入口及其发出的请求结构。

## `originator` 决定工具形式

把几个入口发出的请求并排比较后，差异变得很清楚：

| 入口 | 观察到的 `originator` | 工具类型 | 第三方模型结果 |
| --- | --- | --- | --- |
| `codex exec` | `codex_exec` | `function` | 正常 |
| TypeScript SDK | `codex_sdk_ts` | `custom` | 拒绝 `custom` |
| Desktop / 交互式 `codex` | `Codex Desktop` | `namespace` | 拒绝 `namespace` |

终端中的交互式 `codex` 和 `codex exec` 走不同链路。前者走 app-server，在我的测试中使用了与 Desktop 相同的客户端身份，因此也会触发 `namespace`；后者是一次性执行入口，只发送标准 `function`。

在 SDK 场景中，设置内部环境变量：

```bash
CODEX_INTERNAL_ORIGINATOR_OVERRIDE=codex_exec
```

可以让请求采用 `codex_exec` 对应的工具形式。但这个办法对 Desktop 无效：GUI 通过 `clientInfo.name` 提供的身份优先级更高，环境变量无法覆盖。

由于这是内部变量，不应把它当作稳定公开配置依赖。升级后如果行为变化，仍需重新抓包确认。

## 请求体里实际发生了什么

我在本机启动了一个 mock server，把 Codex 的 `base_url` 临时指向它，记录实际请求体。在失败请求的 `tools` 数组中，我看到了多个 `namespace` 类型工具：其中包括 multi-agent 工具，也包括被打包成 namespace 的 MCP server。

将 `originator` 切换为 `codex_exec` 后，工具定义变为 `function`，同一个第三方模型可以接受请求。这也解释了为什么 Desktop 和交互式 CLI 一起失败、`codex exec` 却能正常工作，以及 SDK 为什么会报另一个工具类型 `custom`。

抓包时应只记录定位问题所需字段，并对 Authorization、Cookie、提示词和业务数据做脱敏；不要把完整请求日志直接发到公共 issue。

## 解决方案：在中间增加请求转换代理

Desktop 无法通过环境变量切换身份时，可以在本机增加一层代理：接收 Codex 请求，清理不兼容字段，再转发到公司网关。

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

`strip` 模式会直接丢弃 namespace 工具，实现简单，但**被移除的工具在这一轮对话中不可用。**

如果希望保留能力，可以把 namespace 内的 function 展开到顶层，并为工具名增加 namespace 前缀。完整实现需要同时改写请求和响应：模型返回工具调用后，代理还要把名称映射回原始结构，并正确处理流式响应、并发调用和错误结果。只做单向 flatten 很可能造成“模型会调用、客户端接不住”的新问题。

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

选择现成工具时，需要确认它能否转换请求体，并同时处理流式响应与工具调用名称映射。仅支持 endpoint、模型和密钥切换无法解决这个问题。

## 如何确认遇到的是同一个问题

可以从以下几个特征判断：

![从错误现象到定位 originator 的排查路径](/images/posts/codex-third-party-model-namespace/troubleshooting.svg)

1. 请求在模型输出任何内容之前就被拒绝，错误明确指向 `namespace` 或 `custom` 工具类型；
2. Desktop 或交互式 CLI 失败，而同一配置下的 `codex exec` 正常；
3. 失败请求的 `tools[].type` 包含 `namespace` 或 `custom`；
4. 网关文档只声明支持标准 `function` 工具。

如果一次性任务已经能通过 `codex exec` 完成，它也是一个很实用的临时绕行方案：不需要代理，也不会牺牲额外工具。但它不能替代 Desktop 的完整交互体验。

## 总结

`unknown tool type: namespace` 发生在模型推理之前，是 Codex 客户端与第三方兼容网关之间的工具协议不匹配。在我当时的环境里，Codex 根据 `originator` 选择工具组织方式：Desktop 和交互式 CLI 发出 `namespace`，SDK 可能发出 `custom`，而 `codex exec` 发出标准 `function`。网关只支持 `function`，因此直接拒绝了前两类请求。

一次性任务可以暂时改用 `codex exec`；SDK 可以尝试内部的 originator override，但不应把它当作稳定接口；Desktop 则需要使用支持这些工具类型的网关，或增加请求转换代理。直接移除 `namespace` 最简单，但对应工具会不可用；如果展开并保留工具，还必须同时处理返回调用的名称映射。

以上行为来自当时使用的 Codex 版本和第三方网关。客户端或接口升级后，字段和行为都可能变化，仍应以实际请求为准。
