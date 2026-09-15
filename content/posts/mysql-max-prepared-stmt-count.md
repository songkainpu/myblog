---
title: "MySQL max_prepared_stmt_count：一个容易被忽略的实例级上限"
date: 2026-09-14T00:00:00+08:00
draft: false
description: "理解 max_prepared_stmt_count 的作用、连接池带来的数量放大，以及 Error 1461 的排查和容量规划。"
tags: ["MySQL", "PreparedStatement", "数据库", "故障排查"]
categories: ["技术"]
---

应用日志里突然出现这样的错误：

```text
Error 1461: Can't create more than max_prepared_stmt_count statements
(current value: 16382)
```

看到参数名，第一反应通常是把它调大。但在修改之前，最好先弄清楚：到底是哪台数据库触及了上限？是业务规模增长，还是预编译语句一直没有释放？

`max_prepared_stmt_count` 管的是 MySQL 实例中同时存在的服务端预编译语句数量。这个限制平时不显眼，却会在启用预编译、扩容应用或者切换数据库时暴露出来。

## 它到底限制什么？

以 MySQL 8.4 官方文档为基准：

| 属性 | 含义 |
|---|---|
| 作用范围 | Global，单个实例所有会话共同计数 |
| 默认值 | `16382` |
| 是否可动态调整 | 可以 |
| 设置为 `0` | 禁止创建预编译语句 |
| 达到上限 | 新建预编译语句受阻，已有语句仍可使用 |

如果把上限调到当前数量以下，已有语句不会因此被清理；只有数量降到限制以下，才能继续创建。这个参数也承担着限制预编译语句内存消耗的作用。不同版本、兼容数据库和云产品的取值范围可能不同，应以目标环境为准。[MySQL 参数文档](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_max_prepared_stmt_count)

这里最容易混淆的是三个数量：

- **执行次数**：一条预编译语句执行一万次，不等于持有一万条语句。
- **SQL 模板数量**：同一个模板在多个连接中分别 prepare，会有多个服务端对象。
- **当前持有数量**：这是 `max_prepared_stmt_count` 真正约束的对象。

