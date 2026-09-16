# Markdown Blog

Astro 静态博客：只写 Markdown，Git 更新后构建发布。一个仓库同时保存文章、样式与部署脚本。

## 本地运行

安装 Node.js 24，然后：

```sh
npm ci
npm run dev
```

打开 http://localhost:4321 。开发启动会替换旧进程；文章使用延迟渲染，避免内容集合缓存旧版 Markdown 插件的 HTML。如果提示开发服务已经运行，先执行 `npx astro dev stop`，再执行 `npm run dev`。`npm run check` 检查类型，`npm run build` 生成 `dist/`，`npm run preview` 预览构建产物。

## 写文章

在 `content/posts/` 下添加 `.md`，支持子目录。路径决定文章 URL，重命名文件会改变链接。

````markdown
---
title: 我的第一篇文章
date: 2026-09-16
description: 可选的一句话摘要
tags: [Kotlin]
draft: false
---

## 正文

普通 Markdown 即可。

```kotlin
println("Hello, blog!")
```
````

标题、日期必填；摘要、标签、draft 可省略。`draft: true` 不生成公开页面，也不出现在列表、标签中。未来日期不会自动隐藏。文章按日期倒序排列。

所有 `kotlin` 代码块默认可运行。页面内置代码高亮、编辑、重置和运行按钮，输出显示在代码下方。默认提交时自动包裹为 `fun main() { ... }`，正文不显示包装代码。

完整 Kotlin 文件使用 `kotlin file`（围栏语言仍是 kotlin，file 是元信息）：

````markdown
```kotlin file
import kotlin.math.sqrt

fun main() {
    println(sqrt(81.0))
}
```
````

完整文件模式原样提交，适合 `import`、顶层声明或自行定义 `main()`。默认片段模式只接受函数体内容；各代码块独立执行，不共享变量。编辑后可按 Ctrl/Cmd + Enter 运行；重置恢复文章原文。阅读和编辑共用 Shiki Kotlin TextMate 语法与 Kotlin 官网风格配色，编辑时实时染色，完成编辑后保留高亮。浏览器只在编辑时加载 Kotlin 高亮模块。该方案是语法染色，不等同于 IntelliJ 的类型/符号语义分析。

测试文件使用 `kotlin test`，原样发送到官方 JUnit 4 测试端点，不包装 `main()`：

````markdown
```kotlin test
import kotlin.test.*

class GreetingTest {
    @Test fun greeting() {
        assertEquals("Hello, Kotlin!", "Hello, " + "Kotlin!")
    }
}
```
````

结果按测试方法列出通过/失败、断言信息和汇总。需要类内的 `@Test` 方法，不是顶层 `assert` 片段。测试端点默认从运行端点的 `/run` 替换为 `/test`，可单独设置 `PUBLIC_KOTLIN_TEST_URL`；改配置后重新构建。

浏览器点击运行才向 Kotlin 官方编译接口发送代码，不使用 kotlin-playground 编辑器组件。默认接口为 `https://api.kotlinlang.org/api/2.4.20/compiler/run`。可通过构建时环境变量 `PUBLIC_KOTLIN_RUN_URL` 替换（需支持相同协议和浏览器 CORS）；更改后重新构建。网络失败、30 秒超时、编译错误和运行异常会显示在结果区，错误行号会换算为正文中的行号。服务可用性与支持版本取决于 Kotlin 官方。

图片可放在 `public/images/`，Markdown 使用 `![说明](/images/example.png)`。文章内容按受信任的作者内容处理，可使用 HTML。

## 修改外观

- `src/layouts/Base.astro`：站点名、页脚、SEO 默认描述。
- `src/pages/index.astro`：首页介绍。
- `src/styles/global.css`：书页、清爽、夜读三种阅读样式及排版。
- `src/plugins/runnable.mjs`：可运行代码块的 Markdown 约定。

## GitHub Actions 自动部署（推荐）

`.github/workflows/deploy.yml` 在推送 `main` 或 Actions 页面手动 Run workflow 时执行：Node 24 安装依赖 → 类型检查、测试 → 静态构建 → SSH 上传 → 原子切换 `current`。仅允许 main 发布，并发发布排队，不中途取消正在进行的发布。构建/上传/解包失败不会切换线上版本；历史版本保留。工作流不会自动修改 Caddy 或 DNS。

### 首次配置

在 GitHub 仓库 Settings → Secrets and variables → Actions 添加 Repository secrets：

| Secret | 内容 |
| --- | --- |
| `DEPLOY_HOST` | GitHub runner 可访问的真实域名或 IPv4 地址，不能填本机 SSH 别名 mc |
| `DEPLOY_USER` | SSH 登录用户：blog-deploy |
| `DEPLOY_PORT` | SSH 端口，可省略，默认 22 |
| `DEPLOY_SSH_KEY` | 专用部署私钥的完整内容（含 BEGIN/END 行），无口令 |
| `DEPLOY_KNOWN_HOSTS` | 已核验的 SSH 主机公钥记录，known_hosts 格式 |

