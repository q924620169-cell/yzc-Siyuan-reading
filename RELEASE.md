# yzc阅读 1.0.1 发布记录

显示名：**yzc阅读**。插件 ID：`yzc-Siyuan-reading`。最低思源版本：3.8.10。唯一发布附件：`package.zip`。

2026-11-17 经用户确认公开仓库并发布 [v1.0.1 正式 Release](https://github.com/q924620169-cell/yzc-Siyuan-reading/releases/tag/v1.0.1)，对应源码提交 `3f0d0a09d0ab540a3a4ab3c3c282ee5e3bb2605c`。

## Release 正文

文档、书房和 RSS 合并为一个思源阅读插件，使用黑底白字 yzc 字标。

- 文档区提供三栏导航、主页、资料库和未分类；保留导航排序及 Notion / Anthropic 风格、字体选择，笔记本计数常开。
- 书房支持 EPUB、文本、课程与思源原生 PDF；沿用藏书数据库、原件地址、书签划线及阅读位置。
- RSS 提供订阅、稍后看、阅读和中文文章转入未分类；重复导入复用同一篇文档。
- 旧版升级会接续旧合并版与独立 Reader/RSS 数据。迁移校验失败可重试，旧目录保留；主页被删除时仍可回退选择已打开笔记本。

升级前请备份工作空间并停用旧 `yzc-INL`、`yzc-Reader`、`yzc-RSS`。安装后只启用新「yzc阅读」。详细步骤见 README。Windows 思源 3.8.10 已验收；macOS 尚未实机验收。

## 集市 PR

标题：`Add plugin: yzc阅读`

已提交：[siyuan-note/bazaar#2541](https://github.com/siyuan-note/bazaar/pull/2541)，目标为官方 `main`，仅新增一个插件。

在根目录 `plugins.txt` 添加：

```text
q924620169-cell/yzc-Siyuan-reading
```

插件将文档导航、书房和 RSS 合并为一个入口，内部 ID 与仓库名一致。使用 MIT 许可证，并在安装包内保留运行依赖和字体授权。首次发行版本为 1.0.1，`package.zip` 根目录包含清单、入口、样式和图标。

## 发布状态

1. 当前项目仓库已公开，保留单一 `main`；三个旧仓库仍保留。
2. `v1.0.1` 是正式 Latest Release，唯一附件为 `package.zip`。重新下载验证与本地验收包一致，SHA-256 为 `a74abc206e8d410420621fff0188c74e6f721090a465ba9d311e801e29557f4c`。
3. 上架分支基于官方最新 `main`，PR 仅修改根目录 `plugins.txt`：增加一行、删除零行。
4. [官方 PR Check](https://github.com/siyuan-note/bazaar/actions/runs/44102373518) 已通过，PR 已获得 `ci-passed` 标记，等待社区维护者审核合并。集市安装尚未执行；合并后应搜索「yzc阅读」、核对字标并从集市安装验证。

官方依据：[插件规范与打包说明](https://github.com/siyuan-note/plugin-sample)、[集市提交说明](https://github.com/siyuan-note/bazaar/blob/main/README.zh-CN.md)。
