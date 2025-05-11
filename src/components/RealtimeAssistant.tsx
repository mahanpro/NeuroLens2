"use client";
import { Button } from "@/components/ui/button";

import { useEffect, useRef, useState } from "react";

// This is the model ID provided in the OpenAI documentation for Realtime API.
// It must match the model used for generating the ephemeral key.
const OPENAI_REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17";

export default function RealtimeAssistant() {
  const [isConnected, setIsConnected] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [responseText, setResponseText] = useState("");
  // WebRTC references
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  // Audio references
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    // Create an audio element for playback if it doesn't exist
    if (!audioElRef.current) {
      audioElRef.current = document.createElement("audio");
      audioElRef.current.autoplay = true;
      document.body.appendChild(audioElRef.current); // Or append to a specific container
    }

    // Cleanup on unmount
    return () => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioElRef.current) {
        document.body.removeChild(audioElRef.current);
        audioElRef.current = null;
      }
    };
  }, []);

  const connectToOpenAI = async () => {
    if (
      peerConnectionRef.current &&
      peerConnectionRef.current.connectionState === "connected"
    ) {
      console.log("Already connected.");
      return;
    }

    try {
      // 1. Get an ephemeral key from your server
      console.log("Fetching ephemeral key...");
      const tokenResponse = await fetch("/api/openai-session");
      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        console.error("Failed to get ephemeral key:", errorData);
        alert(
          `Failed to get session token: ${errorData.error || "Unknown error"}`
        );
        return;
      }
      const sessionData = await tokenResponse.json();
      const EPHEMERAL_KEY = sessionData.client_secret.value;
      console.log("Ephemeral key received.");

      // 2. Create a peer connection
      peerConnectionRef.current = new RTCPeerConnection();
      const pc = peerConnectionRef.current;

      pc.onicecandidate = (event) => {
        // ICE candidate handling (usually automatic, but good for debugging)
        if (event.candidate) {
          console.log("ICE Candidate:", event.candidate);
        }
      };

      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
        setIsConnected(pc.connectionState === "connected");
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed"
        ) {
          setIsConnected(false);
        }
      };

      // 3. Set up to play remote audio from the model
      pc.ontrack = (e) => {
        console.log("Remote track received:", e.track);
        if (audioElRef.current && e.streams && e.streams[0]) {
          audioElRef.current.srcObject = e.streams[0];
        }
      };

      // 4. Add local audio track for microphone input
      console.log("Requesting microphone access...");
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = ms; // Store for cleanup
      ms.getTracks().forEach((track) => pc.addTrack(track, ms));
      console.log("Microphone access granted and track added.");

      // 5. Set up data channel for sending and receiving events
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;
      console.log("Data channel created.");

      dc.onopen = () => {
        console.log("Data channel opened.");
      };
      dc.onclose = () => console.log("Data channel closed.");
      dc.onerror = (err) => console.error("Data channel error:", err);

      dc.onmessage = handleDataChannelMessage;

      // 6. Start the session using the Session Description Protocol (SDP)
      console.log("Creating offer...");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log("Local description set.");

      const baseUrl = "https://api.openai.com/v1/realtime";
      const sdpResponse = await fetch(
        `${baseUrl}?model=${OPENAI_REALTIME_MODEL}`,
        {
          method: "POST",
          body: offer.sdp, // Send the SDP offer
          headers: {
            Authorization: `Bearer ${EPHEMERAL_KEY}`,
            "Content-Type": "application/sdp", // Important: Content-Type is application/sdp
          },
        }
      );

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        console.error(
          "Failed to get SDP answer:",
          sdpResponse.status,
          errorText
        );
        alert(`Failed to get SDP answer: ${errorText}`);
        pc.close();
        return;
      }

      const answerSdp = await sdpResponse.text();
      const answer = {
        type: "answer" as RTCSdpType, // Explicitly type as RTCSdpType
        sdp: answerSdp,
      };
      console.log("SDP Answer received, setting remote description.");
      await pc.setRemoteDescription(new RTCSessionDescription(answer)); // Use RTCSessionDescription constructor
      console.log("WebRTC connection established with OpenAI Realtime API.");
      setIsConnected(true);
    } catch (error) {
      console.error("Error initializing WebRTC connection:", error);
      alert(
        `Error initializing WebRTC: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      setIsConnected(false);
    }
  };

  // 7. Handle Data Channel Message
  async function handleDataChannelMessage(event: MessageEvent) {
    try {
      const msg = JSON.parse(event.data);
      console.log("Received event from OpenAI:", msg);

      switch (msg.type) {
        /**
         *
         */
        case "session.created": {
          console.log("OpenAI Session created:", msg.session.id);
          break;
        }

        /**
         * Streaming AI transcripts (assistant partial)
         */
        case "response.audio_transcript.delta": {
          setTranscription((prev) => prev + msg.delta);
          break;
        }

        /**
         *
         */
        case "response.text.delta": {
          // This is for text output from the model (e.g., if you requested text only)
          // Or if the model sends text alongside audio
          setResponseText((prev) => prev + msg.delta);
          break;
        }

        /**
         *
         */
        case "response.done": {
          console.log("Response done event:", msg);
          // Final transcription might be in msg.response.input_transcription
          // or msg.response.output[0].text if it was a text response
          if (msg.response?.input_transcription) {
            console.log(
              "Final Input Transcription:",
              msg.response.input_transcription
            );
            // This is the text you'd send to LangGraph
            // For now, let's just display it
            setTranscription(msg.response.input_transcription);
          }
          if (msg.response?.output?.[0]?.content[0].text) {
            console.log(
              "Final Text Output:",
              msg.response.output[0].content[0].text
            );
            setResponseText(msg.response.output[0].content[0].text);
          }
          // Here you would typically take the final transcription and send it to your LangGraph agent.
          // For demonstration, we'll clear the live transcription.
          // setTranscription(''); // Or keep the full final transcription
          break;
        }

        /**
         *
         */
        case "response.audio_transcript.delta": {
          setTranscription((prev) => prev + msg.delta);
          break;
        }
      }
    } catch (error) {
      console.error(
        "Error parsing message from OpenAI or handling event:",
        error,
        "Raw data:",
        event.data
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
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setIsConnected(false);
    setTranscription("");
    setResponseText("");
    console.log("Disconnected.");
  };

  // Function to send text to OpenAI for TTS (after getting response from LangGraph)
  const speakText = (textToSpeak: string) => {
    if (
      !dataChannelRef.current ||
      dataChannelRef.current.readyState !== "open"
    ) {
      console.warn("Data channel not open. Cannot send text for TTS.");
      return;
    }

    setResponseText(""); // Clear previous response text

    // Create a new text conversation item
    const createItemEvent = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user", // Or "assistant" if it's a system-initiated message
        content: [
          {
            type: "input_text",
            text: textToSpeak,
          },
        ],
      },
    };
    dataChannelRef.current.send(JSON.stringify(createItemEvent));
    console.log("Sent conversation.item.create for TTS:", textToSpeak);

    // Request the model to generate a response (audio and text, or audio only)
    const createResponseEvent = {
      type: "response.create",
      response: {
        modalities: ["audio", "text"], // Request both audio and text, or just "audio"
        // You can specify voice here too if not set at session level or to override
        // voice: "alloy",
      },
    };
    dataChannelRef.current.send(JSON.stringify(createResponseEvent));
    console.log("Sent response.create for TTS.");
  };

  // Example usage of speakText - you'd call this with LangGraph's output
  const handleLangGraphResponse = () => {
    const exampleTextFromLangGraph =
      "Hello! This is a spoken response generated from text.";
    // In a real app, this text would come from your LangGraph agent.
    speakText(exampleTextFromLangGraph);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex flex-col items-center justify-center space-y-4">
        {!isConnected ? (
          <Button
            className="w-48 h-12 text-lg font-semibold bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer"
            onClick={connectToOpenAI}
          >
            Connect to Assistant
          </Button>
        ) : (
          <Button 
            className="w-48 h-12 text-lg font-semibold bg-red-600 hover:bg-red-700 transition-colors"
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

      <div className="space-y-4">
        <div className="bg-white rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Live Transcription</h2>
          <p className="min-h-[50px] p-3 bg-gray-50 rounded-md border border-gray-200">
            {transcription || "Speak after connecting..."}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Model Response</h2>
          <p className="min-h-[50px] p-3 bg-gray-50 rounded-md border border-gray-200">
            {responseText || "Waiting for model's text response..."}
          </p>
        </div>

        {isConnected && (
          <div className="flex justify-center">
            <Button
              onClick={handleLangGraphResponse}
              className="mt-4 bg-purple-600 hover:bg-purple-700 transition-colors"
            >
              Simulate LangGraph Response & Speak
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
