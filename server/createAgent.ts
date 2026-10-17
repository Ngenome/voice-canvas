import { webTools, readingTools, timeTools, WEB_SEARCH_PROMPT, READING_PROMPT, TIME_PROMPT } from "./agentTools";

const API = "https://api.elevenlabs.io/v1/convai/agents/create";
const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;

if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is missing from .env");
  process.exit(1);
}

const canvasTools = [
  {
    type: "client",
    name: "append_to_canvas",
    description:
      "Append a markdown block to the on-screen canvas (do not replace existing content).",
    parameters: {
      type: "object",
      properties: {
        markdown: { type: "string", description: "Markdown content to append." },
        content: { type: "string", description: "Fallback content if markdown is absent." },
        text: { type: "string", description: "Fallback plain text to append." },
      },
    },
  },
  {
    type: "client",
    name: "append_markdown",
    description: "Append markdown content to the canvas using append behavior.",
    parameters: {
      type: "object",
      properties: {
        markdown: { type: "string", description: "Markdown content to append." },
        content: { type: "string", description: "Fallback content if markdown is absent." },
        text: { type: "string", description: "Fallback plain text to append." },
      },
    },
  },
];

const prompt = `# Personality
You are a concise, helpful, task-oriented voice agent.

# Goal
Keep a running visible notes canvas for this call.

# Tooling
- Use a canvas tool whenever you produce summaries, plans, lists, or key takeaways.
- Tool usage should append content; do not overwrite existing canvas entries.
- Prefer these tools:
  - append_to_canvas
  - append_markdown
- Send markdown in the \"markdown\" field.
- Keep entries short and structured (headings/lists/code) when useful.

# Tone
Friendly, clear, and brief.

${WEB_SEARCH_PROMPT}

${READING_PROMPT}

${TIME_PROMPT}`;

const config = {
  name: "Lean Voice Agent",
  platform_settings: {
    overrides: {
        conversation_config_override: { agent: { first_message: true, prompt: { llm: true } }, tts: { voice_id: true, speed: true } },
      },
  },
  conversation_config: {
    agent: {
      first_message: "Agent is running. Lets chat.",
      language: "en",
      prompt: {
        prompt,
        llm: "claude-sonnet-5-5",
        reasoning_effort: "low", // a little thinking; keeps replies quick for voice
        temperature: 0.7,
        tools: [...canvasTools, ...webTools, ...readingTools, ...timeTools],
      },
    },
    conversation: { max_duration_seconds: 7200 },
  },
};

async function create() {
  console.log("Creating new lean ElevenLabs Voice Agent...");
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey as string,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Failed to create agent (${res.status}):`, errText);
    process.exit(1);
  }

  const data = (await res.json()) as { agent_id: string };
  console.log("SUCCESS! Created new Agent ID:", data.agent_id);
  return data.agent_id;
}

create();
