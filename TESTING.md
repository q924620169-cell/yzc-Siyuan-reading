# 验收记录

测试平台：Windows，思源 **3.8.10**。通过本机思源内核与 browser-desktop 前端自动验收，使用 SiYuan-Test 的完整数据副本及另建的干净测试空间。原 SiYuan-Test 和生产工作空间未部署或改写。macOS 实机、真实微信读书联机认证未在本次测试范围内。

- `npm run check`：212 项回归通过，含原三模块测试、迁移临时文件和完成记录损坏后的重试、旧目标选择、主页已删除回退、首发 ID 数据优先级和首次建库并发读取；类型检查和 ZIP 构建通过。
- `npm run test:browser`：原有文档树、拖动、窗口布局、字体及卸载回归通过。
- 独立安装：只安装 `yzc-INL`；文档、书房、RSS 三项入口及切换通过；新建藏书库、导入真实 EPUB / PDF、打开及返回书架通过。针对新建笔记本短暂返回的 `indexUnavailable`，限定重试相同文档路径。
- 带数据升级：原藏书数据库 ID 和五本旧书 ID 保留；EPUB、书签划线、课程内原生 PDF 及其 assets 地址通过。RSS 旧订阅、稍后看、历史和原导入记录接续。
- 外观升级：曾开启的三种彩色值失效，曾关闭的计数强制开启；菜单只保留两组风格与字体选择。
- RSS 导入：中文测试文章经真实文档接口创建，核验分类、作者与来源后完成；重复调用使用同一文档，并出现在文档未分类投影。
- 恢复：首次迁移途中关闭前端后重试完成；单元测试注入文件写入中断，确认目标文件优先、原文件保留、完成标记最后写入。
- 重启：重新启动测试内核，复核旧书 ID、RSS 导入关联、三项入口；卸载清理通过。

## 1.0.1 复核修复

- 真实内核故障注入：临时文件 API 返回成功后写坏其内容，迁移校验失败，正式目标未改变且无 v2 完成记录。重新打开前端后重试成功；v1 遗留坏 JSON 留在 `.bak`，已有有效藏书配置中的独立标记保留。旧 v1 完成记录不再跳过这次复核。
- 主页失效：在测试副本创建并删除主页，保留失效绑定，清空旧目标偏好；实际 RSS 导入落到首个已打开笔记本，确认未分类状态和重复导入复用。
- PDF 续读：用旧 INL 0.5.0 + Reader 1.1.0 建立基线，再停用旧 Reader/RSS 并更新 INL。真实旧单页 PDF 的页内位置为 `13501 → 13501`。另在旧 Reader 导入五页测试 PDF、保存第 3 页，升级后仍为第 3/5 页；校验资源地址、原生 PDF 指纹及书籍 ID。

复核脚本：`scripts/accept-review-fixes.mjs baseline|upgrade|restart`，默认只访问 `.local/review-fixes-workspace` 与本机端口 51486。`baseline` 需要旧插件；`upgrade` 会注入临时文件故障，正式目标中预置的坏 JSON 必须是可恢复测试数据。分阶段替换包和重启内核后运行下一阶段，禁止对日常工作空间运行。

证据：`validation/review-fixes-*.json`、`review-pdf-baseline.json`、`review-pdf-before.png`、`review-pdf-after.png`。本轮按用户要求保留三个旧远程仓库。

## 集市首发 ID 验收

- 保留远程品牌提交 `1cc9b61`，显示名「yzc阅读」及黑底白字 PNG 未替换。
- 新 ID `yzc-Siyuan-reading` 的有效数据优先；旧合并版 `yzc-INL` 随后；独立 Reader/RSS 只补缺。新目录独立的 `reading-id-migration-v1.json` 最后写入，旧目录中的完成记录不能代替它。
- 真实故障注入验证临时文件损坏后无完成标记，重新打开后正确恢复。旧合并版 RSS 来源字节未变化，有效新藏书配置及独立旧版缺失文件均保留。
- 升级后外观、字体、主页、导航顺序和旧 RSS 导入关联接续。真实旧 PDF 页内位置仍为 13501，五页测试书仍停在第 3/5 页。
- 全新安装只启用新 ID；EPUB、PDF、RSS 转入未分类和去重、Notion / Anthropic 菜单与字标检查通过。新实例读取当前宿主注册的模块，验收不持有失效的旧实例引用。
- 普通 PDF 的 `pdf1-` 指纹可生成默认封面；此前错误的调色索引已修复，并纳入原封面回归。
- 所有运行资源请求均使用新插件路径；实际安装图标与 `plugin/icon.png` 字节一致。浏览器布局、字体及卸载回归通过。
- 完整内核重启后，升级测试书恢复第 3/5 页，全新安装测试书恢复第 2/5 页；新装 RSS 已导入文档的关联仍在。两份副本均只启用新插件，捕获的运行异常为零。

现行脚本为 `scripts/accept-marketplace.mjs upgrade|verify-upgrade|clean|restart-upgrade|restart-clean`，可通过 `MARKETPLACE_WORKSPACE`、`MARKETPLACE_URL` 指向相应可恢复副本。升级故障注入须使用明确可丢弃的预置损坏数据。首发记录为 `validation/marketplace-*.json`，源码及安装包审查记录为 `validation/release-audit.json`。

公开仓库、正式 Release 与集市 PR 等待用户确认本次候选版本。社区审核合并后的集市安装尚未执行。

本地详细证据位于忽略上传的 `validation/`：`host-acceptance.json`、`clean-acceptance.json`、`restart-acceptance.json` 及截图。可复测脚本为 `scripts/accept-upgrade.mjs`、`scripts/accept-clean.mjs`、`scripts/accept-restart.mjs`；默认使用 `.local/` 下的测试副本与本机端口 51480/51481，干净测试可通过 `CLEAN_TEST_URL` 改端口。脚本只能用于可恢复测试数据，会导入测试书籍和文章。

第三方源码中的旧开发辅助文件采用 Git 排除方式保留本地副本；未执行被自动审批拦截的第三方目录删除操作。
