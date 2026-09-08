#!/bin/zsh
# Stop training cleanly once a given iteration has been logged.
cd /Users/donghoon/Desktop/Programming/reversix/rl
TARGET=${1:-29}
LOG=runs/r3/log.jsonl
while true; do
  n=$(wc -l < "$LOG" 2>/dev/null | tr -d ' ')
  [ -n "$n" ] && [ "$n" -ge $((TARGET + 1)) ] && break
  pgrep -f "[t]rain.py" >/dev/null || { echo "training already stopped at $n iterations"; exit 0; }
  sleep 30
done
pkill -f train.py
sleep 2
echo "reached iteration $TARGET — training stopped"
tail -1 "$LOG"
