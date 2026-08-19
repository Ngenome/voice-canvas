import React from "react";
import { Sparkles, Award } from "lucide-react";

export interface TraitScore {
  label: string;
  score: number;
  verdict: "Good" | "Fair" | "Needs work";
}

export interface PsychometricProfile {
  readiness: number;
  band: "Strong" | "Good" | "Fair" | "Needs review";
  summary: string;
  traits: TraitScore[];
  strengths: string[];
  concerns: string[];
  recommendation: string;
  insight: string;
}

interface AssessmentReportProps {
  profile: PsychometricProfile;
}

export const AssessmentReport: React.FC<AssessmentReportProps> = ({ profile }) => {
  const getBandBadgeClass = (band: string) => {
    switch (band) {
      case "Strong":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
      case "Good":
        return "bg-sky-500/10 text-sky-400 border-sky-500/30";
      case "Fair":
        return "bg-amber-500/10 text-amber-400 border-amber-500/30";
      default:
        return "bg-rose-500/10 text-rose-400 border-rose-500/30";
    }
  };

  const getVerdictClass = (verdict: string) => {
    switch (verdict) {
      case "Good":
        return "text-emerald-400";
      case "Fair":
        return "text-amber-400";
      default:
        return "text-rose-400";
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-5 animate-in fade-in duration-300">
      {/* Score Overview Card */}
      <div className="surface-card rounded-3xl p-6 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sky-400 font-semibold text-xs uppercase tracking-wider">
              <Sparkles className="w-4 h-4" />
              <span>Session Assessment Evaluation</span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed max-w-md">{profile.summary}</p>
          </div>

          <div className="flex flex-col items-center flex-shrink-0 bg-zinc-900/80 border border-zinc-800 p-4 rounded-2xl">
            <div className="text-3xl font-extrabold text-zinc-100 font-mono">
              {profile.readiness}
              <span className="text-sm text-zinc-500 font-normal">/100</span>
            </div>
            <span
              className={`mt-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${getBandBadgeClass(
                profile.band,
              )}`}
            >
              {profile.band} Band
            </span>
          </div>
        </div>
      </div>

      {/* Trait Breakdown */}
      <div className="surface-card rounded-3xl p-6 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
          <Award className="w-4 h-4 text-sky-400" />
          <span>Assessed Trait Dimensions</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {profile.traits.map((t, idx) => (
            <div key={idx} className="bg-zinc-900/60 p-3.5 rounded-2xl border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-200">{t.label}</span>
                <span className={`font-mono font-semibold text-[11px] ${getVerdictClass(t.verdict)}`}>
                  {t.score}% • {t.verdict}
                </span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    t.score >= 75
                      ? "bg-emerald-400"
                      : t.score >= 50
                      ? "bg-amber-400"
                      : "bg-rose-400"
                  }`}
                  style={{ width: `${t.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
