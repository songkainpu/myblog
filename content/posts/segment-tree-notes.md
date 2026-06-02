---
title: "标准线段树笔记（Java版）"
date: 2026-06-02T09:15:27+08:00
draft: false
tags: ["算法", "线段树", "Java", "数据结构"]
categories: ["技术"]
---

线段树是我觉得最值得先掌握的区间数据结构之一。它不难，但第一次学的时候，容易被“递归建树”“区间拆分”“下标映射”这些细节绕住。把它拆开看，其实只有三件事：建树、查询、修改。

这篇笔记我用 `Java` 来写，并且会重点说明一件事：**线段树通常不是用一堆树节点对象来实现，而是用数组来实现**。这不是偷懒，而是它本来就非常适合数组。

## 1. 线段树解决什么问题

如果题目同时满足下面两点，线段树通常就是候选答案：

- 维护一个数组
- 需要频繁做区间查询或单点修改

最常见的场景是：

- 区间和
- 区间最值
- 区间 gcd
- 区间统计类信息

如果只是静态查询，前缀和、稀疏表有时会更简单；如果是区间修改，那就要考虑懒标记线段树，而不是这份“标准线段树”。

## 2. 为什么线段树常用数组实现

这个点很重要。很多人第一次学的时候，会直觉地想：

> 既然叫树，那是不是应该 new 一堆 Node？

理论上可以，但实际写题时，**大多数人都用数组**，原因很直接。

### 1）线段树的结构是固定的

线段树本质上是一棵完全二叉树风格的结构。节点之间的关系可以直接用下标表达：

- 父节点：`p`
- 左儿子：`p * 2`
- 右儿子：`p * 2 + 1`

也就是说，**不需要真的保存指针**，只要一个数组就够了。

### 2）Java 里对象开销更大

如果你真的用 `TreeNode` 去建树，会带来这些额外成本：

- 每个节点都要 `new`
- 会有对象头、引用字段等额外内存开销
- 垃圾回收压力更大
- 代码也更长

对算法题来说，这些成本都没必要。

### 3）数组更快，也更稳

数组是连续内存，访问时局部性更好；而对象节点会有更多间接访问。对于线段树这种会频繁递归访问父子节点的结构，数组实现通常更简洁，也更容易写对。

### 4）空间也容易估算

线段树通常直接开：

```java
int[] tree = new int[4 * n];
```

这样就够用了。不是因为树真有 `4n` 个节点，而是这个容量足够覆盖递归分裂后的所有节点，写起来最稳。

一句话总结：

> 线段树用数组，不是“偷懒”，而是它和这种结构天然匹配。

## 3. 核心思想

线段树本质上是把一个区间不断二分，形成一棵树。

设当前节点维护区间 `[l, r]`：

- 左儿子维护 `[l, mid]`
- 右儿子维护 `[mid + 1, r]`
- 当前节点的答案由两个子区间合并得到

这里的“合并”是线段树最核心的东西：

- 区间和：左右儿子相加
- 区间最小值：左右儿子取 `Math.min`
- 区间最大值：左右儿子取 `Math.max`

所以线段树不是一种固定公式，而是一种“区间分治框架”。

## 4. Java 标准模板

下面我用“区间最大值 + 单点修改”来写一版最标准的模板。这个版本最适合入门，也最容易理解数组实现的线段树。

### 代码模板

```java
public class SegmentTree {
    private final int[] nums;
    private final int[] tree;

    public SegmentTree(int[] nums) {
        this.nums = nums.clone();
        this.tree = new int[nums.length * 4];
        if (nums.length > 0) {
            build(1, 0, nums.length - 1);
        }
    }

    public void update(int index, int value) {
        nums[index] = value;
        update(1, 0, nums.length - 1, index, value);
    }

    public int query(int left, int right) {
        return query(1, 0, nums.length - 1, left, right);
    }

    private void build(int node, int left, int right) {
        if (left == right) {
            tree[node] = nums[left];
            return;
        }

        int mid = left + ((right - left) >> 1);
        build(node * 2, left, mid);
        build(node * 2 + 1, mid + 1, right);
        tree[node] = Math.max(tree[node * 2], tree[node * 2 + 1]);
    }

    private void update(int node, int left, int right, int index, int value) {
        if (left == right) {
            tree[node] = value;
            return;
        }

        int mid = left + ((right - left) >> 1);
        if (index <= mid) {
            update(node * 2, left, mid, index, value);
        } else {
            update(node * 2 + 1, mid + 1, right, index, value);
        }

        tree[node] = Math.max(tree[node * 2], tree[node * 2 + 1]);
    }

    private int query(int node, int left, int right, int queryLeft, int queryRight) {
        if (queryRight < left || right < queryLeft) {
            return Integer.MIN_VALUE;
        }

        if (queryLeft <= left && right <= queryRight) {
            return tree[node];
        }

        int mid = left + ((right - left) >> 1);
        int leftAns = query(node * 2, left, mid, queryLeft, queryRight);
        int rightAns = query(node * 2 + 1, mid + 1, right, queryLeft, queryRight);
        return Math.max(leftAns, rightAns);
    }
}
```

