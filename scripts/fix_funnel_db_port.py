"""
Fix MONGO_FUNNEL_URI port to 27018 on VPS
Timestamps in Riyadh Time (AST).
"""

import sys
import time
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import paramiko
import requests
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

    env_content = """PORT=3001
MONGODB_URI=mongodb://127.0.0.1:27017/rushwash
DB_NAME=rushwash
MONGO_FUNNEL_URI=mongodb://127.0.0.1:27018/rush_funnel
NODE_ENV=production
"""
    sftp = client.open_sftp()
    with sftp.file("/opt/rush-funnel-node/.env", "w") as f:
        f.write(env_content)
    sftp.close()
    print("Updated /opt/rush-funnel-node/.env with port 27018.")

    stdin, stdout, stderr = client.exec_command("systemctl restart rush-funnel-node.service")
    stdout.channel.recv_exit_status()
    time.sleep(2)

    stdin, stdout, stderr = client.exec_command("systemctl is-active rush-funnel-node.service")
    status = stdout.read().decode('utf-8').strip()
    print(f"Service status: {status}")

    client.close()

    # Verify live API response
    api_flows_url = "https://whatsapp.rush.com.sa/api/funnel/flows"
    r = requests.get(api_flows_url, timeout=10)
    print(f"GET {api_flows_url} -> Status {r.status_code}")
    data = r.json()
    source = data.get('data', {}).get('source')
    flows = data.get('data', {}).get('flows', [])
    print(f"Source: {source} (expected 'live')")
    print(f"Flows count: {len(flows)}")
    if source == 'live':
        print("[SUCCESS] Funnel database is now REACHABLE and LIVE! Flows can be edited.")
    else:
        print("[WARNING] Still returning source:", source)

if __name__ == '__main__':
    main()