MySQL 的预编译语句属于各自会话，不会因为 SQL 文本相同，就在所有连接间共享一份。SQL 层的 `PREPARE` 和二进制协议的服务端 prepare 都纳入这个限制；只在客户端模拟参数绑定的实现，不会因此创建相应的服务端预编译对象。[MySQL 语句缓存说明](https://dev.mysql.com/doc/refman/8.4/en/statement-caching.html)

## 为什么扩容应用也可能触发报错？

考虑一个简化的容量估算。假设某个应用有 20 个实例，每个实例实际建立 30 条到同一台数据库的物理连接，每条连接保留 40 条服务端预编译语句：

```text
20 × 30 × 40 = 24000
```

即使业务只有几十种常见 SQL，合计数量也可能超过默认上限。

这是估算示例，不是说连接池一创建就必然占满这些额度。实际数量取决于连接是否建立、语句是否访问过，以及驱动或 ORM 如何缓存和释放。使用代理时，还要按实际后端连接和语句复用方式计算。

因此，容量评估可以从下面的关系入手：

```text
实例上的预编译语句需求
≈ 各应用实际物理连接数 × 每连接实际保留语句数，再求和
```

滚动发布时新旧应用短暂共存、自动扩容、故障后流量集中到剩余副本，都值得单独评估。单个应用的配置合理，不代表共享数据库上的总量一定合理。

## 报错背后有几类原因？

| 原因 | 可观察的线索 | 处理方向 |
|---|---|---|
| 参数遗漏或不符合负载 | 仅部分实例报错，实际生效值不同 | 核对路由和各实例配置 |
| 正常容量增长 | 数量随连接增长，预热后趋于稳定 | 评估连接池、缓存和服务端额度 |
| SQL 模板不断增多 | SQL 形态繁多，缓存难以稳定 | 检查动态 SQL 的生成方式 |
| 语句释放异常 | 稳定负载下持有数量仍长期增长 | 检查资源生命周期和驱动版本 |

这些是排查方向，不能只凭一条曲线就给问题定性。

例如，下面两个 SQL 有不同的占位符数量，通常需要作为不同模板处理：

```sql
SELECT id FROM orders WHERE id IN (?, ?);
SELECT id FROM orders WHERE id IN (?, ?, ?);
```

如果业务生成大量不同长度的列表，且每种模板都被缓存，就需要把这部分数量算进去。

另一个真实来源是驱动缺陷。MySQL 的 Connector/J 历史缺陷 #74932 记录过：特定缓存使用顺序下，服务端语句未正确关闭，最终触及上限。因此，Error 1461 本身只能说明创建语句遇到了数量限制，不能单独证明参数配置错误，也不能证明当前驱动存在同一个缺陷。[MySQL Bug #74932](https://bugs.mysql.com/bug.php?id=74932)

## 排查时，先看当前存量

在实际报错的目标实例上执行：

```sql
SELECT @@hostname AS hostname,
       @@port AS port,
       @@GLOBAL.server_uuid AS server_uuid,
       @@GLOBAL.max_prepared_stmt_count AS stmt_limit;

SHOW GLOBAL STATUS LIKE 'Prepared_stmt_count';
```

`Prepared_stmt_count` 是当前持有数量，应与上限一起监控。经过代理查询时，要确认结果对应哪台后端实例，必要时分别直连排查。

还可以观察以下累计计数的变化速率：

```sql
SHOW GLOBAL STATUS
WHERE Variable_name IN (
  'Com_stmt_prepare',
  'Com_stmt_execute',
  'Com_stmt_close',
  'Com_stmt_reprepare'
);
```

**不要把 `Com_stmt_prepare - Com_stmt_close` 当成当前持有量。** 这些计数反映请求活动，失败也可能计数；自动 reprepare 还会增加 `Com_stmt_prepare`。它们适合辅助判断创建、执行和关闭是否频繁，不能替代 `Prepared_stmt_count`。[MySQL 状态变量文档](https://dev.mysql.com/doc/refman/8.4/en/server-status-variables.html)

取证时最好同时保存：报错时间、实例标识、当前存量、参数上限，以及最近的发布和扩容记录。事后连接已经释放，单次查询可能看不到故障峰值。

## 找出哪些连接持有了语句

如果 Performance Schema 已启用且相关语句被采集，可以先按线程统计：

```sql
SELECT OWNER_THREAD_ID,
       COUNT(*) AS stmt_count
FROM performance_schema.prepared_statements_instances
GROUP BY OWNER_THREAD_ID
ORDER BY stmt_count DESC
LIMIT 20;
```

再查看某个线程持有的具体 SQL。将示例中的 `12345` 替换为上一步查到的线程 ID：

```sql
SELECT STATEMENT_ID,
       SQL_TEXT,
       COUNT_EXECUTE
FROM performance_schema.prepared_statements_instances
WHERE OWNER_THREAD_ID = 12345
ORDER BY COUNT_EXECUTE ASC
LIMIT 50;
```

大量执行次数很少的语句，可以作为检查缓存收益和动态 SQL 的线索。

这张表是观测视图，采集受配置和容量限制。表为空，或行数少于 `Prepared_stmt_count`，不代表服务端没有对应对象。可以进一步检查：

```sql
SHOW GLOBAL STATUS LIKE 'Performance_schema_prepared_statements_lost';
```

云数据库还可能限制相关表的访问权限。不要把观测缺失误判为资源不存在。[Performance Schema 表说明](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-prepared-statements-instances-table.html)

## 能不能直接调大？

可以，但应把临时恢复与长期修复分开考虑。

如果持有量会稳定下来，只是现有额度无法覆盖正常峰值，那么适度提高上限是合理选择。如果数量持续增长，提高上限只能延后下一次报错，还会允许更多对象占用内存。

下面仅演示设置方法，`32768` 不是通用推荐值：

```sql
-- 修改当前实例的运行时配置
SET GLOBAL max_prepared_stmt_count = 32768;
```

`SET GLOBAL` 本身不保证重启后保留。对于支持持久化设置的 MySQL 8.x 自建实例，也可以使用：

```sql
-- 同时修改运行时配置并写入持久化配置
SET PERSIST max_prepared_stmt_count = 32768;
```

这些操作需要相应管理权限。使用配置文件管理的环境，应同步配置来源；云数据库则应使用其支持的参数管理方式，并确认重启、扩容和切换后的生效值。[MySQL 持久化参数说明](https://dev.mysql.com/doc/refman/8.4/en/persisted-system-variables.html)

变更范围要包括主库、承担读流量的副本以及可能接管流量的候选实例。各实例不一定必须使用相同数值，但都应能覆盖自己预期承担的负载。

如果根因在应用侧，修复重点应放在语句生命周期、连接池规模、缓存容量和 SQL 模板数量上。调大数据库额度后，也要继续观察存量是否收敛。

## 如何确定合适的值？

没有一个适合所有系统的固定数字。比较实用的做法是：

1. 采集完整业务周期中的 `Prepared_stmt_count`，覆盖预热和高峰。
2. 在压测中加入滚动发布、扩容和副本故障后的流量集中场景。
3. 对比语句数量与实例内存变化，评估增加额度的成本。
4. 按实测峰值和故障场景留出余量，再设置告警。

告警可以同时看使用比例和增长趋势。例如，持续超过 80% 可以作为初始预警条件，再按业务调整；若数量一直上涨，即使当前比例不高，也值得提前检查。这是运维起点，不是 MySQL 官方规定的阈值。

这个参数的价值，在于给共享实例上的预编译语句设置一道资源边界。把连接数、每连接缓存和数据库总额度放在一起管理，才能判断下一次扩容究竟增加了多少需求，也能在 Error 1461 出现时更快找到原因。
