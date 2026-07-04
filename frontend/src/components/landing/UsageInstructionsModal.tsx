import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Terminal, ExternalLink, Copy, Check } from "lucide-react";

const ONE_LINER =
  "uv tool install git+https://github.com/huggingface/leLab.git && lelab";
const LOCAL_URL = "http://localhost:8000/";

interface UsageInstructionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dismissible?: boolean;
}

const UsageInstructionsModal: React.FC<UsageInstructionsModalProps> = ({
  open,
  onOpenChange,
  dismissible = true,
}) => {
  const [copied, setCopied] = useState(false);

  const blockClose = (e: Event) => {
    if (!dismissible) e.preventDefault();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ONE_LINER);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("Clipboard write failed:", err);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={dismissible ? onOpenChange : () => undefined}
    >
      <DialogContent
        className="text-ink-2 sm:max-w-xl"
        hideClose={!dismissible}
        onEscapeKeyDown={blockClose}
        onPointerDownOutside={blockClose}
        onInteractOutside={blockClose}
      >
        <DialogHeader className="text-center sm:text-center min-w-0">
          <DialogTitle className="text-ink flex items-center justify-center gap-2 text-xl">
            <Terminal className="w-6 h-6" />
            Get Started with LeLab
          </DialogTitle>
          <DialogDescription>
            LeLab runs on your machine. Click the command to copy it, then paste
            in a terminal:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 min-w-0">
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy command to clipboard"
            className="group relative w-full bg-subtle rounded-panel border border-line hover:border-brand/50 text-left transition-colors cursor-pointer"
          >
            <pre className="p-4 pr-12 text-xs sm:text-sm overflow-x-auto whitespace-pre-wrap break-all">
              <code className="font-mono text-ink">{ONE_LINER}</code>
            </pre>
            <span className="absolute right-2 top-2 flex items-center gap-1 px-2 py-1 rounded font-mono text-[11px] uppercase tracking-kicker text-ink-3 group-hover:text-ink bg-elevated/80">
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-success" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </>
              )}
            </span>
          </button>
          <p className="font-sans text-ink-3 text-sm text-center">
            After running, your browser will open the local LeLab app.
          </p>
          <Button
            asChild
            className="w-full"
          >
            <a href={LOCAL_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open LeLab
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UsageInstructionsModal;
