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

## 为什么要默认启用实验性的混合后量子密钥交换？

这里很容易产生一个疑问：既然它还是实验性的，又会增大 ClientHello，为什么 Go 还要默认启用？

首先要说明，**现在并不存在能够实用地破解 X25519、RSA 这类互联网公钥密码的量子计算机，更没有达到可以商用的程度。** 当前量子计算机在可用量子比特数量、纠错能力和稳定运行时间上都离这种能力很远。启用后量子密钥交换，不是因为今天已经有人能用量子计算机解密 TLS。

真正需要提前准备，主要有三个原因。

第一是“现在收集，以后解密”（harvest now, decrypt later）。攻击者即使今天无法解密，也可以先保存加密流量，等未来出现足够强的量子计算机后再处理。对于需要保密十年甚至更久的数据，等量子计算机真正可用时再切换已经太迟。

第二是密码体系迁移非常慢。算法标准化只是开始，后面还要更新 TLS 库、代理、负载均衡器、防火墙、硬件和运维体系。NIST 提到，过去的密码算法迁移通常需要十年以上。Go 提前把新机制放进真实网络，能够尽早发现兼容性和性能问题；本文遇到的情况，恰好就是这种迁移成本的一部分。

第三是它采用“混合”设计，而不是直接用实验算法替换成熟算法。`X25519Kyber768Draft00` 同时执行传统的 X25519 和后量子的 Kyber 密钥交换，再把两边的结果组合起来。这样做的目标是：即使 Kyber 后来发现问题，只要 X25519 仍然安全，连接就不会比原来的 TLS 更差；反过来，如果未来量子计算机能够攻破 X25519，Kyber 则提供额外保护。

所以，这项默认设置更像一次面向未来的渐进迁移：先在保留传统安全性的前提下增加后量子保护，同时用真实流量检验整个网络生态。它防的是未来风险和长期数据泄露，不是在描述一种已经成熟商用的量子攻击能力。

相关背景可以参考 NIST 的 [What Is Post-Quantum Cryptography?](https://www.nist.gov/cybersecurity-and-privacy/what-post-quantum-cryptography) 和 [Migration to Post-Quantum Cryptography](https://www.nccoe.nist.gov/applied-cryptography/migration-to-pqc)。

## 为什么只有欧美的机器失败？

这里还没有抓包结论，只能结合已有资料推测。

一种可能是，不同区域走的网络路径不同，某条路径上的防火墙或网关处理不了变大的 ClientHello。

另一种更有意思：即便最后到了同一个入口，也可能因为数据到达的时序不同，触发同一个程序的 bug。

TCP 是字节流，一次 `read()` 不保证读到完整的 TLS 消息。但有些实现会假设，读一次就能拿到整个 ClientHello。消息变大、分段到达后，这个假设就不成立了。短距离连接可能碰巧没暴露问题，换一条路径就失败。这类缺陷有专门的说明：[TLS post-quantum TL;DR fail](https://tldr.fail/)，Go 的 [GODEBUG 文档](https://go.dev/doc/godebug#go-123)也提到了它。

当然，还可能涉及路径 MTU、丢包，或者不同地区实际解析到了不同入口。仅凭关闭 Kyber 后恢复，无法把这些情况区分开，更不能直接认定是哪家云的问题。

服务端本身不支持 Kyber，并不应该导致连接失败。正常情况下，它可以选择双方都支持的传统算法；TCP 分段也本来就是接收端必须处理的情况。

## 配置的适用范围与版本差异

在 Go 1.23 中，可以先用它解决兼容问题。关闭 Kyber 后仍然使用 TLS 加密，也不会因此关闭证书校验，只是不再使用这项新增的混合后量子密钥交换能力。

不过，后续升级 Go 时要留意：**Go 1.24 已经移除了 `tlskyber`**，换成了 `X25519MLKEM768`，对应的开关是 `tlsmlkem`。旧配置不能一直照搬，具体以目标版本的 [GODEBUG 文档](https://go.dev/doc/godebug)为准。
