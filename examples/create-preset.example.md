# create_preset_from_workflow example

Dry run:
```json
{"workflow_name":"example-workflow","preset_name":"my-image-preset","target_type":"image","confirm":false}
```

Create file:
```json
{"workflow_name":"example-workflow","preset_name":"my-image-preset","target_type":"image","confirm":true}
```

Common mistakes:
- invalid preset name characters
- trying to overwrite an existing preset
