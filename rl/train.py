"""AlphaZero-style training loop for Reversix (Gumbel search, MPS/CPU)."""
import argparse, json, os, time
import numpy as np, torch, torch.nn.functional as F
import torch.multiprocessing as mp
import rx, net as netmod, baselines as B
from evaluate import evaluate
from gauge import gauge, load_panel
from selfplay import run_selfplay
from mcts import GumbelSearch
from selfplay import Evaluator


# ---- 8-fold dihedral augmentation. verify_aug.py proves the rules are D4-invariant,
# so every transform of a position is itself a legal position with the transformed policy.
# Applied per batch (kept out of the buffer, which would cost 8x the memory).
def augment_batch(S, P, N, rng):
    """S:(B,C,N,N) float32, P:(B,N*N) float32 -> same shapes, 8 transforms spread over the batch."""
    Pg = P.reshape(-1, N, N)
    bs = len(S)
    chunks = np.array_split(np.arange(bs), 8)
    outS = np.empty_like(S); outP = np.empty_like(Pg)
    for t, idx in enumerate(chunks):
        if len(idx) == 0: continue
        k, flip = t % 4, t // 4
        s = np.rot90(S[idx], k, axes=(2, 3)); p = np.rot90(Pg[idx], k, axes=(1, 2))
        if flip:
            s = s[:, :, :, ::-1]; p = p[:, :, ::-1]
        outS[idx] = s; outP[idx] = p
    return np.ascontiguousarray(outS), np.ascontiguousarray(outP).reshape(bs, N * N)


def _sp_worker(a):
    """Self-play in a separate process (own Python interpreter -> own core)."""
    sd, cfg, ngames, seed = a
    import rx as _rx, net as _net
    from selfplay import run_selfplay as _run
    _rx.configure(cfg["n"], cfg["k"])
    dev = _net.pick_device()
    net = _net.Net(planes=_rx.PLANES, ch=cfg["ch"], blocks=cfg["blocks"]).to(dev)
    net.load_state_dict(sd); net.eval()
    S, P, V, st = _run(net, dev, ngames, cfg["parallel"], cfg["sims"], cfg["m"],
                       temp_moves=12, seed=seed)
    return S.astype(np.uint8), P, V, st          # uint8 keeps the pickle small


