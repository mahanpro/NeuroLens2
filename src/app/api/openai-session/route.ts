// app/api/openai-session/route.ts
import { NextResponse } from 'next/server';

// This is the model ID provided in the OpenAI documentation for Realtime API.
// You should verify if there's a newer or more appropriate model ID for your use case.
const OPENAI_REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17";

export async function GET() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_REALTIME_MODEL,
        voice: "alloy",
        modalities: ["audio", "text"],
        instructions:"Start conversation with the user by saying 'Hello, how can I help you today?' Use the available tools when relevant. After executing a tool, you will need to respond (create a subsequent conversation item) to the user sharing the function result or error. If you do not respond with additional message with function result, user will not know you successfully executed the tool.",
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Error creating OpenAI session:", errorData);
      return NextResponse.json({ error: 'Failed to create OpenAI session', details: errorData }, { status: response.status });
    }

    const data = await response.json();
    // The ephemeral key is in data.client_secret.value
    // It's good practice to only send what the client needs.
    return NextResponse.json({ client_secret: data.client_secret });

  } catch (error) {
    console.error("Error in /api/openai-session:", error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}