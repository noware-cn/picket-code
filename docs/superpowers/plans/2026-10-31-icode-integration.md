# iCode 集成（P2.5 + P3）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先证明内置 Agent Host 聊天面板能渲染非 Copilot provider（P2.5），再把 iCode 注册为唯一内置 agent，通过 `icode acp` 完成一次 hello 往返（P3）。

**Architecture:** 在 `src/vs/platform/agentHost/node/icode/` 新增一个 `IAgent` 实现：一个常驻 `icode acp` 子进程（NDJSON JSON-RPC），按 chat 复用 ACP 会话，把 `session/update` 映射为 AgentHost 的 `AgentSignal`，把 `session/request_permission` 映射为 `pending_confirmation`。provider 在两个 host 入口注册，整体作为 63 号补丁随钉版构建发布。

**Tech Stack:** TypeScript（VS Code 1.143.1 AgentHost）、Node 24 `child_process`、iCode ACP v1（stdio NDJSON）、Mocha node 测试。

**Spec:** `docs/design.md` §6（6.1–6.5）与 §8 的 P2.5/P3 行。设计文档与本计划一起读。

## Global Constraints

- 上游钉版：`microsoft/vscode` tag `1.143.1`（commit `e646868227c`）。所有产品代码改动发生在仓库根的 `./vscode`（已 gitignore），最终以 `build/patches/63-agenthost-icode-provider.patch` 交付。
- Node 版本 `24.18.0`（上游 `.nvmrc`）；`npm ci` 必须成功后才能编译/跑测试。
- 不新增任何 npm 依赖；不修改 iCode 源码。只对接 `icode acp`（ACP protocol version 1）。
- ACP 传输：一行一个 JSON 对象，`\n` 结尾，UTF-8；请求带 `"jsonrpc":"2.0"` 与数字 `id`。
- 允许的 ACP 方法仅：`session/new`、`session/prompt`、`session/cancel`（notification）、`session/close`；服务端消息仅处理 `session/update` 与 `session/request_permission`。扩展方法（`_chrys/*`）P3 不消费。**刻意不发送 `initialize`**：P3 不做能力协商，iCode 侧也不以握手为前置；版本不兼容会表现为 `session/new` 的 JSON-RPC 错误，直接透出给用户。
- provider id 固定为 `'icode'`，显示名 `'iCode'`；首个注册者即默认 provider，因此不要注册其他 provider。
- 审批模式固定 `--approval manual`，任何路径都不得传 `bypass`。
- 每个 host 进程一个 `icode acp` 子进程；每个 chat 一个 ACP session；`session/new` 的 `cwd` 取该 turn 的第一个工作目录的 `fsPath`，必须是**已存在的绝对目录**；无工作目录时用 `os.homedir()`；最终 `cwd` 校验不过就抛可操作错误，不发 `session/new`。
- 同一 chat 同一时刻只允许一个 turn：上一个 `session/prompt` 未返回时再次 `sendMessage` 立即抛错，不排队、不覆盖 turn state（iCode 后端同样是单 turn 语义，并发请求会以 `invalid_params` 失败）。
- P3 只在 POSIX 真机验收。Windows 上 `resolveIcodeCommand` 仍解析到 `icode.cmd`，但 `createIcodeTransport` 直接抛明确错误：Node ≥18.20.2 禁止无 shell 地 spawn `.cmd`/`.bat`，而本计划不使用 shell 字符串。
- 新代码只放 `src/vs/platform/agentHost/node/icode/`，测试只放 `src/vs/platform/agentHost/test/node/icode/`。
- 测试命令固定为：先 `cd vscode && ./node_modules/.bin/tsc -p src/tsconfig.json --noCheck --outDir out --rootDir src`（**不要**用 `npm run build-fast`：`build/next/build-fast.ts` 硬读已删除的 `extensions/copilot/package.json`；也不要用 `npm run compile`，它会连带 `compile-copilot` 失败），再 `npm run test-node -- --run <源文件路径>`。
- 类型检查：这棵打过 52–61 的树有 219 个既有类型错误（`src/vs/platform/agentHost/node/copilot/**` 仍引用已删除的 `@github/copilot-sdk`），`npm run typecheck-client` 永远非 0。门禁是「错误列表里没有 `agentHost/node/icode` 或 `agentHost/test/node/icode` 的行」。
- 依赖安装需要代理：`HTTPS_PROXY=http://127.0.0.1:7892 NODE_USE_ENV_PROXY=1 npm ci`（`build/npm/postinstall.ts` 的 fetch 直连会 10s 超时）。
- 提交信息用 Conventional Commits（英文、祈使式）：`feat(agenthost): …`、`docs: …`、`build: …`。

## Review Focus

1. `PICKET_ICODE_BIN` 指向不存在的文件，或 PATH 上没有 `icode`：provider 不注册，且首次发送给出可操作错误，不能静默吞掉。对应 Task 3/5 测试。
2. 工作目录含空格或非 ASCII：`session/new` 收到的 `cwd` 必须原样、绝对、不加引号，不能经过 shell 拼接。对应 Task 3/5 测试。
3. `icode acp` 在 turn 中途退出：当前 turn 必须以 `ChatError` 结束，下一次发送要重新拉起进程，不能永久卡在“运行中”。若 agent 侧自己 fire `ChatError` 会与宿主的兜底重复，因此一律抛错由宿主产出。对应 Task 6 测试。
4. 用户拒绝审批（`reject_once` / `cancelled`）：工具调用结束为取消，turn 仍能正常完成；绝不能把拒绝当同意。宿主也会以 `context.decisionSource` 主动兜底拒绝一次，重复或迟到的 `requestId` 必须静默忽略。对应 Task 6 测试。
5. 工作目录不存在或不是一个目录：不发 `session/new`、不 spawn 进程，直接抛可操作错误。对应 Task 5 测试。
6. 上一 turn 未结束时再次发送：立即失败，不排队、不串台。对应 Task 6 测试。
7. Windows 上 `icode` 是 `.cmd` shim：解析必须命中 `icode.cmd`，spawn 时不能依赖 shell 字符串；P3 在 Windows 上显式拒绝启动。对应 Task 3 测试。

---

## Task 1: P2.5 验证门 — mock provider 出现在内置聊天面板

**Files:**
- 只读验证，不改产品代码；结果记录到 `docs/design.md` §8「待验证项」。

**Interfaces:**
- Consumes: `--enable-mock-agent`（`agentHostServerMain.ts` 的 argv 开关）与 `ScriptedMockAgent`（`src/vs/platform/agentHost/test/node/mockAgent.ts`）。
- Produces: 一个结论——内置面板能否直连非 Copilot provider。结论为否时，本计划到此停止，回到设计文档评估外部 AHP client。

- [x] **Step 1: 准备与 CI 一致的源码树**

```bash
cd /home/dsun/workspace/picket-code
rm -rf vscode
git clone --depth 1 --branch 1.143.1 https://github.com/microsoft/vscode.git vscode
cd vscode
while IFS= read -r ext; do
  [ -z "$ext" ] && continue
  rm -rf "extensions/${ext%$'\r'}"
done < ../build/extensions-remove.list
bash ../build/apply-patches.sh "$PWD"
# 把 52–61 的结果固化成基线提交：apply-patches.sh 只 git apply 不 commit，
# 不提交的话后续 `git diff HEAD` 会把 52–61 的改动一起打进 62 号及之后的补丁。
git add -A && git commit -q -m "picket: apply patches 52-61 (baseline for later patches)"
git status --porcelain   # 必须为空
```

Expected: 补丁脚本最后一行 `==> [picket-code] All patches applied.`，随后 `git status --porcelain` 无输出。

- [x] **Step 2: 安装依赖并编译客户端**

```bash
# Node 24.x。上游 .nvmrc 是 24.18.0；本机 asdf 只有 24.22.2，同一 24.x 主线可用。
node -v
# postinstall 的 fetch 直连 github.com 会 10s 超时，必须走本地代理。
HTTPS_PROXY=http://127.0.0.1:7892 NODE_USE_ENV_PROXY=1 npm ci --no-audit --no-fund
# build-fast 在本树不可用（硬读已删除的 extensions/copilot/package.json）。用两步编译：
# 1) gulp transpile-client 复制静态资源（css/json/html/js）到 out/
# 2) tsc 把 .ts 重新编译成 ESM（gulp 走 esbuild，产物是 CJS 混 import.meta，node 加载即失败）
npm run gulp transpile-client
./node_modules/.bin/tsc -p src/tsconfig.json --noCheck --outDir out --rootDir src
```