def parallel_selfplay(net, cfg, n_games, workers, seed, pool):
    if workers <= 1:
        from selfplay import run_selfplay
        dev = netmod.pick_device()
        S, P, V, st = run_selfplay(net, dev, n_games, cfg["parallel"], cfg["sims"], cfg["m"],
                                   temp_moves=12, seed=seed)
        return S.astype(np.uint8), P, V, st
    sd = {k: v.detach().cpu() for k, v in net.state_dict().items()}
    per = [n_games // workers + (1 if i < n_games % workers else 0) for i in range(workers)]
    args = [(sd, cfg, per[i], seed + 101 * i) for i in range(workers) if per[i]]
    outs = pool.map(_sp_worker, args)
    S = np.concatenate([o[0] for o in outs]); P = np.concatenate([o[1] for o in outs])
    V = np.concatenate([o[2] for o in outs])
    st = {"B": 0, "W": 0, "D": 0, "turns": [], "plies": []}
    for o in outs:
        for k in ("B", "W", "D"): st[k] += o[3][k]
        st["turns"] += o[3]["turns"]; st["plies"] += o[3]["plies"]
    return S, P, V, st


class Replay:
    """Stores raw (un-augmented) samples; planes are binary so uint8 is exact."""
    def __init__(self, cap):
        self.cap = cap; self.S = self.P = self.V = None
    def add(self, S, P, V):
        S = S.astype(np.uint8, copy=False)
        if self.S is None:
            self.S, self.P, self.V = S, P, V
        else:
            self.S = np.concatenate([self.S, S]); self.P = np.concatenate([self.P, P])
            self.V = np.concatenate([self.V, V])
        if len(self.S) > self.cap:
            self.S = self.S[-self.cap:]; self.P = self.P[-self.cap:]; self.V = self.V[-self.cap:]
    def __len__(self):
        return 0 if self.S is None else len(self.S)
    def nbytes(self):
        return 0 if self.S is None else (self.S.nbytes + self.P.nbytes + self.V.nbytes)


def net_agent(net, device, n_sim, m, seed=0):
    """Wrap the network+search as a turn-level agent for evaluation matches."""
    rng = np.random.default_rng(seed)
    ev = Evaluator(net, device)
    def act(game, _rng):
        s = GumbelSearch(game.copy(), n_sim, m, rng)
        while True:
            item = s.next_leaf()
            if item is None: break
            path, g = item
            if g is None:
                parent, ai = path[-1]; leaf = parent.child[ai]
                w = leaf.game.winner
                v = 0.0 if w == 0 else (1.0 if w == leaf.player else -1.0)
                s.backup(path, v, leaf.player); continue
            lg, vv = ev([g])
            if not path: s.root.expand(lg[0], float(vv[0]))
            else:
                parent, ai = path[-1]; child = parent.child[ai]
                child.expand(lg[0], float(vv[0])); s.backup(path, float(vv[0]), child.player)
        cell, _ = s.result()
        return [cell]
    return act


def score(res, side):
    n = sum(res.values())
    return (res[side] + 0.5 * res[0]) / n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10); ap.add_argument("--k", type=int, default=6)
    ap.add_argument("--ch", type=int, default=64); ap.add_argument("--blocks", type=int, default=6)
    ap.add_argument("--iters", type=int, default=50)
    ap.add_argument("--games", type=int, default=400)
    ap.add_argument("--parallel", type=int, default=192)
    ap.add_argument("--sims", type=int, default=32); ap.add_argument("--m", type=int, default=16)
    ap.add_argument("--buffer", type=int, default=400_000)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--epochs", type=float, default=1.0, help="passes over new (augmented) data")
    ap.add_argument("--steps", type=int, default=0, help="fixed optimiser steps per iteration (0 = derive from --epochs)")
    ap.add_argument("--workers", type=int, default=1, help="self-play processes")
    ap.add_argument("--eval-every", type=int, default=5)
    ap.add_argument("--ckpt-every", type=int, default=2,
                    help="save a numbered checkpoint this often (cheap; feeds the Elo ladder)")
    ap.add_argument("--eval-games", type=int, default=500, help="games per colour")
    ap.add_argument("--eval-parallel", type=int, default=64)
    ap.add_argument("--gauge-games", type=int, default=15,
                    help="games per colour against each Elo reference (0 disables)")
    ap.add_argument("--out", type=str, default="runs/r1")
    ap.add_argument("--resume", type=str, default="")
    ap.add_argument("--save-buffer", type=int, default=200_000,
                    help="how many recent samples to persist for a lossless resume (0 = none)")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    rx.configure(args.n, args.k)
    dev = netmod.pick_device()
    net = netmod.Net(planes=rx.PLANES, ch=args.ch, blocks=args.blocks).to(dev)
    start_iter = 0
    if args.resume and os.path.exists(args.resume):
        ck = torch.load(args.resume, map_location=dev)
        net.load_state_dict(ck["net"]); start_iter = ck.get("iter", 0) + 1
        print(f"resumed from {args.resume} @ iter {start_iter}")
    opt = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-4)
    buf = Replay(args.buffer)
    buf_path = os.path.join(args.out, "buffer.npz")
    if args.resume and os.path.exists(buf_path):
        z = np.load(buf_path)
        buf.add(z["S"].astype(np.float32), z["P"], z["V"])
        print(f"restored replay buffer: {len(buf)} samples")
    cfg = {"n": args.n, "k": args.k, "ch": args.ch, "blocks": args.blocks,
           "parallel": args.parallel, "sims": args.sims, "m": args.m}
    pool = (mp.get_context("spawn").Pool(args.workers) if args.workers > 1 else None)
    panel = load_panel(dev) if args.gauge_games else None
    log_path = os.path.join(args.out, "log.jsonl")
    print(f"device={dev} board={args.n}x{args.n} K={args.k} net=ch{args.ch}x{args.blocks} "
          f"sims={args.sims} m={args.m}", flush=True)

    for it in range(start_iter, args.iters):
        t0 = time.time()
        net.eval()
        S, P, V, st = parallel_selfplay(net, cfg, args.games, args.workers, it * 1000 + 7, pool)
        t_sp = time.time() - t0
        buf.add(S, P, V)

        net.train()
        n_steps = args.steps if args.steps > 0 else max(1, int(args.epochs * 8 * len(S) / args.batch))
        pl = vl = 0.0
        t1 = time.time()
        for _ in range(n_steps):
            i = np.random.randint(0, len(buf), args.batch)
            xs, ps = augment_batch(buf.S[i].astype(np.float32), buf.P[i], args.n, None)
            x = torch.from_numpy(xs).to(dev)
            pt = torch.from_numpy(ps).to(dev)
            vt = torch.from_numpy(buf.V[i]).to(dev)
            logits, v = net(x)
            lp = -(pt * F.log_softmax(logits, dim=1)).sum(1).mean()
            lv = F.mse_loss(v, vt)
            loss = lp + lv
            opt.zero_grad(set_to_none=True); loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
            opt.step()
            pl += lp.item(); vl += lv.item()
        t_tr = time.time() - t1

        rec = {"iter": it, "games": args.games, "samples": len(buf),
               "B": st["B"], "W": st["W"], "D": st["D"],
               "black_share": st["B"] / max(1, st["B"] + st["W"]),
               "turns": float(np.mean(st["turns"])),
               "policy_loss": round(pl / n_steps, 4), "value_loss": round(vl / n_steps, 4),
               "buf_mb": round(buf.nbytes() / 1e6, 1), "steps": n_steps,
               "t_selfplay": round(t_sp, 1), "t_train": round(t_tr, 1),
               "games_per_sec": round(args.games / max(t_sp, 1e-9), 2)}

        if args.eval_every and (it + 1) % args.eval_every == 0:
            net.eval()
            t2 = time.time()
            s_g, b_g, w_g, n_g = evaluate(net, dev, args.eval_games, args.sims, args.m,
                                          seed=it, parallel=args.eval_parallel, opponent="greedy")
            s_r, _, _, n_r = evaluate(net, dev, max(64, args.eval_games // 4), args.sims, args.m,
                                      seed=it + 1, parallel=args.eval_parallel, opponent="random")
            rec["vs_greedy"] = round(s_g, 3)
            rec["vs_greedy_asB"] = round(b_g, 3)
            rec["vs_greedy_asW"] = round(w_g, 3)
            rec["vs_greedy_ci"] = round(1.96 * (0.25 / n_g) ** 0.5, 3)
            rec["vs_random"] = round(s_r, 3)
            rec["eval_n"] = n_g
            if panel:
                t3 = time.time()
                elo, detail = gauge(net, dev, args.sims, args.m,
                                    games=args.gauge_games, seed=it, panel=panel)
                rec["elo"] = round(elo)
                rec["elo_vs"] = {name: round(sc, 3) for name, _, sc, _ in detail}
                rec["t_gauge"] = round(time.time() - t3, 1)
            rec["t_eval"] = round(time.time() - t2, 1)
        # save on even iterations (4, 6, 8, ...) so the Elo ladder gets evenly spaced rungs
        if args.ckpt_every and it % args.ckpt_every == 0:
            torch.save({"net": net.state_dict(), "iter": it, "args": vars(args)},
                       os.path.join(args.out, f"ck_{it:04d}.pt"))
        torch.save({"net": net.state_dict(), "iter": it, "args": vars(args)},
                   os.path.join(args.out, "latest.pt"))
        if args.save_buffer:
            n = min(args.save_buffer, len(buf))
            tmp = buf_path + ".tmp.npz"
            np.savez(tmp, S=buf.S[-n:], P=buf.P[-n:], V=buf.V[-n:])
            os.replace(tmp, buf_path)
        with open(log_path, "a") as f:
            f.write(json.dumps(rec) + "\n")
        print(json.dumps(rec), flush=True)


if __name__ == "__main__":
    mp.set_start_method("spawn", force=True)
    main()
