// app/api/describe-scene/route.ts
import { NextResponse } from 'next/server';

// Ensure your OPENAI_API_KEY is set in your .env.local file
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_VISION_MODEL_FOR_CHAT_COMPLETIONS = "gpt-4.1-nano-2025-04-14";

export async function POST(request: Request) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OpenAI API key not configured on server.' }, { status: 500 });
  }

  try {
    const { image_data_url, prompt } = await request.json(); // Expect base64 image data URL

    if (!image_data_url) {
      return NextResponse.json({ error: 'No image data provided.' }, { status: 400 });
    }

    const payload = {
      model: OPENAI_VISION_MODEL_FOR_CHAT_COMPLETIONS, // Use your specified vision model
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt || 'Describe what you see in this image.',
            },
            {
              type: 'image_url',
              image_url: {
                url: image_data_url, // e.g., "data:image/jpeg;base64,{base64_image_string}"
              },
            },
          ],
        },
      ],
      max_tokens: 300, // Adjust as needed
    };

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!openaiResponse.ok) {
      const errorBody = await openaiResponse.json();
      console.error('OpenAI Chat Completions API error:', errorBody);
      return NextResponse.json(
        { error: 'Failed to get description from OpenAI.', details: errorBody },
        { status: openaiResponse.status }
      );
    }

    const data = await openaiResponse.json();
    const description = data.choices?.[0]?.message?.content;

    if (description) {
      return NextResponse.json({ description });
    } else {
      console.error('No description in OpenAI response:', data);
      return NextResponse.json({ error: 'No description received from OpenAI.' }, { status: 500 });
    }

  } catch (error) {
    console.error('Error in describe-scene API route:', error);
    return NextResponse.json(
        { error: 'Internal server error.', details: (error as Error).message },
        { status: 500 }
    );
  }
}