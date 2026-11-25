import type { Server as HttpServer } from "http";
import { Modality, type LiveServerMessage } from "@google/genai";
import { WebSocket, WebSocketServer } from "ws";
import { getGeminiClient, formatGeminiError } from "../ai/geminiClient.js";
import { stateStore } from "../services/stateStore.js";

export function attachLiveVoiceBridge(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });
  wss.on("error", (err) => {
    console.error("Live voice WebSocket error:", err);
  });

  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (url.pathname === "/ws/live") {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      }
    } catch {
      // Ignore malformed upgrade URL
    }
  });

  wss.on("connection", async (clientWs: WebSocket, req) => {
    let session: Awaited<ReturnType<ReturnType<typeof getGeminiClient>["live"]["connect"]>> | null = null;
    try {
      const url = new URL(req.url || "/ws/live", "http://localhost");
      const businessName = url.searchParams.get("business") || "your business";
      const workspaceId = (url.searchParams.get("workspaceId") || "").replace(/[^a-zA-Z0-9_-]/g, "");
      const voiceName = url.searchParams.get("voice") || "Zephyr";

      const approvedMemories = workspaceId
        ? stateStore.listMemories(workspaceId).filter((m) => m.approved).slice(0, 8)
        : [];
      const memorySnippet = approvedMemories.length
        ? `\nApproved workspace facts:\n${approvedMemories.map((m) => `- ${m.title}: ${m.content}`).join("\n")}`
        : "";

      const ai = getGeminiClient();
      session = await ai.live.connect({
        model: "gemini-3.8-live",
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          systemInstruction: `You are Marketing OS Live Voice Strategist for ${businessName}. Give sharp, actionable, concise marketing advice about positioning, hooks, video scripts, SEO, and growth experiments. Keep spoken answers crisp and conversational.${memorySnippet}`,
        },
        callbacks: {
          onopen: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ ready: true }));
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              clientWs.send(JSON.stringify({ inputTranscript: content.inputTranscription.text }));
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(JSON.stringify({ outputTranscript: content.outputTranscription.text }));
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
            if (content?.turnComplete) {
              clientWs.send(JSON.stringify({ turnComplete: true }));
            }
          },
          onerror: (err: unknown) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              const formatted = formatGeminiError(err);
              clientWs.send(JSON.stringify({ error: formatted.message }));
            }
          },
          onclose: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ closed: true }));
              clientWs.close();
            }
          },
        },
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ error: formatted.message }));
        clientWs.close();
      }
      return;
    }

    clientWs.on("message", (raw) => {
      if (!session) return;
      try {
        const msg = JSON.parse(raw.toString()) as { audio?: string; text?: string };
        if (msg.audio) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
          });
        } else if (msg.text) {
          session.sendRealtimeInput({
            text: msg.text,
          });
        }
      } catch {
        // Ignore malformed client message
      }
    });

    clientWs.on("close", () => {
      try {
        session?.close();
      } catch {
        // Ignore close error
      }
      session = null;
    });
  });
}
