# Face anti-spoofing models

`mini-fasnet-v2-2.7.onnx` and `mini-fasnet-v1se-4.0.onnx` are the MiniFASNetV2 and MiniFASNetV1SE models from
[Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) by Minivision Technology,
licensed under the Apache License 2.0 (see `LICENSE-Silent-Face-Anti-Spoofing.txt`).

They were converted from the project's PyTorch weights (`2.7_80x80_MiniFASNetV2.pth` and
`4_0_0_80x80_MiniFASNetV1SE.pth`) to ONNX (opset 13) without any other change. The converted models were checked
against PyTorch: the softmax outputs agree to about 1e-7 on random inputs.

How the identity-check server uses them (`kyc_worker/faces.py`) follows the project's own `test.py`: the face box is
enlarged by 2.7 and 4.0, each crop is resized to 80x80 with bilinear sampling, BGR values 0..255 go in (the project's
`to_tensor` does not divide by 255), and the two softmax results are added; class 1 is a live face.

The project asks that test images be taken by a camera and show a whole face turned less than 30 degrees, which is why
only the straight-ahead selfie is scored.
