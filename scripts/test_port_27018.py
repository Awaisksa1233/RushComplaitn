"""
Test MongoDB connection to port 27018 on VPS (Read-only)
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
print('Databases on 27018:', client.list_database_names())
db = client['rush_funnel']
print('Collections in rush_funnel:', db.list_collection_names())
print('Funnel flows count:', db['funnel_flows'].count_documents({}))
for f in db['funnel_flows'].find({}, {'id': 1, 'name': 1, 'status': 1}):
    print(' Flow:', f)
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
