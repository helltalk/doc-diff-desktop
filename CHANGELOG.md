# 更新日志

本项目所有值得注意的变更都记录在此文件中。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [Unreleased]

## [1.1.0] - 2026-11-20

### Added

- 应用菜单与帮助信息全面中文化：工具栏「帮助」按钮，以及「帮助 → 使用说明 / 关于」菜单项。
- README 补充网页版单文件的下载入口、用法与限制说明。
- 新增本 CHANGELOG 与 [发版规范](docs/RELEASING.md)，建立可追溯的版本记录。

### Changed

- 导出清单的默认文件名改为按两份源文件生成；当两份文件仅版本号 / rev 不同时，只保留公共主体名（例如 `... rev 1.4` 与 `... rev 1.5` → `OTM 7000 K产品技术要求_差异清单.txt`）。
- 项目版本由 1.0.0 升至 1.1.0（新增功能且向后兼容，升 minor）。Release 附件改用带版本号的 ASCII 文件名，中文说明放 label。
- 「关于」弹窗的版本号改为读取 `package.json`，不再写死，避免升级后仍显示旧版本号。

### Fixed

- 修复「多次推送却没有版本记录、版本号始终不变」的问题：补建 Git tag 与独立的 v1.1.0 Release，不再以「删除旧附件 → 同名重新上传」的方式发版。

> **版本记录说明（事后补打）**：项目早期没有建立 tag / CHANGELOG 机制。`v1.0.0` 与 `v1.1.0` 两个 tag 均于 2026-11-20 事后补打：`v1.0.0` 指向 `c6d7100`（移除 LibreOffice 依赖、doc/xls 纯 JS 直读）；`v1.1.0` 指向包含本次版本升级的发布提交（在 `4ed229f`「中文菜单与帮助」的功能基础上，增加版本号、CHANGELOG 与发版规范），以保证 tag 对应的源码能构建出 1.1.0 产物。
>
> tag 类型例外：本次两个 tag 因本机 git 推送通道不可用（直连 reset、代理 `CONNECT tunnel failed, 502`），改由 GitHub Git refs API 创建，均为**轻量 tag**（功能与附注 tag 等价）；该例外已按 `docs/RELEASING.md` 登记。
>
> GitHub 上原有的 v1.0.0 Release（发布于 2026-11-20）此前曾被反复「删除旧附件 → 同名重新上传」，其附件实际内容已被覆盖为后续版本，**不能作为 v1.0.0 的真实产物依据**。该 Release 作为历史记录原样保留、不再改动；从 v1.1.0 起，每个版本使用独立 tag、独立 Release 与带版本号的附件名，版本记录干净可信。

## [1.0.0] - 2026-11-20

首个正式版（tag 为 2026-11-20 事后补打至 `c6d7100`；对应提交 `7a5ab39`、`632eadf`、`c6d7100`）。

### Added

- Electron 桌面版 + 零依赖单文件网页版：本地离线对比 docx / doc / xlsx / xls / pdf / txt / md 七类格式。
- 清单视图、并排视图、单元格差异视图，支持筛选、搜索、导出与打印。
- README 补充 Release 直接下载链接。

### Changed

- 移除 LibreOffice 依赖：`.doc` 由 `word-extractor` 纯 JS 直读，`.xls` 由 SheetJS 直读 OLE2 二进制，全格式开箱即用，不再弹出安装提示或转换进度条。

[Unreleased]: https://github.com/helltalk/doc-diff-desktop/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/helltalk/doc-diff-desktop/releases/tag/v1.1.0
[1.0.0]: https://github.com/helltalk/doc-diff-desktop/releases/tag/v1.0.0
