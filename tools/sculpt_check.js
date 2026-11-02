// Stress-test the geometry engine on real model files: many cuts at different angles and positions, with and
// without keys, checking that every part is a closed solid and (without keys) that volume is conserved.
//
//   node tools/sculpt_check.js model1.stl model2.obj ...      (set POSITIONS=40 for a denser sweep)
//
//   MIN_WALL=1.2   also hold every cut to the printability rules the app uses (no piece thinner than this)
//   CURVED=1       also cut along every closed region line, as the app's curved cuts do, without keys and then
//                  with pegs sized to fit (resin sizes), and with a plug; and split off every region over 1% of
//                  the surface along its whole outline
//
// Refusals are counted by reason: too thin, only a crack, pieces that would hook together, or other. A refusal is
// fine (the app explains it); a part that isn't sealed is a bug.
//
// Model files stay on your machine; nothing is uploaded. Don't commit other people's models to the repo.
const K = require('../src/core.js');
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) { console.log('usage: node tools/sculpt_check.js model.stl [more files]'); process.exit(1); }
const N = +(process.env.POSITIONS || 13), minThickness = +(process.env.MIN_WALL || 0), curved = !!process.env.CURVED;
const dirs = [[0, 0, 1], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0.3, -0.2, 1], [1, 0.4, 0.7], [-0.5, 1, 0.25]];
const peg = (shape, taper, taperSocket) => ({ type: 'peg', shape, diameter: 5, length: 6, clearance: 0.2, margin: 1.2, taper, taperSocket, pegSide: 'below' });
const reasonOf = (e) => (e.code === 'locked' && /held at more than one end/.test(e.message) ? 'held at both ends' : { thin: 'too thin', crack: 'only a crack', locked: 'would hook together' }[e.code]) || (/dip or hollow/.test(e.message) ? 'round a dip' : /wouldn’t split|wouldn’t free/.test(e.message) ? 'doesn’t split the part' : /pinches/.test(e.message) ? 'outline pinches' : 'other');
const tally = (m, k) => { m[k] = (m[k] || 0) + 1; };
let total = 0, unsealed = 0, refused = 0, retried = 0, slowest = 0, plugged = 0;
const reasons = {};

