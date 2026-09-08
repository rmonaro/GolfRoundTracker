import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import jsQR from 'jsqr';

/**
 * Camera QR reader.
 *
 * Most people scan a QR with their phone's own camera app, and the code we
 * generate is a link precisely so that path works with nothing installed. This
 * exists for the other order of events: someone already has the app open and
 * taps "Scan". It reads from the rear camera, decodes with jsQR, and hands back
 * whatever the code contained — a URL with `?code=` or a bare code, since the
 * caller has to cope with both anyway.
 *
 * Frames are sampled on an interval rather than every animation frame: decoding
 * is the expensive part, a QR held up to a camera does not move meaningfully in
 * 200ms, and this runs on whatever phone a grandparent happens to own.
 */
const SAMPLE_MS = 200;
/** Downscale before decoding — a full-resolution frame is far more pixels than
 *  jsQR needs and is what makes this slow on an older device. */
const DECODE_WIDTH = 480;

interface QrScannerProps {
  onResult: (text: string) => void;
  onCancel: () => void;
}

export function QrScanner({ onResult, onCancel }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against firing onResult twice while the last frames drain.
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let cancelled = false;

    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This device has no camera the app can open. Type the code instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // `environment` is a hint, not a guarantee — a laptop will hand back
          // its only camera, which is fine.
          video: { facingMode: 'environment' }
        });
      } catch {
        setError('Camera permission was declined. Type the code instead.');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      // iOS refuses to play an inline video without both of these.
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play().catch(() => undefined);

      timer = window.setInterval(() => {
        if (done.current) return;
        const canvas = canvasRef.current;
        if (!canvas || !video.videoWidth) return;

        const scale = Math.min(1, DECODE_WIDTH / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'dontInvert'
        });
        if (found?.data) {
          done.current = true;
          stop();
          onResult(found.data);
        }
      }, SAMPLE_MS);
    };

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [onResult]);

  return (
    <Stack spacing={2}>
      {error ? (
        <Alert severity="warning">{error}</Alert>
      ) : (
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            aspectRatio: '1 / 1',
            borderRadius: 2,
            overflow: 'hidden',
            bgcolor: 'common.black'
          }}
        >
          <video
            ref={videoRef}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            playsInline
            muted
          />
          {/* Aiming frame. Purely a hint about where to hold the code. */}
          <Box
            sx={{
              position: 'absolute',
              inset: '18%',
              border: '2px solid rgba(255,255,255,0.85)',
              borderRadius: 2,
              pointerEvents: 'none'
            }}
          />
        </Box>
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <Typography variant="caption" color="text.secondary" align="center">
        Point the camera at the athlete&apos;s QR code.
      </Typography>
      <Button onClick={onCancel}>Cancel</Button>
    </Stack>
  );
}
