#!/usr/bin/env bash

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <input.blend> <output.glb>" >&2
  exit 1
fi

input="$1"
output="$2"

# @NOTE We have to re-enable every object in the scene before exporting,
# otherwise objects get exported without a transform.
# See: https://github.com/KhronosGroup/glTF-Blender-IO/issues/2102
/Applications/Blender.app/Contents/MacOS/Blender -b "$input" \
--python-expr "
import bpy

# Re-enable all objects in the scene
for collection in bpy.data.collections:
    collection.hide_viewport = False
for obj in bpy.data.objects:
    obj.hide_viewport = False

bpy.context.view_layer.update()

# Only export collection name '__export'
bpy.ops.export_scene.gltf(
    filepath='${output}',
    export_format='GLB',
    collection='__export',
    use_visible=False,
    use_renderable=False
)"
