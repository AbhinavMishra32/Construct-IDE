import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ExternalLink, KeyRound } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { LANGUAGES, type Language } from "@construct/domain";

import type { ConstructApi, LearnerFooting, LearnerLeaning, LearnerPace, LearnerProfile, ProviderInventory } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { ConstructDots } from "../common/ConstructDots";
import { ConstructWordmark } from "../common/ConstructWordmark";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { ProviderGlyph } from "../common/ProviderGlyph";
import { ProviderConnectDialog, type Provider } from "../settings/ProviderConnectDialog";
import { refreshProviders } from "../../hooks/use-providers";
import { LINKS, PANEL, STEP, TEXT, useMarkPass } from "../auth/arrival";
import { answered, COPY, FOOTINGS, LEANINGS, PACES, STEPS, type StepName } from "./intake";

/**
 * Meeting the learner.
 *
 * This runs once, between signing in and the first project, and it exists
 * because the alternative was the agent spending the opening turn of every
 * project asking the same five questions — questions whose answers do not change
 * between projects, and which a learner starting their third project has now
 * answered three times.
 *
 * What makes it worth sitting through rather than pressing past is the question
 * step. Fixed questions get you a category; one written by the model from the
 * answers to the fixed ones gets you the thing that was actually worth knowing
 * about this person — and, more to the point, it is the moment they can
 * see that something read what they wrote. Everything before it is Construct
 * asking. That step is Construct listening, and the portrait after it is
 * Construct saying back what it heard, in their own words, for them to correct.
 *
 * Both model calls are allowed to fail and neither blocks. No provider connected,
 * a timeout, an answer that is not a question — the flow steps over it and the
 * portrait falls back to one written locally. An intake that can strand someone
 * on a spinner is worse than an intake with no magic in it at all.
 *
 * It shares the sign-in screen's grammar deliberately: same dot field, same
 * lockup, same easings from `arrival.ts`. Signing in and being met are one
 * arrival in two parts, and they should not look like two applications.
 */
