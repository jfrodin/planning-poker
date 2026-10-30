#!/bin/zsh
cd -- "${0:A:h}" || exit 1
.runtime/node scripts/launch.mjs
result=$?
if (( result != 0 )); then
  echo "Tryck Enter för att stänga."
  read -r
fi
exit "$result"
