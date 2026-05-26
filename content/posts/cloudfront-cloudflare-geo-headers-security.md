---
title: "CDN 回源 IP Header 能不能信：以 CloudFront 和 Cloudflare 为例"
date: 2026-05-01T02:04:57+08:00
draft: false
tags: ["CloudFront", "Cloudflare", "CDN", "安全", "GeoIP"]
categories: ["技术"]
---

最近排查了一个和 CDN 回源 Header 有关的问题：源站经常会依赖 CDN 写入的 IP / GeoIP Header 来判断用户真实 IP 或国家地区，例如 Cloudflare 的 `CF-Connecting-IP`、`CF-IPCountry`，以及 AWS CloudFront 的 `CloudFront-Viewer-Address`、`CloudFront-Viewer-Country`。

问题是：这些 Header 到底能不能信？用户能不能自己伪造？如果绕过 CDN 直连源站会怎样？

这篇只关注 IP 相关 Header，不展开设备类型、TLS 指纹、JA3/JA4 那些内容。

## CloudFront 官方是怎么做的

AWS CloudFront 官方支持在回源请求中添加 Viewer 信息 Header。和 IP / 地理位置相关的主要是：

```text
CloudFront-Viewer-Address
CloudFront-Viewer-ASN
CloudFront-Viewer-Country
CloudFront-Viewer-City
CloudFront-Viewer-Country-Name
CloudFront-Viewer-Country-Region
CloudFront-Viewer-Country-Region-Name
CloudFront-Viewer-Latitude
CloudFront-Viewer-Longitude
CloudFront-Viewer-Metro-Code
CloudFront-Viewer-Postal-Code
CloudFront-Viewer-Time-Zone
```

官方解释很直接：这些值由 CloudFront 根据访问者 IP 计算后加到转发给 Origin 的请求里，Origin 不需要自己做 IP 库查询。

几个常用字段：

- `CloudFront-Viewer-Address`：访问者 IP 和源端口，例如 `198.51.100.10:46532`
- `CloudFront-Viewer-Country`：两位国家码，例如 `US`、`JP`
- `CloudFront-Viewer-City`：城市名，不是所有 IP 都有
- `CloudFront-Viewer-ASN`：访问者所在自治系统 ASN

用法上主要有两类：

1. 只给源站做日志、统计、风控参考：放到 Origin Request Policy，不要进缓存 key。
2. 如果响应内容会根据国家地区变化：放到 Cache Policy，让它进入缓存 key，避免不同地区用户命中同一份缓存。

AWS 官方文档：

- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html

## Cloudflare 对应的 Header

Cloudflare 常见的是：

```text
CF-Connecting-IP
CF-IPCountry
X-Forwarded-For
```

其中：

- `CF-Connecting-IP`：Cloudflare 认为的访问者真实 IP
- `CF-IPCountry`：访问者国家，两位国家码；特殊值 `XX` 表示无国家数据，`T1` 表示 Tor
- `X-Forwarded-For`：代理链路上常见的客户端 IP 列表

Cloudflare 官方文档里说，`CF-Connecting-IP` 只会在 Cloudflare Edge 到 Origin 的流量中发送。`CF-IPCountry` 这类访问者位置信息，可以通过 `Add visitor location headers` Managed Transform 添加。

Cloudflare 官方文档：

- https://developers.cloudflare.com/fundamentals/reference/http-headers/
- https://developers.cloudflare.com/rules/transform/managed-transforms/reference/

下面是这次真正想确认的三个问题。

## 问题一：用户能不能伪造 `CF-IPCountry` / `CF-Connecting-IP`

测试结论：正常经过 Cloudflare 代理时，不会。

比如用户请求时自己加：

```http
CF-IPCountry: US
CF-Connecting-IP: 1.2.3.4
```

如果请求是走 Cloudflare 代理链路到源站，源站不会把这个用户自带的值当成 Cloudflare 注入的可信值。

这个结果符合 Cloudflare 的设计：`CF-Connecting-IP`、`CF-IPCountry` 这类 Header 不是给客户端自己声明身份用的，而是 Cloudflare 在边缘层根据连接信息和 IP 地理位置结果写给源站的。

所以，在“请求确实经过 Cloudflare”的前提下，用户在浏览器或 curl 里手动加 `CF-*` Header，并不能伪造成另一个国家或另一个真实 IP。

## 问题二：如果 Cloudflare 没开启回写，用户自加 `CF-IPCountry` 会不会穿透到服务端网关

测试结论：不会。

这个点一开始我也比较担心：如果 Cloudflare 没开 `Add visitor location headers`，那用户自己带一个：

```http
CF-IPCountry: US
```

