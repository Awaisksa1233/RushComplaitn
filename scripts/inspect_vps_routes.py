"""
Inspect VPS main.py routes
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
    
    cmd = 'grep -E "@app\\.(get|post)\\(" /opt/unifonic_app/unifonic_app/main.py'
    stdin, stdout, stderr = client.exec_command(cmd)
    routes = stdout.read().decode('utf-8')
    print("=== Routes in VPS main.py ===")
    for r in routes.splitlines():
        if any(k in r for k in ['funnel', 'growth', 'free', 'flow', 'realtime']):
            print(r)
    client.close()

if __name__ == '__main__':
    main()
