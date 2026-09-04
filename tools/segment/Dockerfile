# SAM segmentation prototype.
#
# Built FROM the tiler so it inherits GDAL and, more usefully, tile_course.py —
# imagery source selection, the bbox-from-holes logic and the cell-splitting
# ImageServer fetch are all solved there and would be silly to duplicate.
FROM grt-tiler

# git: SAM is installed from Meta's repo (no official PyPI package).
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# CPU torch. vit_b rather than vit_h: 375 MB vs 2.4 GB and several times
# faster, which matters a lot when there is no GPU in the loop.
# numpy is left unpinned deliberately: pinning it to <2 resolved to a version
# with no aarch64 wheel for this image's Python, so pip fell back to building
# from source — and the GDAL slim image ships no C compiler.
# CPU-only wheels from PyTorch's own index. The default PyPI torch drags in
# ~3 GB of CUDA wheels (cusparselt, nccl, cudnn) that can never be used here —
# there is no GPU in this container and none on the laptop running it.
RUN pip3 install --no-cache-dir --break-system-packages \
      --index-url https://download.pytorch.org/whl/cpu \
      torch torchvision \
    && pip3 install --no-cache-dir --break-system-packages \
      "git+https://github.com/facebookresearch/segment-anything.git"

RUN curl -sSL -o /opt/sam_vit_b.pth \
      https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth

WORKDIR /app
COPY segment_course.py .
ENTRYPOINT ["python3", "segment_course.py"]
