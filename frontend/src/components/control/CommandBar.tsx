
import React from 'react';
import { Mic, MicOff, Send, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface CommandBarProps {
  command: string;
  setCommand: (command: string) => void;
  handleSendCommand: () => void;
  isVoiceActive: boolean;
  setIsVoiceActive: (isActive: boolean) => void;
  showCamera: boolean;
  setShowCamera: (show: boolean) => void;
  handleEndSession: () => void;
}

const CommandBar: React.FC<CommandBarProps> = ({
  command,
  setCommand,
  handleSendCommand,
  isVoiceActive,
  setIsVoiceActive,
  showCamera,
  setShowCamera,
  handleEndSession
}) => {
  return (
    <div className="bg-elevated border-t border-line p-4 space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-center max-w-4xl mx-auto w-full">
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Tell the robot what to do…"
          className="flex-1 text-base py-3"
          onKeyPress={(e) => e.key === 'Enter' && handleSendCommand()}
        />
        <Button
          onClick={handleSendCommand}
          className="px-6 py-3 self-stretch sm:self-auto"
        >
          <Send strokeWidth={1.5} />
          Send
        </Button>
      </div>

      <div className="flex justify-center items-center gap-6">
        <div className="flex flex-wrap justify-center gap-2 sm:gap-4">
          <Button
            variant="outline"
            onClick={() => setIsVoiceActive(!isVoiceActive)}
            className={`px-6 py-2 ${isVoiceActive ? 'bg-subtle text-ink' : ''}`}
          >
            {isVoiceActive ? <Mic strokeWidth={1.5} /> : <MicOff strokeWidth={1.5} />}
            Voice Command
          </Button>

          <Button
            variant="outline"
            onClick={() => setShowCamera(!showCamera)}
            className={`px-6 py-2 ${showCamera ? 'bg-subtle text-ink' : ''}`}
          >
            <Camera strokeWidth={1.5} />
            Show Camera
          </Button>

          <Button
            variant="destructive"
            onClick={handleEndSession}
            className="px-6 py-2"
          >
            End Session
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CommandBar;
