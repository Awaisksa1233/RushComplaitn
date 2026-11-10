"""
Inspect VPS web services and virtualhosts (Read-Only)
Timestamps in Riyadh Time (AST).
"""

import sys
from pathlib import Path

# Ensure UTF-8 output on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import paramiko
from unifonic_app.config import VPS_HOST, SSH_PORT, SSH_USER, SSH_PASS

def main():
    print(f"Connecting to VPS {VPS_HOST}:{SSH_PORT}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        VPS_HOST,
        port=SSH_PORT,
        username=SSH_USER,
        password=SSH_PASS,
        timeout=15,
        look_for_keys=False,
        allow_agent=False
    )
    print("Connected.")

    cmds = [
        ("Systemctl status of relevant services", "systemctl list-units --type=service --state=running | grep -E 'unifonic|rush|funnel|apache|nginx' || true"),
        ("Listening ports", "ss -tulpn | grep -E '8090|3000|3001|3010|4000|80|443' || true"),
        ("Apache/Nginx virtual hosts for whatsapp.rush.com.sa", "grep -rn 'whatsapp.rush.com.sa' /etc/apache2/ /etc/nginx/ 2>/dev/null || true"),
        ("Directory /opt/ contents", "ls -la /opt/"),
    ]

    for title, cmd in cmds:
        print(f"\n--- {title} ---")
        stdin, stdout, stderr = client.exec_command(cmd)
        out = stdout.read().decode('utf-8', errors='ignore').strip()
        print(out)

    client.close()

if __name__ == '__main__':
    main()
