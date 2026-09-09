---
title: "升级 Go 1.23 后，Hologres 连接出了个奇怪的问题"
date: 2026-09-08T00:00:00+08:00
draft: false
description: "同样连接新加坡的 Hologres，AWS 新加坡正常，美国和欧洲却 SSL 失败。最后发现，问题和 Go 1.23 默认开启的 Kyber 有关。"
tags: ["Go", "TLS", "Hologres", "AWS", "网络排查"]
categories: ["技术"]
---

之前升级 Go 1.23，遇到过一个 Hologres 连接问题。

Hologres 实例在阿里云新加坡。从 AWS 新加坡的机器访问没问题，但从 AWS 美国、欧洲的机器访问，就会 SSL 失败。

一开始怀疑是升级后加密算法不兼容，但地域差异又让人有点困惑：连的都是新加坡的 Hologres，为什么换个地方就不行了？

![Go 应用通过跨区网络与 Hologres 建立混合后量子密钥交换连接](/images/posts/go-1-23-hologres-tls-kyber/hero.png)

最后，在应用启动时加了一个环境变量，连接就恢复了：

```bash
GODEBUG=tlskyber=0 ./your-app
```

如果原来已经有 `GODEBUG` 配置，把 `tlskyber=0` 合并进去即可。容器或服务管理器启动的应用，需要改实际进程的启动环境，再重启验证。

## Kyber 怎么影响到了连接？

查了 [Go 1.23 的发布说明](https://go.dev/doc/go1.23)，这一版默认启用了实验性的混合后量子密钥交换 `X25519Kyber768Draft00`。在没有显式设置 `tls.Config.CurvePreferences` 的情况下，客户端会在 TLS 握手中带上这个选项。

新增的密钥交换数据会让 **ClientHello 变大**。这条消息在握手开始时发出，告诉服务端客户端支持哪些协议版本、算法和扩展。

有个和这次现象很接近的[历史案例](https://github.com/hashicorp/terraform-provider-aws/issues/39311)：2024 年，Terraform AWS Provider 升级 Go 1.23 后，也遇到了连接问题。Issue 里的抓包显示，ClientHello 从约 290 字节增加到了 1510 字节，分成两个 TCP 段发送，随后被当时的 AWS Network Firewall 丢弃，导致握手超时。他们给出的临时处理方式也是 `tlskyber=0`。

这不代表我这次也一定碰到了 AWS Network Firewall，但说明了一个很容易忽略的变化：升级 Go 后，握手消息在网络上传输的样子也变了。

## 为什么只有欧美的机器失败？

这里还没有抓包结论，只能结合已有资料推测。

一种可能是，不同区域走的网络路径不同，某条路径上的防火墙或网关处理不了变大的 ClientHello。

另一种更有意思：即便最后到了同一个入口，也可能因为数据到达的时序不同，触发同一个程序的 bug。

TCP 是字节流，一次 `read()` 不保证读到完整的 TLS 消息。但有些实现会假设，读一次就能拿到整个 ClientHello。消息变大、分段到达后，这个假设就不成立了。短距离连接可能碰巧没暴露问题，换一条路径就失败。这类缺陷有专门的说明：[TLS post-quantum TL;DR fail](https://tldr.fail/)，Go 的 [GODEBUG 文档](https://go.dev/doc/godebug#go-123)也提到了它。

当然，还可能涉及路径 MTU、丢包，或者不同地区实际解析到了不同入口。仅凭关闭 Kyber 后恢复，无法把这些情况区分开，更不能直接认定是哪家云的问题。

服务端本身不支持 Kyber，并不应该导致连接失败。正常情况下，它可以选择双方都支持的传统算法；TCP 分段也本来就是接收端必须处理的情况。

## 这个配置可以一直留着吗？

在 Go 1.23 中，可以先用它解决兼容问题。关闭 Kyber 后仍然使用 TLS 加密，也不会因此关闭证书校验，只是不再使用这项新增的混合后量子密钥交换能力。

不过，后续升级 Go 时要留意：**Go 1.24 已经移除了 `tlskyber`**，换成了 `X25519MLKEM768`，对应的开关是 `tlsmlkem`。旧配置不能一直照搬，具体以目标版本的 [GODEBUG 文档](https://go.dev/doc/godebug)为准。
