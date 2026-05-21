# inspect_comfyui_workflow example

Tool call:
```json
{"workflow_name":"example-workflow"}
```

Expected result:
- workflow_file_path
- total_node_count
- nodes with node_id/class_type/title/likely_roles/inputs_keys

Common mistakes:
- workflow file missing in workflows_dir
- invalid JSON workflow export
