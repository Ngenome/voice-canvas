import React, { useEffect, useState } from "react";
import { X, Eye, EyeOff } from "lucide-react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  setAgentId: (id: string) => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  onSave: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, agentId, setAgentId, apiKey, setApiKey, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStatus(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId.trim(), api_key: apiKey.trim() }),
      });
      if (!res.ok) throw new Error("The server didn't accept the settings.");
      setStatus({ ok: true, msg: "Saved" });
      onSave();
      setTimeout(onClose, 700);
    } catch (err: any) {
      setStatus({ ok: false, msg: err?.message || "Couldn't save settings." });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 fade-in" onClick={onClose} />
      <form onSubmit={handleSave} className="relative w-full max-w-md panel rounded-2xl rise">
        <header className="flex items-center justify-between px-6 pt-5 pb-2">
          <h2 className="font-serif text-xl font-medium">Settings</h2>
          <button type="button" onClick={onClose} className="btn btn-icon -mr-2" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-6 py-3 space-y-5">
          <label className="block">
            <span className="text-sm font-medium">ElevenLabs agent ID</span>
            <input
              type="text"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="agent_..."
              required
              className="field font-mono text-[0.85rem] mt-1.5"
            />
            <span className="block text-xs text-faint mt-1.5">Find it in the ElevenLabs dashboard under Agents.</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium">
              API key <span className="text-faint font-normal">(optional for public agents)</span>
            </span>
            <div className="relative mt-1.5">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk_..."
                className="field font-mono text-[0.85rem] pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-fg transition-colors"
                title={showApiKey ? "Hide key" : "Show key"}
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <span className="block text-xs text-faint mt-1.5">Stays on your local server. Used to start secure voice sessions.</span>
          </label>
        </div>

        <footer className="flex items-center justify-between gap-3 px-6 py-4 mt-2 border-t border-line">
          <span className={`text-sm ${status ? (status.ok ? "text-live" : "text-danger") : ""}`}>{status?.msg}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn">
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="btn btn-primary">
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
};
