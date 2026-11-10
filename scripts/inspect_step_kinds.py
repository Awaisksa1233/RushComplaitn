"""
Inspect step.kind across all flows in rush_funnel
Timestamps in Riyadh Time (AST).
"""

import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import paramiko
from unifonic_app.config import VPS_HOST, SSH_PORT, SSH_USER, SSH_PASS

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(VPS_HOST, port=SSH_PORT, username=SSH_USER, password=SSH_PASS, timeout=15)
    
    cmd = """/opt/unifonic_app/venv/bin/python -c "
import pymongo
client = pymongo.MongoClient('mongodb://127.0.0.1:27018/', serverSelectionTimeoutMS=3000)
db = client['rush_funnel']
flows = list(db['funnel_flows'].find({}))
for f in flows:
    fid = f.get('id') or f.get('_id')
    steps = f.get('steps') or []
    for idx, s in enumerate(steps):
        if not isinstance(s, dict) or 'kind' not in s or not s.get('kind'):
            print(f'FLOW {fid} STEP {idx}: {s}')
"
"""
    stdin, stdout, stderr = client.exec_command(cmd)
    print(stdout.read().decode('utf-8'))
    err = stderr.read().decode('utf-8')
    if err:
        print("ERR:", err)

    client.close()

if __name__ == '__main__':
    main()
