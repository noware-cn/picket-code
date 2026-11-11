#!/usr/bin/env bash
# 在 WSL 发行版里预置 Remote-WSL 需要的 CLI 与 VS Code Server，绕开扩展自带的下载。
#
# 为什么需要：发行版 product.json 的 updateUrl 为 null 时，扩展里的下载器（extension.js 的
# EP/LU）返回空实现，起不了 server。而扩展的两个探针都只看目录是否存在，所以把产物提前
# 放好即可跳过下载：
#   $HOME/$FOLDER/bin-cli/$COMMIT      extension.js: _probeInstallInWSL（要求 code-cli 可执行）
#   $HOME/$FOLDER/bin/$COMMIT          wslDaemon.js 的 server 探针
#
# 本脚本要在**目标发行版内部**执行（不是 Windows 侧）。
#
# 许可警示：脚本取用的是微软受许可约束的产物（Remote-WSL 的 CLI 与 server），仅限个人在
# 自己的开发机上自用。扩展许可 §1.a 要求"与合法授权的 Microsoft Visual Studio Code 副本
# 一起使用"，§6 禁止 work around technical limitations，§7 禁止 host/share/publish。
# 因此不要把产物放进仓库、Release 或任何公共下载点，也不要把本脚本接进 CI / release
# workflow。场景对照与合规路线见 docs/manual-remote-wsl.md 第九节。
#
# 用法:
#   bash manual-wsl-server.sh --commit <40位 sha> [选项]
#   bash manual-wsl-server.sh --product-json <product.json 路径> [选项]
#
# 选项:
#   --commit <sha>         上游 commit，40 位小写十六进制
#   --product-json <路径>  从 Windows 安装的 resources/app/product.json 读 commit /
#                          serverDataFolderName / quality（可直接给 /mnt/d/... 路径）
#   --folder <名>          发行版内数据目录，默认 .picket-code-server
#   --arch <平台>          linux-x64（默认按 uname 推断）| linux-arm64 | linux-alpine | alpine-arm64
#   --quality <质量>       stable（默认）| insider
#   --cli-tar <文件>       离线：本地 CLI 归档，不联网
#   --server-tar <文件>    离线：本地 Server 归档，不联网
#   --force                已存在也重装
#   --dry-run              只打印将要做什么
#
# 完整流程见 docs/manual-remote-wsl.md。
set -euo pipefail

COMMIT=""
PRODUCT_JSON=""
FOLDER=""
ARCH=""
QUALITY=""
CLI_TAR=""
SERVER_TAR=""
FORCE=0
DRY=0

die() { echo "错误: $*" >&2; exit 1; }
info() { echo "==> $*"; }
warn() { echo "警告: $*" >&2; }

usage() {
  # 打印文件头的注释块（跳过 shebang，到第一个非注释行为止）
  awk 'NR > 1 { if (/^#/) { sub(/^# ?/, ""); print } else { exit } }' "$0"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --commit)       COMMIT="${2:-}"; shift 2 ;;
    --product-json) PRODUCT_JSON="${2:-}"; shift 2 ;;
    --folder)       FOLDER="${2:-}"; shift 2 ;;
    --arch)         ARCH="${2:-}"; shift 2 ;;
    --quality)      QUALITY="${2:-}"; shift 2 ;;
    --cli-tar)      CLI_TAR="${2:-}"; shift 2 ;;
    --server-tar)   SERVER_TAR="${2:-}"; shift 2 ;;
    --force)        FORCE=1; shift ;;
    --dry-run)      DRY=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              die "未知参数: $1（--help 查看用法）" ;;
  esac
done

# ---- 参数解析 ----

if [ -n "$PRODUCT_JSON" ]; then
  [ -f "$PRODUCT_JSON" ] || die "找不到 product.json: $PRODUCT_JSON"
  json_field() {
    grep -o "\"$1\": *\"[^\"]*\"" "$PRODUCT_JSON" | head -1 | sed 's/.*: *"//; s/"$//'
  }
  [ -n "$COMMIT" ] || COMMIT="$(json_field commit || true)"
  [ -n "$FOLDER" ] || FOLDER="$(json_field serverDataFolderName || true)"
  [ -n "$QUALITY" ] || QUALITY="$(json_field quality || true)"
