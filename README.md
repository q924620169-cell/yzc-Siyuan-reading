# yzc阅读

一个思源插件，提供文档导航、书房和 RSS。内部 ID 为 `yzc-Siyuan-reading`，与仓库名一致；视觉风格与字体均支持 Notion / Anthropic，笔记本计数常开。

## 构建与安装

环境：Node.js 22+、npm 10+；思源 3.8.10+。实际验收为 Windows、思源 3.8.10 的本机内核和 browser-desktop 前端；macOS 尚未实机验收。

```sh
npm ci
npm run check
npm run test:browser
```

唯一安装包为 `dist/package.zip`，根目录包含 `plugin.json`、`index.js`、`index.css` 和用户提供的黑底白字 `icon.png`。手动安装时，停用旧插件，将包内文件解压到工作空间 `data/plugins/yzc-Siyuan-reading/`，启用「yzc阅读」。干净安装只需这一项插件。

## 升级与数据

先备份工作空间，停用旧合并版 `yzc-INL` 和独立版 `yzc-Reader`、`yzc-RSS`，再安装新 ID 的插件。首次启动在模块读取前，按下列顺序接续数据：

1. 新 `data/storage/petal/yzc-Siyuan-reading/` 下已有的有效数据优先。
2. 从旧合并版 `data/storage/petal/yzc-INL/` 读取外观、字体、窗口、导航、主页及 `reader/`、`rss/` 数据。
3. 对应数据缺失或旧合并版 JSON 不可解析时，再从 `yzc-Reader/`、`yzc-RSS/` 补齐。

迁移先写临时文件并校验 SHA-256，再通过不覆盖已有目标的重命名放入正式位置；全部成功才在新 ID 下写 `reading-id-migration-v1.json`，旧完成记录不会跳过这轮迁移。中断后可重新启用重试。新目录中不可解析的 JSON 会保留为同目录 `.inl-invalid-….bak` 副本，再从有效来源恢复；旧目录始终作为只读来源保留。书籍、课程和 PDF 原件继续使用原 assets 地址，数据库及书籍 ID 不变。微信读书关联和连接凭据只留在用户工作空间。

RSS「转入未分类」沿用中文正文、题头图及来源。优先使用可用旧目标，否则使用主页所在已打开笔记本；主页已删除或所属笔记本已关闭时，回退至首个已打开笔记本。连接、权限和索引故障会明确报错。文档创建并核验 `custom-inl-status=inbox` 后才完成导入；重试复用记录及文档，旧已完成导入不改位置和分类。无可用笔记本时提示打开笔记本后重试。

外观菜单仅含视觉风格和字体；旧彩色标题、文档树、页签值失效，旧关闭计数的设置失效。

## 代码与授权

`plugin/` 是文档与导航底座，`modules/reader/`、`modules/rss/` 保留各自数据模型和阅读器，`shared/` 负责单一宿主和模块迁移。`SOURCE-BASELINES.json` 记录三份 main SHA 和保留的未提交源码文件指纹。

项目 MIT；Foliate、PDF.js、字体及其他运行依赖的许可证随包保留在 `licenses/`。不提交工作空间、密钥、原始书籍或旧安装包。
