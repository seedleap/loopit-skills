# 案例与应用边界

用于理解规则，不直接当作其他需求的固定模板。以下搜索值来自 2026-10-12 的需求讨论；属性存在、具体取值和采集点上线状态需分别核实。

## 搜索页面及来源

- 本次代码核查的普通搜索入口、评论浮层搜索入口均属于 Explore，入口采集明确 `page_id=explore_page`，不能写“如 explore_page”。其他需求有不同入口时重新核对。
- 搜索首页 `search_page`、搜索结果页 `search_result_page` 是本次拟定统计页面；`hashtag_page` 是已有标识。All、Playables、Users 在此方案按结果模块划分，此划分不是所有 Tab 的强制规则。
- Explore → 搜索首页 → 搜索结果：搜索首页事件 `source=explore_page`；结果页事件 `source=search_page`。返回、重进等路径须另行明确，不能把同一 source 固定套在所有路径。
- `trigger_source` 于 2026-10-12 已通过 TE 属性关联查询确认存在，关联 IM 等事件；此证据不证明下面取值已经上线。

| 本场景拟定 trigger_source | 含义 |
| --- | --- |
| `button` | 点击页面 Search 按钮提交 |
| `keyboard` | 点击键盘搜索/回车提交 |
| `history_item` | 点击历史记录直接发起搜索 |

历史点击如果仅回填，不算已发起搜索，以随后实际提交方式为准。结果页及结果条目携带此属性时，表示本次搜索的最初发起来源，不表示当前条目被点击的方式。不要为同一维度再建立 search_source 或 submit_method。

### trigger_source 的采集位置

| 事件位置 | 是否上报 trigger_source | 原因 |
| --- | --- | --- |
| Search 按钮曝光、点击 | 否 | `element_id=search_submit` 已识别操作 |
| History 单条记录曝光、点击 | 否 | `element_id=search_history_item` 已识别操作 |
| 键盘搜索提交 | 否 | `element_id=search_keyboard_submit` 已识别操作 |
| 搜索结果页曝光 | 是 | 按搜索发起方式比较结果到达 |
| 搜索结果 Tab、作品、用户事件 | 本案例保留 | 支持按最初发起方式分组分析；其他需求按实际指标决定 |

客户端在有效搜索发起时确定该值并传递给结果页，入口事件不重复上传。一次搜索内保持不变，新搜索重新确定，退出该搜索过程后不污染其他业务事件。

### 返回与曝光次数

本次历史草稿曾提出“返回保留状态不重计”和“返回视为新访问重计”两种建议，均不作为已确认的团队通用口径。新方案应明确选择及其指标影响；输入保留、组件未卸载本身不能决定是否计曝光。

## 实体绑定

| 采集位置 | entity_type | entity_id | 决策 |
| --- | --- | --- | --- |
| History 模块 | 不填 | 不填 | 模块位置由 module_id 标识 |
| History 单条记录 | `text` | 具体历史搜索词 | 本次建议实体口径；先核对共享枚举 |
| Discover 模块 | 不填 | 不填 | 不构造模块自身实体 |
| Discover 单条运营位 | `tag` | 对应标签，例 `#remix` | 本次讨论采用的口径；不是运营文案。代码已有 hashtag 用法时记录差异，不机械照搬或全局替换 |
| 搜索结果作品 | `project` | 作品 ID | 明确业务对象 |
| 搜索结果用户 | `user` | 被展示/访问的用户 ID | 核对共享枚举，区分当前登录用户 |

## 重要行为独立事件

搜索结果 Tab、作品、用户是重要分析对象，优先独立事件。以下为拟定名称，使用前查重；每个事件在正式方案中单独一行：

| 事件名 | 对象及行为 |
| --- | --- |
| `a_search_results_tab_exp` | Tab 按钮曝光 |
| `a_search_results_tab_clk` | Tab 按钮点击 |
| `a_search_results_project_exp` | 作品卡片曝光 |
| `a_search_results_project_clk` | 作品卡片点击 |
| `a_search_results_user_exp` | 用户条目曝光 |
| `a_search_results_user_clk` | 用户条目点击 |

Tab 按钮曝光不等于内容被浏览；默认选中和滑动切换不伪造点击。独立事件仍复用 module_id、entity_id、position 等合适属性。

## 新增与更新示例

以下是格式示例；未列出的 SDK 公共属性沿用已有约定。页面标识和 trigger_source 取值是本案例拟定，非上线证明。

| 方案时间 | 类型 | 埋点英文名称 | 埋点中文名 | 端 | 页面位置 | 触发时机 | 事件属性 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026.10.12 | 新增 | `a_page_exp` | 页面曝光 | 前端 | 搜索结果统计页面 | 本次有效搜索对应结果页面首次可见时 | `page_id`: string，`search_result_page`；`source`: string，`search_page`，限定从搜索首页进入；`trigger_source`: string，`button`、`keyboard`、`history_item`，从实际搜索提交处透传 | 复用事件名，新采集点仍为新增；完整列业务属性 |
| 2026.09.09 | 更新 | `element_exposure` | 元素曝光 | 前端 | 探索页 Play Tab Banner | 原有单 Banner 进入可视区域的时机不变 | 新增属性：`tags`，JSON 字符串；内部 `explore_play_banner_create_id`: string，运营配置的关联作品 ID | 仅在原曝光采集点已存在、本次只补染色时属于更新；参考历史案例，不据此认定当前 tags 仍需新增 |
| 2026.09.09 | 更新 | `element_click` | 元素点击 | 前端 | 探索页 Play Tab Banner | 原有单 Banner 点击时机不变 | 新增属性：`tags`，JSON 字符串；内部 `explore_play_banner_create_id`: string，运营配置的关联作品 ID | 与曝光分行；新增 Banner 采集点则应标新增并列完整属性 |

更多历史 H5 和引导方案通过 [source-docs.md](source-docs.md) 查阅。历史方案可能使用混合行为事件；它们不覆盖当前“重要行为独立事件、曝光点击分行”的设计规则。


## 2026-10-27 字段复用共识与代码核查

上述 2026-10-12 草稿保留其历史拟定状态；以下补充不等于 TE 枚举或线上入库已验证。

- 搜索结果代码定义 `a_search_results_project_clk`，搜索结果上下文使用 `tr_src`（文本），值为 `button`、`keyboard`、`history_item`。参考前端仓库 `src/features/search/tracking/searchTracking.ts` 的事件、SearchSubmission 与提交方式定义，以及 `useSearchTracking.ts` 的 createResultTracking。
- 新增搜索相关采集点若需要区分最初发起方式且语义一致，应标“采集点新增；属性 tr_src 复用”，注明上述参考事件/链路、类型和取值，不再为统一全称建立 trigger_source。入口是否上传仍按本文件的分析必要性规则判断。
- 假设需求要分析充值失败阶段，只有核查确认没有合适同义属性且确需看板分析时，才可拟新增全称 `recharge_failure_stage`，同时定义阶段和枚举。这只是说明命名规则的假设，不是已批准的 TE 属性；不把本例名称自动加入 IAP 清单。

涉及原作品归因、充值查单和权威结果时按需读取 [commerce-example.md](commerce-example.md)。
