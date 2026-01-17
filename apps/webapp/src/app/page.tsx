'use client';

import { featureFlags } from '@workspace/backend/config/featureFlags';
import { ArrowRight, CheckCircle2, ClipboardList, Monitor, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useAppVersion } from '@/modules/app/useAppInfo';
import { useAuthState } from '@/modules/auth/AuthProvider';

/**
 * Terminal-style animated text component
 */
function TypewriterText({
  text,
  delay = 50,
  className = '',
}: {
  text: string;
  delay?: number;
  className?: string;
}) {
  const [displayText, setDisplayText] = useState('');
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      if (index < text.length) {
        setDisplayText(text.slice(0, index + 1));
        index++;
      } else {
        clearInterval(timer);
      }
    }, delay);

    return () => clearInterval(timer);
  }, [text, delay]);

  useEffect(() => {
    const cursorTimer = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 530);
    return () => clearInterval(cursorTimer);
  }, []);

  return (
    <span className={className}>
      {displayText}
      <span
        className={`inline-block w-[2px] h-[1em] bg-current ml-[2px] align-middle transition-opacity duration-100 ${showCursor ? 'opacity-100' : 'opacity-0'}`}
      />
    </span>
  );
}

/**
 * Animated floating orb for visual interest
 */
function FloatingOrb({
  size,
  color,
  delay,
  duration,
  initialX,
  initialY,
}: {
  size: number;
  color: string;
  delay: number;
  duration: number;
  initialX: number;
  initialY: number;
}) {
  return (
    <div
      className="absolute rounded-full blur-3xl opacity-20 pointer-events-none animate-float"
      style={{
        width: size,
        height: size,
        background: color,
        left: `${initialX}%`,
        top: `${initialY}%`,
        animationDelay: `${delay}s`,
        animationDuration: `${duration}s`,
      }}
    />
  );
}

/**
 * Animated status line showing "agent activity"
 * Uses square indicators per industrial design system (no circles)
 */
