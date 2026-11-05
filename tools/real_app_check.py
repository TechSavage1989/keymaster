#!/usr/bin/env python3
"""Drive the built page with the real three.js renderer and real mouse clicks, and save what each click picks.

The interface tests use a stand-in for three.js, so this is the check that counts for what the owner sees: it opens
index.html in Chromium (software WebGL), loads a model file, turns the regions on (Parts or Sections), switches to
Paint with Fill, and for each named model point moves the mouse over it, clicks and lets go, then saves a screenshot and
the triangles painted. Model files stay on this machine.

    pip install playwright && python -m playwright install chromium
    python3 tools/real_app_check.py model.stl parts balanced '{"book":[33,-56,130],"hand":[-8,-74,171]}' out/

Points are in the part's own coordinates at the scale given by SCALE (percent, default 100). THREE_DIR can name a
local copy of the three.js package to serve instead of the CDN (handy without network). Prints a JSON summary.
"""
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
import os

model, mode, detail, points, out = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4]), Path(sys.argv[5])
scale = int(os.environ.get('SCALE', '100')); three = os.environ.get('THREE_DIR'); out.mkdir(parents=True, exist_ok=True)
page_path = Path(__file__).resolve().parent.parent / 'index.html'
summary = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1400, 'height': 900})
    if three: pg.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', lambda r: r.fulfill(path=str(Path(three) / r.request.url.split('three@0.147.0/')[1]), content_type='application/javascript'))
    pg.goto(page_path.as_uri()); pg.wait_for_timeout(1500)
    pg.set_input_files('#fileInput', model)
    pg.wait_for_function("document.querySelector('#partList li[data-id]')", timeout=180000); pg.wait_for_timeout(1500)
    if scale != 100: pg.evaluate(f"KeymasterDebug.setScalePct({scale})"); pg.wait_for_timeout(500)
    pg.click('#partList li[data-id] [data-act=select]'); pg.wait_for_timeout(300)
    pg.evaluate("KeymasterDebug.setTool('regions')")
    pg.wait_for_function("KeymasterDebug.regionsOn() && !KeymasterDebug.regionsLoading()", timeout=300000)
    if mode == 'sections': pg.click('[data-act=regions-by][data-value=folds]')
    else: pg.click(f'[data-act=regions-detail][data-value={detail}]')
    pg.wait_for_function("!KeymasterDebug.regionsLoading()", timeout=300000); pg.wait_for_timeout(500)
    pg.evaluate("KeymasterDebug.setTool('paint')"); pg.wait_for_timeout(300)
    pg.evaluate("KeymasterDebug.paintFill(true)")
    view = json.loads(os.environ['VIEW']) if os.environ.get('VIEW') else None  # {"eye": [...], "target": [...]} in the part's coordinates
    if view: pg.evaluate(f"KeymasterDebug.setView({view['eye']}, {view['target']}, 0)"); pg.wait_for_timeout(500)
    cv = pg.locator('#stage canvas').bounding_box()
    pg.screenshot(path=str(out / f'{mode}_view.png'))
    for name, pt in points.items():
        sp = pg.evaluate(f"KeymasterDebug.screenPointOf(0, {pt})")
        if not sp or not (cv['x'] < sp[0] < cv['x'] + cv['width'] and cv['y'] < sp[1] < cv['y'] + cv['height']): summary[name] = {'offscreen': sp}; continue
        pg.evaluate("KeymasterDebug.paintEdit('paint-clear')"); pg.wait_for_timeout(200)
        pg.mouse.move(sp[0], sp[1]); pg.wait_for_timeout(300); pg.screenshot(path=str(out / f'{mode}_{name}_hover.png'))
        pg.mouse.down(); pg.wait_for_timeout(80); pg.mouse.up(); pg.wait_for_timeout(1500)
        pg.screenshot(path=str(out / f'{mode}_{name}_fill.png'))
        painted = pg.evaluate("KeymasterDebug.paintedTriangles()")
        summary[name] = {'screen': [round(sp[0]), round(sp[1])], 'painted': len(painted)}
        json.dump(painted, open(out / f'{mode}_{name}.json', 'w'))
    b.close()
print(json.dumps(summary, indent=1))
