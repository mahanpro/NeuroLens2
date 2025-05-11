"use client";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";

// This is the model ID provided in the OpenAI documentation for Realtime API.
// It must match the model used for generating the ephemeral key.
const OPENAI_REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17"; // Or a current, vision-capable model
const OPENAI_VISION_MODEL = "gpt-4.1-nano-2025-04-14";

export default function RealtimeAssistant() {
  const [isConnected, setIsConnected] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [responseText, setResponseText] = useState("");
  const [sceneDescription, setSceneDescription] = useState("");
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isProcessingScene, setIsProcessingScene] = useState(false);

  // WebRTC references
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  // Media references
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const localVideoStreamRef = useRef<MediaStream | null>(null);

  // Function to handle video stream errors
  const handleVideoError = (error: Error) => {
    console.error("Video stream error:", error);
    setVideoError(error.message);
    setIsVideoEnabled(false);
    if (localVideoStreamRef.current) {
      localVideoStreamRef.current.getTracks().forEach(track => track.stop());
      localVideoStreamRef.current = null;
    }
  };

  // Function to initialize video stream
  const initializeVideoStream = async () => {
    try {
      setVideoError(null);
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
          frameRate: { ideal: 30 }
        },
        audio: true
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Split streams for better control
      localAudioStreamRef.current = new MediaStream(mediaStream.getAudioTracks());
      localVideoStreamRef.current = new MediaStream(mediaStream.getVideoTracks());

      // Set up video element
      if (videoElRef.current) {
        videoElRef.current.srcObject = localVideoStreamRef.current;
        await videoElRef.current.play().catch(handleVideoError);
        setIsVideoEnabled(true);
      }

      return mediaStream;
    } catch (error) {
      handleVideoError(error instanceof Error ? error : new Error('Failed to initialize video'));
      throw error;
    }
  };

  useEffect(() => {
    // Create audio element for playback
    if (!audioElRef.current) {
      audioElRef.current = document.createElement("audio");
      audioElRef.current.autoplay = true;
      document.body.appendChild(audioElRef.current);
    }

    // Cleanup on unmount
    return () => {
      disconnectFromOpenAI();
      if (audioElRef.current?.parentNode) {
        audioElRef.current.parentNode.removeChild(audioElRef.current);
        audioElRef.current = null;
      }
      if (localVideoStreamRef.current) {
        localVideoStreamRef.current.getTracks().forEach(track => track.stop());
        localVideoStreamRef.current = null;
      }
      if (localAudioStreamRef.current) {
        localAudioStreamRef.current.getTracks().forEach(track => track.stop());
        localAudioStreamRef.current = null;
      }
    };
  }, []);

  const connectToOpenAI = async () => {
    if (peerConnectionRef.current?.connectionState === "connected") {
      console.log("Already connected.");
      return;
    }

    // Reset states
    setTranscription("");
    setResponseText("");
    setSceneDescription("");
    setVideoError(null);

    try {
      console.log("Fetching ephemeral key...");
      const tokenResponse = await fetch("/api/openai-session");
      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        throw new Error(errorData.error || "Failed to get session token");
      }
      const sessionData = await tokenResponse.json();
      const EPHEMERAL_KEY = sessionData.client_secret.value;

      // Initialize WebRTC connection
      peerConnectionRef.current = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });
      const pc = peerConnectionRef.current;

      // Set up event handlers
      pc.onicecandidate = (event) => {
        if (event.candidate) console.log("ICE Candidate:", event.candidate);
      };

      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
        setIsConnected(pc.connectionState === "connected");
        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          setIsConnected(false);
        }
      };

      pc.ontrack = (e) => {
        console.log("Remote track received:", e.track);
        if (e.track.kind === "audio" && audioElRef.current && e.streams[0]) {
          audioElRef.current.srcObject = e.streams[0];
        }
      };

      // Initialize media streams
      const mediaStream = await initializeVideoStream();
      
      // Add tracks to peer connection
      mediaStream.getTracks().forEach(track => {
        pc.addTrack(track, mediaStream);
      });

      // Set up data channel
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;
      
      dc.onopen = () => console.log("Data channel opened");
      dc.onclose = () => console.log("Data channel closed");
      dc.onerror = (err) => console.error("Data channel error:", err);
      dc.onmessage = handleDataChannelMessage;

      // Create and send offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_MODEL}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${EPHEMERAL_KEY}`,
            "Content-Type": "application/sdp",
          },
        }
      );

      if (!sdpResponse.ok) {
        throw new Error(`Failed to get SDP answer: ${await sdpResponse.text()}`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription(new RTCSessionDescription({
        type: "answer",
        sdp: answerSdp
      }));

      console.log("WebRTC connection established with OpenAI Realtime API.");
      setIsConnected(true);
    } catch (error) {
      console.error("Error initializing connection:", error);
      alert(`Connection error: ${error instanceof Error ? error.message : String(error)}`);
      disconnectFromOpenAI();
    }
  };

  const requestSceneDescription = async () => {
    if (!isConnected) {
      alert("Please connect the assistant first.");
      return;
    }

    if (!localVideoStreamRef.current || !videoElRef.current?.srcObject) {
      alert("Video stream not available.");
      setVideoError("Video stream not available to capture frame.");
      return;
    }

    setIsProcessingScene(true);
    setSceneDescription("Capturing frame and analyzing scene...");
    setVideoError(null);

    try {
      const videoElement = videoElRef.current;
      
      // Ensure video is playing and has valid dimensions
      if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
          throw new Error("Video dimensions not available");
        }
      }

      // Create canvas with video dimensions
      const canvas = document.createElement('canvas');
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;

      // Draw current video frame
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

      // Convert to JPEG with reasonable quality
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);

      // Call the describe-scene API
      const response = await fetch('/api/describe-scene', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_data_url: imageDataUrl,
          prompt: "Describe this scene in detail, focusing on what you can see in the video feed."
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get scene description');
      }

      const result = await response.json();
      if (result.description) {
        setSceneDescription(result.description);
        // Optionally, you can also speak the description
        speakText(result.description);
      } else {
        throw new Error('No description received from the server');
      }

    } catch (error) {
      console.error("Error processing scene:", error);
      setSceneDescription(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setVideoError(`Error during scene analysis: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsProcessingScene(false);
    }
  };

  async function handleDataChannelMessage(event: MessageEvent) {
    try {
      const msg = JSON.parse(event.data);
      console.log("Received event from OpenAI:", msg);

      switch (msg.type) {
        case "session.created":
          console.log("OpenAI Session created:", msg.session.id);
          break;

        case "response.audio_transcript.delta":
          setTranscription((prev) => prev + msg.delta);
          break;

        case "response.text.delta":
            setResponseText((prev) => prev + msg.delta);
          break;

        case "response.done":
          console.log("Response done event:", msg);
          if (msg.response?.input_transcription) {
            console.log("Final Input Transcription:", msg.response.input_transcription);
            setTranscription(msg.response.input_transcription); // Set final transcription
            // TODO: Send this final transcription to LangGraph
          }
          break;

        default:
          // console.log("Unhandled event type:", msg.type);
          break;
      }
    } catch (error) {
      console.error(
        "Error parsing message from OpenAI or handling event:", error,
        "Raw data:", event.data
      );
    }
  }

  const disconnectFromOpenAI = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (localAudioStreamRef.current) {
      localAudioStreamRef.current.getTracks().forEach((track) => track.stop());
      localAudioStreamRef.current = null;
    }
    if (localVideoStreamRef.current) {
      localVideoStreamRef.current.getTracks().forEach((track) => track.stop());
      if (videoElRef.current) videoElRef.current.srcObject = null; // Clear video display
      localVideoStreamRef.current = null;
    }
    setIsConnected(false);
    setTranscription("");
    setResponseText("");
    setSceneDescription("");
    console.log("Disconnected.");
  };

  const speakText = (textToSpeak: string) => {
    // (Your existing speakText function - unchanged)
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
      console.warn("Data channel not open. Cannot send text for TTS.");
      return;
    }
    setResponseText(""); 
    const createItemEvent = {
      type: "conversation.item.create",
      item: {
        type: "message", role: "user",
        content: [{ type: "input_text", text: textToSpeak }],
      },
    };
    dataChannelRef.current.send(JSON.stringify(createItemEvent));
    const createResponseEvent = {
      type: "response.create",
      response: { modalities: ["audio", "text"] },
    };
    dataChannelRef.current.send(JSON.stringify(createResponseEvent));
    console.log("Sent request for TTS.");
  };

  const handleLangGraphResponse = () => {
    // (Your existing handleLangGraphResponse function - unchanged)
    const exampleTextFromLangGraph = "Hello! This is a spoken response generated from text.";
    speakText(exampleTextFromLangGraph);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Video Preview Section */}
      <div className="bg-black rounded-lg shadow-md overflow-hidden">
        <video
          ref={videoElRef}
          autoPlay
          playsInline
          muted
          className="w-full h-auto"
          style={{ 
            maxHeight: '300px', 
            display: isVideoEnabled ? 'block' : 'none',
            objectFit: 'cover'
          }}
        />
        {!isVideoEnabled && (
          <div className="h-[200px] flex items-center justify-center text-gray-400 bg-gray-800">
            {videoError ? (
              <div className="text-red-400">{videoError}</div>
            ) : (
              "Camera preview will appear here when connected"
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center justify-center space-y-4">
        {!isConnected ? (
          <Button 
            className="w-full md:w-60 h-12 text-lg bg-blue-600 hover:bg-blue-700 transition-colors"
            onClick={connectToOpenAI}
          >
            Connect Assistant
          </Button>
        ) : (
          <Button 
            className="w-full md:w-60 h-12 text-lg bg-red-600 hover:bg-red-700 transition-colors"
            onClick={disconnectFromOpenAI}
          >
            Disconnect
          </Button>
        )}
        <p className="text-sm text-gray-600">
          Status: <span className={isConnected ? "text-green-600 font-medium" : "text-gray-600"}>
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </p>
      </div>

      {/* Scene Description Controls */}
      {isConnected && (
        <div className="flex justify-center">
          <Button
            onClick={requestSceneDescription}
            disabled={isProcessingScene}
            className={`w-full md:w-60 transition-colors ${
              isProcessingScene 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-teal-600 hover:bg-teal-700'
            }`}
          >
            {isProcessingScene ? 'Analyzing Scene...' : 'Describe Scene'}
          </Button>
        </div>
      )}

      {/* Scene Description Display */}
      <div className="bg-white rounded-lg shadow-md p-4">
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Scene Description</h2>
        <p className="min-h-[50px] p-3 bg-gray-50 rounded-md border border-gray-200">
          {sceneDescription || "Scene description will appear here..."}
        </p>
      </div>

      <div className="space-y-4">
        <div className="bg-white rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Live Transcription</h2>
          <p className="min-h-[50px] p-3 bg-gray-50 rounded-md border border-gray-200">
            {transcription || "Speak after connecting..."}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Model Response (Text/TTS)</h2>
          <p className="min-h-[50px] p-3 bg-gray-50 rounded-md border border-gray-200">
            {responseText || "Waiting for model's text response..."}
          </p>
        </div>

        {isConnected && (
          <div className="flex justify-center">
            <Button onClick={handleLangGraphResponse} className="mt-4 bg-purple-600 hover:bg-purple-700">
              Simulate LangGraph & Speak
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}