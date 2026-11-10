"""
Check VPS deployments and running processes
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
    
    cmds = [
        "ls -la /opt/unifonic_app/",
        "ls -la /opt/unifonic_app/exports/ 2>/dev/null || true",
        "ls -la /opt/rush-funnel/ 2>/dev/null || true",
        "git -C /opt/rush-funnel log -1 --oneline 2>/dev/null || true"
    ]
    for cmd in cmds:
        print(f"=== {cmd} ===")
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode('utf-8'))

    client.close()

if __name__ == '__main__':
    main()
