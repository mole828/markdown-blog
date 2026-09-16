---
title: Kotlin、Go、Rust、TypeScript：并发任务如何等待、失败与取消
date: 2026-09-16
description: 用可运行示例比较 Kotlin、Go、Rust 与 TypeScript 的并发任务等待、失败传播、取消、超时和部分失败处理。
tags: [Kotlin, Go, Rust, TypeScript, 协程, 并发]
---

假设一个请求要同时读取用户资料和订单。启动两个任务很容易，更需要回答的是：请求什么时候算完成？其中一个失败后，另一个还要继续吗？调用方退出后，谁负责收尾？

Kotlin 的 `coroutineScope` 把子任务放进父任务的生命周期中；Go 用 `context` 和 `errgroup` 显式组合取消与等待；Rust 的 Tokio `try_join!` 并发轮询同一个任务中的多个 future；TypeScript 则需要自己把 `AbortSignal` 传给任务，并在需要时等待它们全部结束。这些代码解决相似的问题，但采用的任务边界并不完全相同。

本文的 Kotlin 和 Rust 代码块可在页面内运行，TypeScript 代码在浏览器中转译并运行。Go 代码块的运行按钮会复制代码并打开官方 [Go Playground](https://go.dev/play/)，需要在 Playground 中粘贴后运行；也可以在本地 Go 环境运行。所有等待都用模拟操作，不访问真实业务接口，也不做性能排名。

## 1. 自动等待：函数返回时，子任务已经收尾

先用 Kotlin 创建 1,000 个协程，但只输出最终结果：

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

两个 `async` 都在 `await` 之前启动，所以等待第一个结果时，第二个任务也可以继续推进。`await` 负责取值，作用域负责生命周期。`coroutineScope` 会等所有子协程结束后才返回。[coroutineScope 文档](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/coroutine-scope.html)

第一个实验继承了 `runBlocking` 的单线程事件循环，所以计数没有并行写入。如果改成 `Dispatchers.Default`，必须用原子计数或其他同步方式；结构化并发不自动解决数据竞争。1,000 个协程也不代表 1,000 个线程。[协程与线程](https://kotlinlang.org/docs/coroutines-basics.html)

## 2. 一个失败后，其他任务如何停止并收尾

当用户资料获取失败，继续等待订单可能已经没有意义。Kotlin 普通作用域中的子任务抛出非取消异常，会导致作用域失败并取消兄弟任务。下面用启动信号保证订单任务先启动，再发生失败：

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

外层 `catch` 收到异常时，作用域内的子任务已经结束。这里把异常处理放在整个 `coroutineScope` 外，形成统一的错误边界。[异常传播规则](https://kotlinlang.org/docs/exception-handling.html)

### Go：用 context 通知取消，用 Wait 等任务退出

Go 可以用 `errgroup.WithContext` 组合等待、错误返回和取消通知。保存为 `main.go`，在一个 Go module 中安装 `golang.org/x/sync/errgroup` 后运行：

```sh
go mod init example.com/structured-demo
go get golang.org/x/sync/errgroup
go run .
```

```go runnable
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

第一个非 `nil` 错误会取消派生的 context，另一个任务观察到取消后退出，`Wait()` 等待全部任务结束。取消 context 只是发送通知，不会强行终止 goroutine；任务必须响应 context 并返回。[errgroup 文档](https://pkg.go.dev/golang.org/x/sync/errgroup) [context 取消文档](https://go.dev/doc/database/cancel-operations)

### Rust：try_join! 取消未完成的 future

Tokio 的 `try_join!` 在当前任务中并发轮询多个 future。某个分支返回 `Err` 时，宏返回该错误，并丢弃其他尚未完成的 future。下面没有使用 `tokio::spawn`：资料分支的 `Drop` guard 会在它的 future 被丢弃时运行。

```rust runnable
// cargo-deps: tokio = { version = "1", features = ["macros", "rt", "time"] }
use std::future::pending;
use std::time::Duration;
use tokio::time::sleep;

struct Cleanup(&'static str);

impl Drop for Cleanup {
    fn drop(&mut self) {
        println!("{}：Drop 同步清理", self.0);
    }
}

async fn load_profile() -> Result<&'static str, &'static str> {
    let _cleanup = Cleanup("资料分支");
    println!("资料分支启动");
    pending::<()>().await;
    Ok("用户资料")
}

async fn load_orders() -> Result<&'static str, &'static str> {
    println!("订单分支启动");
    sleep(Duration::from_millis(100)).await;
    Err("订单读取失败")
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let result = tokio::try_join!(load_profile(), load_orders());
    match result {
        Ok((profile, orders)) => println!("{profile} + {orders}"),
        Err(error) => println!("调用方收到：{error}"),
    }
    println!("请求结束");
}
```

通常会看到两个分支启动、资料分支的同步清理、错误和请求结束。`Drop` 适合释放同步资源或记录清理；它不能 `await`，因此不等同于异步清理。若清理必须等待异步操作完成，需要显式安排取消通知和异步收尾，并在返回前 `await` 收尾任务。`try_join!` 在同一个任务上轮询这些 future，并不意味着并行运行；Tokio 文档也说明了它和 `spawn` 的区别。[try_join! 文档](https://docs.rs/tokio/latest/tokio/macro.try_join.html) [Rust Drop 文档](https://doc.rust-lang.org/std/ops/trait.Drop.html)

### TypeScript：AbortController 发出通知，Promise.allSettled 等待收尾

`Promise.all` 遇到一个拒绝时会立刻拒绝返回的 promise，但不会取消其他操作。要做到失败后通知兄弟任务，并等它们全部结束，需要把同一个 `AbortSignal` 传给任务，并在 `finally` 中等待 `Promise.allSettled`。这段代码在浏览器中运行：

```typescript runnable
function abortableDelay<T>(
  name: string,
  duration: number,
  signal: AbortSignal,
  value: T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(`${name}已取消`));
      return;
    }

    console.log(`${name}启动`);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      console.log(`${name}收到取消信号，清理完成`);
      reject(new Error(`${name}已取消`));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      console.log(`${name}完成`);
      resolve(value);
    }, duration);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function loadPage(): Promise<void> {
  const controller = new AbortController();
  const tasks = [
    abortableDelay("用户资料", 1_000, controller.signal, "用户资料"),
    abortableDelay("订单", 150, controller.signal, "订单").then(() => {
      throw new Error("订单读取失败");
    }),
  ] as const;

  try {
    const [profile, orders] = await Promise.all(tasks);
    console.log(`${profile} + ${orders}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`捕获失败：${message}；通知其他任务取消`);
    controller.abort();
  } finally {
    const results = await Promise.allSettled(tasks);
    console.log(`所有任务结束：${results.map((item) => item.status).join(", ")}`);
  }

  console.log("请求结束");
}

await loadPage();
```

最后的顶层 `await loadPage()` 会让页面运行器等到清理完成再回收执行环境。订单失败后，`catch` 调用 `abort()`，资料任务收到信号并清理定时器；`finally` 等到两个 promise 都已兑现或拒绝后才结束。这个模拟 API 主动响应了 signal。实际 API 也必须支持取消并完成自己的收尾；单独调用 `Promise.all` 或 `AbortController.abort()` 不会强制停掉不响应信号的任务。[AbortController 文档](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) [Promise.all 与并发](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises) [Promise.allSettled 文档](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled)

## 3. 超时覆盖哪些任务？

Kotlin 可以把超时设在作用域外层，让本次操作中的子任务一起收到取消：

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

四种方式对超时的处理也不同：Go 用 `context.WithTimeout` 发出取消通知，再由任务检查 context 并由 `Wait()` 等退出；Tokio 的 `timeout` 到期后丢弃内部 future；TypeScript 可用计时器调用 `AbortController.abort()`，再像上一节那样等 `Promise.allSettled`。超时通知都不能保证任意代码立刻停止：Kotlin 的 CPU 密集循环应检查 `ensureActive()` 或调用 `yield()`，Go 计算循环应检查 `ctx.Done()`，TypeScript 操作必须处理 signal；Rust 的 future 被丢弃时会同步运行析构逻辑，但不会自动等待异步收尾。Tokio 的超时也需要执行器获得轮询机会；不让出执行权的计算可能超过期限，TypeScript 阻塞事件循环时也会推迟取消计时器。[Kotlin withTimeout 文档](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/with-timeout.html) [Tokio timeout 文档](https://docs.rs/tokio/latest/tokio/time/fn.timeout.html)

## 4. 部分失败可以接受时，明确选择隔离

例如推荐内容失败不应该让用户资料一起失败，Kotlin 可以用 `supervisorScope`，并显式处理 `await()` 的异常：

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

`supervisorScope` 隔离子任务之间的失败，但仍然等待它们结束，也仍然向下传播父任务的取消。如果异常逃出作用域代码块，整个作用域仍会失败；监督关系不会自动吞掉错误。[监督作用域](https://kotlinlang.org/docs/exception-handling.html#supervision)

其他语言也要显式定义“可以忽略的失败”：Go 可以把可接受的业务失败转成结果，让任务返回 `nil`，同时仍把 context 取消作为错误返回；Rust 可以在传给 `try_join!` 之前于对应分支处理 `Err`，避免该错误触发整个组合的提前返回；TypeScript 可以让单个任务捕获可降级错误，或用 `Promise.allSettled` 检查每个结果。`allSettled` 负责等待和报告结果，不会自行取消任何任务。

## 按任务边界比较

| 关注点 | Kotlin | Go | Rust（Tokio） | TypeScript（浏览器） |
| --- | --- | --- | --- | --- |
| 等待一组任务 | `coroutineScope` 自动等待子协程 | `errgroup.Wait()` 等 goroutine 返回 | `try_join!` 轮询 future，成功时等全部完成 | `Promise.all` 等全部成功；失败时立刻拒绝，可再用 `allSettled` 等全部结束 |
| 一个任务失败 | 普通作用域取消兄弟任务，并在作用域结束前等待 | `errgroup.WithContext` 发出取消，任务需响应；`Wait` 负责等待 | `try_join!` 返回第一个错误并丢弃其他未完成 future | `Promise.all` 本身不取消；需调用 `AbortController.abort()`，任务也要响应 signal |
| 取消与清理 | 父子 `Job` 传播取消，`finally` 执行收尾 | `context` 传递取消和期限，任务合作退出 | 丢弃 future 会同步析构已拥有的资源；`Drop` 不可异步等待 | `AbortSignal` 是通知机制，`allSettled` 可等待 promise 最终状态 |
| 超时 | `withTimeout` 取消作用域中的子任务 | `context.WithTimeout` 通知任务，之后等待其返回 | `tokio::time::timeout` 超时后丢弃内部 future | 定时器调用 `abort()`，然后等待 `allSettled` |
| 部分失败 | `supervisorScope` 加异常处理 | 把允许降级的业务失败转换成普通结果 | 在单个分支处理 `Result`，再组合 futures | 单个 promise 捕获错误，或用 `allSettled` 检查结果 |

Kotlin 的作用域把等待、失败与取消整合进常用协程 API。Go 用显式的 context、任务组和 error 构建任务边界。Rust 的 future 组合能在调用处清楚表达同时等待哪些分支，但异步清理需要额外设计。TypeScript 的 Promise 提供并发组合，取消通知和等待清理则由调用方接线。

四种方式都依赖正确使用：Kotlin 中创建脱离当前任务树的 scope，Go 中绕过任务组启动 goroutine，Rust 中把工作 `spawn` 到独立任务后不管理句柄，或 TypeScript 中忘记传递 signal，都可能让工作超出调用方预期。结构化任务生命周期也不替代限流、同步、数据库事务或远端副作用的回滚。
