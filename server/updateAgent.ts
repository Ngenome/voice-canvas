import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;

    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1);
    if (!(key in process.env) && value !== undefined) {
      process.env[key] = value.replace(/^"|"$/g, "");
    }
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));

const API_BASE = "https://api.elevenlabs.io/v1/convai/agents";

const apiKey =
  process.env.ELEVENLABS_API_KEY ||
  process.env.ELEVEN_LABS_API_KEY ||
  process.env.ELEVEN_LABS_KEY;

const targetAgentId =
  process.argv[2] ||
  process.env.ELEVENLABS_AGENT_ID ||
  process.env.ELEVEN_LABS_AGENT_ID;

const canvasTools = [
  {
    type: "client",
    name: "list_canvas_entries",
    description:
      "Get a lightweight manifest of all cards on the canvas with their index, unique ID slug, and heading title. Use this to find IDs before updating or deleting.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    type: "client",
    name: "read_canvas",
    description:
      "Read full content of all cards or a specific card by ID on the interactive Canvas.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Optional card ID to read only that specific card.",
        },
      },
    },
  },
  {
    type: "client",
    name: "append_to_canvas",
    description:
      "Append a new markdown note, checklist, code block, or GFM table to the user's on-screen canvas.",
    parameters: {
      type: "object",
      properties: {
        markdown: {
          type: "string",
          description: "Markdown formatted content to append to canvas.",
        },
      },
      required: ["markdown"],
    },
  },
  {
    type: "client",
    name: "update_canvas_entry",
    description:
      "Update or edit an existing section/card on the canvas in place using its ID or heading title.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID of the specific card to update (optional if targetTitle is provided).",
        },
        targetTitle: {
          type: "string",
          description: "Heading or keyword of the section to replace/update in place.",
        },
        markdown: {
          type: "string",
          description: "The replacement markdown content for this section.",
        },
      },
      required: ["markdown"],
    },
  },
  {
    type: "client",
    name: "delete_canvas_entry",
    description: "Delete or remove a specific section/card from the canvas using its ID or title.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID of the card to delete." },
        targetTitle: {
          type: "string",
          description: "Heading or keyword of the section to delete.",
        },
      },
    },
  },
  {
    type: "client",
    name: "write_to_canvas",
    description: "Overwrite the entire canvas with brand new content.",
    parameters: {
      type: "object",
      properties: {
        markdown: { type: "string", description: "Markdown content for the canvas." },
      },
      required: ["markdown"],
    },
  },
];

const prompt = `# Role & Personality
You are an intelligent, concise, task-oriented Voice Assistant paired with an on-screen interactive Canvas.

# Interactive Canvas Capabilities
You have direct real-time control over the user's visual Canvas via client tools:
1. **list_canvas_entries**: Lightweight index of all card IDs and titles. Use this to discover available IDs before updating or deleting.
2. **read_canvas**: Read full markdown content of all cards or a specific card by ID.
3. **append_to_canvas**: Append new notes, markdown tables (| Header | Header |), code blocks, or checklists.
4. **update_canvas_entry**: Edit or update an existing section in-place when asked to change or refine a point (avoids duplicate cards).
5. **delete_canvas_entry**: Remove a section from the canvas when requested.

# Guidelines
- When presenting structured data, comparisons, or schedules, use GFM Markdown tables.
- When writing code, use triple backticks with the language identifier (e.g. \`\`\`typescript).
- Keep spoken responses brief and natural while placing dense information on the Canvas.`;

function buildPayload() {
  return {
    conversation_config: {
      agent: {
        first_message: "Agent is running. Lets chat.",
        language: "en",
        prompt: {
          prompt,
          llm: "claude-sonnet-4-5",
          temperature: 0.7,
          tools: canvasTools,
        },
      },
      conversation: {
        max_duration_seconds: 1200, // 20 minutes
      },
    },
  };
}

function mask(value: string | undefined) {
  if (!value) return "not set";
  if (value.length <= 10) return "***";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function updateAgent(agentId: string, payload: Record<string, unknown>) {
  const response = await fetch(`${API_BASE}/${agentId}`, {
    method: "PATCH",
    headers: {
      "xi-api-key": apiKey || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`PATCH failed (${response.status}): ${bodyText}`);
  }

  console.log(`✅ Agent ${agentId} updated with full bidirectional Canvas tools.`);
}

if (!apiKey) {
  console.error("Missing ELEVENLABS_API_KEY in env.");
  process.exit(1);
}

if (!targetAgentId) {
  console.error("Missing agent id. Pass it as arg or set ELEVENLABS_AGENT_ID in .env");
  process.exit(1);
}

(async () => {
  console.log(`Updating agent ${targetAgentId} using key ${mask(apiKey)}...`);
  try {
    await updateAgent(targetAgentId, buildPayload());
  } catch (err) {
    console.error("Failed to patch agent:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
})();
