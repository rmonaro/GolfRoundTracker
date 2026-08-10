# Course imagery tiler.
#
# Containerised deliberately: GDAL is unpleasant to install natively on macOS,
# and the whole point is that the same image runs on a laptop today and on
# Railway later with no changes.

FROM ghcr.io/osgeo/gdal:ubuntu-small-3.13.2

ARG PMTILES_VERSION=1.31.2
# Supplied automatically by BuildKit. Matters here because this is built on an
# Apple Silicon laptop and (later) on x86 cloud runners — a hardcoded arch would
# either fail or run under slow emulation on one of them.
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-pip curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# go-pmtiles has no GDAL dependency and can't read GeoTIFF directly, which is
# why the pipeline goes GeoTIFF -> MBTiles (GDAL) -> PMTiles (this binary).
RUN case "${TARGETARCH}" in \
      arm64) PM_ARCH=arm64 ;; \
      *)     PM_ARCH=x86_64 ;; \
    esac \
    && curl -sSL -o /tmp/pmtiles.tar.gz \
      "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_${PM_ARCH}.tar.gz" \
    && tar -xzf /tmp/pmtiles.tar.gz -C /usr/local/bin pmtiles \
    && chmod +x /usr/local/bin/pmtiles \
    && rm /tmp/pmtiles.tar.gz

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY tile_course.py .

ENTRYPOINT ["python3", "tile_course.py"]
