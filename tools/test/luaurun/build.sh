#!/bin/bash
# Builds `luaurun`, a tiny Luau host (official VM + compiler, no Roblox APIs) used by the tests:
#   tools/test/luaurun/build.sh && node tools/test/parity.mjs
set -euo pipefail
cd "$(dirname "$0")"
VER="0.22.0+luau740"
if [ ! -d luau ]; then
  curl -sSL "https://static.crates.io/crates/luau0-src/luau0-src-${VER/+/%2B}.crate" -o luau0.crate
  mkdir -p src-crate && tar -xzf luau0.crate -C src-crate --strip-components=1
  mv src-crate/luau luau && rm -rf src-crate luau0.crate
fi
INC="-Iluau/Bytecode/include -Iluau/Common/include -Iluau/Ast/include -Iluau/Compiler/include -Iluau/VM/include"
mkdir -p obj
objs=()
for f in luau/Common/src/*.cpp luau/Bytecode/src/*.cpp luau/Ast/src/*.cpp luau/Compiler/src/*.cpp luau/VM/src/*.cpp runner.cpp; do
  o="obj/$(echo "$f" | tr '/' '_' | sed 's/\.cpp$/.o/')"
  objs+=("$o")
  [ -f "$o" ] || echo "g++ -O2 -std=c++17 $INC -c $f -o $o"
done | xargs -P "$(nproc)" -I{} sh -c "{}"
g++ -O2 -o luaurun obj/*.o
echo "built $(pwd)/luaurun"
