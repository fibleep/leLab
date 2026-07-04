import React, { useState } from "react";
import { Plus, Check, ChevronsUpDown, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { RobotArmMode } from "@/hooks/useRobots";

interface RobotSelectorProps {
  selectedName: string | null;
  availableNames: string[];
  onSelect: (name: string) => void;
  onCreateNew: (name: string, armMode: RobotArmMode) => Promise<boolean>;
  isLoading: boolean;
}

const RobotSelector: React.FC<RobotSelectorProps> = ({
  selectedName,
  availableNames,
  onSelect,
  onCreateNew,
  isLoading,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [choosingMode, setChoosingMode] = useState(false);

  const trimmed = query.trim();
  const matchesExisting = availableNames.some(
    (n) => n.toLowerCase() === trimmed.toLowerCase()
  );
  const canCreate = trimmed.length > 0 && !matchesExisting;

  const createDisabled = !canCreate;
  const createLabel = matchesExisting
    ? "Already exists"
    : trimmed === ""
      ? "Create new robot…"
      : `Create "${trimmed}"`;

  const reset = () => {
    setQuery("");
    setChoosingMode(false);
    setOpen(false);
  };

  const handlePickExisting = (name: string) => {
    onSelect(name);
    reset();
  };

  const handleCreate = () => {
    if (!canCreate) return;
    setChoosingMode(true);
  };

  const handleCreateWithMode = async (armMode: RobotArmMode) => {
    if (!canCreate) return;
    const ok = await onCreateNew(trimmed, armMode);
    if (ok) reset();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={isLoading}
          className="w-full justify-between bg-gray-900 border-gray-700 text-white hover:bg-gray-700 hover:text-white font-normal"
        >
          <span className={cn("truncate", selectedName ? "" : "text-gray-400")}>
            {isLoading
              ? "Loading..."
              : selectedName ?? "Select a robot or type a new name"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 bg-gray-800 border-gray-700 text-white"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        align="start"
      >
        <Command className="bg-gray-800">
          <CommandInput
            placeholder="Search or type new name..."
            value={query}
            onValueChange={(next) => {
              setQuery(next);
              setChoosingMode(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                handleCreate();
              }
            }}
            className="text-white"
          />
          <CommandList>
            {availableNames.length === 0 && (
              <CommandEmpty className="py-4 text-sm text-gray-400 text-center">
                No robots yet. Type a name to create one.
              </CommandEmpty>
            )}
            {availableNames.length > 0 && (
              <CommandGroup heading="Existing">
                {availableNames.map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    onSelect={() => handlePickExisting(name)}
                    className="text-white aria-selected:bg-gray-700"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedName === name ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          {choosingMode && canCreate ? (
            <div className="border-t border-gray-700">
              <button
                type="button"
                onClick={() => setChoosingMode(false)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-white"
              >
                <ChevronLeft className="h-3 w-3" />
                {`Create "${trimmed}" as…`}
              </button>
              <button
                type="button"
                onClick={() => handleCreateWithMode("single")}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white hover:bg-gray-700"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="text-left">One robot — single arm (VR & inference)</span>
              </button>
              <button
                type="button"
                onClick={() => handleCreateWithMode("pair")}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white hover:bg-gray-700"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="text-left">
                  Two robots — leader + follower (full teleop & recording)
                </span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              disabled={createDisabled}
              className="flex w-full items-center gap-2 border-t border-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-500 disabled:hover:bg-transparent"
            >
              <Plus className="h-4 w-4" />
              {createLabel}
            </button>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default RobotSelector;