export function OnboardingPage({
  api,
  profile,
  onFinished,
  onError,
}: {
  api: ConstructApi | undefined;
  /** What is already known. Empty for a new account; populated when the intake
   *  is reopened from Settings to be redone. */
  profile: LearnerProfile;
  /** The profile has been stored. The shell re-reads bootstrap and opens out. */
  onFinished(): Promise<void>;
  onError(value: string): void;
}) {
  const [index, setIndex] = useState(0);
  const step = STEPS[index] as StepName;

  const [name, setName] = useState(profile.name);
  const [footing, setFooting] = useState<LearnerFooting>(profile.footing);
  const [language, setLanguage] = useState<Language>(profile.language);
  const [ambition, setAmbition] = useState(profile.ambition);
  const [leanings, setLeanings] = useState<LearnerLeaning[]>(profile.leanings);
  const [pace, setPace] = useState<LearnerPace>(profile.pace);
  const [question, setQuestion] = useState<string | null>(profile.followUp?.question ?? null);
  const [followUpAnswer, setFollowUpAnswer] = useState(profile.followUp?.answer ?? "");
  const [portrait, setPortrait] = useState(profile.portrait);

  /* Whether a turn can run at all. Read once on arrival and again after every
     connection, because the whole of the first step is waiting for this to
     become true. Null while it is still being read — told apart from false, so
     the step does not flash "connect something" at a learner who already
     has. */
  const [inventory, setInventory] = useState<ProviderInventory | null>(null);
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const readInventory = useCallback(async () => {
    setInventory(await refreshProviders().catch(() => null));
  }, []);
  useEffect(() => { void readInventory(); }, [readInventory]);
  const modelReady = inventory?.ready ?? false;

  /* The Exa key, read the same way and for the same reason: the step's whole
     job is to turn "none" into "held", so it has to know which it is looking
     at. Null while unread, so the step does not offer a field to someone who
     already supplied a key through the environment. */
  const [searchSource, setSearchSource] = useState<"keychain" | "env" | "none" | null>(null);
  const [exaKey, setExaKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState("");
  const readSearch = useCallback(async () => {
    if (!api) return;
    setSearchSource((await api.webSearchStatus().catch(() => null))?.source ?? "none");
  }, [api]);
  useEffect(() => { void readSearch(); }, [readSearch]);
  const searchReady = searchSource === "keychain" || searchSource === "env";

  /* Saving turns web search on as well as storing the key. Answering a question
     that asks whether Construct may read the web, and then leaving it switched
     off behind a key that works, is the setting disagreeing with the answer. */
  const saveKey = useCallback(async () => {
    const key = exaKey.trim();
    if (!api || !key || savingKey) return;
    setSavingKey(true);
    setKeyError("");
    try {
      await api.saveWebSearchKey(key);
      await api.setWebSearchEnabled(true).catch(() => undefined);
      setExaKey("");
      await readSearch();
    } catch (cause) {
      setKeyError(cause instanceof Error ? cause.message : "Construct could not store that key.");
    } finally {
      setSavingKey(false);
    }
  }, [api, exaKey, readSearch, savingKey]);

  /* What is being waited on, rather than a bare boolean: the two waits say
     different things, and "Reading that back…" under a spinner is the difference
     between a pause that feels considered and one that feels broken. */
  const [waiting, setWaiting] = useState<"question" | "portrait" | "saving" | null>(null);
  const { pass, awake, rouse } = useMarkPass(waiting !== null);

  const draft = useMemo(
    () => ({
      name: name.trim(),
      footing,
      language,
      ambition: ambition.trim(),
      leanings,
      pace,
      followUp: question ? { question, answer: followUpAnswer.trim() } : null,
    }),
    [ambition, followUpAnswer, footing, language, leanings, name, pace, question],
  );
  /* Read through a ref by the two async steps below. Without it the fetch would
     close over the draft as it was when the button was pressed, which is fine —
     until a slow model means the learner has typed something else by the time it
     lands, and the portrait describes a person who no longer exists. */
  const latest = useRef(draft);
  latest.current = draft;

  /* Whether the wait is this step's to sit through.
     The adaptive question is fetched a step early, on purpose, so that the time
     it takes is spent on a screen the learner is already reading. That only
     works if the screen stays live: a request nobody is waiting for must not
     disable the button in front of them, which is what "One moment…" on the
     research step was. The mark keeps turning either way, because something
     genuinely is being worked on. */
  const stalled = waiting === "portrait" || waiting === "saving" || (waiting === "question" && step === "question");

  const copy = COPY[step];
  const complete = answered(step, { name, ambition, leanings, followUpAnswer, modelReady, searchReady });

  /**
   * The adaptive question, fetched while the learner is still on the step
   * before it.
   *
   * Started from `leanings` rather than on arrival at `question`, because this
   * is the one call whose latency the learner would otherwise sit through. By
   * the time they have read the leanings step and picked from it, the question
   * is usually already here.
   */
  const asked = useRef(question !== null);
  const askQuestion = useCallback(async () => {
    /* A ref rather than the state, because the caller decides what to do next in
       the same tick it starts this. `question` and `waiting` still read as they
       did before the call until React renders again, and a flow that branches on
       them here branches on the past. That was the bug this replaced: the step
       after this one read `!question`, found it null because nothing had
       rendered yet, and stepped over the question every single time. */
    if (!api || asked.current) return;
    asked.current = true;
    setWaiting("question");
    try {
      setQuestion(await api.learnerQuestion(latest.current));
    } catch {
      /* Deliberately silent. There is nothing the learner can do about it and
         nothing they lose that they know about: the step simply is not there. */
      setQuestion(null);
    } finally {
      setWaiting(null);
    }
  }, [api]);

  const writePortrait = useCallback(async () => {
    if (!api) return;
    setWaiting("portrait");
    try {
      setPortrait(await api.learnerPortrait(latest.current));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Construct could not write that back.");
    } finally {
      setWaiting(null);
    }
  }, [api, onError]);

  const go = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(STEPS.length - 1, next)));
  }, []);

  const advance = useCallback(() => {
    rouse();
    const current = STEPS[index];

    if (current === "portrait") {
      if (!api) return;
      setWaiting("saving");
      void api
        .saveLearner({ ...latest.current, portrait: portrait.trim() })
        .then(() => onFinished())
        .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : "Construct could not save that."))
        .finally(() => setWaiting(null));
      return;
    }

    if (current === "leanings") {
      /* Unawaited, and started a step early. The question step is entered
         normally and shows its own wait; awaiting here would hold the learner on
         the step they have just finished, which reads as the button not having
         worked. The research step in between is usually enough cover that the
         question is already there by the time they arrive. */
      void askQuestion();
    }

    go(index + 1);
  }, [api, askQuestion, go, index, onError, onFinished, portrait, rouse]);

  /* A question that never arrived is a step with nothing on it, so it stands
     down as soon as that is known rather than being guessed at from the step
     before. `asked` is the guard that makes this safe: it is only true once the
     request has actually been made, so an unanswered step is never mistaken for
     an unstarted one. No apology, no empty state, no mention of a model. */
  useEffect(() => {
    if (step !== "question" || waiting === "question" || question) return;
    /* Nothing was ever asked for, so nothing is pending. With no api there is no
       request to wait on either, and standing on a blank step waiting for one is
       the failure this whole branch exists to avoid. */
    if (api && !asked.current) return;
    go(STEPS.indexOf("portrait"));
  }, [api, go, question, step, waiting]);

  /* The portrait is written on arrival rather than on the way out of the step
     before it, which is the only version that holds however this screen was
     reached — including the common one, where the question was skipped and the
     step before it was never left. A blank last screen was what this looked like
     when it was wrong. */
  const drawn = useRef(false);
  useEffect(() => {
    if (step !== "portrait" || drawn.current || !api) return;
    drawn.current = true;
    void writePortrait();
  }, [api, step, writePortrait]);

  /* Enter moves on everywhere; the two textareas keep Enter for newlines and
     take ⌘/Ctrl+Enter instead. Handled at the panel rather than per-field so a
     step with no field at all — the language grid, the footing list — still
     moves on from the keyboard. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      /* Not while the connect dialog is open. Enter inside it submits a key or
         a code, and that keypress bubbling out to here would step off the model
         screen the moment the learner finished connecting one. */
      if (event.key !== "Enter" || stalled || connecting) return;
      const inTextarea = (event.target as HTMLElement | null)?.tagName === "TEXTAREA";
      if (inTextarea && !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, connecting, stalled]);

  const toggleLeaning = useCallback((value: LearnerLeaning) => {
    rouse();
    setLeanings((current) => (current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]));
  }, [rouse]);

  /* Held ones first, then what is left to connect. A learner arriving on a
     machine that already has a provider should see that fact at the top of the
     list rather than hunt for it among five they have never used. */
  const held = (inventory?.providers ?? []).filter((provider) => provider.state !== "disconnected");
  const offered = (inventory?.providers ?? []).filter((provider) => provider.state === "disconnected").slice(0, 6);

  /* The rows are numbered on screen, so the number keys have to work — the same
     contract the agent's own questions keep mid-project. Only the rows that lead
     somewhere are numbered: a connected provider is not a choice to make.
     A keyboard has no "10" key, so nothing past nine gets one. */
  const options = step === "footing" ? FOOTINGS.length : step === "leanings" ? LEANINGS.length : step === "model" ? offered.length : 0;

  useEffect(() => {
    if (!options || connecting || stalled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      /* Typing a digit into the key field is typing, not choosing. */
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const choice = Number(event.key);
      if (!Number.isInteger(choice) || choice < 1 || choice > Math.min(options, 9)) return;
      event.preventDefault();
      const position = choice - 1;
      if (step === "footing") { rouse(); setFooting(FOOTINGS[position]!.value); }
      if (step === "leanings") toggleLeaning(LEANINGS[position]!.value);
      if (step === "model") setConnecting(offered[position] ?? null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connecting, offered, options, rouse, stalled, step, toggleLeaning]);

  const field =
    "w-full rounded-xl bg-[var(--color-background-elevated-secondary)] px-3.5 py-3 text-content outline-none " +
    "shadow-[inset_0_0_0_0.5px_var(--border-strong)] placeholder:text-muted-foreground/60";

  return (
    <div className="app-drag app-pane relative grid h-full place-items-center overflow-hidden px-6">
      <div aria-hidden className="auth-field text-foreground" />

      <motion.div className="app-no-drag relative w-full max-w-[26rem] pb-[var(--titlebar-height)]" layout transition={PANEL}>
        <motion.div className="flex items-center justify-center gap-2.5" layout="position" transition={PANEL}>
          <ConstructDots key={pass} pattern={awake ? "pass" : "still"} size={30} {...(waiting ? { label: "Working" } : {})} />
          <ConstructWordmark className="block text-[2rem] leading-none text-foreground" />
        </motion.div>

        {/* Where you are, as ground covered rather than as a count. "Step 3 of
            7" invites the arithmetic of how much is left; a rail that has
            already filled most of the way says the same thing without asking
            anyone to do sums about how long this will take. */}
        <div aria-hidden className="mx-auto mt-5 flex w-full max-w-[13rem] gap-1">
          {STEPS.map((entry, position) => (
            <motion.span
              animate={{ opacity: position <= index ? 1 : 0.16 }}
              className="h-[2px] flex-1 rounded-full bg-foreground"
              key={entry}
              transition={TEXT}
            />
          ))}
        </div>

        <motion.div animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 6 }} key={step} transition={STEP}>
          <div className="mt-5 text-center">
            <h1 className="text-content font-medium text-foreground">{copy.title}</h1>
            <p className="mx-auto mt-1 max-w-[22rem] text-ui text-muted-foreground">{copy.caption}</p>
          </div>

          <div className="mt-5">
            {step === "model" && (
              <div className={GROUP}>
                {/* Only what can actually be connected. A learner meeting
                    Construct for the first time does not need the full
                    inventory with its disconnect paths and model pickers.
                    They need one working provider, and the shortest route to
                    it. The dialog behind these rows is the same one Settings
                    opens, so there is exactly one way to connect a provider in
                    the application. */}
                {held.map((provider) => (
                  <OptionRow
                    hint={provider.state === "auth-expired" ? "Signed out. Connect it again." : provider.description}
                    index={0}
                    key={provider.id}
                    onClick={() => setConnecting(provider)}
                    selected={provider.state === "connected"}
                    trailing={<ProviderGlyph className="size-[1.15rem] shrink-0 text-muted-foreground" provider={provider.id} />}
                  >
                    {provider.name}
                  </OptionRow>
                ))}
                {offered.map((provider, position) => (
                  <OptionRow
                    hint={provider.description}
                    index={position + 1}
                    key={provider.id}
                    onClick={() => setConnecting(provider)}
                    selected={false}
                    trailing={<ProviderGlyph className="size-[1.15rem] shrink-0 text-muted-foreground" provider={provider.id} />}
                  >
                    {provider.name}
                  </OptionRow>
                ))}
                {/* The list arrives a beat after the screen does. Saying so beats
                    an empty panel, which reads as a build with no providers in
                    it rather than as a read still in flight. */}
                {!inventory && (
                  <p className="flex items-center gap-2.5 px-3.5 py-3 text-ui text-muted-foreground">
                    <ConstructDots pattern="pulse" size={16} />
                    Reading the providers on this machine…
                  </p>
                )}
                {inventory && inventory.providers.length === 0 && (
                  <p className="px-3.5 py-3 text-center text-ui text-muted-foreground">No providers are available in this build.</p>
                )}
              </div>
            )}

            {step === "name" && (
              <input
                aria-label="Your name"
                autoComplete="given-name"
                autoFocus
                className={cn(field, "h-11 py-0")}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                value={name}
              />
            )}

            {step === "footing" && (
              <div className={GROUP} role="radiogroup">
                {FOOTINGS.map((option, position) => (
                  <OptionRow
                    hint={option.detail}
                    index={position + 1}
                    key={option.value}
                    onClick={() => { rouse(); setFooting(option.value); }}
                    role="radio"
                    selected={footing === option.value}
                  >
                    {option.label}
                  </OptionRow>
                ))}
              </div>
            )}

            {step === "language" && (
              <div>
                {/* Every mark keeps its colour, and selection is carried by the
                    tile. Draining the unpicked ones makes nine of the ten look
                    disabled, which is the one thing they are not. Same rule as
                    the new-project dialog, and deliberately the same control:
                    this is the answer that becomes that dialog's default, so
                    meeting it twice should feel like meeting it twice. */}
                <div className="flex flex-wrap justify-center gap-1.5" role="radiogroup">
                  {LANGUAGES.map((value) => (
                    <button
                      aria-checked={language === value}
                      aria-label={LANGUAGE_LABEL[value]}
                      className={cn(
                        "grid size-11 shrink-0 place-items-center rounded-xl border transition-colors outline-none",
                        language === value
                          ? "border-[var(--border-strong)] bg-accent ring-1 ring-[var(--border-strong)]"
                          : "border-transparent opacity-80 hover:bg-accent/50 hover:opacity-100",
                      )}
                      key={value}
                      onClick={() => { rouse(); setLanguage(value); }}
                      role="radio"
                      type="button"
                    >
                      <LanguageGlyph className="size-6" language={value} />
                    </button>
                  ))}
                </div>
                <motion.p animate={{ opacity: 1 }} className="mt-3 text-center text-ui text-foreground" initial={{ opacity: 0 }} key={language} transition={TEXT}>
                  {LANGUAGE_LABEL[language]}
                </motion.p>
              </div>
            )}

            {step === "ambition" && (
              <Textarea
                autoFocus
                className={cn(field, "min-h-[6.5rem] resize-none border-0")}
                onChange={(event) => setAmbition(event.target.value)}
                placeholder="A renderer that puts a lit triangle on screen, and understanding every line of it"
                rows={4}
                value={ambition}
              />
            )}

            {step === "leanings" && (
              <div className="space-y-3">
                <div className={GROUP} role="group">
                  {LEANINGS.map((option, position) => (
                    <OptionRow
                      hint={option.detail}
                      index={position + 1}
                      key={option.value}
                      onClick={() => toggleLeaning(option.value)}
                      role="checkbox"
                      selected={leanings.includes(option.value)}
                    >
                      {option.label}
                    </OptionRow>
                  ))}
                </div>
                {/* Pace rides on this step rather than taking one of its own. It
                    is one binary, and a whole screen for a two-way switch is a
                    screen that makes the intake feel longer than it is. */}
                <Segmented<LearnerPace>
                  ariaLabel="How much ground to cover"
                  className="w-full"
                  onChange={(value) => { rouse(); setPace(value); }}
                  options={PACES.map((option) => ({ value: option.value, label: option.label }))}
                  value={pace}
                />
              </div>
            )}

            {step === "research" && (
              <div className="space-y-2.5">
                {searchSource === null ? (
                  <div className={GROUP}>
                    <p className="flex items-center gap-2.5 px-3.5 py-3 text-ui text-muted-foreground">
                      <ConstructDots pattern="pulse" size={16} />
                      Checking…
                    </p>
                  </div>
                ) : searchReady ? (
                  /* Held, so there is nothing to fill in. The row confirms the
                     key and says where it came from, because a key from the
                     environment is not one this screen can take away. */
                  <div className={GROUP}>
                    <OptionRow
                      hint={searchSource === "env" ? "Key supplied by EXA_API_KEY." : "Key stored in your keychain."}
                      index={0}
                      onClick={() => undefined}
                      selected
                      trailing={<KeyRound className="size-3.5 shrink-0 text-muted-foreground" />}
                    >
                      Construct can read the web.
                    </OptionRow>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Input
                        autoComplete="off"
                        className={cn(field, "h-11 flex-1 py-0 font-mono text-ui")}
                        onChange={(event) => setExaKey(event.target.value)}
                        onKeyDown={(event) => {
                          /* Enter belongs to the field while there is something
                             in it. The window listener that moves the intake on
                             would otherwise carry the learner past the key they
                             were in the middle of pasting. */
                          if (event.key !== "Enter" || !exaKey.trim()) return;
                          event.preventDefault();
                          event.stopPropagation();
                          void saveKey();
                        }}
                        placeholder="Paste your Exa API key…"
                        type="password"
                        value={exaKey}
                      />
                      <Button className="h-11 shrink-0" disabled={savingKey || !exaKey.trim()} onClick={() => void saveKey()} type="button">
                        {savingKey ? "Saving…" : "Save"}
                      </Button>
                    </div>
                    <button
                      className="inline-flex items-center gap-1.5 rounded px-1 text-ui text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => void api?.openExternal("https://dashboard.exa.ai/api-keys")}
                      type="button"
                    >
                      <ExternalLink className="size-3" />
                      Get a key from Exa
                    </button>
                  </>
                )}
              </div>
            )}

            {step === "question" && (
              <div>
                <AnimatePresence initial={false} mode="wait">
                  {waiting === "question" ? (
                    <motion.p
                      animate={{ opacity: 1 }}
                      className="thinking-shimmer py-2 text-center text-content"
                      exit={{ opacity: 0 }}
                      initial={{ opacity: 0 }}
                      key="waiting"
                      transition={TEXT}
                    >
                      Thinking of something worth asking…
                    </motion.p>
                  ) : (
                    <motion.p
                      animate={{ opacity: 1, y: 0 }}
                      className="text-center text-content text-foreground"
                      initial={{ opacity: 0, y: 4 }}
                      key="question"
                      transition={STEP}
                    >
                      {question}
                    </motion.p>
                  )}
                </AnimatePresence>
                {question && !waiting && (
                  <Textarea
                    autoFocus
                    className={cn(field, "mt-4 min-h-[5.5rem] resize-none border-0")}
                    onChange={(event) => setFollowUpAnswer(event.target.value)}
                    placeholder="However much or little you want to say."
                    rows={3}
                    value={followUpAnswer}
                  />
                )}
              </div>
            )}

            {step === "portrait" && (
              <AnimatePresence initial={false} mode="wait">
                {waiting === "portrait" ? (
                  <motion.p
                    animate={{ opacity: 1 }}
                    className="thinking-shimmer py-6 text-center text-content"
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                    key="waiting"
                    transition={TEXT}
                  >
                    Reading that back…
                  </motion.p>
                ) : (
                  /* Editable, and that is the point of the step. Being told what
                     an application concluded about you is unnerving; being able
                     to correct it in the same breath is the difference between
                     a profile done to you and one done with you. */
                  <motion.div animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 4 }} key="portrait" transition={STEP}>
                    <Textarea
                      className={cn(field, "min-h-[9rem] resize-none border-0 leading-relaxed")}
                      onChange={(event) => setPortrait(event.target.value)}
                      placeholder="Construct will fill this in."
                      rows={6}
                      value={portrait}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>

          <Button
            className="mt-4 h-11 w-full text-[0.8125rem]"
            disabled={stalled}
            onClick={advance}
            size="lg"
            type="button"
          >
            <motion.span
              animate={{ opacity: 1 }}
              className="inline-flex items-center gap-1.5"
              initial={{ opacity: 0 }}
              key={(stalled && waiting) || (complete ? copy.action : "skip")}
              transition={TEXT}
            >
              {waiting === "saving" ? (
                "Saving…"
              ) : stalled ? (
                "One moment…"
              ) : (
                <>
                  {/* Says plainly that a step is being left unanswered. The
                      whole of the pressure this intake applies, and all of it
                      it should apply. */}
                  {complete ? copy.action : step === "model" ? "I'll connect one later" : step === "research" ? "I'll add a key later" : "Skip this"}
                  {complete ? <ArrowRight data-icon="inline-end" /> : null}
                </>
              )}
            </motion.span>
          </Button>
          {/* One line for the step, under the action rather than beside it: what
              the keys do, what is still missing, or what went wrong. Numbered
              rows that never say the numbers work are a shortcut nobody finds. */}
          <p
            aria-live="polite"
            className={cn("mt-2.5 min-h-4 text-center text-ui", step === "research" && keyError ? "text-destructive" : "text-muted-foreground/70")}
            role="status"
          >
            {(step === "research" ? keyError : "") ||
              (step === "model"
                ? inventory && !modelReady ? "Connect a provider to continue" : ""
                : options
                  ? `Press 1–${Math.min(options, 9)} to choose${step === "leanings" ? ", or several" : ""}`
                  : "")}
          </p>
        </motion.div>

        <motion.div className="mt-3 flex items-center justify-center gap-4 text-ui" layout transition={LINKS}>
          {index > 0 && (
            <button
              className="inline-flex items-center gap-1 rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-45"
              disabled={stalled}
              onClick={() => { rouse(); go(index - (STEPS[index - 1] === "question" && !question ? 2 : 1)); }}
              type="button"
            >
              <ArrowLeft className="size-3" />
              Back
            </button>
          )}
        </motion.div>
      </motion.div>

      <ProviderConnectDialog
        /* No disconnect path from here. This screen exists to get one working
           provider connected; offering to remove one in the same breath is a
           control nobody needs on the way in. */
        allowDisconnect={false}
        api={api}
        onClose={() => setConnecting(null)}
        onConnected={async () => {
          setConnecting(null);
          await readInventory();
        }}
        provider={connecting}
      />
    </div>
  );
}

/**
 * The sunken group the sign-in window puts its fields in, reused for a list of
 * choices: one container, hairlines between the rows, and the selection filling
 * a row rather than outlining it.
 *
 * This replaced a stack of separately outlined cards. Four of those are four
 * objects to look at before you have read a word of any of them, and the outline
 * a selected one gained was competing with the four outlines already on screen.
 * One object with rows in it is what a list of answers actually is.
 */
const GROUP = "overflow-hidden rounded-xl bg-[var(--color-background-elevated-secondary)] shadow-[inset_0_0_0_0.5px_var(--border-strong)]";

/**
 * One choice.
 *
 * The number is not decoration. It is the key that picks the row, the same way
 * the agent's own questions are answered mid-project, and it is only drawn on
 * rows that lead somewhere: `index={0}` is for a row that is already the answer.
 *
 * Radio or checkbox by role, and the two look the same on purpose. The
 * difference is whether you may pick a second one, and you find that out by
 * trying rather than by reading the shape of a box.
 */
function OptionRow({
  children,
  hint,
  index,
  onClick,
  role,
  selected,
  trailing,
}: {
  children: React.ReactNode;
  /** The line under the label, where the choice needs explaining. */
  hint?: string;
  index: number;
  onClick(): void;
  role?: "radio" | "checkbox";
  selected: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      {...(role ? { "aria-checked": selected, role } : { "aria-pressed": selected })}
      className={cn(
        "flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors outline-none not-first:border-t not-first:border-border",
        selected
          ? "bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]"
          : "hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] focus-visible:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]",
      )}
      onClick={onClick}
      type="button"
    >
      {/* The column is always there, drawn or not. Without it a row with no
          number starts its label three characters to the left of every row
          under it, which is the one place this list has to be a column. */}
      <span aria-hidden className={cn("w-3 shrink-0 text-ui tabular-nums transition-colors", selected ? "text-foreground/70" : "text-muted-foreground/55")}>
        {index > 0 ? index : ""}
      </span>
      <span className="min-w-0 flex-1">
        {/* Both lines tightened off their default leading. The label's is set
            for running prose and the hint's for a form field, and the two
            stacked unaltered give a 66px row: six of those and the list is the
            whole window. */}
        <span className="block truncate text-content leading-[1.125rem] text-foreground">{children}</span>
        {hint && <span className="block truncate text-ui leading-4 text-muted-foreground">{hint}</span>}
      </span>
      {trailing}
      <Check className={cn("size-3.5 shrink-0 transition-opacity", selected ? "opacity-70" : "opacity-0")} />
    </button>
  );
}
