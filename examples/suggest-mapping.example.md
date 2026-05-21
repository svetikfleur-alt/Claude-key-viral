# suggest_workflow_mapping example

Tool call:
```json
{"workflow_name":"example-workflow","target_type":"image"}
```

Expected result:
- suggested mapping object
- confidence by field
- warnings and unmapped fields

Common mistakes:
- expecting perfect heuristics for all custom nodes