## 5. 这个模板在做什么

### `build`

建树就是把原数组的值一层层灌到树上。

- 叶子节点对应原数组里的单个元素
- 非叶子节点由左右儿子合并得到

### `query`

查询时只关心“当前区间”和“目标区间”的关系：

- 如果当前区间完全包含在目标区间里，直接返回
- 如果完全不相交，返回一个不会影响结果的值
- 如果只覆盖一部分，就继续往下拆

这个过程本质上是在树上做选择性递归。

### `update`

单点修改的逻辑也很简单：

- 先一路找到要修改的位置
- 改叶子节点
- 再一路向上更新父节点

因为父节点依赖子节点，所以修改完叶子以后，祖先节点的值也必须重新计算。

## 6. 结合一个示例看思路

我们用一个很典型的场景来理解。

### 示例

数组：

```text
nums = [2, 5, 1, 8]
```

支持两种操作：

1. 查询区间 `[1, 3]` 的最大值
2. 把 `nums[2]` 修改成 `10`

### 第一步：建树

线段树会把区间不断拆分：

```text
               [0,3]
              max=8
             /      \
        [0,1]      [2,3]
        max=5      max=8
        /  \       /   \
     [0]  [1]   [2]   [3]
      2     5     1     8
```

根节点 `[0,3]` 保存整个数组的最大值 `8`。

### 第二步：查询 `[1, 3]`

查询时，根节点区间 `[0,3]` 和目标区间 `[1,3]` 有部分重叠，所以继续往下拆。

- 左子树 `[0,1]` 和 `[1,3]` 部分重叠
- 右子树 `[2,3]` 和 `[1,3]` 完全包含

最后合并左右结果，得到：

```text
max(5, 8) = 8
```

所以第一次查询结果是 `8`。

### 第三步：修改 `nums[2] = 10`

修改时只需要沿着索引 `2` 对应的路径往下走：

- 找到叶子节点 `[2]`
- 把值改成 `10`
- 回溯更新父节点

更新后数组变成：

```text
[2, 5, 10, 8]
```

对应的根节点最大值也变成 `10`。

### 第四步：再次查询 `[1, 3]`

这时区间最大值变成：

```text
max(5, 10, 8) = 10
```

这就是线段树的核心价值：**查询和修改都只沿着树高做递归，复杂度是 `O(log n)`**。

## 7. 解题思路怎么总结

如果你在题目里看到这类要求，可以这样想：

1. 先判断是不是“区间查询 + 单点修改”
2. 如果是，就考虑线段树
3. 明确节点里维护什么值
4. 明确合并规则是 `max`、`min`、`+` 还是别的
5. 用数组实现整棵树，父子下标固定
6. 查询时判断三种情况：
   - 完全无交集
   - 完全包含
   - 部分重叠
7. 修改时走到叶子，再一路回溯更新

如果是这类题，关键通常不在代码模板，而在你能不能快速判断：

> 这题是不是标准线段树，节点里该存什么，合并规则是什么。

## 8. 常见坑

### 1）区间边界混乱

建议全程统一成闭区间 `[l, r]`，不要一会儿左闭右开，一会儿又写成闭区间。

### 2）`mid` 写错

常用写法是：

```java
int mid = left + ((right - left) >> 1);
```

这种写法比直接写 `left + right >> 1` 更稳妥。

### 3）返回值的“默认值”要对

如果你维护的是最大值：

- 无交集时返回 `Integer.MIN_VALUE`

如果你维护的是最小值：

- 无交集时返回 `Integer.MAX_VALUE`

如果你维护的是区间和：

- 无交集时返回 `0`

这个细节很容易写错。

### 4）题目如果有区间修改

标准模板只适合单点修改。

一旦题目出现：

- 区间加
- 区间赋值
- 区间翻转

就需要懒标记，否则复杂度会退化，写法也会完全不一样。

## 9. 一句话总结

线段树就是：

> 用一棵数组实现的二叉区间树，维护区间信息，查询时按区间拆分，修改时沿路径回溯更新。

如果你把这三件事真正理解了：

- 节点维护什么
- 区间怎么拆
- 父节点怎么合并

那线段树题目就会从“看不懂”变成“只是套框架”。

