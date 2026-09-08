# Reversix RL (10×10)

AlphaZero 계열 자기대국 학습. 탐색은 **Gumbel AlphaZero**(Danihelka et al. 2022)로, 적은
시뮬레이션에서 PUCT보다 강해 저compute 환경에 맞습니다.

## 준비

```sh
python3.13 -m venv .venv
.venv/bin/pip install torch numpy
cc -O3 -march=native -shared -fPIC -o librxenv.dylib rxenv.c
```

## 학습

```sh
.venv/bin/python train.py --n 10 --k 6 --ch 64 --blocks 6 \
  --iters 60 --games 400 --parallel 192 --sims 32 --m 16 \
  --buffer 400000 --batch 512 --eval-every 5 --eval-games 24 --out runs/r1
```

이어서 하려면 `--resume runs/r1/latest.pt`. 로그는 `runs/r1/log.jsonl`.

## 파일

| 파일 | 역할 |
|---|---|
| `rxenv.c` / `librxenv.dylib` | 규칙 엔진, 합법수 마스킹, 평면 인코딩, baseline 상대 |
| `rx.py` | ctypes 바인딩 (`Game`, `Batch`, `greedy_turn`, `random_move`) |
| `net.py` | 완전 합성곱 ResNet (보드 크기 전이 가능) |
| `mcts.py` | Gumbel 탐색 + sequential halving |
| `selfplay.py` | 배치 자기대국 (여러 판을 함께 진행해 NN 호출을 묶음) |
| `train.py` | 학습 루프 (증강·리플레이·평가·체크포인트) |
| `baselines.py` | random / turn-level greedy 상대, 대전 함수 |
| `verify_env.py` | **규칙 검증**: 독립 파이썬 구현과 국면 단위 대조 |
| `verify_aug.py` | **증강 검증**: 규칙의 D4 불변성 확인 |

## 설계상 중요한 점

**상태는 보드가 아닙니다.** 한 턴이 2수라서 인코딩에 9개 평면이 들어갑니다:
내 돌 / 상대 돌 / 체크 여부 / 상대 육목 칸 / 이번 턴 착수 여부 / 첫 수 위치 /
필요 착수 수 / 합법 마스크 / 상수 1. 체크 여부와 턴 중간 정보를 빼면 마르코프성이
깨집니다.

**행동은 턴이 아니라 착수 단위입니다.** 턴 단위로 하면 행동 공간이 100² = 10,000이
됩니다. 대신 착수 2번을 순차 결정으로 쪼개 정책을 100차원으로 유지하고, 같은
플레이어가 연속 두 번 두므로 **한 턴 안의 두 ply 사이에서는 value 부호를 뒤집지
않습니다**(`mcts.py`의 `backup`).

**체크 방어 실패 수는 마스킹됩니다.** 착수하면 상대 돌은 줄기만 하므로 상대 육목은
새로 생길 수 없고, 따라서 "이 수를 두면 즉사"인지를 싸게 판정할 수 있습니다
(`rx_legal(..., safe=1)`). 신경망이 배우지 않아도 되는 블런더 유형을 통째로 제거합니다.

**증강 8배는 정확합니다.** 초기 배치는 대칭이 깨져 있지만(홀수 보드에서 특히) 증강에
필요한 건 규칙의 대칭성이고, 뒤집기·육목·금수는 전부 D4 불변입니다. `verify_aug.py`가
3,144개 변환에서 확인합니다.

**자기대국 다양성은 필수입니다.** 결정론적 정책은 이 게임에서 같은 대국을 반복 생성합니다
(실측: greedy 자기대국 40판이 전부 동일). Gumbel 노이즈에 더해 초반 12수는 개선된
정책에서 샘플링합니다.

## 검증 상태

- `verify_env.py`: 8,740개 국면, 불일치 0
- `verify_aug.py`: 3,144개 변환, 불일치 0
- 평균 턴수 36.9 — 독립 JS/C 엔진 측정치와 일치

## baseline

| 상대 | 비고 |
|---|---|
| `random` | 합법수 균등 (체크 블런더는 마스크가 이미 제거) |
| `greedy` | 턴 단위 창(window) 포텐셜 휴리스틱 |

greedy vs random (각 300판, 승1·무0.5): 흑 0.83, 백 0.80. greedy는 한 판도 지지 않지만
무승부가 34~40%인데, **상대 돌을 굶겨 착수불능(무승부)으로 만드는 전략을 스스로 찾아냅니다.**