Expected: `npm ci` exit 0；两条编译命令 exit 0；`out/vs/platform/agentHost/node/agentHostServerMain.js` 存在且是 ES 模块（文件里是 `import ... from`，没有 `Object.defineProperty(exports`）；`out/vs/**/*.css` 存在（`find out -name '*.css' | wc -l` ≈ 489）。

- [x] **Step 3: 启动带 mock provider 的独立 host**

```bash
cd /home/dsun/workspace/picket-code/vscode
ss -ltn | grep -q ':8099 ' && echo "8099 被占用，换一个端口"   # 8081 被 docker-proxy 占着
tail -f /dev/null | node scripts/code-agent-host.js --port 8099 --enable-mock-agent --without-connection-token --log trace
```

Expected: 标准输出出现 `READY:8099` 与 `[AgentHostServer]   Local:   ws://localhost:8099`；`ss -ltn | grep :8099` 显示监听；日志文件 `~/.config/Code - OSS Dev/logs/<ts>/agenthost-server.log`（目录带空格，路径要加引号）中出现 `[info] Registering agent provider: mock`。

- [x] **Step 4: 启动 workbench 并连接该 host**

另开终端：

```bash
cd /home/dsun/workspace/picket-code/vscode
npm run electron                # 首次需要，下载 Electron 43.7.7；本机要走代理
VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh --agents   # 必须用 Agents Window，见坑 4
```

把用户设置写进 `~/.config/Code - OSS Dev/User/settings.json`（日志目录同名的那个；也行 `--user-data-dir=/tmp/picket-ud` 显式指定再写 `/tmp/picket-ud/User/settings.json`）：

```json
{
  "chat.remoteAgentHostsEnabled": true,
  "chat.remoteAgentHosts": [
    { "name": "mock", "address": "127.0.0.1:8099" }
  ]
}
```

四个实测坑（2026-11-01）：

1. **端口 8081 被 docker-proxy 占用**，host 会 `EADDRINUSE` 后静默退出。启动前先 `ss -ltn | grep :<port>` 确认空闲，本计划改用 8099。
2. **host 的 stdin 一旦 EOF 就退出**，直接 `node scripts/code-agent-host.js …` 会被下一句 shell 收走。用 `tail -f /dev/null | node scripts/code-agent-host.js --port 8099 --enable-mock-agent --without-connection-token --log trace` 保持 stdin 打开。
3. `chat.remoteAgentHosts*` 是 `restricted: true`，未信任工作区时会被忽略；启动加 `--disable-workspace-trust` 或设 `"security.workspace.trust.enabled": false`。
4. **编辑器窗口根本不支持 WebSocket 远程 agent host**：`remoteAgentHostServiceImpl.ts` 里 `EditorWindowRemoteAgentHostService` 把 `supportsWebSocketConnections` 覆写为 `false`，WebSocket 工厂不注册，`chat.remoteAgentHosts` 永远读成空（日志固定 `Reconciling: desired=[]`，这与设置路径无关）。只有 **Agents Window**（CLI `--agents`）支持，否则聊天面板里连 agent 选择器都不会出现。

Expected: 日志出现 `[RemoteAgentHost] Reconciling: desired=[127.0.0.1:8099], current=[127.0.0.1:8099(connected)]`，以及 `mock from 127.0.0.1:8099 as remote-127.0.0.1__8099-mock`、模型 `mock-model`；host 侧日志出现 `Request 'createSession' … succeeded` 与 `session/ready`。

- [x] **Step 5: 冒烟并记录结论**

在 **Agents Window**（`--agents`）里发 `hello`。

Expected: 会话出现，助手回复 `Hello, world!`。

把结论追加到 `docs/design.md` §8「待验证项」：`P2.5 面板渲染：<日期> 实测 <通过/失败>，mock provider 会话 <可见/不可见>`。

**已知阻断（2026-11-01 实测，必须先解决才能进入 Task 2）：**

前 4 步全部通过（host 注册 `mock`、Agents Window `desired=[127.0.0.1:8099], current=[…(connected)]`、发现 `remote-127.0.0.1__8099-mock` 与 `mock-model`、`createSession` 成功），但发送消息被**客户端**拒绝：

```
Failed to start session: [agenthost-127.0.0.1__8099] sendRequest rejected: No default agent available
```

host 侧没有收到任何 `sendRequest`。链路：

1. `chat/common/chatService/chatServiceImpl.ts:1634-1638` 在解析请求前就要求 `chatAgentService.getDefaultAgent(location, mode)`，否则直接 rejected。
2. `chat/common/participants/chatAgents.ts:459-467` 的 `getDefaultAgent` 只认「已激活 且 `isDefault` 且 `locations`/`modes` 匹配」的 `IChatAgent`。
3. 会话型 agent（远程 agent host provider 走的这条）在 `chat/browser/chatSessions/chatSessions.contribution.ts:849-872` 注册时固定 `isDefault: false`；默认 agent 一直由 Copilot 扩展提供，而补丁 53 把 Copilot 删掉了。

所以本树里**任何**发送都会被拒，P3 的 iCode provider（同样是会话型 contribution）也会被同一条挡住。

**已修复（62 号补丁 `build/patches/62-chat-default-agent-fallback.patch`）：** `chatServiceImpl` 在 `getDefaultAgent` 落空时，若**整棵树没有任何 agent 标为默认**（即默认 chat agent 的扩展根本没装），就用本次发送显式指定的 `agentIdSilent` 顶替；只要存在任何默认 agent，原有门禁不变。改动两处（`sendRequest` 与 `processNextPendingRequest`）加一个 `_resolveSilentAgent` 私有方法，配两条单测：无默认 agent 时按 `agentIdSilent` 发出、两者都没有时仍照旧 reject。`npm run test-node -- --run src/vs/workbench/contrib/chat/test/common/chatService/chatService.test.ts` 全绿（256 passing）。

修改后必须重新编译 `out/` 并重启 workbench 才生效（客户端代码）。

**Stop rule:** 若 Step 5 看不到会话，不要继续 Task 2；带着日志与截图回到 `docs/design.md` §6.5 重新选 UI 路线。

- [x] **Step 6: 提交文档**

```bash
cd /home/dsun/workspace/picket-code
git add docs/design.md
git commit -m "docs: record the P2.5 chat-panel verification result"
```

**Stop rule:** 若 Step 5 看不到会话，不要继续 Task 2；带着日志与截图回到 `docs/design.md` §6.5 重新选 UI 路线。

---

## Task 2: ACP 传输客户端（`icodeAcpClient.ts`）

**Files:**
- Create: `vscode/src/vs/platform/agentHost/node/icode/icodeAcpClient.ts`
- Test: `vscode/src/vs/platform/agentHost/test/node/icode/icodeAcpClient.test.ts`

**Interfaces:**
- Consumes: `Event`/`Emitter`（`base/common/event.js`）、`CancellationError`（`base/common/errors.js`）。
- Produces:

```ts
export type IcodeJsonValue = null | boolean | number | string | IcodeJsonValue[] | { [key: string]: IcodeJsonValue };

export interface IIcodeAcpTransport {
	readonly stdin: NodeJS.WritableStream;
	readonly stdout: NodeJS.ReadableStream;
	readonly onExit: Event<number | null>;
	kill(): void;
}

export interface IIcodeAcpClient extends IDisposable {
	readonly onExit: Event<number | null>;
	request<R = unknown>(method: string, params?: IcodeJsonValue): Promise<R>;
	notify(method: string, params?: IcodeJsonValue): void;
	onNotification(method: string, handler: (params: any) => void): IDisposable;
	onRequest<R = unknown>(method: string, handler: (params: any, id: number | string) => R | Promise<R>): IDisposable;
	respond(id: number | string, result: IcodeJsonValue): void;
}

export class IcodeAcpClient implements IIcodeAcpClient {
	constructor(transport: IIcodeAcpTransport, log: (message: string) => void);
	// 见上
}
```

