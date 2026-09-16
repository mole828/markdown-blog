---
title: Kotlin 结构化协程：让并发任务有始有终，与 Go 对照
date: 2026-09-16
description: 用可运行示例观察子任务等待、失败传播和取消清理，再用 Go 的 context 与 errgroup 实现同样的任务边界。
tags: [Kotlin, Go, 协程, 并发]
---

假设一个请求要同时读取用户资料和订单。启动两个任务很容易，更需要回答的是：请求什么时候算完成？其中一个失败后，另一个还要继续吗？调用方退出后，谁负责收尾？

Kotlin 的结构化并发把这些关系放进协程作用域：子任务归属于父任务，作用域等待子任务结束，取消沿任务树传递。这样，一个内部启动了并发任务的函数，仍然可以提供清晰的“返回即完成”约定。[coroutineScope 文档](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/coroutine-scope.html)

下面的 Kotlin 代码块可以直接点击运行，每块都是独立程序。Go 代码用于对照，需在本地 Go 环境运行。所有等待都用模拟操作，不访问真实业务接口，也不做性能排名。

## 1. 自动等待：函数返回时，子任务已经收尾

先运行一个小实验：创建 1,000 个协程，但只输出最终结果。

```kotlin file
import kotlinx.coroutines.*

suspend fun processBatch(): Int {
    var completed = 0
    coroutineScope {
        repeat(1_000) {
            launch {
                delay(100)
                completed++
            }
        }
    }
    // coroutineScope 返回时，所有子任务已经完成。
    return completed
}

fun main() = runBlocking {
    val completed = processBatch()
    check(completed == 1_000)
    println("函数返回，已完成 $completed 个任务")
}
```

没有逐个保存 `Job` 再调用 `join()`，`coroutineScope` 已经负责等待。下面再看更贴近实际的结果聚合：

```kotlin file
import kotlinx.coroutines.*

suspend fun loadPage(): String = coroutineScope {
    val profile = async { delay(100); "用户资料" }
    val orders = async { delay(150); "订单列表" }
    "${profile.await()} + ${orders.await()}"
}

fun main() = runBlocking {
    println(loadPage())
    println("页面数据已准备完成")
}
```

两个 `async` 都在 `await` 之前启动，所以等待第一个结果时，第二个任务也可以继续推进。`await` 负责取值，作用域负责生命周期。这种封装允许 `loadPage()` 的调用方像调用普通挂起函数一样使用它，无需接管内部任务句柄。

