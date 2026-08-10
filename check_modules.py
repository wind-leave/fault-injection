import json, os
data=json.load(open(r'backend/builtin_modules/manifest.json'))
missing=[m['moduleId'] for m in data['modules'] if not os.path.exists(f'backend/builtin_modules/{m["importPath"].split(".")[-1]}.py')]
print('Missing:', missing) if missing else print('All modules present')
