import sys, zipfile, io, time
from pathlib import Path
HERE = Path(__file__).resolve().parent
OUT = HERE / 'output'
OUT.mkdir(exist_ok=True)
PAGE = (HERE / 'test.html').as_uri()
from playwright.sync_api import sync_playwright

errors = []
results = []

def lathe_stl(path, radius, length, seg=48, rings=160):
    # a solid of revolution along z, radius(z), closed at both ends, as a binary STL
    import math, struct
    pt = lambda z, a, r: [math.cos(a) * r, math.sin(a) * r, z]
    grid = [[pt(length * i / rings, 2 * math.pi * j / seg, radius(length * i / rings)) for j in range(seg)] for i in range(1, rings)]
    a0, a1 = [0, 0, 0], [0, 0, length]
    tris = []
    for j in range(seg):
        k = (j + 1) % seg
        tris.append((a0, grid[0][k], grid[0][j])); tris.append((a1, grid[-1][j], grid[-1][k]))
        for i in range(rings - 2):
            tris.append((grid[i][j], grid[i][k], grid[i + 1][k])); tris.append((grid[i][j], grid[i + 1][k], grid[i + 1][j]))
    with open(path, 'wb') as f:
        f.write(b'lathe'.ljust(80, b' ')); f.write(struct.pack('<I', len(tris)))
        for tri in tris:
            f.write(struct.pack('<3f', 0, 0, 0))
            for p_ in tri: f.write(struct.pack('<3f', *p_))
            f.write(b'\0\0')

def dumbbell_stl(path):
    # two 12 mm balls joined by a 5 mm bar, tipped at an odd angle, as a binary STL
    import math, struct
    ax = [0.55, 0.3, 0.78]; L = math.sqrt(sum(v * v for v in ax)); ax = [v / L for v in ax]
    u = [ax[1], -ax[0], 0]; L = math.sqrt(sum(v * v for v in u)); u = [v / L for v in u]
    v = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]]
    def r(z):
        ball = lambda c: math.sqrt(max(0, 144 - (z - c) ** 2)) if abs(z - c) < 12 else 0
        return max(ball(12), ball(48), 2.5 if 6 < z < 54 else 0, 0.05)
    seg, rings = 40, 100
    pt = lambda z, a, rr: [ax[k] * z + u[k] * math.cos(a) * rr + v[k] * math.sin(a) * rr for k in range(3)]
    grid = [[pt(60 * i / rings, 2 * math.pi * j / seg, r(60 * i / rings)) for j in range(seg)] for i in range(1, rings)]
    tris = []
    a0, a1 = pt(0, 0, 0), pt(60, 0, 0)
    for j in range(seg):
        k = (j + 1) % seg
        tris.append((a0, grid[0][k], grid[0][j]))
        tris.append((a1, grid[-1][j], grid[-1][k]))
        for i in range(rings - 2):
            tris.append((grid[i][j], grid[i][k], grid[i + 1][k])); tris.append((grid[i][j], grid[i + 1][k], grid[i + 1][j]))
    with open(path, 'wb') as f:
        f.write(b'dumbbell'.ljust(80, b' ')); f.write(struct.pack('<I', len(tris)))
        for tri in tris:
            f.write(struct.pack('<3f', 0, 0, 0))
            for p_ in tri: f.write(struct.pack('<3f', *p_))
            f.write(b'\0\0')