Repository variables（非 Secrets）：

- `DEPLOY_ROOT`：可省略，默认 `/srv/markdown-blog`。绝对路径，仅支持字母、数字、下划线、连字符和斜杠。
- `PUBLIC_KOTLIN_RUN_URL` / `PUBLIC_KOTLIN_TEST_URL`：可选，自定义官方兼容编译接口。

生成单独的部署密钥，不要复用个人 SSH 私钥：

```sh
ssh-keygen -t ed25519 -f ./blog-deploy-key -C github-actions-markdown-blog -N ''
```

将 `.pub` 文件的公钥追加到服务器部署用户的 `~/.ssh/authorized_keys`，可在公钥前加 `restrict ` 禁止转发和终端（仍允许发布命令）。私钥保存到 `DEPLOY_SSH_KEY`，不要提交仓库。工作流使用严格主机校验，不在运行时盲目信任 ssh-keyscan。

主机公钥可从已经信任的连接读取：`ssh mc 'cat /etc/ssh/ssh_host_ed25519_key.pub'`。将内容前面加上实际 `DEPLOY_HOST`，形成 `hostname ssh-ed25519 AAAA...`；非 22 端口应为 `[hostname]:port ssh-ed25519 AAAA...`，写入 `DEPLOY_KNOWN_HOSTS`。

mc 的 Caddy 通过 `/srv/markdown-blog:/srv/markdown-blog:ro` 只读挂载发布目录。部署用户需要可写发布目录；服务器只需 Bash、tar、flock 和 GNU coreutils，无需 Node/npm。按 `deploy/Caddyfile.actions.example` 增加独立博客域名，容器内根目录为 `/srv/markdown-blog/current`。首次发布完成后校验并重载 Caddy：

```sh
docker exec web caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec web caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

后续只需 git push。Caddy 无需随文章发布重启。不要把仓库或发布父目录直接作为 Web 根目录。更改 DEPLOY_ROOT 时须同时调整 Caddy 对应挂载/路径。

### 回滚

在服务器执行（RELEASE 替换为 releases 下的历史目录名）：

```sh
cd /srv/markdown-blog
(
  flock -w 120 9
  test -s releases/RELEASE/index.html || exit 1
  ln -s releases/RELEASE .rollback
  mv -Tf .rollback current
) 9>.deploy.lock
```

只切换静态产物，不修改源码。历史版本不自动清理；中断上传可能留下 `.upload-*.tar.gz`，确认没有发布任务后可删除这些残留文件。

## 备选：Linux 服务器本地构建

需要 Git、Node.js 24、npm、Bash、flock（通常来自 util-linux）、GNU coreutils，以及 Caddy。将仓库推送到你自己的 Git 托管服务，再在服务器 clone；本仓库没有预设远程地址。

由部署用户拥有检出的仓库和 `/srv/markdown-blog`，Caddy 用户需要有读取产物和遍历目录的权限。首次准备发布目录，例如：

```sh
sudo install -d -o "$(id -un)" -g "$(id -gn)" /srv/markdown-blog
```

在服务器的仓库目录内执行：

```sh
bash scripts/update.sh
```

脚本依次执行 `git pull --ff-only`、`npm ci`、`npm run build`，构建成功后把产物保存到 `/srv/markdown-blog/releases/`，原子切换 `current` 软链。失败不切换旧站；旧版本保留供回滚。工作树必须干净，脚本用锁防止同一发布目录并发更新。

首次从本地干净的已提交仓库试发布可用 `bash scripts/update.sh --no-pull`。用 `DEPLOY_ROOT=/绝对路径 bash scripts/update.sh` 更换发布目录。

将 `deploy/Caddyfile.example` 中的 `example.com` 替换为你的域名，合并进服务器 Caddy 配置并重载。域名须指向服务器。不要将源仓库目录作为 Web 根目录，Web 根目录应为 `/srv/markdown-blog/current`。

日常发布：本地提交并 push，服务器运行上述更新脚本。单独 `git pull` 不会自动构建。需要无人值守时，可在服务器用 systemd timer 定期运行更新脚本，或后续接入 Git webhook。

回滚（Linux，替换 RELEASE 为实际历史目录名；不要与更新同时运行）：

```sh
ln -s /srv/markdown-blog/releases/RELEASE /srv/markdown-blog/current.rollback
mv -Tf /srv/markdown-blog/current.rollback /srv/markdown-blog/current
```

脚本针对 Linux；macOS 用本地预览命令即可。历史 release 不自动删除，可在确认不用后手动清理。
