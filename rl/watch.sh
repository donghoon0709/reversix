#!/bin/zsh
cd /Users/donghoon/Desktop/Programming/reversix/rl
LOG=runs/r1/log.jsonl
last=0
[ -f "$LOG" ] && last=$(wc -l < "$LOG" | tr -d ' ')
echo "monitor armed: $last iterations already logged, watching for more"
while true; do
  if [ -f "$LOG" ]; then
    n=$(wc -l < "$LOG" | tr -d ' ')
    if [ "$n" -gt "$last" ]; then
      sed -n "$((last+1)),${n}p" "$LOG" | .venv/bin/python fmt_iter.py
      last=$n
    fi
    if [ "$n" -ge 80 ]; then echo "TRAINING COMPLETE: 80 iterations finished"; break; fi
  fi
  if ! pgrep -f "[t]rain.py" >/dev/null; then
    echo "TRAINING STOPPED after $last iterations (process gone)"
    grep -E "Traceback|Error|error:|Killed|MemoryError" runs/r1.log | tail -3
    break
  fi
  sleep 30
done