def boxes_stl(path, boxes):
    # separate axis-aligned boxes [x0, y0, z0, x1, y1, z1], as one binary STL
    import struct
    tris = []
    for (x0, y0, z0, x1, y1, z1) in boxes:
        c = [[x, y, z] for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
        for a, b_, c_, d in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            tris.append((c[a], c[b_], c[c_])); tris.append((c[a], c[c_], c[d]))
    with open(path, 'wb') as f:
        f.write(b'boxes'.ljust(80, b' ')); f.write(struct.pack('<I', len(tris)))
        for tri in tris:
            f.write(struct.pack('<3f', 0, 0, 0))
            for p_ in tri: f.write(struct.pack('<3f', *p_))
            f.write(b'\0\0')
def check(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(('  ok  ' if cond else '  FAIL ') + name + (('  ' + str(extra)) if extra and not cond else ''))

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto(PAGE)
    pg.wait_for_timeout(300)
    check('empty state visible', pg.is_visible('#empty'))
    ver = pg.inner_text('#appVersion')
    expected = (HERE.parent / 'VERSION').read_text().strip()
    check('the version shows next to the name', ver.startswith('v' + expected + ' · ') and len(ver.split(' · ')[1]) == 6, ver)
    check('intro in inspector', 'printable pieces' in pg.inner_text('#inspector'))
    pg.screenshot(path=str(OUT / 'shot_empty.png'))

    pg.click('#emptySample')
    pg.wait_for_selector('#partList li[data-id]')
    check('sample loaded: 1 part', pg.locator('#partList li[data-id]').count() == 1)
    check('model panel shows closed surface', 'Closed surface' in pg.inner_text('#inspector'), pg.inner_text('#inspector')[:300])
    check('empty state hidden', not pg.is_visible('#empty'))
    check('export enabled', pg.is_enabled('#exportBtn'))

    # select and analyze
    pg.click('#partList li[data-id] [data-act=select]')
    pg.wait_for_selector('[data-act=cut]')
    pg.wait_for_timeout(600)
    ins = pg.inner_text('#inspector')
    check('cut panel shown: key settings on the right, plane controls under the view', pg.is_visible('#planeBar') and 'Pegs' in ins and 'Cut part' in ins and pg.locator('#planeBar #cutPos').count() == 1)
    check('keys auto-placed and ready', 'ready' in ins, ins)
    areas = pg.locator('[data-area]').count()
    print('    areas on cut face:', areas)
    pg.screenshot(path=str(OUT / 'shot_cut.png'))

    # idle: nothing should redraw when nothing changes (guards against work inside the frame loop)
    pg.wait_for_timeout(800)
    r0 = pg.evaluate('window.__renders')
    pg.wait_for_timeout(700)
    r1 = pg.evaluate('window.__renders')
    check('no redraws while idle', r1 - r0 <= 1, r1 - r0)

    # area labels in the view: one per area, toggle cut/joined, hover links label and list row
    tags = pg.locator('#areaTags [data-area-tag]')
    check('one label per area in the view', areas > 1 and tags.count() == areas and pg.is_visible('#areaTags [data-area-tag]'), (areas, tags.count()))
    check('labels start as cut', all(tags.nth(i).get_attribute('aria-pressed') == 'true' for i in range(tags.count())))
    pg.locator('#areaTags [data-area-tag="1"]').hover()
    pg.wait_for_timeout(100)
    check('hovering a label highlights its row', pg.locator('[data-area-row="1"].is-hover').count() == 1)
    pg.locator('#planeBar [data-area-row="2"]').hover()
    pg.wait_for_timeout(100)
    check('hovering a row highlights its label', 'is-hover' in (pg.get_attribute('#areaTags [data-area-tag="2"]', 'class') or ''))
    pg.click('#areaTags [data-area-tag="1"]')
    pg.wait_for_timeout(150)
    t1 = pg.locator('#areaTags [data-area-tag="1"]')
    check('clicking a label leaves that area joined', t1.get_attribute('aria-pressed') == 'false' and 'Joined' in t1.inner_text() and not pg.is_checked('[data-area="1"]'))
    # clicking the grey area itself in the view brings it back
    tb = t1.bounding_box()
    pg.evaluate("document.querySelector('#areaTags').style.display = 'none'")
    pg.mouse.click(tb['x'] + tb['width'] / 2, tb['y'] + tb['height'] / 2)
    pg.evaluate("document.querySelector('#areaTags').style.display = ''")
    pg.wait_for_timeout(150)
    check('clicking a joined area in the view cuts it again', pg.is_checked('[data-area="1"]') and t1.get_attribute('aria-pressed') == 'true')
    pg.locator('[data-area="0"]').uncheck()
    pg.wait_for_timeout(100)
    check('unticking a row updates its label', pg.get_attribute('#areaTags [data-area-tag="0"]', 'aria-pressed') == 'false')
    for i in range(1, areas):
        pg.locator(f'[data-area="{i}"]').uncheck()
    pg.click('[data-act=cut]')
    pg.wait_for_timeout(200)
    check('cutting with every area joined explains why', 'Every area is set to stay joined' in pg.inner_text('#toast') and pg.locator('#partList li[data-id]').count() == 1, pg.inner_text('#toast'))
    for i in range(areas):
        pg.locator(f'#areaTags [data-area-tag="{i}"]').click()
    pg.wait_for_timeout(200)
    check('every area cut again', all(pg.is_checked(f'[data-area="{i}"]') for i in range(areas)))
    pg.mouse.move(5, 5)
    pg.screenshot(path=str(OUT / 'shot_area_tags.png'))

    # each key can have its own settings: click it, change it, and the others keep the general settings
    n_keys = pg.evaluate("KeymasterDebug.keyCount()")
    check('keys placed to customise', n_keys >= 2, n_keys)
    def select_key(i):
        x, y = pg.evaluate(f"KeymasterDebug.keyScreenPoint({i})")
        pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.up(); pg.wait_for_timeout(300)
    select_key(0)
    ins = pg.inner_text('#inspector')
    check('clicking a key opens its own settings', 'Key 1' in ins and 'apply to this key only' in ins and pg.locator('[data-act=key-done]').count() == 1, ins[:300])
    pg.click('[data-act=kshape][data-value=square]')
    pg.fill('input[data-kcfg=diameter]', '3'); pg.press('input[data-kcfg=diameter]', 'Tab'); pg.wait_for_timeout(300)
    ins = pg.inner_text('#inspector')
    check('the key takes its own shape and size', 'own settings' in ins and 'Square' in ins and pg.input_value('input[data-kcfg=diameter]') == '3', ins[:400])
    check('the key is checked on its own', 'This key fits' in ins or 'This key needs attention' in ins, ins[-300:])
    pg.evaluate("() => { const r = document.querySelector('#keyTaper'); r.value = 50; r.dispatchEvent(new Event('input', {bubbles:true})); r.dispatchEvent(new Event('change', {bubbles:true})); }")
    pg.wait_for_timeout(300)
    check('the key can have its own taper', pg.input_value('#keyTaper') == '50' and pg.locator('input[data-kcfg=taperSocket]').count() == 1)
    pg.click('[data-act=key-done]'); pg.wait_for_timeout(200)
    check('the general settings are unchanged', pg.get_attribute('[data-act=shape][data-value=round]', 'aria-pressed') == 'true' and pg.input_value('input[data-cfg=diameter]') == '5')
    select_key(1)
    check('another key keeps the general settings', 'Key 2' in pg.inner_text('#inspector') and 'own settings' not in pg.inner_text('#inspector') and pg.input_value('input[data-kcfg=diameter]') == '5')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check('Esc goes back to all keys without leaving the part', pg.locator('[data-act=key-done]').count() == 0 and pg.locator('[data-act=cut]').count() == 1)
    select_key(0)
    check('the custom key remembers its settings', 'own settings' in pg.inner_text('#inspector') and pg.input_value('input[data-kcfg=diameter]') == '3')
    pg.click('[data-act=key-reset]'); pg.wait_for_timeout(200)
    check('use general settings resets the key', 'own settings' not in pg.inner_text('#inspector') and pg.input_value('input[data-kcfg=diameter]') == '5')
    pg.click('[data-act=kshape][data-value=hexagon]'); pg.wait_for_timeout(200)
    select_key(n_keys - 1)
    pg.click('[data-act=remove-key]'); pg.wait_for_timeout(300)
    check('remove key from its settings', pg.evaluate("KeymasterDebug.keyCount()") == n_keys - 1)
    m = pg.evaluate("(() => { const i = document.querySelector('#inspector'); return i.scrollHeight - i.clientHeight; })()")
    check('a key\'s own settings fit without scrolling', m <= 1, m)
    if 'attention' in pg.inner_text('#inspector'):
        pg.click('[data-act=remove-bad]'); pg.wait_for_timeout(200)
    n_parts = pg.locator('#partList li[data-id]').count()
    pg.click('[data-act=cut]')
    pg.wait_for_function(f"document.querySelectorAll('#partList li[data-id]').length > {n_parts}", timeout=15000)
    check('cutting with a custom key works', pg.locator('#partList li[data-id]').count() > n_parts)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    pg.click('#partList li[data-id] [data-act=select]'); pg.wait_for_selector('[data-act=cut]'); pg.wait_for_timeout(600)

    # key shapes: picker, help, direction controls
    check('seven peg shapes offered', pg.locator('.shape-grid [data-act=shape]').count() == 7)
    check('round starts selected with no direction controls', pg.get_attribute('[data-act=shape][data-value=round]', 'aria-pressed') == 'true' and pg.locator('input[data-cfg=turn]').count() == 0)
    pg.click('[data-act=shape][data-value=slot]')
    pg.wait_for_timeout(600)
    ins = pg.inner_text('#inspector')
    check('slot selected and explained', pg.get_attribute('[data-act=shape][data-value=slot]', 'aria-pressed') == 'true' and '2× as long' in ins and ('Width' in ins or 'Largest' in ins), ins[:600])
    check('direction controls shown for slots', pg.is_checked('input[data-cfg=align]') and pg.locator('input[data-cfg=turn]').count() == 1)
    check('slot keys checked', 'ready' in ins or 'attention' in ins or 'No room' in ins, ins[-300:])
    pg.fill('input[data-cfg=turn]', '270'); pg.press('input[data-cfg=turn]', 'Tab')
    pg.wait_for_timeout(400)
    check('turn wraps to -90°', pg.input_value('input[data-cfg=turn]') == '-90', pg.input_value('input[data-cfg=turn]'))
    pg.fill('input[data-cfg=turn]', '0'); pg.press('input[data-cfg=turn]', 'Tab')
    pg.click('[data-act=shape][data-value=dshape]')
    pg.wait_for_timeout(400)
    check('D-shape explains one-way fit', 'only one way round' in pg.inner_text('#inspector'))
    # taper: slider from straight to a point, matching or straight hole
    check('taper starts straight with no hole option', pg.input_value('#taperPct') == '0' and 'Straight sides' in pg.inner_text('#inspector') and pg.locator('input[data-cfg=taperSocket]').count() == 0)
    def set_taper(v):
        pg.evaluate(f"() => {{ const r = document.querySelector('#taperPct'); r.value = {v}; r.dispatchEvent(new Event('input', {{bubbles:true}})); r.dispatchEvent(new Event('change', {{bubbles:true}})); }}")
        pg.wait_for_timeout(500)
    set_taper(40)
    ins = pg.inner_text('#inspector')
    check('40% taper explained, hole matches by default', '40%' in pg.inner_text('#taperOut') and 'tip is 60% of the base width' in ins and pg.is_checked('input[data-cfg=taperSocket]'), ins[-500:])
    pg.click('[data-act=shape][data-value=square]')
    set_taper(100)
    check('square at 100% comes to a pyramid point', 'four-sided pyramid' in pg.inner_text('#inspector'))
    pg.uncheck('input[data-cfg=taperSocket]')
    pg.wait_for_timeout(400)
    ins = pg.inner_text('#inspector')
    check('straight hole explained', 'hole stays straight' in ins and not pg.is_checked('input[data-cfg=taperSocket]'))
    check('tapered keys still checked', 'ready' in ins or 'attention' in ins or 'No room' in ins, ins[-300:])
    pg.screenshot(path=str(OUT / 'shot_taper.png'))
    pg.check('input[data-cfg=taperSocket]')
    set_taper(0)
    check('taper back to straight', 'Straight sides' in pg.inner_text('#inspector'))
    # thick walls leave some areas with no room for a key: the panel and the labels say which, and why
    pg.click('[data-act=shape][data-value=round]')
    # with one fixed size first, as before automatic sizing
    pg.click('[data-act=sizemode][data-value=set]'); pg.wait_for_timeout(300)
    pg.fill('input[data-cfg=margin]', '6'); pg.press('input[data-cfg=margin]', 'Tab')
    pg.wait_for_timeout(900)
    ins = pg.inner_text('#inspector')
    nokey = pg.locator('#areaTags [data-area-tag] i').count()
    print('    with 6 mm walls:', [l for l in ins.split('\n') if 'No room' in l][:1], 'labels saying no key:', nokey)
    check('areas without a key are named, with a reason and a fix', 'No room for a key in areas' in ins and 'too narrow for keys this size' in ins and 'Try smaller keys or a thinner wall' in ins and 'keys ready' in ins, ins[-500:])
    line = [l for l in ins.split('\n') if 'No room for a key in' in l][0]
    named = len(line.split(':')[0].replace(' and ', ', ').split(', '))
    check('labels mark just the areas with no key', nokey == named and 0 < nokey < pg.locator('#areaTags [data-area-tag]').count(), (nokey, named))
    pg.fill('input[data-cfg=margin]', '9'); pg.press('input[data-cfg=margin]', 'Tab')
    pg.wait_for_timeout(900)
    check('no room anywhere is explained', 'No room for keys on this cut' in pg.inner_text('#inspector') and 'thinner wall' in pg.inner_text('#inspector'), pg.inner_text('#inspector')[-400:])
    pg.fill('input[data-cfg=margin]', '1.2'); pg.press('input[data-cfg=margin]', 'Tab')
    pg.wait_for_timeout(900)
    check('normal walls: every area gets a key again', pg.locator('#areaTags [data-area-tag] i').count() == 0 and 'No room for a key' not in pg.inner_text('#inspector'), pg.inner_text('#inspector')[-300:])
    # sized to fit each area (the default): thick walls leave fewer areas without a key, because smaller keys are tried
    fixed6 = None
    pg.fill('input[data-cfg=margin]', '6'); pg.press('input[data-cfg=margin]', 'Tab'); pg.wait_for_timeout(900)
    fixed6 = pg.locator('#areaTags [data-area-tag] i').count()
    pg.click('[data-act=sizemode][data-value=auto]'); pg.wait_for_timeout(1200)
    fitted6 = pg.locator('#areaTags [data-area-tag] i').count()
    ins = pg.inner_text('#inspector')
    print('    with 6 mm walls, areas without a key: one size', fixed6, '| fitted', fitted6)
    check('fitting each area finds room where one size can\'t', fitted6 < fixed6, (fixed6, fitted6))
    check('fitting shows Largest and Smallest sizes', pg.get_attribute('[data-act=sizemode][data-value=auto]', 'aria-pressed') == 'true' and pg.locator('input[data-cfg=sizeMin]').count() == 1 and 'Largest' in ins)
    if fitted6: check('an area that still has no room says the smallest size tried', 'even at 2.5 mm' in ins and 'Resin' in ins, ins[-400:])
    pg.fill('input[data-cfg=margin]', '1.2'); pg.press('input[data-cfg=margin]', 'Tab'); pg.wait_for_timeout(600)
    n_fit = pg.evaluate("KeymasterDebug.keyCount()")
    check('normal walls, fitted: keys everywhere', n_fit >= 6 and 'ready' in pg.inner_text('#inspector'), n_fit)
    # the printer type sets the smallest key, the gap and the wall to what prints reliably
    pg.click('[data-act=done]'); pg.wait_for_timeout(200)
    check('printer type sits with the bed size', pg.locator('[data-act=printer]').count() == 2 and pg.get_attribute('[data-act=printer][data-value=fdm]', 'aria-pressed') == 'true')
    pg.click('[data-act=printer][data-value=resin]'); pg.wait_for_timeout(200)
    check('choosing resin explains what changed', 'Set up for resin' in pg.inner_text('#toast'))
    pg.click('#partList li[data-id] [data-act=select]'); pg.wait_for_selector('[data-act=cut]'); pg.wait_for_timeout(500)
    check('resin: keys down to 1 mm, 0.1 mm gap, 0.8 mm walls', pg.input_value('input[data-cfg=sizeMin]') == '1' and pg.input_value('input[data-cfg=clearance]') == '0.1' and pg.input_value('input[data-cfg=margin]') == '0.8')
    pg.click('[data-act=done]'); pg.click('[data-act=printer][data-value=fdm]'); pg.wait_for_timeout(200)
    pg.click('#partList li[data-id] [data-act=select]'); pg.wait_for_selector('[data-act=cut]'); pg.wait_for_timeout(500)
    check('filament: back to 2.5 mm, 0.2 mm gap, 1.2 mm walls', pg.input_value('input[data-cfg=sizeMin]') == '2.5' and pg.input_value('input[data-cfg=margin]') == '1.2')
    pg.screenshot(path=str(OUT / 'shot_shapes.png'))
    pg.click('[data-act=shape][data-value=round]')
    pg.wait_for_timeout(400)

    # tilt rings and typed angles
    check('angle starts square', 'Square to' in pg.inner_text('#tiltOut'), pg.inner_text('#tiltOut'))
    ins = pg.inner_text('#inspector')
    hint = pg.inner_text('#hint')
    check('the hint explains sliding, tilting by plane or ring, and orbiting', 'Drag the arrow to slide' in hint and 'the plane or a ring to tilt' in hint and 'orbit' in hint, hint)
    check('no separate slide and tilt modes', pg.locator('[data-act=gizmo]').count() == 0)
    check('three angle boxes and a position box', pg.locator('input[data-angle]').count() == 3 and pg.locator('#cutPosNum').count() == 1)
    def angles():
        return {a: float(pg.input_value(f'input[data-angle={a}]')) for a in 'xyz'}
    def ring_drag(ax, a0, a1, shift=False, steps=12):
        x0, y0 = pg.evaluate(f"KeymasterDebug.ringScreenPoint('{ax}', {a0})")
        x1, y1 = pg.evaluate(f"KeymasterDebug.ringScreenPoint('{ax}', {a1})")
        pg.mouse.move(x0, y0)
        if shift: pg.keyboard.down('Shift')
        pg.mouse.down()
        for i in range(1, steps + 1):
            pg.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
        chip = pg.is_visible('#dragChip') and '°' in pg.inner_text('#dragChip')
        pg.mouse.up()
        if shift: pg.keyboard.up('Shift')
        pg.wait_for_timeout(400)
        return chip
    a_before = angles()
    # grab the rings low down, clear of any message along the top of the view
    pg.mouse.move(*pg.evaluate("KeymasterDebug.ringScreenPoint('x', -70)"))
    pg.wait_for_timeout(100)
    check('hovering a ring shows a grab cursor', pg.evaluate("document.querySelector('#stage canvas').style.cursor") == 'grab')
    chip = ring_drag('x', -70, -95)
    tilt = pg.inner_text('#tiltOut')
    a_after = angles()
    print('    after ring drag:', tilt, a_after)
    check('dragging a ring tilts the plane', '° off' in tilt and a_after != a_before, (tilt, a_after))
    check('angle shows beside the pointer while dragging', chip)
    check('angle boxes follow the ring', abs(float(tilt.split('°')[0])) > 1)
    ins = pg.inner_text('#inspector')
    check('keys re-checked after tilting', 'ready' in ins or 'attention' in ins or 'No room' in ins, ins[-300:])
    pg.click('[data-act=straighten]')
    pg.wait_for_timeout(300)
    check('straighten snaps square', 'Square to' in pg.inner_text('#tiltOut'), pg.inner_text('#tiltOut'))
    b0 = angles()
    ring_drag('y', -60, -77, shift=True)
    b1 = angles()
    diffs = [abs(b1[a] - b0[a]) for a in 'xyz']
    print('    after shift ring drag:', b1)
    check('Shift snaps the ring to 5° steps', max(diffs) >= 4.9 and all(abs(d / 5 - round(d / 5)) < 0.02 or d < 0.05 for d in diffs), (b0, b1))
    # typed angles: tip 30° about X, then swing it round with Z; the tilt stays 30°
    pg.click('[data-act=straighten]'); pg.wait_for_timeout(200)
    for a, v in (('x', '30'), ('y', '0'), ('z', '0')):
        pg.fill(f'input[data-angle={a}]', v); pg.press(f'input[data-angle={a}]', 'Tab'); pg.wait_for_timeout(250)
    check('typing X 30° tilts the cut 30°', '30.0° off Z' in pg.inner_text('#tiltOut') and pg.input_value('input[data-angle=x]') == '30.0', pg.inner_text('#tiltOut'))
    pg.fill('input[data-angle=z]', '90'); pg.press('input[data-angle=z]', 'Tab'); pg.wait_for_timeout(300)
    check('typing Z swings the tilt around, still 30°', '30.0° off Z' in pg.inner_text('#tiltOut') and pg.input_value('input[data-angle=z]') == '90.0', pg.inner_text('#tiltOut'))
    pg.fill('input[data-angle=y]', '90'); pg.press('input[data-angle=y]', 'Tab'); pg.wait_for_timeout(300)
    check('typing Y 90° makes an upright cut', 'off Z' not in pg.inner_text('#tiltOut') or 'Square to' in pg.inner_text('#tiltOut'), pg.inner_text('#tiltOut'))
    pg.click('[data-act=straighten]'); pg.wait_for_timeout(300)
    check('straighten after typing', 'Square to' in pg.inner_text('#tiltOut'))
    pg.click('[data-act=align][data-value=z]'); pg.wait_for_timeout(300)
    # drag anywhere on the plane to tip it, like the edge of a tray, with no mode to switch to; clicks still add keys
    def sheet_point():  # a spot on the plane near its edge that no toolbar, label or message covers
        for fx, fy in ((1.0, 0.95), (0.95, -0.95), (-0.95, 0.95), (-0.95, -0.95), (1.05, 0), (0, 1.05), (-1.05, 0), (0, -1.05)):
            x, y = pg.evaluate(f"KeymasterDebug.sheetScreenPoint({fx}, {fy})")
            if pg.evaluate(f"(() => {{ const e = document.elementFromPoint({x}, {y}); return !!e && e.tagName === 'CANVAS'; }})()") and pg.evaluate(f"(() => {{ const e = document.elementFromPoint({x}, {y - 90}); return !!e && e.tagName === 'CANVAS'; }})()"):
                return x, y
        return pg.evaluate("KeymasterDebug.sheetScreenPoint(1.0, 0.95)")
    x0, y0 = sheet_point()
    pg.mouse.move(x0, y0)
    pg.wait_for_timeout(100)
    check('the plane shows a grab cursor', pg.evaluate("document.querySelector('#stage canvas').style.cursor") == 'grab')
    pg.mouse.down()
    for i in range(1, 11):
        pg.mouse.move(x0, y0 - 8 * i)
    tray_chip = pg.is_visible('#dragChip') and 'off' in pg.inner_text('#dragChip')
    pg.mouse.up()
    pg.wait_for_timeout(400)
    tilt = pg.inner_text('#tiltOut')
    print('    after dragging the plane:', tilt)
    check('dragging the plane tilts it', '° off' in tilt, tilt)
    check('the angle shows by the pointer while tipping', tray_chip)
    check('angle boxes follow the plane drag', any(abs(v) > 0.5 for v in angles().values()), angles())
    x1, y1 = sheet_point()
    pg.mouse.move(x1, y1)
    pg.keyboard.down('Shift'); pg.mouse.down()
    for i in range(1, 11):
        pg.mouse.move(x1, y1 - 8 * i)
    pg.mouse.up(); pg.keyboard.up('Shift')
    pg.wait_for_timeout(300)
    t2 = pg.inner_text('#tiltOut')
    d1 = float(tilt.split('°')[0]); d2 = float(t2.split('°')[0]) if '°' in t2 else 0
    check('Shift tips the plane more finely', 0 < abs(d2 - d1) < d1, (d1, d2))
    keys_before = pg.evaluate("document.querySelectorAll('[data-act=remove-key]').length")
    pg.click('[data-act=align][data-value=z]'); pg.wait_for_timeout(500)
    # Alt-drag over the plane orbits instead of tipping it
    t3 = pg.inner_text('#tiltOut')
    x2, y2 = sheet_point()
    pg.keyboard.down('Alt'); pg.mouse.move(x2, y2); pg.mouse.down()
    for i in range(1, 8): pg.mouse.move(x2, y2 - 8 * i)
    pg.mouse.up(); pg.keyboard.up('Alt'); pg.wait_for_timeout(300)
    check('Alt-drag over the plane leaves it untouched', pg.inner_text('#tiltOut') == t3, (t3, pg.inner_text('#tiltOut')))
    pg.click('[data-act=align][data-value=z]'); pg.wait_for_timeout(300)
    # typed position
    lo, hi = float(pg.get_attribute('#cutPos', 'min')), float(pg.get_attribute('#cutPos', 'max'))
    target = round(lo + (hi - lo) * 0.4, 1)
    pg.fill('#cutPosNum', str(target)); pg.press('#cutPosNum', 'Tab'); pg.wait_for_timeout(400)
    check('typing a position moves the cut there', abs(float(pg.input_value('#cutPosNum')) - target) < 0.05 and abs(float(pg.input_value('#cutPos')) - target) < 0.2, (pg.input_value('#cutPosNum'), target))
    pg.fill('#cutPosNum', '0'); pg.press('#cutPosNum', 'Tab'); pg.wait_for_timeout(400)

    # slider moves plane
    before = pg.input_value('#cutPosNum')
    pg.evaluate("""() => { const r = document.querySelector('#cutPos'); r.value = (parseFloat(r.min) + parseFloat(r.max)) / 2 + (parseFloat(r.max) - parseFloat(r.min)) * 0.12; r.dispatchEvent(new Event('input', {bubbles:true})); r.dispatchEvent(new Event('change', {bubbles:true})); }""")
    pg.wait_for_timeout(500)
    after = pg.input_value('#cutPosNum')
    check('position slider moves the plane', before != after, (before, after))
    ins = pg.inner_text('#inspector')
    check('keys re-placed after move', 'ready' in ins or 'attention' in ins, ins[-400:])

    # cut
    pg.click('[data-act=cut]')
    pg.wait_for_function("document.querySelectorAll('#partList li[data-id]').length > 1", timeout=15000)
    names = pg.locator('#partList .part-name').all_inner_texts()
    print('    parts after cut:', names)
    check('cut made several parts', len(names) >= 2)
    check('toast reports the cut', 'Cut into' in pg.inner_text('#toast'))
    check('undo enabled', pg.is_enabled('#undoBtn'))

    pg.click('#undoBtn'); pg.wait_for_timeout(200)
    check('undo restores 1 part', pg.locator('#partList li[data-id]').count() == 1)
    pg.click('#redoBtn'); pg.wait_for_timeout(200)
    check('redo restores cut parts', pg.locator('#partList li[data-id]').count() == len(names))

    # dowels on the biggest part
    pg.locator('#partList li[data-id] [data-act=select]').first.click()
    pg.wait_for_selector('[data-act=cut]')
    pg.click('[data-act=keytype][data-value=dowel]')
    pg.click('[data-act=shape][data-value=hexagon]')
    pg.wait_for_timeout(700)
    ins = pg.inner_text('#inspector')
    check('dowel mode explains pins', 'printable pins' in ins)
    n_before = pg.locator('#partList li[data-id]').count()
    pg.click('[data-act=align][data-value=x]')
    pg.wait_for_timeout(700)
    ins = pg.inner_text('#inspector')
    print('    after align X:', [l for l in ins.split('\n') if 'key' in l.lower()][-1:])
    if 'attention' in ins:
        pg.click('[data-act=remove-bad]')
    pg.keyboard.press('Enter')
    pg.wait_for_function(f"document.querySelectorAll('#partList li[data-id]').length > {n_before}", timeout=15000)
    names2 = pg.locator('#partList .part-name').all_inner_texts()
    print('    parts after dowel cut:', names2)
    check('hexagon dowel pins created', any('pin' in n for n in names2))

    # magnets, square, custom size, selective area if possible
    pg.locator('#partList li[data-id] [data-act=select]').nth(1).click()
    pg.wait_for_selector('[data-act=cut]')
    pg.click('[data-act=keytype][data-value=magnet]')
    pg.wait_for_timeout(200)
    check('magnets offer round and square only, falling back to round', pg.locator('.shape-grid [data-act=shape]').count() == 2 and pg.get_attribute('[data-act=shape][data-value=round]', 'aria-pressed') == 'true')
    pg.click('[data-act=shape][data-value=square]')
    pg.fill('input[data-cfg=diameter]', '4')
    pg.press('input[data-cfg=diameter]', 'Tab')
    pg.wait_for_timeout(700)
    check('magnet settings kept', pg.input_value('input[data-cfg=diameter]') == '4')
    if pg.locator('[data-area]').count() > 1:
        pg.locator('[data-area]').nth(1).uncheck()
        pg.wait_for_timeout(300)
        print('    skipped one area for a selective cut')
    n_before = pg.locator('#partList li[data-id]').count()
    pg.click('[data-act=cut]')
    pg.wait_for_timeout(1500)
    n_after = pg.locator('#partList li[data-id]').count()
    t = pg.inner_text('#toast')
    check('magnet cut done or explained', n_after > n_before or len(t) > 0, t)
    print('    toast:', t)

    # keyboard escape and model panel ops
    pg.locator('#partList li[data-id] [data-act=select]').first.click()
    pg.wait_for_selector('[data-act=cut]')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(200)
    check('escape returns to model panel', 'Orientation' in pg.inner_text('#inspector'))
    size_before = pg.inner_text('.facts')
    pg.click('[data-act=scale][data-value="10"]')
    pg.wait_for_timeout(400)
    size_after = pg.inner_text('.facts')
    check('scale x10 changes size', size_before != size_after, (size_before, size_after))
    pg.keyboard.press('Control+z')
    pg.wait_for_timeout(300)
    check('ctrl+z undoes scale', pg.inner_text('.facts') == size_before)
    pg.click('[data-act=rotate][data-value=x]')
    pg.wait_for_timeout(300)
    check('rotate works', pg.locator('#partList li[data-id]').count() >= 2)
    # bed size marks parts too big
    pg.fill('input[data-bed=w]', '20'); pg.press('input[data-bed=w]', 'Tab')
    pg.wait_for_timeout(200)
    check('bed size flags parts', 'too big' in pg.inner_text('#partsMeta'))
    pg.fill('input[data-bed=w]', '220'); pg.press('input[data-bed=w]', 'Tab')

    # hide / rename
    pg.locator('#partList [data-act=toggle-vis]').first.click()
    check('hide toggles', pg.locator('#partList li.is-hidden').count() == 1)
    pg.locator('#partList .part-name').first.dblclick()
    pg.fill('#partList input.rename', 'Torso')
    pg.press('#partList input.rename', 'Enter')
    check('rename works', 'Torso' in pg.locator('#partList .part-name').all_inner_texts())

    # export
    with pg.expect_download() as dl:
        pg.click('#exportBtn')
    d = dl.value
    data = open(d.path(), 'rb').read()
    z = zipfile.ZipFile(io.BytesIO(data))
    print('    zip:', d.suggested_filename, z.namelist())
    check('zip has one STL per part', len(z.namelist()) == pg.locator('#partList li[data-id]').count() and all(n.endswith('.stl') for n in z.namelist()))
    check('zip integrity', z.testzip() is None)

    pg.screenshot(path=str(OUT / 'shot_parts.png'))
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(OUT / 'shot_mobile.png'), full_page=True)
    pg.emulate_media(color_scheme='dark')
    pg.set_viewport_size({'width': 1440, 'height': 900})
    pg.locator('#partList li[data-id] [data-act=select]').nth(1).click()
    pg.wait_for_timeout(500)
    pg.screenshot(path=str(OUT / 'shot_dark.png'))
    # every setting fits without scrolling on common desktop screens, even in the most crowded case
    pg.click('#partList li[data-id] [data-act=select]'); pg.wait_for_selector('[data-act=cut]')
    pg.click('[data-act=keytype][data-value=peg]'); pg.click('[data-act=shape][data-value=slot]')
    pg.evaluate("() => { const r = document.querySelector('#taperPct'); r.value = 40; r.dispatchEvent(new Event('change', {bubbles:true})); }")
    pg.wait_for_timeout(500)
    for w, h in ((1280, 800), (1366, 768), (1440, 900), (1920, 1080)):
        pg.set_viewport_size({'width': w, 'height': h}); pg.wait_for_timeout(250)
        m = pg.evaluate("(() => { const i = document.querySelector('#inspector'), b = document.querySelector('#planeBar'); return [i.scrollHeight - i.clientHeight, b.scrollWidth - b.clientWidth]; })()")
        check(f'no scrolling needed at {w}×{h}', m[0] <= 1 and m[1] <= 1, m)
    # and with a wide fallback font, in case Barlow doesn't load (as on the CI machine)
    wide = pg.add_style_tag(content="* { font-family: 'DejaVu Sans', 'Verdana', sans-serif !important; }")
    pg.set_viewport_size({'width': 1366, 'height': 768}); pg.wait_for_timeout(250)
    m = pg.evaluate("(() => { const i = document.querySelector('#inspector'), b = document.querySelector('#planeBar'); return [i.scrollHeight - i.clientHeight, b.scrollWidth - b.clientWidth]; })()")
    check('no scrolling at 1366×768 even with a wide fallback font', m[0] <= 1 and m[1] <= 1, m)
    wide.evaluate("el => el.remove()")
    pg.set_viewport_size({'width': 1440, 'height': 900})
    pg.evaluate("() => { const r = document.querySelector('#taperPct'); r.value = 0; r.dispatchEvent(new Event('change', {bubbles:true})); }")
    pg.click('[data-act=shape][data-value=round]')
    pg.wait_for_timeout(600)

    pg.keyboard.press('Escape')
    # cut suggestions on a dumbbell: the bar is found as a narrow point, and clicking it puts the cut there
    pg.set_viewport_size({'width': 1440, 'height': 900})
    dumbbell_stl(str(OUT / 'dumbbell.stl'))
    pg.set_input_files('#fileInput', str(OUT / 'dumbbell.stl'))
    pg.wait_for_function("document.querySelectorAll('#partList li[data-id]').length === 1 && document.querySelector('#partList .part-name').innerText.includes('dumbbell')", timeout=20000)
    pg.click('#partList li[data-id] [data-act=select]')
    pg.wait_for_selector('[data-act=find-cuts]')
    check('suggestions start with a find button and an explanation, in the left panel', 'narrow points like wrists' in pg.inner_text('#suggestPanel') and pg.locator('#suggestPanel [data-act=find-cuts]').count() == 1)
    pg.click('[data-act=find-cuts]')
    pg.wait_for_timeout(50)
    pg.wait_for_selector('.suggest-list, .suggest p:has-text("No clear")', timeout=30000)
    items = pg.locator('.suggest-list [data-act=suggest]')
    print('    suggestions:', [s.replace('\n', ' ') for s in items.all_inner_texts()])
    texts = items.all_inner_texts()
    neck = next((i for i, s in enumerate(texts) if 'Narrow point' in s), -1)
    check('the bar is found as a narrow point about 5 mm across', neck >= 0 and 'About 5' in texts[neck], texts)
    check('the seams where the bar meets the balls are found too', sum('Seam or panel line' in s for s in texts) >= 2, texts)
    check('each suggestion has a pin on the model', pg.locator('#suggestPins .suggest-pin').count() == items.count())
    before = pg.inner_text('#tiltOut')
    pg.locator('#suggestPins .suggest-pin').nth(max(neck, 0)).click()
    pg.wait_for_timeout(700)
    after = pg.inner_text('#tiltOut')
    print('    cut after choosing it:', after)
    check('choosing a suggestion moves the cut there', after != before and items.nth(max(neck, 0)).get_attribute('aria-pressed') == 'true', (before, after))
    ins = pg.inner_text('#inspector')
    check('keys checked at the suggested cut', 'ready' in ins or 'No room' in ins, ins[-300:])
    pg.click('[data-act=cut]')
    pg.wait_for_function("document.querySelectorAll('#partList li[data-id]').length === 2", timeout=15000)
    check('cutting at the narrow point gives the two halves', pg.locator('#partList li[data-id]').count() == 2)
    pg.locator('#partList li[data-id] [data-act=select]').first.click()
    pg.wait_for_selector('[data-act=find-cuts]')
    check('each piece gets its own suggestions', pg.locator('.suggest-list').count() == 0)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    pg.locator('#partList li[data-id] [data-act=select]').first.click(); pg.wait_for_timeout(400)
    check('suggestions are remembered for the part', pg.locator('.suggest-list [data-act=suggest]').count() == items.count())
    pg.screenshot(path=str(OUT / 'shot_suggest.png'))
    # surface regions: where the surface turns sharply, like polygroups; the dumbbell's balls and bar meet at sharp seams
    check('surface regions start hidden', not pg.is_visible('#regionsPanel') and pg.get_attribute('#regionsBtn', 'aria-pressed') == 'false')
    pg.click('#regionsBtn')
    pg.wait_for_selector('#regionsPanel:not([hidden])', timeout=15000); pg.wait_for_timeout(300)
    count = pg.inner_text('#regionsCount')
    print('    surface regions:', count)
    check('showing surface regions counts them', pg.get_attribute('#regionsBtn', 'aria-pressed') == 'true' and 'region' in count and int(count.split()[0]) >= 3, count)
    # the hidden cut plane can't be grabbed: a drag where it would be orbits the view instead of tilting it
    if pg.locator('[data-act=cut]').count() == 0:
        pg.locator('#partList li[data-id] [data-act=select]').first.click(); pg.wait_for_timeout(400)
    if pg.is_visible('#regionsPanel'):
        pg.click('#regionsBtn'); pg.wait_for_timeout(300)
    a0 = pg.evaluate("[...document.querySelectorAll('[data-angle]')].map(e => e.value).join(',')")
    pg.click('#regionsBtn'); pg.wait_for_selector('#regionsPanel:not([hidden])', timeout=15000)
    cx0, cy0 = pg.evaluate("KeymasterDebug.sheetScreenPoint(0.6, 0.2)")
    pg.mouse.move(cx0, cy0); pg.mouse.down()
    for i in range(1, 10): pg.mouse.move(cx0, cy0 - 9 * i)
    chip = pg.is_visible('#dragChip')
    pg.mouse.up(); pg.wait_for_timeout(300)
    check('with regions showing, dragging where the plane was does not tilt it', not chip and not pg.is_visible('#planeBar'), chip)
    pg.click('#regionsBtn'); pg.wait_for_timeout(300)
    a1 = pg.evaluate("[...document.querySelectorAll('[data-angle]')].map(e => e.value).join(',')")
    check('…and the plane is where it was, with its toolbar back', pg.is_visible('#planeBar') and a1 == a0, (a0, a1))
    pg.click('#regionsBtn'); pg.wait_for_selector('#regionsPanel:not([hidden])', timeout=15000)
    check('the cut preview steps aside while regions show', not pg.is_visible('#areaTags [data-area-tag]') or pg.locator('#areaTags[hidden]').count() == 1)
    pg.evaluate("() => { const r = document.querySelector('#regionsAngle'); r.value = 80; r.dispatchEvent(new Event('input', {bubbles:true})); r.dispatchEvent(new Event('change', {bubbles:true})); }")
    pg.wait_for_timeout(500)
    count80 = pg.inner_text('#regionsCount')
    check('a higher threshold finds no more regions', int(count80.split()[0]) <= int(count.split()[0]) and '80°' in pg.inner_text('#regionsAngleOut'), (count, count80))
    n_parts = pg.locator('#partList li[data-id]').count()
    if pg.locator('[data-act=cut]').count() == 0:
        pg.locator('#partList li[data-id] [data-act=select]').first.click()
    pg.wait_for_selector('[data-act=cut]'); pg.wait_for_timeout(500)
    pg.click('[data-act=cut]')
    pg.wait_for_function(f"document.querySelectorAll('#partList li[data-id]').length > {n_parts}", timeout=15000)
    check('cutting turns the regions off and cuts as usual', pg.get_attribute('#regionsBtn', 'aria-pressed') == 'false' and not pg.is_visible('#regionsPanel'))
    pg.click('#regionsBtn'); pg.wait_for_selector('#regionsPanel:not([hidden])', timeout=15000)
    check('each piece gets its own regions after a cut', 'region' in pg.inner_text('#regionsCount'))
    pg.click('#regionsBtn'); pg.wait_for_timeout(200)
    check('regions toggle off', not pg.is_visible('#regionsPanel'))

    # curved cut along a border: the seam where the dumbbell's bar meets a ball goes all the way round
    import math
    pg.set_input_files('#fileInput', str(OUT / 'dumbbell.stl'))
    pg.wait_for_function("document.querySelectorAll('#partList li[data-id]').length === 1", timeout=20000)
    pg.click('#regionsBtn'); pg.wait_for_selector('#regionsPanel:not([hidden])', timeout=15000); pg.wait_for_timeout(300)
    pg.evaluate("() => { const r = document.querySelector('#regionsAngle'); r.value = 35; r.dispatchEvent(new Event('input', {bubbles:true})); r.dispatchEvent(new Event('change', {bubbles:true})); }")
    pg.wait_for_timeout(400)
    check('with regions on, the hint says to click a border line', 'border line' in pg.inner_text('#hint') and 'Click a dark border line' in pg.inner_text('#cutLineInfo'))
    ax = [0.55, 0.3, 0.78]; L = math.sqrt(sum(v * v for v in ax)); ax = [v / L for v in ax]
    u = [ax[1], -ax[0], 0]; L = math.sqrt(sum(v * v for v in u)); u = [v / L for v in u]
    z = 12 + math.sqrt(144 - 2.5 ** 2)  # where the 5 mm bar meets the first ball
    seam = [ax[k] * z + u[k] * 2.5 for k in range(3)]
    res = pg.evaluate(f"KeymasterDebug.pickCutLineAt(0, {seam})")
    pg.wait_for_timeout(200)
    info = pg.inner_text('#cutLineInfo')
    print('    picked line:', res, info.replace('\n', ' ')[:140])
    check('clicking the seam picks a line all the way round, ready to cut', bool(res) and res['closed'] and res['ok'] and 'all the way round' in info and pg.locator('[data-act=cut-line]').count() == 1, (res, info))
    pg.click('[data-act=cut-line]')
    pg.wait_for_function("document.querySelectorAll('#partList li[data-id]').length === 2", timeout=15000)
    names = pg.locator('#partList .part-name').all_inner_texts()
    check('cutting along the line gives two pieces', len(names) == 2 and all(n.endswith((' A', ' B')) for n in names), names)
    check('regions stay on to keep cutting', pg.get_attribute('#regionsBtn', 'aria-pressed') == 'true' and 'Cut along the line' in pg.inner_text('#toast'))
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    check('undo puts the dumbbell back together', pg.locator('#partList li[data-id]').count() == 1)
    res2 = pg.evaluate("KeymasterDebug.pickCutLineAt(0, [500, 500, 500])")
    pg.wait_for_timeout(200)
    check('a click far from any line says where to click', res2 is None and 'border lines' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    pg.evaluate(f"KeymasterDebug.pickCutLineAt(0, {seam})"); pg.wait_for_timeout(100)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
    check('Esc drops the picked line', pg.locator('[data-act=cut-line]').count() == 0)
    # keys on a curved cut: an arm in a sleeve, cut at the hem, gets pegs sized to fit
    import math as _m
    def arm_r(z):
        if z < 2: return max(0.3, z * 4)
        if z < 40: return 8
        if z < 41: return 8 - (z - 40) * 2.5
        if z < 78: return 5.5
        return max(0.3, 5.5 * _m.sqrt(max(0, 1 - ((z - 78) / 2) ** 2)))
    lathe_stl(str(OUT / 'sleeve.stl'), arm_r, 80)
    pg.set_input_files('#fileInput', str(OUT / 'sleeve.stl'))
    pg.wait_for_function("document.querySelector('#partList .part-name') && document.querySelector('#partList .part-name').innerText.includes('sleeve')", timeout=20000)
    if not pg.is_visible('#regionsPanel'):
        pg.click('#regionsBtn'); pg.wait_for_selector('#regionsPanel:not([hidden])', timeout=15000)
    pg.wait_for_timeout(300)
    res = pg.evaluate("KeymasterDebug.pickCutLineAt(0, [8, 0, 40])")
    pg.wait_for_timeout(200)
    info = pg.inner_text('#cutLineInfo')
    print('    sleeve hem:', res, info.replace('\n', ' ')[:160])
    check('the hem line comes with pegs sized to fit', bool(res) and res['ok'] and 'sized to fit' in info and ' peg' in info, info)
    pg.click('[data-act=cut-line]')
    pg.wait_for_function("document.querySelectorAll('#partList li[data-id]').length === 2", timeout=15000)
    check('cutting along the hem with keys gives the sleeve and the arm', pg.locator('#partList li[data-id]').count() == 2)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    pg.click('#regionsBtn'); pg.wait_for_timeout(200)
    pg.click('#partList li[data-id] [data-act=select]'); pg.wait_for_selector('[data-act=cut]')
    pg.click('[data-act=keytype][data-value=dowel]'); pg.wait_for_timeout(300)
    pg.click('#regionsBtn'); pg.wait_for_selector('#regionsPanel:not([hidden])', timeout=15000)
    pg.evaluate("KeymasterDebug.pickCutLineAt(0, [8, 0, 40])"); pg.wait_for_timeout(200)
    check('dowels on a curved cut', 'dowel' in pg.inner_text('#cutLineInfo') and 'sized to fit' in pg.inner_text('#cutLineInfo'), pg.inner_text('#cutLineInfo'))
    pg.click('[data-act=cut-line]')
    pg.wait_for_function("document.querySelectorAll('#partList li[data-id]').length > 2", timeout=15000)
    check('a curved cut with dowels makes the pins too', any('pin' in n_ for n_ in pg.locator('#partList .part-name').all_inner_texts()) and 'dowel pins' in pg.inner_text('#toast'))
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    pg.click('#regionsBtn'); pg.wait_for_timeout(200)
    pg.click('#partList li[data-id] [data-act=select]'); pg.wait_for_selector('[data-act=cut]')
    pg.click('[data-act=keytype][data-value=peg]'); pg.wait_for_timeout(200)
    pg.screenshot(path=str(OUT / 'shot_curved.png'))
    pg.keyboard.press('Escape')
    # a cut that would leave a sliver too thin to print is held back, and says which area and how to fix it
    boxes_stl(str(OUT / 'towers.stl'), [(0, 0, 0, 10, 10, 20), (20, 0, 0, 28, 10, 10.5)])
    pg.set_input_files('#fileInput', str(OUT / 'towers.stl'))
    pg.wait_for_function("document.querySelector('#partList .part-name') && document.querySelector('#partList .part-name').innerText.includes('towers')", timeout=20000)
    if pg.get_attribute('#regionsBtn', 'aria-pressed') == 'true': pg.click('#regionsBtn'); pg.wait_for_timeout(200)
    pg.click('#partList li[data-id] [data-act=select]'); pg.wait_for_selector('[data-act=cut]')
    pg.keyboard.press('z'); pg.wait_for_timeout(300)
    pg.fill('#cutPosNum', '-0.25'); pg.press('#cutPosNum', 'Tab'); pg.wait_for_timeout(700)
    foot = pg.inner_text('#keyStatus')
    print('    thin:', foot.replace('\n', ' ')[:200])
    check('a cut just under the top of the short tower warns that it would leave a sliver', 'would leave a sliver thinner than' in foot and 'too thin to print' in foot and 'area 2' in foot, foot)
    tag = pg.locator('#areaTags [data-area-tag="1"]')
    check('the area’s label in the view says too thin', 'too thin' in tag.inner_text(), tag.inner_text())
    pg.click('[data-act=cut]'); pg.wait_for_timeout(300)
    check('cutting it is held back, with the reason', 'too thin to print' in pg.inner_text('#toast') and pg.locator('#partList li[data-id]').count() == 1, pg.inner_text('#toast'))
    pg.click('#keyStatus [data-act=join-thin]'); pg.wait_for_timeout(300)
    check('one click leaves that area joined, and the warning goes', tag.get_attribute('aria-pressed') == 'false' and 'sliver' not in pg.inner_text('#keyStatus'), pg.inner_text('#keyStatus'))
    pg.click('[data-act=cut]')
    pg.wait_for_function("document.querySelectorAll('#partList li[data-id]').length >= 2", timeout=15000)
    check('then the cut goes through the tall tower only', pg.locator('#partList li[data-id]').count() >= 2 and 'Cut into' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    pg.click('#partList li[data-id] [data-act=select]'); pg.wait_for_selector('[data-act=cut]')
    pg.keyboard.press('z'); pg.wait_for_timeout(300)
    pg.fill('#cutPosNum', '3'); pg.press('#cutPosNum', 'Tab'); pg.wait_for_timeout(700)
    check('a cut lower down, through both towers, is fine', 'sliver' not in pg.inner_text('#keyStatus'), pg.inner_text('#keyStatus'))
    pg.screenshot(path=str(OUT / 'shot_thin.png'))
    pg.keyboard.press('Escape')
    b.close()

print('\nconsole errors:', errors if errors else 'none')
bad = [r for r in results if not r[1]]
print(f"{len(results) - len(bad)} passed, {len(bad)} failed")
sys.exit(1 if bad or errors else 0)
