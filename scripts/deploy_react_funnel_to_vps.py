"""
Deploy React Vite Frontend & Node Funnel Backend to VPS
======================================================
Ported from commit 3138e50 / 8b32873.
Rules Enforced:
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

REMOTE_APP_DIR = "/opt/rush-funnel-node"

def run_ssh(client, cmd, check=True):
    print(f"  [SSH] {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='ignore').strip()
    err = stderr.read().decode('utf-8', errors='ignore').strip()
    if out:
        for line in out.splitlines():
            print(f"    {line}")
    if check and exit_status != 0:
        raise RuntimeError(f"Command failed with exit code {exit_status}: {err}")
    return out

def upload_dir(sftp, local_dir, remote_dir):
    local_dir = Path(local_dir)
    for p in local_dir.rglob('*'):
        if p.is_file():
            rel_path = p.relative_to(local_dir)
            remote_file = f"{remote_dir}/{rel_path.as_posix()}"
            remote_parent = "/".join(remote_file.split("/")[:-1])
            try:
                sftp.stat(remote_parent)
            except IOError:
                parts = remote_parent.split("/")
                curr = ""
                for part in parts:
                    if not part:
                        curr = "/"
                        continue
                    curr = f"{curr}/{part}" if curr != "/" else f"/{part}"
                    try:
                        sftp.stat(curr)
                    except IOError:
                        sftp.mkdir(curr)
            print(f"  [SFTP] {p.name} -> {remote_file}")
            sftp.put(str(p), remote_file)

def main():
    print(f"[1/6] Connecting to VPS {VPS_HOST}:{SSH_PORT}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        VPS_HOST,
        port=SSH_PORT,
        username=SSH_USER,
        password=SSH_PASS,
        timeout=25,
        look_for_keys=False,
        allow_agent=False
    )
    print("      SSH connection established.")

    # 1. Create remote app directory
    run_ssh(client, f"mkdir -p {REMOTE_APP_DIR}/server {REMOTE_APP_DIR}/dist")

    # 2. Upload dist folder, server files, package.json
    print("[2/6] Uploading compiled React bundle and Node backend...")
    sftp = client.open_sftp()
    
    upload_dir(sftp, ROOT_DIR / "dist", f"{REMOTE_APP_DIR}/dist")

    sftp.put(str(ROOT_DIR / "server" / "index.js"), f"{REMOTE_APP_DIR}/server/index.js")
    sftp.put(str(ROOT_DIR / "server" / "funnel.js"), f"{REMOTE_APP_DIR}/server/funnel.js")
    sftp.put(str(ROOT_DIR / "server" / "funnelSeed.js"), f"{REMOTE_APP_DIR}/server/funnelSeed.js")
    sftp.put(str(ROOT_DIR / "package.json"), f"{REMOTE_APP_DIR}/package.json")
    
    env_content = """PORT=3001
MONGODB_URI=mongodb://127.0.0.1:27017/rushwash
DB_NAME=rushwash
MONGO_FUNNEL_URI=mongodb://127.0.0.1:27018/rush_funnel
NODE_ENV=production
"""
    with sftp.file(f"{REMOTE_APP_DIR}/.env", "w") as f:
        f.write(env_content)

    sftp.close()
    print("      Files uploaded successfully.")

    # 3. Create and start systemd service for Node backend
    print("[3/6] Configuring systemd service rush-funnel-node.service...")
    service_content = f"""[Unit]
Description=Rush CRM Funnel React & Express Server
After=network.target mongodb.service

[Service]
Type=simple
User=root
WorkingDirectory={REMOTE_APP_DIR}
EnvironmentFile={REMOTE_APP_DIR}/.env
ExecStart=/usr/bin/node {REMOTE_APP_DIR}/server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
"""
    sftp = client.open_sftp()
    with sftp.file("/etc/systemd/system/rush-funnel-node.service", "w") as f:
        f.write(service_content)
    sftp.close()

    run_ssh(client, "systemctl daemon-reload")
    run_ssh(client, "systemctl enable rush-funnel-node.service")
    run_ssh(client, "systemctl restart rush-funnel-node.service")
    
    # Poll up to 10 seconds for active status
    print("      Waiting for service to become active...")
    is_active = False
    for _ in range(10):
        time.sleep(1)
        status = run_ssh(client, "systemctl is-active rush-funnel-node.service", check=False)
        if status == "active":
            is_active = True
            break
            
    if not is_active:
        logs = run_ssh(client, "journalctl -u rush-funnel-node.service -n 30 --no-pager", check=False)
        raise RuntimeError(f"rush-funnel-node service failed to reach active state (status={status}):\n{logs}")
    print("      rush-funnel-node.service is ACTIVE and running on port 3001.")

    # 4. Update Apache reverse proxy configuration
    print("[4/6] Updating Apache configuration in 5-whatsapp-rush.conf...")
    apache_conf = """<VirtualHost *:80>
    ServerName whatsapp.rush.com.sa

    ProxyPreserveHost On

    # Route React Funnel & Flows and API to Node Server on port 3001
    ProxyPass /funnel http://127.0.0.1:3001/funnel
    ProxyPassReverse /funnel http://127.0.0.1:3001/funnel

    ProxyPass /api/funnel http://127.0.0.1:3001/api/funnel
    ProxyPassReverse /api/funnel http://127.0.0.1:3001/api/funnel

    ProxyPass /assets http://127.0.0.1:3001/assets
    ProxyPassReverse /assets http://127.0.0.1:3001/assets

    # Everything else routed to FastAPI Hub on port 8090
    ProxyPass / http://127.0.0.1:8090/
    ProxyPassReverse / http://127.0.0.1:8090/

    ErrorLog ${APACHE_LOG_DIR}/whatsapp_error.log
    CustomLog ${APACHE_LOG_DIR}/whatsapp_access.log combined
