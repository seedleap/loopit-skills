# 观察力Agent 审查与回传合同

仅在观察力Agent提供本次冻结快照和专用 `submit_review_report` 工具时适用。仅当使用者或宿主当次明确授权时，才在匹配的 Codex 工程建立审查及回传链路；本包不自动假设入口按钮授予权限，不授权修复、执行测试/构建、操作设备/服务、修改 Skill、提交或推送。

## 输入与审查

- `snapshot.json` 为本次不可替换的业务/辅助代码快照。只审查其中全部文件和 hunk；`head/base/target/scope/fingerprint` 定义范围。`before_lines/after_lines=null` 表示宿主未采集整文件总行数，不是零行。
- `review-template.json` 来自既有 `collect_diff.review_form`，只作为人工填写起点。按 [报告数据合同](report-data.md)、[重点合同](focus-review.md)、[危险系数](risk-scoring.md) 补齐文件/hunk说明、需求依据、最小性、作用域、评分、关系及问题。
- `test-change-stats.json` 只含测试路径与增删行数。测试源码、脚本及专属支撑跳过审查，不读取测试 diff，不评分、不推断测试覆盖或通过。
- 全部纳入审查的非测试记录均须完成实质审查。无确认问题不等于放行；未执行的设备/UI、测试和外部结果就近注明，不伪造验证。
- 源码仍可能变化。以只读 `git show` 等核对正确版本、调用者和清理链；新上下文无法与冻结快照对应时，明确证据缺口，不把新代码混进旧结论。不得重新采集、替换或修改冻结快照。

## 回传

完成后调用专用工具：

```json
{
  "task_id": "会话输入中提供的任务 UUID",
  "fingerprint": "会话输入中提供的观察力Agent来源指纹",
  "review": {
    "version": 1,
    "snapshot_fingerprint": "snapshot.json 内的 fingerprint",
    "title": "中文标题",
    "goal": ["逐项用户目标"],
    "summary": "真实审查结论",
    "files": {},
    "issues": [],
    "sections": [],
    "validations": [],
    "focus_review_html": "人工提炼的重点；保留真实问题与缺口",
    "change_relations": []
  }
}
```

示例不是完整报告，不能照抄空对象提交。`files` 按快照 `F001` 等身份填写全部非测试文件，每个 `hunks` 包含对应全部 hunk；完整字段以既有数据合同为准。单一范围的关系阶段使用 `final`，不虚构 commit 或修复关系。测试统计在独立紧凑区域显示，不能并入业务审查。

宿主先核对任务/会话和双重指纹，再运行原有 `render_compact_report.py` 正式验证与渲染。校验失败时工具返回具体错误，修正审查 JSON 后重新提交；不得降级成草稿或填虚假评分使校验通过。宿主在仓外保存 `review.json` 与 `审查报告.html`，模型无需文件写权限。

只有工具返回 `success=true` 才可称“已回传”。回传后用简短中文给出结论和报告位置；若工具不可用、身份不符或校验持续失败，明确标为未完成，不用最终聊天正文冒充回传。源代码变化后的“已过期”状态由观察力Agent按当前快照校验，历史报告仍保留原身份。
