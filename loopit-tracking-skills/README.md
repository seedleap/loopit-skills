# Loopit Skills

本仓库收录 Loopit 埋点从方案、代码到验收的可复用 Skills。每个 Skill 都能独立安装，也可以按完整交付链一起安装。

## 目录

- `skills/loopit-tracking-plan` 将 PRD 转成 TE 埋点方案，完成事件、属性、统计口径和复用判断。
- `skills/loopit-tracking-implementation` 根据已确认方案落地 RN、Native、H5 或服务端埋点代码。
- `skills/loopit-tracking-acceptance` 按场景核对触发、载荷、TEA 收件和业务终态，输出验收证据。

三个 Skill 的边界分别对应设计、实现和证据验收。实现 Skill 不替代方案口径，验收 Skill 不把静态代码结果写成线上收件结论。

## 命令行安装

需要 Node.js 和 npm。在目标工程目录运行以下命令，安装单个 Skill 到 Codex 的项目级目录：

```sh
npx skills add seedleap/loopit-skills --skill loopit-tracking-plan -a codex
```

一次安装三个埋点 Skill：

```sh
npx skills add seedleap/loopit-skills \
  --skill loopit-tracking-plan loopit-tracking-implementation loopit-tracking-acceptance \
  -a codex
```

加 `-g` 安装到用户级，供多个工程使用。先查看可安装技能可运行 `npx skills add seedleap/loopit-skills --list`。

上述命令使用 [Vercel Skills CLI](https://github.com/vercel-labs/skills)。也可在 Codex 中要求内置 `$skill-installer` 安装具体目录链接，例如 `https://github.com/seedleap/loopit-skills/tree/main/loopit-tracking-skills/skills/loopit-tracking-plan`。

安装 Skill 不包含 TEA 或飞书授权。方案 Skill 的连接和仓库位置配置见其 `references/workspace-config.md`。实现和验收可直接接收用户提供的方案、仓库、载荷和查询证据，缺失外部权限时保留相应未验证项。

## 开发约定

- 每个 Skill 的入口必须是自己的 `SKILL.md`，所需参考文件放在该 Skill 的 `references/` 内。
- 方案、代码和验收之间通过明确的埋点契约传递，不能用上一个阶段的推测代替当前证据。
- 真实凭据、个人工作区路径和生产数据不得提交到仓库。
- 结构校验运行 `python3 tests/validate_structure.py`。

## 验证范围

结构测试检查每个独立安装单元的入口与本地引用文件。它不验证真实业务代码、设备运行态、TEA 收件或模型在新任务中的稳定性。新增的实现和验收 Skill 需要继续通过实际需求回放迭代。
