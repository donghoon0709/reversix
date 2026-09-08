"""ctypes binding for librxenv.dylib — Reversix RL environment."""
import ctypes, os
import numpy as np

_lib = ctypes.CDLL(os.path.join(os.path.dirname(os.path.abspath(__file__)), "librxenv.dylib"))

MAXCELLS = 19 * 19

class RxState(ctypes.Structure):
    _fields_ = [
        ("board", ctypes.c_int8 * MAXCELLS),
        ("player", ctypes.c_int8),
        ("checked", ctypes.c_int8),
        ("placed", ctypes.c_int8),
        ("opening", ctypes.c_int8),
        ("first", ctypes.c_int16),
        ("need", ctypes.c_int8),
        ("terminal", ctypes.c_int8),
        ("winner", ctypes.c_int8),
        ("turn", ctypes.c_int16),
    ]

_lib.rx_config.argtypes = [ctypes.c_int, ctypes.c_int]
_lib.rx_cells.restype = ctypes.c_int
_lib.rx_planes.restype = ctypes.c_int
_lib.rx_reset.argtypes = [ctypes.POINTER(RxState)]
_lib.rx_legal.argtypes = [ctypes.POINTER(RxState), ctypes.POINTER(ctypes.c_uint8), ctypes.c_int]
_lib.rx_legal.restype = ctypes.c_int
_lib.rx_step.argtypes = [ctypes.POINTER(RxState), ctypes.c_int]
_lib.rx_encode.argtypes = [ctypes.POINTER(RxState), ctypes.POINTER(ctypes.c_float), ctypes.c_int]
_lib.rx_reset_batch.argtypes = [ctypes.POINTER(RxState), ctypes.c_int]
_lib.rx_encode_batch.argtypes = [ctypes.POINTER(RxState), ctypes.c_int, ctypes.POINTER(ctypes.c_float), ctypes.c_int]
_lib.rx_legal_batch.argtypes = [ctypes.POINTER(RxState), ctypes.c_int, ctypes.POINTER(ctypes.c_uint8), ctypes.c_int, ctypes.POINTER(ctypes.c_int32)]
_lib.rx_step_batch.argtypes = [ctypes.POINTER(RxState), ctypes.c_int, ctypes.POINTER(ctypes.c_int32)]

N = 10
K = 6

def configure(n=10, k=6):
    global N, K, CELLS, PLANES
    N, K = n, k
    _lib.rx_config(n, k)
    CELLS = _lib.rx_cells()
    PLANES = _lib.rx_planes()
    return CELLS, PLANES

CELLS, PLANES = configure(N, K)

def _p(arr, ct):
    return arr.ctypes.data_as(ctypes.POINTER(ct))

class Batch:
    """A vector of independent games, stepped together."""
    def __init__(self, n):
        self.n = n
        self.s = (RxState * n)()
        _lib.rx_reset_batch(self.s, n)

    def reset_at(self, i):
        _lib.rx_reset(ctypes.byref(self.s[i]))

    def clone(self):
        b = Batch.__new__(Batch)
        b.n = self.n
        b.s = (RxState * self.n)()
        ctypes.memmove(b.s, self.s, ctypes.sizeof(self.s))
        return b

    def encode(self, safe=1):
        out = np.zeros((self.n, PLANES, CELLS), dtype=np.float32)
        _lib.rx_encode_batch(self.s, self.n, _p(out, ctypes.c_float), safe)
        return out.reshape(self.n, PLANES, N, N)

    def legal(self, safe=1):
        m = np.zeros((self.n, CELLS), dtype=np.uint8)
        c = np.zeros(self.n, dtype=np.int32)
        _lib.rx_legal_batch(self.s, self.n, _p(m, ctypes.c_uint8), safe, _p(c, ctypes.c_int32))
        return m, c

    def step(self, cells):
        cells = np.asarray(cells, dtype=np.int32)
        _lib.rx_step_batch(self.s, self.n, _p(cells, ctypes.c_int32))

    @property
    def terminal(self):
        return np.array([self.s[i].terminal for i in range(self.n)], dtype=bool)

    @property
    def winner(self):
        return np.array([self.s[i].winner for i in range(self.n)], dtype=np.int8)

    @property
    def player(self):
        return np.array([self.s[i].player for i in range(self.n)], dtype=np.int8)

    def board(self, i):
        return np.frombuffer(bytes(self.s[i].board), dtype=np.int8, count=CELLS).reshape(N, N)


class Game:
    """Single-game convenience wrapper (used by MCTS)."""
    __slots__ = ("st",)
    def __init__(self, st=None):
        self.st = st if st is not None else RxState()
        if st is None:
            _lib.rx_reset(ctypes.byref(self.st))
    def copy(self):
        s = RxState()
        ctypes.memmove(ctypes.byref(s), ctypes.byref(self.st), ctypes.sizeof(RxState))
        return Game(s)
    def legal(self, safe=1):
        m = np.zeros(CELLS, dtype=np.uint8)
        n = _lib.rx_legal(ctypes.byref(self.st), _p(m, ctypes.c_uint8), safe)
        return m, n
    def step(self, cell):
        _lib.rx_step(ctypes.byref(self.st), int(cell))
    def encode(self, safe=1):
        out = np.zeros(PLANES * CELLS, dtype=np.float32)
        _lib.rx_encode(ctypes.byref(self.st), _p(out, ctypes.c_float), safe)
        return out.reshape(PLANES, N, N)
    @property
    def terminal(self): return bool(self.st.terminal)
    @property
    def winner(self): return int(self.st.winner)
    @property
    def player(self): return int(self.st.player)


_lib.rx_heuristic_move.argtypes = [ctypes.POINTER(RxState), ctypes.c_float, ctypes.POINTER(ctypes.c_uint32)]
_lib.rx_heuristic_move.restype = ctypes.c_int
_lib.rx_random_move.argtypes = [ctypes.POINTER(RxState), ctypes.POINTER(ctypes.c_uint32)]
_lib.rx_random_move.restype = ctypes.c_int

class _Rng:
    def __init__(self, seed=12345):
        self.v = ctypes.c_uint32(seed if seed else 12345)

def heuristic_move(game, eps=0.0, rng=None):
    rng = rng or _Rng()
    return _lib.rx_heuristic_move(ctypes.byref(game.st), ctypes.c_float(eps), ctypes.byref(rng.v))

def random_move(game, rng=None):
    rng = rng or _Rng()
    return _lib.rx_random_move(ctypes.byref(game.st), ctypes.byref(rng.v))


_lib.rx_greedy_turn.argtypes = [ctypes.POINTER(RxState), ctypes.POINTER(ctypes.c_int32),
                                ctypes.c_float, ctypes.POINTER(ctypes.c_uint32)]
_lib.rx_greedy_turn.restype = ctypes.c_int

def greedy_turn(game, eps=0.0, rng=None):
    """Best complete turn under the window-potential heuristic. Returns list of cells."""
    rng = rng or _Rng()
    out = (ctypes.c_int32 * 2)()
    n = _lib.rx_greedy_turn(ctypes.byref(game.st), out, ctypes.c_float(eps), ctypes.byref(rng.v))
    return [out[i] for i in range(n)]
