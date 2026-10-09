import { useEffect, useState } from "react";
import { Joyride, STATUS, type EventData, type Step, type TooltipRenderProps } from "react-joyride";
import { IconHelp, IconX } from "../components/icons";
import { HELP_BUTTON_STEP, PAGE_TOURS, type TourStep } from "./tours";
import { markTourSeen, seenTours, toursOff } from "./seen";

// The step recordings, by file name: a step names one and it plays above the step's text.
const GIFS = import.meta.glob<string>("./gifs/*.gif", { eager: true, query: "?url", import: "default" });

function gifUrl(name: string | undefined) {
  return name ? GIFS[`./gifs/${name}.gif`] : undefined;
}

function selector(target: string) {
  return `[data-tour="${target}"]`;
}

/** On screen now: present, with a size, and not slid out of view (the closed mobile menu). */
function visible(target: string) {
  const element = document.querySelector(selector(target));
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth;
}

/** The screen's steps that can be shown now. */
function stepsOnScreen(steps: TourStep[]): TourStep[] {
  return steps.filter((step) => !step.target || visible(step.target));
}

/** A dialog or menu is open over the screen: a tour would point behind it. */
function somethingOnTop() {
  return Boolean(document.querySelector(".modal-backdrop, [role='dialog'], [role='alertdialog']"));
}

type StepData = { gif?: string; page: string };

function toJoyride(step: TourStep, page: string): Step {
  const data: StepData = { gif: gifUrl(step.gif), page };
  return {
    target: step.target ? selector(step.target) : "body",
    placement: step.target ? (step.placement ?? "bottom") : "center",
    title: step.title,
    content: step.body,
    data,
  };
}

type Running = { key: number; steps: Step[] };

/**
 * The guided tour of the open screen: it starts by itself the first time someone opens a screen,
 * and again from the ? button in the corner.
 */
export function PageTour({ path, userId }: { path: string; userId: string }) {
  const tour = PAGE_TOURS[path];
  const [running, setRunning] = useState<Running | null>(null);

  const start = (auto: boolean) => {
    if (!tour) return;
    const steps = stepsOnScreen(tour.steps);
    // Someone's first tour ends by showing where the tours are.
    if (auto && seenTours(userId).length === 0) steps.push(HELP_BUTTON_STEP);
    if (steps.length === 0) return;
    markTourSeen(userId, path);
    setRunning({ key: Date.now(), steps: steps.map((step) => toJoyride(step, tour.title)) });
  };

  // A screen's tour belongs to it: leaving the screen ends it.
  useEffect(() => {
    setRunning(null);
  }, [path]);

  // The first visit: wait for the screen to load (its first step on screen, nothing open on top).
  useEffect(() => {
    if (!tour || toursOff() || seenTours(userId).includes(path)) return;
    const first = tour.steps.find((step) => step.target)?.target;
    let waited = 0;
    const timer = window.setInterval(() => {
      waited += 250;
      const ready = !first || visible(first) || waited >= 3000;
      if (!ready || somethingOnTop()) return;
      window.clearInterval(timer);
      start(true);
    }, 250);
    return () => window.clearInterval(timer);
    // start reads the latest tour and user; re-run only for a new screen or user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, userId]);

  const onEvent = (data: EventData) => {
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) setRunning(null);
  };

  return (
    <>
      {tour ? (
        <button
          type="button"
          className="fixed right-4 bottom-4 z-30 grid h-11 w-11 place-items-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-white/70 transition hover:bg-brand-700 hover:shadow-xl print:hidden"
          title={`Show me around: ${tour.title}`}
          aria-label={`Show the tour of ${tour.title}`}
          data-tour="help-button"
          disabled={Boolean(running)}
          onClick={() => start(false)}
        >
          <IconHelp width={22} height={22} />
        </button>
      ) : null}
      {running ? (
        <Joyride
          key={running.key}
          run
          continuous
          scrollToFirstStep
          steps={running.steps}
          onEvent={onEvent}
          tooltipComponent={TourTooltip}
          locale={{ back: "Back", next: "Next", last: "Done", skip: "End the tour" }}
          options={{
            zIndex: 60,
            overlayColor: "rgba(11, 19, 36, 0.55)",
            primaryColor: "#2548e0",
            spotlightRadius: 8,
            spotlightPadding: 6,
            scrollOffset: 80,
            skipBeacon: true,
            blockTargetInteraction: true,
            overlayClickAction: false,
            // Escape ends the tour (see TourTooltip), not just the step.
            dismissKeyAction: false,
            targetWaitTimeout: 1500,
            arrowColor: "#ffffff",
          }}
        />
      ) : null}
    </>
  );
}

function TourTooltip({ step, index, size, isLastStep, controls, backProps, primaryProps, skipProps, tooltipProps }: TooltipRenderProps) {
  const data = step.data as StepData;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") controls.skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls]);

  return (
    <div
      {...tooltipProps}
      aria-label={typeof step.title === "string" ? step.title : undefined}
      className={`overflow-hidden rounded-xl bg-white text-left shadow-2xl ring-1 ring-slate-900/10 ${data.gif ? "w-[min(34rem,calc(100vw-2rem))]" : "w-[min(22rem,calc(100vw-2rem))]"}`}
    >
      {data.gif ? (
        <div className="border-b border-slate-200 bg-slate-100">
          <img src={data.gif} alt="" className="block aspect-[16/10] w-full object-contain" />
        </div>
      ) : null}
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow text-brand-600">
            {data.page}
            {size > 1 ? <span className="text-slate-400"> · {index + 1} of {size}</span> : null}
          </p>
          <button type="button" className="-mr-1.5 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" {...skipProps} aria-label="End the tour" title="End the tour">
            <IconX width={16} height={16} />
          </button>
        </div>
        {step.title ? <h2 className="mt-1 text-base font-semibold text-slate-900">{step.title}</h2> : null}
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.content}</p>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-4 py-2.5">
        <div className="flex gap-1" aria-hidden="true">
          {size > 1
            ? Array.from({ length: size }, (_, dot) => (
                <span key={dot} className={`h-1.5 rounded-full transition-all ${dot === index ? "w-4 bg-brand-600" : "w-1.5 bg-slate-300"}`} />
              ))
            : null}
        </div>
        <div className="flex gap-2">
          {index > 0 ? (
            <button type="button" className="btn-secondary py-1.5" {...backProps}>
              Back
            </button>
          ) : null}
          <button type="button" className="btn-primary py-1.5" {...primaryProps}>
            {isLastStep ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
