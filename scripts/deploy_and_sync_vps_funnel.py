"""
Deploy updated server/funnel.js and sync Free Wash Funnel to VPS (Port 27018)
Timestamps in Riyadh Time (AST).
"""

import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import paramiko
from unifonic_app.config import VPS_HOST, SSH_PORT, SSH_USER, SSH_PASS

AST_TZ = timezone(timedelta(hours=3))

def main():
    now_ast = datetime.now(timezone.utc).astimezone(AST_TZ)
    print(f"[*] Starting VPS Deployment & Funnel Sync at {now_ast.strftime('%Y-%m-%d %I:%M:%S %p AST')}")

    # 1. Connect
    print(f"[*] Connecting to {VPS_HOST}:{SSH_PORT}...")
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
    print("[+] SSH Connected.")

    sftp = client.open_sftp()

    # 2. Backup current server/funnel.js on VPS
    ts = now_ast.strftime('%Y%m%d_%H%M%S')
    backup_cmd = f"cp /opt/rush-funnel-node/server/funnel.js /opt/rush-funnel-node/server/funnel.js.bak_{ts}"
    stdin, stdout, stderr = client.exec_command(backup_cmd)
    stdout.channel.recv_exit_status()
    print(f"[+] Backup created: /opt/rush-funnel-node/server/funnel.js.bak_{ts}")

    # 3. Upload updated server/funnel.js
    local_funnel_js = ROOT_DIR / "server" / "funnel.js"
    sftp.put(str(local_funnel_js), "/opt/rush-funnel-node/server/funnel.js")
    print("[+] Uploaded server/funnel.js to /opt/rush-funnel-node/server/funnel.js")

    # 4. Upload sync script and data files to /tmp/
    remote_sync_script = "/tmp/sync_freewash_funnel_to_funnel_db.py"
    remote_sent_csv = "/tmp/portal_freewash_sent_log.csv"
    remote_track_csv = "/tmp/portal_freewash_tracking_ledger.csv"

    # Make remote script self-contained with /tmp paths
    with open(ROOT_DIR / "scripts" / "sync_freewash_funnel_to_funnel_db.py", "r", encoding="utf-8") as f:
        script_content = f.read()

    # Replace path references for remote run
    script_content = script_content.replace(
        'SENT_LOG_CSV = ROOT_DIR / "exports" / "portal_freewash_sent_log.csv"',
        'SENT_LOG_CSV = Path("/tmp/portal_freewash_sent_log.csv")'
    ).replace(
        'TRACKING_LEDGER_CSV = ROOT_DIR / "exports" / "portal_freewash_tracking_ledger.csv"',
        'TRACKING_LEDGER_CSV = Path("/tmp/portal_freewash_tracking_ledger.csv")'
    )

    with sftp.file(remote_sync_script, "w") as f:
        f.write(script_content)

    sftp.put(str(ROOT_DIR / "exports" / "portal_freewash_sent_log.csv"), remote_sent_csv)
    sftp.put(str(ROOT_DIR / "exports" / "portal_freewash_tracking_ledger.csv"), remote_track_csv)
    print("[+] Uploaded sync script and CSV data files to VPS /tmp/")

    sftp.close()

    # 5. Run sync on VPS against port 27018
    print("[*] Running sync on VPS against port 27018...")
    sync_cmd = "/opt/unifonic_app/venv/bin/python /tmp/sync_freewash_funnel_to_funnel_db.py \"mongodb://127.0.0.1:27018/rush_funnel\" \"VPS Port 27018 (rush_funnel)\""
    stdin, stdout, stderr = client.exec_command(sync_cmd)
    out = stdout.read().decode('utf-8')
    err = stderr.read().decode('utf-8')
    print("=== SYNC OUTPUT ===")
    print(out)
    if err:
        print("=== SYNC ERROR ===")
        print(err)

    # 6. Restart rush-funnel-node.service
    print("[*] Restarting rush-funnel-node.service...")
    stdin, stdout, stderr = client.exec_command("systemctl restart rush-funnel-node.service")
    stdout.channel.recv_exit_status()
    time.sleep(2)

    # 7. Check service status
    stdin, stdout, stderr = client.exec_command("systemctl status rush-funnel-node.service --no-pager")
    status_out = stdout.read().decode('utf-8')
    print("=== SERVICE STATUS ===")
    print("\n".join(status_out.splitlines()[:15]))

    client.close()
    print("[+] VPS Deployment & Sync Completed.")

if __name__ == "__main__":
    main()
