"""
Patch server/index.js for Express 5 compatibility
Timestamps in Riyadh Time (AST).
"""

import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

def main():
    root = Path(__file__).resolve().parent.parent
    index_file = root / 'server' / 'index.js'
    text = index_file.read_text(encoding='utf-8')

    old_target = "app.get('*', (req, res, next) => {"
    new_target = "app.use((req, res, next) => {"

    if old_target in text:
        text = text.replace(old_target, new_target)
        index_file.write_text(text, encoding='utf-8')
        print("Successfully replaced app.get('*') with app.use(...) in server/index.js")
    else:
        print("Target pattern not found or already replaced.")

if __name__ == '__main__':
    main()
