# 发版规范

目标：**一个版本 = 一个 Git tag + 一个 GitHub Release + 一组带版本号的附件**，任何一次发布都可追溯、可复现。

> 反面案例（本项目 v1.0.0）：反复「删除旧附件 → 用同一个名字重新上传」，结果所有版本的产物都堆在一个 Release 里，附件内容被覆盖成最新代码，本地也没有 tag，`package.json` 版本号长期不变——用户看到「推送了好几次，但没有版本记录」。**严禁再次这样发版。**

## 1. 升级版本号

1. 按语义化版本决定新版本号：新增向后兼容功能升 **MINOR**，仅修复缺陷升 **PATCH**，不兼容变更升 **MAJOR**。
2. 改 `package.json` 的 `version`，并同步 `package-lock.json`：
   ```bash
   npm version <新版本号> --no-git-tag-version   # 例如 npm version 1.2.0 --no-git-tag-version
   ```
   tag 由第 3 步手动打，这里必须加 `--no-git-tag-version`。
3. 不要写死版本号：`electron-builder.yml` 的 `artifactName` 和 `scripts/rename-artifacts.js` 都从 `package.json` 读取版本；`src/shared/help-text.js` 的「关于」文案同样读取 `package.json`。新增文案时继续沿用这种方式。
4. 更新 `CHANGELOG.md`（新版本条目 + 日期）和 `README.md` 的下载链接、产物文件名。

## 2. 验证与打包

```bash
npm run build && npm test    # 必须通过
npm run dist:win             # 产出带新版本号的 exe / zip
```

确认 `dist/` 下存在且文件名为：

- `文档差异对比工具-安装版-<版本>-x64.exe`
- `文档差异对比工具-免安装版-<版本>-x64.zip`

若文件名仍是旧版本号，说明 `package.json` 没改到或构建脚本读错了版本，先修好再继续。

## 3. 提交并打 tag

```bash
git add -A
git commit -m "chore(release): v<版本>"
env -u https_proxy -u HTTPS_PROXY -u http_proxy -u HTTP_PROXY \
  git -c http.version=HTTP/1.1 -c http.sslBackend=openssl push origin main

git tag -a v<版本> -m "v<版本>"
env -u https_proxy -u HTTPS_PROXY -u http_proxy -u HTTP_PROXY \
  git -c http.version=HTTP/1.1 -c http.sslBackend=openssl push origin v<版本>
```

本机直连 Git 推送容易 SSL 失败，统一使用上面的无代理 + HTTP/1.1 + openssl 方式。tag 必须推送到 origin，否则 Release 无法关联到可追溯的源码提交。

## 4. 新建 GitHub Release（关键：绝不覆盖旧 Release）

1. 用 GitHub API 或网页**新建** Release，`tag_name` 为 `v<版本>`，标题形如 `文档差异对比工具 v1.1.0`，正文放 Release Notes（直接摘取 CHANGELOG 该版本条目）。
2. **不要删除、不要编辑、不要复用旧 Release；绝对不要「删除旧附件 → 同名重新上传」**。同一附件名在不同版本间漂移会让历史版本无法复现。
3. 附件名用 **ASCII 且带版本号**（中文文件名可能被代理吞掉），中文说明放 `label`（需 `encodeURIComponent` 编码）：

   | 本地产物 | Release 附件 `name` | `label` |
   |---|---|---|
   | `文档差异对比工具-安装版-<版本>-x64.exe` | `doc-diff-desktop-installer-<版本>-x64.exe` | 安装版（Windows x64） |
   | `文档差异对比工具-免安装版-<版本>-x64.zip` | `doc-diff-desktop-portable-<版本>-x64.zip` | 免安装版（Windows x64） |
   | `web-version/文档差异对比工具.html` | `doc-diff-tool-web.html` | 网页版单文件 HTML |

4. 附件上传到 `uploads.github.com`（不是 `api.github.com`）：

   ```bash
   curl -sS -X POST \
     -H "Authorization: Bearer $token" \
     -H 'Content-Type: application/octet-stream' \
     --data-binary "@<本地文件>" \
     "https://uploads.github.com/repos/helltalk/doc-diff-desktop/releases/<release_id>/assets?name=<ascii_name>&label=<encoded_label>"
   ```

   token 取自 `git credential fill`。删除附件（仅在确需修正当前版本时）用 `DELETE /releases/assets/{asset_id}`。

## 5. 收尾检查

- [ ] 用 `sha256sum` 计算三个附件 SHA256，写进 Release Notes 或 CHANGELOG。
- [ ] README 的下载链接指向新 Release，且能实际下载。
- [ ] `git tag -l` 能看到新 tag，`git ls-remote --tags origin` 能看到远端 tag。
- [ ] 旧 Release 与旧附件保持原样，没有被改动。

以上任何一步失败，都不要发布公告；修好后重新走完整流程。