fi

[ -n "$COMMIT" ] || die "缺少 --commit（或 --product-json）"
printf '%s' "$COMMIT" | grep -Eq '^[0-9a-f]{40}$' \
  || die "commit 必须是 40 位小写十六进制: $COMMIT"

FOLDER="${FOLDER:-.picket-code-server}"
# 必须与 build/product.json 的 serverApplicationName 一致：wslServer.sh 用
# "$VSCODE_REMOTE_BIN/$COMMIT/bin/$SERVER_APPNAME" 启动服务。
SERVER_APPNAME="${SERVER_APPNAME:-picket-code-server}"
QUALITY="${QUALITY:-stable}"
case "$QUALITY" in
  stable|insider) ;;
  *) die "quality 只能是 stable 或 insider（扩展的 SU() 只认这两个）: $QUALITY" ;;
esac

if [ -z "$ARCH" ]; then
  case "$(uname -m)" in
    x86_64)        if [ -f /etc/alpine-release ]; then ARCH=linux-alpine; else ARCH=linux-x64; fi ;;
    aarch64|arm64) if [ -f /etc/alpine-release ]; then ARCH=alpine-arm64; else ARCH=linux-arm64; fi ;;
    *) die "不支持的架构: $(uname -m)，请用 --arch 显式指定" ;;
  esac
fi

# CLI 与 Server 的平台名并不一一对应：Alpine x64 没有 CLI 产物（cli-linux-alpine 404）。
case "$ARCH" in
  linux-x64)    CLI_PLATFORM=cli-linux-x64 ;;
  linux-arm64)  CLI_PLATFORM=cli-linux-arm64 ;;
  alpine-arm64) CLI_PLATFORM=cli-alpine-arm64 ;;
  linux-alpine) die "Alpine x64 没有 CLI 产物（cli-linux-alpine 返回 404），无法走 bin-cli 路径" ;;
  *) die "未知 --arch: $ARCH（可选 linux-x64 / linux-arm64 / linux-alpine / alpine-arm64）" ;;
esac
SERVER_PLATFORM="server-$ARCH"

if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
  die "不要用 sudo 运行：产物会装到 /root 下，扩展找不到"
fi

case "$(uname -r)" in
  *[Mm]icrosoft*|*WSL*) ;;
  *) warn "当前内核不像 WSL（$(uname -r)），脚本会照常执行，但只对 WSL 发行版有意义" ;;
esac

DEST_CLI="$HOME/$FOLDER/bin-cli/$COMMIT"
DEST_SERVER="$HOME/$FOLDER/bin/$COMMIT"
BASE_URL="https://update.code.visualstudio.com/commit:$COMMIT"

info "commit  = $COMMIT"
info "folder  = $FOLDER"
info "arch    = $ARCH"
info "quality = $QUALITY"
info "CLI     = $BASE_URL/$CLI_PLATFORM/$QUALITY -> $DEST_CLI/code-cli"
info "Server  = $BASE_URL/$SERVER_PLATFORM/$QUALITY -> $DEST_SERVER"

if [ "$DRY" -eq 1 ]; then
  echo "--dry-run: 不下载、不落盘"
  exit 0
fi

# ---- 工具 ----

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# 更新服务器在 302 响应头里给出 x-sha256，用它作预期值，不写死哈希。
expected_sha() {
  curl -fsSIL --max-time 30 "$1" 2>/dev/null \
    | tr -d '\r' | sed -n 's/^[Xx]-[Ss][Hh][Aa]256: *//p' | head -1
}

