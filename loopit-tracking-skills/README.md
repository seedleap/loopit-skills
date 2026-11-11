# Loopit Skills

本仓库收录 Loopit 埋点从方案、代码到验收的可复用 Skills。每个 Skill 都能独立安装，也可以按完整交付链一起安装。

## 目录

- `skills/loopit-tracking-plan` 将 PRD 转成 TE 埋点方案，完成事件、属性、统计口径和复用判断。
- `skills/loopit-tracking-implementation` 根据已确认方案落地 RN、Native、H5 或服务端埋点代码。
- `skills/loopit-tracking-acceptance` 按场景核对触发、载荷、TEA 收件和业务终态，输出验收证据。

三个 Skill 的边界分别对应设计、实现和证据验收。实现 Skill 不替代方案口径，验收 Skill 不把静态代码结果写成线上收件结论。

## 命令行安装

安装单个 Skill 时选择对应目录：

```text
$skill-installer install https://github.com/seedleap/loopit-skills/tree/main/loopit-tracking-skills/skills/loopit-tracking-plan
```

安装整条埋点链时，可使用 Codex 的 GitHub 安装脚本并重复传入 `--path`：

```text
python3 <codex-skill-installer>/install-skill-from-github.py \
  --repo seedleap/loopit-skills \
  --path loopit-tracking-skills/skills/loopit-tracking-plan \
  --path loopit-tracking-skills/skills/loopit-tracking-implementation \
  --path loopit-tracking-skills/skills/loopit-tracking-acceptance
```

正式使用时建议通过 `--ref` 固定发布 tag，避免直接跟随 `main` 的内容变化。

## 开发约定

- 每个 Skill 的入口必须是自己的 `SKILL.md`，所需参考文件放在该 Skill 的 `references/` 内。
- 方案、代码和验收之间通过明确的埋点契约传递，不能用上一个阶段的推测代替当前证据。
- 真实凭据、个人工作区路径和生产数据不得提交到仓库。
- 结构校验运行 `python3 tests/validate_structure.py`。
