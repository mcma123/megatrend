"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CameraOff, RefreshCw, ShieldAlert, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type DocumentCameraCaptureProps = {
  onCapture: (dataUrl: string) => void;
};

export function DocumentCameraCapture({ onCapture }: DocumentCameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => stopCamera(), []);

  const statusText = useMemo(() => {
    if (capturedImage) return "Review the captured page before adding it to the scan session.";
    if (error) return error;
    if (isReady) return "Rear camera is preferred on mobile when it is available.";
    if (isOpen) return "Waiting for the camera preview to start.";
    return "Open your device camera and capture a document page.";
  }, [capturedImage, error, isOpen, isReady]);

  async function startCamera() {
    setError(null);
    setCapturedImage(null);
    setIsOpen(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not expose camera access.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      stopCamera();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsReady(true);
    } catch (cameraError) {
      setIsReady(false);
      const message =
        cameraError instanceof DOMException && cameraError.name === "NotAllowedError"
          ? "Camera permission was denied."
          : "No usable camera was available on this device.";
      setError(message);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsReady(false);
  }

  function captureImage() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("The camera frame could not be captured.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    setCapturedImage(dataUrl);
    stopCamera();
  }

  function confirmCapture() {
    if (!capturedImage) return;
    onCapture(capturedImage);
    setCapturedImage(null);
    setIsOpen(false);
  }

  return (
    <Card className="surface-elevated p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Camera capture
          </div>
          <h3 className="mt-2 font-display text-xl">Take photo</h3>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">{statusText}</p>
        </div>
        <Button variant={isOpen ? "outline" : "default"} onClick={() => void startCamera()}>
          <Camera className="h-4 w-4" /> {isOpen ? "Restart camera" : "Open camera"}
        </Button>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-slate-950/95">
        {capturedImage ? (
          <img
            src={capturedImage}
            alt="Captured document preview"
            className="aspect-video w-full object-contain"
          />
        ) : isOpen ? (
          <video ref={videoRef} playsInline muted className="aspect-video w-full object-cover" />
        ) : (
          <div className="flex aspect-video flex-col items-center justify-center gap-3 text-slate-200">
            {error ? (
              <ShieldAlert className="h-8 w-8 text-warning" />
            ) : (
              <Video className="h-8 w-8 text-primary" />
            )}
            <div className="text-sm">{error ?? "Camera preview is idle."}</div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={captureImage} disabled={!isReady}>
          <Camera className="h-4 w-4" /> Capture still
        </Button>
        <Button variant="outline" onClick={() => void startCamera()}>
          <RefreshCw className="h-4 w-4" /> Retake
        </Button>
        <Button onClick={confirmCapture} disabled={!capturedImage}>
          <CameraOff className="h-4 w-4" /> Confirm image
        </Button>
      </div>
    </Card>
  );
}
