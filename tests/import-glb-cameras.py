import json
import os
import sys

import bpy


arguments = sys.argv[sys.argv.index("--") + 1:]
if not arguments:
    raise SystemExit("Pass the exported .glb path after --.")

fixture_path = os.path.join(os.path.dirname(__file__), "..", "examples", "cal-s-living-room.terior")
with open(fixture_path, encoding="utf-8") as fixture_file:
    fixture = json.load(fixture_file)
expected_targets = {view["name"]: view["target"] for view in fixture["cameraViews"]}
expected_active = fixture["activeCamera"]

bpy.ops.import_scene.gltf(filepath=arguments[0])
cameras = [
    {
        "name": obj.name,
        "position": [round(value, 4) for value in obj.location],
        "lens_mm": round(obj.data.lens, 2),
        "properties": [key for key in obj.keys() if not key.startswith("_")],
        "target": [round(value, 4) for value in obj.get("target", [])],
        "active": obj.get("active", False),
    }
    for obj in bpy.context.scene.objects
    if obj.type == "CAMERA"
]
saved_cameras = [camera for camera in cameras if "teriorCameraView" in camera["properties"]]
saved_names = {camera["name"] for camera in saved_cameras}
expected_names = set(expected_targets)
print("TERIOR_CAMERA_IMPORT=" + json.dumps({"all": cameras, "saved": saved_cameras}, ensure_ascii=False))
if saved_names != expected_names:
    raise SystemExit(f"Expected saved cameras {sorted(expected_names)}, imported {sorted(saved_names)}.")
actual_targets = {camera["name"]: camera["target"] for camera in saved_cameras}
if actual_targets != expected_targets:
    raise SystemExit(f"Saved camera aim points changed: expected {expected_targets}, imported {actual_targets}.")
active_names = {camera["name"] for camera in saved_cameras if camera["active"]}
if active_names != {expected_active}:
    raise SystemExit(f"Expected active saved camera {expected_active!r}, imported {sorted(active_names)}.")