function AgentStatusLine({
  agent,
  status,
  delay,
}: {
  agent: string;
  status: string;
  delay: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  if (!visible) return null;

  return (
    <div className="flex items-center gap-3 text-xs font-mono opacity-0 animate-fadeIn">
      <span className="w-1.5 h-1.5 bg-emerald-400" />
      <span className="text-zinc-500 uppercase tracking-wider font-bold">{agent}</span>
      <ArrowRight className="w-3 h-3 text-zinc-600" strokeWidth={2} />
      <span className="text-zinc-400">{status}</span>
    </div>
  );
}

/**
 * Feature card component
 * Industrial design: sharp corners, 2px borders, uppercase headers
 */
function FeatureCard({
  icon,
  title,
  description,
  delay,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  delay: number;
}) {
  return (
    <div
      className="group relative p-4 border-2 border-zinc-800 bg-zinc-900/50 backdrop-blur-sm hover:border-zinc-700 hover:bg-zinc-900/80 transition-all duration-100 opacity-0 animate-slideUp"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'forwards' }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-100" />
      <div className="relative">
        <div className="text-emerald-400 mb-3">{icon}</div>
        <h3 className="text-sm font-bold text-zinc-100 mb-2 uppercase tracking-wider">{title}</h3>
        <p className="text-zinc-500 text-xs leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

/**
 * Landing page for unauthenticated users at "/"
 * Terminal/Command Center aesthetic with subtle animations
 */
export default function Home() {
  const appVersion = useAppVersion();
  const authState = useAuthState();
  const isAuthenticated = authState?.state === 'authenticated';

  return (
    <>
      <style jsx global>{`
        @keyframes float {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -30px) scale(1.05);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.95);
          }
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes pulse-glow {
          0%,
          100% {
            box-shadow: 0 0 20px rgba(16, 185, 129, 0.2);
          }
          50% {
            box-shadow: 0 0 40px rgba(16, 185, 129, 0.4);
          }
        }
        .animate-float {
          animation: float 20s ease-in-out infinite;
        }
        .animate-fadeIn {
          animation: fadeIn 0.6s ease-out forwards;
        }
        .animate-slideUp {
          animation: slideUp 0.6s ease-out forwards;
        }
        .animate-pulse-glow {
          animation: pulse-glow 3s ease-in-out infinite;
        }
      `}</style>

      <div className="flex-1 bg-zinc-950 text-zinc-100 overflow-auto relative">
        {/* Ambient background orbs */}
        <div className="absolute inset-0 overflow-hidden">
          <FloatingOrb
            size={400}
            color="radial-gradient(circle, rgba(16,185,129,0.3) 0%, transparent 70%)"
            delay={0}
            duration={25}
            initialX={10}
            initialY={20}
          />
          <FloatingOrb
            size={300}
            color="radial-gradient(circle, rgba(59,130,246,0.2) 0%, transparent 70%)"
            delay={5}
            duration={30}
            initialX={70}
            initialY={60}
          />
          <FloatingOrb
            size={250}
            color="radial-gradient(circle, rgba(168,85,247,0.15) 0%, transparent 70%)"
            delay={10}
            duration={22}
            initialX={50}
            initialY={10}
          />
        </div>

        {/* Subtle grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
            backgroundSize: '50px 50px',
          }}
        />

        {/* Main content */}
        <div className="relative z-10 flex flex-col min-h-full">
          {/* Hero section */}
          <main className="flex-1 flex flex-col items-center justify-center px-6 py-20">
            <div className="max-w-4xl w-full space-y-12">
              {/* Terminal window header */}
              <div className="opacity-0 animate-fadeIn" style={{ animationDelay: '200ms' }}>
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900/80 border-2 border-zinc-800 backdrop-blur-sm">
                  <span className="w-2.5 h-2.5 bg-red-400/80" />
                  <span className="w-2.5 h-2.5 bg-amber-400/80" />
                  <span className="w-2.5 h-2.5 bg-emerald-400/80" />
                  <span className="ml-4 text-[10px] font-mono text-zinc-500 uppercase tracking-wider font-bold">
                    ~/multi-agent-collaboration
                  </span>
                </div>
              </div>

              {/* Main headline */}
              <div className="space-y-6">
                <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight">
                  <span className="text-zinc-400 font-mono text-xl sm:text-2xl block mb-2">$</span>
                  <TypewriterText
                    text="Multi-Agent Collaboration"
                    delay={40}
                    className="text-zinc-100"
                  />
                </h1>

                <p
                  className="text-lg sm:text-xl text-zinc-400 max-w-2xl leading-relaxed opacity-0 animate-fadeIn"
                  style={{ animationDelay: '1500ms' }}
                >
                  Orchestrate AI agents working together in real-time. Builder, Reviewer, Architect
                  — each with their own role, working in harmony to build software.
                </p>
              </div>

              {/* Agent status simulation */}
              <div
                className="space-y-2 py-4 border-l-2 border-zinc-800 pl-4 opacity-0 animate-fadeIn"
                style={{ animationDelay: '2000ms' }}
              >
                <AgentStatusLine agent="builder" status="implementing feature" delay={2200} />
                <AgentStatusLine agent="reviewer" status="awaiting handoff" delay={2600} />
                <AgentStatusLine agent="architect" status="planning next task" delay={3000} />
              </div>

              {/* CTA buttons */}
              <div
                className="flex flex-wrap gap-3 opacity-0 animate-fadeIn"
                style={{ animationDelay: '2500ms' }}
              >
                {isAuthenticated ? (
                  <Link href="/app">
                    <Button
                      size="lg"
                      className="bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-bold text-xs uppercase tracking-wider px-8 py-6 rounded-none transition-opacity hover:opacity-90"
                    >
                      <span>Open Dashboard</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-2" strokeWidth={2} />
                    </Button>
                  </Link>
                ) : (
                  <>
                    {!featureFlags.disableLogin && (
                      <Link href="/login">
                        <Button
                          size="lg"
                          className="bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-bold text-xs uppercase tracking-wider px-8 py-6 rounded-none transition-opacity hover:opacity-90"
                        >
                          <span>Get Started</span>
                          <ArrowRight className="w-3.5 h-3.5 ml-2" strokeWidth={2} />
                        </Button>
                      </Link>
                    )}
                    <Link href="/app">
                      <Button
                        size="lg"
                        variant="outline"
                        className="border-2 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 font-bold text-xs uppercase tracking-wider px-8 py-6 rounded-none transition-opacity hover:opacity-80"
                      >
                        Explore Demo
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </main>

          {/* Features section */}
          <section className="px-6 py-20 border-t-2 border-zinc-900">
            <div className="max-w-6xl mx-auto">
              <h2
                className="text-sm font-bold text-zinc-300 mb-8 uppercase tracking-wider opacity-0 animate-fadeIn flex items-center gap-2"
                style={{ animationDelay: '3000ms' }}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2} />
                <span>How it works</span>
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <FeatureCard
                  icon={<Monitor className="w-4 h-4" strokeWidth={2} />}
                  title="Independent Harnesses"
                  description="Each agent runs in its own IDE — Cursor, Claude Code, Windsurf, or any AI-enabled editor. Parallel development without conflicts."
                  delay={3200}
                />
                <FeatureCard
                  icon={<ClipboardList className="w-4 h-4" strokeWidth={2} />}
                  title="Task Backlog"
                  description="Queue up multiple tasks while agents work. The backlog persists so nothing gets lost — pick up where you left off anytime."
                  delay={3400}
                />
                <FeatureCard
                  icon={<RefreshCw className="w-4 h-4" strokeWidth={2} />}
                  title="Handoff Protocol"
                  description="Structured handoffs between roles with built-in review gates. Builders implement, reviewers verify — quality before shipping."
                  delay={3600}
                />
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="px-6 py-8 border-t-2 border-zinc-900">
            <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
              <div className="font-mono tabular-nums">
                <span className="text-zinc-600 uppercase tracking-wider font-bold">v</span>
                {appVersion ?? '...'}
              </div>
              <div className="flex items-center gap-6">
                <span className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-emerald-400" />
                  <span className="uppercase tracking-wider font-bold text-[10px]">
                    Operational
                  </span>
                </span>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