**动手前先核对上游契约。**本计划后四个 Task 依赖下列签名与形状；`vscode/` 是刚 clone 的 1.143.1，与本节不符时以上游为准并同步修订本计划（Task 5/6 的 `IAgent` 成员尤其容易漂移）：

```bash
cd vscode
grep -n "respondToPermissionRequest("      src/vs/platform/agentHost/common/agent.ts
grep -n "createChat(\|abort(chat\|sendMessage(chat" src/vs/platform/agentHost/common/agent.ts
grep -n "interface IChatUsage\|ChatUsage\|ChatReasoning" src/vs/platform/agentHost/common/state/sessionActions.ts
grep -n "export function isAgentEnabled"   src/vs/platform/agentHost/common/agentService.ts
```

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'assert';
import { PassThrough } from 'stream';
import { timeout } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IcodeAcpClient, IIcodeAcpTransport } from '../../node/icode/icodeAcpClient.js';

function createTransport() {
	const toServer = new PassThrough();
	const fromServer = new PassThrough();
	const transport: IIcodeAcpTransport = { stdin: toServer, stdout: fromServer, onExit: Event.None, kill: () => { } };
	return { transport, toServer, fromServer };
}

function nextMessage(stream: PassThrough): Promise<any> {
	return new Promise(resolve => stream.once('data', (chunk: Buffer) => resolve(JSON.parse(chunk.toString().trim()))));
}

