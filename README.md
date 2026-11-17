# yzc阅读

一个思源插件，提供文档导航、书房和 RSS。内部 ID 保留 `yzc-INL`，视觉风格与字体均支持 Notion / Anthropic，笔记本计数常开。

## 构建与安装

环境：Node.js 22+、npm 10+；思源桌面端 3.8.6+。Windows 为本次验收平台，macOS 尚未实机验收。

```sh
npm ci
npm run check
npm run test:browser
```

唯一安装包为 `dist/package.zip`。退出或停用旧插件，将包内文件解压到测试工作空间 `data/plugins/yzc-INL/`，重新启用「yzc阅读」。干净安装只需启用此插件。不要同时启用旧 Reader / RSS。

## 升级与数据

先备份工作空间，停用 `yzc-Reader`、`yzc-RSS`，再更新 INL。现有 INL 设置和文档分类原位沿用。首次启动在模块读取前，将旧 `data/storage/petal/yzc-Reader/` 和 `yzc-RSS/` 中缺失的状态文件复制到 `data/storage/petal/yzc-INL/reader/` 和 `rss/`，逐文件校验后才记录迁移完成。中断后可重新启用重试，已有目标文件优先，旧目录保留。书籍、课程和 PDF 原件继续使用原 assets 地址，数据库及书籍 ID 不变。微信读书关联和凭据只留在用户工作空间。

RSS「转入未分类」沿用中文正文、题头图及来源。优先使用可用旧目标，否则使用主页所在已打开笔记本，再回退至首个已打开笔记本。文档创建并核验 `custom-inl-status=inbox` 后才完成导入；重试复用记录及文档，旧已完成导入不改位置和分类。无可用笔记本时提示打开笔记本后重试。

外观菜单仅含视觉风格和字体；旧彩色标题、文档树、页签值失效，旧关闭计数的设置失效。

## 代码与授权

`plugin/` 是文档与导航底座，`modules/reader/`、`modules/rss/` 保留各自数据模型和阅读器，`shared/` 负责单一宿主和模块迁移。`SOURCE-BASELINES.json` 记录三份 main SHA 和保留的未提交源码文件指纹。

项目 MIT；Foliate、PDF.js、字体及其他运行依赖的许可证随包保留在 `licenses/`。不提交工作空间、密钥、原始书籍或旧安装包。