verify_sha() {
  local file="$1" expected="$2" label="$3"
  if [ -z "$expected" ]; then
    warn "$label 取不到预期的 sha256，跳过校验（实际: $(sha256_of "$file")）"
    return 0
  fi
  local actual
  actual="$(sha256_of "$file")"
  [ "$actual" = "$expected" ] || die "$label 校验失败: 实际 $actual / 预期 $expected"
  echo "    sha256 校验通过: $actual"
}

fetch() {
  local url="$1" path="$2" n=0 resume=1 rc
  while :; do
    if [ "$resume" -eq 1 ] && [ -s "$path" ]; then
      curl -fL -C - --retry 3 --retry-delay 2 --progress-bar -o "$path" "$url" 2>/dev/null
    else
      rm -f "$path"
      curl -fL --retry 3 --retry-delay 2 --progress-bar -o "$path" "$url" 2>/dev/null
    fi
    rc=$?
    if [ $rc -eq 0 ] && [ -s "$path" ]; then
      return 0
    fi
    if [ $rc -eq 33 ]; then
      echo "  服务器不支持续传，改为全量下载" >&2
      resume=0
      continue
    fi
    n=$((n + 1))
    [ "$n" -ge 5 ] && return 1
    echo "  下载中断（rc=$rc），2 秒后续传（$n/5，已有 $(du -h "$path" 2>/dev/null | cut -f1)）..." >&2
    sleep 2
  done
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- CLI ----

if [ -x "$DEST_CLI/code-cli" ] && [ "$FORCE" -eq 0 ]; then
  info "CLI 已存在，跳过: $DEST_CLI/code-cli（--force 重装）"
else
  if [ -n "$CLI_TAR" ]; then
    [ -f "$CLI_TAR" ] || die "找不到 CLI 归档: $CLI_TAR"
    CLI_FILE="$CLI_TAR"
    info "使用本地 CLI 归档: $CLI_TAR"
  else
    CLI_FILE="$TMP/cli.tar.gz"
    info "下载 CLI 归档"
    fetch "$BASE_URL/$CLI_PLATFORM/$QUALITY" "$CLI_FILE" \
      || die "CLI 下载失败: $BASE_URL/$CLI_PLATFORM/$QUALITY"
    verify_sha "$CLI_FILE" "$(expected_sha "$BASE_URL/$CLI_PLATFORM/$QUALITY")" "CLI"
  fi

  rm -rf "$DEST_CLI"
  mkdir -p "$DEST_CLI"
  tar -xzf "$CLI_FILE" -C "$DEST_CLI"

  # 归档里是单个可执行文件 `code`；扩展是把它按 `code-cli` 写入的（eE = "code-cli"）。
  if [ -f "$DEST_CLI/code" ]; then
    mv "$DEST_CLI/code" "$DEST_CLI/code-cli"
  fi
  [ -f "$DEST_CLI/code-cli" ] || die "$CLI_FILE 里既没有 code 也没有 code-cli"
  chmod +x "$DEST_CLI/code-cli"

  if "$DEST_CLI/code-cli" --version >/dev/null 2>&1; then
    info "CLI 可用: $("$DEST_CLI/code-cli" --version 2>&1 | head -1)"
  else
    warn "$DEST_CLI/code-cli 无法执行（架构或 libc 不匹配？），扩展仍会找到它"
  fi
fi

# ---- Server ----

if [ -d "$DEST_SERVER/bin" ] && [ "$FORCE" -eq 0 ]; then
  info "Server 已存在，跳过: $DEST_SERVER（--force 重装）"
else
  if [ -n "$SERVER_TAR" ]; then
    [ -f "$SERVER_TAR" ] || die "找不到 Server 归档: $SERVER_TAR"
    SERVER_FILE="$SERVER_TAR"
    info "使用本地 Server 归档: $SERVER_TAR"
  else
    SERVER_FILE="$TMP/server.tar.gz"
    info "下载 Server 归档（约 222 MB）"
    fetch "$BASE_URL/$SERVER_PLATFORM/$QUALITY" "$SERVER_FILE" \
      || die "Server 下载失败: $BASE_URL/$SERVER_PLATFORM/$QUALITY"
    verify_sha "$SERVER_FILE" "$(expected_sha "$BASE_URL/$SERVER_PLATFORM/$QUALITY")" "Server"
  fi

  rm -rf "$DEST_SERVER"
  mkdir -p "$DEST_SERVER"
  # 归档里自带一层顶层目录，和扩展的 tar -xz --strip-components 1 保持一致。
  tar -xzf "$SERVER_FILE" -C "$DEST_SERVER" --strip-components 1
  [ -d "$DEST_SERVER/bin" ] || die "解包后没有 bin/，归档布局与预期不符: $SERVER_FILE"
fi

# 入口文件名必须等于 product.json 的 serverApplicationName（wslServer.sh 按此拼路径），
# 归档里只有 code-server。
ENTRY="$DEST_SERVER/bin/$SERVER_APPNAME"
if [ -x "$DEST_SERVER/bin/code-server" ]; then
  # 早先版本在这里生成过包装脚本，先清掉再改成软链接。
  if grep -qs 'picket-code-wrapper' "$ENTRY"; then
    rm -f "$ENTRY"
  fi
  if [ ! -e "$ENTRY" ]; then
    ln -s code-server "$ENTRY"
    info "生成入口: bin/$SERVER_APPNAME -> code-server"
  fi
fi

# 数据与扩展目录由 server 自己按 product.json 决定：serverDataFolderName 决定
# ~/<name>/{data,extensions}（wslServer.sh 的 DATAFOLDER 参数只用于 bin/ 与
# server-env-setup，不会传给 server）。归档的 product.json 仍是微软的
# .vscode-server / code-server，不改就会与用户已装的 VS Code WSL server 共用
# data、logs、User/globalStorage 与 extensions。
NODE="$DEST_SERVER/node"
PRODUCT="$DEST_SERVER/product.json"
if [ -x "$NODE" ] && [ -f "$PRODUCT" ]; then
  "$NODE" -e '
    const fs = require("fs");
    const [file, ...pairs] = process.argv.slice(1);
    const p = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      p[pair.slice(0, eq)] = JSON.parse(pair.slice(eq + 1));
    }
    fs.writeFileSync(file, JSON.stringify(p, null, 2) + "\n");
  ' "$PRODUCT" \
    'nameShort="picket-code"' \
    'nameLong="Picket Code"' \
    'applicationName="picket-code"' \
    'dataFolderName=".picket-code"' \
    "serverDataFolderName=\"$FOLDER\"" \
    "serverApplicationName=\"$SERVER_APPNAME\"" \
    'extensionsGallery={"serviceUrl":"https://open-vsx.org/vscode/gallery","itemUrl":"https://open-vsx.org/vscode/item"}' \
    'updateUrl=null' \
    && info "修正 product.json: serverDataFolderName=$FOLDER, serverApplicationName=$SERVER_APPNAME"
fi

# 服务端按是否存在 ../node_modules/vsda 决定要不要强制校验客户端签名
# （server-main.js: existsSync(.../node_modules/vsda) ? require('vsda') : null，
#   握手处 if (!l) E = !0 即"无 vsda 则放行未签名客户端"）。
# 我们的客户端用桩 vsda 签不出真签名，所以要移除服务端这份，否则连接被
# "Unauthorized client refused" 拒绝。
if [ -d "$DEST_SERVER/node_modules/vsda" ]; then
  mv "$DEST_SERVER/node_modules/vsda" "$DEST_SERVER/node_modules/vsda.disabled"
  info "已禁用服务端 vsda（无签名降级，见文档第八节）"
fi

# ---- 结果 ----

echo
echo "完成。"
echo "  CLI    $DEST_CLI/code-cli"
echo "  Server $DEST_SERVER"
echo
echo "在 Windows 侧打开/重载 WSL 窗口，WSL 输出面板应出现 install-found 或"
echo "'Server install found in WSL'，不应再出现 'Downloading VS Code Server'。"
