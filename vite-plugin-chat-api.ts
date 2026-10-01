import type { Plugin } from "vite";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type ChatBody = {
  provider?: string;
  apiKey?: string;
  messages?: { role: string; content: string }[];
};

type NodeReq = {
  method?: string;
  on: (event: string, cb: (chunk?: Buffer | Error) => void) => void;
};

type NodeRes = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

function cors(res: NodeRes) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function readBody(req: NodeReq): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      if (chunk && !(chunk instanceof Error)) chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", (err) => reject(err));
  });
}

function json(res: NodeRes, status: number, payload: unknown) {
  cors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function handleChat(req: NodeReq, res: NodeRes) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    json(res, 405, { error: { message: "Use POST." } });
    return;
  }

  let parsed: ChatBody;
  try {
    parsed = JSON.parse(await readBody(req)) as ChatBody;
  } catch {
    json(res, 400, { error: { message: "Invalid JSON body." } });
    return;
  }

  const provider = parsed.provider === "openai" ? "openai" : "deepseek";
  const apiKey = (parsed.apiKey ?? "").trim();
  if (!apiKey) {
    json(res, 400, { error: { message: "Missing API key." } });
    return;
  }

  const url = provider === "openai" ? OPENAI_URL : DEEPSEEK_URL;
  const payload: Record<string, unknown> = {
    model: provider === "openai" ? "gpt-4o-mini" : "deepseek-flash",
    messages: parsed.messages ?? [],
    stream: false,
  };
  if (provider === "deepseek") {
    payload.thinking = { type: "disabled" };
  }

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    cors(res);
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", "application/json");
    res.end(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream request failed.";
    json(res, 502, {
      error: { message: `Could not reach the chat service (${message}).` },
    });
  }
}

export function chatApiPlugin(): Plugin {
  return {
    name: "local-chat-api",
    configureServer(server) {
      server.middlewares.use("/api/chat", (req, res) => {
        void handleChat(req as NodeReq, res as NodeRes);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/chat", (req, res) => {
        void handleChat(req as NodeReq, res as NodeRes);
      });
    },
  };
}
