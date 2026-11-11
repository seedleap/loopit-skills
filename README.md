# Loopit Skills

seedleap 的可复用 Agent Skills 总仓库。每个领域使用独立目录打包，当前包含：

- `loopit-tracking-skills`：Loopit 埋点方案设计、代码落地和自测验收。

领域目录内的 Skill 可以单独安装，也可以按该领域的完整工作流一起安装。新增其他有价值的 Skill 时，沿用同样的领域目录结构，避免把不同触发条件和权限边界塞进一个入口。

## 安装与自动更新

需要 Node.js ≥22.20 和 Git。在目标工程安装指定 Skill：

```sh
npx skills@1.8.1 add https://github.com/seedleap/loopit-skills/tree/skill-releases \
  --skill loopit-tracking-plan -a codex
```

加 `-g` 安装到用户级。其他 Skill 的安装方式见 [埋点 Skills](loopit-tracking-skills/README.md)。推荐使用 `skill-releases`：其中每个包都包含启动器、业务正文、参考文件和已打包的更新器，调用时无需 `npx` 或安装依赖。此前从 `main` 安装的静态版本需要用上述命令覆盖安装一次。

每次选用 Skill 时，Codex 按生成的 `SKILL.md` 执行 `scripts/entry.mjs`，读取回执中固定的 `workflowPath` 和 `resourcesRoot`。本次任务始终使用这个版本。入口立即启动一次性后台进程，只检查当前 Skill；校验并准备好新版后，后续调用从新快照开始。后台尚未完成时仍用旧版，断网、限流、包损坏或本地修改均保留已有文件。成功检查无通知。入口依赖宿主执行 Skill 指令与已有权限；`SessionStart` 不能替代逐次调用，宿主未执行入口时无法自动检查。

查看某个实际安装的 Skill 的当前版本、待更新版本和最近结果：

```sh
node <实际安装目录>/scripts/entry.mjs --status
```

状态按“实际安装目录 + Skill ID”存放于 `~/.local/state/loopit-skills/`，项目和全局同名安装互不影响。首次调用也先将干净的基础包固定到快照，旧快照目前保留以支持正在运行的任务。原安装目录保留稳定的极薄引导器，之后委托新版快照的前台与后台运行时。更新成功后，仅原子刷新未被用户修改的 `SKILL.md` 和 `agents/openai.yaml` 宿主发现信息；业务正文与资源始终从回执快照读取，旧快照不覆盖或删除。宿主已缓存的描述取决于其目录刷新时机，执行正文无需等待目录刷新。删除安装目录不会自动清理这些本地状态。

## 提交即发版

所有贡献者正常提交并 push 到 `main`，或合并到 `main` 即可。仅本地 commit 不触发 CI。其他分支和 PR 只校验，不发布。

- 第一次启用以首次引入发布工作流的 `main` 首父链提交为 `1.0.0` 基线，不重发之前的历史；后到的任务先运行也从相同基线补齐。
- 此后按 `main` 首父链逐 commit 处理：哪个 Skill 的完整目录有变化，就为哪个 Skill 增加一个 patch；一次 push 的多个 commit 分别计版。合并只按进入 `main` 的结果计一次。
- `runtime/client/`、`runtime/shared/`、打包实现或依赖锁变化时，所有依赖它们的 Skill 分别发版。根 README、发布历史调度和测试本身变化不增加业务版本。
- 单 Skill 校验失败保留上一稳定版，其他合法 Skill 继续发布；工作流报告失败项。基础设施失败不推进远端检查点。后续 push 或重跑会补齐未完成提交。
- 发布目标绑定本次通过运行时测试的 workflow SHA，不越过它发布后到但尚未通过测试的提交。
- `skill-releases` 分支保存完整包、`index/<Skill ID>.json` 描述和 `.release-state.json` 检查点。不可变 tag 如 `skill/loopit-tracking-plan/v1.0.1` 对应当时的完整包。输出分支和所有新 tag 原子推送，产物不回写 `main`。
- 发布流程仅使用 GitHub Actions 内置 `GITHUB_TOKEN` 的 `contents: write`。不需要服务器、PAT、手改版本号、changeset 或发布 PR。仓库若另加分支/tag 保护，需允许该工作流写发布引用。

Skill 的 `name` 是稳定身份，必须与目录名一致且全仓唯一。改名按新 Skill 发版，删除源码保留旧稳定产物，不删除使用者的安装。业务正文继续只在领域目录的 `SKILL.md` 维护；CI 生成 `workflow.md` 和启动入口，勿手改发布分支。所有本地引用必须在同一个 Skill 包内，符号链接和生成文件保留路径会被拒绝。

## 开发与验证

```sh
npm ci --ignore-scripts
npm run validate
npm test
```

`runtime/publish/` 负责发现、独立校验、打包、历史计版和 Git 发布；`runtime/client/` 负责固定快照、后台安装及原子切换；`runtime/shared/` 保存指纹和文件协议。运行时固定复用 [Vercel Skills 1.8.1 API](https://github.com/vercel-labs/skills/blob/e781cb4d07433dfe1d19e924ed45cc61738c55ec/docs/api.md)、`proper-lockfile` 和 `write-file-atomic`，发布包附第三方许可证。Skills API 只在独立暂存目录安装，明确指定当前 Skill，校验安装路径、版本、源 commit、tag 和完整包指纹后切换。

自动测试使用临时真实 Git 仓库和本地 HTTP 服务，覆盖逐提交发版、幂等恢复、历史包、延迟网络、只更新 A、并发锁、安装隔离及失败保留。CI 验证 Node 22.20 和 24；业务工程、TE/飞书授权、设备运行与 TEA 收件不在这些测试结论内。真实 Codex 的逐次入口回放需单独记录。

维护排障可设置 `LOOPIT_SKILLS_STATE_DIR` 改变状态根目录，`LOOPIT_SKILLS_RELEASE_BASE_URL` 改变发布描述镜像（默认当前仓库的原始文件地址），`LOOPIT_SKILLS_TIMEOUT_MS` 设置单次后台截止时间（100–300000 毫秒，默认 60000）。这些设置不改变包内固定的来源仓库或不可变 tag；只用于明确配置的环境，不会增加常驻服务。