</VirtualHost>

<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName whatsapp.rush.com.sa

    ProxyPreserveHost On

    # Route React Funnel & Flows and API to Node Server on port 3001
    ProxyPass /funnel http://127.0.0.1:3001/funnel
    ProxyPassReverse /funnel http://127.0.0.1:3001/funnel

    ProxyPass /api/funnel http://127.0.0.1:3001/api/funnel
    ProxyPassReverse /api/funnel http://127.0.0.1:3001/api/funnel

    ProxyPass /assets http://127.0.0.1:3001/assets
    ProxyPassReverse /assets http://127.0.0.1:3001/assets

    # Everything else routed to FastAPI Hub on port 8090
    ProxyPass / http://127.0.0.1:8090/
    ProxyPassReverse / http://127.0.0.1:8090/

    SSLCertificateFile /etc/letsencrypt/live/test.rush.com.sa/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/test.rush.com.sa/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf

    ErrorLog ${APACHE_LOG_DIR}/whatsapp_ssl_error.log
    CustomLog ${APACHE_LOG_DIR}/whatsapp_ssl_access.log combined
</VirtualHost>
</IfModule>
"""
    sftp = client.open_sftp()
    with sftp.file("/etc/apache2/sites-available/5-whatsapp-rush.conf", "w") as f:
        f.write(apache_conf)
    sftp.close()

    run_ssh(client, "apache2ctl configtest")
    run_ssh(client, "systemctl reload apache2")
    print("      Apache reloaded with /funnel, /assets, and /api/funnel routed to Node.")

    client.close()

    # 5. Live HTTPS Verification
    print("[5/6] Verifying live endpoints via HTTPS...")
    funnel_url = "https://whatsapp.rush.com.sa/funnel"
    api_flows_url = "https://whatsapp.rush.com.sa/api/funnel/flows"
    api_graph_url = "https://whatsapp.rush.com.sa/api/funnel/graph"

    r_funnel = requests.get(funnel_url, timeout=15)
    print(f"      GET {funnel_url} -> Status {r_funnel.status_code}")
    assert r_funnel.status_code == 200, f"Expected 200, got {r_funnel.status_code}"
    assert "/assets/index-" in r_funnel.text, "Response does not contain Vite /assets/ script tag"
    print("      ✓ /funnel is serving the Vite React production bundle HTML!")

    # Verify assets loading
    asset_line = [l for l in r_funnel.text.split('"') if l.startswith('/assets/index-') and l.endswith('.js')][0]
    asset_url = f"https://whatsapp.rush.com.sa{asset_line}"
    r_asset = requests.get(asset_url, timeout=15)
    print(f"      GET {asset_url} -> Status {r_asset.status_code} ({len(r_asset.content)} bytes)")
    assert r_asset.status_code == 200, f"Expected 200 for React bundle, got {r_asset.status_code}"
    print("      ✓ React JavaScript bundle loaded successfully!")

    # Verify API
    r_flows = requests.get(api_flows_url, timeout=15)
    print(f"      GET {api_flows_url} -> Status {r_flows.status_code}")
    if r_flows.status_code == 200:
        flows_data = r_flows.json()
        flows_list = flows_data.get('data', {}).get('flows', [])
        print(f"      ✓ /api/funnel/flows returned {len(flows_list)} flows (source: {flows_data.get('data', {}).get('source')})")
        usage_flow = next((f for f in flows_list if 'usage' in f.get('id', '')), None)
        if usage_flow:
            print(f"      ✓ Usage nudge flow trigger: {usage_flow.get('trigger')}")

    # Verify Graph API
    r_graph = requests.get(api_graph_url, timeout=15)
    print(f"      GET {api_graph_url} -> Status {r_graph.status_code}")
    if r_graph.status_code == 200:
        graph_data = r_graph.json()
        stages = graph_data.get('data', {}).get('cohort', {}).get('stages', [])
        print(f"      ✓ /api/funnel/graph returned cohort size: {graph_data.get('data', {}).get('cohortSize')}, {len(stages)} stages")

    print("\n[6/6] SUCCESS: The React Funnel & Flows frontend is now fully deployed and live at https://whatsapp.rush.com.sa/funnel")

if __name__ == '__main__':
    main()