suite('IcodeAcpClient', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('request writes a JSON-RPC 2.0 line and resolves with the matching result', async () => {
		const { transport, toServer, fromServer } = createTransport();
		const client = new IcodeAcpClient(transport, () => { });
		const pending = client.request('initialize', { protocolVersion: 1 });
		assert.deepStrictEqual(await nextMessage(toServer), {
			jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 },
		});
		fromServer.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } }) + '\n');
		assert.deepStrictEqual(await pending, { protocolVersion: 1 });
		client.dispose();
	});

	test('dispatches notifications and server-to-client requests', async () => {
		const { transport, toServer, fromServer } = createTransport();
		const client = new IcodeAcpClient(transport, () => { });
		const updates: unknown[] = [];
		client.onNotification('session/update', params => updates.push(params));
		client.onRequest('session/request_permission', (_params, id) => ({ id, outcome: { outcome: 'selected', optionId: 'allow' } }));

		fromServer.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1' } }) + '\n');
		fromServer.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'session/request_permission', params: { sessionId: 's1' } }) + '\n');

		await timeout(10);
		assert.deepStrictEqual(updates, [{ sessionId: 's1' }]);
		assert.deepStrictEqual(await nextMessage(toServer), {
			jsonrpc: '2.0', id: 7, result: { id: 7, outcome: { outcome: 'selected', optionId: 'allow' } },
		});
		client.dispose();
	});

	test('answers an unhandled server request with method-not-found', async () => {
		const { transport, toServer, fromServer } = createTransport();
		const client = new IcodeAcpClient(transport, () => { });
		fromServer.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'unknown/method', params: {} }) + '\n');
		const response = await nextMessage(toServer);
		assert.strictEqual(response.id, 9);
		assert.strictEqual(response.error.code, -32601);
		client.dispose();
	});

	test('dispose rejects in-flight requests and ignores later input', async () => {
		const { transport, fromServer } = createTransport();
		const client = new IcodeAcpClient(transport, () => { });
		const pending = client.request('session/new', { cwd: '/tmp' });
		client.dispose();
		await assert.rejects(pending);
		fromServer.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n');
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /home/dsun/workspace/picket-code/vscode
./node_modules/.bin/tsc -p src/tsconfig.json --noCheck --outDir out --rootDir src && npm run test-node -- --run src/vs/platform/agentHost/test/node/icode/icodeAcpClient.test.ts
```

Expected: FAIL，`Cannot find module .../icode/icodeAcpClient.js`。

- [ ] **Step 3: 实现客户端**

要点（实现细节由签名与测试确定）：
- `_nextId = 1`；`request` 记录 `{ resolve, reject }`，写出 `{ jsonrpc: '2.0', id, method, params }`；`params === undefined` 时不带该键。
- 读侧按 `\n` 缓冲；空行跳过；`JSON.parse` 失败时写日志并继续，不抛出进程级异常。
- 有 `id` 且无 `method` → 响应，按 `id` 结算，`error` 存在时以 `Error(message)` 拒绝；有 `method` 且有 `id` → 服务端请求，查 handler 表，`await handler(params, id)` 后 `respond(id, result)`；查不到时 `respond` 一个 `{ error: { code: -32601, message: 'Method not found' } }`——为此实现一个私有 `_respondError(id, code, message)`，公开的 `respond` 只发结果。
- 只有 `method` 无 `id` → 通知，按 method 分发给所有 handler，handler 抛错只记日志。
- `stdout` 的 `end`/`error` 与 `transport.onExit` 都走同一个 `_shutdown`：拒绝所有 pending，触发 `onExit`，且只触发一次。
- `dispose()`：标记 disposed，拒绝 pending，`transport.kill()`。

- [ ] **Step 4: 运行测试确认通过**

Run: `./node_modules/.bin/tsc -p src/tsconfig.json --noCheck --outDir out --rootDir src && npm run test-node -- --run src/vs/platform/agentHost/test/node/icode/icodeAcpClient.test.ts`
Expected: PASS（4 passing）。

- [ ] **Step 5: 导出补丁并提交**

```bash
cd /home/dsun/workspace/picket-code/vscode
git add -N src/vs/platform/agentHost/node/icode src/vs/platform/agentHost/test/node/icode
git diff HEAD > ../build/patches/63-agenthost-icode-provider.patch
cd ..
git add build/patches/63-agenthost-icode-provider.patch
git commit -m "feat(agenthost): add the ACP stdio client for iCode"
```

---

## Task 3: 启动配置解析（`icodeLaunchConfig.ts`）

**Files:**
- Create: `vscode/src/vs/platform/agentHost/node/icode/icodeLaunchConfig.ts`
- Test: `vscode/src/vs/platform/agentHost/test/node/icode/icodeLaunchConfig.test.ts`

**Interfaces:**
- Consumes: `node:path`（`join`）、`node:fs`（仅生产调用方传入 `existsSync`/`statSync` 派生的判断函数）、`node:child_process`（`spawn`）。
- Produces:

```ts
export const ICODE_BIN_ENV = 'PICKET_ICODE_BIN';
export const ICODE_AGENT_ENV = 'PICKET_ICODE_AGENT';

export function resolveIcodeCommand(
	env: Readonly<Record<string, string | undefined>>,
	isFile: (path: string) => boolean,
	platform: NodeJS.Platform,
): string | undefined;

export function buildIcodeArgs(agent: string): readonly string[];
export function createIcodeTransport(command: string, platform?: NodeJS.Platform): IIcodeAcpTransport;
```

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { buildIcodeArgs, createIcodeTransport, resolveIcodeCommand } from '../../node/icode/icodeLaunchConfig.js';

suite('icodeLaunchConfig', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('PICKET_ICODE_BIN wins when it points at a file', () => {
		const command = resolveIcodeCommand(
			{ PICKET_ICODE_BIN: '/opt/icode/bin/icode', PATH: '/usr/bin' },
			p => p === '/opt/icode/bin/icode',
			'linux',
		);
		assert.strictEqual(command, '/opt/icode/bin/icode');
	});

	test('an invalid override does not fall through to PATH', () => {
		const command = resolveIcodeCommand(
			{ PICKET_ICODE_BIN: '/missing/icode', PATH: '/usr/bin' },
			p => p === '/usr/bin/icode',
			'linux',
		);
		assert.strictEqual(command, undefined);
	});

	test('finds icode on PATH and uses icode.cmd on Windows', () => {
		assert.strictEqual(
			resolveIcodeCommand({ PATH: '/one:/two' }, p => p === '/two/icode', 'linux'),
			'/two/icode',
		);
		assert.strictEqual(
			resolveIcodeCommand({ PATH: 'C:\\one;C:\\two' }, p => p === 'C:\\two\\icode.cmd', 'win32'),
			'C:\\two\\icode.cmd',
		);
	});

	test('returns undefined when nothing is found', () => {
		assert.strictEqual(resolveIcodeCommand({ PATH: '/one' }, () => false, 'linux'), undefined);
		assert.strictEqual(resolveIcodeCommand({}, () => true, 'linux'), undefined);
	});

	test('builds the fixed manual-approval argument list', () => {
		assert.deepStrictEqual(buildIcodeArgs('Code'), ['acp', '--approval', 'manual', '-a', 'Code']);
	});

	test('refuses to spawn the Windows shim', () => {
		assert.throws(() => createIcodeTransport('C:\\two\\icode.cmd', 'win32'), /not supported on Windows/);
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `./node_modules/.bin/tsc -p src/tsconfig.json --noCheck --outDir out --rootDir src && npm run test-node -- --run src/vs/platform/agentHost/test/node/icode/icodeLaunchConfig.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

要点：
- `resolveIcodeCommand`：`PICKET_ICODE_BIN` 存在时只认它（`isFile` 为真返回，否则 `undefined`，不回落）；否则按 `platform === 'win32' ? ';' : ':'` 拆 `PATH`，跳过空段，Windows 候选名 `icode.cmd`，其他 `icode`；路径用 `join` 拼接，不经过 shell。
- `buildIcodeArgs(agent)` 返回 `['acp', '--approval', 'manual', '-a', agent]`，顺序固定。
- `createIcodeTransport(command, platform = process.platform)`：`platform === 'win32'` 时先抛 `new Error('iCode over ACP is not supported on Windows yet: Node will not spawn a .cmd shim without a shell')`（不 spawn、不建进程）；否则 `spawn(command, buildIcodeArgs(env[ICODE_AGENT_ENV] ?? 'Code'), { stdio: ['pipe', 'pipe', 'pipe'], env: process.env, windowsHide: true })`，`stderr` 逐行写 `console.error`；返回 `{ stdin, stdout, onExit, kill }`，`onExit` 用 `Emitter<number | null>`，在 `exit` 时 `fire(code)` 并 `dispose`。

- [ ] **Step 4: 运行测试确认通过**

Expected: PASS（6 passing）。

- [ ] **Step 5: 导出补丁并提交**

```bash
cd /home/dsun/workspace/picket-code/vscode
git add -N src/vs/platform/agentHost/node/icode src/vs/platform/agentHost/test/node/icode
git diff HEAD > ../build/patches/63-agenthost-icode-provider.patch
cd ..
git add build/patches/63-agenthost-icode-provider.patch
git commit -m "feat(agenthost): resolve the iCode ACP launch command"
```

---

## Task 4: ACP 事件映射（`icodeMapEvents.ts`）

**Files:**
- Create: `vscode/src/vs/platform/agentHost/node/icode/icodeMapEvents.ts`
- Test: `vscode/src/vs/platform/agentHost/test/node/icode/icodeMapEvents.test.ts`

**Interfaces:**
- Consumes: `URI`、`AgentSignal`、`ActionType`、`ResponsePartKind`、`ToolCallConfirmationReason`、`ToolCallStatus`、`ToolResultContentType`。
- Produces:

```ts
export interface IcodeSessionUpdate {
	readonly sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk' | 'tool_call' | 'tool_call_update' | 'plan' | 'usage_update' | 'session_info_update' | 'current_mode_update' | string;
	readonly messageId?: string;
	readonly content?: { readonly type: string; readonly text?: string } | readonly { readonly type: string; readonly text?: string }[];
	readonly toolCallId?: string;
	readonly title?: string;
	readonly kind?: string;
	readonly status?: string;
	readonly rawInput?: unknown;
	readonly rawOutput?: unknown;
	readonly entries?: readonly unknown[];
	readonly used?: number;
	readonly size?: number;
}

export interface IcodePermissionRequest {
	readonly sessionId: string;
	readonly toolCall: { readonly toolCallId: string; readonly title?: string; readonly kind?: string; readonly status?: string; readonly rawInput?: unknown };
	readonly options: readonly { readonly optionId: string; readonly name: string; readonly kind: string }[];
}

export interface IIcodeTurnState {
	readonly turnId: string;
	readonly partIds: Map<string, string>;
	readonly toolTitles: Map<string, string>;
	readonly readyToolCalls: Set<string>;
	nextPartSequence: number;
}

export function createIcodeTurnState(turnId: string): IIcodeTurnState;
export function mapAcpSessionUpdate(chat: URI, state: IIcodeTurnState, update: IcodeSessionUpdate): AgentSignal[];
export function mapAcpPermissionRequest(chat: URI, state: IIcodeTurnState, request: IcodePermissionRequest): AgentSignal[];
```

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { ResponsePartKind, ToolCallConfirmationReason, ToolCallStatus, ToolResultContentType } from '../../common/state/sessionState.js';
import { createIcodeTurnState, mapAcpPermissionRequest, mapAcpSessionUpdate } from '../../node/icode/icodeMapEvents.js';

const chat = URI.parse('ahp-chat://test/chat');

suite('icodeMapEvents', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('streams a text chunk into one part', () => {
		const state = createIcodeTurnState('turn-1');
		assert.deepStrictEqual(
			mapAcpSessionUpdate(chat, state, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'Hel' } }),
			[
				{ kind: 'action', resource: chat, action: { type: ActionType.ChatResponsePart, turnId: 'turn-1', part: { kind: ResponsePartKind.Markdown, id: 'icode-part-1', content: '' } } },
				{ kind: 'action', resource: chat, action: { type: ActionType.ChatDelta, turnId: 'turn-1', partId: 'icode-part-1', content: 'Hel' } },
			],
		);
		assert.deepStrictEqual(
			mapAcpSessionUpdate(chat, state, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'lo' } }),
			[{ kind: 'action', resource: chat, action: { type: ActionType.ChatDelta, turnId: 'turn-1', partId: 'icode-part-1', content: 'lo' } }],
		);
	});

	test('streams a thought chunk as a reasoning part', () => {
		const state = createIcodeTurnState('turn-1');
		assert.deepStrictEqual(
			mapAcpSessionUpdate(chat, state, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'think' } }),
			[
				{ kind: 'action', resource: chat, action: { type: ActionType.ChatResponsePart, turnId: 'turn-1', part: { kind: ResponsePartKind.Reasoning, id: 'icode-part-1', content: '' } } },
				{ kind: 'action', resource: chat, action: { type: ActionType.ChatReasoning, turnId: 'turn-1', partId: 'icode-part-1', content: 'think' } },
			],
		);
		assert.deepStrictEqual(
			mapAcpSessionUpdate(chat, state, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'more' } }),
			[{ kind: 'action', resource: chat, action: { type: ActionType.ChatReasoning, turnId: 'turn-1', partId: 'icode-part-1', content: 'more' } }],
		);
	});

	test('maps a tool call start and completion', () => {
		const state = createIcodeTurnState('turn-1');
		assert.deepStrictEqual(
			mapAcpSessionUpdate(chat, state, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Run ls', kind: 'execute', status: 'in_progress', rawInput: { command: 'ls' } }),
			[{ kind: 'action', resource: chat, action: { type: ActionType.ChatToolCallStart, turnId: 'turn-1', toolCallId: 't1', toolName: 'shell', displayName: 'Run ls' } }],
		);
		assert.deepStrictEqual(
			mapAcpSessionUpdate(chat, state, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'text', text: 'ok' }], rawOutput: 'ok' }),
			[{
				kind: 'action', resource: chat, action: {
					type: ActionType.ChatToolCallComplete, turnId: 'turn-1', toolCallId: 't1',
					result: { success: true, pastTenseMessage: 'Run ls', content: [{ type: ToolResultContentType.Text, text: 'ok' }] },
				},
			}],
		);
	});

	test('a permission request yields a pending confirmation on the existing tool call', () => {
		const state = createIcodeTurnState('turn-1');
		mapAcpSessionUpdate(chat, state, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Run ls', kind: 'execute', status: 'pending', rawInput: { command: 'ls' } });
		assert.deepStrictEqual(
			mapAcpPermissionRequest(chat, state, {
				sessionId: 's1',
				toolCall: { toolCallId: 't1', title: 'Run ls', kind: 'execute', status: 'pending', rawInput: { command: 'ls' } },
				options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject once', kind: 'reject_once' }],
			}),
			[{
				kind: 'pending_confirmation', chat,
				state: {
					status: ToolCallStatus.PendingConfirmation,
					toolCallId: 't1', toolName: 'shell', displayName: 'Run ls',
					invocationMessage: 'Run ls', toolInput: '{"command":"ls"}', confirmationTitle: 'Run ls',
				},
				permissionKind: 'shell',
			}],
		);
	});

	test('ignores plan, usage and unknown updates', () => {
		const state = createIcodeTurnState('turn-1');
		assert.deepStrictEqual(mapAcpSessionUpdate(chat, state, { sessionUpdate: 'plan', entries: [] }), []);
		assert.deepStrictEqual(mapAcpSessionUpdate(chat, state, { sessionUpdate: 'usage_update', used: 10, size: 100 }), []);
		assert.deepStrictEqual(mapAcpSessionUpdate(chat, state, { sessionUpdate: 'session_info_update' }), []);
		assert.deepStrictEqual(mapAcpSessionUpdate(chat, state, { sessionUpdate: 'current_mode_update' }), []);
		assert.deepStrictEqual(mapAcpSessionUpdate(chat, state, { sessionUpdate: 'branch_snapshot' }), []);
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `./node_modules/.bin/tsc -p src/tsconfig.json --noCheck --outDir out --rootDir src && npm run test-node -- --run src/vs/platform/agentHost/test/node/icode/icodeMapEvents.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现映射**

固定规则（测试已把它们钉死，照做即可）：
- 文本：`messageId` 为键；首次出现发 `ChatResponsePart`（`content: ''`）+ `ChatDelta`（本次文本），之后只发 `ChatDelta`。part id 为 `icode-part-${++state.nextPartSequence}`。
- 思考：键固定为 `'__thought__'`，part kind 为 `ResponsePartKind.Reasoning`；首次同样发 `ChatResponsePart`，之后每次发 `ActionType.ChatReasoning`（字段名以 `sessionActions.ts` 的该 action 定义为准）。**不能复用 `ChatDelta`**——reducer 的 `ChatDelta` 分支只对 `ResponsePartKind.Markdown` 追加内容，其它 kind 会被原样丢弃，界面上就看不到思考。
- 工具名：`execute → 'shell'`、`edit → 'edit'`、`read → 'read'`、`search → 'search'`、`fetch → 'fetch'`、其他 `'other'`。
- `tool_call` 只发 `ChatToolCallStart`（`toolName`、`displayName: title ?? toolCallId`），记录标题，不发 Ready。
- `tool_call_update`：`status === 'in_progress'` 且未 Ready 时发一次 `ChatToolCallReady`（`invocationMessage`、`toolInput`、`confirmed: ToolCallConfirmationReason.NotNeeded`）；`status === 'completed' | 'failed'` 时发 `ChatToolCallComplete`，`success` 取 `status === 'completed'`，`pastTenseMessage` 用记录的标题，`content` 优先取 `update.content` 中 `type === 'text'` 的 block 文本（数组则按序拼接），没有才回退 `rawOutput`（非字符串用 `JSON.stringify`），两者都没有就不带 `content`。
- 权限请求：若该 toolCallId 尚未发过 Start，先补一条 Start；然后发 `pending_confirmation`（`toolInput` 为 `JSON.stringify(rawInput)`，无 rawInput 则省略）；`permissionKind`：`execute → 'shell'`、`edit → 'write'`、`read → 'read'`，其他省略。
- 其余 `sessionUpdate`（`plan`、`usage_update`、`session_info_update`、`current_mode_update` 以及未知值）一律返回 `[]`——iCode 在 `session/new` 之后会先发几条这类通知，不能当成错误。

- [ ] **Step 4: 运行测试确认通过**

Expected: PASS（5 passing）。

- [ ] **Step 5: 导出补丁并提交**

```bash
cd /home/dsun/workspace/picket-code/vscode
git add -N src/vs/platform/agentHost/node/icode src/vs/platform/agentHost/test/node/icode
git diff HEAD > ../build/patches/63-agenthost-icode-provider.patch
cd ..
git add build/patches/63-agenthost-icode-provider.patch
git commit -m "feat(agenthost): map ACP updates to agent host signals"
```

---

## Task 5: `IcodeAgent` 一轮往返（`icodeAgent.ts`）

**Files:**
- Create: `vscode/src/vs/platform/agentHost/node/icode/icodeAgent.ts`
- Test: `vscode/src/vs/platform/agentHost/test/node/icode/icodeAgent.test.ts`

**Interfaces:**
- Consumes: Task 2–4 的 `IcodeAcpClient`、`resolveIcodeCommand`/`createIcodeTransport`、`createIcodeTurnState`/`mapAcpSessionUpdate`；`ILogService`；`observableValue`；`generateUuid`（`base/common/uuid.js`）。
- Produces:

```ts
export class IcodeAgent extends Disposable implements IAgent {
	readonly id = 'icode';
	readonly agentHostCapabilities = { workspaceConversion: false };
	constructor(
		@ILogService logService: ILogService,
		clientFactory?: () => IIcodeAcpClient | undefined,
	);
	// 其余成员实现 IAgent；见步骤 3
}
```

- [ ] **Step 1: 写失败测试（一轮往返）**

```ts
import assert from 'assert';
import { tmpdir } from 'os';
import { timeout } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import type { AgentSignal, IAgentActionSignal } from '../../common/agent.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { IcodeAcpClient, IIcodeAcpClient } from '../../node/icode/icodeAcpClient.js';
import { IcodeAgent } from '../../node/icode/icodeAgent.js';

class FakeIcodeClient implements IIcodeAcpClient {
	readonly onExit = Event.None;
	readonly requests: { method: string; params: any }[] = [];
	readonly notifications: { method: string; params: any }[] = [];
	private readonly notificationHandlers = new Map<string, (params: any) => void>();
	private resolvePrompt: ((value: any) => void) | undefined;

	request<R>(method: string, params?: unknown): Promise<R> {
		this.requests.push({ method, params });
		if (method === 'session/new') {
			return Promise.resolve({ sessionId: 's1', modes: { availableModes: [], currentModeId: 'manual' }, models: { availableModels: [], currentModelId: 'mock' } } as R);
		}
		if (method === 'session/prompt') {
			return new Promise<R>(resolve => { this.resolvePrompt = resolve as (value: any) => void; });
		}
		return Promise.resolve({} as R);
	}
	notify(method: string, params?: unknown): void { this.notifications.push({ method, params }); }
	onNotification(method: string, handler: (params: any) => void) { this.notificationHandlers.set(method, handler); return { dispose: () => this.notificationHandlers.delete(method) }; }
	onRequest(): { dispose(): void } { return { dispose: () => { } }; }
	respond(): void { }
	emitNotification(method: string, params: unknown): void { this.notificationHandlers.get(method)?.(params); }
	finishPrompt(result: unknown): void { this.resolvePrompt?.(result); }
	dispose(): void { }
}

const chat = URI.parse('ahp-chat://test/chat');
const workspace = URI.file(tmpdir());   // 必须真实存在：sendMessage 会校验 cwd 是不是已存在的绝对目录

suite('IcodeAgent (one turn)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('creates a session and completes a prompt round-trip', async () => {
		const client = new FakeIcodeClient();
		const agent = new IcodeAgent(new NullLogService(), () => client as unknown as IcodeAcpClient);
		const signals: AgentSignal[] = [];
		agent.onDidChatProgress(signal => signals.push(signal));

		const sending = agent.chats.sendMessage(chat, 'hello', [workspace], undefined, 'turn-1');
		await timeout(10);
		assert.deepStrictEqual(client.requests[0], { method: 'session/new', params: { cwd: workspace.fsPath, mcpServers: [] } });

		client.emitNotification('session/update', {
			sessionId: 's1',
			update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'hello' } },
		});
		client.finishPrompt({ stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } });
		await sending;

		assert.deepStrictEqual(client.requests.map(r => r.method), ['session/new', 'session/prompt']);
		assert.deepStrictEqual(signals.map(s => (s as IAgentActionSignal).action.type), [
			ActionType.ChatResponsePart, ActionType.ChatDelta, ActionType.ChatUsage, ActionType.ChatTurnComplete,
		]);
		agent.dispose();
	});

	test('rejects a turn whose working directory is not an existing directory', async () => {
		const client = new FakeIcodeClient();
		const agent = new IcodeAgent(new NullLogService(), () => client as unknown as IcodeAcpClient);

		await assert.rejects(
			agent.chats.sendMessage(chat, 'hello', [URI.file('/definitely/missing-icode-workspace')], undefined, 'turn-1'),
			/working directory/,
		);
		assert.deepStrictEqual(client.requests, []);
		agent.dispose();
	});

	test('surfaces a refusal stop reason as a failure', async () => {
		const client = new FakeIcodeClient();
		const agent = new IcodeAgent(new NullLogService(), () => client as unknown as IcodeAcpClient);

		const sending = agent.chats.sendMessage(chat, 'hello', [workspace], undefined, 'turn-1');
		await timeout(10);
		client.finishPrompt({ stopReason: 'refusal' });
		await assert.rejects(sending, /refus/i);
		agent.dispose();
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `./node_modules/.bin/tsc -p src/tsconfig.json --noCheck --outDir out --rootDir src && npm run test-node -- --run src/vs/platform/agentHost/test/node/icode/icodeAgent.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 `IcodeAgent`**

必需成员（`IAgent` 非可选项）一个都不能少；无行为的用最小实现：
- 身份与目录：`id`、`agentHostCapabilities`、`getDescriptor()` 返回 `{ provider: 'icode', displayName: 'iCode', description: 'iCode agent over the Agent Client Protocol' }`；`models = observableValue('icode.models', [{ provider: 'icode', id: 'default', name: 'iCode (BYOK)', supportsVision: false }])`。
- 事件：`onDidChatProgress`、`onDidMaterializeChat`、`onDidChangeChatData`、`onDidSpawnChat`、`onDidDiscoverChats`，用 `Emitter`/`Event.None`。
- `chats.createChat(chat: URI, context, options?)`：签名以 `agent.ts` 的 `IAgentChats.createChat` 为准；以 `chat.toString()` 为键记录 `{ cwd: context.cwd }` 并返回 `{}`（该记录只用于诊断；一个 turn 实际用哪个目录由 `sendMessage` 的工作目录决定）。
- `chats.disposeChat` 关闭 ACP session 并删除记录；`releaseChat` 空实现；`changeModel`/`changeAgent` 空实现；`getMessages` 返回 `[]`。
- `chats.abort(chat, _context)`：只发 `session/cancel` 通知，**不 fire 任何完成事件**。宿主在调用 `abort` 之前已经把 turn 标记为 cancelled 并通知了 reducer，重复 fire 会让同一 turn 完成两次。
- `setWorkingDirectory` 直接抛 `new Error('iCode does not support changing the working directory of an existing chat')`——mock 也是抛错，静默 no-op 会让用户以为切换生效了。
- 其余：`materializeChat` 空；`getOrCreateActiveClient` 按 `mockAgent.ts` 的形态返回 `{ clientId, displayName, tools: [], customizations: [] }`（getter/setter 可写）；`removeActiveClient`/`onClientToolCallComplete`/`respondToUserInputRequest` 空；`resolveChatConfig` 返回 `{ schema: { type: 'object', properties: {} }, values: params.config ?? {} }`；`getInheritedChatConfig` 返回 `undefined`；`chatConfigCompletions` 返回 `{ items: [] }`；`getChatCustomizations` 返回 `[]`；`listChatsToMigrate` 返回 `[]`；`getChatMetadata` 返回 `undefined`；`getProtectedResources` 返回 `[]`；`authenticate` 返回 `false`；`shutdown` 释放 client；`dispose` 同。

`sendMessage(chat, prompt, workingDirectoriesOrDirectory, _attachments, turnId)`（`_attachments`、`senderClientId`、`clientType`、`context` 刻意忽略）：
1. `if (!turnId) { throw new Error('iCode requires a turn id'); }`
2. `const cwd = (Array.isArray(workingDirectoriesOrDirectory) ? workingDirectoriesOrDirectory[0] : workingDirectoriesOrDirectory)?.fsPath ?? os.homedir();` 随后校验：必须是绝对路径且 `statSync(cwd).isDirectory()`，否则抛 `new Error(\`iCode requires an existing absolute working directory: ${cwd}\`)`。**校验必须在创建 client 之前**——`session/new` 在 iCode 侧也要求已存在的绝对目录，先拦下来才不会白 spawn 一个进程。
3. 单 turn 守卫：`if (this._activePrompts.has(chatKey)) { throw new Error('iCode is already running a turn for this chat'); }`
4. `const client = this._ensureClient();`（工厂返回 `undefined` 时抛 `new Error('iCode executable not found: set PICKET_ICODE_BIN or put icode on PATH')`）
5. `const sessionId = await this._ensureSession(chat, cwd);`
6. `const state = createIcodeTurnState(turnId);` 记进 `_turns`，并把 `session/prompt` 的 Promise 记进 `_activePrompts`。
7. `const startedAt = Date.now(); const result = await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] });`
8. `const usage = result?.usage;` 只在两个字段都是数字时 fire `{ kind: 'action', resource: chat, action: { type: ActionType.ChatUsage, turnId, usage: { inputTokens, outputTokens } } }`（字段名以 `sessionActions.ts` 的 `ChatUsage` 定义为准；缺字段就整条跳过，不要用 `used`/`size` 冒充 token 数）。
9. `stopReason` 分三种：`'cancelled'` → fire `ChatTurnCancelled { turnId, duration }`；`'refusal'` → `throw new Error('iCode refused this turn (stopReason: refusal)')`；其余（含 `'end_turn'`）→ fire `ChatTurnComplete { turnId, duration: Date.now() - startedAt }`。`refusal` 不能落进完成分支，否则用户会看到"正常结束"但其实什么都没做。
10. `finally { this._turns.delete(chatKey); this._activePrompts.delete(chatKey); }`
11. **失败一律抛出，不要自己 fire `ChatError`**：宿主的 `sendMessage` 调用点已经 catch 并 dispatch `ChatError` + 结束 turn，agent 再发一次会出现两条错误 part（或与宿主的 turn 完成竞态）。
12. `session/update` 通知：按 `sessionId` 找回 chat，取该 chat 的 turn state，`for (const signal of mapAcpSessionUpdate(chat, state, update)) { this._onDidChatProgress.fire(signal); }`；找不到映射就丢弃并记 trace 日志。

`_ensureSession(chat, cwd)`：命中缓存且 `cwd` 相同直接返回；否则 `await client.request('session/new', { cwd, mcpServers: [] })`，缓存 `{ sessionId, cwd }` 与反向表，返回 `sessionId`。

- [ ] **Step 4: 运行测试确认通过**

Expected: PASS（3 passing）。

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck-client 2>&1 | grep -E "agentHost/(test/)?node/icode" | head`
Expected: 无输出。整棵树有 219 个既有错误（`agentHost/node/copilot/**` 等，与本次改动无关），整条命令退出码非 0 属正常，只看有没有本计划目录的行。

- [ ] **Step 6: 导出补丁并提交**

```bash
cd /home/dsun/workspace/picket-code/vscode
git add -N src/vs/platform/agentHost/node/icode src/vs/platform/agentHost/test/node/icode
git diff HEAD > ../build/patches/63-agenthost-icode-provider.patch
cd ..
git add build/patches/63-agenthost-icode-provider.patch
git commit -m "feat(agenthost): implement the iCode agent provider"
```

---

## Task 6: 中断、审批与进程退出

**Files:**
- Modify: `vscode/src/vs/platform/agentHost/node/icode/icodeAgent.ts`
- Test: `vscode/src/vs/platform/agentHost/test/node/icode/icodeAgent.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `IcodeAgent` 与 `IIcodeAcpClient`。
- Produces:
  - `respondToPermissionRequest(requestId: string, approved: boolean, context?: IAgentPermissionResponseContext): void` —— 签名照抄 `IAgent`（`agent.ts` 的 `respondToPermissionRequest`），`requestId` 就是 ACP 的 `toolCallId`。实现通过挂起的 `onRequest('session/request_permission')` Promise 回复 `{ outcome: { outcome: 'selected', optionId: approved ? 'allow' : 'reject' } }`。宿主会用 `context.decisionSource`（`'unattended_fallback'` / `'host_policy'`）主动兜底拒绝，且可能在 turn 结束后再调用一次，因此**未知或已结算的 `requestId` 必须静默忽略**，不能抛错。
  - 进程退出后 `_client` 与所有 session 缓存清空，下一次 `sendMessage` 重新 spawn。

- [ ] **Step 1: 写失败测试（中断 / 审批 / 退出 / 并发）**

在同一个测试文件的 `FakeIcodeClient` 上补充：`onRequest` 存入 handler 表、`emitRequest(id, method, params)` 调用并返回其 Promise、`onExit` 改为 `Emitter<number | null>` 加 `emitExit(code)`。新增四个测试（复用 Task 5 已定义的 `chat` 与 `workspace`，`workspace` 是 `tmpdir()`，保证 cwd 校验通过）：

```ts
test('abort sends session/cancel and does not complete the turn', async () => {
	const client = new FakeIcodeClient();
	const agent = new IcodeAgent(new NullLogService(), () => client as unknown as IcodeAcpClient);
	const signals: AgentSignal[] = [];
	agent.onDidChatProgress(signal => signals.push(signal));
	const sending = agent.chats.sendMessage(chat, 'hello', [workspace], undefined, 'turn-1');
	await timeout(10);
	await agent.chats.abort(chat, chat);
	assert.deepStrictEqual(client.notifications, [{ method: 'session/cancel', params: { sessionId: 's1' } }]);
	assert.deepStrictEqual(signals, []);
	client.finishPrompt({ stopReason: 'cancelled' });
	await sending;
	assert.strictEqual((signals.at(-1) as IAgentActionSignal).action.type, ActionType.ChatTurnCancelled);
	agent.dispose();
});

test('a permission request becomes a pending confirmation and a rejection is forwarded', async () => {
	const client = new FakeIcodeClient();
	const agent = new IcodeAgent(new NullLogService(), () => client as unknown as IcodeAcpClient);
	const signals: AgentSignal[] = [];
	agent.onDidChatProgress(signal => signals.push(signal));
	const sending = agent.chats.sendMessage(chat, 'hello', [workspace], undefined, 'turn-1');
	await timeout(10);

	const pending = client.emitRequest(7, 'session/request_permission', {
		sessionId: 's1',
		toolCall: { toolCallId: 't1', title: 'Run ls', kind: 'execute', status: 'pending', rawInput: { command: 'ls' } },
		options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject once', kind: 'reject_once' }],
	});
	assert.deepStrictEqual(signals.at(-1), {
		kind: 'pending_confirmation', chat,
		state: {
			status: ToolCallStatus.PendingConfirmation, toolCallId: 't1', toolName: 'shell', displayName: 'Run ls',
			invocationMessage: 'Run ls', toolInput: '{"command":"ls"}', confirmationTitle: 'Run ls',
		},
		permissionKind: 'shell',
	});
	agent.respondToPermissionRequest('t1', false, { decisionSource: 'user' });
	assert.deepStrictEqual(await pending, { outcome: { outcome: 'selected', optionId: 'reject' } });
	// 迟到/重复的回复必须被静默忽略
	agent.respondToPermissionRequest('t1', true, { decisionSource: 'unattended_fallback' });
	agent.respondToPermissionRequest('unknown', true);
	client.finishPrompt({ stopReason: 'cancelled' });
	await sending;
	agent.dispose();
});

test('a second send while a turn is live fails fast', async () => {
	const client = new FakeIcodeClient();
	const agent = new IcodeAgent(new NullLogService(), () => client as unknown as IcodeAcpClient);
	const sending = agent.chats.sendMessage(chat, 'hello', [workspace], undefined, 'turn-1');
	await timeout(10);
	await assert.rejects(
		agent.chats.sendMessage(chat, 'again', [workspace], undefined, 'turn-2'),
		/already running/,
	);
	client.finishPrompt({ stopReason: 'end_turn' });
	await sending;
	agent.dispose();
});

test('a process exit fails the live turn and respawns on the next send', async () => {
	const clients: FakeIcodeClient[] = [];
	const agent = new IcodeAgent(new NullLogService(), () => {
		const client = new FakeIcodeClient();
		clients.push(client);
		return client as unknown as IcodeAcpClient;
	});
	const signals: AgentSignal[] = [];
	agent.onDidChatProgress(signal => signals.push(signal));
	const sending = agent.chats.sendMessage(chat, 'hello', [workspace], undefined, 'turn-1');
	await timeout(10);
	clients[0].emitExit(1);
	await sending;
	assert.strictEqual((signals.at(-1) as IAgentActionSignal).action.type, ActionType.ChatError);
	agent.dispose();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `./node_modules/.bin/tsc -p src/tsconfig.json --noCheck --outDir out --rootDir src && npm run test-node -- --run src/vs/platform/agentHost/test/node/icode/icodeAgent.test.ts`
Expected: FAIL（`notifications` 为空 / 无 pending_confirmation / 无 ChatError / 并发发送未被拒绝）。

- [ ] **Step 3: 实现**

- 注册 `client.onRequest('session/request_permission', (params, id) => this._onPermissionRequest(params as IcodePermissionRequest, id))`。`_onPermissionRequest` 找到 chat 与 turn state，fire `mapAcpPermissionRequest(...)` 的 signals；若已有同一 `toolCallId` 的挂起项，先以 `{ outcome: { outcome: 'cancelled' } }` 结算旧的；返回 `new Promise(resolve => this._pendingPermissions.set(toolCallId, resolve))`。
- `respondToPermissionRequest(requestId, approved, context)`：取挂起 resolve；不存在就记一条 trace 日志（带上 `context?.decisionSource`）直接返回，**不抛错**；存在则删除并 `resolve({ outcome: { outcome: 'selected', optionId: approved ? 'allow' : 'reject' } })`。
- `client.onExit(() => …)`：若存在活动 turn，fire `ChatError`（`errorType: 'icodeExited'`，message 含退出码）——这是唯一由 agent 侧主动 fire `ChatError` 的场景（prompt 的 Promise 不会因进程退出而 reject，宿主无从兜底）；然后清空 `_turns`/`_activePrompts`/`_sessions`/`_chatBySession`/`_client`，并以 `{ outcome: { outcome: 'cancelled' } }` 结算全部挂起审批。
- `_ensureClient` 在 `this._client` 为空时通过工厂重建。
- 不做事件去重以外的排队：并发 `sendMessage` 在 Task 5 第 3 步就已 fail-fast，这里只需保证退出后清理干净，让下一次发送走全新 client + 全新 session。

- [ ] **Step 4: 运行测试确认通过**

Expected: PASS（7 passing，其中 Task 5 的 3 个仍然通过）。

- [ ] **Step 5: 导出补丁并提交**

```bash
cd /home/dsun/workspace/picket-code/vscode
git add -N src/vs/platform/agentHost/node/icode src/vs/platform/agentHost/test/node/icode
git diff HEAD > ../build/patches/63-agenthost-icode-provider.patch
cd ..
git add build/patches/63-agenthost-icode-provider.patch
git commit -m "feat(agenthost): wire iCode approvals, cancellation and process exit"
```

---

## Task 7: 注册 provider、生成 62 号补丁并跑 P3 验收

**Files:**
- Modify: `vscode/src/vs/platform/agentHost/node/agentHostMain.ts`
- Modify: `vscode/src/vs/platform/agentHost/node/agentHostServerMain.ts`
- Modify: `build/patches/apply-list.txt`
- Modify: `build/patches/README.md`
- Modify: `docs/design.md`、`docs/roadmap.md`、`website/docs/index.md`
- Test: 手动验收（无自动化）

**Interfaces:**
- Consumes: `IcodeAgent`、`resolveIcodeCommand`、`isAgentEnabled`（`common/agentService.js`，签名以 Task 2 Step 0 的 grep 结果为准）。
- Produces: 打包产物在 `icode` 可用时自动注册唯一 provider；P3 验收结论。

- [ ] **Step 1: 在两个入口注册（同样的门控）**

先在各文件**已有的 import 区**添加（不要写在插入块里；文件若已从 `fs` 导入过东西，合并进现有 import，避免重复 import）：

```ts
import { statSync } from 'fs';
import { isAgentEnabled } from '../common/agentService.js';
import { IcodeAgent } from './icode/icodeAgent.js';
import { resolveIcodeCommand } from './icode/icodeLaunchConfig.js';
```

然后在两个入口各插入同一个块。`agentHostMain.ts` 的锚点是 `runtimeServices` 对象字面量（含 `providerService`，约 `:128-137`）之后、`instantiationService.createInstance(AgentModelRefreshScheduler, …)`（约 `:156`）之前；`agentHostServerMain.ts` 按同样语义就近插入：

```ts
const icodeIsFile = (path: string) => {
	try { return statSync(path).isFile(); } catch { return false; }
};
const icodeCommand = resolveIcodeCommand(process.env, icodeIsFile, process.platform);
if (icodeCommand && isAgentEnabled(process.env['PICKET_ICODE_AGENT_ENABLED'], true)) {
	providerService.registerProvider(instantiationService.createInstance(IcodeAgent));
	logService.info(`[AgentHost] iCode provider registered (${icodeCommand})`);
} else {
	logService.info(`[AgentHost] iCode provider not registered (command=${icodeCommand ?? 'missing'}, enabled=${process.env['PICKET_ICODE_AGENT_ENABLED'] ?? 'default'})`);
}
```

注意：
- 用 `statSync(...).isFile()` 而不是 `existsSync`——`existsSync` 对目录也返回真，会让 `PATH` 上的同名目录被当成可执行文件。
- `agentHostMain.ts` 按源码现状没有独立的 provider 注册块，`runtimeServices` 里已经有 `providerService`；不要新造解构。
- `agentHostServerMain.ts` 的 `enableMockAgent` 分支保持原样，不要把它变成默认路径。

- [ ] **Step 2: 编译并跑本计划全部测试**

```bash
cd /home/dsun/workspace/picket-code/vscode
./node_modules/.bin/tsc -p src/tsconfig.json --noCheck --outDir out --rootDir src
npm run test-node -- --run src/vs/platform/agentHost/test/node/icode/icodeAcpClient.test.ts --run src/vs/platform/agentHost/test/node/icode/icodeLaunchConfig.test.ts --run src/vs/platform/agentHost/test/node/icode/icodeMapEvents.test.ts --run src/vs/platform/agentHost/test/node/icode/icodeAgent.test.ts
```

Expected: 全部 PASS（22 passing：4 + 6 + 5 + 7）。随后按 Step 5 的类型检查门禁跑一遍，`agentHost/(test/)?node/icode` 无输出。

- [ ] **Step 3: 生成并验证 62 号补丁**

```bash
cd /home/dsun/workspace/picket-code/vscode
git add -N src/vs/platform/agentHost/node/icode src/vs/platform/agentHost/test/node/icode   # 新文件必须 -N 才进 diff
git diff HEAD > ../build/patches/63-agenthost-icode-provider.patch
git apply -R --check ../build/patches/63-agenthost-icode-provider.patch   # 反向必须干净
cd ..
rm -rf /tmp/vscode-verify
git clone --depth 1 --branch 1.143.1 https://github.com/microsoft/vscode.git /tmp/vscode-verify
bash build/apply-patches.sh /tmp/vscode-verify                            # 先把 62 加进 apply-list 再跑
```

在 `build/patches/apply-list.txt` 末尾追加 `63-agenthost-icode-provider.patch`，并在 `build/patches/README.md` 的表格中新增一行（Kind: git apply；Status: ENABLED — iCode provider，含 ACP 客户端/事件映射/注册/测试）。注意 `build/apply-patches.sh` 只做 product.json 合并、`*.json` 移除与逐条 `git apply`，**不会 commit**，所以 diff 必须在 `git add -N` 之后取。

Expected: `==> [picket-code] All patches applied.`，且 `git apply --check` 无错误。

- [ ] **Step 4: 手动 P3 验收（离线 mock 模型）**

```bash
mkdir -p /tmp/icode-home/.chrys/models
printf 'id: mock\nname: Mock\nprovider: mock\nmodel_id: m1\nmax_context_tokens: 100000\nstream: false\n' > /tmp/icode-home/.chrys/models/mock.yaml
printf 'model:\n  profile:\n    active: mock\n' > /tmp/icode-home/.chrys/settings.yaml

cd /home/dsun/workspace/picket-code/vscode
HOME=/tmp/icode-home PICKET_ICODE_BIN=/home/dsun/.local/bin/icode \
  node scripts/code-agent-host.js --port 8082 --without-connection-token --log trace
```

另开终端启动 workbench（同 Task 1 Step 4），把 `chat.remoteAgentHosts` 改为 `{ "name": "icode", "address": "127.0.0.1:8082" }`。Expected:
- 日志出现 `Registering agent provider: icode`（`agenthost-server.log`）。
- 面板 agent 选择器出现 `iCode`。
- 发 `hello`，回复 `[No more scripted responses]`，turn 正常结束（无错误横幅）。
- 再点一次发送并在运行中点停止：turn 以取消结束，面板不卡在“运行中”（对应 Task 6 的 `session/cancel` 路径）。

- [ ] **Step 5: 更新文档**

- `docs/design.md` §6.3：把四件套里的 `icodeAppServerClient.ts` 改名为计划实际使用的 `icodeAcpClient.ts`，并补上 `icodeLaunchConfig.ts` / `icodeMapEvents.ts` / `icodeAgent.ts` 的职责一句话说明。
- `docs/design.md` §6.4：把「P4 需 iCode 新增 app-server」改为「2026-10-31 复核：iCode 自带 `icode acp`（ACP v1，NDJSON），P3/P4 改为 ACP 客户端适配，不再需要 iCode 侧新增 app-server」；K6 行同步改状态。
- `docs/design.md` §8：P2.5/P3 行改为「已通过（日期）」，从「待验证项」移除面板渲染。
- `docs/roadmap.md` 第 2 行状态改为「P2.5/P3 已完成（日期），P4 待做」。
- `website/docs/index.md` 中「iCode 适配器尚未实现」改为「iCode 经 ACP 接入（P3）」。

- [ ] **Step 6: 提交**

```bash
cd /home/dsun/workspace/picket-code
bash build/check-contract.sh
git add build/patches/63-agenthost-icode-provider.patch build/patches/apply-list.txt build/patches/README.md docs/design.md docs/roadmap.md website/docs/index.md
git commit -m "feat(agenthost): register iCode as the only agent provider"
```

Expected: `release contract check passed`，提交成功。

---

## Self-Review Notes

- **Spec coverage:** §6.1 注册点 → Task 7；§6.2 补丁机制 → Task 1/7；§6.3 四件套 → Task 2–5；§6.4 app-server 前提 → Task 7 文档修正；§6.5 UI 路线 → Task 1 门；§8 P2.5/P3 验证门 → Task 1/7。
- **明确不做（P4）:** diff 预览（iCode 直接改工作区，不走 ACP diff）、多轮增量上下文复用之外的会话恢复（`session/load`）、`ask_user` 映射（`_chrys/request_input`）、模型目录动态刷新、Windows 真机冒烟（连启动都显式拒绝）。
- **已知取舍:**
  - provider 只在 `icode` 可解析时注册，宁可没有 agent 也不注册一个必然失败的 provider。
  - 审批模式固定 manual，Picket 的无头 exit-bypass 红线不进入适配器。
  - 不发 `initialize`：不做能力协商，版本不兼容走 `session/new` 的错误路径暴露。
  - 单 turn fail-fast：并发发送直接报错，不排队、不自动 `session/cancel` 前一个 turn。
  - Windows 上解析得到 `icode.cmd` 但拒绝 spawn（Node 禁止无 shell spawn `.cmd`），P3 只验收 POSIX。
  - `usage_update`（只有 `used`/`size`）不映射为 token 用量；`ChatUsage` 只在 `session/prompt` 的 `result.usage` 带数字字段时发，字段缺失就跳过。
  - 工具结果优先取结构化 `content` 的 text block，其次 `rawOutput`；图像/资源类 block 一律丢弃。
