"""
Check rush-funnel-node service status and logs on VPS
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
        "systemctl status rush-funnel-node.service --no-pager",
        "journalctl -u rush-funnel-node.service -n 25 --no-pager",
        "ss -tulpn | grep 3001 || true"
    ]
    for c in cmds:
        print(f"=== {c} ===")
        stdin, stdout, stderr = client.exec_command(c)
        print(stdout.read().decode('utf-8'))

    client.close()

if __name__ == '__main__':
    main()
