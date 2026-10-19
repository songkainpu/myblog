---
title: "境外支付分享：行业结构、卡支付、APM 与风控"
date: 2026-10-19T10:00:00+08:00
draft: false
slug: "cross-border-payments"
description: "一份境外支付学习笔记及 50 页 HTML 演示稿，涵盖 ISO 标准、卡支付生命周期、手机钱包、3DS、本地支付方式、费率、复购路由、支付风控和应用商店支付。"
tags: ["支付", "跨境支付", "银行卡", "APM", "风控"]
categories: ["技术", "支付"]
ShowToc: true
---

理解支付，可以分别观察信息流、资金流，以及参与方之间的责任关系。用户确认付款、发卡方批准、完成请款、机构结算和商户到账，各自对应不同的业务事实。

这次把境外支付相关的概念整理成一份详细笔记，并配了一套适合分享的 HTML 幻灯片。内容面向支付产品、研发、业务与运营同学，以国际卡支付和新加坡、马来西亚、韩国的本地支付方式为主要例子。

> <a href="/slides/cross-border-payments/" target="_blank" rel="noopener">打开 50 页 HTML 演示稿</a><br>
> <a href="/slides/cross-border-payments/index.html" download="cross-border-payments-slides.html">下载演示稿，离线使用</a><br>
> <a href="/slides/cross-border-payments/notes.md" download="cross-border-payments-sharing-notes.md">下载完整分享笔记（Markdown）</a>

## 分享内容

| 部分 | 主要内容 |
| --- | --- |
| 基础标准 | ISO 3166 国家代码、ISO 4217 币种、金额精度与不同币种角色 |
| 支付分类与行业角色 | Push / Pull、第三方与聚合支付、三方 / 四方卡模式、银行、卡组、收单与 PSP |
| 卡与受理 | PAN、BIN、卡产品、CP / CNP、磁条、EMV、NFC、POS 与货币转换 |
| 手机钱包 | Apple Pay、Google Pay、Samsung Pay、Huawei Pay 与 vivo Pay 的典型银行卡支付机制 |
| 交易生命周期 | SMS / DMS、ISO 8583、认证、授权、请款、批次、清算、结算与商户出款 |
| 售后与认证 | Cancel、Reversal、Refund、Chargeback、AVS、CVC、3DS 与 SCA |
| 成本与复购 | Blended、Interchange++、存卡、CIT / MIT、Network token 与渠道路由 |
| 本地支付 APM | PayNow、DuitNow、Alipay+、Kakao Pay，以及直连与间接接入 |
| 风险管理 | 欺诈、汇率、信用、流动性、技术、法律、AML / 制裁、税务与数据风险 |
| 应用商店 | 手机钱包与 IAP 的区别、购买验证、订阅权益及分地区计费规则 |

## 演示稿使用方式

- **翻页**：方向键、Page Up / Page Down，或页面下方按钮。手机支持横向滑动。
- **目录与搜索**：点击“目录”或按 `G`，按关键词查找页面。
- **讲者备注**：点击“备注”或按 `N`，查看补充说明与官方出处。
- **全屏**：点击“全屏”或按 `F`。
- **打印**：使用桌面工具栏的“打印”，可在浏览器中打印全部页面或另存 PDF。
- **分享某页**：使用“分享当前页”，链接会保留当前幻灯片位置。

下载后直接用现代浏览器打开 HTML 文件即可演示。幻灯片的样式、脚本和内容均在单个文件中，离线阅读无需加载第三方库；打开官方参考资料时需要网络。

## 几个贯穿全篇的区别

三方卡组织模式描述发卡与收单的角色结构，中文“第三方支付”描述的则是机构或服务语境。二者名称相似，分析维度不同。

3DS 负责电商卡认证，后面仍有授权、请款和资金处理。认证通过不意味着商户已经到账，后续退款与某些争议仍可能发生。

PayNow、FAST、SGQR 分别涉及代理寻址与转账体验、相关转账基础设施和二维码呈现。Alipay+ 则连接受理侧与多个用户钱包，应与某个具体钱包区分。

Apple Pay 与 Apple IAP、Google Pay 与 Google Play Billing 分别承担钱包支付和商店计费等不同职责。应用内销售什么、在哪个 storefront、适用什么计划，会影响具体接入与费用。

## 资料与更新

资料核对日期为 **2026 年 10 月 19 日**。标准、支付网络规则、费率、市场准入和应用商店政策会变化；演示稿与完整笔记在相关位置标注了来源和适用边界。

基础标准可从 [ISO 3166](https://www.iso.org/iso-3166-country-codes.html) 和 [SIX 币种维护](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html) 查起。卡支付技术可参考 [EMVCo](https://www.emvco.com/emv-technologies/3-d-secure/)，本地支付机制可参考 [ABS PayNow](https://www.abs.org.sg/e-payments/pay-now) 和 [PayNet DuitNow QR](https://docs.developer.paynet.my/docs/duitNow-QR/introduction/overview)。具体接入仍应使用渠道当前有效的接口文档、网络规则和合同。