会不会因为 Cloudflare “转发普通请求头”而直接传到源站？

实际测试结果是不会。也就是说，Cloudflare 不开启回写时，源站不会收到用户伪造出来的 `CF-IPCountry`。

这个结论很重要：

```text
CF-IPCountry 缺失，只能说明 Cloudflare 没给这个信息；
不能通过用户自己补一个 CF-IPCountry 来让源站误判国家。
```

但这里仍然有前提：流量必须经过 Cloudflare。

## 问题三：能不能绕过 Cloudflare 直连后端，然后注入 `CF-*` Header

这个是最需要防的。

如果攻击者知道源站真实 IP，直接请求源站：

```bash
curl http://源站IP/ \
  -H 'Host: example.com' \
  -H 'CF-IPCountry: US' \
  -H 'CF-Connecting-IP: 1.2.3.4'
```

这时候请求根本没有经过 Cloudflare。源站看到的 Header 就只是普通 HTTP Header。如果后端网关或应用没有判断请求来源，就有可能把这些伪造的 `CF-*` 当真。

所以，前两个问题的答案是“不会”，但第三个问题不能靠 Cloudflare 自动解决。因为攻击者绕过了 Cloudflare。

Cloudflare 官方也明确提醒过：如果有人发现了源站 IP，就可以直接给源站发请求，绕过 Cloudflare 的安全保护。官方建议阻止所有非 Cloudflare IP、非可信合作方或可信应用的流量。

官方文档：

- https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/

## 怎么防直连源站

最基本的做法：源站防火墙、安全组、负载均衡器只允许 Cloudflare IP 段访问 80/443。

也就是：

```text
允许 Cloudflare IP -> 源站
拒绝其他公网 IP -> 源站
```

这能解决大部分直连绕过问题。

但只做 IP allowlist 也有维护成本：Cloudflare IP 段可能更新，源站环境里也可能有其他旁路入口。因此还可以加一层 Cloudflare 的 Authenticated Origin Pulls。

## Cloudflare 的签名 / 校验机制：Authenticated Origin Pulls

Cloudflare 提供的回源身份校验机制叫 Authenticated Origin Pulls，简称 AOP。本质是 mTLS，不是简单加一个 secret header。

开启后，Cloudflare 回源时会带客户端证书，源站验证这个证书。验证通过，说明请求确实来自 Cloudflare 的回源链路。

官方文档：

- https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/

AOP 有三种级别：

1. Global：使用 Cloudflare 共享证书，只能证明“来自 Cloudflare 网络”。
2. Zone-level：使用你上传的证书，可以证明“来自你的 zone 配置”。
3. Per-hostname：按 hostname 配证书，粒度更细。

如果只是想挡住普通直连攻击，Global AOP 已经比单纯 Header 可靠很多；如果要更严格地区分是不是你自己的 Cloudflare 配置，应该用 Zone-level 或 Per-hostname。

## AOP 可靠吗？会被破解吗？

我的理解：AOP 本身可靠性很高，真正风险通常不在“破解 mTLS”，而在配置错误。

原因是：

- 伪造 HTTP Header 很容易。
- 伪造 mTLS 客户端证书不容易。
- 如果攻击者没有对应私钥，无法完成合法的客户端证书认证。

所以从密码学角度看，暴力破解私钥基本不现实。

更现实的风险是这些：

1. 源站没有真的强制校验客户端证书。
2. 只在 Cloudflare 开了 AOP，但 Nginx / Ingress / LB 没配好。
3. 使用 Global AOP，只证明来自 Cloudflare 网络，不证明来自你的 zone。
4. 源站还有其他端口、其他域名、内网转发、旧 IP 可以绕过。
5. 私钥或证书配置泄露。

所以不能把 AOP 理解成“开关一开就万事大吉”。它应该和源站防火墙一起用。

比较稳的组合是：

```text
Cloudflare 代理
+ 源站只允许 Cloudflare IP
+ Authenticated Origin Pulls，优先 Zone-level / Per-hostname
+ 应用层只在确认来源可信后读取 CF-* Header
```

## 结论

这次主要确认了三个点：

1. 用户正常经过 Cloudflare 时，自己伪造 `CF-IPCountry`、`CF-Connecting-IP`，不会被源站当成可信 Cloudflare Header。
2. Cloudflare 不开启回写时，用户自己加 `CF-IPCountry`，也不会穿透给服务端网关。
3. 真正要防的是绕过 Cloudflare 直连源站；这个要靠 Cloudflare IP allowlist、防火墙和 Authenticated Origin Pulls/mTLS。

所以我的结论是：

```text
CF-* / CloudFront-* 这类 IP Header 可以用，
但只应该在“请求确实来自 CDN”的前提下信。
```
