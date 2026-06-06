import { Button } from "../primitives/Button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../primitives/DropdownMenu";
import "./composer.css";

export function Composer({ placeholder }: { placeholder: string }) {
  return (
    <form className="codex-composer">
      <textarea aria-label="Prompt" placeholder={placeholder} rows={2} />
      <div className="codex-composer-footer">
        <div className="codex-composer-tools">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="codex-composer-round-button" type="button" aria-label="Open attachments menu">
                +
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="codex-composer-plus-menu" side="top">
              <DropdownMenuItem>
                <span className="codex-menu-icon">⌕</span>
                <span>Add photos & files</span>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <span className="codex-menu-icon">◉</span>
                <span>Attach Electron</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={false}>Plan mode</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={false}>Pursue goal</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Plugins</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>Browser</DropdownMenuItem>
                  <DropdownMenuItem>Vercel</DropdownMenuItem>
                  <DropdownMenuItem>Notion</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
          <button className="codex-composer-access-button" type="button">
            <span className="codex-composer-shield">!</span>
            Full access
            <span className="codex-composer-chevron">⌄</span>
          </button>
        </div>
        <div className="codex-composer-model-controls">
          <div className="codex-composer-model-trigger">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="codex-composer-model-button" type="button" aria-label="Select model">
                  <span className="codex-composer-model-version">5.5</span>
                  <span className="codex-composer-model-reasoning">Extra High</span>
                  <ChevronDownIcon />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="codex-composer-model-menu" side="top">
                <div className="codex-composer-menu-label">Reasoning</div>
                <DropdownMenuItem>Low</DropdownMenuItem>
                <DropdownMenuItem>Medium</DropdownMenuItem>
                <DropdownMenuItem>High</DropdownMenuItem>
                <DropdownMenuItem>
                  Extra High <CheckIcon />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>GPT-5.5</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="codex-composer-model-submenu">
                    <div className="codex-composer-menu-label">Model</div>
                    <DropdownMenuItem>
                      GPT-5.5 <CheckIcon />
                    </DropdownMenuItem>
                    <DropdownMenuItem>GPT-5.4</DropdownMenuItem>
                    <DropdownMenuItem>GPT-5.4-Mini</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Speed</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem>Balanced</DropdownMenuItem>
                    <DropdownMenuItem>Fast</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="codex-composer-model-tooltip">
              Select model <kbd>^⇧M</kbd>
            </span>
          </div>
          <button className="codex-composer-mic" type="button" aria-label="Dictate">
            <MicIcon />
          </button>
          <Button type="submit" variant="primary">
            ↑
          </Button>
        </div>
      </div>
    </form>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.75 7.75 4.25 4.25 4.25-4.25" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="codex-menu-check" viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4.5 10.5 3.5 3.5 7.5-8" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 12.25a3 3 0 0 0 3-3V5.5a3 3 0 0 0-6 0v3.75a3 3 0 0 0 3 3Z" />
      <path d="M4.75 9.25a5.25 5.25 0 0 0 10.5 0" />
      <path d="M10 14.5v3" />
    </svg>
  );
}
