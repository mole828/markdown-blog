---
title: Hello, Kotlin
date: 2026-09-16
description: 三种 Kotlin 代码块的最小运行示例。
tags: [Kotlin]
---
点击代码块右上角「运行」查看结果，也可以编辑后再试一次。每个代码块独立执行。

## kotlin：代码片段

围栏开头写 `kotlin`。执行时自动包在 `fun main() { … }` 中，只需要写函数体。

```kotlin
val name = "Kotlin"
println("Hello, $name!")
```

## kotlin file：完整文件

围栏开头写 `kotlin file`。代码原样执行，可以写导入、顶层声明，并自行定义 `main()`。

```kotlin file
import kotlin.math.sqrt

fun main() {
    println(sqrt(81.0))
}
```

## kotlin test：测试文件

围栏开头写 `kotlin test`。使用 `kotlin.test` 编写测试类，不需要 `main()`；运行后显示测试结果。

```kotlin test
import kotlin.test.*

class SampleTest {
    @Test
    fun `test sum`() {
        assertEquals(42, 1 + 41)
    }
}
```
