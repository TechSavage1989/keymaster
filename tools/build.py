"""Assemble the single-file app (index.html) from src/, plus a test page that uses the three.js stand-in."""
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
t = (root / 'src/template.html').read_text()
core = (root / 'src/core.js').read_text().replace("if (typeof module !== 'undefined') module.exports = KMCore;", '')
app = (root / 'src/app.js').read_text()
out = t.replace('/*__CORE__*/', core).replace('/*__APP__*/', app)
(root / 'index.html').write_text(out)

test = re.sub(r'<script src="https://cdn\.jsdelivr\.net[^"]+"></script>\n', '', out)
test = test.replace('<script>\n', '<script src="mock-three.js"></script>\n<script>\n', 1)
test = re.sub(r'<link[^>]+fonts\.(googleapis|gstatic)[^>]*>\n', '', test)
(root / 'tests/test.html').write_text(test)
print(f'Built index.html ({len(out) // 1024} KB) and tests/test.html')
