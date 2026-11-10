"""
Verify live React frontend at https://whatsapp.rush.com.sa/funnel
Timestamps in Riyadh Time (AST).
"""

import sys
import requests

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

def main():
    r = requests.get('https://whatsapp.rush.com.sa/funnel', timeout=10)
    print('GET /funnel Status:', r.status_code)
    print('Root div present:', 'id="root"' in r.text)
    print('Vite bundle JS present:', '/assets/index-X3ojKOoz.js' in r.text)
    print('Vite bundle CSS present:', '/assets/index-CQo5yPdh.css' in r.text)
    
    # Check JS bundle
    js_url = 'https://whatsapp.rush.com.sa/assets/index-X3ojKOoz.js'
    r_js = requests.get(js_url, timeout=10)
    print('GET JS bundle Status:', r_js.status_code, f'({len(r_js.content)} bytes)')
    
    # Check CSS bundle
    css_url = 'https://whatsapp.rush.com.sa/assets/index-CQo5yPdh.css'
    r_css = requests.get(css_url, timeout=10)
    print('GET CSS bundle Status:', r_css.status_code, f'({len(r_css.content)} bytes)')

    # Check API endpoints
    for ep in ['/api/funnel/flows', '/api/funnel/graph', '/api/funnel/trends']:
        r_api = requests.get(f'https://whatsapp.rush.com.sa{ep}', timeout=10)
        print(f'GET {ep} Status:', r_api.status_code)

if __name__ == '__main__':
    main()
