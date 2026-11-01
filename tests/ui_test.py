import sys, zipfile, io, time
from pathlib import Path
HERE = Path(__file__).resolve().parent
OUT = HERE / 'output'
OUT.mkdir(exist_ok=True)
PAGE = (HERE / 'test.html').as_uri()
from playwright.sync_api import sync_playwright

errors = []
results = []
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
    check('cut panel shown', 'Cut plane' in ins and 'Keys' in ins)
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

    # tilt: drag on the plane, check the angle readout and that the arrow gizmo is detached
    check('angle starts square', 'Square to' in pg.inner_text('#tiltOut'), pg.inner_text('#tiltOut'))
    pg.click('[data-act=gizmo][data-value=rotate]')
    pg.wait_for_timeout(150)
    check('tilt mode explains dragging', 'Drag anywhere on the yellow plane' in pg.inner_text('#inspector'))
    pg.wait_for_timeout(300)
    check('tilt mode stays on', pg.get_attribute('[data-act=gizmo][data-value=rotate]', 'aria-pressed') == 'true' and 'tip it' in pg.inner_text('#hint'), pg.inner_text('#hint'))
    box = pg.locator('#stage canvas').bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    pg.mouse.move(cx + 120, cy + 10)
    pg.mouse.down()
    for i in range(1, 11):
        pg.mouse.move(cx + 120, cy + 10 - 8 * i)
    pg.mouse.up()
    pg.wait_for_timeout(400)
    tilt = pg.inner_text('#tiltOut')
    check('dragging the plane tilts it', '° off' in tilt, tilt)
    print('    after drag:', tilt)
    ins = pg.inner_text('#inspector')
    check('keys re-checked after tilt', 'ready' in ins or 'attention' in ins or 'No room' in ins, ins[-300:])
    # shift drag is finer
    pg.mouse.move(cx + 120, cy - 70)
    pg.keyboard.down('Shift'); pg.mouse.down()
    for i in range(1, 11):
        pg.mouse.move(cx + 120, cy - 70 - 8 * i)
    pg.mouse.up(); pg.keyboard.up('Shift')
    pg.wait_for_timeout(300)
    t2 = pg.inner_text('#tiltOut')
    print('    after shift drag:', t2)
    d1 = float(tilt.split('°')[0]); d2 = float(t2.split('°')[0]) if '°' in t2 else 0
    check('shift drag adds a smaller tilt', 0 < abs(d2 - d1) < d1, (d1, d2))
    pg.click('[data-act=straighten]')
    pg.wait_for_timeout(300)
    check('straighten snaps square', 'Square to' in pg.inner_text('#tiltOut'), pg.inner_text('#tiltOut'))
    pg.click('[data-act=gizmo][data-value=translate]')
    pg.wait_for_timeout(300)

    # slider moves plane
    before = pg.inner_text('#cutPosOut')
    pg.evaluate("""() => { const r = document.querySelector('#cutPos'); r.value = (parseFloat(r.min) + parseFloat(r.max)) / 2 + (parseFloat(r.max) - parseFloat(r.min)) * 0.12; r.dispatchEvent(new Event('input', {bubbles:true})); r.dispatchEvent(new Event('change', {bubbles:true})); }""")
    pg.wait_for_timeout(500)
    after = pg.inner_text('#cutPosOut')
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
    check('dowel pins created', any('pin' in n for n in names2))

    # magnets, square, custom size, selective area if possible
    pg.locator('#partList li[data-id] [data-act=select]').nth(1).click()
    pg.wait_for_selector('[data-act=cut]')
    pg.click('[data-act=keytype][data-value=magnet]')
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
    b.close()

print('\nconsole errors:', errors if errors else 'none')
bad = [r for r in results if not r[1]]
print(f"{len(results) - len(bad)} passed, {len(bad)} failed")
sys.exit(1 if bad or errors else 0)
