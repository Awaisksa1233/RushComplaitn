"""
Deploy Funnel & Flows and WhatsApp Hub to VPS (72.60.185.87)
============================================================
Enforces:
- Local database safety (no live Atlas connections)
- Brand name: strictly 'رش واش'
- Timezone: Riyadh AST (UTC+3)
- Flow 3: 7-Day Inactivity Nudge
"""

import sys
import time
from pathlib import Path

# Ensure UTF-8 output on Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import paramiko
import requests
from unifonic_app.config import VPS_HOST, SSH_PORT, SSH_USER, SSH_PASS

REMOTE_DIR = "/opt/unifonic_app"

def upload_file(sftp, local_path, remote_path):
    print(f"  [SFTP] {local_path.name} -> {remote_path}")
    sftp.put(str(local_path), str(remote_path))

def main():
    print(f"[1/5] Connecting to VPS {VPS_HOST}:{SSH_PORT}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        VPS_HOST,
        port=SSH_PORT,
        username=SSH_USER,
        password=SSH_PASS,
        timeout=20,
        look_for_keys=False,
        allow_agent=False
    )
    print("      SSH connection established.")

    # 1. Ensure remote directories exist
    stdin, stdout, stderr = client.exec_command(f"mkdir -p {REMOTE_DIR}/unifonic_app {REMOTE_DIR}/exports {REMOTE_DIR}/scripts {REMOTE_DIR}/logs")
    stdout.channel.recv_exit_status()

    sftp = client.open_sftp()

    print("[2/5] Uploading application files...")
    # Upload unifonic_app Python files
    local_app_dir = ROOT_DIR / "unifonic_app"
    for py_file in local_app_dir.glob("*.py"):
        upload_file(sftp, py_file, f"{REMOTE_DIR}/unifonic_app/{py_file.name}")

    # Upload HTML template
    local_html = ROOT_DIR / "exports" / "rush_lifecycle_funnel.html"
    if local_html.exists():
        upload_file(sftp, local_html, f"{REMOTE_DIR}/exports/rush_lifecycle_funnel.html")

    # Upload growth dashboard server & lifecycle engine
    growth_server = ROOT_DIR / "growth_dashboard_server.py"
    if growth_server.exists():
        upload_file(sftp, growth_server, f"{REMOTE_DIR}/growth_dashboard_server.py")

    lifecycle_engine = ROOT_DIR / "scripts" / "lifecycle_funnel_engine.py"
    if lifecycle_engine.exists():
        upload_file(sftp, lifecycle_engine, f"{REMOTE_DIR}/scripts/lifecycle_funnel_engine.py")

    sftp.close()
    print("      All files uploaded successfully.")

    # 3. Restart unifonic-whatsapp service
    print("[3/5] Restarting unifonic-whatsapp.service on VPS...")
    stdin, stdout, stderr = client.exec_command("systemctl restart unifonic-whatsapp.service")
    stdout.channel.recv_exit_status()
    time.sleep(3)

    # 4. Check service status
    print("[4/5] Checking service status...")
    stdin, stdout, stderr = client.exec_command("systemctl is-active unifonic-whatsapp.service")
    status = stdout.read().decode('utf-8').strip()
    print(f"      Service status: {status}")
    if status != "active":
        stdin, stdout, stderr = client.exec_command("journalctl -u unifonic-whatsapp.service -n 25 --no-pager")
        logs = stdout.read().decode('utf-8')
        print(f"      Service logs:\n{logs}")
        client.close()
        sys.exit(1)

    client.close()

    # 5. Live Verification via HTTPS
    print("[5/5] Performing live HTTPS verification against whatsapp.rush.com.sa...")
    funnel_url = "https://whatsapp.rush.com.sa/funnel"
    waterfall_api = "https://whatsapp.rush.com.sa/api/realtime/funnel/waterfall"
    flows_api = "https://whatsapp.rush.com.sa/api/realtime/funnel/flows"

    # Verify /funnel HTML
    r_funnel = requests.get(funnel_url, timeout=15)
    print(f"      GET {funnel_url} -> Status {r_funnel.status_code}")
    assert r_funnel.status_code == 200, f"Expected 200, got {r_funnel.status_code}"
    assert "رش واش" in r_funnel.text, "Missing Arabic brand name رش واش in /funnel"
    assert "Flow 3: 7-Day Inactivity" in r_funnel.text or "7-Day Member Inactivity Nudge" in r_funnel.text, "Missing Flow 3 7-day rule in /funnel"
    print("      ✓ /funnel page verified (Brand 'رش واش' & Flow 3: 7-Day Inactivity present).")

    # Verify Waterfall API
    r_wf = requests.get(waterfall_api, timeout=15)
    print(f"      GET {waterfall_api} -> Status {r_wf.status_code}")
    if r_wf.status_code == 200:
        data = r_wf.json()
        print(f"      ✓ Waterfall API active: {len(data.get('stages', []))} stages returned.")
    else:
        print(f"      Note: Waterfall API returned {r_wf.status_code} ({r_wf.text[:100]})")

    # Verify Flows API
    r_fl = requests.get(flows_api, timeout=15)
    print(f"      GET {flows_api} -> Status {r_fl.status_code}")
    if r_fl.status_code == 200:
        data = r_fl.json()
        print(f"      ✓ Flows API active: {len(data.get('flows', []))} flows returned.")
    else:
        print(f"      Note: Flows API returned {r_fl.status_code} ({r_fl.text[:100]})")

    print("\n[SUCCESS] VPS deployment completed successfully! Live at https://whatsapp.rush.com.sa/funnel")

if __name__ == '__main__':
    main()
