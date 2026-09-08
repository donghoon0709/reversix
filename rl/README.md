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
| `verify_env.py` | **규칙 검증**: JS 엔진 트레이스와 국면 단위 대조 |
| `verify_encoding.mjs` | **인코딩 검증**: 브라우저 에이전트가 학습 환경과 같은 평면을 보는지 대조 |
| `bench_web_agent.mjs` | 배포된 브라우저 에이전트를 baseline과 대국 |
| `check_ban_compliance.py` | 스크립트 상대들이 금수를 두지 않는지 확인 |
| `dump_enc.py` | 위 두 검증에 쓰는 트레이스 생성 |
| `ladder.py` | 체크포인트 간 라운드로빈 → 상대 Elo |
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

## 규칙과 검증 체인

규칙은 참조 구현(`nowyoullnever/ReverSIX`)을 따르되 **금수 규칙 하나를 더합니다**.
SIX는 최대 연속선이 정확히 6개일 때만 성립하고 7개 이상(오버라인)은 무효입니다.
그래서 상대 오버라인의 끝을 뒤집으면 정확히 6개가 남아 **상대에게 SIX를 만들어 주게**
되는데, 그런 자리는 둘 수 없습니다. 기준선은 턴 시작 시점의 보드이므로, 체크 방어 중
이미 존재하던 상대 SIX는 금수 판정에 포함되지 않습니다.

둘 곳이 없으면 패스하고, 체크 없이 연속 두 번 패스하면 돌 개수로 승패를 가립니다.

세 단계를 이어 붙여 검증합니다:

```
참조 엔진  ↔  src/game/rules.js     40게임 1,506국면
rules.js   ↔  rxenv.c (학습 환경)    30게임 1,026국면
rxenv.c    ↔  src/game/ai.js 인코딩   721국면 (9개 평면 + 합법수 마스크)
```

추가로 `stress.py`가 33만 plies에서 "진행 중인 게임에는 항상 합법수가 있다"를,
`verify_aug.py`가 3,176개 대칭 변환에서 D4 불변성을 확인합니다. 전부 불일치 0건.

## baseline

| 상대 | 비고 |
|---|---|
| `random` | 합법수 균등 (체크 블런더는 마스크가 이미 제거) |
| `greedy` | 턴 단위 창(window) 포텐셜 휴리스틱 |

greedy vs random (각 400판, 승1·무0.5): 흑 0.685, 백 0.657.

평가함수는 6칸이 꽉 찬 창에 점수를 주지 않고 실제 SIX만 `six_count`로 셉니다. 그래야
오버라인을 두 창으로 이중 계산하지 않고, **자기 SIX를 7개로 늘리면 점수가 떨어지는**
올바른 신호가 나옵니다.
