# 文档差异对比工具（桌面版）

> 当前版本 **1.1.0**。完整版本变更记录见 [CHANGELOG.md](CHANGELOG.md)；后续发版遵循 [发版规范](docs/RELEASING.md)。

本地离线的 Windows 桌面应用，对比 **docx / doc / xlsx / xls / pdf / txt / md** 七类文档，列出全部新增 / 删除 / 修改，支持筛选、搜索、三种视图、导出与打印。**文件不上传、无需联网、全格式开箱即用——不需要安装 LibreOffice 或任何外部软件。**

> 本项目同时收录了前身——零依赖单文件网页版工具，位于 [`web-version/`](web-version/) 目录（双击 `文档差异对比工具.html` 即可离线使用，支持 docx/txt/md），也可直接下载 [网页版单文件 HTML](https://github.com/helltalk/doc-diff-desktop/releases/download/v1.1.0/doc-diff-tool-web.html)。桌面版在它基础上扩展了格式与原生系统对话框。
>
> 安装包（130MB exe / 169MB zip）因超过 GitHub 单文件 100MB 限制，作为 **Releases 附件** 发布，不在仓库内。请到本仓库 [Releases 页面](https://github.com/helltalk/doc-diff-desktop/releases) 下载，或直接下载：
> - [安装版 exe（约 130MB）](https://github.com/helltalk/doc-diff-desktop/releases/download/v1.1.0/doc-diff-desktop-installer-1.1.0-x64.exe)
> - [免安装版 zip（约 169MB）](https://github.com/helltalk/doc-diff-desktop/releases/download/v1.1.0/doc-diff-desktop-portable-1.1.0-x64.zip)
> - [网页版 HTML（约 51KB）](https://github.com/helltalk/doc-diff-desktop/releases/download/v1.1.0/doc-diff-tool-web.html)
>
> 仓库内源码可用 `npm run dist:win` 自行构建。本地构建产物名为中文（如 `文档差异对比工具-安装版-1.1.0-x64.exe`），Release 附件统一使用 ASCII 文件名；从 Releases 下载时请认准上文列出的 ASCII 名。

> ⚠️ **首次安装请注意（本版未做代码签名）**
> Windows 安装 `.exe` 时可能弹出蓝色提示「Windows 已保护你的电脑 / 未知发布者」。
> 请点击 **「更多信息」** → **「仍要运行」** 即可继续安装。这是未购买代码签名证书导致的正常提示，不代表文件有病毒。若企业策略拦截，可将安装包加入白名单，或改用免安装版 zip。

## 一、安装与运行

### 方式 A：安装版（推荐）

1. 从 Releases 下载 `doc-diff-desktop-installer-1.1.0-x64.exe`（即安装版 exe）；
2. 双击运行，遇到 SmartScreen 提示时按上文选择「更多信息」→「仍要运行」；
3. 可按向导选择安装目录，默认创建桌面快捷方式；
4. 从开始菜单 / 桌面快捷方式启动。

### 方式 B：免安装版（绿色版）

1. 从 Releases 下载并解压 `doc-diff-desktop-portable-1.1.0-x64.zip`（即免安装版 zip）；
2. 进入解压目录，双击 `文档差异对比工具.exe`；
3. 无需管理员权限，可直接放在 U 盘或使用网络盘运行；卸载只需删除整个目录。

> 两张桌面版方式功能完全一致。免安装版同样可能触发 SmartScreen / Defender 提示，处理方式相同。

### 方式 C：网页版（单文件 HTML，免安装）

1. 从仓库 [`web-version/`](web-version/) 或 [Release 附件](https://github.com/helltalk/doc-diff-desktop/releases/download/v1.1.0/doc-diff-tool-web.html) 下载 `文档差异对比工具.html`（约 51KB）；
2. 用 Edge / Chrome 等浏览器**从本地文件直接打开**，无需安装、无需联网、不上传文件；
3. 分别选择原文档和新文档，点击「开始对比」，再筛选、复制或导出清单。

**网页版限制：**

- 仅支持 `.docx` / `.txt` / `.md`，不支持 `.doc`、`.xls`、`.xlsx`、`.pdf`；
- 没有原生文件对话框，网络映射盘请先在资源管理器映射为本地驱动器，并用外部浏览器打开；
- 「导出时选路径」依赖浏览器的 File System Access API，Chrome / Edge 在安全上下文下可用；若浏览器不支持或从 `file://` 打开时被限制，会自动降级为浏览器默认下载目录；
- 不支持 Excel 单元格视图、公式优先级比较、扫描件 OCR，超大文件受浏览器内存限制。

## 二、零外部依赖，全格式开箱即用

桌面版内置全部解析器，**不再需要、也不再检测 LibreOffice**，不再弹出安装提示或显示转换进度条：

- `.doc`（老式 OLE2 二进制）由主进程 `word-extractor` 纯 JS 直提正文（中文、Tab、换行原样保留）；
- `.xls` 与 `.xlsx` 一样由主进程 SheetJS 直接读取二进制，逐单元格取值 / 公式 / 类型，不需要先转成 `.xlsx`；
- `.docx` / `.txt` / `.md` / `.pdf` 依旧在渲染进程或主进程内解析，全程不产生临时文件、不修改原始文件。

> 因此无需再为 `.doc` / `.xls` 安装约 700MB 的 LibreOffice。若你只装过旧版、看到过 LibreOffice 缺失横幅，请升级到本版后重新对比。

## 三、支持格式矩阵

| 格式 | 解析方式 | 外部依赖 | 差异粒度 |
|---|---|---|---|
| `.docx` | 渲染进程内联 ZIP 中央目录解析 `word/document.xml` + DOMParser | 无 | 段落 / 文本行，字符级高亮 |
| `.doc` | 主进程 `word-extractor` 直提 OLE2 正文，按 `\r\n\|\r\|\n` 拆行 | 无 | 段落 / 文本行，字符级高亮 |
| `.txt` / `.md` / `.csv` / `.log` 等 | 渲染进程 `TextDecoder`，自动识别 UTF-8 BOM / UTF-16 / GBK | 无 | 文本行，字符级高亮 |
| `.xlsx` | 主进程 SheetJS，逐单元格取值、公式、类型 | 无 | **单元格**，区分值 / 公式 / 类型变更 |
| `.xls` | 主进程 SheetJS 直读 OLE2 二进制（与 `.xlsx` 同一解析器） | 无 | **单元格**，区分值 / 公式 / 类型变更 |
| `.pdf` | 主进程 pdfjs-dist 提取文本层，按坐标聚合为行 | 无（扫描件需先 OCR） | 文本行，字符级高亮 |

**格式组合规则**

- 两侧均为 Excel（`.xlsx`/`.xls`）→ 默认打开「单元格差异」视图，可 Tab 切回通用清单；
- 任一侧非 Excel（如 docx vs pdf、docx vs xlsx）→ 统一归一为「Sheet名 / A1: 值」文本行走通用对比，隐藏「单元格差异」Tab；
- 扫描版 PDF 无文本层时显示中文提示横幅，不崩溃，可改用 OCR 后的文档。

## 四、使用说明

1. **选文件**：点击左 / 右卡片自带的原生文件对话框选择，或直接把两个文件拖到对应区域（网络映射盘拖拽也能取到真实路径）。
2. **开始对比**：点击工具栏「开始对比」。解析期间显示状态提示，无转换步骤、无进度条；
3. **切换视图**：
   - **清单视图**：逐条列出新增 / 删除 / 修改，修改项用 `<ins>`/`<del>` 做字符级高亮；
   - **并排视图**：左右两栏按行对齐，可勾选「同步滚动」按行号联动；
   - **单元格差异**（仅两侧均为 Excel 时出现）：表格列出 Sheet / 坐标 / 旧值 / 新值 / 类型 / 变化，差异行高亮，表头固定。
4. **筛选与搜索**：用「全部 / 仅新增 / 仅删除 / 仅修改」按钮和搜索框缩小结果范围，三个视图与导出内容同步。
5. **导出**：「导出 HTML / TXT / CSV」调用系统保存对话框选择路径，默认文件名按两份源文件生成：仅版本号/rev 不同时只保留主体名（如 `OTM 7000 K产品技术要求 rev 1.4` 与 `... rev 1.5` → `OTM 7000 K产品技术要求_差异清单.txt`），其它情况用 `旧报表_vs_新报表_差异清单.csv`；TXT / CSV 为 UTF-8 BOM 编码（Excel 双击不乱码），HTML 为 UTF-8。取消保存会静默返回。
6. **帮助**：工具栏「帮助」按钮，或应用菜单「帮助 → 使用说明 / 关于」，可随时查看用法与限制。应用菜单已全部改为中文。
7. **复制 / 打印**：「复制全部」复制当前筛选结果；「打印」调用系统打印，自动隐藏工具栏等界面元素。

## 五、验收清单

已验证 / 建议复验的关键场景：

- [x] 中文文件名与中文目录：`tests/fixtures/中文 路径 测试/修改版 sample.docx`、`修改版 sample.xlsx` 可正常读取并出差异；
- [x] 路径含空格：`修改版 sample.docx`、`旧格式 示例.doc` 正常处理；
- [x] 两份 docx（中文/空格路径）→ 文本差异清单，识别修改 + 新增段落；
- [x] 两份 xlsx → 单元格差异表，覆盖值变更 / 公式变更 / 类型变更 / 新增单元格；
- [x] 导出链路：原生保存对话框 → 写入 UTF-8 BOM 文件；
- [x] 扫描 PDF 无文本层 → 中文提示横幅，不崩溃；
- [x] 真实 `.doc`（中文/空格路径，word-extractor 直读）→ 文本差异清单，中文 / Tab / 换行均正确；
- [x] 真实 `.xls`（SheetJS 直读，无 LibreOffice 转换）→ 单元格差异表；
- [x] 混合格式（docx vs xlsx）→ 强制通用清单，隐藏单元格 Tab；
- [ ] UNC 长路径（`\\server\share\中文 目录\文档.docx`）：需在有网络映射盘的环境手工复验。程序全程原样传递 UNC 路径，不做 `path.resolve`，不会破坏 `\\` 前缀；

## 六、开发

```bash
# 安装依赖（Windows 下建议用 bash 执行 npm，PowerShell 可能拦截 npm.ps1）
bash -c 'npm install'

# 启动开发窗口（自动构建 preload 与 shared bundle）
npm start

# 全部单元测试（含单元格差异引擎）
node --test tests/*.test.js

# 生成端到端夹具 + 无界面验收
node scripts/make-e2e-fixtures.js
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/e2e-app.js

# 打包 Windows 安装包 + 免安装 zip
npm run dist:win

# 国内网络环境下若 electron-builder 下载 NSIS 超时，可指定镜像
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ npm run dist:win
```

配置中 `electronDist: node_modules/electron/dist` 让打包复用已安装的 Electron 运行时，避免再次从 GitHub 下载；NSIS / 7zip / 图标等工具集首次构建需联网下载到 `%LOCALAPPDATA%\electron-builder\Cache`，之后可离线构建。

> 发版（版本升级 → 打 tag → 新建 Release → 上传附件 → 更新 CHANGELOG / 下载链接）请严格按 [docs/RELEASING.md](docs/RELEASING.md) 执行：**每个版本一个独立 Release，绝不覆盖旧 Release 或同名附件**。

> 注：部分终端预先设置了 `ELECTRON_RUN_AS_NODE=1`，会让 Electron 退化成纯 Node；运行 `scripts/e2e-app.js` 或 `scripts/smoke.js` 时需用 `env -u ELECTRON_RUN_AS_NODE` 清除该变量。

### 目录结构

```
src/
  main/          主进程：生命周期、IPC、对话框、doc/xlsx/xls/pdf 解析（doc 用 word-extractor，Excel 用 SheetJS）、导出
  preload/       contextBridge 白名单桥接层（构建产物 preload.bundle.js）
  renderer/      界面：index.html / style.css / app.js / shared.bundle.js
  shared/        跨进程共享：constants / diff-core / doc-parsers / cell-diff
tests/           node:test 单元测试与 fixtures
scripts/         构建、夹具生成、无界面验收脚本
web-version/     前身网页版单文件工具 + 其 QA 测试脚本（零依赖，双击即用）
```

### 安全设计

- `contextIsolation: true`、`sandbox: true`、`webSecurity: true`、`nodeIntegration: false`
- 仅加载本地 `index.html`，不加载任何远程内容
- 渲染进程只能调用 `window.electronAPI` 白名单方法；共享纯函数由 esbuild 打成 IIFE 注入 `window.diffCore` / `window.docParsers` / `window.cellDiff`
- 外部链接仅允许 `https://`，且交给系统浏览器打开

### IPC 接口

所有 invoke 返回 `{ ok:true, data:T }` 或 `{ ok:false, code:'E_XXX', message:'中文错误', detail?:string }`。

| API | 入参 | 返回 data |
|---|---|---|
| `selectFile` | `{filters?}` | `FileMeta\|null` |
| `saveFile` | `{suggestedName,filters?}` | `string\|null` |
| `readBuffer` | `{path}` | `Uint8Array` |
| `convert` | `{inputPath,targetFormat,jobId}` | `{outputPath}`（历史通道，新版渲染层不再调用） |
| `parseXlsx` | `{path,meta?}` | `SheetDocument`（xlsx / xls 通用） |
| `parseDoc` | `{path,meta?}` | `TextDocument`（word-extractor 直读老式 doc） |
| `parsePdf` | `{path,meta?}` | `TextDocument` |
| `checkLibreOffice` | 无 | `{installed,path?,version?}`（历史通道，仅保留兼容，不再使用） |
| `writeExport` | `{path,content,encoding}` | `null` |
| `openExternal` | `{url}` | `null` |
| `getPathForFile` | `File` 对象 | `string`（真实本地路径） |
| `onConvertProgress` | 回调 | 取消订阅函数 |

### 数据结构

```js
FileMeta      = { path, name, size, ext }
TextDocument  = { kind:'text', meta, lines:string[] }
SheetDocument = { kind:'sheet', meta, sheets:[{name,rows:Cell[][],rowCount,colCount}] }
Cell          = { ref:'A1', row:1, col:1, value, type:'s'|'n'|'b'|'d'|'formula', formula? }
TextDiffEntry = { type:'added'|'removed'|'modified', oldLine,newLine,oldText,newText }
CellDiffEntry = { type, sheet, ref, row, col, oldValue,newValue,oldType,newType,
                  oldFormula,newFormula, changeKind:'value'|'formula'|'type'|'added'|'removed' }
```
