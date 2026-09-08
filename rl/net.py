import torch, torch.nn as nn, torch.nn.functional as F

class Block(nn.Module):
    def __init__(self, ch):
        super().__init__()
        self.c1 = nn.Conv2d(ch, ch, 3, padding=1, bias=False); self.b1 = nn.BatchNorm2d(ch)
        self.c2 = nn.Conv2d(ch, ch, 3, padding=1, bias=False); self.b2 = nn.BatchNorm2d(ch)
    def forward(self, x):
        y = F.relu(self.b1(self.c1(x)))
        y = self.b2(self.c2(y))
        return F.relu(x + y)

class Net(nn.Module):
    """Fully convolutional: policy is position-wise, value uses global pooling,
    so the same weights transfer to a different board size."""
    def __init__(self, planes=9, ch=64, blocks=6):
        super().__init__()
        self.stem = nn.Sequential(nn.Conv2d(planes, ch, 3, padding=1, bias=False),
                                  nn.BatchNorm2d(ch), nn.ReLU(inplace=True))
        self.body = nn.Sequential(*[Block(ch) for _ in range(blocks)])
        self.ph = nn.Sequential(nn.Conv2d(ch, 32, 1, bias=False), nn.BatchNorm2d(32), nn.ReLU(inplace=True),
                                nn.Conv2d(32, 1, 1))
        self.vh = nn.Sequential(nn.Conv2d(ch, 32, 1, bias=False), nn.BatchNorm2d(32), nn.ReLU(inplace=True))
        self.vf = nn.Sequential(nn.Linear(32, 64), nn.ReLU(inplace=True), nn.Linear(64, 1))
    def forward(self, x):
        h = self.body(self.stem(x))
        p = self.ph(h).flatten(1)                      # (B, N*N) logits
        v = self.vf(self.vh(h).mean(dim=(2, 3))).squeeze(-1)
        return p, torch.tanh(v)

def pick_device():
    if torch.backends.mps.is_available(): return torch.device("mps")
    return torch.device("cpu")
