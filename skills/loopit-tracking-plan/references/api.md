# TE OpenAPI Notes

Use these notes for read-only event/property discovery during tracking-plan drafting, or for explicitly requested metadata maintenance. Drafting authorizes relevant read-only checks, not metadata writes.

## Configuration

Read `thinkingdata.base_url`, `thinkingdata.token`, and `thinkingdata.project_id` from `~/.config/loopit/workspace.json` by default. See [workspace-config.md](workspace-config.md) for the schema and repository discovery rules.

Only when the file is absent or has no `thinkingdata` section, fall back to the complete environment-variable group `TEA_OPEN_BASE_URL`, `TEA_OPEN_TOKEN`, and `TEA_OPEN_PROJECT_ID`. Do not merge configuration sources. Malformed files or incomplete sections require correction, not silent fallback.

Stop before API usage if a required value is missing. Report missing key names only. Read secrets programmatically without displaying the file; never print authenticated URLs, tokens, raw request errors, or secret-bearing command arguments. The token may be stored in the private local configuration when explicitly authorized; do not copy it into skill files or other artifacts.

## Read Existing Events

Endpoint:

```text
GET {base_url}/open/list-event-meta?token={token}&projectId={project_id}&propName={prop_name}
```

`propName` is optional. When present, it queries events related to the property. When omitted, it returns all physical and virtual events.

Example success shape:

```json
{
  "data": {
    "events": [
      {
        "eventDesc": "参加活动",
        "eventName": "activity_attend",
        "eventType": "event",
        "isHide": false,
        "remark": "参加活动321"
      }
    ]
  },
  "return_code": 0,
  "return_message": "success"
}
```

Use this endpoint before proposing a new event when API access is available. Also query candidate reusable properties with `propName` before proposing a new property; for example, `propName=trigger_source`.

### Interpreting Property Lookups

- A successful response listing related events confirms current use of that property. It does not by itself establish its display name, data type, complete allowed values, or association with a different target event.
- Inspect actual metadata fields when returned, and relevant code definitions and emission sites for semantics and types. Mark anything still unverified rather than inferring a full schema from event names.
- An empty list, nonzero return code, permission failure, or network failure is not sufficient proof that a property does not exist. Report the observed limitation.
- Check transport mappings when borrowing code attributes: local code has a `trigger_source` to `tr_src` mapping. Its existence alone does not show which field reaches TE on every path. Distinguish code-side names and stored TE properties; avoid unintentionally creating a second property.
- Keep read-only discovery separate from changes to property metadata or shared enumerations. Follow the write-confirmation rules below only when an actual metadata write is requested.

Response fields observed in the source material:

| Field | Example | Type | Meaning |
| --- | --- | --- | --- |
| `data` | `-` | Object | Response data |
| `data.events` | `-` | List | Event list |
| `data.events[].eventDesc` | `参加活动` | String | Event display name |
| `data.events[].eventName` | `activity_attend` | String | Event name |
| `data.events[].eventType` | `event` | String | Event type |
| `data.events[].isHide` | `false` | Boolean | Whether the event is hidden |
| `data.events[].remark` | `参加活动321` | String | Event remark |
| `return_code` | `0` | Integer | Return code |
| `return_message` | `success` | String | Return message |

Property metadata rows in the event response may also include these field names. Preserve them when comparing existing TE metadata against a PRD:

| Field | Example | Type | Meaning |
| --- | --- | --- | --- |
| `propName` | `test` | String | Property/field name |
| `propDesc` | `testDesc` | String | Property display name |
| `propRemark` | `testRemark` | String | Property remark/description |
| `propType` | `prop_unpreset` | String | Property type |
| `selectType` | `string` | String | Filter value selector type |
| `tableType` | `event` | String | Table type the property belongs to |

Known `propType` values:

| Value | Meaning |
| --- | --- |
| `prop_preset` | Preset physical property |
| `prop_unpreset` | Custom physical property |
| `vprop_dict` | Dimension-table property based on a physical property |
| `vprop_sql` | Virtual property based on a physical property |
| `vprop_dict_v` | Dimension-table property based on a virtual property |
| `vprop_sql_v` | Virtual property based on a dimension-table property |

## Preset/System Properties

For ThinkingData preset and system fields, consult the official ThinkingData preset properties page if available:

```text
https://docs-v2.thinkingdata.cn/?version=v5.0&lan=zh-CN&code=preset_properties&anchorId=
```

## Update Event Display Name

Endpoint:

```text
POST {base_url}/open/update-event-info?token={token}&projectId={project_id}
Content-Type: application/json
```

Body:

```json
{
  "eventName": "test007",
  "eventDesc": "testDesc"
}
```

Constraints:

- Event display name max length is 60 characters; longer names may be truncated.
- Event display name cannot contain emoji.
- Virtual event display names cannot duplicate other virtual event display names or event names.
- Physical event display names cannot duplicate other physical event display names or event names.

## Update Property Display Name or Remark

Endpoint:

```text
POST {base_url}/open/update-prop-info?token={token}&projectId={project_id}
Content-Type: application/json
```

Body:

```json
{
  "columnName": "test",
  "columnDesc": "testDesc",
  "columnRemark": "testRemark",
  "tableType": "event"
}
```

Parameters:

- `columnName`: field/property name, required.
- `columnDesc`: display name, required.
- `columnRemark`: description/remark, optional.
- `tableType`: table type, required. Use `event` for event properties.

Constraints:

- Property display name max length is 60 characters and cannot contain emoji.
- Property remark max length is 200 characters.
- Virtual properties cannot duplicate other virtual property display names or property names.
- Physical properties cannot duplicate other physical property display names or property names.
- If a same-named virtual property already exists, the definition may be updated.

## Mutation Confirmation

Before either update endpoint:

1. Show the endpoint with `{token}` redacted.
2. Show the JSON body.
3. Explain the intended metadata change.
4. Ask for explicit confirmation.

Do not treat approval to draft a tracking plan as approval to call a write endpoint.
