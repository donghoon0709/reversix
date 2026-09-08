// Minimal inference for the trained Reversix network.
// BatchNorm was folded into the convolutions at export time, so a forward pass is
// just conv -> bias -> relu, plus residual adds. Weights are [outC][inC][kh][kw].

const relu = a => { for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0; return a }

function conv3(src, cin, cout, w, b, N) {
  const HW = N * N, out = new Float32Array(cout * HW)
  for (let oc = 0; oc < cout; oc++) {
    const ob = oc * HW, bias = b[oc]
    out.fill(bias, ob, ob + HW)
    for (let ic = 0; ic < cin; ic++) {
      const ib = ic * HW, wb = (oc * cin + ic) * 9
      for (let kr = 0; kr < 3; kr++) {
        const dr = kr - 1
        // rows where both source and destination stay on the board
        const r0 = dr < 0 ? 1 : 0, r1 = dr > 0 ? N - 1 : N
        for (let kc = 0; kc < 3; kc++) {
          const k = w[wb + kr * 3 + kc]
          if (k === 0) continue
          const dc = kc - 1
          const c0 = dc < 0 ? 1 : 0, c1 = dc > 0 ? N - 1 : N
          for (let r = r0; r < r1; r++) {
            const orow = ob + r * N, srow = ib + (r + dr) * N + dc
            for (let c = c0; c < c1; c++) out[orow + c] += k * src[srow + c]   // no bounds checks
          }
        }
      }
    }
  }
  return out
}

function conv1(src, cin, cout, w, b, N) {
  const HW = N * N, out = new Float32Array(cout * HW)
  for (let oc = 0; oc < cout; oc++) {
    const ob = oc * HW, bias = b[oc]
    for (let i = 0; i < HW; i++) out[ob + i] = bias
    for (let ic = 0; ic < cin; ic++) {
      const k = w[oc * cin + ic]
      if (k === 0) continue
      const ib = ic * HW
      for (let i = 0; i < HW; i++) out[ob + i] += k * src[ib + i]
    }
  }
  return out
}

export class ReversixNet {
  constructor(meta, flat) {
    this.meta = meta
    this.t = {}
    let off = 0
    for (const { name, shape } of meta.tensors) {
      const n = shape.reduce((a, b) => a * b, 1)
      this.t[name] = flat.subarray(off, off + n)
      off += n
    }
    if (off !== flat.length) throw new Error(`weight blob size mismatch: ${off} vs ${flat.length}`)
  }

  static async load(base) {
    const [meta, buf] = await Promise.all([
      fetch(`${base}.json`).then(r => r.json()),
      fetch(`${base}.bin`).then(r => r.arrayBuffer()),
    ])
    return new ReversixNet(meta, new Float32Array(buf))
  }

  /** planes: Float32Array(P*N*N) -> { policy: Float32Array(N*N), value } */
  forward(planes) {
    const { ch, blocks, planes: P, board: N } = this.meta
    const HW = N * N, t = this.t
    let h = relu(conv3(planes, P, ch, t['stem.w'], t['stem.b'], N))
    for (let i = 0; i < blocks; i++) {
      const y1 = relu(conv3(h, ch, ch, t[`blk${i}.c1.w`], t[`blk${i}.c1.b`], N))
      const y2 = conv3(y1, ch, ch, t[`blk${i}.c2.w`], t[`blk${i}.c2.b`], N)
      for (let j = 0; j < y2.length; j++) y2[j] += h[j]
      h = relu(y2)
    }
    const p0 = relu(conv1(h, ch, 32, t['ph0.w'], t['ph0.b'], N))
    const policy = conv1(p0, 32, 1, t['ph3.w'], t['ph3.b'], N)

    const v0 = relu(conv1(h, ch, 32, t['vh0.w'], t['vh0.b'], N))
    const pooled = new Float32Array(32)
    for (let c = 0; c < 32; c++) {
      let s = 0
      for (let i = 0; i < HW; i++) s += v0[c * HW + i]
      pooled[c] = s / HW
    }
    const hid = new Float32Array(64)
    for (let o = 0; o < 64; o++) {
      let s = t['vf0.b'][o]
      for (let i = 0; i < 32; i++) s += t['vf0.w'][o * 32 + i] * pooled[i]
      hid[o] = s > 0 ? s : 0
    }
    let v = t['vf2.b'][0]
    for (let i = 0; i < 64; i++) v += t['vf2.w'][i] * hid[i]
    return { policy, value: Math.tanh(v) }
  }
}
