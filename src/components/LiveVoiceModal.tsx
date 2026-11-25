import { useEffect, useRef, useState } from "react";

function downsampleTo16kHz(input: Float32Array, inputSampleRate: number): Float32Array {
  if (!inputSampleRate || inputSampleRate === 16000) return input;
  const ratio = inputSampleRate / 16000;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.min(input.length, Math.round((offsetResult + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += input[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function floatTo16BitPCM(input: Float32Array, sampleRate = 16000): { b64: string; rms: number } {
  const resampled = downsampleTo16kHz(input, sampleRate);
  const buffer = new ArrayBuffer(resampled.length * 2);
  const view = new DataView(buffer);
  let sumSq = 0;
  for (let i = 0; i < resampled.length; i++) {
    const s = Math.max(-1, Math.min(1, resampled[i]));
    sumSq += s * s;
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return { b64: btoa(binary), rms: Math.sqrt(sumSq / Math.max(1, resampled.length)) };
}

function base64ToPCM16Float(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const outBuf = new ArrayBuffer((bytes.byteLength / 2) * 4);
  const out = new Float32Array(outBuf);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

export function LiveVoiceModal({
  open,
  onClose,
  businessName,
  workspaceId,
}: {
  open: boolean;
  onClose: () => void;
  businessName: string;
  workspaceId?: string;
}) {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [error, setError] = useState("");
  const [voice, setVoice] = useState("Zephyr");
  const [transcripts, setTranscripts] = useState<Array<{ role: "user" | "ai"; text: string }>>([]);
  const [muted, setMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [textInput, setTextInput] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const mutedRef = useRef(false);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const stopSession = () => {
    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
    wsRef.current = null;
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    streamRef.current = null;
    try {
      inputCtxRef.current?.close();
    } catch {
      // ignore
    }
    inputCtxRef.current = null;
    try {
      outputCtxRef.current?.close();
    } catch {
      // ignore
    }
    outputCtxRef.current = null;
    nextStartTimeRef.current = 0;
    setMicLevel(0);
    setStatus("idle");
  };

  const [liveSocketSupported, setLiveSocketSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) {
      stopSession();
      return;
    }
    let cancelled = false;
    fetch("/api/health")
      .then((r) => r.json())
      .then((health: { capabilities?: { nativeWebSocketLiveVoice?: boolean } }) => {
        if (!cancelled && health?.capabilities) {
          setLiveSocketSupported(health.capabilities.nativeWebSocketLiveVoice !== false);
        }
      })
      .catch(() => {
        if (!cancelled) setLiveSocketSupported(true);
      });
    return () => {
      cancelled = true;
      stopSession();
    };
  }, [open]);

  if (!open) return null;

  const startSession = async (withMic = true) => {
    setError("");
    setStatus("connecting");
    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${proto}//${location.host}/ws/live?business=${encodeURIComponent(businessName)}&voice=${encodeURIComponent(voice)}&workspaceId=${encodeURIComponent(workspaceId || "")}`,
      );
      wsRef.current = ws;

      const outputCtx = new AudioContext({ sampleRate: 24000 });
      await outputCtx.resume();
      outputCtxRef.current = outputCtx;

      if (withMic && navigator.mediaDevices?.getUserMedia) {
        try {
          const inputCtx = new AudioContext();
          await inputCtx.resume();
          inputCtxRef.current = inputCtx;

          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;

          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          source.connect(processor);
          processor.connect(inputCtx.destination);

          processor.onaudioprocess = (e) => {
            if (mutedRef.current || ws.readyState !== WebSocket.OPEN) {
              setMicLevel(0);
              return;
            }
            const channel = e.inputBuffer.getChannelData(0);
            const { b64, rms } = floatTo16BitPCM(channel, inputCtx.sampleRate);
            setMicLevel(Math.min(100, Math.round(rms * 420)));
            ws.send(JSON.stringify({ audio: b64 }));
          };
        } catch (micErr) {
          setError(
            `Microphone unavailable (${micErr instanceof Error ? micErr.message : "permission denied"}). You can still type prompts below in Live mode.`,
          );
        }
      }

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as {
          ready?: boolean;
          closed?: boolean;
          audio?: string;
          inputTranscript?: string;
          outputTranscript?: string;
          interrupted?: boolean;
          error?: string;
        };
        if (msg.ready) setStatus("live");
        if (msg.error) {
          setError(msg.error);
          setStatus("error");
        }
        if (msg.closed) {
          setStatus("idle");
        }
        if (msg.inputTranscript) {
          setTranscripts((prev) => [...prev, { role: "user", text: msg.inputTranscript! }]);
        }
        if (msg.outputTranscript) {
          setTranscripts((prev) => [...prev, { role: "ai", text: msg.outputTranscript! }]);
        }
        if (msg.interrupted && outputCtxRef.current) {
          nextStartTimeRef.current = outputCtxRef.current.currentTime;
        }
        if (msg.audio && outputCtxRef.current) {
          if (outputCtxRef.current.state === "suspended") {
            void outputCtxRef.current.resume();
          }
          const samples = base64ToPCM16Float(msg.audio);
          const audioBuf = outputCtxRef.current.createBuffer(1, samples.length, 24000);
          audioBuf.copyToChannel(samples, 0);
          const srcNode = outputCtxRef.current.createBufferSource();
          srcNode.buffer = audioBuf;
          srcNode.connect(outputCtxRef.current.destination);
          const startAt = Math.max(outputCtxRef.current.currentTime, nextStartTimeRef.current);
          srcNode.start(startAt);
          nextStartTimeRef.current = startAt + audioBuf.duration;
        }
      };

      ws.onerror = () => {
        setError("WebSocket connection error during Live Voice session.");
        setStatus("error");
      };
      ws.onclose = () => {
        setStatus((prev) => (prev === "error" ? "error" : "idle"));
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live API connection error");
      setStatus("error");
      stopSession();
    }
  };

  const sendTextTurn = () => {
    const trimmed = textInput.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: trimmed }));
    setTranscripts((prev) => [...prev, { role: "user", text: trimmed }]);
    setTextInput("");
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="mos-modal card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mos-modal-head">
          <div>
            <span className="eyebrow">Gemini 3.8 Live API</span>
            <h2>Live Voice Strategist</h2>
          </div>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <p style={{ color: "var(--muted)", marginBottom: 14 }}>
          Speak or type directly with Marketing OS about hooks, campaign strategy, or creative feedback for{" "}
          <b>{businessName}</b>.
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <label className="mos-model-select compact">
            <span>Voice</span>
            <select
              value={voice}
              disabled={status === "live" || status === "connecting"}
              onChange={(e) => setVoice(e.target.value)}
            >
              {["Zephyr", "Kore", "Puck", "Charon", "Fenrir"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {status === "idle" || status === "error" ? (
            <button
              className="btn primary"
              disabled={liveSocketSupported === false}
              onClick={() => void startSession(true)}
            >
              ● Start Live Voice Session
            </button>
          ) : (
            <>
              <button className="btn secondary" onClick={() => setMuted(!muted)}>
                {muted ? "Unmute Mic" : "Mute Mic"}
              </button>
              <button className="btn danger" onClick={stopSession}>
                End Session
              </button>
            </>
          )}
          <span className={`badge ${status === "live" ? "mint" : status === "error" ? "high" : "blue"}`}>
            <i />
            {liveSocketSupported === false
              ? "Serverless runtime"
              : status === "live"
                ? "Live streaming"
                : status === "connecting"
                  ? "Connecting…"
                  : status === "error"
                    ? "Error"
                    : "Standby"}
          </span>
        </div>

        {liveSocketSupported === false && (
          <div className="mos-error-box" style={{ borderColor: "var(--gold)", color: "var(--gold)" }}>
            Real-time WebSocket Live Voice (<code>/ws/live</code>) requires a persistent Node.js server and is not available on Vercel Serverless Functions. Use <b>Voice &amp; Audio Studio</b> for TTS/transcription or <b>AI Command Center</b> for text strategy.
          </div>
        )}

        {status === "live" && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>
              <span>Microphone Input Level (16kHz PCM)</span>
              <span>{muted ? "Muted" : `${micLevel}%`}</span>
            </div>
            <div className="bar" style={{ height: 6 }}>
              <i style={{ width: `${muted ? 0 : Math.max(4, micLevel)}%`, transition: "width 80ms linear" }} />
            </div>
          </div>
        )}

        {error && <div className="mos-error-box">{error}</div>}

        <div className="mos-transcript-box">
          {transcripts.length === 0 ? (
            <small style={{ color: "var(--muted)" }}>
              Live conversation transcripts appear here once you start speaking or send a text message below.
            </small>
          ) : (
            transcripts.map((t, i) => (
              <div key={i} className={`mos-tx ${t.role}`}>
                <b>{t.role === "user" ? "You" : "Marketing OS"}:</b> {t.text}
              </div>
            ))
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendTextTurn();
            }}
            placeholder={
              status === "live"
                ? "Type a message to the live strategist (helpful if mic is muted)…"
                : "Start a Live session to send voice or text prompts…"
            }
            disabled={status !== "live"}
            style={{
              flex: 1,
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              color: "var(--text)",
              fontSize: 12,
            }}
          />
          <button
            type="button"
            className="btn secondary"
            disabled={status !== "live" || !textInput.trim()}
            onClick={sendTextTurn}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
