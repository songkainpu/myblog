---
title: "CDN 回源 IP Header：常见字段与 Cloudflare 源站防护"
date: 2026-05-01T02:04:57+08:00
draft: false
tags: ["CloudFront", "Cloudflare", "CDN", "安全", "GeoIP"]
categories: ["技术"]
cover:
  image: "/images/covers/cloudfront-cloudflare-geo-headers-security.png"
  alt: "CDN 全球网络与源站可信访问防护"
  relative: false
---

最近排查了一个和 CDN 回源 Header 有关的问题：源站经常会依赖 CDN 写入的 IP / GeoIP Header 来判断用户真实 IP 或国家地区，例如 Cloudflare 的 `CF-Connecting-IP`、`CF-IPCountry`，以及 AWS CloudFront 的 `CloudFront-Viewer-Address`、`CloudFront-Viewer-Country`。

源站使用这些字段前，需要确认请求来自可信的 CDN 回源链路。客户端直连源站时也能携带同名 Header，字段名本身不能证明来源。

本文先列出 CloudFront 和 Cloudflare 的 IP / GeoIP 字段，再以 Cloudflare 为例说明同名 Header 的处理、直连绕过和源站认证。

## CloudFront 的 IP / GeoIP 字段

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
- `CloudFront-Viewer-City`：城市名，部分 IP 没有对应数据
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

以下测试区分经过 Cloudflare 代理和直连源站两条路径。

## 经过 Cloudflare：客户端自带的同名 Header

在本次测试中，经过 Cloudflare 代理后，源站收到的是边缘层生成的 IP / GeoIP 值。

比如用户请求时自己加：

```http
CF-IPCountry: US
CF-Connecting-IP: 1.2.3.4
```

源站收到的值由 Cloudflare 根据连接信息和 IP 地理位置结果写入，未采用上述客户端自带值。

### 未开启位置 Header 回写的情况

假设 Cloudflare 没开 `Add visitor location headers`，用户在请求中加入：

```http
CF-IPCountry: US
```

本次测试中，未开启回写时，源站也没有收到用户自带的 `CF-IPCountry`。

## 直连源站：同名 Header 可由客户端构造

主要风险来自绕过 Cloudflare 直连源站。

如果攻击者知道源站真实 IP，直接请求源站：

```bash
curl http://源站IP/ \
  -H 'Host: example.com' \
  -H 'CF-IPCountry: US' \
  -H 'CF-Connecting-IP: 1.2.3.4'
```

这时候请求根本没有经过 Cloudflare。源站看到的 Header 就只是普通 HTTP Header。如果后端网关或应用没有判断请求来源，就有可能把这些伪造的 `CF-*` 当真。

Cloudflare 官方也明确提醒过：如果有人发现了源站 IP，就可以直接给源站发请求，绕过 Cloudflare 的安全保护。官方建议阻止所有非 Cloudflare IP、非可信合作方或可信应用的流量。

官方文档：

- https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/

## 限制源站入口

最基本的做法：源站防火墙、安全组、负载均衡器只允许 Cloudflare IP 段访问 80/443。

也就是：

```text
允许 Cloudflare IP -> 源站
拒绝其他公网 IP -> 源站
```

这能解决大部分直连绕过问题。

但只做 IP allowlist 也有维护成本：Cloudflare IP 段可能更新，源站环境里也可能有其他旁路入口。因此还可以加一层 Cloudflare 的 Authenticated Origin Pulls。

## Cloudflare 的签名 / 校验机制：Authenticated Origin Pulls

Cloudflare 的回源身份校验机制叫 Authenticated Origin Pulls，简称 AOP。它通过 mTLS 验证回源连接的客户端证书。

开启后，Cloudflare 回源时会带客户端证书，源站验证这个证书。验证通过，说明请求确实来自 Cloudflare 的回源链路。

官方文档：

- https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/

AOP 有三种级别：

1. Global：使用 Cloudflare 共享证书，只能证明“来自 Cloudflare 网络”。
2. Zone-level：使用你上传的证书，可以证明“来自你的 zone 配置”。
3. Per-hostname：按 hostname 配证书，粒度更细。

Global AOP 可以拦截普通直连攻击；Zone-level 或 Per-hostname 还能进一步确认请求来自自己的 Cloudflare 配置。

## AOP 的配置边界

AOP 使用成熟的 mTLS 机制，实际风险主要来自配置错误。

客户端必须持有对应私钥才能完成证书认证。部署时需要检查以下配置风险：

1. 源站没有真的强制校验客户端证书。
2. 只在 Cloudflare 开了 AOP，但 Nginx / Ingress / LB 没配好。
3. 使用 Global AOP，只证明来自 Cloudflare 网络，不证明来自你的 zone。
4. 源站还有其他端口、其他域名、内网转发、旧 IP 可以绕过。
5. 私钥或证书配置泄露。

部署时将回源认证与入口限制配合使用：

```text
Cloudflare 代理
+ 源站只允许 Cloudflare IP
+ Authenticated Origin Pulls，优先 Zone-level / Per-hostname
+ 应用层只在确认来源可信后读取 CF-* Header
```
