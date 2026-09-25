#!/usr/bin/env bash

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <input.blend> <output.glb>" >&2
  exit 1
fi

input="$1"
output="$2"

/Applications/Blender.app/Contents/MacOS/Blender -b "$input" \
  --python-expr "import bpy; bpy.ops.export_scene.gltf(filepath='${output}')"
