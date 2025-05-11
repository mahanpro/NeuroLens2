"use client";

import { useState, useEffect, useRef } from "react";

export default function WebcamComponent() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Function to start webcam
    const startWebcam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setIsStreaming(true);
          setError(null);
        }
      } catch (err) {
        console.error("Error accessing webcam:", err);
        setError(
          "Could not access webcam. Please ensure you have a webcam connected and have granted permission."
        );
      }
    };

    // Start webcam when component mounts
    startWebcam();

    // Clean up function to stop webcam when component unmounts
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        const tracks = stream.getTracks();
        tracks.forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    // Function to draw video to canvas
    const drawToCanvas = () => {
      if (!videoRef.current || !canvasRef.current || !isStreaming) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      if (!ctx) return;

      // Set canvas dimensions to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Draw video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Request next frame
      requestAnimationFrame(drawToCanvas);
    };

    if (isStreaming) {
      // Start drawing to canvas once streaming begins
      requestAnimationFrame(drawToCanvas);
    }
  }, [isStreaming]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <h1 className="text-2xl font-bold mb-6 text-gray-900">Webcam Feed</h1>

      {error && (
        <div
          className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4"
          role="alert"
        >
          <p>{error}</p>
        </div>
      )}

      <div className="relative">
        {/* Hide the video element but keep it in the DOM for capturing the stream */}
        <video ref={videoRef} className="hidden" muted playsInline />

        <canvas
          ref={canvasRef}
          className="max-w-full border-4 border-blue-500 rounded-lg shadow-lg"
        />
      </div>

      {/* <p className="mt-4 text-gray-600">
        {isStreaming ? "Webcam is active" : "Starting webcam..."}
      </p> */}
    </div>
  );
}
