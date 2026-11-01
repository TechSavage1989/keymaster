// Stress-test the geometry engine on real model files: many cuts at different angles and positions, with and
// without keys, checking that every part is a closed solid and (without keys) that volume is conserved.
//
//   node tools/sculpt_check.js model1.stl model2.obj ...      (set POSITIONS=40 for a denser sweep)
//
//   MIN_WALL=1.2   also hold every cut to the printability rules the app uses (no piece thinner than this)
//   CURVED=1       also cut along every closed region line, as the app's curved cuts do
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
const reasonOf = (e) => ({ thin: 'too thin', crack: 'only a crack', locked: 'would hook together' })[e.code] || (/dip or hollow/.test(e.message) ? 'round a dip' : /wouldn’t split/.test(e.message) ? 'doesn’t split the part' : 'other');
const tally = (m, k) => { m[k] = (m[k] || 0) + 1; };
let total = 0, unsealed = 0, refused = 0, retried = 0, slowest = 0;
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
      for (const cfg of [{ type: 'none' }, [peg('round', 20, true), peg('dshape', 100, true), peg('square', 100, false)][k % 3]]) {
        const cf = { shape: 'round', diameter: 5, length: 6, clearance: 0.2, margin: 1.2, taper: false, pegSide: 'below', ...cfg };
        const an = K.analyzePlane(m.positions, m.indices, F, cf, scale);
        if (an.base.error || !an.base.regions.length) continue;
        n++; total++;
        const keys = cf.type === 'none' ? [] : K.autoPlaceKeys(an, cf, 2, new Set());
        t = Date.now();
        let r;
        try { r = K.cutMesh(m.positions, m.indices, F, { scale, cfg: cf, keys, minThickness }); } catch (e) {
          refused++; fr++; tally(why, reasonOf(e)); tally(reasons, reasonOf(e));
          if (reasonOf(e) === 'other' && fr <= 3) console.log(`  refused: dir ${d0} position ${k}: ${e.message}`);
          continue;
        }
        slowest = Math.max(slowest, Date.now() - t);
        if (r.retries) retried++;
        const sealed = r.parts.concat(r.pins).every(p => K.edgeReport(p.indices).closed && K.volume(p.positions, p.indices) > 0);
        const vol = r.parts.reduce((a, p) => a + K.volume(p.positions, p.indices), 0);
        if (!sealed || (cf.type === 'none' && Math.abs(vol - V0) / V0 > 1e-5)) { unsealed++; fu++; if (fu <= 3) console.log(`  NOT SEALED: dir ${d0} position ${k} ${cf.type}`); }
      }
    }
  }
  console.log(`  ${n} flat cuts: ${fu} not sealed, ${fr} refused${fr ? ` (${Object.entries(why).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}`);
  if (curved) {
    const seg = K.segmentSurface(m.positions, m.indices, { angle: 35 });
    const lines = K.cutLines(m.positions, m.indices, seg).filter(l => l.closed);
    let cu = 0, cr = 0;
    const cwhy = {};
    for (const l of lines) {
      total++;
      t = Date.now();
      let r;
      try { r = K.cutAlongLoop(m.positions, m.indices, l, { minThickness }); } catch (e) { refused++; cr++; tally(cwhy, reasonOf(e)); tally(reasons, reasonOf(e)); continue; }
      slowest = Math.max(slowest, Date.now() - t);
      const vol = r.parts.reduce((a, p) => a + p.volume, 0);
      if (!r.parts.every(p => K.edgeReport(p.indices).closed && p.volume > 0) || Math.abs(vol - V0) / V0 > 1e-5) { unsealed++; cu++; }
    }
    console.log(`  ${lines.length} curved cuts along region lines: ${cu} not sealed, ${cr} refused${cr ? ` (${Object.entries(cwhy).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}`);
  }
}
console.log(`\n${total} cuts, ${unsealed} not sealed, ${refused} refused with a message${refused ? ` (${Object.entries(reasons).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}, ${retried} needed a nudge, slowest ${slowest} ms`);
process.exit(unsealed ? 1 : 0);
