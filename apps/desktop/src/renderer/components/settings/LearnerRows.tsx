import { useEffect, useState } from "react";
import { ChevronsUpDown } from "lucide-react";

import { LANGUAGES, type Language } from "@construct/domain";
import type { ConstructApi, LearnerProfile } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { message } from "@/lib/format";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { FOOTINGS, LEANINGS, PACES } from "../onboarding/intake";
import { SettingsControl, SettingsField, SettingsGroup, SettingsRow } from "./layout";

/**
 * What Construct believes about the learner, and how to correct it.
 *
 * Everything here is editable, including the answers the portrait was written
 * from. That was not always true: the answers were shown as a read-only summary
 * on the argument that changing one would leave the paragraph above it
 * describing somebody else. The argument was sound and the result was still
 * wrong — a profile you can read and cannot fix is a profile you distrust, and
 * a learner whose footing has changed since the intake had to sit through the
 * whole thing again to say so.
 *
 * So the two halves are edited on their own terms. The answers are facts about
 * you and they are yours to set; the portrait is prose about you and it is
 * yours to rewrite. Neither silently rewrites the other, because a paragraph
 * that changes under you while you are reading it is worse than one that is a
 * little out of date. What does rewrite the portrait is going through the
 * intake again, which is the row at the bottom and says so.
 */
export function LearnerRows({
  api,
  onError,
  onRetake,
}: {
  api: ConstructApi | undefined;
  onError(value: string): void;
  /** Runs the intake again, over the app. */
  onRetake(profile: LearnerProfile): void;
}) {
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [portrait, setPortrait] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      ?.readLearner()
      .then((value) => {
        setProfile(value);
        setPortrait(value.portrait);
      })
      .catch((cause: unknown) => onError(message(cause)));
  }, [api, onError]);

  if (!profile) return null;

  /* One write for every answer, so each row only has to say what it changes.
     `updatedAt` is the main process's to set and is dropped rather than sent
     back — it is the record of the save, not part of what is saved. */
  const save = async (patch: Partial<LearnerProfile>) => {
    if (!api) return;
    setBusy(true);
    try {
      const { updatedAt: _updatedAt, ...rest } = profile;
      setProfile(await api.saveLearner({ ...rest, ...patch }));
    } catch (cause) {
      onError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  /* Saved on blur rather than on every keystroke: this writes a file as well as
     a row, and a write per character is a write per character. */
  const commitPortrait = async () => {
    if (portrait.trim() === profile.portrait.trim()) return;
    await save({ portrait: portrait.trim() });
  };

  const leanings = LEANINGS.filter((option) => profile.leanings.includes(option.value));

  return (
    <>
      <SettingsGroup>
        <SettingsRow>
          <SettingsField
            description="Written by Construct from your intake, and carried into every project. Yours to correct."
            title="How Construct sees you"
          />
        </SettingsRow>
        <SettingsRow className="block">
          <Textarea
            className={cn("min-h-[7rem] w-full resize-none text-ui leading-relaxed", busy && "opacity-60")}
            disabled={busy}
            onBlur={() => void commitPortrait()}
            onChange={(event) => setPortrait(event.target.value)}
            placeholder="Nothing recorded yet."
            value={portrait}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow>
          <SettingsField description="How much code you had written before Construct." title="Starting from" />
          <SettingsControl className="max-w-none">
            <Select disabled={busy} onValueChange={(value) => void save({ footing: value as LearnerProfile["footing"] })} value={profile.footing}>
              <SelectTrigger className="w-56 *:data-[slot=select-value]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FOOTINGS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsControl>
        </SettingsRow>

        <SettingsRow>
          <SettingsField description="What Construct explains in, whatever the code is written in." title="Home language" />
          <SettingsControl className="max-w-none">
            <Select disabled={busy} onValueChange={(value) => void save({ language: value as Language })} value={profile.language}>
              <SelectTrigger className="w-56 *:data-[slot=select-value]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((language) => (
                  <SelectItem key={language} value={language}>
                    <LanguageGlyph className="size-3.5" language={language} />
                    {LANGUAGE_LABEL[language]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsControl>
        </SettingsRow>

        <SettingsRow>
          <SettingsField description="How far Construct goes before moving on." title="Pace" />
          <SettingsControl className="max-w-none">
            <Select disabled={busy} onValueChange={(value) => void save({ pace: value as LearnerProfile["pace"] })} value={profile.pace}>
              <SelectTrigger className="w-56 *:data-[slot=select-value]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PACES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsControl>
        </SettingsRow>

        {/* A menu rather than four switches in a row: these are not four
            independent settings, they are one answer that happens to accept
            more than one value, and the summary on the trigger is how you read
            it back without opening anything. */}
        <SettingsRow>
          <SettingsField description="Pick as many as fit. Construct leans on these when it has a choice." title="Explanations land when" />
          <SettingsControl className="max-w-none">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* Wearing the select's own trigger rather than a button's,
                    because this row answers the same kind of question as the
                    three above it and a different shape here would say it does
                    not. It is a menu underneath only because the answer takes
                    more than one value, which is the one thing a select cannot
                    do — that is a fact about the control, not about the row. */}
                <button
                  className="border-input flex h-8 w-56 items-center justify-between gap-1.5 rounded-lg border bg-transparent py-1 pr-2 pl-2.5 text-sm transition-colors outline-none select-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50"
                  disabled={busy}
                  type="button"
                >
                  <span className="min-w-0 truncate text-left">
                    {leanings.length === 0 ? "No preference" : leanings.length === 1 ? leanings[0]!.label : `${leanings.length} chosen`}
                  </span>
                  <ChevronsUpDown className="text-muted-foreground/70 size-3.5 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {LEANINGS.map((option) => {
                  const on = profile.leanings.includes(option.value);
                  return (
                    <DropdownMenuCheckItem
                      checked={on}
                      key={option.value}
                      /* Kept open: choosing one of four is usually choosing two
                         of four, and a menu that closes after each makes you
                         reopen it to finish the same thought. */
                      onSelect={(event) => {
                        event.preventDefault();
                        void save({
                          leanings: on
                            ? profile.leanings.filter((value) => value !== option.value)
                            : [...profile.leanings, option.value],
                        });
                      }}
                    >
                      {option.label}
                    </DropdownMenuCheckItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingsControl>
        </SettingsRow>

        <SettingsRow>
          <SettingsField
            description="Answers the questions again from the start, and rewrites the portrait above to match them."
            title="Go through the intake again"
          />
          <SettingsControl>
            <Button onClick={() => onRetake(profile)} size="sm" variant="outline">
              Start over
            </Button>
          </SettingsControl>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
