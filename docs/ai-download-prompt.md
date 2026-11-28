# Picket Code 自动下载安装 · AI 提示词

复制下方【任务】全文发给任意 AI 助手（豆包、Claude、Codex 等），AI 将自动完成下载、校验与安装：

---

【任务】请自动下载并安装 Picket Code v1.143.1（当前最新发行版）。

1. 从镜像站下载对应平台的发行包。文件名带版本号，把下面的 `v1.143.1` 换成你要安装的版本即可，其余部分照抄：
   - Windows (x64): https://download.noware.cn/picket-code-v1.143.1-win32-x64.zip
   - Linux (x64): https://download.noware.cn/picket-code-v1.143.1-linux-x64.tar.gz
   - 校验和: https://download.noware.cn/picket-code-v1.143.1-SHA256SUMS
   同一版本的同名资产也在 GitHub Releases 上（镜像只保留最近 3 个版本，更早的版本不承诺长期可下载）：
   https://github.com/dantesun/picket-code/releases
   注意：旧的无版本 URL（/picket-code-win32-x64.zip、/SHA256SUMS）已废弃，不提供兼容，请求返回 404，不要使用。
2. 校验 SHA256（文件名含版本，URL 永久有效且可缓存，但校验值必须与该版本 SHA256SUMS 比对）：
   - Linux/macOS:
     curl -fSL https://download.noware.cn/picket-code-v1.143.1-SHA256SUMS -o SHA256SUMS
     sha256sum -c --ignore-missing SHA256SUMS
   - Windows PowerShell: Get-FileHash .\picket-code-v1.143.1-win32-x64.zip -Algorithm SHA256，再与该版本 SHA256SUMS 里同名的行比对
3. 若镜像站不可达，改用自动脚本（脚本自动解析最新 release，并从 GitHub Releases 下载 + 校验）：
   - Windows PowerShell: https://raw.githubusercontent.com/dantesun/picket-code/main/build/download-verify.ps1
   - Windows cmd: https://raw.githubusercontent.com/dantesun/picket-code/main/build/download-verify.bat
   - Linux/macOS: https://raw.githubusercontent.com/dantesun/picket-code/main/build/download-verify.sh
4. 运行脚本（可选；不带版本参数时取最新 release，要指定版本就传参：Windows -Tag v1.143.1，Linux/macOS 第一个参数 v1.143.1）：
   - Windows: powershell -ExecutionPolicy Bypass -File download-verify.ps1
   - Linux/macOS: bash download-verify.sh
5. 校验通过后，解压下载到的 zip / tar.gz（归档内只有一个顶层目录，名字不带版本：picket-code-win32-x64/ 或 picket-code-linux-x64/），放置到合适目录（如 ~/picket-code）。
6. 启动：Windows 运行 code.exe；Linux 运行 ./picket-code。
7. 完成后报告：发行包 SHA256、校验结果、安装路径。