第一个实验继承了 `runBlocking` 的单线程事件循环，所以计数没有并行写入。如果改成 `Dispatchers.Default`，必须用原子计数或其他同步方式；结构化并发不自动解决数据竞争。1,000 个协程也不代表 1,000 个线程。[协程与线程](https://kotlinlang.org/docs/coroutines-basics.html)

## 2. 一个失败，其他无用任务取消，清理完成后再返回

当用户资料获取失败，继续等待订单可能已经没有意义。用一个明确的启动信号，保证观察到订单任务先启动，再发生失败：

```kotlin file
import kotlinx.coroutines.*

fun main() = runBlocking {
    try {
        coroutineScope {
            val started = CompletableDeferred<Unit>()
            launch {
                try {
                    println("订单任务启动")
                    started.complete(Unit)
                    awaitCancellation()
                } finally {
                    println("订单任务清理完成")
                }
            }
            launch {
                started.await()
                error("用户资料读取失败")
            }
        }
    } catch (e: IllegalStateException) {
        println("调用方收到：${e.message}")
    }
    println("请求结束")
}
```

预期顺序：

```text
订单任务启动
订单任务清理完成
调用方收到：用户资料读取失败
请求结束
```

普通作用域中的子任务抛出非取消异常，会导致作用域失败并取消兄弟任务。外层 `catch` 收到异常时，作用域内的子任务已经结束。这里把 `try/catch` 放在整个 `coroutineScope` 外，形成统一的错误处理边界。[异常传播规则](https://kotlinlang.org/docs/exception-handling.html)

### Go 如何实现同样的行为？

Go 可以用 `errgroup.WithContext` 组合等待、错误返回和取消通知。保存为 `main.go`，在一个 Go module 中安装 `golang.org/x/sync/errgroup` 后运行：

```sh
go mod init example.com/structured-demo
go get golang.org/x/sync/errgroup
go run .
```

```go
package main

import (
    "context"
    "errors"
    "fmt"

    "golang.org/x/sync/errgroup"
)

func loadPage(ctx context.Context) error {
    group, ctx := errgroup.WithContext(ctx)
    started := make(chan struct{})

    group.Go(func() error {
        defer fmt.Println("订单任务清理完成")
        fmt.Println("订单任务启动")
        close(started)
        <-ctx.Done() // 主动响应取消通知
        return ctx.Err()
    })

    group.Go(func() error {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-started:
            return errors.New("用户资料读取失败")
        }
    })

    return group.Wait() // 等所有任务退出，返回第一个非 nil 错误
}

func main() {
    if err := loadPage(context.Background()); err != nil {
        fmt.Println("调用方收到：", err)
    }
    fmt.Println("请求结束")
}
```

它实现了相同的任务边界：第一个错误取消派生的 context，另一个任务观察到取消后退出，`Wait()` 等待全部结束。`errgroup` 来自 Go 扩展库；`context` 是标准库。这里处理的是返回的 `error`，不要把 goroutine 中的 `panic` 当成会由 `Wait()` 返回的错误。[errgroup 文档](https://pkg.go.dev/golang.org/x/sync/errgroup)

Kotlin 的便利在于，`launch`、`async` 默认接入当前作用域，`delay` 等可取消挂起函数会响应取消。Go 通常显式传递 `ctx`，让阻塞操作通过 `select` 或支持 context 的 API 响应取消；取消 context 本身不会等待 goroutine 退出，所以还需要 `Wait()`。[context 文档](https://pkg.go.dev/context)

## 3. 超时覆盖整个任务树

把期限放在外层，可以让本次操作的子任务共享一个生命周期。

```kotlin file
import kotlinx.coroutines.*

fun main() = runBlocking {
    try {
        withTimeout(300) {
            coroutineScope {
                repeat(3) { id ->
                    launch {
                        try {
                            delay(2_000)
                            println("任务 $id 正常完成")
                        } finally {
                            println("任务 $id 清理完成")
                        }
                    }
                }
            }
        }
    } catch (e: TimeoutCancellationException) {
        println("整体超时，子任务已结束")
    }
}
```

通常会看到三行清理信息，之后打印整体超时；清理顺序不应作为程序逻辑的依据。Go 对应的组合是 `context.WithTimeout`、`defer cancel()` 和 `errgroup.WithContext`，再由每个任务响应该 context。

两边的取消都需要任务配合。Kotlin 的 CPU 密集循环应检查 `ensureActive()` 或适当调用 `yield()`；把 `Thread.sleep` 放进协程不会自动变成可取消等待。Go 的计算循环也需要检查 `ctx.Done()`。因此，超时并不保证到点就能强行终止任意代码。[withTimeout 文档](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/with-timeout.html)

## 4. 部分失败可以接受时，明确选择隔离

例如推荐内容失败不应该让用户资料一起失败，可以使用 `supervisorScope`：

```kotlin file
import kotlinx.coroutines.*

fun main() = runBlocking {
    supervisorScope {
        val profile = async { delay(100); "用户资料" }
        val recommendations = async<String> {
            delay(50)
            throw IllegalStateException("推荐服务不可用")
        }
        val recommendationText = try {
            recommendations.await()
        } catch (e: IllegalStateException) {
            "暂无推荐"
        }
        println("${profile.await()}；$recommendationText")
    }
}
```

`supervisorScope` 隔离子任务之间的失败，但仍然等待它们结束，也仍然向下传播父任务的取消。示例显式处理了 `await()` 的异常；如果让异常逃出作用域代码块，整个作用域仍会失败。它不会自动吞掉错误。普通 `coroutineScope` 中的 `async` 失败则会影响父作用域，仅在 `await()` 周围捕获异常无法把它变成监督关系。[监督作用域](https://kotlinlang.org/docs/exception-handling.html#supervision)

Go 中可以把可接受的业务失败保存为结果，让对应的 `group.Go` 函数返回 `nil`，同时保留对父 context 取消的响应。两种写法都需要明确区分“整体失败”和“允许降级”。

## 选择时看任务边界

| 关注点 | Kotlin | Go |
| --- | --- | --- |
| 等待一组子任务 | `coroutineScope` 自动等待 | 显式 `errgroup.Wait()` 或其他等待机制 |
| 一个任务失败后停止同组工作 | 普通作用域传播失败并取消兄弟任务 | `errgroup.WithContext` 发出取消，任务主动响应 |
| 取消向下传播 | 通过父子 `Job` 关系 | 通过传递的 `context` |
| 部分失败隔离 | `supervisorScope` 配合异常处理 | 业务错误转结果，显式决定是否返回错误 |
| 是否自动限制并发数量 | 否 | goroutine 本身不会；`errgroup.SetLimit` 可限制组内任务数 |

Kotlin 的优势是把等待、失败与取消整合进常用协程 API，让嵌套函数更容易保留一致的生命周期约定。Go 用显式的 context、任务组和 error 也可以构建清晰的并发边界，责任划分在代码中更直观。

这些约定都依赖正确使用：Kotlin 中随手创建独立 `CoroutineScope` 或使用 `GlobalScope`，可能脱离当前任务树；Go 中绕过任务组启动裸 goroutine，也需要另外安排退出和等待。涉及数据库、连接池或外部 API 时，还需要单独限制并发访问量。结构化并发管理任务归属，不替代限流、同步或事务回滚。
