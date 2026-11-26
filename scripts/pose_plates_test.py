"""Regression checks for registration and layered backgrounds. Run with python."""

from pathlib import Path
from tempfile import TemporaryDirectory
from fractions import Fraction
import json
import subprocess
import unittest

from PIL import Image
from pose_plates import build, exposures, input_layers


class LayerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        a = Image.new("RGBA", (10, 12))
        a.paste("white", (2, 2, 8, 10))
        a.save(self.base / "a.png")
        Image.new("RGB", (32, 32), "red").save(self.base / "back.png")
        self.shot = dict(
            id="wide",
            plate="back",
            at=[15, 20],
            exposures=[
                dict(pose="a", frames=2, contact=True),
                dict(pose="a", frames=3, contact=True),
            ],
        )
        self.spec = dict(
            poses=[dict(id="a", file="a.png", anchor=[5, 9])],
            plates=[dict(id="back", file="back.png")],
            shots=[self.shot],
        )

    def run_shots(self):
        poses, plates = input_layers(self.spec, self.base)
        return list(exposures(self.spec, poses, plates, (32, 32)))

    def test_timing_and_contact_from_actual_layer(self):
        takes = self.run_shots()
        self.assertEqual([(c["in"], c["out"]) for _, c in takes], [(0, 2), (2, 5)])
        self.assertEqual(takes[0][0].getpixel((15, 20)), (255, 255, 255))
        self.assertEqual(takes[0][0].getpixel((15, 23)), (255, 0, 0))

    def test_floating_anchor_separate_from_contact(self):
        self.spec["poses"][0]["anchor"] = [0, 0]
        with self.assertRaisesRegex(ValueError, "contact point"):
            self.run_shots()
        for cue in self.shot["exposures"]:
            cue["contact"] = False
        self.assertEqual(len(self.run_shots()), 2)

    def test_clipping_needs_explicit_shot_framing(self):
        self.shot["at"] = [0, 0]
        with self.assertRaisesRegex(ValueError, "clipped"):
            self.run_shots()
        self.shot["allowCrop"] = True
        self.assertTrue(self.run_shots())

    def test_opaque_background_is_not_an_isolated_pose(self):
        self.spec["poses"][0]["file"] = "back.png"
        with self.assertRaisesRegex(ValueError, "transparent"):
            self.run_shots()

    def test_plate_view_does_not_stretch_a_character_environment(self):
        self.shot["plateView"] = [0, 0, 16, 32]
        with self.assertRaisesRegex(ValueError, "aspect"):
            self.run_shots()

    def test_fractional_delivery_preserves_exposure_pts(self):
        for rate in ("24000/1001", "30000/1001"):
            self.spec.update(size=[32, 32], fps=rate)
            manifest = self.base / "source.json"
            manifest.write_text(json.dumps(self.spec), encoding="utf-8")
            out = self.base / rate.split("/")[0]
            data = build(manifest, out)
            probe = subprocess.check_output(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=r_frame_rate,time_base:frame=pts",
                    "-of",
                    "json",
                    str(out / "take.mp4"),
                ]
            )
            info = json.loads(probe)
            stream = info["streams"][0]
            self.assertEqual(stream["r_frame_rate"], rate)
            self.assertEqual(
                [f["pts"] * Fraction(stream["time_base"]) for f in info["frames"]],
                [i / Fraction(rate) for i in range(5)],
            )
            self.assertEqual(data["exposures"][1]["in"], 2)


if __name__ == "__main__":
    unittest.main()