for (const f of files) {
  const buf = fs.readFileSync(f);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let t = Date.now();
  const raw = /\.obj$/i.test(f) ? K.parseOBJ(new TextDecoder().decode(ab)) : K.parseSTL(ab);
  const m = K.prepareMesh(raw);
  const b = K.bounds(m.positions), scale = K.diag(b), V0 = m.report.volume;
  console.log(`\n${f}: ${m.indices.length / 3} triangles, ${b.size.map(v => v.toFixed(1)).join(' x ')} mm, open in ${Date.now() - t} ms`);
  console.log(`  surface: ${m.report.closed ? 'closed' : `${m.report.openEdges} open edges`}${m.report.flipped ? ', was inside out' : ''}${m.report.specks ? `, ${m.report.specks} specks removed` : ''}`);
  let fu = 0, fr = 0, n = 0;
  const why = {};
  for (const d0 of dirs) {
    const L = Math.hypot(...d0), d = d0.map(v => v / L);
    const ext = [0, 1, 2].map(i => b.size[i] * Math.abs(d[i])).reduce((s, v) => s + v, 0);
    for (let k = 1; k <= N; k++) {
      const F = K.frameFromNormal(d, b.center.map((c, i) => c + d[i] * (-ext / 2 + ext * (k - 0.37) / (N + 1))));
      for (const cfg of [{ type: 'none' }, [peg('round', 20, true), peg('dshape', 100, true), peg('square', 100, false)][k % 3], { type: 'plug', clearance: 0.1, margin: 1.2, plugSlope: 5, pegSide: k % 2 ? 'above' : 'below' }]) {
        const cf = { shape: 'round', diameter: 5, length: 6, clearance: 0.2, margin: 1.2, taper: false, pegSide: 'below', ...cfg };
        const an = K.analyzePlane(m.positions, m.indices, F, cf, scale);
        if (an.base.error || !an.base.regions.length) continue;
        n++; total++;
        const keys = cf.type === 'none' || cf.type === 'plug' ? [] : K.autoPlaceKeys(an, cf, 2, new Set()), plugs = cf.type === 'plug' ? K.planPlugs(an, cf) : [];
        t = Date.now();
        let r;
        try { r = K.cutMesh(m.positions, m.indices, F, { scale, cfg: cf, keys, plugs, minThickness }); } catch (e) {
          refused++; fr++; tally(why, reasonOf(e)); tally(reasons, reasonOf(e));
          if (reasonOf(e) === 'other' && fr <= 3) console.log(`  refused: dir ${d0} position ${k}: ${e.message}`);
          continue;
        }
        slowest = Math.max(slowest, Date.now() - t);
        if (r.retries) retried++;
        const sealed = r.parts.concat(r.pins).every(p => K.edgeReport(p.indices).closed && K.volume(p.positions, p.indices) > 0);
        const vol = r.parts.reduce((a, p) => a + K.volume(p.positions, p.indices), 0);
        if (plugs.some(q => q.ok)) plugged++;
        if (!sealed || (cf.type === 'none' && Math.abs(vol - V0) / V0 > 1e-5)) { unsealed++; fu++; if (fu <= 3) console.log(`  NOT SEALED: dir ${d0} position ${k} ${cf.type}`); }
      }
    }
  }
  console.log(`  ${n} flat cuts: ${fu} not sealed, ${fr} refused${fr ? ` (${Object.entries(why).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}`);
  if (curved) {
    const seg = K.segmentSurface(m.positions, m.indices, { angle: 60, fold: 15 });
    const lines = K.cutLines(m.positions, m.indices, seg).filter(l => l.closed);
    let cu = 0, cr = 0, keyed = 0, ku = 0, pl = 0;
    const cwhy = {}, kcfg = { type: 'peg', shape: 'round', diameter: 5, length: 6, clearance: 0.1, margin: 0.8, taper: 20, taperSocket: true, pegSide: 'below', sizeMode: 'auto', sizeMin: 1, sizeMax: 5, printer: 'resin' };
    for (const l of lines) {
      total++;
      t = Date.now();
      let r;
      try { r = K.cutAlongLoop(m.positions, m.indices, l, { minThickness }); } catch (e) { refused++; cr++; tally(cwhy, reasonOf(e)); tally(reasons, reasonOf(e)); continue; }
      slowest = Math.max(slowest, Date.now() - t);
      const vol = r.parts.reduce((a, p) => a + p.volume, 0);
      if (!r.parts.every(p => K.edgeReport(p.indices).closed && p.volume > 0) || Math.abs(vol - V0) / V0 > 1e-5) { unsealed++; cu++; }
      const an = K.analyzeLoop(m.positions, m.indices, l, kcfg, scale), ks = K.autoFitKeys(an, kcfg, 2, new Set()), ev = K.evaluateKeys(an, ks, kcfg, new Set());
      const good = ks.filter((k, i) => ev[i].ok);
      if (good.length) {
        total++;
        try {
          r = K.cutAlongLoop(m.positions, m.indices, l, { cfg: kcfg, keys: good, minThickness });
          keyed++;
          if (!r.parts.every(p => K.edgeReport(p.indices).closed && p.volume > 0)) { unsealed++; ku++; }
        } catch (e) { refused++; tally(reasons, reasonOf(e)); }
      }
      const pc = { type: 'plug', clearance: 0.1, margin: 0.8, plugSlope: 5, pegSide: 'below' }, pls = K.planPlugs(K.analyzeLoop(m.positions, m.indices, l, pc, scale), pc);
      if (!pls.some(q => q.ok)) continue;
      total++;
      try { r = K.cutAlongLoop(m.positions, m.indices, l, { cfg: pc, plugs: pls, minThickness }); } catch (e) { refused++; tally(reasons, reasonOf(e)); continue; }
      plugged++; pl++;
      if (!r.parts.every(p => K.edgeReport(p.indices).closed && p.volume > 0)) { unsealed++; ku++; }
    }
    console.log(`  ${lines.length} curved cuts along region lines: ${cu} not sealed, ${cr} refused${cr ? ` (${Object.entries(cwhy).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}; ${keyed} cut with pegs and ${pl} with a plug, ${ku} of those not sealed`);
    const surface = seg.areas.reduce((s, a) => s + a, 0), rwhy = {};
    let rn = 0, ru = 0, rr = 0;
    for (let g = 0; g < seg.count; g++) {
      if (seg.areas[g] < 0.01 * surface) continue;
      rn++; total++;
      let r;
      try { r = K.splitRegion(m.positions, m.indices, seg, g, { minThickness }); } catch (e) { refused++; rr++; tally(rwhy, reasonOf(e)); tally(reasons, reasonOf(e)); continue; }
      const vol = r.parts.reduce((a, p) => a + p.volume, 0);
      if (!r.parts.every(p => K.edgeReport(p.indices).closed && p.volume > 0) || Math.abs(vol - V0) / V0 > 1e-5) { unsealed++; ru++; }
    }
    console.log(`  ${rn} regions split off along their outlines: ${ru} not sealed, ${rr} refused${rr ? ` (${Object.entries(rwhy).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}`);
  }
}
console.log(`\n${total} cuts (${plugged} with plugs), ${unsealed} not sealed, ${refused} refused with a message${refused ? ` (${Object.entries(reasons).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}, ${retried} needed a nudge, slowest ${slowest} ms`);
process.exit(unsealed ? 1 : 0);
