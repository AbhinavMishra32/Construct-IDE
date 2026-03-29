"use client";

import { useEffect, useRef, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type AIThinkingBlockProps = {
  content: string;
  label?: string;
  startedAt?: string | null;
  className?: string;
};

function getElapsedSeconds(startedAt?: string | null): number {
  if (!startedAt) {
    return 0;
  }

  const started = new Date(startedAt).getTime();

  if (!Number.isFinite(started)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

function AIThinkingBlock({
  content,
  label = "Construct is thinking",
  startedAt,
  className
}: AIThinkingBlockProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(() => getElapsedSeconds(startedAt));

  useEffect(() => {
    setElapsedSeconds(getElapsedSeconds(startedAt));

    const intervalHandle = window.setInterval(() => {
      setElapsedSeconds(getElapsedSeconds(startedAt));
    }, 1000);

    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [startedAt]);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    let frameHandle = 0;
    let timeoutHandle = 0;
    let scrollPosition = 0;

    const tick = () => {
      const maxScroll = viewport.scrollHeight - viewport.clientHeight;

      if (maxScroll > 8) {
        scrollPosition = scrollPosition >= maxScroll ? 0 : scrollPosition + 0.45;
        viewport.scrollTop = scrollPosition;
      }

      frameHandle = window.requestAnimationFrame(tick);
    };

    timeoutHandle = window.setTimeout(() => {
      frameHandle = window.requestAnimationFrame(tick);
    }, 900);

    return () => {
      window.clearTimeout(timeoutHandle);

      if (frameHandle) {
        window.cancelAnimationFrame(frameHandle);
      }
    };
  }, [content]);

  return (
    <div className={cn("construct-thinking-block", className)}>
      <div className="construct-thinking-block-header">
        <div className="construct-thinking-block-status">
          <Spinner className="construct-thinking-block-spinner" />
          <p className="construct-thinking-block-title">{label}</p>
        </div>
        <span className="construct-thinking-block-timer">{elapsedSeconds}s</span>
      </div>

      <Card size="sm" className="construct-thinking-block-card">
        <div className="construct-thinking-block-fade is-top" aria-hidden="true" />
        <div className="construct-thinking-block-fade is-bottom" aria-hidden="true" />
        <CardContent className="construct-thinking-block-content">
          <div ref={viewportRef} className="construct-thinking-block-viewport">
            <p>{content}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export { AIThinkingBlock };
