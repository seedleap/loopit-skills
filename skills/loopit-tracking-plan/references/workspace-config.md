# 本地工作区配置

默认位置：`~/.config/loopit/workspace.json`。这是本机私有配置，不随代码或 skill 分发。

```json
{
  "repositories": {
    "frontend": "/absolute/path/to/frontend",
    "backend": "/absolute/path/to/backend"
  },
  "thinkingdata": {
    "base_url": "https://your-te-host",
    "token": "{token}",
    "project_id": "your-project-id"
  }
}
```

- 仓库：本次任务指定的仓库或工作树优先，否则读取上述路径。按需核实目录、仓库身份和分支，并遵循适用的 `AGENTS.md`；配置路径不代表授权修改代码，也不证明代码已部署。
- TE：优先使用完整 `thinkingdata` 节。仅当文件不存在或该节不存在时，整组回退到 `TEA_OPEN_BASE_URL`、`TEA_OPEN_TOKEN`、`TEA_OPEN_PROJECT_ID`。不逐字段混用；JSON 损坏、节类型错误、字段缺失或空值时报告问题，不调用 API。project_id 可为字符串或数字，调用时按 API 参数序列化。
- 只读取需要的字段，不用 `cat`、环境变量转储或调试日志显示实际配置；请求在进程内组装，不将 token 展开到 shell 命令参数。异常输出需去除 token 和含认证参数的 URL。
- 配置目录权限 `0700`，文件权限 `0600`。仅在用户明确请求时创建或更新配置；保留无关键，不自动删除原有环境变量。不得将真实凭据复制到引用文档、仓库、产物或回答。
- 此文件提供连接与定位信息；TE 元数据写入仍遵守 `api.md` 的变更确认规则。
